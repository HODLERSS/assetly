#!/usr/bin/env python3
"""Composes a spot from a plan: hook card, product beats in an iPhone body with a slow push-in,
captions that rise and fade, a light-to-dark dissolve beat, and a staggered end card.

    make-spot.py <plan.json> <out.mp4>          # silent video, exact length plan["len"]

plan.json:
  {"w":1080,"h":1350,"len":30.0,"theme":"light","fps":30,"xfade":0.6,
   "hook":  {"lines":"What moved|your money today?","dur":2.4},
   "beats": [{"src":"norm.mp4","start":4.6,"dur":2.4,"caption":"Everything you own, in one place"},
             {"flip":true,"src":"flip.mp4","start_light":3.6,"start_dark":15.2,"dur":2.4,"xf":0.5,
              "caption":"Light or dark"}],
   "card":  {"icon":"AppIcon.png"}}

Every beat is rendered to its own near-lossless file and concatenated. One filtergraph for the whole
spot is tidier and silently returned only the first segment (see cut-hero.sh); this stays explicit.
Timing is on the frame grid: every duration is rounded to whole frames before anything is cut, so
the concatenation cannot accumulate a stray frame per beat.
"""
import json, os, subprocess, sys, tempfile, math

plan = json.load(open(sys.argv[1])); OUT = sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = plan.get("w", 1080), plan.get("h", 1350), plan.get("fps", 30)
LEN = float(plan["len"]); XF = plan.get("xfade", 0.6)
DARK = plan.get("theme", "light") == "dark"
BG = "0x0F1216" if DARK else "0xF4F5F7"
os.environ["THEME"] = plan.get("theme", "light")
T = tempfile.mkdtemp()
def frames(sec): return int(round(sec * FPS))
def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)
def probe(f):
    o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                        "stream=width,height,nb_frames,color_range", "-of", "json", f], capture_output=True, text=True).stdout
    return json.loads(o)["streams"][0]
ENC = ["-c:v", "libx264", "-crf", "12", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", str(FPS)]

# ---- phone geometry, per make-hero-clip.sh -----------------------------------------------------
TOP, CAP_H, CAP_SIZE, PAD = (28, 168, 58, 100) if H > W else (18, 140, 50, 100)
srcs = [b["src"] for b in plan["beats"]]
s0 = probe(srcs[0]); SRC_W, SRC_H = s0["width"], s0["height"]
aspect = SRC_H / SRC_W
body_h = H - TOP - CAP_H
screen_w = int(round(body_h / (aspect + 0.054) / 2)) * 2
screen_h = int(round(screen_w * aspect / 2)) * 2
bez = max(6, int(round(screen_w * 0.027)))
body_w = screen_w + 2 * bez
body_r = int(round(body_w * 0.155))
body_x = (W - body_w) // 2
SCREEN_X, SCREEN_Y, BODY_X, BODY_Y, CAP_Y = body_x + bez, TOP + bez, body_x - PAD, TOP - PAD, H - CAP_H
subprocess.run([os.path.join(HERE, "roundrect-mask.py"), str(screen_w), str(screen_h), str(body_r - bez), f"{T}/mask.png"], check=True, capture_output=True)
subprocess.run([os.path.join(HERE, "device-frame.py"), str(screen_w), str(screen_h), f"{T}/frame.png"], check=True, capture_output=True)
print(f"screen {screen_w}x{screen_h} on {W}x{H}")

# Slow push-in on the whole phone, reset on every cut. 3.5% over a beat is felt, not seen; the
# alternative (a static frame) reads as a slideshow the moment the music has motion in it.
PUSH = plan.get("push", 0.035)
def phone_chain(dur):
    return (f"scale={screen_w}:{screen_h}:flags=lanczos,format=rgba[scr];"
            f"[1:v]format=gray,scale={screen_w}:{screen_h}[m];[scr][m]alphamerge[rounded];"
            f"color=c={BG}:s={W}x{H}:r={FPS}:d={dur:.3f}[bg];"
            f"[bg][2:v]overlay={BODY_X}:{BODY_Y}:format=auto[withbody];"
            f"[withbody][rounded]overlay={SCREEN_X}:{SCREEN_Y}:format=auto:shortest=1[ph];"
            f"[ph]scale=w='trunc({W}*(1+{PUSH}*t/{dur:.3f})/2)*2':h='trunc({H}*(1+{PUSH}*t/{dur:.3f})/2)*2':eval=frame,"
            f"crop={W}:{H},format=yuv420p")

parts = []
# ---- hook ----------------------------------------------------------------------------------------
hook = plan.get("hook")
if hook:
    d = hook["dur"]
    subprocess.run([os.path.join(HERE, "make-cards.py"), "hook", str(W), str(H), f"{T}/cards", hook["lines"]], check=True, capture_output=True)
    layers = [f for f in ("hook0.png", "hook1.png", "hook2.png") if os.path.exists(f"{T}/cards/{f}")] + ["hook_rule.png"]
    inputs = []; fc = f"color=c={BG}:s={W}x{H}:r={FPS}:d={d:.3f}[b0];"
    for i, name in enumerate(layers):
        inputs += ["-loop", "1", "-t", f"{d:.3f}", "-i", f"{T}/cards/{name}"]
        st = 0.12 + 0.16 * i                      # each line lands a beat after the last
        fc += (f"[{i}:v]format=rgba,fade=t=in:st={st:.2f}:d=0.38:alpha=1[l{i}];"
               f"[b{i}][l{i}]overlay=0:'18*(1-min(max(t-{st:.2f},0)/0.45,1))':format=auto[b{i+1}];")
    fc += f"[b{len(layers)}]format=yuv420p[v]"
    ff(*inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", str(frames(d)), *ENC, f"{T}/p_hook.mp4")
    parts.append(f"{T}/p_hook.mp4"); print(f"hook {d}s")

# ---- beats ---------------------------------------------------------------------------------------
caps = []          # (start, end, text) on the product timeline
t_cursor = hook["dur"] if hook else 0.0
for i, b in enumerate(plan["beats"]):
    d = b["dur"]; out = f"{T}/p{i}.mp4"
    if b.get("flip"):
        # two stills of the same screen in both grounds, dissolved: the only "transition" in the
        # spot, spent on the one moment where a dissolve is the content rather than decoration
        xf = b.get("xf", 0.5); hold = b.get("hold", 0.8)
        for tag, st in (("A", b["start_light"]), ("B", b["start_dark"])):
            ff("-ss", f"{st:.3f}", "-i", b["src"], "-i", f"{T}/mask.png", "-i", f"{T}/frame.png",
               "-filter_complex", "[0:v]" + phone_chain(d) + "[v]", "-map", "[v]", "-frames:v", str(frames(d)), *ENC, f"{T}/p{i}{tag}.mp4")
        ff("-i", f"{T}/p{i}A.mp4", "-i", f"{T}/p{i}B.mp4", "-filter_complex",
           f"[0:v]settb=AVTB[a];[1:v]settb=AVTB[b];[a][b]xfade=transition=fade:duration={xf}:offset={hold:.3f},format=yuv420p[v]",
           "-map", "[v]", "-frames:v", str(frames(d)), *ENC, out)
        print(f"beat {i}: flip  {hold}s light -> {xf}s dissolve -> dark, {d}s")
    else:
        ff("-ss", f"{b['start']:.3f}", "-i", b["src"], "-i", f"{T}/mask.png", "-i", f"{T}/frame.png",
           "-filter_complex", "[0:v]" + phone_chain(d) + "[v]", "-map", "[v]", "-frames:v", str(frames(d)), *ENC, out)
        print(f"beat {i}: {b['src'].split('/')[-1]} @{b['start']}s +{d}s")
    n = int(probe(out)["nb_frames"]); assert n == frames(d), f"beat {i}: {n} frames, wanted {frames(d)}"
    parts.append(out)
    if b.get("caption"): caps.append((t_cursor, t_cursor + d, b["caption"]))
    t_cursor += d
PRODUCT = t_cursor

with open(f"{T}/list.txt", "w") as f:
    for p in parts: f.write(f"file '{p}'\n")
ff("-f", "concat", "-safe", "0", "-i", f"{T}/list.txt", "-c", "copy", f"{T}/product_raw.mp4")

# ---- captions: rise 12px and fade in over 0.28s, fade out over 0.2s ------------------------------
inputs = ["-i", f"{T}/product_raw.mp4"]; fc = "[0:v]format=yuv420p[b0];"
for k, (s, e, text) in enumerate(caps):
    subprocess.run([os.path.join(HERE, "make-cards.py"), "cap", str(W), str(CAP_H), str(CAP_SIZE), f"{T}/cap{k}.png", text], check=True, capture_output=True)
    inputs += ["-loop", "1", "-t", f"{PRODUCT:.3f}", "-i", f"{T}/cap{k}.png"]
    si, so = s + 0.10, e - 0.22
    fc += (f"[{k+1}:v]format=rgba,fade=t=in:st={si:.3f}:d=0.28:alpha=1,fade=t=out:st={so:.3f}:d=0.2:alpha=1[c{k}];"
           f"[b{k}][c{k}]overlay=0:'{CAP_Y}+12*(1-min(max(t-{si:.3f},0)/0.32,1))':format=auto:enable='between(t,{si:.3f},{e:.3f})'[b{k+1}];")
fc += f"[b{len(caps)}]format=yuv420p[v]"
ff(*inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", str(frames(PRODUCT)), *ENC, f"{T}/product.mp4")
print(f"product {PRODUCT:.2f}s with {len(caps)} captions")

# ---- end card: icon with the dissolve, then name, sub, cta each a beat later -----------------------
card_len = LEN - PRODUCT + XF
subprocess.run([os.path.join(HERE, "make-cards.py"), "end", str(W), str(H), plan["card"]["icon"], f"{T}/cards"], check=True, capture_output=True)
layers = [("end_icon.png", 0.0), ("end_name.png", 0.35), ("end_sub.png", 0.65), ("end_cta.png", 1.05)]
inputs = []; fc = f"color=c={BG}:s={W}x{H}:r={FPS}:d={card_len:.3f}[b0];"
for i, (name, st) in enumerate(layers):
    inputs += ["-loop", "1", "-t", f"{card_len:.3f}", "-i", f"{T}/cards/{name}"]
    st2 = st + XF * 0.5                       # measured from when the card is half in
    fc += (f"[{i}:v]format=rgba,fade=t=in:st={st2:.2f}:d=0.4:alpha=1[l{i}];"
           f"[b{i}][l{i}]overlay=0:'14*(1-min(max(t-{st2:.2f},0)/0.5,1))':format=auto[b{i+1}];")
fc += f"[b{len(layers)}]format=yuv420p[v]"
ff(*inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", str(frames(card_len)), *ENC, f"{T}/card.mp4")

offset = PRODUCT - XF
ff("-i", f"{T}/product.mp4", "-i", f"{T}/card.mp4", "-filter_complex",
   f"[0:v]settb=AVTB[a];[1:v]settb=AVTB[b];[a][b]xfade=transition=fade:duration={XF}:offset={offset:.3f},format=yuv420p[v]",
   "-map", "[v]", "-frames:v", str(frames(LEN)), "-c:v", "libx264", "-crf", "17", "-preset", "veryslow", "-profile:v", "high",
   "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
   "-movflags", "+faststart", "-r", str(FPS), OUT)
n = int(probe(OUT)["nb_frames"]); assert n == frames(LEN), f"final {n} frames, wanted {frames(LEN)}"
print(f"spot: {LEN}s, {n} frames -> {OUT}")
