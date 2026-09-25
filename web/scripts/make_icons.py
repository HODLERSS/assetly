#!/usr/bin/env python3
"""Generate the iOS app icon and launch mark from the Assetly mark.

One source of truth: the geometry below is public/icon.svg, whose 32-unit viewBox places two rounded
bars — the second at half opacity — centred on the brand navy. The web PNGs already carry that mark;
this script exists because the iOS assets shipped with Capacitor's generic placeholder.

    python3 scripts/make_icons.py            # writes the iOS assets and reports each file

App-icon rules it honours: full bleed (iOS applies its own corner mask, so the source must not be
pre-rounded), no alpha channel, and the mark centred so the mask never clips it.

Launch screen: the bare mark (no tile) at a fixed point size, centred by the storyboard on the "Ground"
colour, which has the app's light and dark grounds. It used to be a 2732px full-bleed square filled
with aspectFill on systemBackground: pure white or black, never the app's ground, and a hard tone
shift at the handoff to the page. The mark has a dark variant in the lifted brand blue the dark theme
uses (--as-primary), so it reads on graphite.
"""
import json
from PIL import Image, ImageDraw
from pathlib import Path

NAVY = (0x2A, 0x3F, 0x92)
PAPER = (0xF4, 0xF5, 0xF7)
NIGHT_PRIMARY = (0x8A, 0xA0, 0xF2)    # --as-primary on the dark ground (theme.css)
LAUNCH_MARK_PT = 120                  # the mark's width on the launch screen, in points
SS = 4                      # supersample factor; the bars are pure geometry, so this is all it needs

# public/icon.svg, 32-unit viewBox: rect(5,13,10.5,6,r3) and rect(17.5,13,10.5,6,r3) at opacity .5
BAR_W, BAR_H, BAR_R = 10.5, 6.0, 3.0
BAR1_X, BAR2_X, BAR_Y = 5.0, 17.5, 13.0
VIEW = 32.0
SECOND_BAR_ALPHA = 0.5

ROOT = Path(__file__).resolve().parent.parent


def draw_mark(size: int, ground, ink, mark_width_ratio: float) -> Image.Image:
    """The two-bar mark on a flat ground. mark_width_ratio is how much of the square the mark spans."""
    big = size * SS
    im = Image.new("RGB", (big, big), ground)

    span = (BAR2_X + BAR_W) - BAR1_X          # the mark's own width: x 5 -> 28, i.e. 23 view units
    scale = (big * mark_width_ratio) / span
    left = (big - span * scale) / 2
    top = (big - BAR_H * scale) / 2

    def bar(x_view: float, alpha: float) -> None:
        x0 = left + (x_view - BAR1_X) * scale
        box = (x0, top, x0 + BAR_W * scale, top + BAR_H * scale)
        radius = BAR_R * scale
        if alpha >= 1.0:
            ImageDraw.Draw(im).rounded_rectangle(box, radius=radius, fill=ink)
            return
        # half-opacity bar: composite so it reads the same as the SVG's opacity attribute
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(box, radius=radius, fill=(*ink, round(255 * alpha)))
        im.paste(Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB"), (0, 0))

    bar(BAR1_X, 1.0)
    bar(BAR2_X, SECOND_BAR_ALPHA)
    return im.resize((size, size), Image.LANCZOS)


def draw_bare_mark(width_px: int, ink) -> Image.Image:
    """The two bars alone on transparency, cropped to the mark: the storyboard centres and grounds it."""
    span = (BAR2_X + BAR_W) - BAR1_X
    scale = width_px * SS / span
    big = Image.new("RGBA", (width_px * SS, round(BAR_H * scale)), (0, 0, 0, 0))
    for x_view, alpha in ((BAR1_X, 1.0), (BAR2_X, SECOND_BAR_ALPHA)):
        layer = Image.new("RGBA", big.size, (0, 0, 0, 0))
        x0 = (x_view - BAR1_X) * scale
        ImageDraw.Draw(layer).rounded_rectangle((x0, 0, x0 + BAR_W * scale - 1, BAR_H * scale - 1), radius=BAR_R * scale,
                                                fill=(*ink, round(255 * alpha)))
        big = Image.alpha_composite(big, layer)
    return big.resize((width_px, round(big.size[1] / SS)), Image.LANCZOS)


def write_launch_mark() -> None:
    folder = ROOT / "ios/App/App/Assets.xcassets/LaunchMark.imageset"
    folder.mkdir(parents=True, exist_ok=True)
    images = []
    for appearance, ink in (("light", NAVY), ("dark", NIGHT_PRIMARY)):
        for scale in (1, 2, 3):
            name = f"launch-mark-{appearance}@{scale}x.png"
            im = draw_bare_mark(LAUNCH_MARK_PT * scale, ink)
            im.save(folder / name, "PNG", optimize=True)    # keeps alpha: this one sits on the ground colour
            print(f"  {(folder / name).relative_to(ROOT)}  {im.size[0]}x{im.size[1]}")
            entry = {"idiom": "universal", "filename": name, "scale": f"{scale}x"}
            if appearance == "dark":
                entry["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
            images.append(entry)
    (folder / "Contents.json").write_text(json.dumps({"images": images, "info": {"version": 1, "author": "xcode"}}, indent=2) + "\n")


def write(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(path, "PNG", optimize=True)     # RGB, so no alpha channel ever reaches Apple
    print(f"  {path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}")


def assert_centred(path: Path) -> None:
    """The bar geometry starts at an x offset, so it is easy to centre the wrong box. Measure it."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[2, 2]
    xs = [x for x in range(w) if any(px[x, y] != bg for y in range(0, h, 4))]
    ys = [y for y in range(h) if any(px[x, y] != bg for x in range(0, w, 4))]
    dx, dy = (w - 1 - xs[-1]) - xs[0], (h - 1 - ys[-1]) - ys[0]
    assert abs(dx) <= 2, f"{path.name}: mark is {dx//2}px off horizontal centre"
    assert abs(dy) <= 2, f"{path.name}: mark is {dy//2}px off vertical centre"
    print(f"    centred (±{max(abs(dx), abs(dy))}px), mark spans {(xs[-1] - xs[0] + 1) / w:.1%} of the square")


if __name__ == "__main__":
    print("app icon (full bleed, iOS masks the corners itself):")
    icon_path = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    write(draw_mark(1024, NAVY, PAPER, 0.72), icon_path)
    assert_centred(icon_path)

    print("launch mark (light + dark, centred on the Ground colour by LaunchScreen.storyboard):")
    write_launch_mark()
