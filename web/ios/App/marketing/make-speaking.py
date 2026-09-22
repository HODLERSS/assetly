#!/usr/bin/env python3
"""Renders a minimal "someone is speaking" indicator as a transparent PNG sequence driven by a voice
track: five pills whose heights follow five bands of the voice, with attack/release smoothing, and
which disappear when nobody is speaking.

    make-speaking.py <voice.wav> <frames-dir> [fps] [theme]      # 16-bit PCM WAV: python wave cannot read the 24-bit extensible header

A raw waveform (showwaves) reads as noise and vanishes on quiet syllables; a smoothed band meter
reads as speech at a glance, which is the whole job of the thing.
"""
import os, sys, wave, numpy as np
from PIL import Image, ImageDraw

src, out, fps = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 30
theme = sys.argv[4] if len(sys.argv) > 4 else "dark"
os.makedirs(out, exist_ok=True)
w = wave.open(src, "rb"); sr = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth()
raw = w.readframes(w.getnframes())
if sw == 3:
    a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
    x = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
    x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float64) / (1 << 23)
else:
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768
x = x.reshape(-1, ch).mean(1)

BANDS = [(120, 300), (300, 700), (700, 1500), (1500, 3000), (3000, 6000)]
hop = sr // fps; n = 2048
nfr = len(x) // hop
f = np.fft.rfftfreq(n, 1 / sr); win = np.hanning(n)
levels = np.zeros((nfr, len(BANDS)))
for i in range(nfr):
    c = i * hop; seg = x[max(0, c - n // 2): c + n // 2]
    if len(seg) < n: seg = np.pad(seg, (0, n - len(seg)))
    X = np.abs(np.fft.rfft(seg * win))
    for b, (lo, hi) in enumerate(BANDS):
        levels[i, b] = X[(f >= lo) & (f < hi)].mean()
# each band against its own loud moments: speech energy sits in the low bands, and a shared scale
# left the upper pills as dots
levels = np.sqrt(levels / (np.percentile(levels, 99.0, axis=0) + 1e-9)).clip(0, 1)
# attack fast, release slow: bars jump to a syllable and settle after it
sm = np.zeros_like(levels); att, rel = 0.55, 0.22
for i in range(1, nfr):
    up = levels[i] > sm[i - 1]
    sm[i] = np.where(up, sm[i - 1] + att * (levels[i] - sm[i - 1]), sm[i - 1] + rel * (levels[i] - sm[i - 1]))
speaking = np.convolve((sm.mean(1) > 0.12).astype(float), np.ones(6) / 6, mode="same")   # presence, softened

W, H = 160, 44; PW, GAP, MINH, MAXH = 10, 12, 6, 40
INK = (139, 152, 224) if theme == "dark" else (42, 63, 146)
x0 = (W - (len(BANDS) * PW + (len(BANDS) - 1) * GAP)) // 2
for i in range(nfr):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    alpha = int(255 * min(1, speaking[i] * 1.6))
    if alpha:
        for b in range(len(BANDS)):
            h = int(MINH + (MAXH - MINH) * sm[i, b])
            px = x0 + b * (PW + GAP); py = (H - h) // 2
            d.rounded_rectangle([px, py, px + PW - 1, py + h - 1], radius=PW // 2, fill=INK + (alpha,))
    img.save(os.path.join(out, f"{i:05d}.png"))
print(f"{nfr} frames, speaking {speaking.sum()/fps:.1f}s -> {out}")
