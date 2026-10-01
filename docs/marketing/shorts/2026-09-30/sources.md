# Sources: 2026-09-30 Short (v2, from scratch)

Prices are the regular-session close (4:00 PM ET, Wed Sep 30 2026), checked on two feeds: the app's
price rows (Yahoo chart) and the Nasdaq quote API (`secondaryData`). After-hours quotes checked at
7:31-7:59 PM ET on Nasdaq and Yahoo. A figure the sources disagree on is not used.

## Insight lines (Q20): each says why and the sentiment, each with two sources

| Line (spoken) | Claim | Source 1 | Source 2 |
|---|---|---|---|
| "Micron beat on AI memory demand" | beat; the driver is AI memory (HBM) demand | CNBC 4:15 PM ET: revenue $54.23B vs $51.07B expected, "benefit from soaring demand for AI infrastructure" | Micron release (GlobeNewswire/finviz): record Q4, $61.5B ± $1.5B Q1 guide; Investing.com call recap: "demand remains strong ... especially high-bandwidth memory" |
| "yet barely moved after hours" | the after-hours move was small | Nasdaq API: $1,064.50, -0.06% at 7:31 PM ET; Yahoo 5-min bars: $1,069.00 (+0.4%) at 7:59 PM ET | CNBC: "rose slightly in extended trading"; Investing.com: +0.16% after hours, "muted" |
| "Commentators say it was priced in" (sentiment) | the muted reaction is read as already priced in | Startup Fortune: "The stock barely moved, which tells you how much of this AI memory boom is already priced in" | Investing.com: "After-hours trading was muted, suggesting investors had already expected a strong report"; Traders Agency: "much of the current quarter's strength may already have been priced in" |
| "Google's Gemini 4 beat rivals on most tests" | Gemini 4 Argon leads most published benchmarks | The New Stack: "Argon takes top billing in 13 of 18 tests" vs Opus 5.5, Fable 5.1, GPT-6 Astra | The Verge: "a big chart showing many benchmarks where Gemini 4 fares better than competing models from OpenAI and Anthropic"; Google blog (DeepSWE 77.9% state of the art) |
| "but few can use it yet" (reception) | limited release: trusted cyber defenders first | Google blog: "rolling out to a set of trusted cyber defenders through our Fairwind Program" | The Verge: "limiting access at first"; The New Stack: "It's great, and you can't have it yet"; Reuters: no timeline for public release |
| "Shares jumped over three percent, then closed up zero point nine" | intraday high > +3%, close +0.93% | Yahoo: day high $352.60 vs prior close $340.92 (+3.4%); close $344.08 (+0.93%) | App 1D chart: "chart high $352.29" (+3.3%), close +0.93%; Nasdaq API close $344.08 +0.93%; TradingKey intraday +3.23% |
| "Meta slipped 1.8% as OpenAI launched a Muse rival" | -1.84%; why: OpenAI's Dots agent | App + Nasdaq: $725.18, -1.84% | IBD: "Meta Stock Falls On OpenAI Dots Launch"; GuruFocus: "Meta Stocks Drop as OpenAI Dots Targets Muse's Agent Market"; Barron's: "Meta Stock Slides as Muse Boost Fades Amid OpenAI Threat" |
| "Analysts still back Muse" (sentiment) | analysts remain positive on Muse | IBD: "Analysts Say Muse Is 'Clear Leader'" | Investing.com (9/28): Wells Fargo raised its target to $796 citing Muse; Citi: Muse "emerging as the centerpiece of Meta's AI product strategy" |

## Figures on screen (app output, real closes)

| Figure | Where | Source 1 | Source 2 |
|---|---|---|---|
| MU $1,065.11, 0.00% today | MU page | App (Yahoo) | Nasdaq API |
| GOOGL $344.08, +0.93%, 1D chart high $352.29 | GOOGL page | App | Nasdaq API close; Yahoo day high $352.60 |
| META $725.18, -1.84% | META page | App | Nasdaq API |
| Net worth $271,925; Today +$248 (+0.09%); All time +$106,059 (+66.34%) | Home | App (sum of position values at the closes above) | Recomputed from Nasdaq closes: +$254 (+0.09%); the $6 gap is TSM ($456.19 app vs $456.33 Nasdaq). The % agrees; no dollar figure is spoken |
| Movers CEG -3.99% (-$422), HPE +3.90% (+$720), META -1.84% (-$680) | Home | App | Yahoo: CEG $254.02 / $264.58, HPE $63.89 / $61.49; Nasdaq API CEG -3.99%, HPE +3.89% |

## Dropped (sources disagreed)
- Micron's after-hours %: +2% (TradingKey, XTB "according to some reports up to 15%") vs +0.16% (Investing.com) vs -0.78% (Investing.com slides story) vs "drops" (Stocktwits) vs -0.06% / +0.4% (quote feeds). Spoken only as "barely moved", which the CNBC, Investing.com and feed figures support.
- Meta "best month since 2022" (CNBC) vs "since 2013" (Yahoo, Motley Fool, Rolling Out).
- Micron's own app intelligence card ("heavier capex guidance sparked an after-hours selloff") contradicts the quote feeds; the edit frames the MU page above it.

## Links
CNBC Micron https://www.cnbc.com/2026/09/30/micron-mu-q4-earnings-report-2026.html ·
Investing.com call recap https://www.investing.com/news/transcripts/earnings-call-transcript-micron-tops-q4-2026-estimates-as-ai-demand-stays-hot-93CH-4926057 ·
Startup Fortune https://startupfortune.com/micron-posts-record-quarter-and-blowout-guidance-but-wall-street-barely-blinks/ ·
Google blog https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/ ·
The New Stack https://thenewstack.io/google-gemini-4-argon/ · The Verge https://www.theverge.com/tech/1002980/google-gemini-4-argon ·
IBD https://www.investors.com/news/technology/meta-stock-openai-dots-muse-ai/ ·
GuruFocus https://www.gurufocus.com/news/9103637/meta-stocks-drop-as-openai-dots-targets-muses-agent-market ·
Investing.com Meta https://ph.investing.com/news/stock-market-news/meta-stock-falls-as-openai-o-agent-threatens-historic-rally-2604711
