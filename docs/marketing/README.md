# Assetly launch clip

Four files, same take, same cut, same bed — pick a theme and an aspect:

| | 4:5 (1080x1350) | 1:1 (1080x1080) |
|---|---|---|
| **Light** | `assetly-light-4x5.mp4` | `assetly-light-1x1.mp4` |
| **Dark** | `assetly-dark-4x5.mp4` | `assetly-dark-1x1.mp4` |

**18.6 seconds, with music and one spoken line, captioned, real app footage in an iPhone 17 Pro body,
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
| 3 | Brief opened | 1 | A brief on what moved, and why |
| 4 | Narration playing | ½ | Listen to it on the way in |
| 5 | NVDA, chart and intelligence | 1 | A read on every holding |
| 6 | News | ½ | Only the news that touched your book |
| 7 | Ask, question and answer | 2 | Like having an analyst on call |

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

At 5.3s, while the brief is on screen and through the beat where the player appears, a voice reads:

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
`SEGMENTS="4.5,2.4 12.0,2.4 24.0,2.4 38.0,1.2 45.0,2.4 56.5,1.2 84.5,4.8"` on `cut-hero.sh`.

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
