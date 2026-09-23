#!/usr/bin/env python3
"""Karaoke-fill subtitles timed from the voice audio itself, as a transparent PNG sequence.

    make-fill-subtitles.py <spec.json> <frames-dir> <w> <h> <fps> <total-seconds>

spec.json: {"size": 42, "cues": [{"file": "voice.wav", "at": 6.15,
             "words": [["Good", 1], ["morning.", 2], ...]}]}    # display token, spoken syllables

Timing, without listening: the cue's audio is trimmed exactly as the mixer trims it, its RMS
envelope is taken at 5 ms, and the boundaries between words are placed at the envelope's dips —
each dip chosen as the nearest local minimum to where the word SHOULD end given how many syllables
it and its neighbours carry. Syllables set the prior, the audio sets the cut. A token that is shown
as "10%" but spoken as "ten percent" simply carries three syllables.

Rendering follows subtitle practice rather than karaoke novelty: the whole sentence is on screen
in muted ink so it can be read ahead, and each word lights with a 90 ms left-to-right sweep that starts 60 ms before its onset. The strip appears 120 ms before the first word and
holds 350 ms after the last.
"""
import json, os, subprocess, sys, tempfile, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

spec, out, W, H, FPS, TOTAL = json.load(open(sys.argv[1])), sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), float(sys.argv[6])
os.makedirs(out, exist_ok=True)
DARK = os.environ.get("THEME", "light") == "dark"
BASE = (201, 207, 218, 120) if DARK else (61, 66, 76, 130)      # unspoken: readable, quiet
LIT  = (233, 236, 241, 255) if DARK else (22, 24, 29, 255)      # spoken: the caption ink
FONT = os.path.expanduser("~/Library/Fonts/assetly-brand/SchibstedGrotesk[wght].ttf")
font = ImageFont.truetype(FONT, spec.get("size", 42)); font.set_variation_by_axes([500])
T = tempfile.mkdtemp()

def envelope(path):
    trimmed = os.path.join(T, os.path.basename(path))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-af",
        "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,areverse,"
        "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB:detection=peak,areverse",
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", trimmed], check=True)
    w = wave.open(trimmed); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    hop = int(0.005 * sr); win = int(0.03 * sr)
    n = (len(x) - win) // hop
    env = np.array([np.sqrt((x[i*hop:i*hop+win] ** 2).mean()) for i in range(n)])
    env = np.convolve(env, np.ones(5) / 5, mode="same")
    return env, 0.005, len(x) / sr

def word_times(env, dt, dur, words):
    syl = np.array([s for _, s in words], float)
    expect = np.cumsum(syl) / syl.sum() * dur            # boundary after each word, syllable prior
    bounds = []
    MIN_SYL = 0.11                                       # a spoken syllable is never shorter than this
    for k, te in enumerate(expect[:-1]):
        prev = bounds[-1] if bounds else 0.0
        floor = prev + MIN_SYL * syl[k]                  # this word must last its syllables
        ceil = dur - MIN_SYL * syl[k+1:].sum()           # and leave room for the ones after it
        lo, hi = int(max(floor, te - 0.14) / dt), int(min(ceil, te + 0.14) / dt)
        if hi - lo < 3:
            bounds.append(min(max(te, floor), ceil)); continue
        seg = env[lo:hi]
        # local minima in the window; nearest to the prior wins, ties by depth
        mins = [i for i in range(1, len(seg) - 1) if seg[i] <= seg[i-1] and seg[i] <= seg[i+1]]
        if mins:
            i = min(mins, key=lambda i: (abs((lo + i) * dt - te) * 3 + seg[i] / (seg.max() + 1e-9)))
            bounds.append((lo + i) * dt)
        else:
            bounds.append(te)
    starts = [0.0] + bounds; ends = bounds + [dur]
    return list(zip(starts, ends))

def layout(tokens):
    """Sentence per line, per make-cards.py sub: split at the first '. ' if both halves fit."""
    text = " ".join(tokens)
    d = ImageDraw.Draw(Image.new("RGBA", (W, H)))
    fits = lambda t: d.textbbox((0, 0), t, font=font)[2] <= W - 120
    lines = [tokens]
    if ". " in text and not fits(text):
        cut = next(i for i, t in enumerate(tokens) if t.endswith(".")) + 1
        lines = [tokens[:cut], tokens[cut:]]
    hs = [d.textbbox((0, 0), " ".join(l), font=font)[3] - d.textbbox((0, 0), " ".join(l), font=font)[1] for l in lines]
    gap = int(spec.get("size", 42) * 0.3); total = sum(hs) + gap * (len(lines) - 1)
    y = (H - total) // 2 + (16 if len(lines) > 1 else 0)   # two lines sit lower, clear of the speaking pills
    boxes = []                                            # (x0, x1, y, line-height) per token
    for line, hh in zip(lines, hs):
        s = " ".join(line); l, t, r, b = d.textbbox((0, 0), s, font=font); x = (W - (r - l)) / 2 - l
        for i, tok in enumerate(line):
            pre = " ".join(line[:i]) + (" " if i else "")
            x0 = x + d.textlength(pre, font=font); x1 = x0 + d.textlength(tok, font=font)
            boxes.append((x0, x1, y - t, hh + t))
        y += hh + gap
    return lines, boxes

cues = []
for c in spec["cues"]:
    env, dt, dur = envelope(c["file"])
    if c.get("times"):
        # measured word times (absolute, from forced alignment of the final voice track) win over
        # the envelope estimate: the estimate cannot see the pauses the voice actually takes
        wt = [(a - c["at"], b - c["at"]) for a, b in c["times"]]
        dur = max(dur, wt[-1][1])
    else:
        wt = word_times(env, dt, dur, c["words"])
    toks = [w for w, _ in c["words"]]
    lines, boxes = layout(toks)
    cues.append({"at": c["at"], "dur": dur, "toks": toks, "wt": wt, "lines": lines, "boxes": boxes})
    print(f"cue at {c['at']}s ({dur:.2f}s):")
    for (w, _), (s, e) in zip(c["words"], wt): print(f"   {c['at']+s:6.2f}-{c['at']+e:6.2f}  {w}")

LEAD, HOLD, FADE = 0.12, 0.35, 0.15
LEAD_WORD, SWEEP = 0.06, 0.09          # highlight leads the onset by 60 ms; the sweep across a word takes 90 ms
blank = Image.new("RGBA", (W, H), (0, 0, 0, 0))
n = int(round(TOTAL * FPS))
for fi in range(n):
    t = fi / FPS; img = None
    for c in cues:
        t0, t1 = c["at"] - LEAD, c["at"] + c["dur"] + HOLD
        if not (t0 <= t <= t1): continue
        a = min(1, (t - t0) / FADE, (t1 - t) / FADE)
        img = blank.copy(); d = ImageDraw.Draw(img)
        # base layer: whole sentence, muted
        for line, in zip(c["lines"]):
            pass
        for (x0, x1, y, lh), tok in zip(c["boxes"], c["toks"]):
            d.text((x0, y), tok, font=font, fill=BASE[:3] + (int(BASE[3] * a),))
        # lit layer: each word lights with a FAST left-to-right sweep (90 ms, whatever the word's
        # length) starting 60 ms before the audio onset. Fast enough to read as the word arriving,
        # not as a progress bar across it; the lead is the usual subtitle practice, since a highlight
        # that lands exactly on the onset is perceived as late.
        lit = blank.copy(); dl = ImageDraw.Draw(lit)
        for (x0, x1, y, lh), tok, (s, e) in zip(c["boxes"], c["toks"], c["wt"]):
            ws = c["at"] + s - LEAD_WORD
            if t < ws: continue
            k = min(1.0, (t - ws) / SWEEP)
            if k >= 1.0:
                dl.text((x0, y), tok, font=font, fill=LIT[:3] + (int(255 * a),)); continue
            cur = blank.copy(); ImageDraw.Draw(cur).text((x0, y), tok, font=font, fill=LIT[:3] + (int(255 * a),))
            fx = x0 + (x1 - x0) * k
            mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).rectangle([0, 0, fx, H], fill=255)
            lit.alpha_composite(Image.composite(cur, blank, mask))
        img.alpha_composite(lit)
    (img or blank).save(os.path.join(out, f"{fi:05d}.png"))
print(f"{n} frames -> {out}")
