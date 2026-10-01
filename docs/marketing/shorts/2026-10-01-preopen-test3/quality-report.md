# Quality report: assetly-short-2026-10-01-preopen.mp4

**DELIVERED**: 31/31 metrics pass. Measured against docs/marketing/SHORTS_QUALITY.md (v1.0).

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration 20-30 s (video runs the whole file) | PASS | 28.20 s, video 28.200 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -14.0 LUFS |
| Q4 | True peak | PASS | -1.7 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: [(21.15, 23.42)] |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.34 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 90 ms over 9 sentences: -80, -40, -70, -50, -70, -40, -70, -90, -60 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 30 layers checked; union x 61-942, y 110-1229 |
| Q11 | Every figure sourced (two agreeing feeds; disagreements dropped) | PASS | market figures: both quote feeds per item; portfolio: app vs Nasdaq recompute (11/11 kept); Ask: 2 verified |
| Q12 | Pronunciation: speakable() + earAudit() empty on every line | PASS | make-short.sh refuses a line earAudit flags; Whisper round trip in Q28 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q14 | Disclaimer on every frame + description line | PASS | standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27) |
| Q15 | Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA) | PASS | fixed by the toolchain (make-cards.py / make-spot.py) |
| Q16 | Proof frames exported (view them before posting) | PASS | 25 frames in proof/ (make-short's 7 + one mid-beat frame per beat) |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 6 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [6.0, 11.7, 15.3, 18.3, 20.4] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['0.6s', '1.4s', '0.6s', '0.6s', '0.0s', '0.0s'] |
| Q20 | Insight: each item says WHY + an attributed READ, two sources each | PASS | see Q23 and sources.md |
| Q21 | Ask beat: the question typed on camera and the real answer, every answer figure verified | PASS | "What's ahead for my portfolio today?" typed (2.1 s), answer on screen 6.0 s; answer figures verified ['+$314', '+0.14%'] unverified none |
| Q22 | Portfolio-insight beat (Home: total value, Today, All time) with a verified figure | PASS | "My portfolio is up 30% overall." over Home; facts {"name": "My portfolio", "total": "$230,957", "today": "up 0.1%", "today_usd": "$314", "all_time": "30%", "all_time_usd": "$52,044", "week": "down 0.6%", "month": "up 6.6%", "today_note": "Home shows Today as the day's gain over the invested positions (cash excluded)", "biggest_gain": {"name": "Advanced Micro Devices", "gain": "$15,441", "pct": "142%"}, "positions": 10} |
| Q23 | 3-5 market items, each why + read on >= 2 independent sources | PASS | Google jumps on Gemini. (why 4, read 4 publishers); Futures point higher. (why 2, read 3 publishers); Nike reports tonight. (why 2, read 2 publishers) |
| Q24 | Duration 20-30 s (hard max 30.0) | PASS | 28.20 s |
| Q25 | Edition-correct timing words (preopen) | PASS | uses 'futures'; wrong-edition words: none |
| Q26 | Upload copy <= 9.9 MB, visually identical (SSIM >= 0.995) | PASS | master 13.01 MB -> upload 9.49 MB, SSIM 0.9990 |
| Q27 | Metadata: first line 'Data as of ...', title <= 70, illustrative line, App Store + about links, #Shorts, tags, no 'demo' | PASS | title 66 chars: "Before The Bell: Alphabet rises, futures up, Nike reports | Sep 30"; 8 hashtags |
| Q28 | Whisper round trip: the final mix says the script word for word (figures may differ only in format) | PASS | 67 words; final mix mismatches: none |
| Q29 | Every beat shows the app (no home screen, no blank screen) at 25/50/90% of the beat | PASS | beat 1 sat 5 edge 4.4, beat 2 sat 5 edge 16.4, beat 3 sat 4 edge 3.7, beat 4 sat 5 edge 7.0, beat 5 sat 4 edge 7.2, beat 6 sat 6 edge 9.3 |
| Q30 | Data time-stamp present at the same top-left spot on every sampled frame (cover, each beat, end card) | PASS | "PRE-OPEN / Oct 1 · 5:23 AM ET" at x 61-289, y 110-161 on 10 frames |
| Q31 | Time-stamp = the data snapshot (within 5 min) and the edition label is this edition's | PASS | shown Oct 1 · 5:23 AM ET, snapshot 2026-10-01 05:23 ET (diff 0 min); label Pre-open for preopen: ok |

## Latency per stage (seconds)

| Stage | Seconds |
|---|---|
| research.data | 35 |
| research.llm | 25 |
| research.verify | 15 |
| research.repair | 35 |
| book.design | 20 |
| account.seed | 249 |
| account.brief_check | 177 |
| facts.portfolio | 64 |
| record.take | 212 |
| record.align | 24 |
| facts.ask | 21 |
| storyline.llm | 45 |
| compose | 0 |
| build | 246 |
| **total** | **1168** (19.5 min) |

Not measurable here: how the voices sound against the bed (listen once before posting).
