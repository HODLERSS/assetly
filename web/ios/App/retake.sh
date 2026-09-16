#!/bin/bash
# Waits out Supabase's 2-emails/hour cap, then records the demo take with the extended ending.
set -u
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
TARGET=${TARGET_EPOCH:?set TARGET_EPOCH}
say() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

say "waiting until $(date -u -r "$TARGET" +%H:%MZ) for the email rate limit to clear"
while [ "$(date +%s)" -lt "$TARGET" ]; do sleep 60; done

if ! STATE=$(./device-ready.py 00008030-00126D913C51402E); then
  say "phone is not ready - ${STATE:-not visible}. Reconnect and unlock it, then re-run ./record-demo.sh 00008030-00126D913C51402E"
  exit 2
fi
say "device ready - $STATE"
(cd ../../ && node e2e/throwaway.mjs) || { say "throwaway account is not usable"; exit 2; }
./record-demo.sh 00008030-00126D913C51402E
