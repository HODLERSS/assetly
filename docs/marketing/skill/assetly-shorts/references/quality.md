# Quality gate (v1.3.0: Q1-Q41)

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
| Q31 | stamp = the latest time in the Short (research snapshot, main take end, app-shown times, chip quotes) within 5 min, edition label right | day.json stamp + stamp.sources |
| Q32 | Ask: the spoken answer follows ONE recorded answer line (60% of its words, same figures), that line is readable in the answer beat from its FIRST frame (no "Still thinking..." frame; compose starts the beat where OCR first reads the line), and it is outlined | storyline `ask.line`, day.json `quote` + `highlight`, OCR of the final frames |
| Q33 | every $ / % spoken over a beat is readable in that beat: the app's screen or the beat's labelled chip (rounding allowed: 28% <- +28.33%); a direction word about a holding agrees with the day move its page shows (storyline: also cover, title, description; a portfolio figure carries Home's window word; news-timing words need the sources' times) | OCR (Vision) of the final frames at 3/25/50/90% below the subtitle strip |
| Q34 | one moment per Short: every chip's quote time and every time readable in an untagged beat <= the corner stamp (the stamp is the latest data time shown); a pre-open Short shows no "live" intraday quote; an Ask re-recorded later carries its own "ASK RECORDED h:mm" tag | day.json chips/tags + OCR |
| Q35 | every chip / time tag sits in the top-right corner block (x 700-950, above y 450): never over the phone screen or the top texts | alpha bbox of each beat's chip png |
| Q36 | the portfolio beat outlines the Home row its line names ("up 28% all time" -> the All time row; "today" -> Today), and the outline goes off before Home scrolls (`highlight.until`) | day.json beat `highlight`, compose OCR of the take |
| Q37 | framing: the phone's top edge on one row in every beat (+-8 px) and the gap from the subtitles' last line to the phone constant (+-8 px) | final frames at 50/90% of each beat: left rim traced up from y 1500, top = rim start - 11.8% of the body width; text bottom in y 198-500 |
| Q38 | cover hero (when there is one): a verified move (page day move both feeds agree with, or the beat's labelled chip) readable by OCR on frame 0 inside x 60-960, the edition's window label, and the same figure readable in that item's beat | day.json `hero`, OCR of frame 0 and the beat's frames |
| Q39 | end card: the one follow line ("Follow for the open, midday and close") read by OCR at L-1.05 s and L-0.05 s (>= 1 s), no like/subscribe begging | OCR of the end frames |
| Q40 | reach metadata: no hashtag in the title, 3-5 hashtags with #Shorts first and no bait, hidden tags name the cover's companies | youtube-metadata.json |
| Q41 | the 20-minute budget (v1.3.0, owner 10/1): wall time from the run's start to the grade + 10 s <= SHORTS_DEADLINE_S (1200) | run.sh's clock (SHORTS_T0); watchdog.sh refuses a run that reaches the deadline before it delivers |
| Q29 | no loading skeleton / blank screen mid-beat | saturation (home screen) and edge density (blank) on proof/beat*.png at 25/50/90% |

Verification rules worth remembering:
- Voice and screen never disagree: the app shows regular-session moves only, so a pre-market / after-hours figure is said
  with its label word and drawn on the Short's own chip ("PRE-MARKET · 8:47 AM ET / IBM +5.8%"), from a two-feed quote
  taken <= 15 min before the take ends; without one, the line uses what the app shows.
- Narration is second person ("Your portfolio"); only the typed Ask question is in the user's own words.
- Two sources = two publishers AND two different headlines (syndicated copies count once).
- A move is spoken only when the CNBC quote service and the Nasdaq quote API agree (0.05 pt; 0.35 mid-session).
- After-hours / premarket direction needs both feeds' extended quotes; a strong verb (jumped, surged, sank) needs 2%+.
- Portfolio figures: the app's `portfolio` view vs a Nasdaq recompute; any disagreement drops the figure.
- Ask: every $ and % in the on-screen answer must match a cross-checked figure (7- or 30-day windows, either feed).

Korea editions (v1.1.0) read the same rows with these differences: Q25 uses the Seoul timing words ("in Seoul", "so far",
"this month" / "three months", "closed"); Q31 labels "Seoul open" / "Seoul close" (the stamp stays ET wall time); Q33 checks
a window sentence ("fell 28.4% over three months") against the page's own chart header ("Price · 3M" and its change, read by
box on the same line) instead of the session move; Q38's hero is that header change (PAST MONTH / PAST 3 MONTHS); Q39 the
Korea follow line. KRX figures come from Yahoo and Daum's KRX days (kr.py), windows from both histories, won from the app's
USDKRW and CNBC's KRW= (facts refuses when the two rates differ by more than 0.4%).

v1.2.0: `korea-midday` reads like korea-open (live session tolerances) with "this year" / "at midday" (Q25), "Seoul midday"
(Q31), the YTD header (Q33) and THIS YEAR (Q38); Q39 the line "Follow for Korea's chips, 3 times a day". Stale-session
guard: a day move counts only when it was printed in the current session (the app's calendar.ts `withholdStaleMoves`;
Yahoo's KRX feed lags ~20 min, so before the first bar a row still holds yesterday's move): facts withholds it, kr.py's live
quote waits and then refuses it, and an Ask day move verifies only when both feeds carry it and agree. Q28 accepts an
initialism heard letter by letter ("AI" -> "hey i"). Korean newsrooms count as publishers under their ORIGINAL name
(kr_news.py; a Yonhap reprint counts once, never "Naver").
