#!/bin/bash
# The 20-minute budget's hard stop (v1.3.0, owner 10/1: "build each clip within 20 minutes max ... this time limit is
# important"). run.sh starts it beside every run:
#
#   watchdog.sh <run.sh pid> <work dir> <deadline seconds>
#
# At the deadline, unless the Short is being copied to docs/ (<work>/delivering) or already delivered (<work>/delivered),
# it refuses the run: stops every process the run started (never the log's tee), frees the skill's simulator lock when
# this run held it, and signals run.sh (USR1) to exit 1. Nothing late is ever delivered.
MAIN="$1"; W="$2"; DL="$3"; ME=$$
sleep "$DL" < /dev/null > /dev/null 2>&1 & SL=$!          # the sleep holds no pipe (a caller reading the log is never kept open)
trap 'kill $SL 2>/dev/null; exit 0' TERM
wait $SL
while [ -e "$W/delivering" ]; do sleep 1; done        # never cut a delivery copy in half
[ -e "$W/delivered" ] && exit 0
kill -0 "$MAIN" 2>/dev/null || exit 0
echo "$(date +%H:%M:%S) REFUSE: the ${DL}s budget ran out ($(( DL / 60 )) min since the start): stopping the run, nothing is delivered"
touch "$W/deadline"
kill -USR1 "$MAIN" 2>/dev/null
kill_tree() {
  local k
  for k in $(pgrep -P "$1" 2>/dev/null); do
    [ "$k" = "$ME" ] && continue
    [ "$(ps -o comm= -p "$k" 2>/dev/null)" = "tee" ] && continue
    kill_tree "$k"; kill -TERM "$k" 2>/dev/null
  done
}
kill_tree "$MAIN"
# the take's display recorder and the simulator lock (record.py writes its work dir into the lock)
pkill -INT -f "recordVideo --codec=h264 --force $W/" 2>/dev/null
L=/tmp/assetly-shorts/record.lock
if [ -d "$L" ] && [ "$(cat "$L/owner" 2>/dev/null)" = "$W" ]; then rm -f "$L/owner"; rmdir "$L" 2>/dev/null; fi
osascript -e "display notification \"Short refused: the 20-minute budget ran out ($(basename "$W"))\" with title \"Assetly Shorts\"" 2>/dev/null
exit 0
