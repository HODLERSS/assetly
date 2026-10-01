#!/usr/bin/env python3
"""Stage 4, footage: one take of the real app on the skill's own simulator, with Ask asked on camera.

    record.py <edition> <work-dir> [--udid UDID]

Runs web/ios/App/marketing/record-hero.sh with HERO_TEST=testGshort (Home -> the edition's brief -> each story
holding on 1D (1W before the open) -> News -> Ask, the question typed and the real answer held and scrolled),
recording the simulator display itself (simctl recordVideo, 30-42 unique fps while scrolling). The UI test attaches
wall-clock marks and the Ask answer's on-screen text; this script maps the marks onto the recording (the recorder's
own "Recording started" stamp, refined by matching every tap mark to the screen change it causes) and writes
<work>/take60.mp4 (60 fps CFR), <work>/marks.json ({name: seconds in take60}) and <work>/ask.json.
"""
import glob, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import APP, Stage, jdump, jload, log

ED, W = sys.argv[1], sys.argv[2]
UDID = sys.argv[sys.argv.index("--udid") + 1] if "--udid" in sys.argv else os.environ.get("SHORTS_UDID", "43B3BBEF-E13F-47E8-ADFA-2E8FB829E217")
ASKQ = {"preopen": "What's ahead for my portfolio today?", "midday": "What's moving my portfolio today?",
        "close": "How did I do this week and this month?"}
os.environ["DEVELOPER_DIR"] = "/Applications/Xcode.app/Contents/Developer"


def scene_changes(mov):
    """Times (s) where the picture changes a lot from one frame to the next (navigations, not scrolls)."""
    o = subprocess.run(["ffmpeg", "-v", "error", "-i", mov, "-vf", "fps=30,scale=120:260,format=gray", "-f", "rawvideo", "-"],
                       capture_output=True).stdout
    import numpy as np
    fr = np.frombuffer(o, dtype=np.uint8).reshape(-1, 260, 120).astype(float)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    return [(i + 1) / 30 for i in range(len(d)) if d[i] > 8 and (i == 0 or d[i - 1] <= 8)], d


def main():
    acct = jload(os.path.join(W, "account.json")); res = jload(os.path.join(W, "research.json"))
    held = {b["symbol"] for b in acct.get("book", [])}
    syms = []
    for it in res["items"]:
        for s in it.get("symbols", []):
            if s in held and s not in syms: syms.append(s)
    q = jload(os.path.join(W, "ask-question.json"), {}).get("q") or ASKQ[ED]
    # one take at a time on the skill's simulator (two editions or two test runs may overlap)
    lock = "/tmp/assetly-shorts/record.lock"
    if "--align-only" not in sys.argv:
        import time
        for _ in range(240):
            try:
                os.mkdir(lock); break
            except FileExistsError:
                if time.time() - os.path.getmtime(lock) > 900: os.rmdir(lock)   # a stale lock from a killed run
                else: time.sleep(5)
    try:
        _main_take_and_align(acct, res, syms, q)
    finally:
        if os.path.isdir(lock) and "--align-only" not in sys.argv: os.rmdir(lock)


def _main_take_and_align(acct, res, syms, q):
    if "--align-only" not in sys.argv:          # re-map an existing take (no new recording)
        with Stage(W, "record.take"):
            env = dict(os.environ, THEME="dark", CRED=acct["cred"], DAILY_SYMBOLS=",".join(syms[:4]),
                       DAILY_RANGE="1W" if ED == "preopen" else "1D", HERO_TEST="testGshort", ASK_QUESTION=q,
                       SIM_VIDEO=os.path.join(W, "disp.mov"), OUT=os.path.join(W, "raw.mp4"),
                       XCRESULT=os.path.join(W, "take.xcresult"), DERIVED="/tmp/assetly-shorts/dd", ATT_DIR=os.path.join(W, "att"),
                       XCLOG=os.path.join(W, "xcodebuild.log"))
            r = subprocess.run([os.path.join(APP, "web/ios/App/marketing/record-hero.sh"), UDID], env=env, capture_output=True, text=True)
            open(os.path.join(W, "record.log"), "w").write(r.stdout + r.stderr)
            log((r.stdout + r.stderr).strip().splitlines()[-3:] if (r.stdout + r.stderr).strip() else "no output")
            if not os.path.exists(os.path.join(W, "disp.mov")):
                sys.exit("REFUSE: no display recording")
    with Stage(W, "record.align"):
        man = glob.glob(os.path.join(W, "att", "manifest.json"))
        mk = None
        for m in json.load(open(man[0])) if man else []:
            for a in m.get("attachments", []):
                if a.get("suggestedHumanReadableName", "").startswith("short-markers"):
                    mk = json.load(open(os.path.join(W, "att", a["exportedFileName"])))
        if not mk:
            sys.exit("REFUSE: the take carries no short-markers attachment (did testGshort run?)")
        rec0 = None
        for line in open(os.path.join(W, "disp.reclog")):
            if "Recording started" in line: rec0 = float(line.split()[0])
        cuts, d = scene_changes(os.path.join(W, "disp.mov"))
        rel = {m["name"]: m["t"] - rec0 for m in mk["marks"]}
        # Anchor the clock on every screen change the test causes. On a quiet Mac the recorder stamp alone is right to
        # ~0.02 s (9/30 take 1: every tap's change 0.14-0.18 s after its mark); on a busy one the display recording drifts
        # by seconds within a take (9/30 take 3: -0.8 s to +2.6 s), so each mark is mapped through the nearest anchors.
        AN = {"tap_": 0.17, "ask_sent": 0.25, "ask_answer": 0.15}
        evs = sorted((t, next(v for p, v in AN.items() if k.startswith(p))) for k, t in rel.items() if any(k.startswith(p) for p in AN))
        # screen-change peaks (local maxima of the frame difference above 8)
        peaks = [(i + 1) / 30 for i in range(1, len(d) - 1) if d[i] > 8 and d[i] >= d[i - 1] and d[i] >= d[i + 1]]
        # The recorder can drift from the wall clock by many seconds (9/30 pre-open take: ~15 s by the Ask beat) but the
        # INTERVALS between the test's own taps survive. Seed on every peak for the first event, then match each next event
        # to the peak that keeps its interval from the previous match (+-1.2 s); keep the seed that explains the most events.
        # A prior from the end of the take: the test ends right after "ask_end" and the app leaves the screen, so the
        # iOS home screen (high colour saturation; the app is a dark low-saturation UI) starts ~0.3-0.7 s after it.
        sat = [float(x) for x in subprocess.run(["ffprobe", "-v", "error", "-f", "lavfi", "-i", f"movie={os.path.join(W, 'disp.mov')},fps=2,scale=120:-1,signalstats",
               "-show_entries", "frame_tags=lavfi.signalstats.SATAVG", "-of", "csv=p=0"], capture_output=True, text=True).stdout.replace(",", " ").split()]
        j = len(sat) - 1
        while j > 0 and sat[j] > 20: j -= 1
        prior = ((j + 1) / 2 - rel["ask_end"] - 0.5) if "ask_end" in rel and len(sat) - 1 - j >= 4 else 0.0
        seqs = []
        for seed in peaks:
            if not evs: break
            seq = [(evs[0][0], seed - evs[0][1])]; err = 0.0
            for t, e in evs[1:]:
                want = seq[-1][1] + (t - seq[-1][0])
                c = [x - e for x in peaks if abs((x - e) - want) <= 1.2]
                if c:
                    v = min(c, key=lambda v: abs(v - want)); err += abs(v - want); seq.append((t, v))
            seqs.append((len(seq), err, seq))
        top = max((q[0] for q in seqs), default=0)
        # among the chains that explain (nearly) every event, the one whose last lag agrees with the end-of-take prior
        good = [q for q in seqs if q[0] >= top - 1]
        chain = min(good, key=lambda q: (abs((q[2][-1][1] - q[2][-1][0]) - prior), q[1]))[2] if good else []
        anchors = [(t, v - t) for t, v in chain]
        log(f"end-of-take prior lag {prior:+.2f}s")
        def mapped(t):
            if not anchors: return t
            if t <= anchors[0][0]: return t + anchors[0][1]
            if t >= anchors[-1][0]: return t + anchors[-1][1]
            for (t0, l0), (t1, l1) in zip(anchors, anchors[1:]):
                if t0 <= t <= t1: return t + l0 + (l1 - l0) * (t - t0) / (t1 - t0)
        lags = [l for _, l in anchors]
        off = sorted(lags)[len(lags) // 2] if lags else 0.0
        best = (max(lags) - min(lags) if lags else 0.0, off)
        marks = {k: round(mapped(v), 3) for k, v in rel.items()}
        log(f"anchors {[(round(t, 1), round(l, 2)) for t, l in anchors]}")
        log(f"clock: median lag {off:+.2f}s, spread {best[0]:.2f}s over {len(lags)} anchors; marks: " + ", ".join(f"{k}={v}" for k, v in marks.items()))
        jdump({"offset": off, "fit_error": best[0], "marks": marks, "cuts": cuts}, os.path.join(W, "marks.json"))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(W, "disp.mov"), "-vf", "fps=60", "-fps_mode", "cfr", "-c:v", "libx264",
                        "-crf", "12", "-preset", "fast", "-pix_fmt", "yuv420p", "-an", os.path.join(W, "take60.mp4")], check=True)
        # the answer as the app showed it: the texts between the question bubble and the answer's own foot
        texts = mk.get("texts", [])
        qi = max([i for i, t in enumerate(texts) if t.strip() == mk["question"].strip()], default=-1)
        foot = [i for i, t in enumerate(texts) if i > qi and t.strip() == "Not financial advice"]
        ans = [t for t in texts[qi + 1:foot[0] if foot else len(texts)] if t.strip()]
        # each answer line's box in take pixels (the UI test's element frames in points x the display scale) and whether it
        # sits above the composer, i.e. visible in the held shot: the voice may only quote a visible line (owner, 10/1)
        rects = []
        fr, win = mk.get("frames") or [], mk.get("window") or [0, 0]
        if fr and win[0]:
            px = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0",
                                     os.path.join(W, "take60.mp4")], capture_output=True, text=True).stdout.strip() or 0)
            k = px / win[0] if px else 3.0
            fq = max([i for i, f in enumerate(fr) if f[0].strip() == mk["question"].strip()], default=-1)
            ff = [i for i, f in enumerate(fr) if i > fq and f[0].strip() == "Not financial advice"]
            # one entry per answer point: a bullet glyph starts a point and the text runs after it (a name in bold, a
            # figure, the rest) join it, so the voice quotes a whole point and the outline covers all of its segments
            seg = fr[fq + 1:ff[0] if ff else len(fr)]
            bullets = any(not re.search(r"[A-Za-z0-9]", f[0]) and f[0].strip() for f in seg)
            for f in seg:
                if not re.search(r"[A-Za-z0-9]", f[0]):
                    if f[0].strip() and (not rects or rects[-1]["boxes"]): rects.append({"text": "", "boxes": []})
                    continue
                box = [round(f[1] * k), round(f[2] * k), round(f[3] * k), round(f[4] * k)]
                if not bullets or not rects: rects.append({"text": "", "boxes": []})
                g = rects[-1]; g["text"] = (g["text"] + " " + f[0].strip()).strip(); g["boxes"].append(box)
            rects = [g for g in rects if g["boxes"]]
            for g in rects:
                bx = g["boxes"]; g["box"] = [min(b[0] for b in bx), min(b[1] for b in bx), max(b[2] for b in bx), max(b[3] for b in bx)]
                g["visible"] = g["box"][1] >= 0 and g["box"][3] <= 0.84 * win[1] * k
        jdump({"question": mk["question"], "answer_lines": ans, "answer": " ".join(ans), "all_texts": texts, "answer_rects": rects},
              os.path.join(W, "ask.json"))
        log(f"ask: {mk['question']!r} -> {len(ans)} lines: {' '.join(ans)[:200]}; {sum(r['visible'] for r in rects)}/{len(rects)} line boxes visible")
        if not ans:
            sys.exit("REFUSE: no Ask answer on screen")
        if "pos_" in json.dumps(marks) and any(k.endswith("_missing") for k in marks):
            log("WARN: a story holding was not found on Home:", [k for k in marks if k.endswith("_missing")])


main()
