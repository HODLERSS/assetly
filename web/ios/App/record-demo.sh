#!/bin/bash
# Records the App Review demo walkthrough on a target device (or simulator) and writes an .mp4.
#   REHEARSAL=1 ./record-demo.sh <udid>     # backs out of the deletion, keeps the throwaway account
#   ./record-demo.sh <udid>                 # the real take: deletes the throwaway on camera
#
# On a physical device the phone needs three things, none of them settable from here:
#   Settings > Privacy & Security > Developer Mode  ON  (requires a restart)
#   Settings > Developer > Enable UI Automation     ON  (without it the runner dies with
#                                                        LocalAuthentication -4 "UI canceled by system")
#   unlocked, and Auto-Lock set to Never for the duration
# Output: /tmp/assetly-demo-raw.mp4 (as captured) and the encoded file this prints at the end.
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID="${1:?usage: record-demo.sh <device-or-simulator-udid>}"
OUT="${OUT:-$(cd ../../.. && pwd)/answers/assetly-demo.mp4}"
RESULT=/tmp/assetly-demo.xcresult

REHEARSAL="${REHEARSAL:-0}" ./make-demo-plan.sh

SIM=0
if xcrun simctl list devices | grep -q "$UDID"; then
  SIM=1
  SIGNING=(CODE_SIGNING_ALLOWED=NO)
else
  SIGNING=(-allowProvisioningUpdates
           -authenticationKeyPath "$HOME/.private_keys/AuthKey_26G34JQ5XQ.p8"
           -authenticationKeyID 26G34JQ5XQ
           -authenticationKeyIssuerID 03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4
           DEVELOPMENT_TEAM=5RCPL9J3UX)
fi

rm -rf "$RESULT"
set +e
# Build first, then reinstall the app BEFORE recording starts. Recording begins when the test does, so
# an uninstall/install inside the run would put a placeholder icon and "Installing..." on camera; doing
# it here means the Home screen shot has a settled icon and the app opens signed out.
xcodebuild build-for-testing -project App.xcodeproj -scheme AssetlyUITests \
  -destination "id=$UDID" -derivedDataPath /tmp/dd-uitest "${SIGNING[@]}" > /tmp/assetly-demo-build.log 2>&1
STATUS=$?
if [ $STATUS -ne 0 ]; then tail -20 /tmp/assetly-demo-build.log; exit $STATUS; fi

# DerivedData holds both platforms once a simulator rehearsal has run; picking the wrong one installs a
# simulator binary on the phone and installd rejects it as "invalid signature".
PRODUCTS=$([ $SIM -eq 1 ] && echo "Debug-iphonesimulator" || echo "Debug-iphoneos")
APP="/tmp/dd-uitest/Build/Products/$PRODUCTS/App.app"
[ -d "$APP" ] || { echo "no App.app under $PRODUCTS"; exit 1; }
if [ $SIM -eq 1 ]; then
  xcrun simctl uninstall "$UDID" com.hodlerss.assetly 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP" >/dev/null
else
  xcrun devicectl device uninstall app --device "$UDID" com.hodlerss.assetly >/dev/null 2>&1 || true
  xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null
fi
sleep 4                                   # let the Home screen settle before the camera rolls

xcodebuild test-without-building -project App.xcodeproj -scheme AssetlyUITests \
  -destination "id=$UDID" -only-testing:AssetlyUITests/AssetlyDemoUITests \
  -resultBundlePath "$RESULT" -derivedDataPath /tmp/dd-uitest "${SIGNING[@]}" > /tmp/assetly-demo.log 2>&1
STATUS=$?
set -e
grep -E "error:|MISSING|could not tap|no Read|no return|Test Case" /tmp/assetly-demo.log | tail -20 || true

rm -rf /tmp/assetly-demo-att
xcrun xcresulttool export attachments --path "$RESULT" \
  --output-path /tmp/assetly-demo-att --test-id "AssetlyDemoUITests/testDemoWalkthrough()" > /dev/null
RAW=$(ls -S /tmp/assetly-demo-att/*.mp4 2>/dev/null | head -1)
[ -n "$RAW" ] || { echo "no screen recording in the result bundle"; exit 1; }
cp "$RAW" /tmp/assetly-demo-raw.mp4

# App Store Connect takes .mp4, not .mov, and the attachment has to stay small
mkdir -p "$(dirname "$OUT")"
ffmpeg -v error -y -i "$RAW" -vf "scale=-2:1280" -c:v libx264 -crf 24 -preset medium \
  -pix_fmt yuv420p -movflags +faststart -an "$OUT"
echo "test exit $STATUS"
echo "duration $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s  size $(du -h "$OUT" | cut -f1)"
echo "$OUT"
