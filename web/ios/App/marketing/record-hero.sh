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
CRED="${CRED:-$HOME/.private_keys/assetly-showcase.txt}"   # the daily Short passes its demo account
EMAIL=$(grep '^email=' "$CRED" | cut -d= -f2-)
PASSWORD=$(grep '^password=' "$CRED" | cut -d= -f2-)

# "Light" or "Dark" — the label on the app's own Appearance chip, tapped during the seed pass.
case "${THEME:-light}" in dark) HERO_THEME=Dark ;; *) HERO_THEME=Light ;; esac

# Paths are overridable so a second recorder (the assetly-shorts skill, another agent) never shares a result bundle
XCR="${XCRESULT:-/tmp/assetly-hero.xcresult}"; DD="${DERIVED:-/tmp/dd-hero}"; ATT="${ATT_DIR:-/tmp/assetly-hero-att}"; XLOG="${XCLOG:-/tmp/assetly-hero.log}"
python3 - "$EMAIL" "$PASSWORD" "$HERO_THEME" "${DAILY_SYMBOLS:-}" "${DAILY_RANGE:-}" "${ASK_QUESTION:-}" <<'PY'
import json, sys
plan = {
  "configurations": [{"id": "9C8B7A65-4D3E-4F21-A0B9-8C7D6E5F4A3B", "name": "Hero", "options": {}}],
  "defaultOptions": {
    "environmentVariableEntries": [
      {"key": "SHOWCASE_EMAIL", "value": sys.argv[1]},
      {"key": "SHOWCASE_PASSWORD", "value": sys.argv[2]},
      {"key": "HERO_THEME", "value": sys.argv[3]},
      {"key": "DAILY_SYMBOLS", "value": sys.argv[4]},
      {"key": "DAILY_RANGE", "value": sys.argv[5]},
      {"key": "ASK_QUESTION", "value": sys.argv[6]},
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
rm -rf "$XCR"
# SIM_VIDEO=<file.mov>: also record the display itself at its native 60 Hz (the XCTest attachment is
# ~17 fps variable rate, which judders on a scroll). Started before the test, stopped after it; trim later.
if [ -n "${SIM_VIDEO:-}" ]; then
  # each line of the recorder's output is stamped with the host clock: "Recording started" is the take's t=0, which
  # lets the skill map the UI test's wall-clock marks onto the display recording
  rm -f "$SIM_VIDEO"; ( xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$SIM_VIDEO" 2>&1 | \
    perl -MTime::HiRes=time -ne 'BEGIN{$|=1} printf("%.3f %s", time, $_)' > "${SIM_VIDEO%.*}.reclog" ) &
  SIMREC=$!; sleep 2
fi
set +e
xcodebuild test -project App.xcodeproj -scheme AssetlyUITests -testPlan Hero \
  -destination "id=$UDID" \
  -only-testing:AssetlyUITests/AssetlyHeroUITests/testAseed \
  -only-testing:"AssetlyUITests/AssetlyHeroUITests/${HERO_TEST:-testBhero}" \
  -resultBundlePath "$XCR" -derivedDataPath "$DD" \
  CODE_SIGNING_ALLOWED=NO > "$XLOG" 2>&1
STATUS=$?
set -e
if [ -n "${SIMREC:-}" ]; then pkill -INT -f "recordVideo --codec=h264 --force $SIM_VIDEO" || true; wait "$SIMREC" 2>/dev/null || true; echo "display take: $SIM_VIDEO $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SIM_VIDEO")s"; fi
grep -E "Test Case .*(passed|failed)|error:|XCTAssert" "$XLOG" | tail -8 || true

rm -rf "$ATT"
xcrun xcresulttool export attachments --path "$XCR" \
  --output-path "$ATT" --test-id "AssetlyHeroUITests/${HERO_TEST:-testBhero}()" > /dev/null
RAW=$(ls -S "$ATT"/*.mp4 2>/dev/null | head -1)
[ -n "$RAW" ] || { echo "no screen recording for testBhero"; exit 1; }
cp "$RAW" "$OUT"
echo "raw take: $OUT  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  $(du -h "$OUT" | cut -f1)"
echo "xcodebuild exit $STATUS"
