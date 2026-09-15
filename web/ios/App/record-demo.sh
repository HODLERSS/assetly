#!/bin/bash
# Records the App Review demo walkthrough on a target device (or simulator) and writes an .mp4.
#   REHEARSAL=1 ./record-demo.sh <udid>     # backs out of the deletion, keeps the throwaway account
#   ./record-demo.sh <udid>                 # the real take: deletes the throwaway on camera
# Output: /tmp/assetly-demo-raw.mp4 (as captured) and the encoded file this prints at the end.
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID="${1:?usage: record-demo.sh <device-or-simulator-udid>}"
OUT="${OUT:-$(cd ../../.. && pwd)/answers/assetly-demo.mp4}"
RESULT=/tmp/assetly-demo.xcresult

REHEARSAL="${REHEARSAL:-0}" ./make-demo-plan.sh

# a fresh install so the recording starts at the sign-in screen, not a restored session
if xcrun simctl list devices | grep -q "$UDID"; then
  xcrun simctl uninstall "$UDID" com.hodlerss.assetly 2>/dev/null || true
  SIGNING=(CODE_SIGNING_ALLOWED=NO)
else
  xcrun devicectl device uninstall app --device "$UDID" com.hodlerss.assetly 2>/dev/null || true
  SIGNING=(-allowProvisioningUpdates
           -authenticationKeyPath "$HOME/.private_keys/AuthKey_26G34JQ5XQ.p8"
           -authenticationKeyID 26G34JQ5XQ
           -authenticationKeyIssuerID 03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4
           DEVELOPMENT_TEAM=5RCPL9J3UX)
fi

rm -rf "$RESULT"
set +e
xcodebuild test -project App.xcodeproj -scheme AssetlyUITests \
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
