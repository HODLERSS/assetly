#!/usr/bin/env python3
"""Measures a finished daily Short against docs/marketing/SHORTS_QUALITY.md and prints a markdown table.

    qa-short.py <final.mp4> <voice-track.wav> <subs.json> <script.txt> <metadata.md> [voice_at]

Automatic rows: Q1-Q6 (format, loudness, black/frozen), Q7 (hook: voice onset), Q8 (caption sync against
the rendered voice track's own onsets), Q9 (subtitle glyph height), Q10 (text inside the safe zone, from
the rendered subtitle and disclaimer layers passed in SHORT_LAYERS), Q13 (word list). Q11, Q12, Q14-Q16 need
eyes on the proof frames and the sources table; they are printed as MANUAL for the report to fill in.
Exit status is 1 if any automatic row fails.
"""
import json, os, re, subprocess, sys, wave
import numpy as np

mp4, vtrack, subs_f, script_f, meta_f = sys.argv[1:6]
rows, bad = [], False
def row(k, name, ok, val):
    global bad
    rows.append((k, name, "PASS" if ok else "FAIL", val)); bad |= not ok
def run(*a): return subprocess.run(a, capture_output=True, text=True)

# Q1-Q2 format
pr = json.loads(run("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,duration", "-of", "json", mp4).stdout)
dur = float(pr["format"]["duration"]); v = next(s for s in pr["streams"] if s["codec_type"] == "video"); a = next(s for s in pr["streams"] if s["codec_type"] == "audio")
vdur = float(v["duration"])
# streams end within 0.04 s of each other: one AAC frame (21 ms) plus one video frame (17 ms)
row("Q1", "Duration (video runs the whole file)", 20.0 <= dur <= 25.0 and abs(vdur - dur) <= 0.04, f"{dur:.2f} s, video {vdur:.3f} s")
head = open(mp4, "rb").read(200000); faststart = head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat"))
fmt_ok = (v["width"], v["height"]) == (1080, 1920) and v["r_frame_rate"] in ("60/1", "30/1") and v["codec_name"] == "h264" and v["profile"] == "High" and v["pix_fmt"] == "yuv420p" and a["codec_name"] == "aac" and a["sample_rate"] == "48000" and faststart
row("Q2", "Format", fmt_ok, f"{v['width']}x{v['height']} {v['r_frame_rate']} fps {v['codec_name']} {v['profile']} {v['pix_fmt']}, {a['codec_name']} {a['sample_rate']} Hz, faststart={faststart}")

# Q3-Q4 loudness
eb = run("ffmpeg", "-hide_banner", "-nostats", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-").stderr.split("Summary:")[-1]
I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", eb).group(1)); TP = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", eb).group(1))
row("Q3", "Integrated loudness", abs(I + 14) <= 1.0, f"{I:.1f} LUFS")
row("Q4", "True peak", TP <= -1.5, f"{TP:.1f} dBTP")

# Q5-Q6 black / frozen
bd = run("ffmpeg", "-hide_banner", "-i", mp4, "-vf", "blackdetect=d=0.1:pix_th=0.05", "-an", "-f", "null", "-").stderr
blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", bd)
row("Q5", "No black frames", not blacks, f"{len(blacks)} black segments" + (f" {blacks}" if blacks else ""))
fd = run("ffmpeg", "-hide_banner", "-i", mp4, "-vf", "freezedetect=n=0.001:d=2", "-an", "-f", "null", "-").stderr
fz = [(float(s), float(e)) for s, e in zip(re.findall(r"freeze_start: ([\d.]+)", fd), re.findall(r"freeze_end: ([\d.]+)", fd))]
fz += [(float(s), dur) for s in re.findall(r"freeze_start: ([\d.]+)", fd)[len(fz):]]
card_start = dur - 3.2                                    # the end card is a declared hold
undeclared = [(s, e) for s, e in fz if s < card_start]
row("Q6", "No frozen video (outside the end card)", not undeclared, f"freezes: {[(round(s,2), round(e,2)) for s, e in fz] or 'none'}")

# voice onsets from the rendered voice track: energy above -35 dBFS after >= 0.15 s below it
tmp = "/tmp/qa-vo16.wav"; run("ffmpeg", "-v", "error", "-y", "-i", vtrack, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp)
w = wave.open(tmp); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
hop = 160; env = np.array([np.sqrt((x[i:i + 320] ** 2).mean() + 1e-12) for i in range(0, len(x) - 320, hop)]); db = 20 * np.log10(env)
onsets, quiet = [], 0
for i, d in enumerate(db):
    if d < -35: quiet += 1
    else:
        if quiet * 0.01 >= 0.15 or (not onsets and i > 0 and quiet): onsets.append(i * 0.01)
        quiet = 0
subs = json.load(open(subs_f))["cues"]
row("Q7", "Hook by 1.5 s", bool(onsets) and onsets[0] <= 1.5, f"voice starts {onsets[0]:.2f} s; title card on screen from frame 0" if onsets else "no voice")
errs = []
for c in subs:
    t = c["times"][0][0]; near = min(onsets, key=lambda o: abs(o - t)); errs.append((round(t, 2), round(near, 2), round((t - 0.06 - near) * 1000)))
worst = max(abs(e[2]) for e in errs)
row("Q8", "Caption sync (first word lit vs speech onset)", worst <= 150, f"worst {worst} ms over {len(errs)} sentences: " + ", ".join(f"{e[2]:+d}" for e in errs))

# Q9-Q10 from the rendered text layers (alpha bounding boxes)
from PIL import Image, ImageFont
font = ImageFont.truetype(os.path.expanduser("~/Library/Fonts/assetly-brand/SchibstedGrotesk[wght].ttf"), json.load(open(subs_f)).get("size", 50))
cap = font.getbbox("H"); cap_h = cap[3] - cap[1]
row("Q9", "Subtitle cap height >= 34 px", cap_h >= 34, f"{cap_h} px cap height at {json.load(open(subs_f)).get('size', 50)} px type")
boxes = []
for spec in filter(None, os.environ.get("SHORT_LAYERS", "").split(";")):
    path, ox, oy = spec.split(","); im = Image.open(path); bb = im.getchannel("A").getbbox()
    if bb: boxes.append((os.path.basename(path), bb[0] + int(ox), bb[1] + int(oy), bb[2] + int(ox), bb[3] + int(oy)))
out = [b for b in boxes if b[1] < 60 or b[3] > 950 or b[2] < 100 or b[4] > 1536]
row("Q10", "Overlay text inside safe zone (x 60-950, y 100-1536)", bool(boxes) and not out, f"{len(boxes)} layers checked; union x {min(b[1] for b in boxes)}-{max(b[3] for b in boxes)}, y {min(b[2] for b in boxes)}-{max(b[4] for b in boxes)}" if boxes else "no layers passed")

# Q13 word list
BAN = r"\b(buy|sell|should|must-own|recommend|guaranteed|skyrocket|soar|soars|soaring|explode|moon|crush|crushed|massive|insane|huge|don't miss|act now|best stock|secret|bagger|yolo|alpha|beta|eps|p/e|guidance|bps|basis points|multiple|catalyst|thesis|tripwire|setup|capex|tam)\b"
texts = open(script_f).read() + "\n" + open(meta_f).read() + "\n" + " ".join(t for c in subs for t, _ in c["words"])
hits = sorted(set(m.lower() for m in re.findall(BAN, texts, re.I))); dash = "\u2014" in texts or "\u2013" in texts
emoji = re.findall(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", texts)
row("Q13", "No advice / hype / jargon words, em dashes, emoji", not hits and not dash and not emoji, f"hits {hits or 'none'}, em dash {dash}, emoji {len(emoji)}")

print("| # | Metric | Result | Measured |\n|---|---|---|---|")
for r in rows: print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |")
for k, n in (("Q11", "Every figure sourced"), ("Q12", "Pronunciation"), ("Q14", "Disclaimer visible"), ("Q15", "Brand"), ("Q16", "Proof frames viewed")):
    print(f"| {k} | {n} | MANUAL | see below |")
sys.exit(1 if bad else 0)
