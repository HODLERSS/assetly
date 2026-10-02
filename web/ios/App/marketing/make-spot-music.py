#!/usr/bin/env python3
"""Builds an arranged music bed for a spot from Apple Loops, on a bar grid.

    make-spot-music.py <plan.json> <out.wav>

plan.json:
  {"bpm": 100, "len": 30.0, "loudness": -15,
   "stems":    [{"loop": "Forward Progress Bass", "gain": -4, "from": 0, "to": 12.5}, ...],
   "oneshots": [{"loop": "80s Synth FX Riser 01", "gain": -12, "end_at": 1}, ...],
   (a stem's optional "af": an ffmpeg filter chain after its gain, e.g. a speech-band dip so a full-mix loop leaves the voice room)
   "fade_out": 1.2}

`from`/`to`/`end_at` are in BARS. A stem is the loop tiled from `from` to `to`; a one-shot is placed
so it ENDS on the bar line `end_at`, which is what a riser is for. Region edges get a 30 ms fade so a
stem that stops mid-loop does not click.

Shorts (assetly-shorts v1.4.0, owner 10/2: "Music finishes a bit early"): `from` / `to` / `end_at` may also be
"card" (the end card's start, `card_at` seconds in the plan, snapped to the nearest beat) or "end" (`to` only: the
Short's last sample). A bar count past the length is clipped, so an arrangement written for 30 s fits a 21 s Short;
`cover` (default false) asserts that at least one stem sounds in every 100 ms window up to the last sample.

Loops are decoded with afconvert, never ffmpeg (see make-music.sh: ffmpeg returns the AAC priming
frames as audio and every repeat lands 53 ms late). Each loop is asserted to be a whole number of
bars, and each region's sample offsets are integers, so nothing here can drift off the grid.
"""
import json, os, subprocess, sys, tempfile, wave, re

plan = json.load(open(sys.argv[1])); OUT = sys.argv[2]
BPM = plan.get("bpm", 100); SR = 48000
BAR = 60.0 / BPM * 4; BAR_S = int(round(BAR * SR))
LEN = float(plan["len"]); LEN_S = int(round(LEN * SR))
LIB = "/Library/Audio/Apple Loops/Apple"
W = tempfile.mkdtemp()

def find(name):
    for root, _, files in os.walk(LIB):
        if name + ".caf" in files: return os.path.join(root, name + ".caf")
    sys.exit(f"loop not found: {name}")

def decode(name):
    out = os.path.join(W, re.sub(r"\W+", "_", name) + ".wav")
    if not os.path.exists(out):
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI24@{SR}", find(name), out], check=True, capture_output=True)
    n = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=duration_ts",
                            "-of", "csv=p=0", out], capture_output=True, text=True).stdout.strip())
    return out, n

def ff(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)

BEAT = BAR / 4
def pos(v):
    """a position in bars: a number, "card" (the end card's start on the nearest beat) or "end" (the last sample)"""
    if v == "end": return LEN / BAR
    if v == "card": return round(float(plan["card_at"]) / BEAT) * BEAT / BAR
    return float(v)

tracks = []
for i, st in enumerate(plan["stems"]):
    src, n = decode(st["loop"])
    bars = n / BAR_S
    if abs(bars - round(bars)) > 1e-6 and st.get("strict", True):
        sys.exit(f'{st["loop"]}: {n} samples = {bars:.4f} bars, not tileable')
    a, b = int(round(pos(st["from"]) * BAR_S)), int(round(pos(st["to"]) * BAR_S))
    if a >= LEN_S: continue
    b = min(b, LEN_S); dur = b - a
    if dur <= 0: continue
    out = os.path.join(W, f"stem{i}.wav")
    # tile from the loop's own start so the downbeat lands on `from`, then trim, fade edges, delay. "phase": "song" (the
    # v1.4.0 Shorts beds) instead keeps every loop in phase with bar 0, as if all had played from the start and were only
    # unmuted at `from`: a 4-bar chord loop entering at bar 1 or on the end card still changes chords with the bass
    head = (a % n) if plan.get("phase") == "song" else 0
    ff(["-stream_loop", "-1", "-i", src, "-af",
        f"atrim=start_sample={head}:end_sample={head + dur},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st={(dur/SR)-0.03:.4f}:d=0.03,"
        f"volume={st['gain']}dB,{st['af'] + ',' if st.get('af') else ''}adelay={a}S|{a}S:all=1,apad,atrim=end_sample={LEN_S}",
        "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", out])
    tracks.append(out)
    print(f"  stem  {st['loop']:<28} bars {pos(st['from']):>5.2f}-{min(pos(st['to']), LEN / BAR):<5.2f} {st['gain']:+} dB")

for i, os_ in enumerate(plan.get("oneshots", [])):
    src, n = decode(os_["loop"])
    end = int(round(pos(os_["end_at"]) * BAR_S)); start = end - n
    out = os.path.join(W, f"shot{i}.wav")
    if start < 0:
        # the riser is longer than the room before its bar line: keep its END, drop its head
        ff(["-i", src, "-af", f"atrim=start_sample={-start},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05,"
            f"volume={os_['gain']}dB,apad,atrim=end_sample={LEN_S}", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", out])
    else:
        ff(["-i", src, "-af", f"volume={os_['gain']}dB,adelay={start}S|{start}S:all=1,apad,atrim=end_sample={LEN_S}",
            "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", out])
    tracks.append(out)
    print(f"  shot  {os_['loop']:<28} ends at bar {pos(os_['end_at']):.2f} ({end/SR:.2f}s) {os_['gain']:+} dB")

fade = plan.get("fade_out", 1.2)
inputs = sum((["-i", t] for t in tracks), [])
n = len(tracks)
graph = "".join(f"[{i}:a]" for i in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest[m];" \
        f"[m]afade=t=in:st=0:d=0.02,afade=t=out:st={LEN-fade:.3f}:d={fade},alimiter=limit=0.89:level=disabled,apad,atrim=end_sample={LEN_S}[a]"
flat = os.path.join(W, "flat.wav")
ff([*inputs, "-filter_complex", graph, "-map", "[a]", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", flat])

# measured static gain to the target loudness (the spot mixer re-levels the final mix anyway)
meas = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", flat, "-af", "ebur128=peak=true", "-f", "null", "-"],
                      capture_output=True, text=True).stderr
lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", meas.split("Summary")[-1]).group(1))
gain = plan.get("loudness", -15) - lufs
ff(["-i", flat, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=disabled", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", OUT])
got = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=duration_ts", "-of", "csv=p=0", OUT],
                         capture_output=True, text=True).stdout.strip())
assert got == LEN_S, f"bed is {got} samples, wanted {LEN_S}"
if plan.get("cover"):
    # the bed sounds from the first frame to the last (v1.4.0): no 100 ms window before the final fade's last 0.3 s is silent
    import numpy as np
    x = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", OUT, "-ac", "1", "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
    n = SR // 10; k = len(x) // n; r = 20 * np.log10(np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(1)) + 1e-9)
    quiet = [round(i / 10, 1) for i in range(k) if i / 10 < LEN - 0.3 and r[i] < -45]
    assert not quiet, f"bed silent at {quiet[:6]} s (of {LEN:.2f} s): the arrangement does not cover the Short"
print(f"bed: {LEN}s at {BPM} BPM, {lufs:.1f} -> {plan.get('loudness', -15)} LUFS ({gain:+.1f} dB)")
