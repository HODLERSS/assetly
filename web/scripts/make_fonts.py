#!/usr/bin/env python3
"""Fetch Schibsted Grotesk (variable, 400-700) from Google Fonts and write the self-hosted copies in public/fonts.

    pip install fonttools brotli
    python3 scripts/make_fonts.py

One change to the font: its tabular-figures feature (tnum) also swaps the comma, the full stop, the colon
and the semicolon for figure-width versions. We want tabular digits so columns of money line up, but with
figure-width punctuation "$3,511,190" was set as "$3 , 511 , 190", the same fault as the old monospace
face. Those four substitutions come out of tnum, so digits stay tabular and the punctuation stays
proportional. SIL OFL 1.1 with no Reserved Font Name (public/fonts/OFL.txt), so a modified copy may keep
the family name.
"""
import io
import re
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/fonts"
CSS_URL = "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&display=swap"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
PROPORTIONAL_PUNCTUATION = {"comma", "period", "colon", "semicolon"}


def fetch(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})).read()


def untabulate_punctuation(font: TTFont) -> int:
    gsub = font["GSUB"].table
    removed = 0
    for rec in gsub.FeatureList.FeatureRecord:
        if rec.FeatureTag != "tnum":
            continue
        for i in rec.Feature.LookupListIndex:
            for sub in gsub.LookupList.Lookup[i].SubTable:
                mapping = getattr(sub, "mapping", None)
                for glyph in PROPORTIONAL_PUNCTUATION & set(mapping or {}):
                    del mapping[glyph]
                    removed += 1
    return removed


if __name__ == "__main__":
    css = fetch(CSS_URL).decode()
    blocks = re.findall(r"/\* ([a-z-]+) \*/.*?src: url\((.*?)\)", css, re.S)
    OUT.mkdir(parents=True, exist_ok=True)
    for subset, url in blocks:
        if subset not in ("latin", "latin-ext"):
            continue
        font = TTFont(io.BytesIO(fetch(url)))
        n = untabulate_punctuation(font) if "GSUB" in font else 0
        font.flavor = "woff2"
        path = OUT / f"schibsted-grotesk-{subset}.woff2"
        font.save(path)
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB  (tnum punctuation removed: {n})")
