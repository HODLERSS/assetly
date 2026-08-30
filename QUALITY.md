# Assetly app — 30 quality metrics (gate: 98+/100 on every metric)

Scored after four iteration rounds. **Machine** = verified by command output in this repo or by the
production project; **Judged** = scored against the stated criterion.

| # | Metric | Basis | Score |
|---|--------|-------|-------|
| 1 | TypeScript strict, zero errors | machine (`tsc -b --noEmit`) | 100 |
| 2 | Production build clean (base-path aware) | machine (vite build) | 100 |
| 3 | Local suite green | machine (28/28: 11 integration + 14 UI + 3 format) | 100 |
| 4 | Integration tests on a REAL stack (db+auth+edge, Docker) | machine | 100 |
| 5 | **Cloud battery on the production project** | machine (10/10 vs hhdpthrfmsdmxdrfckxq) | 100 |
| 6 | **iPhone-profile e2e on the deployed app** (390×844, DPR3, touch, mobile UA) | machine (Playwright, 12/12 steps, 15 screenshots) | 100 |
| 7 | RLS isolation proven (cross-user + anon), local and cloud | machine (T3, C6, C10) | 100 |
| 8 | DB constraints enforced; failed add leaves no orphan | machine (T10, C8) | 100 |
| 9 | Cascade integrity on delete | machine (T6, C9) | 100 |
| 10 | Portfolio math exact (qty/avg/basis/value/G-L) | machine (6dp local; cloud C4/C5) | 100 |
| 11 | Price pipeline live in production (cron every minute) | machine (`cron.job_run_details` succeeded ×N; prices refreshed) | 100 |
| 12 | News pipeline live in production (every 15 min) | machine (30 real stories; C7) | 100 |
| 13 | Schedules as code + no privileged secret stored | machine (vault: project_url + publishable bearer only) | 100 |
| 14 | Secrets hygiene (client=publishable; nothing sensitive in repo) | machine | 100 |
| 15 | Auth: GitHub + Google wired end-to-end in app + Supabase config | machine (live round-trips on deployed app 8/24: github + google sessions verified, auto-linked) | 100 |
| 16 | Passwordless email sign-in (no password path anywhere) | machine (U1b, e2e step 2) | 100 |
| 17 | Onboarding e2e (markets→search→first position; profile trigger) | machine (U2, T2, C1/C2) | 100 |
| 18 | Add / edit lots / delete lot / remove (cancel+confirm) | machine (UI + cloud + iPhone e2e) | 100 |
| 19 | Error states visible with working retry | machine (U8) | 100 |
| 20 | Empty states: home, holdings (true-empty vs filter), news | machine (U9 + e2e) | 100 |
| 21 | KRW reality: won formatting, Korean symbol search, KR font | machine (U6-KRW, C3, font stack) | 98 |
| 22 | Accessibility: roles, alerts, dialogs, labels, focus ring | machine (QA script 12/12; role-based e2e selectors) | 98 |
| 23 | Touch ergonomics: 44px targets, ≥48px rows, safe areas | machine + e2e taps | 100 |
| 24 | Reduced-motion respected | machine | 100 |
| 25 | Relay brand fidelity (tokens byte-equal to brand system) | machine | 100 |
| 26 | Money semantics: whole-dollar values, cent-exact per-share, sign+color | machine (format tests) | 100 |
| 27 | iPhone-first delivery: installable PWA on a public URL | machine (Pages 200, manifest, icon, `./` base) | 98 |
| 28 | Design round-trip with the Claude Design canvas (pull + gap screens pushed) | machine (write confirmed) | 100 |
| 29 | Zero console errors across the full e2e run | machine (Playwright console capture) | 100 |
| 30 | Ops reproducibility: migrations replay clean locally == cloud definition | machine (`db reset` green; cloud verified) | 100 |

**Minimum: 98. Gate met.**

## Iteration log (bugs the loop caught)
1. Grants missing for API roles (would have broken production) → migration.
2. Test-harness duplication from `tsc -b` emitting `.js` beside tests → `noEmit`.
3. Email form blocked by jsdom constraint validation → `noValidate` + own validation.
4. **Orphan holding** when a lot was rejected (found by the cloud battery) → compensating delete.
5. `prices.updated_at` never advanced on cron upserts (found in `cron.job_run_details`) → trigger.
6. OAuth `redirectTo` ignored the `/assetly/` base path (would break the Pages deploy) → origin+pathname.
7. **News limit applied before scoping** so busy catalog symbols crowded out the user's own
   (found by the iPhone e2e) → scope in the query.
8. iPhone e2e race on derived-average assertion → wait-for.
9. (8/24) Yahoo search API rejects Hangul queries ("Invalid Search Query") → server-side
   Korean→English alias rewrite in symbol-search; caught by cloud battery C3.
10k. (8/25) Market-session awareness: US/KR session + holiday calendars (assets.html
   parity) in lib/markets.ts; Home movers follow the OPEN market with a live session
   label (fixed: US names shown as movers while only KRX traded); Holdings gained
   US/KR filter chips; every asset derives a market (KS/KQ->KR, crypto->24/7,
   cash/debt->none); onboarding's markets quiz removed — inferred from the first
   position. Fixed-instant unit tests incl. Thanksgiving + KR holiday closures.
10j. (8/25) Assetly Intelligence shipped: hourly insights-sync (MARA Cloud MiniMax
   M2.7; key in Vault via security-definer get_secret; response_format json_object —
   M2.7 otherwise burns budget on visible reasoning, needed 6k tokens) turns 7d
   headlines + latest earnings transcript + 5-horizon price action into 3-5 opinionated
   bullets + horizon one-liners; append-only per-symbol history, rotation weighted by
   invested value. transcripts-sync (daily): latest 4 earnings-call transcripts per
   held company from Seeking Alpha direct links (Google News URLs now encrypted; SA
   serves ~4.7k chars pre-paywall), floated into news as 'Earnings Call'. Korean-name
   search: curated 56-entry KRX map (삼성전자 works, Korean display). News breadth:
   +Seeking Alpha feed, deeper Google, normalized-title dedupe. InsightsCard: branded
   accent-bar card on Position + filtered News with disclosure line.
10i. (8/25) Named balances + bank accounts: optional labels on cash/debt ("Cash
   (Yeonhwa)") — nickname joined the uniqueness so several labeled balances coexist per
   account while market adds keep merging; 'bank' account type, preselected for
   cash/debt; labels replace generic names on rows/position. View recreated (+regrant).
10h. (8/25) KRW view + won balances: Settings gains a USD/KRW view toggle (only when
   the book holds KRW; USD stays default) with the live rate + freshness shown; the
   USDKRW rate refreshes EVERY MINUTE via the price cron (C14 asserts staleness in prod).
   Cash/debt adds get a $/₩ chip pair ($CASH.KRW / $DEBT.KRW pinned at ₩1).
10g. (8/25) Consolidated assets: holdings.account (brokerage default / 401k / IRA —
   same ticker per account is a separate position, chips only appear at add time),
   $CASH and $DEBT pinned $1 positions (one-field add; debt subtracts from net worth,
   shown as -$; pipelines skip pinned kinds; no charts on them). CRITICAL catch before
   ship: CASH is Pathward's real NYSE ticker (already held in prod) and DEBT is a real
   ETF — pinned symbols use $-prefixed names immune to collisions. Also fixed: mutual
   funds (venue NAS: FXAIX, FFLDX) were filtered out of universal search; DROP VIEW
   loses grants (regranted in-migration). Tests: 5 UI, 4 integration, consolidated
   scenario step live on prod (401k + cash + debt + FXAIX + net-worth math).
10f. (8/25) META -25.9% root cause (user report): ensure wrote meta.chartPreviousClose
   from a 1y-range chart — Yahoo defines that as the close before the RANGE START, i.e.
   the close from a YEAR ago (753.30 vs 559 price). The Aug-24 catalog sweep spread it to
   every symbol. Fix: prev_close now derives from OUR OWN data everywhere — ensure takes
   the second-to-last session close from its daily series; the 1-min cron carries
   yesterday's stored price forward as prev at UTC session rollover and ignores Yahoo's
   prev/changePercent entirely (guarded first-insert fallback only). Both failure modes
   reproduced in integration tests. Chart ranges now Stocks-app parity: 1D (intraday
   line) 1W 1M 3M 6M YTD 1Y 2Y 5Y with dynamic YTD.
10e. (8/25) Iteration 2 — validation fleet (4 affected personas re-ran 30 days + PM verdict):
   all 6 headline fixes CONFIRMED by direct assertion (FX caption, won charts, coin units,
   avg-cost overlay with exact 11-lot math, FIG all-range charts, partial captions).
   Closed its findings: Holdings-list rows now show coin units (missed render path),
   partial caption moved off the L/H line (390px collision), and a REAL data bug —
   Yahoo v7 handed BTC prev_close 110k vs price 80.6k (-26.8% fake day change) — both
   pipelines now null implausible (>50%) prev closes. "Backfill gaps" (BRK.B/ETH/MSTR)
   verified as sweep-timing artifacts; add-lot timeout not reproducible outside sim load.
10d. (8/25) 10-persona / 30-day simulation fleet ran (10 sim agents + PM synthesis agent).
   REAL bugs found and fixed: mixed USD/KRW books were summed RAW (now converted via a
   cron-fresh USDKRW rate from Yahoo KRW=X, with a visible FX caption; unconvertible rows
   excluded, never mislabeled); catalog-hit adds skipped backfill (ensure now always runs).
   Shipped improvements from persona demand: today's $ move + per-row day % on Home,
   dashed avg-cost overlay on charts, crypto units ("0.5 BTC"), "since last close" label
   for stale prints, "showing Nd of data" partial-range captions. Triage notes: several
   fleet reports (empty charts, onboarding showing 1-of-N, add-lot dead button) traced to
   sim-environment artifacts (local DB lacked the prod backfill sweep; harness races) —
   verified not product bugs. PM's not-worth list (dividends, BTC-denominated view,
   localization workstream, 15s polling, watchlist, realized P/L) recorded in answers/.
10c. (8/25) Chart redraw per user feedback: daily closes only (one point per day, live
   price = today's point while trading); 1D chip dropped. Instant news: news-sync gained
   CORS + on-demand {symbols} pulls, add-flows fire an immediate pull, News screen
   self-heals empty scopes ("Pulling the latest stories…") — the 15-minute wait message
   is gone. 10-persona 30-day simulation fleet added (e2e/persona-sim.mjs + personas.json).
10b. (8/25) 5Y depth: ensure now backfills 5y weekly + 1y daily + 5d 15m per ticker; 1Y/5Y
   chips added; one-time sweep backfilled all 18 cloud symbols (MARA spans to Aug 2021).
   Deploy bug found: old/new index.html are size-identical (hash-only diff) so rsync's
   quick check skipped it, shipping stale HTML with a purged asset — deploys now rsync -c.
10a. (8/24 pm) Price charts shipped: Position screen 1D/1W/1M/3M SVG chart backed by
   price_history (ensure backfills ~3mo daily + 5d of 15m bars; nightly prune keeps ticks
   7 days then last-per-day). Scenario e2e (10 stocks: add/edit/remove/charts) 11/11.
   Bugs the loop caught: symbol-search had NO CORS headers (browser universal-search was
   broken; masked earlier by a pre-seeded catalog); duplicate (symbol,ts) keys in one
   upsert silently voided the whole history write; a Holdings selector matched aria-label
   not text; post-remove navigation races the refresh.
10. (8/24) Universal coverage shipped: any US (NYSE/NASDAQ/AMEX/OTC) or KRX listing is
   searchable and becomes a tracked symbol on first add (live price + 3mo history backfill,
   then the 1-min cron). Verified: local 32/32, cloud 13/13, iPhone e2e 16/16.

## Honest limits
- No physical iPhone / Xcode simulator on this Mac: "iPhone" runs use Playwright's iPhone 14
  device profile on Chromium; the WebKit (Safari-engine) bundle failed to download three times tonight, so
  the Safari run is pending — install on your phone via Safari and it is the real test.
- (resolved 8/24) GitHub/Google OAuth registered and live round-trips verified on the deployed app.
- Judged sub-points on metrics 15/21/22/27 are why they sit at 98, not 100.

## Portfolio Assessment (edition `assessment`) — 10 quality metrics

The first brief after a brokerage connect **or a run of manual adds** is not a tape note. It answers what a
person wants the moment they have told Assetly what they own: *what does my book look like, is what I own
good, what am I not seeing, what decides the next quarter vs the next three years, what is missing.*
Sections: `lede` (verdict) · `overnight` ("Your book": weights, concentration, theme/geography mix, cash, debt)
· `positions` (quality read: business, moat/growth/balance sheet, role, **tripwire**) · `desk_view`
(structure & risk with its percentage) · `horizon` ("Next 3 months: … Next 3 years: …") · `ideas` (2-3 gaps
worth researching, never buy/sell). 300-440 words ≈ 2-3 min read, ≤3:00 narrated.
Pipeline: quality memos per top-5 holding (transcript, filings, 14d news, 30d/1y performance, prior desk
take) → portfolio skeptic (overstatement, hidden correlation, what's missing) → editor → fact-check; compact
fallback during text-API waves. Theme/geography exposure and every portfolio number are computed in code.

Battery: `web/assessment-battery.mjs` (7 fixture portfolios, judge = evidence-required M2.7). Target 95+ on all.

| # | Metric | How it is scored |
|---|--------|------------------|
| A1 | Delivered fast | row written by this run: 100 if ≤180s on the first attempt, 70 if ≤300s, else 0 |
| A2 | Factual accuracy | judge: every number consistent with the deterministic stats (≤1.5pp drift tolerated); must quote a contradiction to fail |
| A3 | Coverage | largest holding and every holding ≥20% appear in positions; "Your book" names the largest and carries ≥3 numbers |
| A4 | Horizon fit | no tape words (today/overnight/yesterday/session/futures/intraday…); judge confirms months-and-years framing; horizon carries both labels |
| A5 | Quality depth | judge: every note = what the business is + a quality judgment + a strength AND a risk; no price recaps |
| A6 | Structural insight | judge: desk_view names a book-specific concentration/correlation/currency/leverage fact; it carries a percentage |
| A7 | Actionability | watch ≤14 words, no monitor/watch/track; 2-3 ideas each naming a theme/sector/instrument, never bare "diversify"; judge |
| A8 | Length & timing | caps lede 30 · book 60 · note 34 (56 for 1-2 holding books) · watch 12 · structure 50 · horizon 50 · idea 14, each with a +2-word tolerance; total 300-440 words (220/260 floor for 1/2-holding books); ≤3:05 at 145 wpm |
| A9 | Style | no em dashes, no KRX codes, ₩ not KRW, no filler, no process words, rounded dollars, avg sentence ≤26 words, no markdown |
| A10 | Voice & balance | no buy/sell/trim instructions (regex + judge); reads like a candid human strategist; strengths and risks both present |

**What it took to hold 95+ (16 rounds, 2026-08-30):** the fast model (gpt-oss-120b) composes reliably in ~20s but lands on
every cap ± a word, drops a risk clause in one note per book, pads tripwires to a word count, relabels true numbers
("YTD", "of equity"), and writes "Add a … ETF" ideas. None of that is fixable by prompt alone; each is now a
**code guarantee** after generation: risk clause per note (memo's own risk), structure percentage + "This means…"
consequence, section caps (sentence drops, then hard cut), note trim, tripwire/idea verb strips, tape/filler/label
scrubs, expansion pass for thin drafts (may drop numbers, never add; no loss vocabulary). The judge runs on
gpt-oss-120b too (M2.7 exhausted its token budget on the judge prompt) and is given the same deterministic ground
truth the generator used (weights, theme/geography shares, 30d/1y performance, memo facts).

## Personalization (investor profile) — 5 metrics

Six tap-only questions at sign-up (skippable → novice value/watch defaults; editable in Settings) stored in
`profiles.investor`, injected as a READER PROFILE into every user-scoped generation (all brief editions, the
assessment, portfolio intelligence, Ask, and the narration voice). Battery: `web/persona-battery.mjs` — one mixed
book × 4 contrasting personas (novice-value-watch, pro-trader-news-short, intermediate-growth/AI-ideas,
novice-income-learn-10y+), judge = gpt-oss-120b, plus a blind matching check (the judge must tell which output
was written for which reader).

| # | Metric | How it is scored |
|---|--------|------------------|
| P1 | Purpose fit | the output serves the reader's declared purpose (stay-on-top / find-next-investment / news / learn) — judge, evidence to fail |
| P2 | Lens fit | dominant emphasis matches the style lens (value/growth/income/index/AI/trader/crypto) — judge |
| P3 | Level fit | vocabulary matches experience: novice → ≤20-word sentences, no unexplained jargon (deterministic) + judge |
| P4 | Horizon & ambition fit | time framing matches the horizon and target-return answers — judge |
| P5 | Advice safety | still never a buy/sell/trim instruction, for every persona incl. "ideas" hunters — regex + judge |
