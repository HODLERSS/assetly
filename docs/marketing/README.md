# Assetly launch clip

`assetly-linkedin-4x5.mp4` — **1080x1350, the one to post.**
`assetly-linkedin-square.mp4` — 1080x1080 alternate.

19.8 seconds, silent, captioned, real app footage in an iPhone 17 Pro body, ending on a card.

## The cut

Seven beats, 18.4s of product crossfaded 0.45s into a 1.8s end card.

| # | Beat | Sec | Caption |
|---|---|---|---|
| 1 | Home, net worth | 2.4 | Everything you own, in one place |
| 2 | The book scrolling | 2.4 | Live prices, every position |
| 3 | Brief opened | 2.6 | A brief on what moved, and why |
| 4 | Narration playing | 1.8 | Listen to it on the way in |
| 5 | NVDA, chart and intelligence | 2.6 | A read on every holding |
| 6 | News | 1.8 | Only the news that touched your book |
| 7 | Ask, question and answer | 4.8 | Like having an analyst on call |

No unit claims anywhere in the copy: not "every minute", not "two-minute brief", not "ninety seconds".
Numbers in a caption invite the viewer to audit the number instead of wanting the product, and they
date badly. Ask is framed as a person rather than a feature, which is what it actually feels like.

Ask gets the longest beat because it is the differentiator, and because the tap and its answer stay in
one continuous shot — the model answers in about 5s once warm, which is what makes that possible. The
first take ended on the typing indicator and was discarded.

## Why 4:5 is the default here, unlike Sprout

The same footage renders 418px wide in 1:1 and 524px in 4:5. Assetly's screens are text-dense — the
brief and the Ask answer are the product — so the extra height is worth more than square's wider
surface coverage. Post 4:5 in the feed; use square if a surface demands it.

## Footage

iPhone 17 Pro simulator, not a physical phone. A current iPhone is 19.5:9 and the iPhone SE is 16:9,
and 16:9 footage can only honestly be framed as a home-button body, which dates the clip. Apple
required a physical device for App Review; marketing does not.

Status bar overridden to Apple's 9:41 marketing convention before recording.

## The account on screen

A dedicated marketing demo account, **not** the App Review demo account. US mega-cap tech,
$3,531,105 across ten positions, +$1.31M unrealised: NVDA, MSFT, AAPL, META, AVGO, GOOGL, AMZN, TSLA,
QQQM and cash. Seeded by `web/e2e/seed-showcase.mjs`, filled with news, intelligence and a brief by
`web/e2e/showcase-content.mjs`. Credentials in `~/.private_keys/assetly-showcase.txt`.

The figures are real app output against real prices, but the holdings are fabricated for the demo.
Say so in the post copy if it is not obvious from context.

## Rebuild

```bash
cd web/ios/App
./marketing/record-hero.sh                                   # -> /tmp/assetly-hero-raw.mp4
./marketing/cut-hero.sh /tmp/assetly-hero-raw.mp4 /tmp/assetly-hero-cut.mp4
./marketing/make-hero-clip.sh /tmp/assetly-hero-cut.mp4 /tmp/assetly-body-4x5.mp4 /tmp/assetly-captions.tsv 4x5
./marketing/make-endcard.py 1080 1350 ../../public/icon-512.png /tmp/assetly-card-4x5.png
./marketing/finish-clip.sh /tmp/assetly-body-4x5.mp4 /tmp/assetly-card-4x5.png ../../../docs/marketing/assetly-linkedin-4x5.mp4 1.8
```

Beat times and caption text live at the top of `marketing/cut-hero.sh`. Re-cutting after a timing
change costs seconds; re-recording costs about three minutes.

**The end card says "Coming soon to the App Store"** because the app is in review, not released.
Change it to "Free on the App Store" once 1.0 is approved and you have pressed Release.

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
