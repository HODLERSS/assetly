# Verification · AI investing for everyone (research 04 OCT 2026)

| Short | Length | Picture changes | Loudness | True peak | Upload file | ASR word match | check-explainer.py (30-50s) |
|---|---|---|---|---|---|---:|---|
| 01-nvidia-1000 | 44.25s | 17 (2.6 s each) | -14.16 LUFS | -2.05 dBTP | 2.66 MB | 0.858 | True |
| 02-sp500-ai | 44.25s | 19 (2.3 s each) | -14.07 LUFS | -1.99 dBTP | 2.79 MB | 0.875 | True |
| 03-micron-profit | 48.25s | 19 (2.5 s each) | -14.15 LUFS | -2.04 dBTP | 2.81 MB | 0.895 | True |
| 04-ai-bubble | 47.5s | 18 (2.6 s each) | -14.11 LUFS | -1.99 dBTP | 2.83 MB | 0.929 | True |
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

**v2 (owner, Oct 4: "make the conclusion a bit more positive ... S&P 500 feels like talking about risks only"):** endings now land on the constructive, still-factual side: Nvidia "size it so you can hold through the drops: that's how investors keep their winners"; S&P "the upside: you already own the AI boom" + "know your number, ride the AI boom on your terms"; Micron risk first, then "if margins hold as new factories open, this AI boom has legs"; bubble ends on the evidence so far (Google Cloud profit 3.1x = boom signal); ChatGPT unchanged. "Big Tech plans to spend" (not "on AI": capex is not all AI). Thumbnail hero figures now auto-fit (bubble's "3 numbers" was cut off). Final-mix ASR heard "Assetly" as "we" once in the S&P Short; the isolated take is correct (music masking, not a bad take).
