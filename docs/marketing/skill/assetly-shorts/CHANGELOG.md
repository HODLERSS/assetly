# Changelog

## v1.4.0 (2026-10-02, owner: five requests on look, voice, music, research and TikTok)

No core rule was loosened: every spoken figure on screen in its beat, two sources per claim, second person, real footage,
the real Ask answer outlined, never advice, Minjae's voice, 20-30 s, titles <= 50, the 20-minute budget, YouTube private.

- **Korea looks different** ("make korea one a bit different from us one in color"): compose.py sets day.json `accent` /
  `ground` / `theme`; make-short.sh exports `SHORTS_ACCENT` / `SHORTS_BG` and puts them in the plan; make-cards (cover
  kicker, names, rule, end-card follow line and App Store pill), make-fill-subtitles (eyebrows), make-speaking (pills),
  make-spot (canvas, scrim, answer outline) and compose's corner chips / tags read them. US: indigo on slate (unchanged).
  Korea: amber (242,178,76) on a warm ground (29,23,17). Gain green / loss red unchanged.
- **Direct voice** ("instead of saying commentators said this, be more direct"): `lib.ATTRIB` / `attributed()`. Research's
  READ (field `sentiment`) is a fact in our own voice (scale, driver, what it means, what comes next with a date), refused
  when attributed, and the judge rejects an opinion stated as fact. Storyline: the v1.0 check that REQUIRED "Analysts /
  Investors ..." in sentence 2 is inverted (any attributed sentence is refused with a direct-fact rewrite instruction);
  prompt, examples (placeholders, so no example fact is copied), the editor judge and KR_GUIDE rewritten; a pre-v1.4
  attributed READ is handed to the model as null and the fallback never speaks it. **Q44** grades the narration.
- **Music to the last frame** ("Music finishes a bit early ... make it more engaging"): the old bed's stems ended at bar 10
  (24.0 s at 100 BPM), so a 29.7 s Short had 5.7 s with no music; and mix-spot-audio's sidechaincompress dropped the last
  ~0.45 s on top (now padded + trimmed). music-short.json holds one bed per theme with `card` / `end` positions,
  song-phase tiling, an end-card lift, a 1.0 s fade on the last frame, `duck_sc` 1.2 (0.7 gave -5.3 dB on the new beds),
  and a per-stem `af` (Korea's full-mix loop has a speech-band dip; a snare roll into the card was dropped: it masked the
  Ask answer, Q28 "chips -> apps"). The cut grid is the bed's eighth (0.25 s / 0.234 s), the card grows to end the Short
  on a beat, the final mux fade is 0.5 s (was 1.2 s over the bed's 1.6 s). make-spot-music asserts coverage; **Q43**
  grades it. run.sh's duck steps and the Q28 remix moved up to match (1.6 / 2.4, remix 2.0).
- **AI first, front pages, positive first** (research.py): the session's top 10 AI movers are always candidates; CNBC (top
  news, markets, tech), Bloomberg (markets, tech), MarketWatch and Reuters (Google News) front pages give each candidate a
  `front_page` count and join the source pool (names they mention + the 12 newest macro headlines, so the pick prompt stays
  near v1.3 size: 343 headlines cut M3's reply twice); the pick asks for >= 3 of 6 AI items and the positive story when two
  are comparable; verified US items are re-ranked in code (`rank_note`), a 5%+ or front-page drop keeps its place.
  Yahoo Finance's public RSS is stale (newest item Sep 24 on 10/2) and is not used.
- **Script writer = claude -p, no OpenRouter** (owner 10/2: "you shouldn't use openrouter for sonnet"): lib.llm's tiers are
  claude-cli (Sonnet on the owner's subscription, `~/.local/bin/claude -p`, empty temp cwd, HOME/USER/LOGNAME passed so it
  runs under launchd, an empty result = failure) -> MARA M3 -> SambaNova M3 for the storyline and its judge
  (prefer="claude"); research keeps MARA -> SambaNova -> claude. OpenRouter and its 402 afford-retry are removed (the
  gpt-audio backup VOICE in voice-lines.py is separate and unchanged). `python3 lib.py --selftest-llm` forces each tier to
  fail in turn (SHORTS_LLM_FORCE_FAIL) and proves the next answers valid JSON: 6/6 PASS from `env -i HOME PATH`, claude
  2.4-2.7 s, MARA 0.9 s, SambaNova 1.6-1.8 s.
- **Channel plan items** (owner-approved 10/2, answers/channel/20261002_channel_optimization.md section 5): description
  link https://assetly.minjae.co/about.html (Q27 checks it), a searchable second line ("<Company> stock and <Company> stock
  news: <covers>."), "Narration: AI clone of the founder's voice." (description and TikTok caption; Q27), `pin-comment.txt`
  per delivery (two feeds per figure + the newsrooms cited + the data time), `publish-at.txt` per delivery (when to publish,
  which playlist). upload.py: `defaultLanguage` / `defaultAudioLanguage` "en", `--publish-at` (korea-close: private with
  status.publishAt 6:45 AM ET; an unverified API project may keep it private, so the hint file says the time too),
  SHORTS_YT_SYNTHETIC=1 for the synthetic toggle (default off). Playlist auto-add skipped: it needs the broader `youtube`
  scope (the hint names the playlist).
- **Never late on research** (10/2: the 06:20 preopen prestage refused at research, the 06:50 run seeded in full and missed
  7:30 by 3 min): the prestage seeds the book from research's kept items + hot names (or the AI leaders) even when research
  is short; preopen's two premarket feeds agree within a band that scales with the move (>= 0.5 pt / 8% before 8:00 ET,
  0.25 pt / 5% after, same sign always; was a flat 0.2 pt); the second pick sends only headlines about names both feeds agree
  on (newest 140) instead of the whole prompt (MARA cut it at 12,000 tokens twice). The storyline fallback cleans verified
  wording before speaking it (banned words swapped: guidance -> outlook ...; an extended-hours claim with no fresh chip
  loses its premarket / after-hours words and figure), so verified items do not refuse on wording.
- **Ask dollar figures verified at the answer's moment** (10/2 midday refused on "+$9,181" / "$2.8k"; 10/1 close "$2,187",
  midday "$4,069"; each time the 20-minute budget had no room for a retake): facts.py --ask re-derives the portfolio's day
  dollars at take time from the account's holdings x Nasdaq + CNBC (per holding, the book, each bullet's named holdings in
  order; the two feeds must agree per holding), and at the answer's own moment: each shown % (within 1 pt of the live
  feeds) x shares x the previous close both feeds agree on. On the 10/2 midday take: book x 3.79% = $9,182 (shown
  $9,181), AMD 3.7% + Nvidia 2.6% = $2,751 (shown $2.8k): 11/11 verified; a planted "$3.4k" still refuses. Band: 2% or
  $25 plus the shown rounding.
- Schedule (owner 10/2): midday runs 9:00 CT (prestage 8:30), 30 minutes after the open.
- **TikTok by API** ("make sure you can update tiktok too as you do in Youtube"): `app/scripts/tiktok/auth.py` (Login Kit
  for Desktop, hex-S256 PKCE, loopback `http://127.0.0.1:53683/callback/`, token file chmod 600, no secret printed);
  post.py reads TikTok's error codes, falls back to the creator's inbox (`video.upload`) when an unaudited app may not
  Direct Post to a public account, never posts a Short twice, exits 0 / 3 / 4 / 5; `selftest.py` runs both against a
  local mock (ALL PASS). run.sh posts to TikTok even when the YouTube upload fails (the run still exits 3), queues only on
  3 / 4, never on 5 (uploaded, unconfirmed). references/tiktok.md: the owner's one-time setup.

## v1.3.0 (2026-10-01, owner: "make sure you build each clip within 20 minutes max ... this time limit is important")

Every edition (preopen, midday, close, korea-open, korea-close, and korea-midday) delivers within 20 minutes of its run's
start, or refuses. No check was removed or loosened to get there.

- **Hard deadline**: `SHORTS_DEADLINE_S` (1200) from run.sh's start. `scripts/watchdog.sh` stops the run at the deadline
  (never mid-copy to docs/: `delivering` / `delivered` markers), stops every process the run started, frees the simulator
  lock this run held (record.py writes its work dir into the lock), notifies, and run.sh exits 1. Q41 grades the wall time;
  `budget.json` + the quality report carry each stage's budget vs actual; run.log prints `budget: <stage> Ns of Bs · Ls left`.
- **Retries check the clock first** (`room`): another Ask take needs ~595 s (take ~265 + ~330 after it), a storyline or a
  re-tighten ~290 s, a duck rebuild / the Q28 remix ~150 s; otherwise the run refuses at once. The storyline's cap is what
  the budget leaves after compose + build + qa (<= 6 min); lib.llm never waits past the budget; a brief regeneration only
  when the budget holds it.
- **Prestage** (`run.sh <ed> --prestage`, own launchd job ~30 min before the slot; the gate passes `--prestage` and, for
  the Korea editions, waits for the KST start - 30 min): research + book + the account's full seed with every sync, no brief.
  At run time `design_book.py --base` reuses that book when it holds the fresh story names (adds up to two, same sizing
  rules), and the account refreshes prices + news only (`seed-daily-demo.mjs --sync-only <added> --no-brief`); a missing,
  stale (> 120 min), failed or still-running prestage (stopped after 3 min) means the full reset seed, as before.
- **The brief off the critical path**: with a fresh prestage the edition's brief is written at the run's start beside
  research (`account.py --early-brief`, on the prestaged book); if research keeps that book it is the brief the take films,
  otherwise it is rewritten after the add. Either way the check (and a regeneration) runs beside the facts stage
  (`account.py --seed-only` / `--brief-check`).
- **Parallel I/O**: facts' window lookups, Nasdaq quotes and dividends (8 workers); record.align runs the 60 fps encode,
  the saturation probe and the scene scan at once (58 -> ~21 s, identical marks/ask.json); voice-lines.py requests every
  line's first ElevenLabs take at once (a failed one renders in the loop as before, backup intact).
- **Build**: make-spot.py renders the beats in parallel processes and runs the scrim / highlight geq on their own strips
  (frames bit-identical to v1.2 on the 10/1 close plan; beats 170 -> 35 s); make-fill-subtitles.py renders frames on 8
  workers (identical PNGs, 32 -> 5 s). Final encodes unchanged (SSIM checks unchanged).
- lib.llm: OpenRouter max_tokens 4000 -> 8000 (`SHORTS_OR_MAX_TOKENS`): 4000 truncated Sonnet's storyline replies ("max()
  arg is an empty sequence", ~32 s each, then M3 took over and never converged: 12 rounds, refused; with 8000 Sonnet passed
  in 2 rounds / 37 s on the same take). A reply with no JSON goes straight to the next provider; twice = last for the run.
- storyline: up to 12 rounds (was 8), bounded by the budget-derived time cap.
- run.sh: the duck remedy also runs after a re-tightened build (it only ran after the first build: test 4 refused with
  ~14 min left), and only reads that build's own log lines.
- Q37 reads no subtitle gap on a frame at a cue handover (only the eyebrow on screen, text bottom ~325 instead of the
  fixed ~467 row); the phone-top half of the check is unchanged.
- design_book: the 52-week range lookup (a design input, not a shown figure) waits 8 s at most.
- Q37 samples a beat no later than 0.25 s before its cut (a 1.5 s beat sampled inside the slide read as a 74 px drop).
- Schedule: preopen starts 6:50 CT (owner 10/1: done before 7:30 CT); prestage plists at 6:20 / 11:05 / 14:32 CT, korea-open
  fires 18:00 Sun-Thu, korea-close 00:05 Mon-Fri (references/schedule.md, budget table).
- `SHORTS_CODE`: read the seed and build scripts from another checkout (a worktree --test of new code).

## v1.2.0 (2026-10-02 KST, owner: Korean news sources, a third Korea edition, six Shorts a day)

- **korea-midday**, a third Seoul edition (12:00 PM KST = 10:00 PM CDT / 9:00 PM CST the evening before, KRX trading days):
  how Korea's AI-chip names stand THIS YEAR (pages on the YTD chart) and why, how they trade so far in Seoul, the read-through
  for US chip names, mid/long term. Ask "How much of my portfolio is in Korean stocks?" (checked against the `korea` group
  weight and the holdings). Account `+daily017`. Brief on camera: kr_open (the app has no midday Korea brief; kr_open is
  the live one until 15:30 KST). Live-session tolerances shared with korea-open (`kr.LIVE_EDITIONS`); stamp "Seoul midday",
  cover hero THIS YEAR, end card "Follow for Korea's chips, 3 times a day" (all three Korea editions). launchd
  `com.hodlerss.assetly-shorts.korea-midday` (Sun-Thu 20:55 CT) behind the gate (waits for 12:00 KST, skips after 13:00 KST).
- **Korean news sources** (`scripts/kr_news.py`): Yonhap English + Korean RSS, Korea Herald, BusinessKorea, Maeil Business,
  Chosun Ilbo, and Naver Finance per-ticker news (m.stock.naver.com, each item under its press office). Publishers are
  canonical (one newsroom one name: KED Global = Korea Economic Daily, Pulse = Maeil Business), a wire credit wins (a
  Korea Times / Herald reprint of a Yonhap story, or a same-headline uncredited copy, is Yonhap, so it counts once), and an
  aggregator (Naver, Daum, Google News) is never a publisher; Google News publishers go through the same canonicalizer.
  Probed 10/1 and rejected: Hankyung RSS (Cloudflare 403; Hankyung still arrives via Naver), KED Global RSS (stale /
  empty), JoongAng Daily and Pulse (no RSS), Naver Finance desktop (410). One request per source per run, a 25 s wall cap,
  no login, no paywall. Korean-language headlines may be cited; every field is still written in plain English. The
  10/2 19:32 korea-open had refused at research with only 2 items on Google News alone.
- **Stale-session guard** (the app's 10/2 fix ff99849 / ae4562a, now in the Shorts): Yahoo's KRX feed lags ~20 min, so
  before the first bar of the day range=1d serves yesterday's bars. `kr.kr_quote_live` counts a bar only inside today's
  KRX session (and Daum minute rows only from today), waits 2 x 20 s, then returns `stale` with no figures (the name's move
  is refused). `facts.py` reads `portfolio.as_of` and withholds every day move the app's own `calendar.ts
  withholdStaleMoves` places in an earlier session (refuses when that check cannot run); an Ask day move verifies only
  when both feeds carry it for this session and agree (an app-only or second-feed-only day move no longer verifies).
  Tested: Oct-1 15:30 KST row at 9:10 KST Oct 2 = stale, Oct-2 9:05 row = current; a fake stale Yahoo chart -> refused;
  the live 10:50 KST quote -> both feeds at 10:13.
- Korea-first hard gates (10/2 03:20 CDT, installed): Q42 (item 1 and >= 2 of 3 items KRX) and Q38's KRX-hero rule, verified
  failing on the delivered EEaqNFClCCY; no Korean item is forced to SAY its window figure (the page header and the KRX hero
  show it); Korean names said as people do ("Samsung", "Hanmi"); reads must state what and why. lib.llm retries an
  OpenRouter 402 "fewer max_tokens" inside what the balance affords. OpenRouter credit ran out at ~03:06 CDT 10/2: every
  storyline then ran on MiniMax-M3, which did not converge on the Korea rebuilds.
- Korea-first and fluency (owner review 10/2, not yet released: committed, NOT installed): research keeps >= 2 KRX items
  (else a second pick asking for 4 of 6, else refuse); storyline wants item 1 and 2 of 3 items KRX, the window figure only in
  the first Korean item, budget-cut hints never aimed at the line carrying it; the cover hero is a KRX listing or none (Q38
  checks it); code patterns for odd phrasing ("got ... favors", "see gap closing"); an LLM editor pass on a draft that
  passed every code check (fluent native English, a read that adds a concrete fact or view, the Ask line answers the
  question, a read-through for US AI-chip holders), Korea editions only (`SHORTS_JUDGE`); the Ask matches a holding by its
  name's unique first word ("Samsung"). Tested 10/2 03:00 CDT on the korea-close and korea-midday work dirs: research came
  back Korea-first (5 of 5 items), but the storyline did not converge in 5 attempts (52-word budget vs long Korean names,
  verified-wording traceability and the window figure), so neither rebuild shipped. Needs an owner call before the next
  KRX session (see the report).
- Q37 never samples the last beat inside the 0.6 s cross-fade to the end card (10/2 korea-close: 90% of a 3.3 s beat read the
  dimming phone as top 1393 and refused a finished Short; delivered on a QA re-run).
- Ask (Korea): a bullet that lists holdings and their total ("Foundry/fab: TSM $36,736, Samsung $8,177 = $44,913 (24.8%)",
  "Non-chip: GOOGL, MSFT, cash $7,500 = $48,666") verifies against the running sum of THAT bullet's named holdings (each on
  two feeds) plus the cash row when it names cash; never an arbitrary subset. 10/2 korea-close had refused two takes on it.
- korea-close waits for Yahoo's closing print: 10/2 15:46 KST the launchd korea-close refused ("feeds disagree" on 6 of 9
  names; Yahoo's daily bar was still a ~15:03-15:2x intraday price, e.g. SK hynix 1,843,000 vs the KRX close 1,841,000).
  `kr.kr_quote` counts today's finished-session bar only once Yahoo's regularMarketTime is at or after 15:30 KST, waits in
  30 s steps up to 6 min, then leaves the figure out (`stale`). Re-run by hand at 15:55 KST.
- Q28 accepts an initialism heard letter by letter ("AI lifted" -> "hey i lifted", 10/2 korea-open, mix and dry track).
- From the first korea-midday (10/2 22:00 CDT, delivered on the 5th pass): an Ask window mid-session may differ between the
  feeds by the measured price lag (the gap between their day moves, capped 0.35); a live page window counts as the verified
  one when the two imply prices within 0.6% (`kr.window_close`, was a fixed 0.6 pt: SK hynix YTD +181.7% vs +182.80% on the
  page oscillated 8 rounds); korea-midday never forces a YTD figure into a line (three-digit figures blew the voiced budget
  for 24 rounds; the cover hero shows it); an OpenRouter reply cut at its 4,000-token cap (`finish_reason: length`, 6 of 11
  Sonnet rounds, ~33 s each) is retried with the full budget; the Korea end card is "Follow for Korea's chips, 3 times a
  day" ("three" spelled out ran past the safe edge, Q10).

## v1.1.0 (2026-10-01, owner: track Korean semiconductor stocks, two Korea Shorts a day, mid-to-long term)

- Storyline refuses an article before a company name ("The Boeing ...") and a possessive that drops its object
  ("won Navy's fighter."): the 10/1 close's first line. Re-checked on that story (caught) and the passing scripts.

- Two new editions, `korea-open` (9:32 AM KST = ~7:32 PM CT the evening before, pages on 1M, Ask "How exposed is my
  portfolio to memory chips?") and `korea-close` (3:45 PM KST = ~1:45 AM CT, the long view, pages on 3M, Ask "What's my
  AI chip concentration?"), for US investors with AI-heavy portfolios: Korea's AI-chip names (SK hynix, Samsung
  Electronics, Hanmi Semiconductor and peers) and the US chip names they move with, the multi-week trend and its cause,
  dated upcoming events, context only (never a call on the US open, never advice). Accounts `+daily015` / `+daily016`.
- `scripts/kr.py`: KRX quotes from Yahoo (the app's own source; a bare "Mozilla/5.0" UA, the Chrome UA gets 429) and Daum
  Finance (KRX official `days` rows; the live `quotes` only during the session). Naver was rejected as a KRX feed: in the
  evening its price is the Nextrade after-market one (SK hynix 10/1: 1,828,000 vs the KRX close 1,833,000). 1M / 3M / YTD
  windows on both histories (Yahoo vs Daum for KRX, Yahoo vs Nasdaq for US), anchored like the app's chartRange.ts.
  KOSPI on Yahoo + Naver (an index has no after-market), the SOX on CNBC + Nasdaq. Won: the app's USDKRW and CNBC KRW=.
- research: the Korea universe (9 KRX names + 17 US chip names), English headlines (Google News: SK hynix, Samsung,
  Hanmi, HBM, memory prices, Kospi), the long-view framing, figures with a `field` (pct / m1 / m3 / ytd; only the
  edition's page window may be spoken), window claims checked against both histories.
- book: SK hynix and Samsung always held, US chip core, KRX lots in won (cost inside the year's KRX range). seed: KRX
  names ensured as KRX / KRW with their names, `markets` = US + KR.
- account: kr_open / kr_close briefs on the KST window, Seoul timing words. facts: KRX rows converted at the app's rate and
  recomputed with Daum + CNBC's rate (the run refuses when the two rates differ > 0.4%); no "today" figure (Home's Today
  mixes the US and KRX sessions); group weights for the Ask (memory, chips, Korea) from a fixed taxonomy.
- record: KRX rows are found by their Home label ("SK hynix"), marks mapped back to the symbol; DAILY_RANGE 1M / 3M.
  screen: the page's chart header ("Price · 3M" and its change) is read as `range` / `range_move`.
- storyline / compose / qa: Seoul timing words (Q25), "In Seoul," as the fallback lead, a window sentence must be the
  page's window and agree with its change (storyline + Q33), the cover hero = the page's 1M / 3M change (PAST MONTH /
  PAST 3 MONTHS, Q38), stamp label "Seoul open" / "Seoul close" (Q31, still ET wall time), end card "Follow for Korea's
  chips, twice a day" (Q39), KRX feeds named in sources.md, Korea niche tags.
- Schedule: launchd `com.hodlerss.assetly-shorts.korea-open` (Sun-Thu 18:30 CT) and `.korea-close` (Mon-Fri 00:40 CT);
  the gate waits for 9:32 / 15:45 KST (Seoul has no DST, Chicago does) and checks "already delivered" on the Seoul date.

## v1.0.7 (2026-10-01, owner: Shorts reach best practices, keep the core principles)

- Source: "If your shorts get under 1,000 views... do this" (youtube.com/watch?v=Jc_-IPaW2pg; transcript, chapters read)
  plus 2026 Shorts guidance (hooks, loops, CTAs, thumbnails, hashtags). What was applied and what was refused, with why:
  references/shorts-craft.md.
- Cover HERO (the thumbnail): compose `cover_hero` picks the biggest move among the three stories that the viewer then
  reads in that item's beat (a holding page's day move both quote feeds agree with, or the beat's labelled pre-market /
  after-hours chip; pre-open only from a chip); >= 1% or no hero. make-cards.py `HOOK_HERO` draws the name, the move
  ~250 px in the app's gain / loss colour and its window label over the three headlines. Q38 OCRs it on frame 0 and in
  its beat. `thumbnail.png` (frame 0) is delivered.
- End card: one accent line "Follow for the open, midday and close" (`END_FOLLOW`, day.json `follow`), a quicker
  stagger so it reads >= 1 s; nothing spoken, no like/subscribe. Q39. Launch clips unchanged (env unset).
- Storyline prompt: item 1 = the most surprising verified fact (usually the biggest move), cover line 1 = item 1, no
  teaser openers; titles name the company, no hashtags / question bait / caps.
- Metadata: 3-5 hashtags (#Shorts, up to three companies, one niche tag; never #viral / #fyp); hidden tags = companies,
  "<name> stock", niche phrases, brand; a stray "#" is stripped from the title. Q40. TikTok caption: 3-5 hashtags,
  cover = first frame.
- Voice (owner, 10/1): every line in Minjae's ElevenLabs voice; OpenRouter gpt-audio (the line's marin / cedar) only as
  the per-line backup when ElevenLabs fails (voice-lines.py `SHORTS_VOICE=minjae`, the default; `mixed` restores the
  old casting). compose: items and the question at 1.06x (were 1.12x for gpt-audio): the clone reads ~2.4-2.65 words/s
  raw against gpt-audio's ~1.9-2.15, so 1.12x would rush it to ~2.7-3.0 w/s; 1.12x only in `mixed`. Storyline keeps
  Sonnet first (OpenRouter topped up).
- Ask wait (testGshort), 10/1 close: the take's display froze on "Still thinking..." from 171.3 s to 180.5 s (dots
  stopped, freezedetect) while the accessibility tree already held the whole answer: the old wait trusted the tree,
  which is not what the camera films (staticText-only wait lines, any existing foot). Fix: any-type, case-insensitive wait lines, a NEW disclaimer foot (count
  grows), a 1.5 s settle and a 9 s hold (16:00 close take: answer on screen at 181 s, ask_answer 182.4 s); then a
  screen guard: OCR of a screenshot (Vision) must show no wait line and the answer before ask_answer is marked
  (ask_timeout past 90 s).
- Not applied (owner's call or a principle): a spoken CTA, cutting to <= 20 s, one upload a day, delete-and-reupload,
  bait tags, API thumbnail upload (token scope is youtube.upload only).

## v1.0.6 (2026-10-01, owner: post every Short to TikTok too)

- Titles (owner, 10/1 pm): <= 50 chars, short and catchy, the hook only: no edition label (Midday / After the bell) and no
  date (the description's first line carries "Data as of"). Storyline prompt + check, compose strips any label/date, QA
  checks it, the TikTok caption follows.
- Research: "barely budged / muted / unmoved" count as a flat claim (10/1 close: Micron "barely budged" on a verified
  +3.03%). Storyline fallback with no spare item re-tells a direction-wrong item with the verified move.
- TikTok posts were briefly **Only me** (10/1 afternoon), then made **Everyone** again the same evening (owner: "make all videos on tiktok public"). Was: Only me (Chrome dropdown; API `SELF_ONLY`, override `TIKTOK_PRIVACY`): the owner switches each one to
  Everyone by hand for about a week (~Oct 8), then the default is revisited. The 10/1 preopen and midday went out as Everyone.
- Every delivered Short gets a TikTok package (tiktok_pack.py: < 10 MB tiktok.mp4, caption, tiktok.json). With --upload
  it posts through the TikTok Content Posting API (app/scripts/tiktok/post.py; AI-generated label, own-brand disclosure)
  once ~/.private_keys/tiktok_token.json exists; until then it queues the delivery (docs/marketing/shorts/tiktok-queue.txt)
  and notifies the owner; an interactive Claude session posts the queue in Chrome (references/tiktok.md). YouTube is
  unaffected by any TikTok failure. 10/1 preopen-v5 and midday posted to @assetlyapp (Everyone, AI label, Your brand).

## v1.0.5 (2026-10-01, owner framing review of preopen-v4 + Shorts craft)

- Framing (owner): a bigger phone (860 px body, was 663) whose TOP edge never moves: the push grows it from the top
  (make-spot.py `zoom_anchor: "top"`, `phone_w`), 1.15x (was 1.3x). The old focus-point push moved the phone between
  y 478 and 739, so the gap to the subtitles changed every beat.
- Subtitles end on a fixed row (`SUB_BOTTOM`, y 468), 40 px above the phone, for one, two or three lines; the eyebrow
  sits 16 px above the first line. Type 60 px (was 50), 820 px max width (Q10 safe zone x 60-950) (Shorts caption guidance: 60-75 px).
- Q37: the phone's top on one row in every beat and the subtitle-to-phone gap constant (+-8 px), measured on the final
  frames.
- references/shorts-craft.md: the Shorts guidance applied and what it never overrides.
- The answer-on-screen search matches the quoted line by its words (two of its first four), not an exact prefix: OCR
  reads "−4.0%" and bold tickers unreliably, and the 12:12 midday refused on a line that was on screen.
- The title's date is the edition's (compose sets "| Oct 1"; QA checks it): the 10/1 midday was titled "| Sep 14".
- Q8 allows 320 ms for the second sentence of one voice line (it runs on with no clean acoustic onset), 150 ms
  elsewhere; onsets also from a loose dip and an 8 dB rise. Subtitles 820 px wide (Q10 x <= 950).
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
