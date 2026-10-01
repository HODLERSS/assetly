# Quality report: assetly-short-2026-10-01-preopen.mp4

**DELIVERED**: 29/29 metrics pass. Measured against docs/marketing/SHORTS_QUALITY.md (v1.0).

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
| Q11 | Every figure sourced (two agreeing feeds; disagreements dropped) | PASS | market figures: both quote feeds per item; portfolio: app vs Nasdaq recompute (11/11 kept); Ask: 2 verified |
| Q12 | Pronunciation: speakable() + earAudit() empty on every line | PASS | make-short.sh refuses a line earAudit flags; Whisper round trip in Q28 |
| Q13 | No advice / hype / jargon words, em dashes, emoji | PASS | hits none, em dash False, emoji 0 |
| Q14 | Disclaimer on every frame + description line | PASS | standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27) |
| Q15 | Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA) | PASS | fixed by the toolchain (make-cards.py / make-spot.py) |
| Q16 | Proof frames exported (view them before posting) | PASS | 25 frames in proof/ (make-short's 7 + one mid-beat frame per beat) |
| Q17 | No "demo" in voice, subtitles, cards, metadata | PASS | 0 hits |
| Q18 | Consistent motion (same push on every beat, cuts on the 0.3 s grid) | PASS | 6 beats, push [(1.3, 0.7, 0.6), (1.3, 0.7, None)]; cuts [4.5, 9.6, 14.4, 18.0, 19.8] |
| Q19 | Live scroll segments >= 3 | PASS | 4 beats scroll; moving time per beat ['0.7s', '1.1s', '0.7s', '0.6s', '0.0s', '0.0s'] |
| Q20 | Insight: each item says WHY + an attributed READ, two sources each | PASS | see Q23 and sources.md |
| Q21 | Ask beat: the question typed on camera and the real answer, every answer figure verified | PASS | "What's ahead for my portfolio today?" typed (1.8 s), answer on screen 4.5 s; answer figures verified ['+$1,848', '+0.98%'] unverified none |
| Q22 | Portfolio-insight beat (Home: total value, Today, All time) with a verified figure | PASS | "Yesterday my portfolio rose 1.0%." over Home; facts {"name": "My portfolio", "total": "$197,353", "today": "up 1.0%", "today_usd": "$1,848", "all_time": "31%", "all_time_usd": "$45,791", "week": "down 0.2%", "month": "up 2.0%", "today_note": "Home shows Today as the day's gain over the invested positions (cash excluded)", "biggest_gain": {"name": "Apple", "gain": "$15,634", "pct": "31%"}, "positions": 6} |
| Q23 | 3-5 market items, each why + read on >= 2 independent sources | PASS | Futures point higher. (why 2, read 2 publishers); Kashkari eyes more hikes. (why 2, read 2 publishers); Accenture reports today. (why 2, read 2 publishers) |
| Q24 | Duration 20-30 s (hard max 30.0) | PASS | 26.11 s |
| Q25 | Edition-correct timing words (preopen) | PASS | uses 'Futures'; wrong-edition words: none |
| Q26 | Upload copy <= 9.9 MB, visually identical (SSIM >= 0.995) | PASS | master 12.75 MB -> upload 9.42 MB, SSIM 0.9988 |
| Q27 | Metadata: title <= 70, illustrative line, App Store + about links, #Shorts, no 'demo' | PASS | title 65 chars: "Before The Bell: Futures up, Kashkari on hikes, Accenture reports"; 7 hashtags |
| Q28 | Whisper round trip: the final mix says the script word for word (figures may differ only in format) | PASS | 62 words; final mix mismatches: none |
| Q29 | Every beat shows the app (no home screen, no blank screen) at 25/50/90% of the beat | PASS | beat 1 sat 5 edge 15.9, beat 2 sat 5 edge 12.4, beat 3 sat 5 edge 3.6, beat 4 sat 5 edge 7.4, beat 5 sat 4 edge 7.3, beat 6 sat 6 edge 12.5 |

## Latency per stage (seconds)

| Stage | Seconds |
|---|---|
| research.data | 142 |
| research.llm | 46 |
| research.verify | 5 |
| research.repair | 34 |
| book.design | 13 |
| account.seed | 339 |
| account.brief_check | 164 |
| facts.portfolio | 33 |
| record.take | 153 |
| record.align | 20 |
| facts.ask | 0 |
| storyline.llm | 69 |
| compose | 0 |
| build | 238 |
| qa | 28 |
| **total** | **1284** (21.4 min) |

Not measurable here: how the voices sound against the bed (listen once before posting).
