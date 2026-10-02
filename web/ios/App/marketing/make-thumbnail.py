#!/usr/bin/env python3
"""The YouTube custom thumbnail for a daily Short (assetly-shorts v1.4.0, owner 10/2: "click-optimized custom thumbnail").

    make-thumbnail.py <spec.json> <out.png>

spec: {"name": "Tesla", "fig": "+5.1%", "label": "SO FAR TODAY", "dir": "up", "hook": "jumps on deliveries",
       "chip": "MIDDAY · OCT 2", "accent": [r,g,b], "ground": [r,g,b], "arrow_accent": false, "bg": "<frame.png>"}
One focal point: the company name, a GIANT verified move with a drawn up/down arrow (gain green / loss red; the arrow in
the edition accent when arrow_accent is set, the Korea look), its window label, and a 2-4 word hook from the story's
verified cover. Small edition chip and the Assetly mark. Every text pixel sits in the centre band (y 420-1500) so the
channel grid, search and 4:5 crops keep it; nothing in the top 200 px or the bottom third's feed overlay. The take's frame,
if given, sits behind at low weight. Without a figure (no hero) the hook carries the card. Writes <out.png> (< 2 MB) and
<out>.json {"bbox": [x0, y0, x1, y1] of all text, "texts": [...], "figures": [...]} for the QA gate (Q46).
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

spec, OUT = json.load(open(sys.argv[1])), sys.argv[2]
W, H = 1080, 1920
BAND = (420, 1500)
FONTS = os.path.expanduser("~/Library/Fonts/assetly-brand")
INK, MUTED = (240, 242, 246), (160, 168, 180)
GAIN, LOSS = (98, 210, 154), (227, 107, 91)
ACC = tuple(spec.get("accent") or (139, 152, 224)); GROUND = tuple(spec.get("ground") or (20, 24, 31))


def grotesk(size, weight=800):
    f = ImageFont.truetype(os.path.join(FONTS, "SchibstedGrotesk[wght].ttf"), size); f.set_variation_by_axes([weight]); return f


img = Image.new("RGB", (W, H), GROUND)
if spec.get("bg") and os.path.exists(spec["bg"]):
    # the app's screen behind, quiet: blurred, dimmed to ~15%, so it reads as context and never competes with the figure
    bg = Image.open(spec["bg"]).convert("RGB").resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(6))
    img = Image.blend(img, bg, 0.15)
txt = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(txt)
texts, figures, blocks = [], [], []


def size_to(text, size, maxw, weight=800):
    while size > 40 and d.textlength(text, font=grotesk(size, weight)) > maxw: size -= 4
    return grotesk(size, weight)


def hgt(text, f):
    l, t, r, b = d.textbbox((0, 0), text, font=f); return b - t, t


name, fig, lab, hook = spec.get("name", ""), spec.get("fig", ""), spec.get("label", ""), spec.get("hook", "")
chip = spec.get("chip", "")
f_chip = grotesk(40, 700); f_name = size_to(name, 128, 900); f_lab = grotesk(40, 700)
f_hook = size_to(hook, 96 if fig else 120, 900)
arrow_w = 0
if fig:
    f_fig = size_to(fig, 300, 900 - 170); arrow_w = int(f_fig.size * 0.55)
# the block's height, then centred in the band
parts = []
if chip: parts.append(("chip", chip, f_chip, 70))
if name: parts.append(("name", name, f_name, 34))
if fig: parts.append(("fig", fig, f_fig, 26))
if fig and lab: parts.append(("lab", lab, f_lab, 64))
if hook: parts.append(("hook", hook, f_hook, 0))
total = sum(hgt(t, f)[0] + gap for _, t, f, gap in parts)
y = BAND[0] + max(0, (BAND[1] - 120 - BAND[0] - total) // 2)
for kind, t, f, gap in parts:
    h, top = hgt(t, f)
    if kind == "fig":
        col = GAIN if spec.get("dir") == "up" else LOSS if spec.get("dir") == "down" else INK
        tw = d.textlength(t, font=f); x = (W - tw - arrow_w - 24) / 2
        # the arrow is drawn, not a glyph (the brand face has none): a solid triangle the height of the digits
        ah = int(h * 0.62); ay = y + (h - ah) // 2; acol = ACC if spec.get("arrow_accent") else col
        pts = [(x, ay + ah), (x + arrow_w, ay + ah), (x + arrow_w / 2, ay)] if spec.get("dir") != "down" else \
              [(x, ay), (x + arrow_w, ay), (x + arrow_w / 2, ay + ah)]
        d.polygon(pts, fill=acol + (255,))
        d.text((x + arrow_w + 24, y - top), t, font=f, fill=col + (255,)); figures.append(t)
    else:
        track = 6 if kind in ("chip", "lab") else 0
        tw = sum(d.textlength(ch, font=f) for ch in t) + track * (len(t) - 1) if track else d.textlength(t, font=f)
        x = (W - tw) / 2; col = {"chip": ACC, "name": INK, "lab": MUTED, "hook": ACC if fig else INK}[kind]
        if track:
            for ch in t: d.text((x, y - top), ch, font=f, fill=col + (255,)); x += d.textlength(ch, font=f) + track
        else:
            d.text((x, y - top), t, font=f, fill=col + (255,))
    texts.append(t); y += h + gap
# the Assetly mark: small, last line of the band
fm = grotesk(38, 700); mark = "Assetly"; mh, mt = hgt(mark, fm)
my = BAND[1] - mh - 10
rw = 64; d.rounded_rectangle([(W - rw) // 2, my - 34, (W + rw) // 2, my - 26], radius=4, fill=ACC + (255,))
d.text(((W - d.textlength(mark, font=fm)) / 2, my - mt), mark, font=fm, fill=MUTED + (255,)); texts.append(mark)
bbox = txt.getchannel("A").getbbox()
img = Image.alpha_composite(img.convert("RGBA"), txt).convert("RGB")
img.save(OUT, optimize=True)
assert os.path.getsize(OUT) < 2_000_000, f"thumbnail {os.path.getsize(OUT)} bytes"
json.dump({"bbox": list(bbox) if bbox else None, "texts": texts, "figures": figures, "band": list(BAND)}, open(OUT + ".json", "w"))
print(f"thumbnail: {OUT} ({os.path.getsize(OUT) / 1e3:.0f} kB), text bbox {bbox}")
