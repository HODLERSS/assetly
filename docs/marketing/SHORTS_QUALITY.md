# Daily Short: quality bar

Every daily market Short is measured against this list before it is handed over. Each metric is
pass/fail; a Short ships only when every row passes. `web/ios/App/marketing/shorts/qa-short.py`
measures the automatic ones and writes the report; the rest are checked by a person (or the agent)
with the proof frames open, and recorded in the same report.

| # | Metric | Pass when | How it is measured |
|---|---|---|---|
| Q1 | Duration | 20.0 to 25.0 s, and the video stream ends within 0.04 s of the file (one AAC frame + one video frame) | ffprobe format and stream durations |
| Q2 | Format | 1080x1920, 60 fps (30 allowed), H.264 High, yuv420p, AAC 48 kHz, faststart | ffprobe streams + moov before mdat |
| Q3 | Loudness | integrated -14 LUFS ±1 | ffmpeg `ebur128=peak=true` |
| Q4 | True peak | <= -1.5 dBTP | same pass |
| Q5 | No black frames | zero black segments >= 0.1 s | `blackdetect=d=0.1:pix_th=0.05` (the dark canvas is #14181F, above the threshold) |
| Q6 | No frozen video | no freeze >= 2.0 s, except a declared hold (freeze beats, the end card) | `freezedetect=n=0.001:d=2` |
| Q7 | Hook by 1.5 s | the title card's text is fully in by 1.5 s and the voice has started | proof frame at 0.5 s and 1.5 s; voice onset from the voice track |
| Q8 | Caption sync | every sentence's subtitle starts within 150 ms of that sentence's measured speech onset | onsets from the rendered voice track (energy > -35 dB after a gap), vs the subtitle cue start |
| Q9 | Caption legibility | spoken-subtitle cap height >= 34 px at 1080 wide (~3.1% of height); eyebrow >= 20 px | measured from the rendered subtitle glyph box |
| Q10 | Safe zones | all text (captions, subtitles, disclaimer, card text) inside y 100 to 1536 and x 60 to 950 | glyph bounding boxes of every text layer |
| Q11 | Every figure sourced | each spoken and on-screen number has two agreeing sources in the sources table; a figure the sources disagree on is dropped, not guessed | `sources.md` |
| Q12 | Pronunciation | every name and number word in the script is in the listen-check list, spelled for the ear by `speakable()` (no digits, no tickers) and `earAudit()` returns nothing | `narrate/ear.ts` on the script; person listens once |
| Q13 | No advice, hype or jargon | zero hits from the word list below in the script, captions and metadata | regex scan |
| Q14 | Disclaimer | "Not financial advice" visible small on every frame and on the end card; the description says "Portfolio shown is illustrative. Not financial advice." | proof frames + metadata |
| Q15 | Brand | Schibsted Grotesk type, Assetly dark ground #14181F / ink #E9ECF1 / accent #8B98E0, app icon and "Assetly" on the end card, App Store CTA | proof frames |
| Q16 | Proof frames viewed | frames at 0.5, 3, 8, 13, 18 s and the last frame exported and looked at; nothing clipped, overlapped or misspelled | `proof/` |
| Q17 | No "demo" | zero case-insensitive hits for "demo" in the script, subtitles, cover/eyebrow/card strings and metadata (owner, 9/30: the portfolio is described only as illustrative, in the description) | regex over every viewer-facing string |
| Q18 | Consistent motion | every beat carries the SAME push (scale, in-duration, out-duration, smootherstep; the last beat holds it into the card) and every cut lands on the 0.3 s music grid (an eighth at 100 BPM) | read from the built plan.json |
| Q19 | Real scrolling | at least 3 beats whose source footage scrolls for >= 0.5 s (frame-to-frame row change in the take) | frame differencing of each beat's source window |
| Q20 | Insight, not headlines | each story line says WHY it moved and the market or community SENTIMENT, attributed ("analysts", "commentators"), and every claim has two sources in sources.md | sources.md insight table |

**Q13 word list** (case-insensitive, whole words): buy, sell, should, must-own, recommend, guaranteed,
skyrocket, soar, soars, soaring, explode, moon, crush, crushed, massive, insane, huge, don't miss, act now,
best stock, secret, bagger, to the moon, YOLO, alpha, beta, EPS, P/E, guidance, bps, basis points, multiple,
catalyst, thesis, tripwire, setup, capex, TAM. Also no em dashes and no emoji.

**Why these.** A Short is seen muted, on a phone, under the platform's own chrome: the subtitles have
to carry the story by themselves (Q8, Q9), and anything in the bottom fifth or the right edge is covered
by the title, channel name and action buttons (Q10). It is a financial video from a real brand, so a
wrong number (Q11) or a sentence that reads as advice (Q13, Q14) costs more than any visual flaw.
