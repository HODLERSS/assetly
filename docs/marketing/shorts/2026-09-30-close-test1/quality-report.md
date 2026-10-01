# Quality report: assetly-short-2026-09-30-close.mp4

**DELIVERED**: 30/30 metrics pass. Measured against docs/marketing/SHORTS_QUALITY.md (v1.0).

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration 20-30 s (video runs the whole file) | PASS | 29.42 s, video 29.400 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -13.9 LUFS |
| Q4 | True peak | PASS | -1.7 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.35 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 90 ms over 9 sentences: -80, -50, -50, -30, -70, -30, -80, -70, -90 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 31 layers checked; union x 60-945, y 110-1229 |
| Q11 | Every figure sourced (two agreeing feeds; disagreements dropped) | PASS | market figures: both quote feeds per item; portfolio: app vs Nasdaq recompute (11/11 kept); Ask: 15 verified |
| Q12 | Pronunciation: speakable() + earAudit() empty on every line | PASS | make-short.sh refuses a line earAudit flags; Whisper round trip in Q28 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q14 | Disclaimer on every frame + description line | PASS | standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27) |
| Q15 | Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA) | PASS | fixed by the toolchain (make-cards.py / make-spot.py) |
| Q16 | Proof frames exported (view them before posting) | PASS | 25 frames in proof/ (make-short's 7 + one mid-beat frame per beat) |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 6 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [5.4, 12.3, 17.7, 21.0, 23.1] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['1.0s', '1.2s', '1.2s', '0.6s', '0.0s', '0.0s'] |
| Q20 | Insight: each item says WHY + an attributed READ, two sources each | PASS | see Q23 and sources.md |
| Q21 | Ask beat: the question typed on camera and the real answer, every answer figure verified | PASS | "How did I do this week and this month?" typed (2.1 s), answer on screen 4.5 s; answer figures verified ['+0.84%', '+$2,152', '−$12', '−0.0%', '+$9,327', '+3.8%', '+$14,846', '+6.3%', '+$60,030', '+31.2%', '+$49,777', '+24.6%', '25.0%', '13.2%', '10.6%'] unverified none |
| Q22 | Portfolio-insight beat (Home: total value, Today, All time) with a verified figure | PASS | "My portfolio closed up 0.9%." over Home; facts {"name": "My portfolio", "total": "$259,709", "today": "up 0.9%", "today_usd": "$2,152", "all_time": "28%", "all_time_usd": "$55,059", "week": "down 0.0%", "month": "up 3.8%", "today_note": "Home shows Today as the day's gain over the invested positions (cash excluded)", "biggest_gain": {"name": "Apple", "gain": "$15,912", "pct": "32%"}, "positions": 10} |
| Q23 | 3-5 market items, each why + read on >= 2 independent sources | PASS | Stocks close mixed. (why 2, read 2 publishers); HPE hits record high. (why 2, read 2 publishers); Micron beats on AI. (why 2, read 2 publishers) |
| Q24 | Duration 20-30 s (hard max 30.0) | PASS | 29.42 s |
| Q25 | Edition-correct timing words (close) | PASS | uses 'closed'; wrong-edition words: none |
| Q26 | Upload copy <= 9.9 MB, visually identical (SSIM >= 0.995) | PASS | master 12.70 MB -> upload 9.41 MB, SSIM 0.9989 |
| Q27 | Metadata: first line 'Data as of ...', title <= 70, illustrative line, App Store + about links, #Shorts, tags, no 'demo' | PASS | title 52 chars: "Market Close: Stocks mixed, HPE record, Micron beats"; 7 hashtags |
| Q28 | Whisper round trip: the final mix says the script word for word (figures may differ only in format) | PASS | 73 words; final mix mismatches: none |
| Q29 | Every beat shows the app (no home screen, no blank screen) at 25/50/90% of the beat | PASS | beat 1 sat 5 edge 14.7, beat 2 sat 5 edge 5.3, beat 3 sat 5 edge 5.8, beat 4 sat 5 edge 5.7, beat 5 sat 4 edge 7.0, beat 6 sat 6 edge 9.6 |
| Q30 | Data time-stamp top-left on every frame (same spot), = snapshot within 5 min, edition label right | PASS | "CLOSE / Sep 30 · 9:57 PM ET" at x 61-313, y 110-166 on 10 frames (cover to card); snapshot 2026-09-30 21:57 ET (diff 0 min); label ok |

## Latency per stage (seconds)

| Stage | Seconds |
|---|---|
| research.data | 126 |
| research.llm | 33 |
| research.verify | 29 |
| book.design | 21 |
| research.repair | 4 |
| account.seed | 308 |
| account.brief_check | 0 |
| facts.portfolio | 51 |
| record.take | 215 |
| record.align | 27 |
| facts.ask | 0 |
| storyline.llm | 70 |
| compose | 1 |
| build | 277 |
| qa | 23 |
| **total** | **1185** (19.8 min) |

Not measurable here: how the voices sound against the bed (listen once before posting).
