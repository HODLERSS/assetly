#!/bin/bash
# First-run walkthrough in the native shell on a simulator. Resets the fixture account first, so the
# app really does open on "Set up Assetly".
#   ./run-firstrun-sim.sh <simulator-udid> <label>
set -u
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID="${1:?usage: run-firstrun-sim.sh <udid> <label>}"
LABEL="${2:-sim}"
CRED=~/.private_keys/assetly-firstrun.txt
EMAIL=$(grep '^email=' "$CRED" | cut -d= -f2-)
PASSWORD=$(grep '^password=' "$CRED" | cut -d= -f2-)

(cd ../../ && node e2e/reset-firstrun.mjs) || exit 1

# the plan carries the credentials: a test plan overrides TEST_RUNNER_* env (see RUNBOOK)
python3 - "$EMAIL" "$PASSWORD" <<'PY'
import json, sys
plan = {
  "configurations": [{"id": "7A2B3C4D-5E6F-4A8B-9C0D-1E2F3A4B5C6D", "name": "First run", "options": {}}],
  "defaultOptions": {
    "environmentVariableEntries": [
      {"key": "FIRSTRUN_EMAIL", "value": sys.argv[1]},
      {"key": "FIRSTRUN_PASSWORD", "value": sys.argv[2]},
    ],
    "testTimeoutsEnabled": False,
    "uiTestingScreenshotsLifetime": "keepAlways",
    "userAttachmentLifetime": "keepAlways",
  },
  "testTargets": [{"target": {"containerPath": "container:App.xcodeproj",
                              "identifier": "AA30000000000000000000T1", "name": "AssetlyUITests"}}],
  "version": 1,
}
open("FirstRun.xctestplan", "w").write(json.dumps(plan, indent=2, sort_keys=True) + "\n")
PY

xcrun simctl boot "$UDID" 2>/dev/null || true
rm -rf "/tmp/firstrun-$LABEL.xcresult"
xcodebuild test -project App.xcodeproj -scheme AssetlyUITests -testPlan FirstRun \
  -destination "id=$UDID" -only-testing:AssetlyUITests/FirstRunUITests \
  -resultBundlePath "/tmp/firstrun-$LABEL.xcresult" -derivedDataPath /tmp/dd-firstrun \
  CODE_SIGNING_ALLOWED=NO > "/tmp/firstrun-$LABEL.log" 2>&1
STATUS=$?
grep -E "error:|XCTAssert|Test Case .* (passed|failed)|\*\* TEST" "/tmp/firstrun-$LABEL.log" | tail -12
echo "$LABEL exit $STATUS"
exit $STATUS
