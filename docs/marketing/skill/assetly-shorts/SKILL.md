---
name: assetly-shorts
description: Make, update, test or schedule Assetly's YouTube market Shorts (the 9:16 daily market videos with real app footage, commentary in Minjae's voice, the Ask feature on camera and the portfolio's numbers). Use when asked to make/build/run/refresh an Assetly Short, a pre-open / midday / close market video, the daily Short, or to change how those videos are researched, fact-checked, edited or scheduled. Three editions per US trading day plus three Korea AI-chip editions per KRX trading day (korea-open, korea-midday, korea-close); uploads only with --upload (YouTube private; TikTok via API or the queue).
---

# Assetly market Shorts, v1.2.0

Three Shorts per US trading day, each 20-30 s (hard max 30.0), built from scratch every run:

| Edition | Ready by | Covers | App brief | Ask on camera (default) |
|---|---|---|---|---|
| `preopen` | 9:00 AM ET (8:00 CT) | overnight futures, premarket movers and why, today's calendar (data, Fed, earnings) | Morning Brief | "What's ahead for my portfolio today?" (no "should": a Q13 word) |
| `midday` | 1:00 PM ET (12:00 CT) | what is moving so far and why | Midday Pulse | "What's moving my portfolio today?" |
| `close` | ~4:20 PM ET | the session's movers and why, a big after-the-bell report | Closing Note | "How did I do this week and this month?" |

Weekends and US market holidays: skip (the app's own calendar, `supabase/functions/_shared/calendar.ts`).

**Korea editions (v1.1.0, owner 10/1; korea-midday v1.2.0):** three more Shorts per KRX trading day for US investors with AI-heavy portfolios,
mid-to-long term (never day to day): Korea's AI-chip names (SK hynix, Samsung Electronics, Hanmi Semiconductor and peers)
and the US chip names they move with (Micron, Nvidia ...).

| Edition | Ready by | Covers | App brief | Pages on | Ask on camera |
|---|---|---|---|---|---|
| `korea-open` | ~8:00 PM CT (9:32 AM KST start, the evening before the US session) | the past-month move of Korea's AI-chip names and why, the session so far in Seoul, the read-through for US chip names as context | kr_open | 1M | "How exposed is my portfolio to memory chips?" |
| `korea-midday` | ~10:20 PM CT (12:00 PM KST start, the KRX session half done) | how the names stand this year and why, how they trade so far in Seoul, the read-through for US chip names (mid/long term) | kr_open (the app has no midday Korea brief; kr_open is the live one) | YTD | "How much of my portfolio is in Korean stocks?" |
| `korea-close` | ~2:10 AM CT (3:45 PM KST start, read in the US morning) | the long view: three-month trend and why, dated upcoming events, what it means for an AI-heavy portfolio's concentration | kr_close | 3M | "What's my AI chip concentration?" |

Accounts `minjae.m.lee+daily015` (korea-open), `+daily017` (korea-midday) and `+daily016` (korea-close), same funnel exclusion. KRX holidays skip
(the KR calendar). Quotes: Yahoo (the app's source) + Daum's KRX official days (`scripts/kr.py`; Naver is not a KRX feed in
the evening: Nextrade after-market); a live KRX quote counts only when its bar is inside today's session (v1.2.0
stale-session guard: Yahoo lags ~20 min, and before the first bar range=1d still serves yesterday; facts withholds a day move
the app's calendar.ts places in an earlier session); windows on both histories; won at the app's USDKRW and CNBC's KRW=. No "today"
portfolio figure (Home's Today mixes US and KRX sessions): the portfolio line is the all-time gain. Times and the DST-proof
launchd setup: `references/schedule.md`.

## One command

```bash
~/.claude/skills/assetly-shorts/scripts/run.sh close                # today's close edition
~/.claude/skills/assetly-shorts/scripts/run.sh preopen --date 2026-10-01 --test --seed 4
~/.claude/skills/assetly-shorts/scripts/run.sh close --work /tmp/assetly-shorts/<run> --from story   # resume at a stage
~/.claude/skills/assetly-shorts/scripts/run.sh close --upload        # + private upload after the gate passes (never with --test)
~/.claude/skills/assetly-shorts/scripts/run.sh korea-close --date 2026-10-01 --test   # a Korea edition (date = the KST session)
```

Every frame carries the data time-stamp in the top-left corner (edition eyebrow over "Sep 30 · 4:05 PM ET": the time the
quotes were captured, not the render time), and the YouTube description opens with "Data as of <date> <time> ET".
`--upload` hands the `-upload.mp4` and `youtube-metadata.json` to `app/scripts/youtube/upload.py` (PRIVATE; the owner
publishes). The Google app is in Testing, so its refresh token lasts 7 days: an auth failure prints the fix
(`python3 app/scripts/youtube/auth.py`) and exits 3 with the Short still delivered.

Delivers to `app/docs/marketing/shorts/<date>-<edition>/` (`-test<k>` for `--test`): the master mp4, the
`-upload.mp4` copy (<= 9.9 MB, SSIM >= 0.995), `youtube-metadata.json` (+ `.md`), `sources.md`, `quality-report.md`
(every metric + latency per stage), `script.md`, `day.json`, `book.json`, `research.json`, `proof/`, `voice/`,
`asr-transcript.txt`. **It refuses (exit 1, nothing copied to docs/) if any automatic metric fails.** Upload is opt-in (`--upload`,
private only) and the main session decides when the schedule turns it on.

## The stages (scripts/)

| Stage | Script | Judgment (LLM) | Hard checks (code) |
|---|---|---|---|
| research | `research.py` (+ `kr_news.py` for Korea) | MARA MiniMax-M3 (OpenRouter fallback) ranks 6 items: cover, WHY, attributed READ, cited headline ids | two quote feeds agree (CNBC + Nasdaq; extended hours on both); >= 2 independent sources (two publishers, two headlines) for WHY and READ (Korea: Google News + Korean newsrooms and Naver Finance under the ORIGINAL publisher, a Yonhap reprint counts once); direction and strength words vs the feeds; a judge call re-reads the cited headlines and must confirm; one repair round; < 3 items = refuse |
| book | `design_book.py` | - | ~$150-300k; story names held (a falling story small); AI leaders; hot names; cost inside each 52-week range; leans positive only when the day's real moves allow |
| account | `account.py` | - | seeds `minjae.m.lee+daily0NN` ("My portfolio"; close 11, preopen 12, midday 13) through the real pipeline; checks the brief for jargon / edition-wrong words / "demo" and regenerates up to twice |
| facts | `facts.py` | - | every portfolio figure the app shows recomputed from Nasdaq; disagreement drops it; 7/30-day windows from app history and Nasdaq history |
| record | `record.py` | - | `testGshort` on the skill's own simulator: Home, brief, each story holding (1D; 1W pre-open), News, Ask typed and answered; wall-clock marks aligned to the display recording by fitting every tap to its screen change |
| ask | `facts.py --ask` | - | every figure in the on-screen answer must match a cross-checked figure, else one more take, else refuse |
| screen | `screen.py` | - | Vision OCR of the take over each beat's window (`screen.json`: what the viewer can read); fresh two-feed extended-hours quotes for chips (`ext.json`, <= 15 min before the take ends) |
| story | `storyline.py` | OpenRouter (Claude Sonnet 5.5; M3 fallback; `SHORTS_STORY_MODEL=mara` flips it) writes cover, item lines (why, then read), the portfolio line ("Your portfolio"), the Ask line (quoting one numbered, visible answer line), title, description | figures only from the verified set; Q13 words + tape/book/print/demo; no tickers of candidate/held names (names said as letters, IBM / NASA / AMD, are fine); claim-carrying words traceable to sources (reaction words free); edition timing words; <= 15 words a sentence; <= 56 spoken words; up to 8 rounds of explicit rewrite instructions inside 6 min, every spoken figure readable in its shot (the app's screen per `screen.json`, or a fresh pre-market / after-hours quote said with its label word, shown on a chip); no first person; then a verified-wording fallback that fits the budget and leads with the edition's timing phrase, then refuse |
| compose | `compose.py` | - | the labelled PRE-MARKET / AFTER HOURS chip (the Short's own overlay, value + quote time, top-right corner block like the stamp) on any beat whose line says it; the quoted answer line outlined (`highlight.src_box` from the UI test's element frames) and pushed to; voices (owner, 10/1): EVERY line in the app's brief voice (the Minjae ElevenLabs clone; voice-lines.py `SHORTS_VOICE=minjae`, the default), OpenRouter gpt-audio marin/cedar only as the per-line backup when ElevenLabs fails (`SHORTS_VOICE=mixed` restores the old marin/cedar items + gpt-audio question); tempo 1.06 on every line (1.12 only in mixed); beats from the marks; one push on every beat |
| build | repo `web/ios/App/marketing/shorts/make-short.sh` | - | speakable() + earAudit() on every line; voices, word-synced subtitles with story eyebrows, speaking pills, Apple Loops bed, duck, -14 LUFS / <= -1.5 dBTP, proof frames, Q1-Q19 |
| qa | `qa_deliver.py` | - | Q21-Q40 (references/quality.md; Q32 answer quoted + visible + outlined, Q33 every spoken figure readable in its beat, Q34 one moment: every time shown <= corner stamp, no live quote in a pre-open Short; Q35 chips / tags in the top-right corner block, clear of the phone; Q38 the cover hero is a verified move read on frame 0 and in its beat; Q39 the end-card follow line; Q40 reach metadata), writes the report and the sources, delivers or refuses |

## What still needs a person (or the agent running the skill)

1. **Look at the proof frames** (`proof/`, one per beat plus the standard seven) before handing over: a zoom on a
   stale intelligence bullet, an unsourced figure in a frame, or an odd answer layout are not all machine-checkable.
2. **Listen once.** Loudness, sync and the Whisper round trip are measured; whether a voice sounds right is not.
3. **Publish.** `--upload` (or the main session) uploads PRIVATE; the owner reviews and publishes.
4. If a run refuses, read `quality-report.md` / `run.log`: re-run from the failing stage (`--from`), or with a
   different `--seed` for a different portfolio.

## References

- `references/craft.md`: the style rules the owner set (from the launch clips and the 9/30 Short reviews).
- `references/quality.md`: the full metric list and what each check reads.
- `references/schedule.md`: start times (America/Chicago), measured latency, the launchd proposal.
- `references/troubleshooting.md`: traps already hit (keys, simulator, Yahoo 429, MARA 502, judge strictness).
- Repo: `docs/marketing/README.md` (launch clip craft), `SHORTS_RUNBOOK.md`, `SHORTS_QUALITY.md`.

## Hard rules

Never print a key (service key via the Supabase CLI into a chmod-600 file; MARA / ElevenLabs / internal token via
Vault `get_secret`; OpenRouter from `~/.private_keys/openrouter.txt`; the YouTube token stays inside upload.py). Upload
only with `--upload`, only private, never a test run; never log into a site. Never
advice language. If sources disagree, drop the figure. Never say or show "demo".

Shorts craft applied (caption size, safe zones, framing, beats; v1.0.7 reach: the cover HERO number = the thumbnail, hook-first
item order, the end-card follow line, title / hashtag / tag rules) and what it deliberately does NOT do (no spoken CTA, no
bait tags, no fewer uploads or re-uploads without the owner): `references/shorts-craft.md`. `thumbnail.png` (frame 0) is
delivered with every Short.

TikTok: every Short is also posted to @assetlyapp (API when a token exists, else the Chrome queue): `references/tiktok.md`.
