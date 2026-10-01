# Changelog

## v1.0.5 (2026-10-01, owner framing review of preopen-v4 + Shorts craft)

- Framing (owner): a bigger phone (860 px body, was 663) whose TOP edge never moves: the push grows it from the top
  (make-spot.py `zoom_anchor: "top"`, `phone_w`), 1.15x (was 1.3x). The old focus-point push moved the phone between
  y 478 and 739, so the gap to the subtitles changed every beat.
- Subtitles end on a fixed row (`SUB_BOTTOM`, y 468), 40 px above the phone, for one, two or three lines; the eyebrow
  sits 16 px above the first line. Type 60 px (was 50), 840 px max width (Shorts caption guidance: 60-75 px).
- Q37: the phone's top on one row in every beat and the subtitle-to-phone gap constant (+-8 px), measured on the final
  frames.
- references/shorts-craft.md: the Shorts guidance applied and what it never overrides.
- A delivered Short whose takes are gone can be re-framed frame by frame (preopen-v5: measure2.py + relayout.py).

## v1.0.4 (2026-10-01, owner review of preopen-v3 highlights)

- The Ask answer beat starts where the recording actually SHOWS the quoted line (compose OCRs the take from the
  ask_answer mark: v3 showed "Still thinking..." for 1.3 s after the mark, with the highlight outlining empty space while
  the voice said the answer). The highlight therefore appears with the text. Q32 now also fails if any sampled frame of
  the answer beat reads "Still thinking". A quoted line that never shows refuses the run.
- The portfolio beat outlines the Home row its line names (All time / Today), same accent box as the Ask answer, and the
  outline switches off before Home scrolls to the movers (make-spot.py `highlight.until`, render-time cut). New Q36.

## v1.0.3 (2026-10-01, owner review of preopen-v3)

- A portfolio figure carries the window Home labels it with: "up 28% all time" over "All time +28.33%" (refused: "up
  28%" under "Today · markets closed"). Storyline check from the Home OCR.
- The direction rule covers the cover, title and description too: no "IBM rallies." when IBM's page shows -0.03% and no
  chip carries the move; before the open without a chip they describe the news. The fallback writes "<Name> in focus."
- News timing needs a source: overnight / this morning / earlier today / yesterday / last night about the news are
  refused unless every cited WHY headline was published inside that window (ET); "Before the bell," (our time) is fine.
  "overnight" and "this morning" no longer satisfy the pre-open timing rule.
- Chips and time tags moved to a top-right corner block that mirrors the data stamp (right-aligned at x 950, y 104-200):
  the "ASK RECORDED" tag had covered the phone's status-bar clock. Q35 refuses any chip / tag that reaches the phone
  (below y 450) or the top texts (left of x 700). Q33 now reads the phone and that corner block (not our subtitles).
- Model fallback: lib.llm tries OpenRouter Sonnet -> SambaNova MiniMax-M3 (key FILE ~/.private_keys/sambanova.txt; the
  shell env key is stale) -> MARA M3, and skips straight to the next provider on 401/402/403 (OpenRouter returned 402
  "exceeds your available credits" ten times in the 10/1 midday storyline).
- Network: lib.get retries network/5xx errors with 2-4-8-16-30 s backoff (a ~1 min DNS blip at 11:13 CT killed a midday
  run after a good take); the take-time facts refresh is non-fatal (keeps the earlier facts with a warning).
- Fallback can no longer refuse on an item its own verified wording fails (10/1: a "20" its shot did not show): the item
  is swapped for the next verified research item until only non-item problems remain.
- Over 30 s (10/1 midday 31.0 s): run.sh rewrites the script on the same take with a smaller budget (50/61, then 46/56
  words written/voiced) and rebuilds, twice max, before refusing. SHORTS_BUDGET / SHORTS_SPOKEN_MAX drive storyline.
- A whole-market line names its index ("The S&P 500 slipped 0.4%"); a bare "Stocks slipped" is refused (it contradicted
  "US stocks today +2.00%" in the Ask on screen).

## v1.0.2 (2026-10-01, after the official midday refused and the owner's review of preopen-v2)

- Direction agrees with the screen: a price direction about a holding (rise / fell / jumped / higher ...) must match the
  day move its page shows in that beat ("Shares rise." over "-0.03% since last close" is refused), unless the sentence
  is the labelled extended-hours move on a chip; negated phrases ("isn't lifting") carry no direction. Before the open
  with no fresh quote the line says the news without a direction, or the close figure on screen. Storyline check + Q33.
- The corner stamp is the latest time anywhere in the Short: the research snapshot, the main take's end, any time the
  app shows in a story beat ("Written at 8:42 AM ET", read by OCR), any chip quote. A beat with its own time tag (an Ask
  re-recorded later) is labelled separately. day.json `stamp.sources`; Q31 checks it, Q34 reads the final frames' times.
- The app's Ask failure message is not an answer (midday 10:40 refused on "Couldn't finish that answer. Please ask
  again in a moment."): facts --ask retakes on it, or when no visible point carries a figure.
- Live drift: a figure Home shows counts as verified when a cross-checked facts figure of the same kind is within the
  live tolerance (0.35 pt / 0.35% of the book mid-session, 0.06 otherwise), so the portfolio line says what the screen
  shows ("Your portfolio is up $3,965 today." where facts had $4,368 minutes earlier). Same for the fallback template.
- "$7B" is one figure in the storyline (was read as "$7").

## v1.0.1 (2026-10-01; the first version the launchd gate allows)

Why: the 7:32 AM pre-open run refused at the storyline after 31 min, and the Short rebuilt by hand that morning showed
"Still thinking..." on its Ask beat while the voice read an answer, and said premarket moves the app screen never showed.

### Storyline convergence (the 7:32 refusal)
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

### Owner changes A and B (voice, screen and moment agree)
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
- One moment per Short: the corner stamp is the latest data time shown (a chip quote later than the research snapshot
  moves it); a pre-open Short shows no live intraday quote; an Ask beat re-recorded later (a rebuild) carries its own
  "ASK RECORDED h:mm AM ET" tag (`ask-take.json` + `takeask.mp4`). Q34.
- Lessons: "Still thinking..." is not an answer (wait for the answer's own foot, and check the final frames, not the
  DOM text); retake only what a retake can fix (jargon, an invisible answer), and log what it cannot (the app's pre-open
  "today" label, a product-side fix).
- run.sh prints the real version (from SKILL.md, frozen with the scripts). The launchd gate
  (`~/.local/bin/assetly-shorts-gate.sh`, references/schedule.md) runs only versions >= ~/.config/assetly-shorts/min_version.

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
