# Schedule (America/Chicago) and the launchd proposal

Proposal only: no launchd job is installed by the skill. The main session decides.

## Start times

| Edition | Must be ready | Start (CT) | Start (ET) | Why |
|---|---|---|---|---|
| preopen | 8:00 AM CT (9:00 ET, 30 min before the open) | **7:32 AM** | 8:32 AM | the app writes the Morning Brief only from 8:00 AM ET; premarket quotes are live from 4:00 AM ET; ~22 min end to end |
| midday | 12:00 PM CT (1:00 PM ET) | **11:35 AM** | 12:35 PM | the Midday Pulse window is the session; ~22 min |
| close | as soon as possible after 3:00 PM CT (4:00 PM ET) | **3:02 PM** | 4:02 PM | the Closing Note window opens at 4:00 PM ET; both quote feeds carry the official close by ~4:01 |

Weekends and US market holidays: `run.sh` asks the app's calendar first and exits 0 without doing anything.

### The Korea editions (v1.1.0, owner 10/1: "2 more Korean focused ... mid-longer-term"; v1.2.0 adds korea-midday: six Shorts a day, 3 US + 3 KR)

| Edition | Start (KST) | Start (CT, CDT / CST) | Ready (CT) | KRX session | Pages filmed on | Ask on camera |
|---|---|---|---|---|---|---|
| `korea-open` | **9:32 AM** (KRX open + 32 min; the app's kr_open brief is written at 9:20) | 7:32 PM / 6:32 PM, the evening BEFORE (Sun-Thu) | ~8:00 PM / 7:00 PM | the day's session, live | 1M chart | "How exposed is my portfolio to memory chips?" |
| `korea-midday` (v1.2.0) | **12:00 PM** (mid-session; Seoul has no lunch break) | 10:00 PM / 9:00 PM, the evening BEFORE (Sun-Thu) | ~10:25 PM / 9:25 PM | the day's session, live | YTD chart | "How much of my portfolio is in Korean stocks?" |
| `korea-close` | **3:45 PM** (KRX close 3:30 + 15 min; kr_close brief at 3:40) | 1:45 AM / 12:45 AM (Mon-Fri) | ~2:10 AM / 1:10 AM | the finished session | 3M chart | "What's my AI chip concentration?" |

Seoul has no daylight saving; Chicago does (CDT -> CST on Nov 1 2026, back on Mar 14 2027). The plists therefore fire
EARLY in Chicago time (`korea-open` 18:30 Sun-Thu, `korea-midday` 20:55 Sun-Thu, `korea-close` 00:40 Mon-Fri) and the gate waits for the KST start, so
the same plist fits both seasons. KRX holidays (the app's `calendar.ts` KR table, incl. substitute days: Oct 5 2026 for
Gaecheonjeol on a Saturday, Oct 9 Hangul Day, Dec 25, Dec 31): `run.sh` exits 0, both editions skip (the long view is
not run on a holiday in v1.1.0: it would have no session to anchor its stamp to). Delivery folders carry the KST session
date (`2026-10-02-korea-open`), so the gate's "already delivered" check uses the Seoul date for these two.
The Mac must be awake: `pmset repeat` holds only one wake time (07:25 for the pre-open); the evening run is normally
covered by use, the 00:40 run is not unless the Mac stays awake (`caffeinate` in the plist only helps once it starts).

## Measured latency (9/30 test runs, seconds)

| Stage | Close test 1 | Notes |
|---|---|---|
| research (data + LLM + verify + repair) | 192 | data was 126 s sequential; headlines and second-feed quotes now fetched in parallel (~40 s expected) |
| book | 21 | |
| account (seed + brief) | 308 | insights-sync requests now run side by side (was ~3 min of the 5) |
| facts | 51 | |
| record (build + seed sign-in + take + align) | 240 | xcodebuild ~40 s, sign-in ~50 s, take ~150 s |
| Ask check | 1 | |
| storyline | 70 | 1-8 LLM rounds, 6 min cap (10/1: 192 s, 7 rounds, refused; after v1.0.1: 24-78 s) |
| build (voices, edit, mix, proofs, Q1-Q19) | 313 | voices ~90 s (Whisper retakes add ~20 s each) |
| qa (Q21-Q29, upload copy, Whisper) | 22 | |
| **total** | **1218 s (20.3 min)** | test 1, sequential stages with two other runs on the same Mac |

**Achievable close latency today: ~18-22 minutes after the 4:00 PM ET close** (ready ~4:20 PM ET), i.e. inside the
15-25 minute target but not at "5 minutes after". Getting to ~10 minutes needs the pre-close warm-up below.

### 10/1 7:32 preopen (refused at the storyline, 1905 s)

research 125 s, book 27, account seed 378 (est ~180-300) + brief re-check 116 (regenerated for "book" / "prints"),
facts 74, record 3 takes x (~220 take + ~85 align + ~25 ask check) = ~990 s (est 240: two retakes for the pre-open
"today" wording, now removed), storyline 192 (7 rounds then fallback refusal, now fixed). Without the retakes and the
refusal the same run is ~20 min; the seed (~6 min) is the next target.

## Getting closer to 5 minutes (not built in v1.0)

1. 3:35 PM ET: run research + book + account on the intraday picture (the names rarely change in the last 25 minutes),
   so insights and filings are already synced; at 4:01 only price-sync + the close brief (~2 min) run.
2. Record at 4:04 with the take's Home / brief / pages; storyline and voices in parallel with the take.
3. Keep the simulator booted and the UI-test bundle built (`xcodebuild build-for-testing` once a day, then
   `test-without-building`): saves ~40 s per take.

## launchd (proposal)

One agent per edition in `~/Library/LaunchAgents/com.hodlerss.assetly-shorts.<edition>.plist`, run as the user (the
Supabase CLI login, the Xcode simulator and `~/.private_keys` must be available), Monday to Friday:

```xml
<key>ProgramArguments</key>
<array><string>/bin/bash</string><string>-lc</string>
  <string>~/.claude/skills/assetly-shorts/scripts/run.sh close >> ~/Library/Logs/assetly-shorts.log 2>&1</string></array>
<key>StartCalendarInterval</key>
<array>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>15</integer><key>Minute</key><integer>2</integer></dict>
  <!-- ... Weekday 2-5 the same -->
</array>
```

preopen: Hour 7 Minute 32; midday: Hour 11 Minute 35; close: Hour 15 Minute 2 (CT, the Mac's local time); korea-open:
Weekday 0-4 Hour 18 Minute 30, korea-midday: Weekday 0-4 Hour 20 Minute 55 and korea-close: Weekday 1-5 Hour 0 Minute 40 (the gate then waits for 9:32 / 15:45 KST). The script
itself skips holidays. A refused run leaves its work dir under `/tmp/assetly-shorts/` and exits 1; the main session
should check `~/Library/Logs/assetly-shorts.log` and the delivery folder before posting. The Mac must be awake
(`pmset repeat wakeorpoweron MTWRF 07:25:00` covers the first run).

## The version gate (since 10/1)

launchd runs `~/.local/bin/assetly-shorts-gate.sh <edition> --upload` (owned by the main session), not run.sh directly.
The gate polls every 60 s until the INSTALLED `~/.claude/skills/assetly-shorts/SKILL.md` heading
("# Assetly market Shorts, vX.Y.Z") is >= `~/.config/assetly-shorts/min_version`, then execs run.sh; past the edition's
deadline (preopen 8:45, midday 13:30, close 17:00 CT; korea-open 10:30 KST, korea-midday 13:00 KST, korea-close 17:30 KST) it skips with exit 4 rather than run an old version.

Releasing: develop in the repo mirror, validate with `--test` on a saved work dir, copy every file into the installed
skill, and change the installed heading LAST (a waiting run starts the moment it reads the new version). Raise
`min_version` only when older versions must be blocked. Do not install between 15:00 and ~15:35 CT (the close run).
