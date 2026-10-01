| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration 20-30 s (video runs the whole file) | PASS | 26.11 s, video 26.100 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -14.0 LUFS |
| Q4 | True peak | PASS | -1.7 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.37 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 90 ms over 9 sentences: -70, -50, -90, -50, -60, -50, -60, -70, -70 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 28 layers checked; union x 137-944, y 112-1229 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 6 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [4.5, 9.6, 14.4, 18.0, 19.8] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['0.7s', '1.1s', '0.7s', '0.6s', '0.0s', '0.0s'] |
| Q20 | Insight lines: why + sentiment, each with 2 sources | MANUAL | see below |
| Q11 | Every figure sourced | MANUAL | see below |
| Q12 | Pronunciation | MANUAL | see below |
| Q14 | Disclaimer visible | MANUAL | see below |
| Q15 | Brand | MANUAL | see below |
| Q16 | Proof frames viewed | MANUAL | see below |
