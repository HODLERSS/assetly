---
name: assetly-shorts
description: Make, update, test or schedule Assetly's YouTube market Shorts (the 9:16 daily market videos with real app footage, two-voice commentary, the Ask feature on camera and the portfolio's numbers). Use when asked to make/build/run/refresh an Assetly Short, a pre-open / midday / close market video, the daily Short, or to change how those videos are researched, fact-checked, edited or scheduled. Three editions per US trading day; never uploads.
---

# Assetly market Shorts, v1.0

Three Shorts per US trading day, each 20-30 s (hard max 30.0), built from scratch every run:

| Edition | Ready by | Covers | App brief | Ask on camera (default) |
|---|---|---|---|---|
| `preopen` | 9:00 AM ET (8:00 CT) | overnight futures, premarket movers and why, today's calendar (data, Fed, earnings) | Morning Brief | "What's ahead for my portfolio today?" (no "should": a Q13 word) |
| `midday` | 1:00 PM ET (12:00 CT) | what is moving so far and why | Midday Pulse | "What's moving my portfolio today?" |
| `close` | ~4:20 PM ET | the session's movers and why, a big after-the-bell report | Closing Note | "How did I do this week and this month?" |

Weekends and US market holidays: skip (the app's own calendar, `supabase/functions/_shared/calendar.ts`).

## One command

```bash
~/.claude/skills/assetly-shorts/scripts/run.sh close                # today's close edition
~/.claude/skills/assetly-shorts/scripts/run.sh preopen --date 2026-10-01 --test --seed 4
~/.claude/skills/assetly-shorts/scripts/run.sh close --work /tmp/assetly-shorts/<run> --from story   # resume at a stage
~/.claude/skills/assetly-shorts/scripts/run.sh close --upload        # + private upload after the gate passes (never with --test)
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
| research | `research.py` | MARA MiniMax-M3 (OpenRouter fallback) ranks 6 items: cover, WHY, attributed READ, cited headline ids | two quote feeds agree (CNBC + Nasdaq; extended hours on both); >= 2 independent sources (two publishers, two headlines) for WHY and READ; direction and strength words vs the feeds; a judge call re-reads the cited headlines and must confirm; one repair round; < 3 items = refuse |
| book | `design_book.py` | - | ~$150-300k; story names held (a falling story small); AI leaders; hot names; cost inside each 52-week range; leans positive only when the day's real moves allow |
| account | `account.py` | - | seeds `minjae.m.lee+daily0NN` ("My portfolio"; close 11, preopen 12, midday 13) through the real pipeline; checks the brief for jargon / edition-wrong words / "demo" and regenerates up to twice |
| facts | `facts.py` | - | every portfolio figure the app shows recomputed from Nasdaq; disagreement drops it; 7/30-day windows from app history and Nasdaq history |
| record | `record.py` | - | `testGshort` on the skill's own simulator: Home, brief, each story holding (1D; 1W pre-open), News, Ask typed and answered; wall-clock marks aligned to the display recording by fitting every tap to its screen change |
| ask | `facts.py --ask` | - | every figure in the on-screen answer must match a cross-checked figure, else one more take, else refuse |
| story | `storyline.py` | OpenRouter (Claude Sonnet 5.5; M3 fallback; `SHORTS_STORY_MODEL=mara` flips it) writes cover, item lines (why, then read), the portfolio line, the Ask line, title, description | figures only from the verified set; Q13 words + tape/book/print/demo; no tickers of candidate/held names (names said as letters, IBM / NASA / AMD, are fine); claim-carrying words traceable to sources (reaction words free); edition timing words; <= 15 words a sentence; <= 56 spoken words; up to 8 rounds of explicit rewrite instructions inside 6 min, then a verified-wording fallback that fits the budget and leads with the edition's timing phrase, then refuse |
| compose | `compose.py` | - | voices: items marin/cedar alternating, portfolio + answer in the app's brief voice (Minjae clone), the question in gpt-audio; beats from the marks; one push on every beat |
| build | repo `web/ios/App/marketing/shorts/make-short.sh` | - | speakable() + earAudit() on every line; voices, word-synced subtitles with story eyebrows, speaking pills, Apple Loops bed, duck, -14 LUFS / <= -1.5 dBTP, proof frames, Q1-Q19 |
| qa | `qa_deliver.py` | - | Q21-Q30 (references/quality.md), writes the report and the sources, delivers or refuses |

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
