#!/bin/bash
# Records the LinkedIn hero take on a simulator. A simulator, not a phone, on purpose: a current
# iPhone is 19.5:9 and an iPhone SE is 16:9, and 16:9 footage can only be framed as a home-button
# body, which dates the clip. Apple demanded a physical device for App Review; marketing does not.
#   ./record-hero.sh [simulator-udid]        # default iPhone 17 Pro
#   HERO_TEST=testCspot ./record-hero.sh     # the longer take for the 20s/30s spots
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID="${1:-1813B4E4-8F14-4280-8C9F-16EE3AE888A4}"
OUT="${OUT:-/tmp/assetly-hero-raw.mp4}"
CRED=~/.private_keys/assetly-showcase.txt
EMAIL=$(grep '^email=' "$CRED" | cut -d= -f2-)
PASSWORD=$(grep '^password=' "$CRED" | cut -d= -f2-)

# "Light" or "Dark" — the label on the app's own Appearance chip, tapped during the seed pass.
case "${THEME:-light}" in dark) HERO_THEME=Dark ;; *) HERO_THEME=Light ;; esac

python3 - "$EMAIL" "$PASSWORD" "$HERO_THEME" <<'PY'
import json, sys
plan = {
  "configurations": [{"id": "9C8B7A65-4D3E-4F21-A0B9-8C7D6E5F4A3B", "name": "Hero", "options": {}}],
  "defaultOptions": {
    "environmentVariableEntries": [
      {"key": "SHOWCASE_EMAIL", "value": sys.argv[1]},
      {"key": "SHOWCASE_PASSWORD", "value": sys.argv[2]},
      {"key": "HERO_THEME", "value": sys.argv[3]},
    ],
    "preferredScreenCaptureFormat": "screenRecording",
    "testTimeoutsEnabled": False,
    "uiTestingScreenshotsLifetime": "keepAlways",
    "userAttachmentLifetime": "keepAlways",
  },
  "testTargets": [{"target": {"containerPath": "container:App.xcodeproj",
                              "identifier": "AA30000000000000000000T1", "name": "AssetlyUITests"}}],
  "version": 1,
}
open("Hero.xctestplan", "w").write(json.dumps(plan, indent=2, sort_keys=True) + "\n")
PY

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
# Apple's own marketing convention, so the status bar in the recording is part of the frame
xcrun simctl status_bar "$UDID" override --time "9:41" \
  --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 2>/dev/null || true
# THEME=dark records the app in dark mode (Appearance follows the system by default)
# Appearance must be set on a fully booted device and before the app launches: setting it while the
# simulator was still booting is how a THEME=dark take came back rendered in light.
#
# And the app must be UNINSTALLED first, not just terminated. The app persists its Appearance choice
# in localStorage, and an install over the top keeps the container: after a take that ended on the
# "Light" chip, every later THEME=dark run rendered light no matter what the simulator was set to.
# A fresh install starts on "System", which is the only state in which simctl's appearance decides.
xcrun simctl terminate "$UDID" com.hodlerss.assetly 2>/dev/null || true
xcrun simctl uninstall "$UDID" com.hodlerss.assetly 2>/dev/null || true
xcrun simctl ui "$UDID" appearance "${THEME:-light}"
sleep 2
GOT=$(xcrun simctl ui "$UDID" appearance)
[ "$GOT" = "${THEME:-light}" ] || { echo "appearance is $GOT, wanted ${THEME:-light}"; exit 1; }

# Seed and take in ONE invocation: each xcodebuild run reinstalls the app and would wipe the session.
rm -rf /tmp/assetly-hero.xcresult
set +e
xcodebuild test -project App.xcodeproj -scheme AssetlyUITests -testPlan Hero \
  -destination "id=$UDID" \
  -only-testing:AssetlyUITests/AssetlyHeroUITests/testAseed \
  -only-testing:"AssetlyUITests/AssetlyHeroUITests/${HERO_TEST:-testBhero}" \
  -resultBundlePath /tmp/assetly-hero.xcresult -derivedDataPath /tmp/dd-hero \
  CODE_SIGNING_ALLOWED=NO > /tmp/assetly-hero.log 2>&1
STATUS=$?
set -e
grep -E "Test Case .*(passed|failed)|error:|XCTAssert" /tmp/assetly-hero.log | tail -8 || true

rm -rf /tmp/assetly-hero-att
xcrun xcresulttool export attachments --path /tmp/assetly-hero.xcresult \
  --output-path /tmp/assetly-hero-att --test-id "AssetlyHeroUITests/${HERO_TEST:-testBhero}()" > /dev/null
RAW=$(ls -S /tmp/assetly-hero-att/*.mp4 2>/dev/null | head -1)
[ -n "$RAW" ] || { echo "no screen recording for testBhero"; exit 1; }
cp "$RAW" "$OUT"
echo "raw take: $OUT  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  $(du -h "$OUT" | cut -f1)"
echo "xcodebuild exit $STATUS"
