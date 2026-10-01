#!/bin/bash
# One entry per edition: research -> portfolio -> account + brief -> facts -> take (with Ask) -> Ask check -> storyline
# -> edit plan -> build (voices, edit, mix) -> QA gate -> deliver. Refuses (exit 1, nothing in docs/) if any metric fails.
#
#   run.sh preopen|midday|close [--date YYYY-MM-DD] [--test] [--account N] [--seed N] [--from STAGE] [--work DIR]
#
#   --date     the market date (default: today in New York)
#   --test     allowed off-hours / off-calendar; delivers to docs/marketing/shorts/<date>-<edition>-test<k>/
#   --from     resume an existing --work dir at a stage: research book account facts record ask story compose build qa
#   --seed     the portfolio design's random seed (a different seed = a different believable book)
#   --upload   after the gate passes, upload the -upload.mp4 to the Assetly channel as PRIVATE (app/scripts/youtube/upload.py);
#              the owner publishes. Never with --test. An auth failure is reported, the delivery stands (exit 3).
#
# Never uploads or posts. Keys stay in chmod-600 files inside the work dir (Supabase CLI + Vault get_secret) and are
# never printed. Needs: the Supabase CLI logged in, Xcode, ffmpeg, python3 (numpy, Pillow, faster-whisper), node, and
# ~/.private_keys/openrouter.txt.
set -euo pipefail
ED="${1:?usage: run.sh preopen|midday|close [--date D] [--test]}"; shift
case "$ED" in preopen|midday|close) ;; *) echo "edition must be preopen, midday or close"; exit 2 ;; esac
DATE=$(TZ=America/New_York date +%F); TEST=0; ACCT=""; SEED="$RANDOM"; FROM=""; W=""; UPLOAD=0
while [ $# -gt 0 ]; do case "$1" in
  --date) DATE="$2"; shift 2 ;; --test) TEST=1; shift ;; --account) ACCT="--account $2"; shift 2 ;;
  --seed) SEED="$2"; shift 2 ;; --upload) UPLOAD=1; shift ;; --dest) DSTO="$2"; shift 2 ;; --from) FROM="$2"; shift 2 ;; --work) W="$2"; shift 2 ;; *) echo "unknown $1"; exit 2 ;; esac; done
SK="$(cd "$(dirname "$0")" && pwd)"; APP="${ASSETLY_APP:-/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app}"
export PATH="$HOME/.pyenv/shims:/opt/homebrew/bin:/usr/local/bin:$PATH" DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

# trading days only (the app's own calendar); a --test run may go anyway
TRADING=$(cd "$SK" && python3 -c "from lib import calendar_check; print(calendar_check('$DATE')[0])")
if [ "$TRADING" != "True" ] && [ "$TEST" != 1 ]; then echo "$DATE is not a US trading day: no $ED Short"; exit 0; fi

if [ -z "$W" ]; then W="/tmp/assetly-shorts/$DATE-$ED$([ $TEST = 1 ] && echo -test)-$(date +%H%M%S)"; fi
mkdir -p "$W/build" "$W/stage"; chmod 700 "$W"; W="$(cd "$W" && pwd)"; ST="$W/stage"
if [ "$TEST" = 1 ]; then
  K=1; while [ -e "$APP/docs/marketing/shorts/$DATE-$ED-test$K" ]; do K=$((K+1)); done; DST="$APP/docs/marketing/shorts/$DATE-$ED-test$K"
else DST="$APP/docs/marketing/shorts/$DATE-$ED"; fi
[ -n "${DSTO:-}" ] && DST="$DSTO"                       # --dest: rebuild into an existing delivery folder
exec > >(tee -a "$W/run.log") 2>&1
echo "assetly-shorts v1.0: $ED $DATE test=$TEST seed=$SEED work=$W -> $DST"

STAGES="research book account facts record ask story compose build qa"; on=0; [ -z "$FROM" ] && on=1
want() { [ "$on" = 1 ] || { [ "$1" = "$FROM" ] && on=1; }; [ "$on" = 1 ]; }
timed() { local n="$1"; shift; local t0; t0=$(python3 -c "import time;print(time.time())")
  "$@"; local rc=$?
  python3 - "$W/latency.json" "$n" "$t0" "$rc" <<'PY'
import json, os, sys, time
p, n, t0, rc = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
d = json.load(open(p)) if os.path.exists(p) else {}
d[n] = {"start": round(t0, 1), "secs": round(time.time() - t0, 1), "ok": rc == 0}; json.dump(d, open(p, "w"), indent=1)
PY
  return $rc; }
cd "$SK"
want research && python3 research.py "$ED" "$DATE" "$W"
want book     && python3 design_book.py "$W" --seed "$SEED"
want account  && python3 account.py "$ED" "$W" $ACCT
want facts    && python3 facts.py "$ED" "$W"
if want record; then python3 record.py "$ED" "$W"; fi
if want ask; then
  if ! python3 facts.py "$ED" "$W" --ask; then
    echo "Ask answer failed its check: one more take"; python3 record.py "$ED" "$W"; python3 facts.py "$ED" "$W" --ask
  fi
fi
want story    && python3 storyline.py "$ED" "$W"
want compose  && python3 compose.py "$ED" "$DATE" "$W" "$ST"
if want build; then
  python3 -c "import sys;sys.path.insert(0,'$SK');from lib import vault;vault('$W','eleven_api_key')"
  rm -f "$ST/qa-auto.md" "$ST/quality-report.md"          # a failed build must never be graded on a previous build's table
  install -m 600 "$W/eleven_api_key" "$W/build/elk"; ln -sf "$W/take60.mp4" "$W/build/take60.mp4"
  timed build "$APP/web/ios/App/marketing/shorts/make-short.sh" "$ST/day.json" "$W/build" "$ST" || true
  [ -s "$ST/qa-auto.md" ] || { echo "REFUSE: the build did not finish (see $W/run.log)"; exit 1; }
fi
want qa && python3 qa_deliver.py "$ED" "$DATE" "$W" "$ST" "$DST"
echo "done: $DST"
if [ "$UPLOAD" = 1 ]; then
  if [ "$TEST" = 1 ]; then echo "--upload ignored on a --test run"; exit 0; fi
  SLUG="$DATE-$ED"
  if ! python3 "$APP/scripts/youtube/upload.py" "$DST/assetly-short-$SLUG-upload.mp4" "$DST/youtube-metadata.json" --privacy private > "$W/upload.json" 2> "$W/upload.err"; then
    if grep -qiE "invalid_grant|401|unauthorized|expired|revoked|youtube_token" "$W/upload.err"; then
      echo "UPLOAD FAILED: YouTube authorization is no longer valid (the Google app is in Testing, so refresh tokens expire after 7 days)."
      echo "  Fix: run python3 $APP/scripts/youtube/auth.py once, then: python3 $APP/scripts/youtube/upload.py $DST/assetly-short-$SLUG-upload.mp4 $DST/youtube-metadata.json"
    else
      echo "UPLOAD FAILED (the Short is delivered; upload it by hand): $(tail -c 300 "$W/upload.err" | tr '\n' ' ')"
    fi
    exit 3
  fi
  cp "$W/upload.json" "$DST/youtube-upload.json"; echo "uploaded (private): $(cat "$W/upload.json")"
fi
