# Verification · AI investing for everyone (research 04 OCT 2026)

| Short | Length | Picture changes | Loudness | True peak | Upload file | ASR word match | check-explainer.py (30-50s) |
|---|---|---|---|---|---|---:|---|
| 01-nvidia-1000 | 43.5s | 17 (2.6 s each) | -14.19 LUFS | -2.06 dBTP | 2.58 MB | 0.842 | True |
| 02-sp500-ai | 45.5s | 17 (2.7 s each) | -14.13 LUFS | -2.03 dBTP | 2.94 MB | 0.878 | True |
| 03-micron-profit | 47.75s | 19 (2.5 s each) | -14.14 LUFS | -2.09 dBTP | 2.79 MB | 0.893 | True |
| 04-ai-bubble | 48.5s | 18 (2.7 s each) | -14.18 LUFS | -1.97 dBTP | 2.84 MB | 0.929 | True |
| 05-chatgpt-stock | 49.0s | 17 (2.9 s each) | -14.08 LUFS | -1.98 dBTP | 2.79 MB | 0.81 | True |

All 1080x1920, 60 fps, H.264/AAC; master = upload file; picture frames = duration x 60 for every Short (a renderer gap bug was found and fixed this round, see below). Captions <= 2 lines, a figure never split from its unit; content above the caption band.

**Transcripts:** final-mix Whisper vs script differs only in number formatting ("thirty-seven point seven" -> "377", "ChatGPT" -> "chat gpt") and the approved outro heard as "Acetly". One real defect found and fixed: the bubble hook "Three numbers decide it" was heard as "decided" in the isolated take too, so the line became "Three numbers will tell you" (isolated transcript now exact).

**Iterations (this round):**
1. v1 scenes: two layout fixes (Nvidia chart labels over axis/year labels; S&P waffles running into the caption band).
2. Renderer bug: a line whose first word-synced state was not word 0 left a picture gap (Micron: video 45.5 s vs audio 47.8 s). Fixed in render.py (first state covers the line start); the four Oct 5 uploads were re-checked: no gap.
3. Pace: Nvidia, S&P and ChatGPT were at 3.5-4 s per picture; added word-synced reveals to reach 2.5-2.9 s.
4. Micron "data center 11x" re-sourced from the 8-K (Core Data Center BU $1.58B -> $18.0B) instead of a press headline.

**Stillness:** --still-window inside one long scene per Short: mean pixel delta 0.10-0.15 (no motion).
**Not certified:** subjective listening; audience results. No upload performed.
**Timing:** the 20-minute per-clip target was not met end to end (research, a fresh simulator recording, two revision rounds).
