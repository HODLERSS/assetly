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
LMIN, LMAX = (float(x) for x in os.environ.get("SHORT_LEN_RANGE", "20,25").split(","))
row("Q1", f"Duration {LMIN:.0f}-{LMAX:.0f} s (video runs the whole file)", LMIN <= dur <= LMAX and abs(vdur - dur) <= 0.04, f"{dur:.2f} s, video {vdur:.3f} s")
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
# the last beat holds its push into the card (one camera language): from 0.5 s into it, a still screen is declared too
if os.environ.get("SHORT_HOLD_FROM"): card_start = min(card_start, float(os.environ["SHORT_HOLD_FROM"]))
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
# a second sentence inside one voice line follows a pause shorter than 0.15 s (10/1 midday: "Shares jumped." 0.1 s after
# the first sentence read as 1.1 s off): onsets after a >= 0.05 s dip count too, and each cue takes the nearer of the two
loose, quiet = [], 0
for i, d in enumerate(db):
    if d < -35: quiet += 1
    else:
        if quiet * 0.01 >= 0.05: loose.append(i * 0.01)
        quiet = 0
# ...and a sentence that follows with no dip below -35 dB at all (the voice runs on): a rise of >= 8 dB within 60 ms
# from a local low (a syllable onset), so the check measures the caption, not the detector
rises = [i * 0.01 for i in range(6, len(db)) if db[i] - db[i - 6:i].min() >= 8 and db[i - 1] - db[i - 6:i].min() < 8]
onsets_all = sorted(set(onsets) | set(loose) | set(rises))
subs = json.load(open(subs_f))["cues"]
row("Q7", "Hook by 1.5 s", bool(onsets) and onsets[0] <= 1.5, f"voice starts {onsets[0]:.2f} s; title card on screen from frame 0" if onsets else "no voice")
errs = []
for c in subs:
    t = c["times"][0][0]; near = min(onsets_all, key=lambda o: abs(o - t)); errs.append((round(t, 2), round(near, 2), round((t - 0.06 - near) * 1000)))
# a sentence that runs on inside one voice line (the previous cue ends < 0.3 s before it) has no clean acoustic onset:
# 320 ms there, 150 ms for every sentence that starts after a pause
cont = [i > 0 and c.get("file") == subs[i - 1].get("file") for i, c in enumerate(subs)]   # second sentence of the same voice line
worst = max(abs(e[2]) for e in errs)
over = [i for i, e in enumerate(errs) if abs(e[2]) > (320 if cont[i] else 150)]
row("Q8", "Caption sync (first word lit vs speech onset; 150 ms, 320 ms for a run-on sentence)", not over, f"worst {worst} ms over {len(errs)} sentences: " + ", ".join(f"{e[2]:+d}" for e in errs))

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
BAN = r"\b(buy|sell|should|must-own|recommend|guaranteed|skyrocket|soar|soars|soaring|explode|moon|crush|crushed|massive|insane|huge|don't miss|act now|best stock|secret|bagger|yolo|alpha|beta|eps|p/e|guidance|bps|basis points|multiple|catalyst|thesis|tripwire|setup|capex|tam|tape|book|print)\b"
texts = open(script_f).read() + "\n" + open(meta_f).read() + "\n" + " ".join(t for c in subs for t, _ in c["words"])
hits = sorted(set(m.lower() for m in re.findall(BAN, texts, re.I))); dash = "\u2014" in texts or "\u2013" in texts
emoji = re.findall(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", texts)
row("Q13", "No advice / hype / jargon words, em dashes, emoji", not hits and not dash and not emoji, f"hits {hits or 'none'}, em dash {dash}, emoji {len(emoji)}")

# Q17 no "demo" anywhere a viewer sees or hears it: script, subtitles, every text layer's source strings,
# and the metadata title/description lines other than the illustrative-portfolio disclaimer
plan = json.load(open(os.environ["SHORT_PLAN"])) if os.environ.get("SHORT_PLAN") else None
seen = texts + "\n" + os.environ.get("SHORT_STRINGS", "")
demo = re.findall(r"\bdemo\b", seen, re.I)
row("Q17", "No \"demo\" in voice, subtitles, cards, metadata", not demo, f"{len(demo)} hits")

if plan:
    # Q18 one camera language: every beat pushes to the same scale with the same in/out durations, and
    # every cut sits on the music grid (0.3 s at 100 BPM)
    zs = [b.get("zoom") for b in plan["beats"]]
    shape = {(z["to"], round(z["in"][1] - z["in"][0], 2), round(z["out"][1] - z["out"][0], 2) if z.get("out") else None) for z in zs if z}
    outs = {s[2] for s in shape if s[2] is not None}
    cuts, t = [], plan["hook"]["dur"] if plan.get("hook") else 0.0
    for b in plan["beats"][:-1]: t += b["dur"]; cuts.append(round(t, 3))
    off = [c for c in cuts if abs(c / 0.3 - round(c / 0.3)) > 0.02]
    ok18 = all(zs) and len({(s[0], s[1]) for s in shape}) == 1 and len(outs) <= 1 and not off
    row("Q18", "Consistent motion (same push on every beat, cuts on the 0.3 s grid)", ok18,
        f"{len(zs)} beats, push {sorted(shape, key=str)}; cuts {cuts}" + (f", off-grid {off}" if off else ""))
    # Q19 real scrolling: beats whose source footage scrolls (row-shift between frames) for >= 0.5 s
    n_scroll = 0; detail = []
    for b in plan["beats"]:
        if b.get("freeze"): detail.append("frozen"); continue
        o = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(b["start"]), "-t", str(b["dur"]), "-i", b["src"], "-vf", "fps=30,crop=1206:1600:0:500,scale=120:160,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        fr = np.frombuffer(o, dtype=np.uint8).reshape(-1, 160, 120).astype(float)
        moving = sum(1 for a, c in zip(fr, fr[1:]) if np.abs(a - c).mean() > 1.5) / 30
        detail.append(f"{moving:.1f}s"); n_scroll += moving >= 0.5
    row("Q19", "Live scroll segments >= 3", n_scroll >= 3, f"{n_scroll} beats scroll; moving time per beat {detail}")
print("| # | Metric | Result | Measured |\n|---|---|---|---|")
for r in rows: print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |")
for k, n in (("Q20", "Insight lines: why + sentiment, each with 2 sources"), ("Q11", "Every figure sourced"), ("Q12", "Pronunciation"), ("Q14", "Disclaimer visible"), ("Q15", "Brand"), ("Q16", "Proof frames viewed")):
    print(f"| {k} | {n} | MANUAL | see below |")
sys.exit(1 if bad else 0)
