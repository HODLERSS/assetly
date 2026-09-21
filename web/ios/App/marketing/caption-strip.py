#!/usr/bin/env python3
"""Renders one caption as a transparent PNG strip for overlaying on the clip.

    caption-strip.py <width> <height> <fontsize> <out.png> <text>

This ffmpeg has no drawtext filter (not built with freetype), so captions are drawn here and composited
with overlay instead. Apple SD Gothic Neo carries both Latin and Hangul, so an English caption and a
Korean one render in the same face.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

w, h, size, out, text = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
INK = (22, 24, 29, 255)          # Assetly ink (--as-ink #16181D)

font = None
# index 4 is the Bold face in this collection; the lighter ones were legible on a screen but thin
# in a feed at thumbnail size, which is where these are actually read
for path, idx in (("/System/Library/Fonts/AppleSDGothicNeo.ttc", 4),
                  ("/System/Library/Fonts/AppleSDGothicNeo.ttc", 2),
                  ("/System/Library/Fonts/AppleSDGothicNeo.ttc", 0),
                  ("/System/Library/Fonts/Supplemental/Arial.ttf", 0)):
    try:
        font = ImageFont.truetype(path, size, index=idx)
        break
    except Exception:
        continue
if font is None:
    raise SystemExit("no usable font")

img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
l, t, r, b = d.textbbox((0, 0), text, font=font)
x, y = (w - (r - l)) / 2 - l, (h - (b - t)) / 2 - t
d.text((x, y), text, font=font, fill=INK, stroke_width=1, stroke_fill=INK)   # faux-bold, evenly
img.save(out)
print(f"caption {w}x{h}: {text}")
