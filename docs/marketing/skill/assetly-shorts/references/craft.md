# Craft: what an Assetly Short looks and sounds like

Distilled from `docs/marketing/README.md` (the launch clips), the 9/30 Short (v1 and the v2 rebuild) and the owner's
reviews. Every rule here is enforced by code where code can enforce it; the rest is on the person looking at the frames.

## Owner rules (9/30 reviews, all still apply)

- Never say or show "demo". The description says "Portfolio shown is illustrative. Not financial advice."
- Show real numbers: total value, Today $ and %, All time, a holding's value and gain, the movers.
- Research and design an interesting, believable portfolio BEFORE recording ($150-300k, the day's story names held).
- Build from scratch every run (new research, new book, new take, new voices).
- Insight, not headlines: each story says WHY it moved and the market or community READ, attributed
  ("analysts", "commentators", "investors"), each on two sources.
- Real scrolling footage: at least three beats scroll (Q19).
- One camera language: the same push (1.3x, in 0.7 s, out 0.6 s, smootherstep) on every beat; cuts on the 0.3 s grid
  (an eighth at 100 BPM); the last beat holds its push into the end card.
- v1.0.7 (reach): when one of the three stories moved >= 1% and the viewer will read that move in its beat (the page,
  both feeds agreeing, or the labelled chip), the cover leads with it: the name, the move very large in the gain / loss
  colour, the window label (SO FAR TODAY / TODAY / PRE-MARKET / AFTER HOURS); the headlines stack smaller beneath.
  The end card adds one accent line, "Follow for the open, midday and close", above the App Store button. Nothing
  spoken is added.
- Headline-led cover, fully drawn at frame 0 (it is the thumbnail): kicker "MARKET CLOSE · SEP 30", three lines with the
  company names in the accent, "Assetly" under the rule.
- Word-synced subtitles with a story eyebrow per sentence (MICRON · AFTER THE BELL / MICRON · THE READ), five speaking
  pills over the strip while anyone talks.
- "Not financial advice" small at the top of every frame and on the end card.
- The data time-stamp in ONE fixed corner, top-left (x 60, y 104), on every frame from the cover to the end card:
  "CLOSE" (tracked accent eyebrow) over "Sep 30 · 4:05 PM ET" (ink). The time is when the quotes were captured.
  The description's first line repeats it: "Data as of Sep 30, 2026 4:05 PM ET".
- -14 LUFS integrated, <= -1.5 dBTP; Whisper returns the script word for word.
- Numbers are spoken as words by the product's own `narrate/ear.ts speakable()`; `earAudit()` must be empty.
- No advice or hype words, no em dashes, no jargon: never thesis, tape, book, print, catalyst, guidance, capex, EPS.
- An after-hours or disputed figure is dropped unless two sources agree.

## v1.0 additions (owner, 9/30 evening)

- Three editions a day (pre-open, midday, close), each useful on its own: the top 3-5 things to know, AI-focused but
  not only AI (macro, Fed, big earnings, sector moves, other hot stocks).
- Ask on camera: the question typed in the app, the real answer appearing, its figures verified.
- The portfolio's own story, not only company news: today / this week / this month, a holding's gain; lean into a
  positive, true note when the data supports it; never fabricate.
- 20-30 s, hard max 30.0 s. Hook inside the first 1.5 s (the cover is on screen from frame 0 and the first voice
  starts at 0.3 s).

## Voices

- Market items: OpenRouter `openai/gpt-audio`, `marin` and `cedar`, alternating, +10% pitch-preserving tempo, pauses
  over 0.3 s shortened, read-verbatim transcript check.
- The portfolio line and the Ask answer: the app's own brief voice (the Minjae ElevenLabs clone,
  `wcVi1Dm6pTXH8UsICsKk`, eleven_v4 while the free window lasts, ~Oct 12).
- The Ask question: the gpt-audio voice that did not read the last item, while the question is typed on screen.
- Hand-offs touch, never overlap (0.17 s gap); the bed ducks by sidechain, -6 to -12 dB.

## Picture

- Real 60 Hz display recording of the iPhone 17 Pro simulator (`simctl io recordVideo`), dark theme, status bar 9:41,
  app uninstalled before every take (Appearance persists otherwise).
- Position pages on 1D (1W before the open) so the chart agrees with the spoken day move.
- Keep a figure no source confirms out of any zoomed frame.
- End card: icon, Assetly, "Your portfolio, explained daily", "Not financial advice.", "Available on the App Store".

## Words

- Hook first: the cover carries the edition and the three headlines; the voice opens straight on the first story.
- Item: sentence 1 = what happened and WHY (<= 13 words); sentence 2 = the attributed READ (<= 8 words).
- Company names, never tickers. Figures as digits on screen, as words in the voice.
- Edition tense: pre-open "this morning / before the bell / futures"; midday "so far / this afternoon"; close
  "closed / today / after the bell".
- About 55-60 spoken words in total (the Short must end by 30.0 s including the 2 s card).
