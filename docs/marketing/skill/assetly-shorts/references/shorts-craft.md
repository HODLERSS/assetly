# YouTube Shorts craft (applied 2026-10-01; never overrides the core principles)

Core principles stay first: every spoken figure is on screen; voice, screen and time agree; second person; the Ask
answer is the app's real answer, visible and outlined; nothing is advice; the owner publishes.

What the skill applies from current Shorts guidance, and where:

| Guidance | Applied as | Where |
|---|---|---|
| Captions 60-75 px at 1080x1920, centred, readable on mute | subtitles 60 px (were 50), centred, max 820 px wide (x 130-950, the Q10 safe zone) | voice-lines.py `size`, make-short.sh `SUB_MAXW` |
| Keep text in the safe zone: ~120 px from the top, clear of the right action rail (~120 px), bottom ~380 px covered by UI | subtitles x 130-950, y 200-468; stamp/disclaimer at the top; nothing the viewer must read below y ~1540 | make-short.sh, Q35 |
| One subject, filling the frame; text tight to it | phone body 860 px wide (was 663), its top on one row (y 508); subtitles end 40 px above it whatever the line count; the eyebrow 16 px above the first line | make-spot.py `phone_w`, `zoom_anchor: top`; make-fill-subtitles.py `SUB_BOTTOM`; Q37 |
| Show the result first; the topic legible in the first 1-2 s on mute (3-6 words) | the headline cover (1.5 s, three short lines) stays | compose cover |
| A new visual beat every 2-3 s (cuts, zooms, text) | beats of 3-6 s, each with a push (now 1.15x, top-anchored so the frame never jumps) and word-by-word subtitle lighting | compose `motion` |
| Point the eye at the one thing that matters | the accent outline on the Ask answer line and on the Home figure the portfolio line names, on only while it is on screen | compose highlights, Q32, Q36 |
| Length 20-30 s, a clean end | hard 20-30 s gate, the end card | make-short.sh |

Sources: unifab.ai/resource/youtube-aspect-ratio, imagevideofit.com/guides/youtube-shorts-safe-zone,
blitzcutai.com/blog/best-caption-size-youtube-shorts-2026, postlinkapp.com/blog/youtube-shorts-size-and-dimensions,
shortimize.com/blog/youtube-shorts-retention-rate, conbersa.ai/learn/best-youtube-shorts-hooks (read 2026-10-01).
