# Assetly launch clip

Four files, same take, same cut, same bed — pick a theme and an aspect:

| | 4:5 (1080x1350) | 1:1 (1080x1080) |
|---|---|---|
| **Light** | `assetly-light-4x5.mp4` | `assetly-light-1x1.mp4` |
| **Dark** | `assetly-dark-4x5.mp4` | `assetly-dark-1x1.mp4` |

**19.8 seconds, with music and one spoken line, captioned, real app footage in an iPhone 17 Pro body,
ending on a card.**
4:5 is the default; use square only if a surface demands it. Light and dark are the same clip shot
twice — post whichever reads better in the feed you are posting to.

Audio measures −14.2 LUFS integrated with a −1.5 dBFS peak on all four, which is the streaming
loudness target, so no platform will re-level them. Video is CRF 17 / veryslow H.264 High from a
near-lossless intermediate, so only one generation of x264 sits between the footage and the post.

## The cut

Seven beats on a bar grid at 100 BPM (one bar = 2.4s), 16.8s of product crossfaded one beat (0.6s)
into a 2.4s end card. Every cut and the fade to the card land on a bar line, which is what makes the
edit feel cut *to* the music rather than laid over it.

| # | Beat | Bars | Caption |
|---|---|---|---|
| 1 | Home, net worth | 1 | Everything you own, in one place |
| 2 | The book scrolling | 1 | Live prices, every position |
| 3 | Brief opened | ½ | A brief on what moved, and why |
| 4 | Narration player up; the voice starts with it | 1½ | Listen to it on the way in |
| 5 | NVDA, chart and intelligence | 1 | A read on every holding |
| 6 | News | ½ | Only the news that touched your book |
| 7 | Ask, question and answer | 2 | Like having an analyst on call |

Seven and a half bars of product (18.0s), one beat of crossfade, 2.4s card: 19.8s. The player beat
is a bar and a half so the spoken line fits inside it: the player, the caption and the voice all
begin at 6.0–6.15s, and the music fades out over the last three seconds, through the card.

No unit claims anywhere in the copy: not "every minute", not "two-minute brief", not "ninety seconds".
Numbers in a caption invite the viewer to audit the number instead of wanting the product, and they
date badly. Ask is framed as a person rather than a feature, which is what it actually feels like.

Ask gets the longest beat because it is the differentiator, and because the tap and its answer stay in
one continuous shot — the model answers in about 5s once warm, which is what makes that possible. The
first take ended on the typing indicator and was discarded.

## The music

`marketing/make-music.sh` builds the bed from **Apple Loops** already installed with GarageBand /
Logic. They are licensed royalty-free for use in your own productions, which is why they are the
source rather than a stock library: no attribution, no per-post licence, nothing to renew.

One loop family ("Forward Progress" bass, synth and guitar — same key, same tempo) plus a clap beat,
arranged bass → beat at bar 2 → synth at bar 3 → guitar at bar 5, so the track builds under the clip
instead of sitting flat. The loops are natively 100 BPM and a whole number of bars, which is where the
video's 2.4s grid comes from.

Mastered with `alimiter` then `loudnorm=I=-15`; the bed resolves under the end card rather than
stopping with the footage, and `finish-clip.sh` adds a short safety fade at the cut. Delivered as
256k AAC through `aac_at`, Apple's AudioToolbox encoder.

### Decode the loops with `afconvert`, never ffmpeg

The first cut had the drums stumbling, and the cause was not the arrangement. These loops are **AAC
inside CAF**. ffmpeg decodes the encoder's priming frames as audio and returns **4.852979s for a loop
that is exactly 4.800000s** — 2,543 samples of lead-in that are not part of the music. `-stream_loop`
then repeats the error, so every bar lands ~53ms later than the last, and the stems drift apart from
each other as well as from the video's grid.

`afconvert -f WAVE -d LEI24@48000` honours the CAF packet table and returns the loop sample-exact
(230,400 samples = 4.800000s). `make-music.sh` asserts every decoded loop is a whole number of bars
and fails rather than shipping one that is not.

Measured on the finished file, isolating the clap band: each 2-bar cycle now cross-correlates against
the first at **+0.0ms**. Before the fix the same measurement drifted 141ms across the clip.

## The spoken line

At 6.15s, on the beat where the narration player appears and for the length of that beat, a voice reads:

> "Good morning. Your upside hinges on NVIDIA's earnings."

That is not copy written for the video. It is a sentence from the **narration script Assetly actually
generated** for the demo account on the day of the take (`daily_briefs.script`, 2026-09-21 morning).
The clip claims the app reads you a brief, so the line is what the app wrote.

Rendered by **`openai/gpt-audio` through OpenRouter**, voice `marin`, via `marketing/make-voiceover.py`.
Two things about that endpoint cost time: OpenRouter returns `400 "Audio output requires stream: true"`
for any audio request without streaming, and the streamed audio arrives as headerless base64 PCM at
**24 kHz mono** — the model's native rate, resampled once to 48 kHz with `afconvert --src-complexity
bats` rather than left to a player. The system prompt is load-bearing: without it the model *answers*
the line instead of reading it.

The bed ducks **−8.8 dB** under the line and recovers to **+0.0 dB** after it, via a sidechain
compressor keyed off the voice, not a hand-drawn volume envelope — the sidechain re-times itself when
the line or the edit changes. Measured in the speech band the voice lifts the midrange +7.2 dB while
overall level stays flat, which is what a duck is supposed to look like.

`mix-voiceover.sh` asserts the duck lands between −6 and −12 dB and that the bed recovers, so a
re-render cannot silently drift. Sweep against **its own printed figure**, never a raw render: the key
is the companded, loudness-matched voice, and it drives the detector several dB harder than the file
the model returns (−9.5 dB with a raw key vs −12.9 dB with the real one).

### Two things that fought back

**`loudnorm` does not belong on a ducked mix.** It is dynamic, so it rides the duck back up and closes
the gap it exists to open; and it consumes a ~0.75s lookahead, returning a stream that much shorter
than asked, which left the bed ending before the video. The mix now hits −14 LUFS with a *measured
static gain* instead: sample-exact, and the duck survives.

**Dropping `loudnorm` also drops its `TP=-1.5` ceiling.** The first mix came back at −0.9 dBFS, legal
as a sample peak but close enough that AAC's reconstructed intersample peaks would clip on some
decoders. The limiter now carries that number (`limit=0.84`).

### Adding it to finished clips

`add-voiceover.sh` re-muxes with **`-c:v copy`**. The video stream of every delivered file is
MD5-identical to the pre-voiceover master — the grade, the captions and the card are bit-for-bit
untouched, and no generation of x264 was spent on an audio change.

The OpenRouter key is read from `OPENROUTER_API_KEY` or `~/.private_keys/openrouter.txt`, both
outside the repo.

**Dark 4:5 carries a second line and a speaking indicator.** marin's NVIDIA line (sped 6%,
pitch-preserving) fades over its last 0.9s from 8.8s, and as its last word ends a second narrator, `cedar`,
comes in at 9.45s, 2 dB up and with no fade-in, with *"Meta's surging by ten percent. Muse, number one on the App Store."* (sped 8%; rendered
with a brisk-delivery prompt via `VO_PACE`). They are panned a third left and right; the bed stays ducked under both. An earlier 0.75s overlap
with a fade-in buried Meta's first word under marin's "earnings" — the handover is now a touch, not
an overlap: marin's tail is already 4 dB down when cedar's first syllable lands. Cues in
`mix-spot-audio.sh` take `start:file:fade_out:fade_in:pan`, and `VO_OUT` keeps the summed voice.

While either voice is speaking, five small pills above the caption follow five bands of that voice
track (`make-speaking.py`: FFT per frame, each band scaled to its own loud moments, fast attack and
slow release, presence-gated so they vanish between lines). A raw waveform was tried first and
disappeared on every quiet syllable. Nothing is drawn on the phone screen itself. Light and the two
squares keep the single line and no indicator.

**Dark 4:5 is built through `make-spot.py`** (`spots/dark-4x5-linkedin.json`, subtitles in
`spots/dark-4x5-fill.json`). Its grammar, after the revamp and a reference pass on a well-made app
demo Short (Brush Circle, "App demo video 1"): the **caption strip is on top** (168px: speaking
pills in rows 0-44, an accent EYEBROW at 50, the headline or spoken subtitle from 82), the phone
below with a 40px foot. Captions are two-tier, `EYEBROW|Headline` ("HOME | Everything you own, in
one place"), and each spoken line carries an eyebrow too (MORNING BRIEF / NEWS / ASK). Beats join
with a 0.4s **screen-to-screen slide** centred on the cut (a plain cut where the next beat is the
same screen: live scroll -> its frozen frame), and the phone **rises into frame** over the opening
0.6s. Every push keeps the phone centred (focus x is the phone centre; targets are SOURCE pixels
converted by the compositor): net worth 1.6x, positions 1.5x, the brief 1.4x under the NVIDIA
line, the Muse bullet 1.8x on a frozen News frame with a highlight, the answer 1.7x held into the
card with its first sentence highlighted. The Meta line starts 0.55s after the NVIDIA line ends;
Ask shows 1.3s of thinking, then the answer, and the ASK caption hands over to the NVDA subtitle
mid-beat (`caption_dur`). Slides need care: xfade shows the second clip half a slide BEFORE the cut,
so a beat entered by a slide is rendered from half a slide earlier (a head) and one exiting by a
slide carries half a slide of extra footage (a tail), and beat-time stays the cut; the first build
without heads drifted 0.2s per slide. Cut list from a reference is read with `yt-dlp`
(`player_client=android` when the default 403s), a 2 fps frame sheet, `select=gt(scene,0.3)` and
per-second RMS. What was NOT taken from the reference: its flat pastel ground, its loud
voice-less track, and its 4s outro.

**Versions.** Every delivered dark 4:5 is also saved as
`~/Desktop/assetly-linkedin/versions/assetly-dark-4x5_YYYYMMDD_HHMM.mp4` (local only; git history
holds the repo copies). **Current cut (2026-09-24):** HOME 3.6s (rise-in, push 2.15x framed from the figure down through the Movers rows — the
screen's width fills the frame, the most the left-aligned UI allows without cutting row values —
hold ~1.4s) · POSITIONS 2.4s (the list's own scroll, no push) · MORNING BRIEF 3.6s under the NVIDIA
line (push 1.5x with the "NVDA at 19.3% of assets…" sentence highlighted from its first word (two boxes,
one per line, so "today." is excluded), hold 1.5s) · NEWS live
scroll 1.0s → frozen 3.2s (push 1.8x, Muse bullet highlighted, hold 1.5s) · ASK 4.2s (1.3s thinking,
push 1.7x on the answer's first sentence, highlighted, held into the card). The "what moved, and
why" beat was cut as redundant with the brief under the NVIDIA line. Every push: ~1s in, ~1.5s hold,
~0.6s out; all three spoken lines have a highlight so the eye knows what the voice is about.

**Two camera moves (dark 4:5), each into the thing being said.** During the Meta line the News
screen first scrolls LIVE for 1.2s (57.3-58.5s of the take), then freezes on the scrolled frame and
the camera pushes 1.5x toward the bullet **"Meta surge 11% on Muse AI excitement"** while a rounded
accent highlight fades up around it; the highlight is laid on the screen before the scale so it
rides the zoom, and its opacity follows the move's own curve. The freeze is mid-scroll on purpose:
the take's momentum carries that bullet off the top by 59.6s. The move eases in over 1s, holds
through the line, and settles before the cut. The Ask beat opens 1.3s before the answer so the thinking dots are seen; as the answer lands, 1.45x toward the first sentence ("Your biggest position is NVDA at $682,140 (about 19% of your book)."), highlighted the same way,
brought to the stage centre, and HELD: the ending dissolves (0.8s) from the magnified answer
straight into the card, no settle-back. The NVIDIA line has no move: the player pop is the event
there. Smootherstep both ways, Lanczos; the focus point travels to its target while the scale rises.
A lower-third scrim on the same curve sits under the text zone so the magnified screen passes
beneath the captions and nothing shows at rest. The second subtitle now ends 0.12s after its last
word so it is gone before the cut. Learned on the way: a uniform push on every beat reads as the
phone changing size; ffmpeg's `crop` evaluates its offsets once, so per-frame offsets go through
`overlay`; an image input for the scrim needs `-framerate 30` or the beat ends a frame early.
`make-spot.py` takes `"zoom": {"to", "focus": [x,y], "target": [x,y], "in", "out"|omitted=held}`,
`"freeze": true` and `"highlight": {"box": [x0,y0,x1,y1]}` per beat.

**A third voice on the Ask beat.** While the answer's first sentence is highlighted, `shimmer` —
prompted as a news anchor in her twenties landing a headline, punchy on the first two words then
brisk — reads *"Biggest position: NVIDIA. Nineteen percent, up three point four this month."*
(the app's own answer; 14.85-19.3s, starting with the highlight and finishing over the card).
Sped 20% to fit; levelled with the Meta line (0 dB). What makes it carry is presence, not level: a
2.5 dB lift at 3 kHz and 1.5 dB at 200 Hz with light compression on that cue only, a per-cue ONSET
boost (+3.5 dB on the first word, decaying over 0.5s; the other lines get 1.5/2), the duck KEY leading
every voice by 120 ms, and a per-cue KEY gain (+6 dB) so the bed ducks deeper under this line, which
sits over the full beat. The bed is faded BEFORE the mix with a half-sine (16.8s, 3s) so the tail
eases into silence and never touches a voice. Cue fields in `mix-spot-audio.sh`:
`start:file:fade_out:fade_in:pan:gain:onset:keygain`.

**Finishing touches (dark 4:5):** a 0.3s fade from the canvas at frame one, with the first caption
held until it is done; captions and two-line subtitles share one optical centre (+8px) so the text
block does not hop between them; unspoken subtitle text at 140/255 rather than 120 so the read-ahead
line is comfortable at feed size; and the end card's call to action is an accent pill with dark
text rather than a bare line of type.

**I cannot hear audio.** Timing, levels, build, loop seams, duck depth, the transcript and the ending
are measured, not listened to — play one before you post. The one thing measurement cannot tell you is
whether the voice *sounds* right against the bed.

## Why 4:5 is the default here, unlike Sprout

The same footage renders 414px wide in 1:1 and 518px in 4:5. Assetly's screens are text-dense — the
brief and the Ask answer are the product — so the extra height is worth more than square's wider
surface coverage. Post 4:5 in the feed; use square if a surface demands it.

## Footage

iPhone 17 Pro simulator, not a physical phone. A current iPhone is 19.5:9 and the iPhone SE is 16:9,
and 16:9 footage can only honestly be framed as a home-button body, which dates the clip. Apple
required a physical device for App Review; marketing does not.

Status bar overridden to Apple's 9:41 marketing convention before recording.

**The app is uninstalled before every take.** It persists the Appearance choice in localStorage and
an install-over keeps the container; after a take that ended on the "Light" chip, every THEME=dark
run rendered light no matter what the simulator was set to. A fresh install starts on "System".

**Appearance is pinned twice.** `record-hero.sh` sets `simctl ui <udid> appearance` on a *fully booted*
device and asserts the read-back, and the seed test then taps the app's own Appearance chip, which
writes the choice to localStorage so it survives the relaunch between the seed and the take. Setting
the appearance while the simulator was still booting is how a `THEME=dark` run came back rendered in
light, silently — hence the assert.

## The account on screen

A dedicated marketing demo account, **not** the App Review demo account. US mega-cap tech,
$3,531,105 across ten positions, +$1.31M unrealised: NVDA, MSFT, AAPL, META, AVGO, GOOGL, AMZN, TSLA,
QQQM and cash. Seeded by `web/e2e/seed-showcase.mjs`, filled with news, intelligence and a brief by
`web/e2e/showcase-content.mjs`. Credentials in `~/.private_keys/assetly-showcase.txt`.

The figures are real app output against real prices, but the holdings are fabricated for the demo.
Say so in the post copy if it is not obvious from context.

## Rebuild

`THEME` (light|dark) threads through every step: the recording, the canvas, the captions and the card.
The two takes have different clocks, so each has its own beat times — pass them in as `SEGMENTS`.

```bash
cd web/ios/App
./marketing/make-music.sh /tmp/assetly-music.wav          # once; the bed is theme-independent

export THEME=light
OUT=/tmp/assetly-hero-raw.mp4 ./marketing/record-hero.sh
./marketing/cut-hero.sh /tmp/assetly-hero-raw.mp4 /tmp/assetly-cut-light.mp4
./marketing/make-hero-clip.sh /tmp/assetly-cut-light.mp4 /tmp/body.mp4 /tmp/assetly-captions.tsv 4x5
./marketing/make-endcard.py 1080 1350 App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png /tmp/card.png
./marketing/finish-clip.sh /tmp/body.mp4 /tmp/card.png ../../docs/marketing/assetly-light-4x5.mp4 2.4 /tmp/assetly-music.wav
```

Dark is the same four lines with `THEME=dark`, `OUT=/tmp/assetly-hero-dark-raw.mp4`, and
`SEGMENTS` for the takes in scratch: light `4.6,2.4 11.5,2.4 20.0,1.2 33.0,3.6 45.4,2.4 59.5,1.2 77.6,4.8`,
dark `4.6,2.4 11.5,2.4 20.0,1.2 33.0,3.6 45.0,2.4 56.6,1.2 79.0,4.8`. Then
`VOICE_AT=6.15 VO_FILE=<one render> ./add-voiceover.sh <all four>` so every variant carries the
same take of the line; the 3s fade-out is part of that step.

**Check the proof sheet before composing.** `cut-hero.sh` writes `/tmp/assetly-proof/sheet.png`, one
frame from the middle of every segment in order. Boundaries read off a coarse sample have been wrong
twice — once putting a caption on the screen before the one it describes, and once landing the Ask
beat on the typing indicator instead of the answer.

Re-cutting after a timing change costs seconds; re-recording costs about three minutes.

**The end card says "Available on the App Store."** If you post before release is live, change it.

## The overlap, and why it was an app bug

The first cut had the status bar's clock printed on top of the Assetly wordmark, and scrolled rows
sliding under it. That was not a framing mistake: `index.html` sets `viewport-fit=cover`, so the web
view extends under the status bar, and nothing in the CSS gave that inset back. The bottom inset was
handled (`--as-tabbar-pad`), the top was not.

Padding alone was not enough either. The header sits in normal flow, so as soon as the page scrolled
it left the screen and the content underneath ran beneath the clock. The fix is a sticky, opaque
`.topbar` carrying `env(safe-area-inset-top)`, so the status bar always has the app's own ground
behind it (`web/src/theme.css`).

This affected every Dynamic Island iPhone in the shipping build, not just the video. It was invisible
in testing because the iPhone SE simulator has a short status bar and no island. The iPhone audit
passes on all ten metrics with the fix in.


## The 20s and 30s spots (`spots/`)

Two longer pieces, cut on my own brief rather than the seven-beat clip's: `assetly-spot-20s.mp4`
and `assetly-spot-30s.mp4`, both 1080x1350, both light theme.

**Structure.** Each opens on a question in the app's own typeface — *What moved your money today?* —
one bar of bass and a riser, and the beat drops on the cut to the product. The 20s runs net worth →
brief → listen → a holding → Ask, then the card. The 30s adds the book, news, and a closing beat that
dissolves the Home screen from light to dark ("Light or dark") before the card. Every cut is on a bar
line at 100 BPM; the only dissolves are the theme flip, where the dissolve *is* the content, and the
fade into the card.

**Motion.** Captions rise 12px and fade in over 0.28s; the end card's icon, name, subline and CTA
land a beat apart. The phone itself is static: a per-beat push-in was tried and read as the phone
changing size.

**Voice.** Two lines from the product's own narration script for the demo account on the day of the
take, rendered by `openai/gpt-audio` (marin) through OpenRouter: the greeting over the brief and
player beats, and the product's real sign-off — *"That's your brief. Talk soon."* — over the card.
The bed thins to a sparse beat under the greeting and ducks 6–9 dB by sidechain; the full beat and
the guitar return on the next bar.

**Music.** One D-minor family ("Forward Progress") for every pitched part — the harmonic check
between families was inconclusive and I cannot audition, so contrast comes from drum changes (Analog
Clap ↔ Pastel Colors 02), a breakdown under the theme flip, and risers into the drop and the card.
Loops decoded sample-exact with `afconvert`, tiled on integer sample offsets, and every stem asserted
to be a whole number of bars.

**Two traps kept for the next person.** `loudnorm` outputs 192 kHz regardless of input, so any
sample-counted filter after it (`adelay …S`, `atrim=end_sample`) is 4x off — the voice track came out
7.5s long until an `aresample` went after it. And XCUITest reports the app's Appearance chips as not
hittable, and a coordinate tap on "Dark" did not flip Settings in place; the theme changed on the
next Home tap. The flip beat is therefore a dissolve between the light and dark Home from the same
take, same scroll position, which is cleaner than the in-app flip would have been anyway.

**Measured, not heard:** exact frame counts (600 / 900), −14.0 LUFS, peaks ≤ −1.2 dBFS, faststart,
speech-band lift at all four cues. Whether the arrangement and the voice sit well together is the
one thing measurement cannot say — play them before posting.
