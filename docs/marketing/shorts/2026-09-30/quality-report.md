# Quality report: assetly-short-2026-09-30.mp4 (v2, rebuilt from scratch)

Measured against [SHORTS_QUALITY.md](../../SHORTS_QUALITY.md) (now 20 metrics). Automatic rows from
`qa-short.py` (run by `make-short.sh`); manual rows checked on the proof frames, the sources table and a
speech-recognition round trip. **All 20 pass.**

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration (video runs the whole file) | PASS | 24.81 s, video 24.800 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -13.9 LUFS |
| Q4 | True peak | PASS | -1.5 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.33 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 80 ms over 7 sentences: -70, -50, -80, -30, -70, -50, -80 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 26 layers checked; union x 138-942, y 112-1229 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 5 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [4.5, 6.3, 13.8, 19.8] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['0.0s', '0.7s', '1.2s', '1.2s', '0.5s'] |
| Q20 | Insight lines: why + sentiment, two sources each | PASS | Micron (why: AI memory demand; reaction: barely moved after hours; sentiment: priced in), Google (why: Gemini 4 leads most benchmarks; reception: few can use it yet; market: +3% intraday, +0.9% close), Meta (why: OpenAI's Dots; sentiment: analysts still back Muse). Every claim has two sources in [sources.md](sources.md) |
| Q11 | Every figure sourced | PASS | Spoken: 1.8%, over 3%, 0.9 (two sources each); on screen: prices, net worth, today, all time, movers (app vs Nasdaq/Yahoo). Micron's after-hours % dropped (sources disagree), said as "barely moved" |
| Q12 | Pronunciation | PASS | gpt-audio transcripts verbatim at render; faster-whisper on the FINAL MIX returns the script word for word ([asr-transcript.txt](asr-transcript.txt)) |
| Q14 | Disclaimer visible | PASS | "Not financial advice" at the top of every frame and on the end card; description carries "Portfolio shown is illustrative. Not financial advice." |
| Q15 | Brand | PASS | Schibsted Grotesk, dark ground, accent eyebrows/pills/cover names, icon + Assetly + App Store pill |
| Q16 | Proof frames viewed | PASS | proof/ (0, 0.5, 3, 8, 13, 18, 24.77 s) plus 1.0, 2.2, 3.5, 5.0, 5.8, 7.0, 8.5, 10.5, 12.5, 14.0, 15.5, 17.0, 19.0, 20.6, 21.5, 22.4, 24.7 s |

**Footage frame rate (honest number):** the take is the simulator display captured with `simctl io
recordVideo`, delivered at 60 fps. The simulator only renders frames when the screen changes: during the
scrolls it produced 30 to 42 unique frames per second (measured per second of the take), and static
moments repeat the last frame. The camera moves (push, slide, card) are computed per output frame at 60.
This is far smoother than the XCTest attachment used before (about 17 fps) but it is not 60 unique frames
on every scroll.

**Not measurable here:** I cannot hear audio; the voices are verified word for word but the handover
marin -> cedar -> marin -> Minjae needs one listen.

## The app's own close brief (on screen in beat 2), checked
Regenerated three times; the kept version (00:37 UTC) is correct on every figure: $248 (+0.1%), S&P
7,651.54 (-0.3%), VIX 16.34 (+1.9%), NVDA +0.5% and its $150B buyback ($235B remaining authorization:
NVIDIA release + CNBC 9/28), Micron's $61.5B forecast. Defects seen and not fixed (product issues):
- first regeneration: "ready for **tomorrow's** Micron print" (Micron reported tonight), META "with no fresh news" (OpenAI Dots was the news), a vague "Oct 15: AI infrastructure calendar event";
- second: a fallback brief whose per-holding dollar moves were wrong ($285 / $372 / $653 vs $292 / $379 / $680);
- kept version: "the day's leaders were GOOGL (+0.9%) and NVDA (+0.5%)" (HPE +3.9% led), "tripwire" left in the desk view;
- MU intelligence card says "heavier capex guidance sparked an after-hours selloff" while quote feeds show ~flat; the edit keeps it out of frame.
