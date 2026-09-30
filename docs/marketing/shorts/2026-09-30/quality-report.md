# Quality report: assetly-short-2026-09-30.mp4

Measured against [SHORTS_QUALITY.md](../../SHORTS_QUALITY.md). Automatic rows from
`web/ios/App/marketing/shorts/qa-short.py`; manual rows checked by the agent on the proof frames, the
sources table and a speech-recognition round trip. **All 16 pass.**

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration (video runs the whole file) | PASS | 24.83 s, video 24.833 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -14.0 LUFS |
| Q4 | True peak | PASS | -1.6 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.33 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 79 ms over 5 sentences: +20, +33, +39, +79, +34 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 18 layers checked; union x 165-915, y 112-1233 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q11 | Every figure sourced | PASS | 8 spoken/subtitled figures, each with two agreeing sources ([sources.md](sources.md)); 5 figures dropped where sources disagreed |
| Q12 | Pronunciation | PASS | Script through `speakable()`, `earAudit()` = no issues; no tickers spoken. Listen-check list: Micron, Google, Gemini four, Meta, Muse, A I, September, fifty-four point two billion dollars, zero point nine percent, one point eight percent, zero point two percent. faster-whisper (small.en) on the FINAL MIX (music under the voice) returns the script word for word ([asr-transcript.txt](asr-transcript.txt)): 57/57 words, differences are only digit formatting ("$54.2", "0.9%") |
| Q14 | Disclaimer visible | PASS | "Demo portfolio · Not financial advice" at y 112 on every product frame (proof 0.0 to 18.0 s); "Demo portfolio. Not financial advice." on the end card (proof 24.8 s) and in the description; the eyebrow "DEMO PORTFOLIO 001" and the words "this demo portfolio" name it once more |
| Q15 | Brand | PASS | Schibsted Grotesk throughout; dark ground #14181F, ink #E9ECF1, accent #8B98E0 (eyebrows, highlight, CTA pill); app icon + "Assetly" + "Your portfolio, explained daily" + "Available on the App Store" pill on the card |
| Q16 | Proof frames viewed | PASS | proof/ at 0.0, 0.5, 3, 8, 13, 18, 24.8 s plus 1.9, 7.9, 8.3, 9.5, 10.5, 11.8, 16.5, 20, 21.3, 22.2, 23.5 s all viewed. Fixed on the way: Google beat opened on a chart-loading skeleton (re-recorded and re-cut), 9 video frames lost to `-shortest` at the mux (removed), a static 2 s title tripped the freeze check (slow push added), a subtitle orphan ("Gemini / 4.") |

**Also measured:** duck under the voice -9.2 dB (mixer asserts -6 to -12); speech band intact; 9.8 MB; 1,490 frames.

**Not measurable here:** whether the voice and bed sit well together to a human ear. The ASR round trip proves every word is intelligible over the music, not that it sounds good. Play it once before posting.

## The account's own close brief (what the app wrote, checked as the brief asks)

Demo Portfolio 001's close brief (2026-09-30, gen 21:30 UTC) is on screen in the last beat. Checked line by line:
- Lede "A quiet session added $336, leaving the AI book intact at $213,100" and the Today paragraph (S&P 7,651.54 -0.3%, VIX 16.34 +1.9%, portfolio +$336 +0.2%, NVDA +0.5%): correct.
- Three defects found, none in the Short's words, two visible only as small text in the brief beat:
  1. First generation said "Setup is a tech book with **no earnings on the calendar**" on the night Micron (a holding) reported. Cause: MU was a newly registered symbol with no filings synced, so the brief had no earnings date for it. Fixed at the input (filings-sync for MU) and regenerated. Product gap: `symbol-search ensure` registers a symbol without triggering filings-sync.
  2. Second generation: "Meta dropped 1.8% today, ending **your** best monthly run since 2022" (Meta's month, not the portfolio's). Regenerated.
  3. Current generation, META note: "Best month since 2022 on AI momentum, plus a **$15.75 quarterly dividend**". $15.75 is this holding's quarterly income (30 sh x $0.525), phrased like a per-share dividend; and "since 2022" is the CNBC framing other outlets dispute ("since 2013"). The brief zoom is framed above this line, so it is not legible in the Short.
- Also: the spoken brief says "two hundred ten thousand dollars" for $213,100 (rounded down), and insights-sync returned WORKER_RESOURCE_LIMIT on a 10-symbol call (worked in batches of 3-4). The MU intelligence card says "$63B guidance" where CNBC reports about $61.5B.
