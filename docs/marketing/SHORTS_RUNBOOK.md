# Daily market Short: runbook

> **v1.0 (2026-09-30): three editions a day are made by the `assetly-shorts` skill**
> (`~/.claude/skills/assetly-shorts/`, one command: `scripts/run.sh preopen|midday|close [--date D] [--test]`):
> research -> portfolio -> account + brief -> facts -> take with Ask on camera -> Ask check -> storyline -> build ->
> QA gate (Q1-Q29 in SHORTS_QUALITY.md; refuses to deliver on any failure). The manual steps below are what it automates;
> keep them for one-off Shorts and for debugging a stage.

One Short per US trading day, after the close: the day's 2-3 biggest AI / market stories, told as one
demo account's Assetly brief. 20-25 s, 1080x1920, voiced in the Assetly narration voice, word-synced
subtitles, ends on the App Store card. Quality bar: [SHORTS_QUALITY.md](SHORTS_QUALITY.md).
First one: [shorts/2026-09-30/](shorts/2026-09-30/) (demo #001). Never upload from the pipeline: the
owner reviews the file and the main session posts it.

**Owner rules (9/30 review, all required):** no "demo" anywhere in the video or voice (the description says
"Portfolio shown is illustrative. Not financial advice."); show real numbers (net worth, today $ and %,
all time, movers, a position's value and gain); design the book around the day's stories BEFORE
recording; one camera language on every beat; insight, not headlines (why + sentiment, attributed, two
sources each); real scrolling footage. The 9/30 v2 folder is the reference.

Time: about 45 minutes, most of it the two recordings and the fact check.

## 0. Keys (never printed)

```bash
W=/tmp/short-$(date +%Y%m%d); mkdir -p $W && chmod 700 $W && cd app
npx --no-install supabase projects api-keys --project-ref hhdpthrfmsdmxdrfckxq -o json \
  | python3 -c "import json,sys;print([k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'][0],end='')" > $W/srk
curl -s -X POST https://hhdpthrfmsdmxdrfckxq.supabase.co/rest/v1/rpc/get_secret -H "apikey: $(cat $W/srk)" \
  -H "Authorization: Bearer $(cat $W/srk)" -H "Content-Type: application/json" -d '{"secret_name":"eleven_api_key"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin),end='')" > $W/elk
chmod 600 $W/srk $W/elk
```

## 1. The demo account (after 4:00 PM ET)

New number per day, or reuse one: `N=2` makes `minjae.m.lee+daily002@gmail.com`, "Demo Portfolio 002"
(the `+daily` prefix is excluded from the funnel stats; the password goes to
`~/.private_keys/assetly-daily002.txt`). Edit `BOOK` in `web/e2e/seed-daily-demo.mjs` if the day's
stories need a name the book does not hold (a story about a holding shows on its position page).

```bash
cd web && SRK_FILE=$W/srk node e2e/seed-daily-demo.mjs $N          # creates, seeds, syncs, writes the close brief
```

Then, for any symbol added today (new to the catalog), sync its filings or the brief will claim "no
earnings on the calendar" (seen 9/30 with MU) and regenerate:

```bash
SB=https://hhdpthrfmsdmxdrfckxq.supabase.co
curl -s -X POST $SB/functions/v1/filings-sync -H "Authorization: Bearer $(cat $W/srk)" -H "apikey: $(cat $W/srk)" \
  -H "Content-Type: application/json" -d '{"symbols":["MU"]}'
# insights-sync hits WORKER_RESOURCE_LIMIT on 10 symbols: call it in groups of 3-4 with "user_id"
curl ... /functions/v1/daily-brief -d '{"user_id":"<uid>","edition":"close","force":true}'
```

**Read the brief** (`daily_briefs` row for the uid, edition close): every figure against the closes,
possessives ("your best month" when it was Meta's), dividend phrasing, anything contested. Regenerate
(stochastic) rather than hand-edit; note what stays wrong in the quality report.

## 1b. Design the book first

Pick the day's 2-3 stories, then write `docs/marketing/shorts/<date>/book.json`: the story names, a few AI
leaders and supply-chain names, and one or two of the day's hot movers, sized ($150-300k) so the Home
movers list and the day's P&L tell a believable story. Re-seed with
`node e2e/seed-daily-demo.mjs N --book <book.json> --name "My portfolio" --reset` (it now syncs filings and
runs insights in threes). Check the regenerated close brief line by line; regenerate when it is wrong.

## 2. The stories and the script

Pick 2-3 AI / market stories of the day. Every figure needs two agreeing sources (the app's price row and
the Nasdaq quote API `https://api.nasdaq.com/api/quote/<SYM>/info?assetclass=stocks`, whose
`secondaryData` is the regular close; plus two news outlets for each event). If they disagree, drop the
figure. Write `sources.md` as you go.

Script rules: hook first ("AI stocks today."), one sentence per story, one line on the demo portfolio's
day (a % both sources agree on), "That's your brief." No advice, hype or jargon (the Q13 list), no em
dashes, no tickers (company names), no figure the footage visibly contradicts (9/30: the Meta chart's
"1M +25.46%" killed a spoken "27% for September"). **About 50 spoken words**: the voice reads 21.5-23 s
for 56 and the Short must end by 25 s. `make-short.sh` retries the voice up to four times and fails if it
never fits.

## 3. Footage

```bash
cd web/ios/App/marketing
THEME=dark CRED=$HOME/.private_keys/assetly-daily00$N.txt DAILY_SYMBOLS=MU,GOOGL,META DAILY_RANGE=1D \
  HERO_TEST=testFdaily SIM_VIDEO=$W/disp.mov OUT=$W/raw.mp4 ./record-hero.sh <simulator-udid>
ffmpeg -i $W/disp.mov -vf fps=60 -vsync cfr -c:v libx264 -crf 12 -preset fast -pix_fmt yuv420p -an $W/build/take60.mp4
```

`testFdaily` glides (fixed-speed drags) through Home (net worth -> brief card -> movers -> positions),
opens the close brief and scrolls it, opens each story's position on 1D and scrolls it to value and
gain, then scrolls News. `SIM_VIDEO` records the display itself (30-42 unique fps while scrolling; the
XCTest attachment is ~17 fps and judders). Take every beat from `take60.mp4`.

Use a simulator of your own (`xcrun simctl create "Shorts iPhone 17 Pro" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro <runtime>`)
so a parallel agent's tests cannot collide with the take. `testEdaily` records Home, the close brief and
its player, then each `DAILY_SYMBOLS` position page (header, chart, Assetly Intelligence), then News.

Make a 1 fps contact sheet and pick each beat's source second. **A position's chart can take ~3 s to
load on the first visit** (GOOGL on 9/30 showed a grey skeleton): start the beat after it loads, or
record a second take with just that symbol (`DAILY_SYMBOLS=GOOGL`, a second `take2.mp4`). Keep app text
you cannot source (intelligence bullets with contested figures) out of zoomed frames.

## 4. Build: one command

**Voices.** The default (since 9/30, owner's call) is a hand-off, as the launch clip: 2-3 commentary lines
in OpenRouter `openai/gpt-audio` voices **marin** and **cedar** (alternate them), then the app's own
brief voice (the **minjae** ElevenLabs clone) for "This demo portfolio closed up X. That's your brief."
Each line is word-synced on screen with an eyebrow naming the story, and five speaking pills follow
whoever is talking, so a muted viewer can follow every line. Put `"lines"` in day.json (see the 9/30
file): `voice`, `say` (spoken text; `speakable()` turns figures into words), `cues` (display tokens,
one per shown word, `\u00a0` to keep "Gemini 4." together). `voice-lines.py` renders each line
(read-verbatim transcript check, pauses shortened, gpt-audio +6% tempo), times the words with
faster-whisper and snaps each sentence to the audio's own onset. `"reuse"` pins an approved take so
a re-cut never re-voices (9/30 keeps its four takes in `voice/`). Without `"lines"`, `"cues"` with
spoken-word counts voices the whole script in the Minjae clone (the first 9/30 cut, kept as
`-alt-minjae-voice.mp4`). Keys: OpenRouter from `~/.private_keys/openrouter.txt`, ElevenLabs from
`$W/build/elk` (only for minjae lines that are not reused).

Motion and grid: set `"motion": {"to": 1.3, "in": 0.7, "out": 0.6}` and `"grid": 0.3` in day.json; every
beat then gets the same push toward its `focus_src` and every cut snaps to the music grid (Q18). Give
`"hook_dur"` when the voice starts on the first story (the cover carries "AI stocks today" as text).
`DUCK_SC` (default 0.7) sets the sidechain depth if the mixer's -6..-12 dB check trips.

Highlights (optional, static beats only): give each zoomed beat a `highlight.src_box` (recording pixels, 1206 wide) around the line
being spoken; a freeze beat needs a slow push (`"in": [0.3, 3.0]`) or the freeze metric trips.


Write `docs/marketing/shorts/<date>/day.json` (copy the 9/30 one): the display script, the subtitle cues
(each token with how many spoken words it covers, e.g. `["$54.2",3]` for "fifty-four point two", an
eyebrow per story), and the beats (`take`, `start`, `freeze`, `zoom`, `highlight`, and `to_cue`: the beat
ends just before that cue's first word, so every cut lands on its sentence). Write
`youtube-metadata.md` next to it (the QA scans it), then:

```bash
mkdir -p $W/build && cp $W/elk $W/build/ && ln -sf $W/take*.mp4 $W/build/
web/ios/App/marketing/shorts/make-short.sh docs/marketing/shorts/<date>/day.json $W/build docs/marketing/shorts/<date>
```

It voices the script (speakable() then ElevenLabs with timestamps, pauses shortened), times the beats
from the voice, renders word-synced subtitles, composes (title card that doubles as the thumbnail, pushes
and highlights, end card), builds the Apple Loops bed, ducks and masters to -14 LUFS, muxes, exports the
proof frames and prints the automatic metrics. Re-cutting the picture only: `REUSE_VO=1` keeps the voice.

## 5. Review and hand over

- Look at every proof frame (and a few between them). Things that have gone wrong: a loading skeleton,
  a zoom that shows an unsourced figure, a subtitle orphan (join tokens with a no-break space).
- Speech check without ears: `faster-whisper` small.en on the final file must return the script.
- Write `quality-report.md` (automatic table + Q11, Q12, Q14-Q16), `script.md`, `sources.md`.
- Commit the day folder and any tool fixes; report the path to the main session. Do not upload.

## Metadata template

Title (<= 70 chars): `AI stocks today: <story 1>, <story 2> | <Mon D>`.
Description: two plain sentences with the verified figures, one line on the demo account,
"Demo portfolio. Not financial advice.", `https://apps.apple.com/app/id6811739789`,
`https://hodlerss.github.io/assetly/about.html`. Hashtags: `#Shorts #AIstocks #stockmarket` plus the
day's companies. Thumbnail: frame 0 (the title card is drawn fully from the first frame).
