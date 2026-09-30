# Sources: 2026-09-30 Short

Every figure spoken or shown in a subtitle, with two sources that agree. Prices are the regular-session
close (4:00 PM ET, Wed Sep 30 2026). Checked 21:20-22:00 UTC.

| Figure | Where | Source 1 | Source 2 | Agree? |
|---|---|---|---|---|
| Micron "beat" | voice + subtitle 2 | CNBC, "Micron beats on earnings and issues strong guidance" (4:15 PM ET): EPS $33.42 vs $31.61 expected, revenue $54.23B vs $51.07B expected (LSEG) | Yahoo Finance, "Micron tops Q4 estimates on top and bottom lines, offers strong Q1 outlook" (in the app's news feed for MU) | yes |
| Micron record revenue $54.2B | voice + subtitle 2 | CNBC: $54.23 billion | Micron release "Reports Record Fiscal Fourth-Quarter and Full-Year 2026 Results"; Quiver Quantitative "Record $54.23 Billion Fiscal Fourth-Quarter Revenue"; Quartz "$54.2B revenue" | yes ($54.23B rounds to $54.2B) |
| "after the bell" | voice + subtitle 2 | CNBC timestamp 4:15 PM ET | Yahoo/IBD "Dow Jones Futures: Micron Rises On Hot Earnings" (after-hours story) | yes |
| Google +0.9% | voice + subtitle 3 | App price row (yahoo-v8-chart): $344.08 vs prev $340.92 = +0.93% | Nasdaq API: $344.08, +0.93%, closed 4:00 PM ET | yes |
| Gemini 4 launched | voice + subtitle 3 | Yahoo Finance "Google debuts Gemini 4 Argon, its latest frontier model" | Benzinga "Alphabet Stock Jumps as Google Releases Gemini 4 Argon"; IBD "Google Stock Rises On Gemini 4 Argon Release" | yes |
| Meta -1.8% | voice + subtitle 4 | App: $725.18 vs $738.79 = -1.84% | Nasdaq API: $725.18, -1.84% | yes |
| September rally driven by Muse | voice + subtitle 4 | CNBC "Meta stock enjoys best month since 2022 on AI momentum": closed $725.18, +27% from $572.34, optimism since Muse debuted Sep 8 | Yahoo "META Eyes Best Month ... On Muse AI Strength"; Yahoo daily closes Aug 31 $572.34 to Sep 30 $725.18 = +26.7% | yes (no % spoken) |
| Demo portfolio +0.2% | voice + subtitle 5 | App: +$336 (+0.16%) on $213,146 | Recomputed from Nasdaq closes for all 10 positions: about +$341 (+0.16%) | yes on the %; the dollar figure differs by ~$5 (TSM close $456.19 app vs $456.33 Nasdaq), so no dollar figure is spoken |

**Figures visible in the footage (app output, not spoken):** MU $1,065.11 0.00% (Yahoo daily close 1,065.08 -> 1,065.11; Nasdaq +0.00%);
META $725.18 -1.84%; Home $213,146, Today +$336 (+0.16%); in the brief: S&P 500 7,651.54 (-0.3%) (Yahoo live blog + Yahoo chart),
VIX 16.34 (+1.9%) (Yahoo chart 16.04 -> 16.34; one provider family only), NVDA +0.5% $228.38 (Nasdaq agrees).

**Dropped because sources disagreed:**
- Micron's after-hours move: CNBC "rose slightly in extended trading" vs Nasdaq API at 5:31 PM ET -1.18%.
- Meta "best month since 2022" (CNBC, final) vs "since July 2013" (Yahoo, Motley Fool, Financial Post, all pre-close). The script avoids both.
- Meta's September %: CNBC 27% vs Yahoo "more than 29%" (midday). The first cut spoke "27%"; it was removed because the app's own chart on screen reads "1M +25.46%" (a different window), which would look like a contradiction.
- Micron's next-quarter outlook: CNBC about $61.5B vs the app's MU intelligence card and an FXLeaders headline at $63B. Not used, and the edit keeps that card off screen (the MU beat is a frozen frame of the header).
- The market indices' September totals (Yahoo article S&P -0.7%, Dow -4.9% vs daily-close math S&P -0.45%, Dow -4.3%).

**Links**
- CNBC Micron: https://www.cnbc.com/2026/09/30/micron-mu-q4-earnings-report-2026.html
- CNBC Meta: https://www.cnbc.com/2026/09/30/meta-stock-best-month-2013-ai.html
- Yahoo close wrap: https://finance.yahoo.com/markets/live/stock-market-today-wednesday-september-30-dow-sp-500-nasdaq-080339262.html
- Yahoo Meta: https://finance.yahoo.com/technology/ai/articles/meta-eyes-best-month-since-090447390.html
- Nasdaq quote API: https://api.nasdaq.com/api/quote/<SYM>/info?assetclass=stocks (secondaryData = regular close)
