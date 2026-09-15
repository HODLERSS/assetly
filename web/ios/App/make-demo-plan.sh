#!/bin/bash
# Generates AssetlyDemo.xctestplan for the App Review demo recording. The plan carries the demo
# credentials as environment variables (a test plan overrides TEST_RUNNER_* build settings, so this is
# the only way they reach the test), which is why the generated file is gitignored and the secrets
# stay in ~/.private_keys.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import json, os
def creds(name):
    p = os.path.expanduser(f"~/.private_keys/{name}")
    return dict(l.strip().split("=", 1) for l in open(p) if l.strip())
rv, tw = creds("assetly-reviewer.txt"), creds("assetly-demo-throwaway.txt")
env = [
    {"key": "DEMO_EMAIL", "value": rv["email"]},
    {"key": "DEMO_PASSWORD", "value": rv["password"]},
    {"key": "THROWAWAY_EMAIL", "value": tw["email"]},
    {"key": "THROWAWAY_PASSWORD", "value": tw["password"]},
    {"key": "REHEARSAL", "value": os.environ.get("REHEARSAL", "0")},
]
plan = {
    "configurations": [{"id": "6F1E2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B", "name": "Demo recording", "options": {}}],
    "defaultOptions": {
        "environmentVariableEntries": env,
        "preferredScreenCaptureFormat": "screenRecording",
        "testTimeoutsEnabled": False,
        "uiTestingScreenshotsLifetime": "keepAlways",
        "userAttachmentLifetime": "keepAlways",
    },
    "testTargets": [{"target": {"containerPath": "container:App.xcodeproj",
                                "identifier": "AA30000000000000000000T1", "name": "AssetlyUITests"}}],
    "version": 1,
}
open("AssetlyDemo.xctestplan", "w").write(json.dumps(plan, indent=2, sort_keys=True) + "\n")
PY
echo "AssetlyDemo.xctestplan generated (gitignored; holds the demo credentials)"
