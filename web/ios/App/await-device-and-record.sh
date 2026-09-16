#!/bin/bash
# Armed watcher: waits for Minjae's iPhone to appear, then records the App Review demo walkthrough on it.
# Nothing to do but plug the phone in and unlock it.
#   ./await-device-and-record.sh            # waits up to 24h, retries a failed take up to 3 times
set -u
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID=00008030-00126D913C51402E
LOG=/tmp/assetly-demo-watch.log
: > "$LOG"
say() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG"; }

# "connected" is not enough: XCUITest needs Developer Mode on (Settings > Privacy & Security >
# Developer Mode, then a restart). device-ready.py checks the real UDID and that flag.
say "waiting for the iPhone: connected, unlocked, Developer Mode on"
DEADLINE=$(( $(date +%s) + 24*3600 ))
LAST=""
while ! STATE=$(./device-ready.py "$UDID"); do
  [ "$(date +%s)" -lt "$DEADLINE" ] || { say "gave up: the phone never became ready"; exit 3; }
  [ "$STATE" = "$LAST" ] || { say "still waiting - $STATE"; LAST="$STATE"; }
  sleep 30
done
say "device ready - $STATE"

for attempt in 1 2 3; do
  say "attempt $attempt: reseeding the throwaway account"
  (cd ../../ && node e2e/throwaway.mjs) 2>&1 | tee -a "$LOG"
  if [ "${PIPESTATUS[0]}" = "2" ]; then
    say "the throwaway account needs its email confirmed in SQL — stopping so a human can do it"
    exit 2
  fi
  say "attempt $attempt: recording"
  if ./record-demo.sh "$UDID" 2>&1 | tee -a "$LOG"; then
    say "RECORDING OK"
    exit 0
  fi
  # the only failure that happens before the deletion is the hourly email rate limit; wait it out
  say "attempt $attempt failed; waiting 65 minutes for the email rate limit to reset"
  [ "$attempt" -lt 3 ] && sleep 3900
done
say "RECORDING FAILED after 3 attempts — see $LOG"
exit 1
