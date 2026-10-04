# Assetly investment explainers

Use for researched company/theme Shorts rather than daily market recaps. Default to **30–50 seconds, 50 s hard max** (owner, Oct 4); honor an explicitly requested range. Match the requested number of videos. Weekend production is allowed. These preferences reflect the owner's October 3 and 4 revisions.

## Editorial standard

Build one investment question per Short: **named company → evidence → economic mechanism → near-term check → longer-term test or failure condition**. The viewer should leave knowing what would strengthen or weaken the thesis, not merely that AI demand is growing. Name relevant suppliers/customers instead of saying “big cloud companies” or “five names.” Distinguish adoption, revenue, profit, cash flow and valuation. A compelling business is not automatically a cheap stock.

Research several plausible angles and select those with clear primary evidence and useful public-stock connections. Use filings, earnings releases and company disclosures for financials. Date observations and state GAAP/non-GAAP basis. Use the requested research window, not an old report presented as new. For social posts, identify the author and dated original; if X is inaccessible, disclose whether an official company reproduction or another source was used. Do not imply the whole thread was read when only an excerpt was accessible.

For platform/benchmark-led ideas such as OpenRouter:

- Separate **observed result**, **calculation**, and **investment inference**. Platform tokens are not industry-wide usage, revenue or GPU hours. A routing benchmark is not Microsoft's measured savings.
- Preserve sample selection, comparison windows, task domain, caching/reasoning settings and in-sample tuning caveats when they affect interpretation. Do not turn a promotion or narrow test into a causal industry forecast.
- Show a relevant limitation in the narration or visual, while keeping the full methodology in the research notes.

Save sources, facts/calculations/opinion and an **Uncertainty Map**. In this stock-analysis repository, also save a timestamped Markdown answer under `answers/`. Two independent feeds are needed for live market/portfolio prices; skip that work when no such figures are shown. Do not invent price targets or imply valuation work that was not done.

## Endings must resolve (owner, Oct 4)

The owner's verdict on the Oct 4 drafts: "you end with asking question, but no answer ... all three shorts feel like ending without any good conclusion." Never end on a question, a bare risk ("if budgets slow, so does the cash") or a slogan. The last 8–12 seconds before the outro answer **"so what do I do with this?"**:

1. **A pivot line** that announces the answer: "So here's what to watch." / "So here's a two-minute check."
2. **What to watch, made concrete:** 1–3 named metrics or events tied to the story, each with where it shows up (the company's next earnings report, Big Tech earnings calls, the company's own guidance figure). Prefer the company's own disclosed numbers (e.g. "Nvidia guided $108 billion in sales next quarter"). Do not invent dates; say "on the next report" unless a date is confirmed.
3. **A verdict with both branches:** "If X, the bet is working. If Y, that's your warning sign." Both branches must be observable in public data.
4. **Portfolio stories end with an action the viewer can take today**, framed as a check, never advice: "Add up everything tied to one theme. If it's most of your portfolio, one slowdown hits it all. Then ask what still holds up if AI spending pauses."

Visuals for the ending: a WHAT TO WATCH list whose rows light up as each item is spoken; then a BOTTOM LINE card with WORKING IF (green #7BE0A6) and WARNING SIGN (#FF8F7E) panels, the second revealed on its spoken word. Keep the takeaway (e.g. "9 tickers can still be 1 bet") as its own beat before the check. No buy/sell language, no price targets; label inferences ("a target, not a result", "investment test, not a forecast").

## Retention craft (owner, Oct 4: aim for broad reach)

Research what is winning first: scan YouTube Shorts search results (Shorts filter) for the topic and adjacent terms and note view counts and patterns (Oct 4: "The AI Bubble Will Pop" 1.5M, "DON'T Buy Nvidia Stock" 327K, one-chart comparisons 135K; our slide-paced Micron explainer: 1 view). Then:

- **Frame 0 is the thumbnail:** a famous name plus one giant verified figure ("−$5.9B", "$150B", "9 stocks. 1 bet?", "Buy SpaceX, you own Grok."). The first spoken line states the claim in under 3 seconds.
- **A picture change every ~1.5–2.5 s, cut on spoken words:** names light up as they are said, a figure lands on its word, a list row lights on "One"/"Two". This is not pan/zoom (still banned); each state is a still image.
- **Bar reveals** of 0.15 s (three 0.05-s frames at 25/50/75%) on chart scenes.
- **Series continuity:** "Follow the AI money · 2/4" in the header, and endings that point at the next or previous episode (the Nvidia episode ends on the budgets the Google episode is about).
- Thumbnails: dark typography with a curiosity question plus the figure ("Is Google burning cash? −$5.9B"); readable at 180×320.

Reference implementation (Oct 4): `docs/marketing/shorts/2026-10-05-ai-money/`.
- `design.py`: palette, `Scene`, `bars()` (zero baseline, centred labels, GROW reveal frames), `watch()` (what-to-watch rows lit by count), `verdict()` (working-if / warning-sign card), `thumb()`, plus four episodes.
- `render.py <slug>`: scene `<line>.png` per narration line; **`<line>_at<k>.png` = a state shown from word k of that line** (timed from `subs.json`); `<stem>_g25/_g50/_g75.png` = 0.15-s reveal; full music bed to the last frame with a duck-level retry (1.0/1.2/1.4) for a soft hook line; a gentle limiter (≤ −1.5 dBTP after AAC); caption chunks of ≤ 2 lines that never split a figure from its unit; the approved Oct 3 outro; proof frames.
- Voice: `voice-lines.py` needs the ElevenLabs key as `elk` (chmod 600) in its work dir: `from lib import vault; vault(dir, 'eleven_api_key')`, then `install -m 600`. Without it, voice-lines falls back to OpenRouter gpt-audio (which may have no credit).
- The stillness check (`--still-window`) can read ~0.3–0.4 across an encoder keyframe on text-heavy scenes; pick a window inside one GOP and confirm no pixel differs by more than ~40 before calling it motion.

## Topic selection for reach: start from channel data (owner goal, Oct 4)

Before brainstorming, read the channel itself (YouTube Studio > Analytics > Content, signed-in Chrome): traffic sources, stayed-to-watch vs swiped-away, top Shorts. On Oct 4 the 28-day picture was **45% of Shorts views from YouTube search, 43% Shorts feed; 36% stayed to watch.** The best Shorts were name-led ("Amazon.com plans $8B Nvidia chip move", "AI memory demand drives SK hynix") and the slide-paced explainers drew 1-63 views. Rules that follow:

- **Title = what people type:** a famous name or ticker plus a plain question or claim ("Nvidia stock: what $1,000 became in 5 years", "Your S&P 500 fund is secretly an AI bet", "Is AI a bubble? 3 numbers decide it", "You can't buy ChatGPT stock. Here's the closest thing."). Put searched names in tags and the description's first line.
- **Formats that travel with a general audience** (each still needs primary data and a resolving ending): "$1,000 in X N years ago" with the drawdown you had to sit through; "your index fund is really an AI bet" from the fund's holdings file; "made more profit in 3 months than it sold all last year"; "3 numbers decide it"; "you can't buy X stock: the closest public route, and how small it is".
- Brainstorm 6-8, keep the 5 with the clearest primary numbers, drop overlap with recent uploads (the Assetly risk idea was folded into the S&P Short because "9 stocks, 1 bet" already covered it).
- **Pace target: at most ~2.9 s per picture change** (segments / duration from timeline.json). Add word-synced `_at<k>` reveals until every Short meets it.

### Data sources that worked (Oct 4)

- Price paths: Nasdaq `api.nasdaq.com/api/quote/<T>/historical?assetclass=stocks&fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&limit=9999` (a short window returns nothing for old dates) and Yahoo `v8/finance/chart` (split-adjusted closes). Both must agree on every voiced point.
- Fund weights: State Street SPY holdings `https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx` (follow the redirect) plus Slickcharts read in the browser. iShares blocks scripted downloads.
- Market caps: Nasdaq `quote/<T>/summary` (MarketCap) with the Yahoo close as the second feed.
- Company figures: SEC 8-K exhibit 99.1 / 10-Q, fetched directly; prefer business-unit lines over press headlines (Micron's "data center 11x" = Core Data Center BU $1.58B to $18.0B).
- Private companies (OpenAI, SpaceX pre-IPO): state the valuation as a funding-round price and stakes as of their dated disclosure, with "diluted since" / "at most" bounds.

### Production lessons (Oct 4)

- **ElevenLabs allows 5 concurrent requests.** Voice one episode at a time (voice-lines.py already parallelizes its own lines); five episodes at once failed with 429 and fell through to an unfunded OpenRouter backup.
- **Ask on camera:** a long answer can render after the display recording stops (the take ended on "Still thinking", then the home screen). The UI test's `ask.json` is still the real app text; quote it verbatim with "Actual Assetly answer, <date>, illustrative portfolio", keep the thinking frame as evidence, and retake only if the Short needs the screenshot itself. `record.py <edition> <work>` needs `account.json` + `research.json` (copy from a recent run of the same account) and `ask-question.json` `{"q": "..."}`.
- **Renderer:** a line whose first word-synced state is not `_at0` used to leave a picture gap; fixed (the first state covers the line start). Always check `sum(frames) == duration x 60` and video vs audio stream durations after a render.
- **Mishearing:** check the hook line's isolated transcript; "Three numbers decide it" read as "decided" and was rewritten.
- Reference implementation: `docs/marketing/shorts/2026-10-06-ai-public/design.py` (imports the kit from `2026-10-05-ai-money/design.py`; adds `value_chart()` for a labelled log-scale $1,000 path with peak/trough markers and `waffle()` for a 10x10 share-of-fund grid).

## Finished visual standard

Use **dark backgrounds throughout**, large type and stationary content. The approved reference palette is background `#101216`, off-white `#F4F5FA`, light indigo `#A4B3FF`, chart indigo `#5267C4`, panel `#22314B` and divider `#34415A`. Use Schibsted Grotesk, a modest Assetly signature and consistent scene numbering.

At 1080×1920, aim for 80–112 px headlines, 54–78 px main copy and 56–60 px captions. Keep primary content roughly within x80–940 and y280–1580. Reserve the lower caption band; end charts/diagrams above it. Sources can be smaller. Shorten copy before reducing primary text. Inspect the final composite, not only the source image.

Use a visual that explains each argument: zero-baseline bars for comparisons, a labeled hypothetical table for sensitivity, a routing/supplier diagram for relationships, or a time-horizon layout. The LinkedIn-post skill's one-idea-per-scene and whitespace principles are useful; creating a carousel is not required.

**Alignment rules learned from the owner's review:**

- Center both the value and category label on each bar's centerline; use equal value-to-bar spacing. Include units, period, source and a truthful scale. A 13.8× index is not 13.8%.
- For a fraction, match numerator/denominator font size, weight and color. Center both on one axis with equal spacing around the bar. Share price is divided by **earnings per share**, not total company earnings.
- Align paired diagram nodes and arrows on explicit shared axes. Use consistent gaps and unambiguous arrow direction. Labels must be centered within their nodes.
- Keep slides still. Do not add continuous sinusoidal pan/zoom: it made the earlier videos appear to shake. Deliberate cuts or brief reveals may clarify sequence.
- A closing card should contain one clean takeaway. Avoid “What to watch” followed by “Watch: whether…”. Do not repeat the same text in a pasted screenshot strip. Use a native dark card, retain the actual capture as evidence, and label quoted versus summarized wording accurately.

## Thumbnails and outro

Use a consistent **dark, typography-led editorial design** across the series: restrained Assetly mark, prominent company name, a short investor question such as “Should I buy Nvidia?”, and brief conditional supporting copy. No decorative chip/server patterns or synthetic-looking imagery by default. The owner rejected those treatments. Do not claim code-drawn or AI-generated artwork was human-made. Use photography only when it adds a specific, credible story and its provenance is clear.

Include the episode's research/publication date, for example **03 OCT 2026**; generate the actual date for future episodes. Inspect at **180×320**: company and question must remain readable. Preserve original editable source plus PNG/JPEG. A thumbnail question should match the video's scope, without implying a buy recommendation the video does not support.

End with spoken and displayed **“Assetly. Invest smarter.”** and a small, silent **“Available on the App Store.”** Do not voice a download request. Reuse the approved founder outro when appropriate.

## Real Assetly evidence

Use a separate illustrative account with the relevant holdings and the normal data pipeline. Reuse a prepared suitable account when available. Record the actual Ask response; do not fabricate UI or answers. For `scripts/record.py`, the override schema is:

```json
{"q": "The actual holding-specific question"}
```

Before accepting a take, compare the captured question with the requested one. A fallback daily question or a missing-data answer is not usable evidence for the intended story. Inspect the answer before building the ending. Prefer a focused business-risk question if broad prompts return headline-heavy claims. Retake or choose a supportable qualitative excerpt; do not publish unverified nearby numbers just because the app displayed them.

Hold the chosen answer at least **four readable seconds** (six worked well). A verbatim excerpt must match the captured answer and be labeled as an Assetly Ask excerpt. A concise paraphrase must be labeled as an editorial summary. Forward-looking app opinions should be framed as risks to test, not established facts. Keep original response JSON and screenshot/recording under evidence; keep credentials, account secrets and API keys outside deliverables. An on-screen question may show its main sentence without internal prompt instructions, labeled as an excerpt when shortened.

## Repeatable production

1. Read the requested format, length, number of episodes and review-page destination. Set the actual date and output directory before copying any reference implementation.
2. Verify the research and draft roughly 90–115 spoken words as a starting point for this founder voice. Measure the real audio; word count is not a duration guarantee. Preserve clear economic reasoning rather than accelerating dense prose.
3. Prepare relevant app data and record Ask. Use `web/ios/App/marketing/shorts/voice-lines.py` for founder narration. Independent voice work can overlap, but **serialize simulator recordings**.
4. Build native scenes and thumbnails with the standards above. Finish image generation before encoding those images. Do not rewrite another video's scene assets while its render is running. Regenerate only affected scenes during revisions.
5. Use `make-spot-music.py` and `mix-spot-audio.sh` for a full-length cleared music bed and ducking. Render 1080×1920, 60 fps. Preserve captions and approved outro.
6. Run technical checks and visually inspect proof frames. Update the requested HTML view with video, dated thumbnail, downloads, research and QA links. Preserve existing episodes. Change media query versions when replacing files so browser caches cannot hide corrections. Verify all links resolve and the page contains the intended number of players; check the live local URL when available.

Preserve the 20-minute per-clip production target by preparing research, relevant app accounts and reusable design ahead of rendering. Record actual start/end times and disclose misses. Do not silently exclude setup or research when claiming end-to-end timing. Prefer evidence-backed excerpts over endless app retakes.

### Reusable implementation references

The completed examples are in the app repository at `docs/marketing/shorts/2026-10-03-ai-investment-lab/`:

| Resource | Reuse for |
|---|---|
| `design.py` | Dark canvas, centered bar labels, matched fraction, aligned power/cooling diagram, clean closing card |
| `design-openrouter.py` | Source-driven scenes, indexed demand chart, benchmark/routing visuals; supports selecting a slug |
| `thumbnails-dark.py` | Dated dark typography-led thumbnail family |
| `render.py` | Stationary 60-fps scenes, timed captions, full bed, outro, proof extraction |
| `01-micron/`, `02-vertiv/` | Corrected visual references and evidence |
| `03-nvidia/`, `04-microsoft/` | 47s/55s OpenRouter-led examples, research and QA |

These are **reference implementations, not generic one-command generators**. Inspect before adapting: they contain episode-specific paths, slugs, dates, figures and questions. Use a new output directory; do not overwrite approved episodes. Reuse design mechanics, not stale financial facts or previous app answers. Temporary `/tmp` production helpers are not durable dependencies. Keep the source needed to rebuild each delivery.

### Export pitfalls

- Check whether local FFmpeg includes libass before using ASS subtitles. The reference renderer uses timed transparent caption strips as a fallback. Explicitly pad the caption stream through the video end; do not let it truncate the outro.
- Quantize scene boundaries to frames. Prevent caption overlap from accumulating timing drift. Wrap captions based on measured rendered width, not a fixed word count alone; long number phrases previously spilled into three lines.
- Invalidate cached scene encodes when artwork, duration, frame count or rendering transforms change. Removing motion requires re-encoding cached moving segments too.

## Release checks and deliverables

Run `scripts/check-explainer.py VIDEO --min-seconds 40 --max-seconds 60 --upload-copy COPY --captions SRT --report REPORT.json` using the requested duration range. For a scene intended to remain static, optionally add `--still-window START END` with both times inside that scene; the comparison excludes the lower caption band. This tool checks technical invariants, **not** the entire editorial/visual gate.

Complete the remaining checks:

- Compare final-mix ASR with the script including the brand outro. Investigate meaning-changing differences; use isolated voice transcription to distinguish recognizer error from a bad take. Rerecord ambiguous financial wording. Normalize numeric formatting and genuine proper-name transcription variants, not arbitrary omissions.
- Inspect every scene proof and the outro at phone size: no clipping, displaced labels, unwanted movement, conflicting caption layers, unreadable takeaways or old light frames. Check source values, labels, dates, calculation math and original app evidence separately.
- Confirm the music bed continues into the ending fade. Target roughly −14 LUFS integrated and ≤−1.5 dBTP. Do not certify subjective listening when the runtime cannot listen.
- Deliver master and upload MP4, thumbnail PNG/JPEG, SRT, script, metadata/description, research with uncertainty, original evidence, editable source, proof frames and a specific QA report. Keep the legacy 9.9 MB upload target when visually reasonable; retain a good master and report any necessary encoding trade-off.
- Measure video and audio durations separately. A correct container duration can hide a video stream that ended early. Never claim the daily 20–30-second market QA gate passed for a custom 40–60-second explainer.

## Publication scope

Creating videos or updating a preview does not authorize uploads or public scheduling. When upload is requested, reuse confirmed IDs, keep an idempotent manifest and bound retries. A channel upload-limit error also affects manual uploads. Distinguish queued, privately uploaded and scheduled states. Release times are hypotheses until channel audience data supports them.
