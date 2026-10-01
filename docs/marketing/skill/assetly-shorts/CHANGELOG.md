# Changelog

## v1.0 (2026-09-30, revised the same night)

Repeatability (main-session review, 10/1 night): two clean single-invocation runs on frozen code (close --seed 8,
preopen --seed 9), both exit 0, 31/31. Fixes found on the way:
- run.sh executes a frozen copy of the scripts (editing the skill mid-run had broken a run); prints "exit N after Ss".
- Q30 split into Q30 (stamp present, same spot, every sampled frame) and Q31 (= snapshot within 5 min, label right).
- Ask verification: window anchors on the market date, the wall date and the last session; per-holding window dollars;
  shown-precision tolerance ("+31%"); dividends from Nasdaq x shares; company figures on two publishers (headlines +
  the app's stored news); up to three takes before refusing.
- Research: a second fresh pick before refusing; extended-hours % measured against each feed's own close and matched by
  session (POST_MKT_PREV at night), venue tolerance 0.2 pt pre-open.
- Storyline converges (cover normalised in code, cause rule left to the research judge, neutral read words, 7 rounds).
- Subtitles: a later sentence snaps to the first onset after the previous word; fuzzy whisper alignment instead of
  length timing; Q28 tolerates brand sound-alikes and homophones (week/weak), and a mix-only miss gets one remix with
  a deeper duck. Company names spoken short ("AppLovin", not "AppLovin Corporation").
- Brief scrub: "$208,400 book" -> portfolio, capex -> spending, tripwire -> warning sign (daily-brief, insights-sync
  redeployed, booted).

Owner additions after the first test runs:
- The data time-stamp: top-left corner on every frame (cover, beats, end card), edition eyebrow + "Mon D · h:mm AM/PM ET"
  from the research quote snapshot; description opens with "Data as of ..."; QA Q30 (and Q27 checks the first line).
- `--upload`: private upload through app/scripts/youtube/upload.py after the gate passes, never on --test; a clear fix
  message when the 7-day Testing-mode token has expired. `--dest` rebuilds into an existing delivery folder.

## v1.0 (2026-09-30)

First version of the skill. Owner: Minjae.

- Three editions per US trading day (`run.sh preopen|midday|close`), weekends and holidays skipped by the app's own
  trading calendar; `--test` for off-hours dry runs (`-test<k>` delivery folders).
- Research first, every run: two quote feeds (CNBC quote service + Nasdaq quote API, extended hours on both), the
  Nasdaq earnings and economic calendars, Google News RSS headlines; MARA MiniMax-M3 ranks the items (OpenRouter
  fallback); code + a judge pass keep only claims with two independent sources, figures both feeds agree on, and
  direction / strength words the feeds support; one repair round; < 3 items refuses.
- Portfolio designed before recording ($150-300k, story names held, AI leaders, hot names, cost inside 52-week
  ranges, leans positive only when the real day allows), seeded into `+daily0NN` ("My portfolio") through the real
  pipeline, the edition's brief checked for jargon and regenerated up to twice.
- Portfolio figures cross-checked (app vs Nasdaq recompute), including the windows the Ask feature uses.
- New UI test `testGshort`: Home, the brief, each story holding, News, and Ask typed on camera with the real answer;
  wall-clock marks aligned to the display recording (tap-lag fit), the answer text read off the screen and
  fact-checked (refuse / retake on any unverified figure).
- LLM storyline with code checks (verified figures only, word lists incl. tape/book/print/demo, no tickers, edition
  timing words, sentence and word budgets, the cause in sentence 1, an attributed read in sentence 2, every content
  word traceable to the item's sources).
- Edit: hook cover from frame 0, items on position pages / brief / News, portfolio line over Home in the app's brief
  voice, Ask question + answer, one push on every beat, 0.3 s grid, 20-30 s (hard max 30.0).
- Quality gate Q1-Q29 (SHORTS_QUALITY.md v1.0 section); refuses delivery on any automatic failure; upload copy
  <= 9.9 MB with SSIM >= 0.995; YouTube metadata JSON; sources.md, script.md, quality-report.md with latency.
- Product fix shipped alongside: the brief's plain-English scrub now rewrites tape / thesis / noun "print" / catalyst
  (owner saw "AI buildout thesis held up despite a mixed tape" on a closing card); daily-brief and ask redeployed.
- Repo tooling changes: `record-hero.sh` (paths overridable, ASK_QUESTION, stamped recorder start), `make-short.sh`
  (`len_range`, `slug`), `qa-short.py` (length range, owner words), `voice-lines.py` (450 ms onset snap),
  `seed-daily-demo.mjs` (`--out-of-window`, `--brief-only`, `--no-audio`, `SEED_OUT`).
