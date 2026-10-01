# Quality gate (v1.0)

The canonical list is `app/docs/marketing/SHORTS_QUALITY.md` (Q1-Q20 from the 9/30 Shorts, Q21-Q29 added by v1.0).
`run.sh` measures every automatic row and refuses to deliver when any fails.

| # | Metric | Where it is measured |
|---|---|---|
| Q1 | Duration 20-30 s, video runs the whole file | make-short `qa-short.py` (`SHORT_LEN_RANGE`) |
| Q2 | 1080x1920, 60 fps, H.264 High, yuv420p, AAC 48 kHz, faststart | qa-short.py |
| Q3 / Q4 | -14 LUFS ±1 / <= -1.5 dBTP | qa-short.py (ebur128) |
| Q5 / Q6 | no black frames / no frozen video outside the card | qa-short.py |
| Q7 | hook by 1.5 s (cover from frame 0, voice starts ~0.3 s) | qa-short.py |
| Q8 | caption sync <= 150 ms per sentence | qa-short.py |
| Q9 / Q10 | subtitle cap height >= 34 px / text inside the safe zone | qa-short.py |
| Q11 | every figure on two agreeing sources | research.py, facts.py |
| Q12 | speakable() + earAudit() empty | make-short.sh (refuses a line) |
| Q13 | no advice / hype / jargon (incl. tape, book, print), em dash, emoji | qa-short.py + storyline.py |
| Q14 | "Not financial advice" on every frame + description line | plan overlay + Q27 |
| Q15 | brand | toolchain |
| Q16 | proof frames exported (and looked at by the operator) | qa_deliver.py |
| Q17 | no "demo" anywhere | qa-short.py |
| Q18 | one push on every beat, cuts on the 0.3 s grid | qa-short.py (plan) |
| Q19 | >= 3 beats with real scrolling | qa-short.py (frame differencing) |
| Q20 | insight: WHY + attributed READ, two sources each | research.py judge + qa_deliver.py |
| Q21 | Ask beat: typed question (>= 1.2 s), real answer (>= 2.5 s), answer figures verified | facts.py --ask, timing.json |
| Q22 | portfolio-insight beat with a cross-checked figure | facts.json, day.json |
| Q23 | 3-5 market items, two independent sources each | research.json |
| Q24 | 20.0-30.0 s | ffprobe |
| Q25 | edition-correct timing words | regex on the script |
| Q26 | upload copy <= 9.9 MB, SSIM >= 0.995 | ffmpeg ssim |
| Q27 | metadata (first line "Data as of ...", tags, title <= 70, illustrative line, two links, #Shorts, no "demo") | youtube-metadata.json |
| Q28 | Whisper round trip word for word | faster-whisper small.en on the final file |
| Q30 | data time-stamp top-left, same spot, on every sampled frame | stamp box contrast + drift on cover/beats/card |
| Q31 | stamp = snapshot within 5 min, edition label right | day.json stamp vs research asof |
| Q29 | no loading skeleton / blank screen mid-beat | saturation (home screen) and edge density (blank) on proof/beat*.png at 25/50/90% |

Verification rules worth remembering:
- Two sources = two publishers AND two different headlines (syndicated copies count once).
- A move is spoken only when the CNBC quote service and the Nasdaq quote API agree (0.05 pt; 0.35 mid-session).
- After-hours / premarket direction needs both feeds' extended quotes; a strong verb (jumped, surged, sank) needs 2%+.
- Portfolio figures: the app's `portfolio` view vs a Nasdaq recompute; any disagreement drops the figure.
- Ask: every $ and % in the on-screen answer must match a cross-checked figure (7- or 30-day windows, either feed).
