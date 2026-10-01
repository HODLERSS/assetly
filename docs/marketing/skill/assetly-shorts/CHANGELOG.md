# Changelog

## v1.0.2 (2026-10-01, owner changes after the morning Shorts)

- Second person: the narration says "Your portfolio" (eyebrow YOUR PORTFOLIO); first person in any spoken line, title or
  description is refused. The typed Ask question stays in the user's words.
- The Ask answer comes from the recording: testGshort waits for the real answer (not "Still thinking..."; the 7:32 Short
  showed the dots), holds 7.5 s and logs each text's frame; the storyline quotes one numbered, visible answer line (same
  figures, close wording) and the edit outlines that line (`highlight.src_box`) and pushes to it. Q32 checks all three
  on the final frames by OCR. facts --ask retakes when no answer line is visible.
- Voice and screen agree: `screen.py` reads every beat's window of the take (Vision OCR) and re-quotes extended-hours
  moves on both feeds. A spoken figure must be readable in its shot, or be a fresh (<= 15 min before the take ends)
  pre-market / after-hours move said with its label word, which compose draws on a labelled chip ("PRE-MARKET · 8:47 AM
  ET / IBM +5.8%", the Short's own overlay, never app UI) for that beat. Q33 checks every beat on the final frames.
- Repo: make-short.sh passes a beat's `chip` to make-spot.py as a timed overlay (`start`/`end` on an overlay png).

## v1.0.1 (2026-10-01, after the 7:32 AM preopen refused at the storyline)

- Acronyms: names said as letters or as a word (IBM, NASA, AMD, AI, ETF, CEO, FDA, SEC, NVIDIA, AT&T, HP; Fed is not
  caps) pass; the ticker rule now refuses only a ticker of a candidate/held company and names the company to say.
  narrate/ear.ts exports `SPOKEN_CAPS` (earAudit allowlist) and reads "AT and T"; storyline mirrors it. The prompt
  gives "IBM" (not "International Business Machines") as the name to say.
- "Words the sources never say" covers claim-carrying content only: a named entity no source names fails alone;
  generic attributed-reaction words (liked, welcomed, cheered, credit, purchase, deal...) are free.
- Convergence: every problem is an explicit rewrite instruction ("-> shorten item 2 ... first", "-> write 'Rocket
  Lab' instead"); up to 8 rounds inside a 6-minute cap; the best draft (fewest problems) feeds the fallback.
- Fallback: failing items told with their verified WHY / READ, trimmed at clause boundaries until the 56-word budget
  and 15-word sentences fit; the edition's timing phrase leads item 1 when no timing word is spoken ("Premarket," /
  "Midday," / "Today," when the long phrase does not fit); portfolio and Ask lines fall back to templates from the
  cross-checked figures. Close edition's timing words now include "at the close".
- Runtime: the pre-open "today" wording in the Ask answer no longer forces retakes (it cost ~11 of the 31 minutes on
  10/1 and never cleared); jargon still does.
- Spoken length: the storyline also counts words as voiced by speakable() (question included), max 68 ("5.8%" is four
  words); 73 voiced words built a 30.3 s Short that the build refused. 66-68 made 26-27 s.
- Q28: a compound heard split ("premarket" -> "pre market", "rollout" -> "roll out") and a brand that starts with a
  number word heard as the figure ("Tencent" -> "$0.10") are not misreads. The manual preopen at 8:31 refused on the
  second one.
- Timing words (premarket, overnight, futures, yesterday...) and "cite" are free in the source-wording check.
- Validated on the refused 7:32 work dir: `run.sh preopen --test --work ... --from story` storyline 2 rounds (29 s),
  build + QA 31/31, delivered to shorts/2026-10-01-preopen-test4 (exit 0 after 328 s). A close work dir converges in
  3-5 rounds (51-85 s); forced fallback passes at 55-56 words.

## v1.0 (2026-09-30, revised the same night)

Writing quality (main-session review of preopen-test3, 10/1 5 AM; validated on the saved preopen-test3 and close-test5
work dirs at the storyline stage, no full run):
- storyline rejects a second sentence that only restates the first (a second "shares rose" line, or nothing new).
- "swing factor", "narrative", "cost curve" banned in spoken/subtitled lines (the model rewrites them plainly).
- The on-screen Ask answer is scanned for desk jargon and, before the open, a "today" that is really the previous
  session; takes 1-2 retake on these, take 3 keeps them if every figure verifies (so the 7:32 run cannot be refused
  for wording alone).

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
