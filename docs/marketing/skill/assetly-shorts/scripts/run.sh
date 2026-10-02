#!/bin/bash
# One entry per edition: research -> portfolio -> account + brief -> facts -> take (with Ask) -> Ask check -> storyline
# -> edit plan -> build (voices, edit, mix) -> QA gate -> deliver. Refuses (exit 1, nothing in docs/) if any metric fails.
#
#   run.sh preopen|midday|close|korea-open|korea-midday|korea-close [--date YYYY-MM-DD] [--test] [--account N] [--seed N] [--from STAGE] [--work DIR]
#
#   --date     the market date (default: today in New York; the Korea editions: today in Seoul, the KRX session's date)
#   --test     allowed off-hours / off-calendar; delivers to docs/marketing/shorts/<date>-<edition>-test<k>/
#   --from     resume an existing --work dir at a stage: research book account facts record ask story compose build qa
#   --seed     the portfolio design's random seed (a different seed = a different believable book)
#   --upload   after the gate passes, upload the -upload.mp4 to the Assetly channel as PRIVATE (app/scripts/youtube/upload.py);
#              the owner publishes. Never with --test. An auth failure is reported, the delivery stands (exit 3).
#   --prestage (v1.3.0) ~30 min before the slot: research + book + the account's full seed and syncs into
#              /tmp/assetly-shorts/prestage/<date>-<edition>/, no brief, no take; the run then only verifies and refreshes it.
#
# The 20-minute budget (v1.3.0, owner 10/1): every run must deliver within SHORTS_DEADLINE_S (default 1200) seconds of
# its start. Retries (Ask takes, storyline rounds, re-tighten, duck rebuilds) are only started when they can finish;
# watchdog.sh stops the run at the deadline and nothing late is delivered. Per-stage budget vs actual: budget.json and the
# quality report; Q41 grades the total wall time.
#
# Never uploads or posts. Keys stay in chmod-600 files inside the work dir (Supabase CLI + Vault get_secret) and are
# never printed. Needs: the Supabase CLI logged in, Xcode, ffmpeg, python3 (numpy, Pillow, faster-whisper), node, and
# the Claude Code CLI logged in (~/.local/bin/claude: the script writer, v1.4.0) and ~/.private_keys/sambanova.txt.
set -euo pipefail
# Run from a frozen copy: bash reads a script as it executes, so editing the skill mid-run broke a run (9/30,
# "line 50: 0: command not found"). The scripts are copied once and the copy is what executes.
if [ -z "${SHORTS_FROZEN:-}" ]; then
  mkdir -p /tmp/assetly-shorts; F="$(mktemp -d /tmp/assetly-shorts/frozen.XXXXXX)"
  cp -R "$(cd "$(dirname "$0")" && pwd)/." "$F/"; rm -rf "$F/__pycache__"
  cp "$(cd "$(dirname "$0")/.." && pwd)/SKILL.md" "$F/SKILL.md" 2>/dev/null || true    # the version this run is
  SHORTS_FROZEN="$F" exec bash "$F/run.sh" "$@"
fi
ED="${1:?usage: run.sh preopen|midday|close|korea-open|korea-midday|korea-close [--date D] [--test] [--prestage]}"; shift
case "$ED" in preopen|midday|close) MKT=US; DATE=$(TZ=America/New_York date +%F) ;;
  korea-open|korea-midday|korea-close) MKT=KR; DATE=$(TZ=Asia/Seoul date +%F) ;;   # v1.1.0: the KRX session, dated in Seoul (v1.2.0: + korea-midday)
  *) echo "edition must be preopen, midday, close, korea-open, korea-midday or korea-close"; exit 2 ;; esac
TEST=0; ACCT=""; ACCTN=default; SEED="$RANDOM"; FROM=""; W=""; UPLOAD=0; PRESTAGE=0
while [ $# -gt 0 ]; do case "$1" in
  --date) DATE="$2"; shift 2 ;; --test) TEST=1; shift ;; --account) ACCT="--account $2"; ACCTN="$2"; shift 2 ;;
  --seed) SEED="$2"; shift 2 ;; --upload) UPLOAD=1; shift ;; --dest) DSTO="$2"; shift 2 ;; --from) FROM="$2"; shift 2 ;; --work) W="$2"; shift 2 ;;
  --prestage) PRESTAGE=1; shift ;; *) echo "unknown $1"; exit 2 ;; esac; done
SK="$(cd "$(dirname "$0")" && pwd)"; APP="${ASSETLY_APP:-/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app}"
# SHORTS_CODE: where the seed and build scripts are read from (default the app checkout; a worktree to --test new code)
CODE="${SHORTS_CODE:-$APP}"; MK="$CODE/web/ios/App/marketing/shorts/make-short.sh"
export PATH="$HOME/.pyenv/shims:/opt/homebrew/bin:/usr/local/bin:$PATH" DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SHORTS_ACCOUNT_N="$ACCTN"

# trading days only (the app's own calendar: US, or the KRX one with its holidays and substitute days); a --test run may go anyway
TRADING=$(cd "$SK" && python3 -c "from lib import calendar_check; print(calendar_check('$DATE', '$MKT')[0])")
if [ "$TRADING" != "True" ] && [ "$TEST" != 1 ]; then echo "$DATE is not a $MKT trading day: no $ED Short"; exit 0; fi

# ---- prestage (v1.3.0, the 20-minute budget): ~30 min before the slot, research + book + the account's full seed and syncs
# (the slow part: ~5-6 min of insights / filings), no brief. The run then reuses the account when it holds the day's story
# names and only refreshes prices, news and the brief. A failed prestage costs nothing: the run designs and seeds in full.
PRE="/tmp/assetly-shorts/prestage/$DATE-$ED"
if [ "$PRESTAGE" = 1 ]; then
  rm -rf "$PRE"; mkdir -p "$PRE"; chmod 700 "$PRE"; echo $$ > "$PRE/running"
  exec > >(tee -a "$PRE/run.log") 2>&1
  T0=$(date +%s); trap 'rc=$?; rm -f "$PRE/running"; echo "prestage exit $rc after $(( $(date +%s) - T0 ))s"' EXIT
  echo "assetly-shorts prestage: $ED $DATE seed=$SEED account=$ACCTN -> $PRE"
  cd "$SK"
  # v1.4.0 (10/2: the 06:20 preopen prestage refused at research with 2 items, so the 06:50 run seeded in full and missed 7:30):
  # the prestage never depends on research passing. A short research still leaves research.json (its kept items + "hot");
  # none at all means a book of the AI leaders. The run's own research picks the items; up to two missing names are added.
  if ! python3 research.py "$ED" "$DATE" "$PRE"; then
    echo "prestage: research came up short; the book is built from its kept items + AI leaders, the run picks the stories"
    [ -s "$PRE/research.json" ] || python3 -c "import json;json.dump({'edition':'$ED','date':'$DATE','items':[],'hot':['NVDA','AVGO','MU'] if '$MKT'=='US' else [],'context':''},open('$PRE/research.json','w'))"
    [ -s "$PRE/research-data.json" ] || echo '{"candidates": []}' > "$PRE/research-data.json"
  fi
  if python3 design_book.py "$PRE" --seed "$SEED" && python3 account.py "$ED" "$PRE" $ACCT --prestage; then
    python3 -c "import json,time;json.dump({'ts':time.time(),'account':'$ACCTN','edition':'$ED','seed':$SEED},open('$PRE/prestage-ready.json','w'))"
    echo "prestage ready: $PRE"; exit 0
  fi
  echo "prestage failed: the run will design and seed the account in full"; exit 1
fi

if [ -z "$W" ]; then W="/tmp/assetly-shorts/$DATE-$ED$([ $TEST = 1 ] && echo -test)-$(date +%H%M%S)"; fi
mkdir -p "$W/build" "$W/stage"; chmod 700 "$W"; W="$(cd "$W" && pwd)"; ST="$W/stage"
rm -f "$W/delivering" "$W/delivered" "$W/deadline"
if [ "$TEST" = 1 ]; then
  K=1; while [ -e "$APP/docs/marketing/shorts/$DATE-$ED-test$K" ]; do K=$((K+1)); done; DST="$APP/docs/marketing/shorts/$DATE-$ED-test$K"
else DST="$APP/docs/marketing/shorts/$DATE-$ED"; fi
[ -n "${DSTO:-}" ] && DST="$DSTO"                       # --dest: rebuild into an existing delivery folder, or a new one
case "$DST" in /*) ;; *) DST="$APP/${DST#app/}" ;; esac  # v1.4.0: a relative --dest is under the app checkout (the run cd's away)
export SHORTS_DEST="$DST"                                 # storyline: an earlier Short's title is the other folders', not this one's
exec > >(tee -a "$W/run.log") 2>&1
VER=$(sed -n 's/^# Assetly market Shorts, v\([0-9.]*\).*/\1/p' "$SK/SKILL.md" 2>/dev/null | head -1)
echo "assetly-shorts v${VER:-?}: $ED $DATE test=$TEST seed=$SEED work=$W -> $DST (code frozen at $SHORTS_FROZEN)"

# ---- the 20-minute budget (v1.3.0, owner 10/1: "make sure you build each clip within 20 minutes max ... this time limit is
# important"). One clock from this line; every retry checks what is left before it starts and is skipped (the run refuses)
# when it could not finish; watchdog.sh stops the run at the deadline and nothing late is delivered. Checks are never traded
# for time: when the budget cannot hold a check, the run refuses.
START_TS=$(date +%s); DEADLINE_S="${SHORTS_DEADLINE_S:-1200}"
export SHORTS_T0="$START_TS" SHORTS_DEADLINE_S="$DEADLINE_S"
WD=""
trap 'rc=$?; [ -n "$WD" ] && kill "$WD" 2>/dev/null; echo "exit $rc after $(( $(date +%s) - START_TS ))s (budget ${DEADLINE_S}s)"' EXIT
trap 'echo "deadline: stopped at $(( $(date +%s) - START_TS ))s"; exit 1' USR1
bash "$SK/watchdog.sh" $$ "$W" "$DEADLINE_S" & WD=$!; disown "$WD" 2>/dev/null || true
left() { echo $(( START_TS + DEADLINE_S - $(date +%s) )); }
# what a retry must leave room for (measured 10/1, v1.3.0): FINISH = compose ~35 + build ~130 + qa ~45 + margin; TAIL = the
# screen ~40 + at least a 60 s storyline + FINISH; a take = record ~220 + Ask check ~10 + margin
TAIL_S=330; RETAKE_S=265; FINISH_S=230
# st <stage> <budget s> cmd...: runs a stage and logs its time against its budget (budget.json -> quality-report.md)
st() { local n="$1" b="$2"; shift 2; local t0 rc=0; t0=$(date +%s)
  "$@" || rc=$?
  local s=$(( $(date +%s) - t0 ))
  echo "budget: $n ${s}s of ${b}s$([ $s -gt $b ] && echo ' (OVER)') · $(left)s of ${DEADLINE_S}s left"
  python3 - "$W/budget.json" "$n" "$b" "$s" "$rc" <<'PY'
import json, os, sys
p, n, b, s, rc = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
d = json.load(open(p)) if os.path.exists(p) else {}
e = d.get(n, {"budget": 0, "secs": 0, "runs": 0}); e.update(budget=max(e["budget"], b), secs=e["secs"] + s, runs=e["runs"] + 1, ok=rc == 0)
d[n] = e; json.dump(d, open(p, "w"), indent=1)
PY
  return $rc; }
room() {   # room <seconds needed> <what>: refuse when the budget cannot hold it
  local l; l=$(left)
  if [ "$l" -lt "$1" ]; then echo "REFUSE: $2 needs ~${1}s and the ${DEADLINE_S}s budget has ${l}s left"; exit 1; fi; }

STAGES="research book account facts record ask story compose build qa"; on=0; [ -z "$FROM" ] && on=1
want() { [ "$on" = 1 ] || { [ "$1" = "$FROM" ] && on=1; }; [ "$on" = 1 ]; }
timed() { local n="$1"; shift; local t0; t0=$(python3 -c "import time;print(time.time())")
  local rc=0; "$@" || rc=$?
  python3 - "$W/latency.json" "$n" "$t0" "$rc" <<'PY'
import json, os, sys, time
p, n, t0, rc = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
d = json.load(open(p)) if os.path.exists(p) else {}
d[n] = {"start": round(t0, 1), "secs": round(time.time() - t0, 1), "ok": rc == 0}; json.dump(d, open(p, "w"), indent=1)
PY
  return $rc; }
cd "$SK"
pre_alive() { [ -e "$PRE/running" ] && kill -0 "$(cat "$PRE/running" 2>/dev/null)" 2>/dev/null; }
# v1.4.0: an extra edition (SHORTS_FOCUS / SHORTS_AVOID_SYMBOLS) designs its own book: the slot's prestage is not reused
pre_fresh() { [ -z "${SHORTS_FOCUS:-}${SHORTS_AVOID_SYMBOLS:-}" ] || return 1; python3 -c "import json,time,sys;m=json.load(open('$PRE/prestage-ready.json'));sys.exit(0 if time.time()-m['ts']<7200 and m.get('account')=='$ACCTN' else 1)" 2>/dev/null; }
# a fresh prestage (same account, <= 120 min, finished): the edition's brief is written on it now, beside research; if the
# fresh research keeps the prestaged book as is, that brief is the one the take films (account.py --early-brief)
EB=""
if want research && [ -z "$FROM" ] && [ -s "$PRE/prestage-ready.json" ] && ! pre_alive && pre_fresh; then
  python3 -c "import sys;sys.path.insert(0,'$SK');from lib import srk;srk('$W')"
  python3 account.py "$ED" "$W" $ACCT --early-brief "$PRE" & EB=$!
fi
want research && st research 160 python3 research.py "$ED" "$DATE" "$W"
if want book; then
  # a prestage still running (it starts 30 min before the slot and takes ~6-8 min): wait for it a little, never long
  for i in $(seq 1 36); do pre_alive || break; [ $i = 1 ] && echo "waiting for the prestage to finish"; sleep 5; done
  if pre_alive; then
    # still seeding after 3 min: stop it (it must never seed the account under this run) and design + seed in full
    echo "prestage still running: stopped, the run designs and seeds in full"
    kill "$(cat "$PRE/running" 2>/dev/null)" 2>/dev/null || true; pkill -TERM -f "$PRE" 2>/dev/null || true
    sleep 1; rm -f "$PRE/prestage-ready.json"
  fi
  BASE=""; [ -s "$PRE/prestage-ready.json" ] && [ -z "${SHORTS_FOCUS:-}${SHORTS_AVOID_SYMBOLS:-}" ] && BASE="--base $PRE"
  st book 30 python3 design_book.py "$W" --seed "$SEED" $BASE
fi
ACCT_RAN=0
if [ -n "$EB" ]; then st early_brief 10 wait "$EB" || { echo "early brief failed: the account stage writes it"; rm -f "$W/early-brief.json"; }; fi
if want account; then st account 30 python3 account.py "$ED" "$W" $ACCT --seed-only; ACCT_RAN=1; fi
if want facts; then
  # the brief (written, checked, regenerated when it needs it) runs beside the facts stage: neither reads the other
  BC=""; [ "$ACCT_RAN" = 1 ] && { python3 account.py "$ED" "$W" $ACCT --brief-check & BC=$!; }
  st facts 60 python3 facts.py "$ED" "$W"
  if [ -n "$BC" ]; then st brief 170 wait "$BC" || { echo "REFUSE: the brief failed (see run.log)"; exit 1; }; fi
fi
if want record; then room $((RETAKE_S + TAIL_S)) "the take"; st record 270 python3 record.py "$ED" "$W"; fi
if want ask; then
  # the on-screen answer is the app's own words: a figure only one source carries fails it, and a fresh take usually
  # answers without it. Up to three takes, then refuse; a take the budget cannot finish is not started (refuse instead).
  ok=0; for take in 1 2 3; do
    # takes 1-2 also want clean wording (no desk jargon, no pre-open "today" for yesterday); take 3 accepts it if the figures pass
    # mid-session the book moves between the facts stage and the take (10/1 midday: facts $4,368, Home +$3,965 13 min
    # later): re-verify the portfolio figures against the account at take time, so what Home shows is checkable
    if [ "$ED" = midday ] || [ "$ED" = korea-open ] || [ "$ED" = korea-midday ]; then python3 facts.py "$ED" "$W" || echo "WARN: the take-time facts refresh failed (network?); keeping the earlier facts"; fi
    if SHORTS_ASK_STRICT=$([ $take -lt 3 ] && echo 1 || echo 0) st ask 20 python3 facts.py "$ED" "$W" --ask; then ok=1; break; fi
    if [ $take -lt 3 ]; then
      room $((RETAKE_S + TAIL_S)) "another take (take $((take + 1)))"
      echo "Ask answer failed its check: take $((take + 1))"; st record 270 python3 record.py "$ED" "$W"
    fi
  done
  [ $ok = 1 ] || { echo "REFUSE: three takes, and no Ask answer passed (unconfirmed figure, the app's error message, or nothing visible)"; exit 1; }
fi
# what the take shows (OCR per beat) and fresh extended-hours quotes for the chips, then the words: the storyline gets what the
# budget leaves after compose + build + qa (at most its own 6-minute cap)
if want story; then
  st screen 40 python3 screen.py "$ED" "$W"
  CAP=$(( $(left) - FINISH_S )); if [ $CAP -gt 360 ]; then CAP=360; fi
  room $((FINISH_S + 60)) "the storyline (at least 60 s) and compose + build + qa"
  SHORTS_STORY_CAP_S=$CAP st story 100 python3 storyline.py "$ED" "$W"
fi
want compose  && st compose 40 python3 compose.py "$ED" "$DATE" "$W" "$ST"
if want build; then
  python3 -c "import sys;sys.path.insert(0,'$SK');from lib import vault;vault('$W','eleven_api_key')"
  rm -f "$ST/qa-auto.md" "$ST/quality-report.md"          # a failed build must never be graded on a previous build's table
  install -m 600 "$W/eleven_api_key" "$W/build/elk"; ln -sf "$W/take60.mp4" "$W/build/take60.mp4"
  [ -f "$W/takeask.mp4" ] && ln -sf "$W/takeask.mp4" "$W/build/takeask.mp4"     # an Ask-only re-take (ask-take.json)
  st build 160 timed build "$MK" "$ST/day.json" "$W/build" "$ST" || true
  # the duck under the first cue depends on where that line pauses (10/1 v4: -5.6 dB, the check wants -12..-6): one rebuild on
  # the same voices with the sidechain level moved toward the range. v1.3.0: also after a re-tightened build (10/1 test 4:
  # the 45-word rebuild stopped on its duck and the run refused with time left)
  duck_fix() {
    [ -s "$ST/qa-auto.md" ] && return 0
    # "|| true": no duck line is the usual case, and a failing grep inside $( ) under pipefail + set -e ended the run
    # right here instead of reaching the over-30-s rewrite below (10/1 korea-close test: 31.9 s, exit 1). Only this
    # build's own lines count (the last 30 of the log).
    local D SC; D=$(tail -30 "$W/run.log" | grep -o "duck [-+][0-9.]* dB out of range" | tail -1 | awk '{print $2}' || true)
    [ -n "$D" ] || return 0
    # a too-shallow duck gets a stronger key, step by step (10/1 korea-open test: 0.7 -> -4.6 dB, 1.0 -> -5.8 dB, still out)
    # v1.4.0: the beds start at duck_sc 1.2 (music-short.json), so a shallow duck steps up from there and a deep one down
    for SC in $(python3 -c "print('1.6 2.4' if $D > -9 else '0.8 0.5')"); do
      room 150 "a duck rebuild (same voices)"
      echo "duck out of range: rebuild on the same voices with DUCK_SC=$SC"
      REUSE_VO=1 DUCK_SC=$SC st rebuild 100 "$MK" "$ST/day.json" "$W/build" "$ST" || true
      [ -s "$ST/qa-auto.md" ] && break
      grep -q "dB out of range" <(tail -5 "$W/run.log") || break
    done
    return 0; }
  duck_fix
  # over 30 s (10/1 midday: 31.0 s): rewrite the script with a smaller word budget on the same take, then rebuild (twice max)
  TIGHT="50 61|46 56"; [ "$MKT" = KR ] && TIGHT="49 55|46 52"          # the Korea editions start at 52 words, 58 voiced (storyline.py)
  IFS='|' read -r T1 T2 <<< "$TIGHT"
  for tight in "$T1" "$T2"; do
    [ -s "$ST/qa-auto.md" ] && break
    grep -q "tighten the script" <(tail -40 "$W/run.log") || break
    room $((FINISH_S + 60)) "a tighter script and its rebuild"
    CAP=$(( $(left) - FINISH_S )); if [ $CAP -gt 180 ]; then CAP=180; fi
    set -- $tight; echo "too long: storyline again with budget $1 words ($2 voiced), same take"
    SHORTS_STORY_CAP_S=$CAP SHORTS_BUDGET=$1 SHORTS_SPOKEN_MAX=$2 st story 100 python3 storyline.py "$ED" "$W" && \
      st compose 40 python3 compose.py "$ED" "$DATE" "$W" "$ST" && \
      { st build 160 timed build "$MK" "$ST/day.json" "$W/build" "$ST" || true; duck_fix; }
  done
  [ -s "$ST/qa-auto.md" ] || { echo "REFUSE: the build did not finish (see $W/run.log)"; exit 1; }
fi
if want qa; then
  if ! st qa 50 python3 qa_deliver.py "$ED" "$DATE" "$W" "$ST" "$DST"; then
    # One automatic remedy: a word the dry voice says cleanly but the MIX masks (Q28 alone) gets a deeper duck, same voices
    if grep -q "failing Q28\. " "$ST/quality-report.md" && grep "| Q28 |" "$ST/quality-report.md" | grep -q "dry voice track mismatches: none"; then
      room 150 "a Q28 remix (same voices) and a second grading"
      # v1.4.0: the beds start at duck_sc 1.2, so "deeper" is 2.0 (it was 1.0 over the old 0.7 default)
      echo "Q28 only, the dry voice is clean: remix with a deeper duck (DUCK_SC=2.0) and grade again"
      rm -f "$ST/qa-auto.md" "$ST/quality-report.md"
      REUSE_VO=1 DUCK_SC=2.0 st rebuild 100 "$MK" "$ST/day.json" "$W/build" "$ST" || true
      st qa 50 python3 qa_deliver.py "$ED" "$DATE" "$W" "$ST" "$DST"
    else
      exit 1
    fi
  fi
fi
kill "$WD" 2>/dev/null || true; WD=""      # delivered inside the budget: the watchdog stands down
echo "done: $DST in $(( $(date +%s) - START_TS ))s of ${DEADLINE_S}s"
# publishing hints (v1.4.0, owner-approved channel plan 10/2): when to publish and which playlist (adding to a playlist by API
# needs the broader youtube scope: the owner does it while publishing). korea-close goes out at 6:45 AM ET, not ~2:50 AM.
PUBAT=""; [ "$ED" = korea-close ] && PUBAT=$(python3 -c "
from datetime import datetime, timedelta; from zoneinfo import ZoneInfo
n = datetime.now(ZoneInfo('America/New_York')); t = n.replace(hour=6, minute=45, second=0, microsecond=0)
t = t if t > n + timedelta(minutes=10) else t + timedelta(days=1)
print(t.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ'), t.strftime('%a %b %-d, 6:45 AM ET'))")
PL=$([ "$MKT" = KR ] && echo "Korea AI Chip Stocks Daily" || echo "Stock Market Today: Open, Midday, Close")
{ [ -n "$PUBAT" ] && echo "Publish: ${PUBAT#* } (YouTube publishAt ${PUBAT%% *} when uploaded with --upload; TikTok: post the inbox draft then)" || echo "Publish: at once"
  echo "Playlist: $PL (add while publishing)"; echo "Pinned comment: pin-comment.txt"; } > "$DST/publish-at.txt"
echo "publish hint: $(head -1 "$DST/publish-at.txt"); playlist: $PL"
if [ "$UPLOAD" = 1 ]; then
  if [ "$TEST" = 1 ]; then echo "--upload ignored on a --test run"; exit 0; fi
  SLUG="$DATE-$ED"
  if ! python3 "$APP/scripts/youtube/upload.py" "$DST/assetly-short-$SLUG-upload.mp4" "$DST/youtube-metadata.json" --privacy private \
       $([ -n "$PUBAT" ] && echo "--publish-at ${PUBAT%% *}") > "$W/upload.json" 2> "$W/upload.err"; then
    if grep -qiE "invalid_grant|401|unauthorized|expired|revoked|youtube_token" "$W/upload.err"; then
      echo "UPLOAD FAILED: YouTube authorization is no longer valid (the Google app is in Testing, so refresh tokens expire after 7 days)."
      echo "  Fix: run python3 $APP/scripts/youtube/auth.py once, then: python3 $APP/scripts/youtube/upload.py $DST/assetly-short-$SLUG-upload.mp4 $DST/youtube-metadata.json"
    else
      echo "UPLOAD FAILED (the Short is delivered; upload it by hand): $(tail -c 300 "$W/upload.err" | tr '\n' ' ')"
    fi
    YT_RC=3        # v1.4.0: a YouTube failure no longer skips TikTok; the run still exits 3 after it
  else cp "$W/upload.json" "$DST/youtube-upload.json"; echo "uploaded (private): $(cat "$W/upload.json")"; fi
fi
# TikTok (owner, 10/1; v1.4.0 owner 10/2: "make sure you can update tiktok too as you do in Youtube"): every delivered Short
# also goes to @assetlyapp, right after the YouTube upload, through the Content Posting API (app/scripts/tiktok/post.py;
# the token from auth.py, references/tiktok.md "Owner setup"). Direct Post when the app is audited, else the owner's TikTok
# inbox (he taps Post, like publishing the private YouTube upload). The queue + notice only on failure: no token / expired
# (3) or refused before upload (4). Uploaded but unconfirmed (5) is never queued: a second post would duplicate it.
YT_RC=${YT_RC:-0}
if [ "$TEST" != 1 ]; then
  python3 "$SK/tiktok_pack.py" "$DST" "$DATE" || echo "TIKTOK PACKAGE FAILED (YouTube is unaffected)"
  if [ "$UPLOAD" = 1 ] && [ -s "$DST/tiktok.mp4" ]; then
    TT=0; python3 "$APP/scripts/tiktok/post.py" "$DST" > "$W/tiktok.out" 2> "$W/tiktok.err" || TT=$?
    if [ $TT = 0 ]; then echo "tiktok: $(tail -1 "$W/tiktok.out")"
    elif [ $TT = 5 ]; then
      echo "tiktok: uploaded, not confirmed yet (publish_id in $DST/tiktok.json): check TikTok Studio, do not re-post"
      osascript -e "display notification \"$ED TikTok uploaded but not confirmed: check TikTok Studio\" with title \"Assetly Shorts\"" 2>/dev/null || true
    else
      Q="$APP/docs/marketing/shorts/tiktok-queue.txt"; grep -qxF "$DST" "$Q" 2>/dev/null || echo "$DST" >> "$Q"
      echo "tiktok: API post failed (exit $TT: $(tail -c 200 "$W/tiktok.err" | tr '\n' ' ')) -> queued $Q"
      MSG="$ED TikTok not posted: ask Claude to post the TikTok queue"; [ $TT = 3 ] && MSG="$ED TikTok not posted: run app/scripts/tiktok/auth.py once"
      osascript -e "display notification \"$MSG\" with title \"Assetly Shorts\"" 2>/dev/null || true
    fi
  fi
fi
exit "$YT_RC"
