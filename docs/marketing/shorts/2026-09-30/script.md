# Script: 2026-09-30 Short (Demo Portfolio 001)

Four lines, three voices, handed over with a 0.17 s touch (no overlap). Every line is on screen as a word-synced subtitle with an eyebrow naming the story, and five speaking-indicator pills move with whoever is talking, so a muted viewer can follow each line.

| # | Voice | Spoken (ear-ready: numbers as words) | On screen |
|---|---|---|---|
| 1 | marin (OpenRouter openai/gpt-audio) | AI stocks today. Micron beat after the bell, with record revenue of fifty-four point two billion dollars. | AI stocks today. / Micron beat after the bell, with record revenue of $54.2 billion. |
| 2 | cedar (OpenRouter openai/gpt-audio) | Google rose zero point nine percent as it launched Gemini four. | Google rose 0.9% as it launched Gemini 4. |
| 3 | marin (OpenRouter openai/gpt-audio) | Meta slipped one point eight percent, ending a September rally driven by its Muse AI app. | Meta slipped 1.8%, ending a September rally driven by its Muse AI app. |
| 4 | Minjae voice clone (ElevenLabs eleven_v4), the app's brief voice | This demo portfolio closed up zero point two percent. That's your brief. | This demo portfolio closed up 0.2%. / That's your brief. |

gpt-audio lines: brisk news-anchor prompt, read-verbatim check on the returned transcript, pauses over 0.3 s shortened, +6% pitch-preserving tempo (as the launch clip). Minjae line: the verified ElevenLabs take, unaltered.

**Timeline** (seconds in the final file)

| Time | Picture | Voice / words |
|---|---|---|
| 0.00 to 1.89 | Title card "AI stocks today / September 30" (thumbnail), slow 5% push | marin: "AI stocks today." |
| 1.89 to 7.30 | Micron page, frozen; slow push-in, '0.00% today · closed 4:00 PM ET' highlighted | marin: "Micron beat after the bell, with record revenue of $54.2 billion." |
| 7.30 to 11.18 | Google page scrolling to Assetly Intelligence; push-in, the Gemini 4 bullet highlighted | cedar: "Google rose 0.9% as it launched Gemini 4." |
| 11.18 to 17.18 | Meta page, frozen; slow push-in, '-1.84% today · closed 4:00 PM ET' highlighted | marin: "Meta slipped 1.8%, ending a September rally driven by its Muse AI app." |
| 17.18 to 20.64 | Home; push-in, 'Today +$336 (+0.16%)' highlighted | Minjae: "This demo portfolio closed up 0.2%." |
| 20.64 to 22.04 | The close brief open, its player running; push-in held into the end card | Minjae: "That's your brief." |
| 21.44 to end | End card: icon, Assetly, "Your portfolio, explained daily", "Demo portfolio. Not financial advice.", Available on the App Store | music resolves |

The standing line "Demo portfolio · Not financial advice" sits at the top of every product frame.

**Alternate cut:** `assetly-short-2026-09-30-alt-minjae-voice.mp4` is the first delivery (commit 66b8c12), the whole script in the Minjae voice clone, same stories and figures, 24.83 s. Kept for comparison.
