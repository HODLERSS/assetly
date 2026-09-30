# Quality report: assetly-short-2026-09-30.mp4 (multi-voice cut)

Measured against [SHORTS_QUALITY.md](../../SHORTS_QUALITY.md). Automatic rows from
`web/ios/App/marketing/shorts/qa-short.py` (run by `make-short.sh`); manual rows checked by the agent on
the proof frames, the sources table and a speech-recognition round trip. **All 16 pass.**

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration (video runs the whole file) | PASS | 24.26 s, video 24.233 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -14.0 LUFS |
| Q4 | True peak | PASS | -1.5 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.31 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 70 ms over 5 sentences: -50, -60, -70, -60, -50 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 23 layers checked; union x 165-915, y 112-1233 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q11 | Every figure sourced | PASS | Same 8 figures as the first cut, each with two agreeing sources ([sources.md](sources.md)); 5 contested figures dropped |
| Q12 | Pronunciation | PASS | Every line through `speakable()` (no change: already words; `earAudit()` clean); gpt-audio's own transcript matched each line verbatim at render; faster-whisper small.en on the FINAL MIX returns the script word for word ([asr-transcript.txt](asr-transcript.txt)); only digit formatting differs. Listen list: Micron, Google, Gemini four, Meta, Muse, A I, September, fifty-four point two billion dollars, zero point nine / one point eight / zero point two percent |
| Q14 | Disclaimer visible | PASS | "Demo portfolio · Not financial advice" at y 112 on every product frame; "Demo portfolio. Not financial advice." on the end card and in the description; eyebrow "YOUR ASSETLY BRIEF · DEMO 001" and the words "this demo portfolio" |
| Q15 | Brand | PASS | Schibsted Grotesk; #14181F ground, #E9ECF1 ink, #8B98E0 accent (eyebrows, pills, highlights, CTA); icon + name + "Your portfolio, explained daily" + App Store pill |
| Q16 | Proof frames viewed | PASS | proof/ (0.0, 0.5, 3, 8, 13, 18, 24.21 s) plus 1.5, 4, 9.5, 16, 19.5, 21, 22.5 s viewed: every spoken line has its subtitle lit word by word, its eyebrow, moving pills, and a highlight box on the phone around what is being said (Micron and Meta "today" lines, the Gemini bullet, the portfolio's day) |

**Also measured:** duck: -11.9 dB under the voices (mixer asserts -6 to -12); 1454 frames;  13M. Speaking pills visible
whenever a voice is speaking (20.2 s of 24.2 s), absent over the title's silence and the card.

**Caveats:** (1) I cannot hear audio. The ASR round trip proves every word is intelligible over the bed and
the two gpt-audio voices were checked verbatim, but whether the hand-off from marin/cedar to the Minjae
clone sounds natural needs one listen. (2) At the very start of the Micron beat (about 2.0 to 3.0 s, phone
at rest before the push) the app's MU intelligence card is on screen at small size, including its
"$63B guidance" (CNBC reports about $61.5B). It is roughly 11 px text and is covered by the push within a
second; nothing in the voice or subtitles uses it.

## The account's own close brief (what the app wrote, checked as the brief asks)

Demo Portfolio 001's close brief (2026-09-30, gen 21:30 UTC) is on screen in the last beat. Checked line by line:
- Lede "A quiet session added $336, leaving the AI book intact at $213,100" and the Today paragraph (S&P 7,651.54 -0.3%, VIX 16.34 +1.9%, portfolio +$336 +0.2%, NVDA +0.5%): correct.
- Three defects found, none in the Short's words, two visible only as small text in the brief beat:
  1. First generation said "Setup is a tech book with **no earnings on the calendar**" on the night Micron (a holding) reported. Cause: MU was a newly registered symbol with no filings synced, so the brief had no earnings date for it. Fixed at the input (filings-sync for MU) and regenerated. Product gap: `symbol-search ensure` registers a symbol without triggering filings-sync.
  2. Second generation: "Meta dropped 1.8% today, ending **your** best monthly run since 2022" (Meta's month, not the portfolio's). Regenerated.
  3. Current generation, META note: "Best month since 2022 on AI momentum, plus a **$15.75 quarterly dividend**". $15.75 is this holding's quarterly income (30 sh x $0.525), phrased like a per-share dividend; and "since 2022" is the CNBC framing other outlets dispute ("since 2013"). The brief zoom is framed above this line, so it is not legible in the Short.
- Also: the spoken brief says "two hundred ten thousand dollars" for $213,100 (rounded down), and insights-sync returned WORKER_RESOURCE_LIMIT on a 10-symbol call (worked in batches of 3-4). The MU intelligence card says "$63B guidance" where CNBC reports about $61.5B.
