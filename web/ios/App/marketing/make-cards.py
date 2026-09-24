#!/usr/bin/env python3
"""Renders the type layers for a spot: the opening hook and the closing card, as transparent PNGs
that the compositor animates separately (one layer fades or rises independently of the next).

    make-cards.py hook <w> <h> <out-dir> "<line one>|<line two>"
    make-cards.py end  <w> <h> <icon.png> <out-dir>
    make-cards.py cap  <w> <h> <size> <out.png> "<caption>"

Type is the app's own: Schibsted Grotesk for words, Chivo Mono for the one figure. Both are OFL and
fetched from Google Fonts' repo into ~/Library/Fonts/assetly-brand/ (variable weight axes, set here).
A card set in the app's face reads as the app; one set in a system font reads as a slide about it.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

DARK = os.environ.get("THEME", "light") == "dark"
BG    = (15, 18, 22)   if DARK else (244, 245, 247)
INK   = (233, 236, 241) if DARK else (22, 24, 29)
MUTED = (155, 163, 176) if DARK else (93, 99, 110)
ACCENT = (139, 152, 224) if DARK else (42, 63, 146)
FONTS = os.path.expanduser("~/Library/Fonts/assetly-brand")

def grotesk(size, weight=700):
    f = ImageFont.truetype(os.path.join(FONTS, "SchibstedGrotesk[wght].ttf"), size)
    f.set_variation_by_axes([weight]); return f
def mono(size, weight=500):
    f = ImageFont.truetype(os.path.join(FONTS, "ChivoMono[wght].ttf"), size)
    f.set_variation_by_axes([weight]); return f

def layer(w, h): return Image.new("RGBA", (w, h), (0, 0, 0, 0))
def centred(d, y, text, font, fill, w):
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text(((w - (r - l)) / 2 - l, y - t), text, font=font, fill=fill + (255,))
    return b - t

mode = sys.argv[1]
if mode == "cap":
    w, h, size, out, text = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], sys.argv[6]
    img = layer(w, h); d = ImageDraw.Draw(img)
    shift = int(os.environ.get("CAP_SHIFT", "8"))
    # "EYEBROW|Headline": a small tracked label in the accent above the headline. Two tiers read as a
    # section title rather than a caption, and the eyebrow names the screen while the headline sells it.
    eyebrow, _, head = text.partition("|") if "|" in text else ("", "", text)
    f = grotesk(size if not eyebrow else int(size * 0.9), 700)
    l, t, r, b = d.textbbox((0, 0), head, font=f); hh = b - t
    if eyebrow:
        fe = grotesk(int(size * 0.44), 600); track = 3
        ew = sum(d.textlength(ch, font=fe) for ch in eyebrow) + track * (len(eyebrow) - 1)
        le, te, re_, be = d.textbbox((0, 0), eyebrow, font=fe); eh = be - te
        # fixed rows in the strip: pills 0-44, eyebrow from 50, headline from 82 (subtitles use the same)
        y0 = int(os.environ.get("CAP_EYE_TOP", "50"))
        x = (w - ew) / 2
        for ch in eyebrow:
            d.text((x, y0 - te), ch, font=fe, fill=ACCENT + (255,)); x += d.textlength(ch, font=fe) + track
        d.text(((w - (r - l)) / 2 - l, y0 + eh + 8 - t), head, font=f, fill=INK + (255,))
    else:
        d.text(((w - (r - l)) / 2 - l, (h - hh) / 2 - t + shift), head, font=f, fill=INK + (255,))
    img.save(out); print(f"caption {w}x{h}: {text}")

elif mode == "sub":
    # A spoken sentence, as a subtitle: lighter weight and a muted ink so it reads as speech rather
    # than as a headline caption, wrapped to at most two centred lines.
    w, h, size, out, text = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], sys.argv[6]
    SUB = (201, 207, 218) if DARK else (61, 66, 76)
    f = grotesk(size, 500)
    d0 = ImageDraw.Draw(layer(w, h))
    fits = lambda t: d0.textbbox((0, 0), t, font=f)[2] <= w - 120
    def greedy(t):
        out, cur = [], ""
        for wd in t.split():
            trial = (cur + " " + wd).strip()
            if not fits(trial) and cur: out.append(cur); cur = wd
            else: cur = trial
        return out + [cur]
    lines = greedy(text)
    # Two sentences on two lines beats a greedy wrap that strands the last word ("...on the App /
    # Store."): break at the sentence end when both halves fit.
    if len(lines) > 1 and ". " in text:
        a, b = text.split(". ", 1); a += "."
        if fits(a) and fits(b): lines = [a, b]
    if len(lines) > 2:
        sys.exit(f"subtitle needs {len(lines)} lines at {size}px: {text!r}")
    img = layer(w, h); d = ImageDraw.Draw(img)
    hs = [d0.textbbox((0, 0), s, font=f)[3] - d0.textbbox((0, 0), s, font=f)[1] for s in lines]
    gap = int(size * 0.3); total = sum(hs) + gap * (len(lines) - 1)
    y = (h - total) // 2
    for s, hh in zip(lines, hs):
        centred(d, y, s, f, SUB, w); y += hh + gap
    img.save(out); print(f"subtitle {w}x{h}: {len(lines)} line(s): {text}")

elif mode == "hook":
    w, h, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    lines = sys.argv[5].split("|")
    os.makedirs(out, exist_ok=True)
    # Big, left-of-centre-feeling but actually centred type; two lines max. The question is the whole
    # card — no logo, no subline — so the answer (the product) lands on the next cut.
    size = 118 if len(max(lines, key=len)) <= 12 else 96
    f = grotesk(size, 800)
    d0 = ImageDraw.Draw(layer(w, h))
    heights = [d0.textbbox((0, 0), s, font=f)[3] - d0.textbbox((0, 0), s, font=f)[1] for s in lines]
    gap = int(size * 0.18)
    total = sum(heights) + gap * (len(lines) - 1)
    y = (h - total) // 2 - int(h * 0.04)
    for i, s in enumerate(lines):
        img = layer(w, h); d = ImageDraw.Draw(img)
        centred(d, y, s, f, INK, w)
        img.save(os.path.join(out, f"hook{i}.png"))
        y += heights[i] + gap
    # a short accent rule under the question, the app's baton colour
    img = layer(w, h); d = ImageDraw.Draw(img)
    rw = 88; d.rounded_rectangle([(w - rw) // 2, y + 26, (w + rw) // 2, y + 26 + 8], radius=4, fill=ACCENT + (255,))
    img.save(os.path.join(out, "hook_rule.png"))
    print(f"hook: {len(lines)} lines at {size}px -> {out}")

elif mode == "end":
    w, h, icon_path, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
    os.makedirs(out, exist_ok=True)
    ICON = 236
    icon = Image.open(icon_path).convert("RGBA").resize((ICON, ICON), Image.LANCZOS)
    mask = Image.new("L", (ICON, ICON), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, ICON - 1, ICON - 1], radius=54, fill=255)
    f_name, f_sub, f_cta = grotesk(92, 800), grotesk(40, 500), grotesk(44, 700)
    d0 = ImageDraw.Draw(layer(w, h))
    def hgt(text, f): l, t, r, b = d0.textbbox((0, 0), text, font=f); return b - t
    name, sub1, sub2, cta = "Assetly", "Your whole portfolio, priced live", "Briefs · Intelligence · Ask", "Available on the App Store"
    block = ICON + 56 + hgt(name, f_name) + 26 + hgt(sub1, f_sub) + 10 + hgt(sub2, f_sub) + 58 + hgt(cta, f_cta)
    y = (h - block) // 2 - int(h * 0.03)
    img = layer(w, h); img.paste(icon, ((w - ICON) // 2, y), mask); img.save(os.path.join(out, "end_icon.png")); y += ICON + 56
    img = layer(w, h); centred(ImageDraw.Draw(img), y, name, f_name, INK, w); img.save(os.path.join(out, "end_name.png")); y += hgt(name, f_name) + 26
    img = layer(w, h); d = ImageDraw.Draw(img); centred(d, y, sub1, f_sub, MUTED, w); y2 = y + hgt(sub1, f_sub) + 10
    centred(d, y2, sub2, f_sub, MUTED, w); img.save(os.path.join(out, "end_sub.png")); y = y2 + hgt(sub2, f_sub) + 58
    # the call to action as a button, not a line of type: accent pill, dark text, generous padding
    img = layer(w, h); d = ImageDraw.Draw(img)
    f_btn = grotesk(38, 700); l, t, r, b = d.textbbox((0, 0), cta, font=f_btn)
    pw, ph = (r - l) + 2 * 40, (b - t) + 2 * 22
    px, py = (w - pw) // 2, y - 6
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=ph // 2, fill=ACCENT + (255,))
    d.text((px + 40 - l, py + 22 - t), cta, font=f_btn, fill=((15, 18, 22) if DARK else (244, 245, 247)) + (255,))
    img.save(os.path.join(out, "end_cta.png"))
    print(f"end card layers -> {out}")
else:
    sys.exit(__doc__)
