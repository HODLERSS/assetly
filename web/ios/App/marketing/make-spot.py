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
# On dark the canvas sits one step above the screen's own ground (#0F1216): the black phone body
# otherwise merges into it and the clip reads as a screenshot on a slab.
BG = "0x14181F" if DARK else "0xF4F5F7"
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

# Push-in on the phone per beat is OFF by default: a phone that grows a little on every cut reads as
# the phone changing size, not as camera motion, and it confused a viewer. Set "push" in the plan
# to turn it on deliberately.
PUSH = plan.get("push", 0.0)

def ease_expr(z, tvar="t"):
    """0 -> 1 over z['in'], hold, 1 -> 0 over z['out']; smootherstep on both ramps (zero velocity and
    zero acceleration at the ends). `tvar` is 't' in most filters and 'T' inside geq."""
    a, b = z["in"]; c, d = z["out"]
    def ss(u): return f"(({u})*({u})*({u})*(({u})*(({u})*6-15)+10))"
    u1 = f"clip(({tvar}-{a:.3f})/{max(b-a,1e-3):.3f},0,1)"; u2 = f"clip(({tvar}-{c:.3f})/{max(d-c,1e-3):.3f},0,1)"
    return f"({ss(u1)}-{ss(u2)})"

def phone_chain(dur, zoom=None, freeze=False):
    src = "trim=end_frame=1,loop=loop=-1:size=1:start=0,setpts=N/(" + str(FPS) + "*TB)," if freeze else ""
    if zoom:
        # A push INTO a subject: the focus point f (canvas px) travels to the target t (stage centre by
        # default) while the scale goes 1 -> S, both on the same eased parameter E, so the camera path
        # is one straight, settling move. Overlay position o(E) = f + E(t-f) - f*s(E) = E*((t-f) - f(S-1)):
        # zero at rest, so cuts carry no jump. crop's offsets are evaluated once; overlay's every frame.
        E = ease_expr(zoom); S = zoom["to"]
        fx, fy = zoom["focus"]; tx, ty = zoom.get("target", (W / 2, (H - CAP_H) / 2))
        kx, ky = (tx - fx) - fx * (S - 1), (ty - fy) - fy * (S - 1)
        sx = f"(1+{S-1:.4f}*{E})"
        # lower-third scrim under the text zone, opacity on the same curve, so a magnified screen can
        # pass beneath the captions without fighting them and nothing shows at rest
        Eg = ease_expr(zoom, "T")
        motion = (f"[ph]scale=w='trunc({W}*{sx}/2)*2':h='trunc({H}*{sx}/2)*2':eval=frame:flags=lanczos[phz];"
                  f"color=c={BG}:s={W}x{H}:r={FPS}:d={dur:.3f}[g2];"
                  f"[g2][phz]overlay=x='{kx:.2f}*{E}':y='{ky:.2f}*{E}':eval=frame:shortest=1[zm];"
                  f"[3:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*{Eg}'[sc];"
                  f"[zm][sc]overlay=0:0:format=auto:shortest=1,format=yuv420p")
    else:
        motion = (f"[ph]scale=w='trunc({W}*(1+{PUSH}*t/{dur:.3f})/2)*2':h='trunc({H}*(1+{PUSH}*t/{dur:.3f})/2)*2':eval=frame,"
                  f"crop={W}:{H},format=yuv420p")
    return (src + f"scale={screen_w}:{screen_h}:flags=lanczos,format=rgba[scr];"
            f"[1:v]format=gray,scale={screen_w}:{screen_h}[m];[scr][m]alphamerge[rounded];"
            f"color=c={BG}:s={W}x{H}:r={FPS}:d={dur:.3f}[bg];"
            f"[bg][2:v]overlay={BODY_X}:{BODY_Y}:format=auto[withbody];"
            f"[withbody][rounded]overlay={SCREEN_X}:{SCREEN_Y}:format=auto:shortest=1[ph];" + motion)

# the scrim: transparent above the text zone, the ground colour from just above the phone's bottom edge
from PIL import Image as _I
_bg = (0x14, 0x18, 0x1F) if DARK else (0xF4, 0xF5, 0xF7)
_sc = _I.new("RGBA", (W, H), _bg + (0,)); _px = _sc.load()
y0, y1 = CAP_Y - 96, CAP_Y + 6
for yy in range(y0, H):
    a = 255 if yy >= y1 else int(255 * ((yy - y0) / (y1 - y0)) ** 1.6)
    for xx in range(W): _px[xx, yy] = _bg + (a,)
_sc.save(f"{T}/scrim.png")

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
        z = b.get("zoom")
        if z: assert z["out"][1] <= d + 1e-6, f"beat {i}: zoom must settle before the beat ends"
        ff("-ss", f"{b['start']:.3f}", "-i", b["src"], "-i", f"{T}/mask.png", "-i", f"{T}/frame.png", "-framerate", str(FPS), "-loop", "1", "-t", f"{d:.3f}", "-i", f"{T}/scrim.png",
           "-filter_complex", "[0:v]" + phone_chain(d, z, b.get("freeze", False)) + "[v]", "-map", "[v]", "-frames:v", str(frames(d)), *ENC, out)
        print(f"beat {i}: {b['src'].split('/')[-1]} @{b['start']}s +{d}s" + ("  frozen" if b.get("freeze") else "") + (f"  zoom x{z['to']} -> {z['focus']} in {z['in']} out {z['out']}" if z else ""))
    n = int(probe(out)["nb_frames"]); assert n == frames(d), f"beat {i}: {n} frames, wanted {frames(d)}"
    parts.append(out)
    if b.get("caption"): caps.append((t_cursor, t_cursor + d, b["caption"]))
    t_cursor += d
PRODUCT = t_cursor

with open(f"{T}/list.txt", "w") as f:
    for p in parts: f.write(f"file '{p}'\n")
ff("-f", "concat", "-safe", "0", "-i", f"{T}/list.txt", "-c", "copy", f"{T}/product_raw.mp4")

# ---- speaking indicator: a PNG sequence from make-speaking.py, over the product before any text ----
inputs = ["-i", f"{T}/product_raw.mp4"]; fc = "[0:v]format=yuv420p[b0];"
# PNG sequences laid over the product before any text: the speaking indicator, and the fill
# subtitles from make-fill-subtitles.py ("overlays": [{"frames": dir, "x": 0, "y": CAP_Y}]).
seqs = []
if plan.get("speaking"):
    seqs.append({"frames": plan["speaking"], "x": plan.get("speaking_x", 460), "y": plan.get("speaking_y", CAP_Y + 4)})
seqs += plan.get("overlays", [])
base = "b0"
for j, sq in enumerate(seqs):
    inputs += ["-framerate", str(FPS), "-i", os.path.join(sq["frames"], "%05d.png")]
    fc += f"[{j+1}:v]format=rgba[sq{j}];[{base}][sq{j}]overlay={sq['x']}:{sq['y']}:format=auto:shortest=1[b0s{j}];"
    base = f"b0s{j}"
off = 1 + len(seqs)

# ---- captions and subtitles: rise 12px and fade in over 0.28s, fade out over 0.2s ----------------
# A subtitle is a spoken sentence (make-cards.py sub: lighter, muted) shown for exactly the time it
# is spoken; a beat whose window is covered by one carries no caption of its own.
texts = [(s, e, t, "cap") for (s, e, t) in caps] + [(su["start"], su["end"], su["text"], "sub") for su in plan.get("subtitles", [])]
prev = base
for k, (s, e, text, kind) in enumerate(texts):
    if kind == "cap":
        subprocess.run([os.path.join(HERE, "make-cards.py"), "cap", str(W), str(CAP_H), str(CAP_SIZE), f"{T}/txt{k}.png", text], check=True, capture_output=True)
    else:
        subprocess.run([os.path.join(HERE, "make-cards.py"), "sub", str(W), str(CAP_H), str(plan.get("sub_size", 42)), f"{T}/txt{k}.png", text], check=True, capture_output=True)
    inputs += ["-loop", "1", "-t", f"{PRODUCT:.3f}", "-i", f"{T}/txt{k}.png"]
    si, so = s + (0.10 if kind == "cap" else 0.0), e - 0.22
    if kind == "cap" and s == 0: si = 0.38                    # the first caption waits for the fade-in
    idx = k + off
    fc += (f"[{idx}:v]format=rgba,fade=t=in:st={si:.3f}:d=0.28:alpha=1,fade=t=out:st={so:.3f}:d=0.2:alpha=1[c{k}];"
           f"[{prev}][c{k}]overlay=0:'{CAP_Y}+12*(1-min(max(t-{si:.3f},0)/0.32,1))':format=auto:enable='between(t,{si:.3f},{e:.3f})'[b{k+1}];")
    prev = f"b{k+1}"
# a short fade from the canvas at the top: a hard cut into a full screen on frame one reads as a glitch
fc += f"[{prev}]fade=t=in:st=0:d=0.3:color={BG},format=yuv420p[v]"
ff(*inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", str(frames(PRODUCT)), *ENC, f"{T}/product.mp4")
print(f"product {PRODUCT:.2f}s with {len(caps)} captions, {len(plan.get('subtitles', []))} subtitles")

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
