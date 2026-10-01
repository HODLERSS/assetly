import subprocess, numpy as np, json, sys
from PIL import Image
V, OUT = sys.argv[1], sys.argv[2]; W, H = 1080, 1920
TOP_NEW, SUB_BOTTOM, SUB_SCALE, REST_W, PHONE_W, PUSH = 508, 468, 1.12, 663, 860, 0.15
m = [(t, xl, xr, (e - 0.118 * (xr - xl)) if e > 0 else -1) for t, xl, xr, e, _ in json.load(open("meas2.json"))]
ok = lambda r: r[3] > 0 and 640 <= r[2] - r[1] <= 880 and abs((r[1] + r[2]) - 1079) <= 20
good = [i for i, r in enumerate(m) if ok(r)]
def interp(i, key):
    if ok(m[i]): return key(m[i])
    lo = max([g for g in good if g < i], default=None); hi = min([g for g in good if g > i], default=None)
    if lo is None and hi is None: return None
    if lo is None: return key(m[hi])
    if hi is None: return key(m[lo])
    f = (i - lo) / (hi - lo); return key(m[lo]) * (1 - f) + key(m[hi]) * f
first, last = good[0], good[-1]
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", V, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "60", "-i", "-",
                        "-i", V, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
                        "-c:a", "copy", "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
bgc = None; i = 0
while True:
    b = dec.stdout.read(W * H * 3)
    if len(b) < W * H * 3: break
    a = np.frombuffer(b, np.uint8).reshape(H, W, 3)
    if bgc is None: bgc = a[1000, 5].copy()
    if i < first or i > last:                      # cover and end card untouched
        enc.stdin.write(b); i += 1; continue
    w = interp(i, lambda r: r[2] - r[1]); top = interp(i, lambda r: r[3])
    E = max(0.0, min(1.0, (w / REST_W - 1) / 0.3))
    k = PHONE_W * (1 + PUSH * E) / w
    out = np.empty_like(a); out[:] = bgc
    out[:198] = a[:198]                            # stamp, disclaimer, pills, corner tags
    # phone: old top -> TOP_NEW, scaled k about the centre column
    CLIP = 452                                     # the old edit cut a pushed-up phone at the strip's lower edge
    y0 = int(max(CLIP, top - 14)); ph = Image.fromarray(a[y0:])
    nw, nh = int(round(W * k)), int(round((H - y0) * k))
    ph = ph.resize((nw, nh), Image.BICUBIC); px, py = int(round(540 - 540 * k)), int(round(TOP_NEW - max(0, top - y0) * k))
    ph = np.asarray(ph); sx0, sy0 = max(0, -px), max(0, -py); dx0, dy0 = max(0, px), max(0, py)
    hh, ww = min(H - dy0, nh - sy0), min(W - dx0, nw - sx0)
    out[dy0:dy0 + hh, dx0:dx0 + ww] = ph[sy0:sy0 + hh, sx0:sx0 + ww]
    # subtitles + eyebrow: bigger, last line on a fixed row 40 px above the phone
    rb = int(min(452, max(300, top - 6))); R = a[198:rb].astype(np.int16).sum(2)
    ys = np.where((R > int(bgc.astype(int).sum()) + 40).sum(1) >= 2)[0]
    if len(ys):
        tb = 198 + int(ys.max()) + 4                   # just below the lowest text row (faint, fading words included)
        band = Image.fromarray(a[198:tb]); bw, bh = int(round(W * SUB_SCALE)), int(round((tb - 198) * SUB_SCALE))
        band = np.asarray(band.resize((bw, bh), Image.BICUBIC))
        bx = int(round(540 - bw / 2)); by = SUB_BOTTOM + 4 - bh
        sy = max(0, 198 - by); sx = -bx
        out[by + sy:by + bh, 0:W] = band[sy:bh, sx:sx + W]
    enc.stdin.write(out.tobytes()); i += 1
enc.stdin.close(); enc.wait(); print("frames", i, "phone frames", first, last)
