#!/usr/bin/env python3
"""Writes an 8-bit greyscale rounded-rectangle alpha mask as a PNG.

    roundrect-mask.py <width> <height> <radius> <out.png>

Clamp each pixel to the nearest corner centre and test that one distance. Testing every pixel against
all four centres marks the whole corner square black instead of drawing an arc, which silently cropped
the outermost tab-bar labels out of the clip.
"""
import sys, zlib, struct

w, h, r, out = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rows = []
for y in range(h):
    cy = r if y < r else (h - 1 - r if y > h - 1 - r else y)
    row = bytearray([0])                       # PNG per-row filter byte
    for x in range(w):
        cx = r if x < r else (w - 1 - r if x > w - 1 - r else x)
        dx, dy = x - cx, y - cy
        row.append(255 if dx * dx + dy * dy <= r * r else 0)
    rows.append(bytes(row))

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

with open(out, "wb") as f:
    f.write(b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
            + chunk(b"IEND", b""))
print(f"mask {w}x{h} r{r}")
