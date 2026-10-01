# Changelog

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
