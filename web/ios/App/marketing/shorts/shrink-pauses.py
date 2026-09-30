#!/usr/bin/env python3
"""Shortens every pause in a voice render to at most <keep> seconds and remaps its word timestamps.

    shrink-pauses.py <voice.wav> <words.json> <keep-seconds> <out.wav> <out-words.json>

Pauses are found by ffmpeg silencedetect (-40 dB, >= 0.2 s). Only the MIDDLE of a pause is cut, with
a 15 ms fade either side, so no syllable is touched; a word's times move by the silence removed
before it. The voice itself is never re-timed or pitch-shifted.
"""
import json, re, subprocess, sys
src, wf, keep, out, owf = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
log = subprocess.run(["ffmpeg", "-i", src, "-af", "silencedetect=n=-40dB:d=0.2", "-f", "null", "-"], capture_output=True, text=True).stderr
st = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", log)]; en = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", log)]
cuts = [((a + b) / 2 - (b - a - keep) / 2, (a + b) / 2 + (b - a - keep) / 2) for a, b in zip(st, en) if b - a > keep]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True).stdout)
keepseg, t = [], 0.0
for a, b in cuts: keepseg.append((t, a)); t = b
keepseg.append((t, dur))
fc = "".join(f"[0:a]atrim={a:.4f}:{b:.4f},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,areverse,afade=t=in:d=0.015,areverse[s{i}];" for i, (a, b) in enumerate(keepseg))
fc += "".join(f"[s{i}]" for i in range(len(keepseg))) + f"concat=n={len(keepseg)}:v=0:a=1[o]"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex", fc, "-map", "[o]", "-c:a", "pcm_s24le", out], check=True)
shift = lambda x: x - sum(b - a for a, b in cuts if b <= x + 1e-6)
words = [[w, round(shift(s), 3), round(shift(e), 3)] for w, s, e in json.load(open(wf))]
json.dump(words, open(owf, "w"))
print(f"cut {len(cuts)} pauses, {sum(b - a for a, b in cuts):.2f}s removed; last word ends {words[-1][2]:.2f}s")
