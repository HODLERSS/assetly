#!/bin/bash
# Brief notifications on a simulator (1.0.3): fresh install, sign in, provisional by default (no prompt),
# the Settings switch. Screenshots land in $SHOTS. Then check push_tokens and push (see RUNBOOK).
#   ./run-push-sim.sh <simulator-udid> [test-name] [--keep]
set -u
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID="${1:?usage: run-push-sim.sh <udid> [test] [--keep]}"
TEST="${2:-testProvisionalByDefaultThenSettingsSwitch}"
KEEP="${3:-}"
CRED=~/.private_keys/assetly-reviewer.txt
SHOTS="${SHOTS:-/tmp/assetly-push-shots}"
mkdir -p "$SHOTS"
EMAIL=$(grep '^email=' "$CRED" | cut -d= -f2-)
PASSWORD=$(grep '^password=' "$CRED" | cut -d= -f2-)

# the plan carries the credentials: a test plan overrides TEST_RUNNER_* env (see RUNBOOK)
python3 - "$EMAIL" "$PASSWORD" "$SHOTS" <<'PY'
import json, sys
plan = {
  "configurations": [{"id": "8B3C4D5E-6F70-4A8B-9C0D-2E3F4A5B6C7D", "name": "Push", "options": {}}],
  "defaultOptions": {
    "environmentVariableEntries": [
      {"key": "PUSH_EMAIL", "value": sys.argv[1]},
      {"key": "PUSH_PASSWORD", "value": sys.argv[2]},
      {"key": "PUSH_SHOT_DIR", "value": sys.argv[3]},
    ],
    "testTimeoutsEnabled": False,
  },
  "testTargets": [{"target": {"containerPath": "container:App.xcodeproj",
                              "identifier": "AA30000000000000000000T1", "name": "AssetlyUITests"}}],
  "version": 1,
}
open("Push.xctestplan", "w").write(json.dumps(plan, indent=2, sort_keys=True) + "\n")
PY

xcrun simctl boot "$UDID" 2>/dev/null || true
# a fresh install: iOS forgets the notification permission with the app
[ "$KEEP" = "--keep" ] || xcrun simctl uninstall "$UDID" com.hodlerss.assetly 2>/dev/null || true
LOG="/tmp/push-sim-$TEST.log"
# the tap test: a brief push arrives while the test waits on the Home screen
if [ "$TEST" = "testTapOpensBrief" ]; then
  DAY=$(TZ=America/New_York date +%F)
  cat > /tmp/assetly-push-payload.apns <<JSON
{"Simulator Target Bundle":"com.hodlerss.assetly","aps":{"alert":{"title":"Morning brief","body":"Chips lead your book higher before the open."},"sound":"default","thread-id":"brief-morning","badge":1},"brief_date":"$DAY","edition":"morning","link":"/brief/$DAY/morning"}
JSON
  (sleep 60; xcrun simctl push "$UDID" com.hodlerss.assetly /tmp/assetly-push-payload.apns) &
fi
# signed to run locally (ad hoc): the simulator only hands out an APNs token to a build carrying aps-environment
xcodebuild test -project App.xcodeproj -scheme AssetlyUITests -testPlan Push \
  -destination "id=$UDID" -only-testing:"AssetlyUITests/PushUITests/$TEST" \
  -derivedDataPath /tmp/dd-push CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= > "$LOG" 2>&1
STATUS=$?
grep -E "error:|XCTAssert|Test Case .* (passed|failed)|\*\* TEST" "$LOG" | tail -12
echo "exit $STATUS; shots in $SHOTS"
exit $STATUS
