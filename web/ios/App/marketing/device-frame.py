#!/usr/bin/env python3
"""Draws a current-generation iPhone body as an RGBA PNG, for the screen to be composited into.

    device-frame.py <screen_w> <screen_h> <out.png>

Best practice for app marketing is to show the current iPhone — one generation across a campaign —
and to use real app footage rather than a static mockup. That is why the clip is recorded on an
iPhone 17 Pro simulator at 1206x2622 rather than on the 16:9 handset that shot the App Review demo:
a 19.5:9 recording is what lets the body have thin bezels. Wrapping 16:9 footage in a modern frame
makes a squat phone that exists nowhere, and wrapping it in an honest 16:9 body makes the deep chins
that read as bulky.

Proportions from the iPhone 16/17 Pro, against screen width so they hold at any size: a 71.5mm body
around a roughly 67.9mm display gives a bezel of about 1.8mm, or 0.027. Corner radius is about 0.155
of body width, and the display radius is that minus the bezel, so the two stay concentric.

The Dynamic Island and status bar are already in the recording; nothing here draws them.
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

sw, sh, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]

BEZEL = max(6, int(round(sw * 0.027)))
W, H = sw + 2 * BEZEL, sh + 2 * BEZEL
BODY_R = int(round(W * 0.155))
PAD = 100

GLASS_T = (30, 29, 28)                   # the black front, lit from above
GLASS_B = (14, 14, 14)
BAND_T = (176, 170, 162)                 # brushed titanium, brighter at the top
BAND_B = (104, 100, 95)
BTN = (150, 145, 138, 255)

canvas = (W + 2 * PAD, H + 2 * PAD)
img = Image.new("RGBA", canvas, (0, 0, 0, 0))
x0, y0, x1, y1 = PAD, PAD, PAD + W - 1, PAD + H - 1

# shadow: wide, soft, dropped low. A tight dark shadow looks pasted on.
shadow = Image.new("RGBA", canvas, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([x0 + 10, y0 + 34, x1 - 10, y1 + 38],
                                         radius=BODY_R, fill=(48, 33, 24, 74))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(38)))

# buttons behind the body, so only the protrusion shows
btns = Image.new("RGBA", canvas, (0, 0, 0, 0))
bd = ImageDraw.Draw(btns)
out_px = max(3, int(sw * 0.009))
unit = H / 100.0
for top, length in ((17, 4), (23, 7), (32, 7)):          # action button, volume up, volume down
    ty = y0 + int(unit * top)
    bd.rounded_rectangle([x0 - out_px, ty, x0 + 1, ty + int(unit * length)], radius=out_px, fill=BTN)
sy = y0 + int(unit * 25)
bd.rounded_rectangle([x1 - 1, sy, x1 + out_px, sy + int(unit * 11)], radius=out_px, fill=BTN)
img.alpha_composite(btns)

# titanium band: a vertical gradient so the rail reads as metal rather than a flat outline
band_grad = Image.new("RGB", (1, H))
for y in range(H):
    t = y / max(1, H - 1)
    band_grad.putpixel((0, y), tuple(int(BAND_T[i] + (BAND_B[i] - BAND_T[i]) * t) for i in range(3)))
band_grad = band_grad.resize((W, H), Image.BILINEAR).convert("RGBA")
band_shape = Image.new("L", (W, H), 0)
ImageDraw.Draw(band_shape).rounded_rectangle([0, 0, W - 1, H - 1], radius=BODY_R, fill=255)
band = Image.new("RGBA", canvas, (0, 0, 0, 0))
band.paste(band_grad, (PAD, PAD), band_shape)
img.alpha_composite(band)

# black front, inset by the rail's thickness
rail = max(2, int(sw * 0.006))
gx0, gy0 = x0 + rail, y0 + rail
gw, gh = W - 2 * rail, H - 2 * rail
g = Image.new("RGB", (1, gh))
for y in range(gh):
    t = y / max(1, gh - 1)
    g.putpixel((0, y), tuple(int(GLASS_T[i] + (GLASS_B[i] - GLASS_T[i]) * t) for i in range(3)))
g = g.resize((gw, gh), Image.BILINEAR).convert("RGBA")
gshape = Image.new("L", (gw, gh), 0)
ImageDraw.Draw(gshape).rounded_rectangle([0, 0, gw - 1, gh - 1], radius=BODY_R - rail, fill=255)
glass = Image.new("RGBA", canvas, (0, 0, 0, 0))
glass.paste(g, (gx0, gy0), gshape)
img.alpha_composite(glass)

img.save(out)
print(f"frame {canvas[0]}x{canvas[1]} body {W}x{H} bezel {BEZEL} r{BODY_R} screen_r {BODY_R - BEZEL}")
