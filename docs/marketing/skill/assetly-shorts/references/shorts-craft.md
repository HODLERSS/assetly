# YouTube Shorts craft (applied 2026-10-01, reach pass v1.0.7; never overrides the core principles)

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
| Thumbnail = frame 0: one big, high-contrast number + the name, 2-4 words | the cover HERO: the biggest verified move among the three stories (name, "+18.3%" ~250 px in the app's gain / loss colour, its window label: SO FAR TODAY / TODAY / PRE-MARKET / AFTER HOURS) over the three headlines; >= 1% or no hero | compose `cover_hero`, make-cards.py `HOOK_HERO`, Q38 |
| Hook in the first 1-2 s with the most surprising fact, no teaser or greeting | storyline prompt: item 1 = the most surprising verified fact (usually the biggest move), cover line 1 = item 1 | storyline.py prompt |
| A brief, contextual end CTA (< 2 s on screen); no "like and subscribe" begging | end card line "Follow for the open, midday and close" (true: three editions every trading day), quicker stagger so it reads >= 1 s; nothing spoken | make-cards.py `END_FOLLOW`, day.json `follow`, Q39 |
| Loop: the last frame hands back to the first | card and cover share the dark ground and the corner stamp, the answer is held into the card, music fades: a replay restarts cleanly on the cover | (existing) |
| Title: curiosity + the searchable name, never hashtags in it | title rule (<= 50, the company named, no hashtags / question bait / caps); compose strips a stray "#" | storyline.py, compose.py, Q40 |
| ~3 hashtags in the description; post-specific + niche tags | description: #Shorts + up to 3 companies + one niche tag (3-5); hidden tags: companies, "<name> stock", niche phrases, brand; never #viral / #fyp | compose `reach_hashtags` / `reach_tags`, Q40 |
| TikTok: hook as the caption's first line, 3-5 hashtags, cover = first frame | tiktok_pack.py: title first, companies + #stocks + #Assetly; tiktok.json `cover` | tiktok_pack.py |

## Deliberately NOT applied (they conflict with a principle or are the owner's call)

- A spoken "like / subscribe" or "follow" line: it would spend the 56-word budget on words with no verified content, and a
  plea three times a day reads as begging. The CTA lives on the silent end card only.
- Broad bait tags (#viral, #fyp, #foryou) and curiosity-gap titles that the video does not pay off: misleading metadata.
- A hero number the viewer cannot then read in the Short, a rounded-up "nearly 20%", or a pre-open hero from the app page
  (it shows the previous session): voice, screen and time must agree, so the hero is the page's own move (two feeds
  agree) or the labelled chip, and is dropped otherwise.
- Cutting to <= 20 s (the video's advice for view-vs-swipe): the owner set 20-30 s; the 3 items + portfolio + Ask do not
  fit 20 s with verified wording. Revisit only with the owner.
- Fewer uploads (the video: one a day for channels under ~100k subs, so each Short gets time to find its audience): the
  three editions are the owner's product decision. Flagged to the owner, not changed.
- Delete-and-reupload a Short that stalls under ~100 views in 48 h: the owner publishes; a re-upload is the owner's call
  (and duplicate uploads can read as spam). Not automated.
- Warming up a new account before posting (likes, comments): the owner's account, never automated.
- Custom thumbnail upload by API: `thumbnails.set` needs the youtube / youtube.force-ssl scope (our token is
  youtube.upload only). `thumbnail.png` (= frame 0) is delivered; Studio on desktop can take it where the channel has
  custom Shorts thumbnails, and in the phone app the owner picks the first frame.

Sources: unifab.ai/resource/youtube-aspect-ratio, imagevideofit.com/guides/youtube-shorts-safe-zone,
blitzcutai.com/blog/best-caption-size-youtube-shorts-2026, postlinkapp.com/blog/youtube-shorts-size-and-dimensions,
shortimize.com/blog/youtube-shorts-retention-rate, conbersa.ai/learn/best-youtube-shorts-hooks (read 2026-10-01).
Reach pass (v1.0.7): "If your shorts get under 1,000 views... do this" (Dan the creator, youtube.com/watch?v=Jc_-IPaW2pg,
transcript read 2026-10-01); joinbrands.com/blog/youtube-shorts-best-practices, socialmediaexaminer.com (hooks and
curiosity loops), thumbnailtest.com/guides/add-thumbnail-youtube-shorts, creatortoolly.com/youtube-shorts-custom-thumbnails.
