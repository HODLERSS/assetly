# Quality report: assetly-short-2026-09-30-close.mp4

**DELIVERED**: 30/30 metrics pass. Measured against docs/marketing/SHORTS_QUALITY.md (v1.0).

| # | Metric | Result | Measured |
|---|---|---|---|
| Q1 | Duration 20-30 s (video runs the whole file) | PASS | 28.80 s, video 28.800 s |
| Q2 | Format | PASS | 1080x1920 60/1 fps h264 High yuv420p, aac 48000 Hz, faststart=True |
| Q3 | Integrated loudness | PASS | -14.0 LUFS |
| Q4 | True peak | PASS | -1.7 dBTP |
| Q5 | No black frames | PASS | 0 black segments |
| Q6 | No frozen video (outside the end card) | PASS | freezes: none |
| Q7 | Hook by 1.5 s | PASS | voice starts 0.40 s; title card on screen from frame 0 |
| Q8 | Caption sync (first word lit vs speech onset) | PASS | worst 100 ms over 9 sentences: -70, -40, -70, -30, -70, -30, -100, -80, -60 |
| Q9 | Subtitle cap height >= 34 px | PASS | 36 px cap height at 50 px type |
| Q10 | Overlay text inside safe zone (x 60-950, y 100-1536) | PASS | 31 layers checked; union x 60-947, y 110-1229 |
| Q11 | Every figure sourced (two agreeing feeds; disagreements dropped) | PASS | market figures: both quote feeds per item; portfolio: app vs Nasdaq recompute (11/11 kept); Ask: 6 verified |
| Q12 | Pronunciation: speakable() + earAudit() empty on every line | PASS | make-short.sh refuses a line earAudit flags; Whisper round trip in Q28 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q14 | Disclaimer on every frame + description line | PASS | standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27) |
| Q15 | Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA) | PASS | fixed by the toolchain (make-cards.py / make-spot.py) |
| Q16 | Proof frames exported (view them before posting) | PASS | 25 frames in proof/ (make-short's 7 + one mid-beat frame per beat) |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 6 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [6.0, 11.1, 15.9, 19.2, 21.3] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['0.6s', '0.9s', '0.6s', '0.5s', '0.0s', '0.0s'] |
| Q20 | Insight: each item says WHY + an attributed READ, two sources each | PASS | see Q23 and sources.md |
| Q21 | Ask beat: the question typed on camera and the real answer, every answer figure verified | PASS | "How did I do this week and this month?" typed (2.1 s), answer on screen 5.7 s; answer figures verified ['+$659', '+0.3%', '+$10,359', '+5.3%', '+2.5%', '+3.7%'] unverified none |
| Q22 | Portfolio-insight beat (Home: total value, Today, All time) with a verified figure | PASS | "My portfolio closed up 0.8%." over Home; facts {"name": "My portfolio", "total": "$212,918", "today": "up 0.8%", "today_usd": "$1,568", "all_time": "42%", "all_time_usd": "$60,730", "week": "up 0.3%", "month": "up 5.3%", "today_note": "Home shows Today as the day's gain over the invested positions (cash excluded)", "biggest_gain": {"name": "Micron Technology, Inc.", "gain": "$18,206", "pct": "438%"}, "positions": 10} |
| Q23 | 3-5 market items, each why + read on >= 2 independent sources | PASS | HPE hits high. (why 2, read 2 publishers); Intel rallies. (why 2, read 2 publishers); Micron beats. (why 3, read 2 publishers) |
| Q24 | Duration 20-30 s (hard max 30.0) | PASS | 28.80 s |
| Q25 | Edition-correct timing words (close) | PASS | uses 'closed'; wrong-edition words: none |
| Q26 | Upload copy <= 9.9 MB, visually identical (SSIM >= 0.995) | PASS | master 11.56 MB -> upload 9.51 MB, SSIM 0.9993 |
| Q27 | Metadata: first line 'Data as of ...', title <= 70, illustrative line, App Store + about links, #Shorts, tags, no 'demo' | PASS | title 65 chars: "Market Close: Hewlett Packard record, Intel rallies, Micron beats"; 7 hashtags |
| Q28 | Whisper round trip: the final mix says the script word for word (figures may differ only in format) | PASS | 72 words; final mix mismatches: none |
| Q29 | Every beat shows the app (no home screen, no blank screen) at 25/50/90% of the beat | PASS | beat 1 sat 5 edge 4.5, beat 2 sat 5 edge 6.2, beat 3 sat 5 edge 4.0, beat 4 sat 5 edge 6.6, beat 5 sat 4 edge 7.0, beat 6 sat 6 edge 8.8 |
| Q30 | Data time-stamp top-left on every frame (same spot), = snapshot within 5 min, edition label right | PASS | "CLOSE / Sep 30 · 10:32 PM ET" at x 61-325, y 110-166 on 10 frames (cover to card); snapshot 2026-09-30 22:32 ET (diff 0 min); label ok |

## Latency per stage (seconds)

| Stage | Seconds |
|---|---|
| research.data | 122 |
| research.llm | 40 |
| research.verify | 17 |
| research.repair | 41 |
| book.design | 24 |
| account.seed | 318 |
| account.brief_check | 92 |
| facts.portfolio | 57 |
| record.take | 222 |
| record.align | 28 |
| facts.ask | 0 |
| storyline.llm | 38 |
| compose | 1 |
| build | 262 |
| qa | 26 |
| **total** | **1289** (21.5 min) |

Not measurable here: how the voices sound against the bed (listen once before posting).
