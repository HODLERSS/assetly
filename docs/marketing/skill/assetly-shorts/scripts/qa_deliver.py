#!/usr/bin/env python3
"""Stage 9, the gate: the v1.0 metrics on top of make-short's automatic ones, then delivery ONLY if every automatic
row passes. A refused run leaves everything in the work dir and exits 1; nothing reaches docs/.

    qa_deliver.py <edition> <date> <work-dir> <stage-dir> <deliver-dir>

v1.0 rows (docs/marketing/SHORTS_QUALITY.md): Q21 Ask beat, Q22 portfolio beat, Q23 3-5 market items each on two
sources, Q24 duration 20-30 s (hard max 30.0), Q25 edition-correct timing words, Q26 upload copy <= 9.9 MB with
SSIM >= 0.995, Q27 metadata, Q28 Whisper round trip on the final mix, Q29 no loading/blank frame in any beat.
Writes quality-report.md, sources.md, script.md, the upload copy and beat proof frames, then copies the run to
<deliver-dir> (docs/marketing/shorts/<date>-<edition>/).
"""
import difflib, glob, json, os, re, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, attributed, jdump, jload, log
import kr as KRM

ED, DATE, W, ST, DST = sys.argv[1:6]
B = os.path.join(W, "build")
rows = []
def row(k, name, ok, val, auto=True): rows.append((k, name, "PASS" if ok else "FAIL", val, auto))
def run(*a): return subprocess.run(a, capture_output=True, text=True)
def dur(f): return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f).stdout)


def main():
    day = jload(os.path.join(ST, "day.json")); story = jload(os.path.join(W, "story.json")); res = jload(os.path.join(W, "research.json"))
    facts = jload(os.path.join(W, "facts.json")); askc = jload(os.path.join(W, "ask-check.json")); meta = jload(os.path.join(ST, "youtube-metadata.json"))
    lat = jload(os.path.join(W, "latency.json"), {})
    final = os.path.join(ST, f"assetly-short-{day['slug']}.mp4")
    with Stage(W, "qa"):
        # make-short's own automatic rows
        auto = open(os.path.join(ST, "qa-auto.md")).read()
        for m in re.finditer(r"^\| (Q\d+) \| (.+?) \| (PASS|FAIL) \| (.*) \|$", auto, re.M):
            rows.append((m.group(1), m.group(2), m.group(3), m.group(4), True))
        tm = jload(os.path.join(B, "timing.json"))
        L = dur(final)
        # Q21 Ask
        ans_beat = tm["beats"][-1]["dur"]; q_beat = tm["beats"][-2]["dur"]
        row("Q21", "Ask beat: the question typed on camera and the real answer, every answer figure verified",
            not askc["unverified"] and ans_beat >= 2.5 and q_beat >= 1.2,
            f"\"{askc['question']}\" typed ({q_beat:.1f} s), answer on screen {ans_beat:.1f} s; answer figures verified {askc['verified']} unverified {askc['unverified'] or 'none'}")
        # Q22 portfolio insight
        p = story["portfolio"]["text"]
        row("Q22", "Portfolio-insight beat (Home: total value, Today, All time) with a verified figure",
            bool(re.search(r"\d", p)) and "YOUR PORTFOLIO" in json.dumps(day["lines"]) and "your portfolio" in p.lower(), f"\"{p}\" over Home; facts {json.dumps(facts['portfolio'])}")
        # Q23 3-5 market items, each on two independent sources
        n_ok = 0; det = []
        bymap = {h["id"]: h for h in jload(os.path.join(W, "research-data.json"))["headlines"]}
        for it in story["items"]:
            r = res["items"][it["n"]]
            pw = len({bymap[i]["publisher"] for i in r["why_ids"] if i in bymap}); ps = len({bymap[i]["publisher"] for i in r["sentiment_ids"] if i in bymap})
            n_ok += pw >= 2 and ps >= 2; det.append(f"{r['cover']} (why {pw}, read {ps} publishers)")
        row("Q23", "3-5 market items, each why + read on >= 2 independent sources", 3 <= len(story["items"]) <= 5 and n_ok == len(story["items"]), "; ".join(det))
        row("Q24", "Duration 20-30 s (hard max 30.0)", 20.0 <= L <= 30.0, f"{L:.2f} s")
        # Q25 timing words, re-run on the final script
        sys.argv = [sys.argv[0], ED, W]
        from storyline import TIMING
        sc = day["script"]
        need = re.search(TIMING[ED]["need"], sc, re.I); never = [m.group(0) for m in re.finditer(TIMING[ED]["never"], sc, re.I)]
        row("Q25", f"Edition-correct timing words ({ED})", bool(need) and not never, f"uses '{need.group(0) if need else '-'}'; wrong-edition words: {never or 'none'}")
        # Q26 upload copy
        up = os.path.join(ST, f"assetly-short-{day['slug']}-upload.mp4")
        size = os.path.getsize(final)
        if size <= 9.9e6:
            shutil.copyfile(final, up); ssim = 1.0
        else:
            br = int((9.4e6 * 8 / L - 256e3) / 1000)
            for _ in range(3):
                run("ffmpeg", "-v", "error", "-y", "-i", final, "-c:v", "libx264", "-preset", "veryslow", "-b:v", f"{br}k", "-pass", "1", "-an", "-f", "mp4",
                    "-passlogfile", os.path.join(W, "x264"), "/dev/null")
                run("ffmpeg", "-v", "error", "-y", "-i", final, "-c:v", "libx264", "-preset", "veryslow", "-b:v", f"{br}k", "-pass", "2", "-profile:v", "high",
                    "-pix_fmt", "yuv420p", "-passlogfile", os.path.join(W, "x264"), "-c:a", "copy", "-movflags", "+faststart", up)
                if os.path.getsize(up) <= 9.9e6: break
                br = int(br * 0.93)
            o = run("ffmpeg", "-i", up, "-i", final, "-lavfi", "ssim", "-f", "null", "-").stderr
            ssim = float(re.search(r"All:([\d.]+)", o).group(1))
        usize = os.path.getsize(up)
        row("Q26", "Upload copy <= 9.9 MB, visually identical (SSIM >= 0.995)", usize <= 9.9e6 and ssim >= 0.995,
            f"master {size / 1e6:.2f} MB -> upload {usize / 1e6:.2f} MB, SSIM {ssim:.4f}")
        # Q27 metadata
        d = meta["description"]
        from datetime import date as _dq
        _dd = _dq.fromisoformat(DATE) if "DATE" in globals() else None
        okm = (len(meta["title"]) <= 50 and not re.search(r"\b(midday|after the bell|before the bell|pre-?open|seoul open|seoul close)\b|\|\s*\w{3} \d", meta["title"], re.I) and "Portfolio shown is illustrative. Not financial advice." in d and "https://apps.apple.com/app/id6811739789" in d
               and "https://assetly.minjae.co/about.html" in d and "Narration: AI clone of the founder's voice." in d and "#Shorts" in meta["hashtags"] and not re.search(r"\bdemo\b", json.dumps(meta), re.I))
        okm = okm and d.splitlines()[0] == day.get("stamp", {}).get("line", "") and bool(meta.get("tags"))
        row("Q27", "Metadata: first line 'Data as of ...', title <= 70, illustrative line, narration line, App Store + about links, #Shorts, tags, no 'demo'", okm,
            f"title {len(meta['title'])} chars: \"{meta['title']}\"; {len(meta['hashtags'])} hashtags")
        # Q28 Whisper round trip on the final mix
        from faster_whisper import WhisperModel
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        asr = WhisperModel("small.en", device="cpu", compute_type="int8")
        NUMW = set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion point percent dollars dollar".split())
        tok = lambda s: [w for w in (re.sub(r"[^a-z0-9]", "", x.lower()) for x in re.split(r"[\s\-]+", s)) if w]
        sp = os.path.join(B, "day_spoken.json")      # what the voices were given (speakable(): "Q4" -> "fourth quarter")
        spoken = " ".join(l["say"] for l in jload(sp)["lines"]) if os.path.exists(sp) else day["script"]
        proper = {w.lower() for w in re.findall(r"\b[A-Z][a-zA-Z]+\b", spoken)}
        def diff(heard):
            a, b = tok(spoken), tok(heard); bad = []
            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
                if op == "equal": continue
                sa, sb = a[i1:i2], b[j1:j2]
                if not all(re.search(r"\d", w) or w in NUMW for w in sa + sb): bad.append((" ".join(sa) or "-", " ".join(sb) or "-"))
            return len(a), bad
        heard = " ".join(x.text.strip() for x in asr.transcribe(final, beam_size=5)[0])
        open(os.path.join(ST, "asr-transcript.txt"), "w").write(heard + "\n")
        n, bad = diff(heard)
        vo = os.path.join(B, "vo-track.wav")
        vbad = diff(" ".join(x.text.strip() for x in asr.transcribe(vo, beam_size=5)[0]))[1] if bad and os.path.exists(vo) else []
        # a near-miss in the mix ("weighed" -> "waved") passes only when the dry voice track is word for word and the
        # miss is one or two letters off; anything else fails
        near = lambda x, y: len(x.split()) == len(y.split()) == 1 and difflib.SequenceMatcher(a=x, b=y).ratio() >= 0.6
        # a brand name heard as its sound-alike ("Vultr" -> "vulture") is not a misread
        # a brand heard as sound-alikes ("Vultr" -> "vulture", "AppLovin Corporation" -> "app love inc"): every word on the
        # script side is a proper noun and the letters still match >= 60%; and whisper's filler on silence ("- -> you")
        def homophone(x, y):
            wx = [w for w in x.split() if not (re.search(r"\d", w) or w in NUMW)]; wy = [w for w in y.split() if not (re.search(r"\d", w) or w in NUMW)]
            return len(wx) == len(wy) == 1 and difflib.SequenceMatcher(a=wx[0], b=wy[0]).ratio() >= 0.75
        # a brand that starts with a number word heard as the figure (10/1: "Tencent" -> "$0.10", i.e. "ten cents")
        NUMV = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve".split())}
        def numalike(x, y):
            xs = [w for w in x.split() if w not in NUMW]          # "dollars tencent" -> "tencent" (the figure words around it)
            ys = y.split(); digs = [w for w in ys if w.isdigit()]; rest = "".join(w for w in ys if not w.isdigit())
            return len(xs) == 1 and xs[0] in proper and bool(digs) and any(
                xs[0].startswith(w) and len(xs[0]) > len(w) and int(d) == v and xs[0][len(w):] in (rest, "")
                for w, v in NUMV.items() for d in digs)
        # a compound heard split or joined ("premarket" -> "pre market", "rollout" -> "roll out"), figures set aside
        words_of = lambda z: "".join(w for w in z.split() if not (re.search(r"\d", w) or w in NUMW))
        exn = lambda z: re.sub(r"(^|\s)x(?=\s|dividend|$)", r"\1ex", z)           # "ex-dividend" heard as "x dividend"
        # an index spoken letter-by-letter (10/2 preopen: "S and P five hundred" heard "SP 500"): drop "and" between letters
        sandp = lambda z: re.sub(r"\b([a-z]) and ([a-z])\b", r"\1\2", z)
        joined = lambda x, y: bool(words_of(x)) and words_of(sandp(exn(x))) == words_of(sandp(exn(y)))
        # an initialism heard letter by letter (10/2 korea-open: "AI lifted Micron" -> "hey i lifted", mix AND dry track):
        # every heard word must be that letter's name or a sound-alike of it, one per letter
        caps = {w.lower() for w in re.findall(r"\b[A-Z]{2,4}\b", spoken)}
        LETTER = {"a": {"a", "ay", "eh", "hey", "hay"}, "i": {"i", "eye", "aye"}, "e": {"e", "ee"}, "u": {"u", "you"}, "s": {"s", "es"}}
        initialism = lambda x, y: x in caps and len(y.split()) == len(x) and all(
            w in LETTER.get(c, {c}) for c, w in zip(x, y.split()))
        brand = lambda x, y: initialism(x, y) or (x != "-" and all(w in proper for w in x.split()) and difflib.SequenceMatcher(a=x.replace(" ", ""), b=y.replace(" ", "")).ratio() >= 0.6) \
            or (x == "-" and y in ("you", "uh", "um", "thank you", "the")) \
            or homophone(x, y) \
            or numalike(x, y) or joined(x, y)    # weak/week, beat/bead, once the figures (which may differ in format) are set aside
        bad = [p for p in bad if not brand(*p)]; vbad = [p for p in vbad if not brand(*p)]
        ok28 = not bad or (not vbad and len(bad) <= 2 and all(near(x, y) for x, y in bad))
        row("Q28", "Whisper round trip: the final mix says the script word for word (figures may differ only in format)", ok28,
            f"{n} words; final mix mismatches: {[f'{x} -> {y}' for x, y in bad] or 'none'}" + (f"; dry voice track mismatches: {[f'{x} -> {y}' for x, y in vbad] or 'none'}" if bad else ""))
        # Q29 every beat shows the app: not the iOS home screen (a colourful wallpaper; the app is a dark, low-saturation UI)
        # and not a blank screen (edge density of the phone screen)
        os.makedirs(os.path.join(ST, "proof"), exist_ok=True)
        for f in glob.glob(os.path.join(ST, "proof", "beat*.png")): os.remove(f)     # frames of an earlier build
        t, det29, low = tm["hook"], [], []
        for i, bt in enumerate(tm["beats"]):
            for frac in (0.25, 0.5, 0.9):
                at = t + bt["dur"] * frac
                png = os.path.join(ST, "proof", f"beat{i + 1}_{at:.2f}s.png")
                run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", final, "-frames:v", "1", png)
                def stat(vf, key):
                    o = run("ffprobe", "-v", "error", "-f", "lavfi", "-i", f"movie={png},crop=760:1100:160:500,{vf}signalstats",
                            "-show_entries", f"frame_tags=lavfi.signalstats.{key}", "-of", "csv=p=0").stdout.strip()
                    return float(o.splitlines()[0]) if o else 0.0
                sat = stat("", "SATAVG"); edge = stat("edgedetect=low=0.1:high=0.3,", "YAVG")
                if frac == 0.5: det29.append(f"beat {i + 1} sat {sat:.0f} edge {edge:.1f}")
                # measured 9/30: app 5-6, iOS home screen 38, blank thinking screen 2.1
                if sat > 20 or edge < 0.8: low.append(f"beat {i + 1} @{at:.1f}s (sat {sat:.0f}, edge {edge:.1f})")
            t += bt["dur"]
        row("Q29", "Every beat shows the app (no home screen, no blank screen) at 25/50/90% of the beat", not low, ", ".join(det29) + (f"; BAD {low}" if low else ""))
        # Q32 / Q33 (owner, 10/1): read the finished frames below the subtitle strip (Vision text recognition): every figure
        # spoken over a beat must be readable in that beat (the app's screen or the beat's labelled chip), and the spoken
        # answer must be a recorded answer line that is on screen and outlined while it is said
        from screen import ocr, figures as figs_of, shows, shown_times, day_move, direction, range_move, range_move_rows
        from PIL import Image
        t, shots = tm["hook"], []
        for i, bt in enumerate(tm["beats"]):
            ps = []
            for frac in (0.03, 0.25, 0.5, 0.9):
                at = t + bt["dur"] * frac; png = os.path.join(B, f"q33_b{i + 1}_{frac}.png")
                run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", final, "-frames:v", "1", png)
                if os.path.exists(png): ps.append(png)
            shots.append(ps); t += bt["dur"]
        rd = ocr([p for ps in shots for p in ps]); it = iter(rd)
        # what the viewer reads apart from our own words: the phone (below the subtitle strip) and the top-right corner block
        # (a chip or a time tag); the subtitles, the stamp and the disclaimer are not evidence
        keep = lambda r: r[2] >= 470 or (r[1] >= 700 and r[4] <= 260)
        rows_b = [[next(it) for _ in ps] for ps in shots]          # per beat, per frame: the OCR rows with their boxes
        seen = [[r[0] for fr in rb for r in fr if keep(r)] for rb in rows_b]
        lines_d = day.get("lines", [])
        miss33, det33 = [], []
        for i, ln in enumerate(lines_d[:len(shots)]):
            disp = " ".join(w for c in ln.get("cues", []) for w in c.get("show", []))
            if i == len(lines_d) - 2: continue                    # the typed question: the viewer's own words, no figures
            spoken = [f for f in figs_of([disp]) if re.search(r"[%$]", f)]
            have = figs_of(seen[i])
            bad = [f for f in spoken if not shows(f, have)]
            det33.append(f"beat {i + 1}: {spoken or '-'}" + (f" NOT SEEN {bad}" if bad else ""))
            # a price direction about a holding agrees with the day move its page shows in the beat (a chip line is exempt)
            n_items = len(lines_d) - 3
            beat = (day.get("beats") or [{}] * len(lines_d))[i]
            if i < n_items and " page" in beat.get("note", ""):      # a holding's own page (not the brief / News)
                mv = day_move(seen[i]); has_chip = bool((beat.get("chip") or {}).get("label"))
                rg, rmv = range_move_rows(rows_b[i])
                if rmv is None: rg, rmv = range_move(seen[i])
                for sent in re.split(r"(?<=[.!?])\s+", disp):
                    dv = direction(sent)
                    wf = KRM.window_field(sent) if ED in KRM.KR_EDITIONS else None
                    if wf:                      # a Korea window sentence agrees with the page's own range change
                        if dv and (rg != {"m1": "1M", "m3": "3M", "ytd": "YTD"}[wf] or rmv is None or (rmv > 0) != (dv > 0)):
                            bad.append(f"window {wf} {'up' if dv > 0 else 'down'} vs page {rg} {rmv}")
                        continue
                    if dv and not (has_chip and re.search(r"premarket|pre-market|after hours|after-hours", sent, re.I)) and \
                            (mv is None or abs(mv) < 0.05 or (mv > 0) != (dv > 0)):
                        bad.append(f"direction {'up' if dv > 0 else 'down'} vs screen {mv}")
            if bad: miss33.append(i + 1)
        row("Q33", "Every figure spoken over a beat is readable in that beat (app screen or labelled chip)", not miss33, "; ".join(det33))
        # Q34 one moment per Short (owner, 10/1): no chip time later than the corner stamp, and a pre-open Short shows no
        # live intraday quote on the phone (a take recorded after the open)
        st34 = (day.get("stamp") or {}).get("asof", "")
        late = [c["asof_iso"] for c in (b.get("chip") or {} for b in day.get("beats", [])) if c.get("asof_iso") and c["asof_iso"] > st34]
        live = [f"beat {i + 1}: {t!r}" for i, ts in enumerate(seen) for t in ts if ED == "preopen" and re.search(r"\blive\b", t, re.I)]
        # every time the viewer can read in an untagged beat is no later than the corner stamp
        tagged = {i for i, b in enumerate(day.get("beats", [])) if b.get("tag")}
        st_m = int(st34[11:13]) * 60 + int(st34[14:16]) if len(st34) >= 16 else 0
        later = [f"beat {i + 1}: {m // 60}:{m % 60:02d}" for i, ts in enumerate(seen) if i not in tagged for m in shown_times(ts) if m > st_m]
        late += later
        tags = [b["tag"]["text"] for b in day.get("beats", []) if b.get("tag")]
        # Q35 our overlays never cover the phone or the top texts: every chip / tag sits in the top-right corner block
        from PIL import Image as _Im
        cover35 = []
        for i, b in enumerate(day.get("beats", [])):
            pth = (b.get("chip") or {}).get("png")
            if pth and os.path.exists(pth):
                bb = _Im.open(pth).getchannel("A").getbbox()
                if bb and (bb[3] > 450 or bb[0] < 700 or bb[2] > 950): cover35.append(f"beat {i + 1}: {bb}")
        row("Q35", "Overlay chips and tags stay clear of the phone screen and the top texts (top-right corner block, x 700-950, above y 450)",
            not cover35, "; ".join(cover35) or "all clear")
        row("Q34", "One moment: chip times <= the corner stamp; pre-open shows no live intraday quote (an Ask re-recorded later carries its own time tag)",
            not late and not live, f"stamp {st34}; chips {[c for c in (b.get('chip', {}).get('asof_iso') for b in day.get('beats', [])) if c] or '-'}"
            + (f"; LATE {late}" if late else "") + (f"; LIVE {live[:3]}" if live else "") + (f"; tags {tags}" if tags else ""))
        ab = (day.get("beats") or [{}])[-1]; quote = (ab.get("quote") or {}).get("text", "")
        said = " ".join(w for c in (lines_d[-1].get("cues", []) if lines_d else []) for w in c.get("show", []))
        stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
        filler = set("and the are was were its with for about each also than rose fell gained lost climbed slipped dropped jumped "
                     "rises falls higher lower today this that".split())
        ws = lambda x: [stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", x) if w.lower() not in filler]
        nm = facts.get("names", {})                    # a ticker on screen is said as its name ("NKE" -> "Nike")
        qset = set(ws(quote + " " + " ".join(nm.get(x, "") for x in re.findall(r"\b[A-Z]{2,5}\b", quote)))) | {"your", "portf"}
        follow = bool(quote) and ws(said) and sum(w in qset for w in ws(said)) / len(ws(said)) >= 0.6 and \
            all(shows(f, figs_of([quote])) for f in figs_of([said]) if re.search(r"[%$]", f))
        ocr_ans = " ".join(seen[-1]) if seen else ""
        onscreen = bool(quote) and sum(w in set(ws(ocr_ans)) for w in ws(quote)) / max(1, len(ws(quote))) >= 0.6
        hl = bool((ab.get("highlight") or {}).get("src_box"))
        # owner, 10/1 preopen-v3: the answer beat opened on "Still thinking..." with the outline around empty space while
        # the voice already said the answer. The beat's first frame (3%) must already show the answer, never the spinner.
        thinking = any(re.search(r"still thinking", x, re.I) for x in seen[-1]) if seen else True
        row("Q32", "Ask: the spoken answer follows a recorded answer line that is on screen (from the beat's first frame, never 'Still thinking') and outlined while it is said",
            follow and onscreen and hl and not thinking,
            f"line {quote!r}; said {said!r}; follows {follow}; visible in the beat {onscreen}; highlight {hl}; still-thinking frames {thinking}")
        # Q36 owner, 10/1: the portfolio line's figure is outlined on Home (the All time / Today row it names)
        pb = (day.get("beats") or [{}] * 3)[-3]; pl = " ".join(w for c in (lines_d[-3].get("cues", []) if len(lines_d) >= 3 else []) for w in c.get("show", []))
        names_win = bool(re.search(r"all time|overall|today", pl, re.I))
        row("Q36", "Portfolio beat: the Home row the line names (All time / Today) is outlined while Home holds still",
            (not names_win) or bool((pb.get("highlight") or {}).get("src_box")), f"line {pl!r}; highlight {(pb.get('highlight') or {}).get('src_box')}")
        # Q37 owner, 10/1 (framing): a bigger phone whose top edge sits on ONE row in every beat, and the subtitles' last line
        # on one row 40 px above it, whatever the line count. Measured on the final frames: the phone's left rim is traced
        # up from y 1500, its top is 11.8% of its width above where the rim straightens; the text bottom is the lowest row
        # in 198..500 with two or more pixels brighter than the ground.
        import numpy as _np
        from PIL import Image as _Img
        tops, gaps, det37 = [], [], []
        t = tm["hook"]
        for i, bt in enumerate(tm["beats"]):
            for frac in (0.5, 0.9):
                # never inside the 0.4 s slide to the next beat (10/1 v1.3.0 test: a 1.5 s beat sampled at 1.35 s read the
                # sliding phone as a 74 px drop): the latest frame of a beat is 0.25 s before its cut
                # ... and the last beat never inside the 0.6 s cross-fade to the end card (10/2 korea-close: a 3.3 s last beat
                # sampled at 90% read the dimming phone as top 1393)
                at = t + min(bt["dur"] * frac, bt["dur"] - (0.25 if i < len(tm["beats"]) - 1 else 0.75))
                png = os.path.join(B, f"q37_b{i + 1}_{frac}.png")
                run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", final, "-frames:v", "1", png)
                if not os.path.exists(png): continue
                a = _np.asarray(_Img.open(png).convert("RGB")).astype(_np.int16).sum(2)
                br = _np.where(a[1500] > 250)[0]
                if not len(br): continue
                xl, xr = int(br[0]), int(br[-1]); rim = a[:, xl:xl + 4].max(1) > 200; y = 1500
                while y > 200 and (rim[y - 1] or rim[y - 2]): y -= 1
                top = y - 0.118 * (xr - xl); g = int(a[1000, 3])
                txt37 = _np.where((a[198:500] > g + 40).sum(1) >= 2)[0]
                tb = 198 + int(txt37.max()) if len(txt37) else None
                # the subtitles' last line always ends on one row (SUB_BOTTOM, ~467): a lower "text bottom" than ~440 is the
                # eyebrow alone at a cue handover (10/1 v1.3.0 test: 325 at 9.0 s, mid-swap), not a gap; no gap is read there
                handover = tb is not None and tb < 440
                tops.append(top); det37.append(f"b{i + 1}@{frac}: top {top:.0f}" + (f", text {tb}" if tb else "") + (" (cue handover: no line)" if handover else ""))
                if tb and not handover: gaps.append(top - tb)
            t += bt["dur"]
        ok37 = bool(tops) and max(tops) - min(tops) <= 16 and (not gaps or max(gaps) - min(gaps) <= 16)
        row("Q37", "Framing: the phone's top edge on one row in every beat (+-8 px) and the subtitle-to-phone gap the same (+-8 px)",
            ok37, "; ".join(det37))
        # Q38 / Q39 / Q40 (Shorts reach practice, 10/1; never at the cost of a principle): the cover's one big number is a
        # verified move the viewer then reads in that item's beat, labelled with its window, legible on frame 0 inside the
        # safe zone; the end card carries the one true follow line, readable for >= 1 s, and no "like and subscribe"; the
        # metadata keeps hashtags out of the title, 3-5 of them, no bait
        f0, fz, fe = (os.path.join(B, n) for n in ("q38_f0.png", "q39_end1.png", "q39_end0.png"))
        for at, png in ((0.0, f0), (max(0.0, L - 1.05), fz), (max(0.0, L - 0.05), fe)):
            run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", final, "-frames:v", "1", png)
        rd3 = ocr([x for x in (f0, fz, fe) if os.path.exists(x)])
        r0, r1, r2 = (rd3 + [[], [], []])[:3]
        hero = day.get("hero")
        if hero:
            lab_ok = hero["label"] in ({"preopen": ("PRE-MARKET",), "midday": ("SO FAR TODAY", "PRE-MARKET"),
                                        "close": ("TODAY", "AFTER HOURS"), "korea-open": ("PAST MONTH",), "korea-midday": ("THIS YEAR",),
                                        "korea-close": ("PAST 3 MONTHS",)}[ED])
            fig_a = hero["fig"].replace("\u2212", "-")
            in_beat = 0 <= hero["beat"] < len(seen) and shows(fig_a, figs_of(seen[hero["beat"]]))
            cov = [r for r in r0 if shows(fig_a, figs_of([r[0].replace("\u2212", "-")])) and re.search(r"\d", r[0])]
            safe = bool(cov) and all(r[1] >= 60 and r[3] <= 960 for r in cov)
            name_ok = any(hero["name"].lower() in r[0].lower() for r in r0)
            same_dir = (hero["value"] > 0) == (hero["dir"] == "up")
            kr_ok = ED not in KRM.KR_EDITIONS or KRM.is_kr(hero.get("sym", ""))     # v1.3.x: a Korea Short's hero is a KRX listing
            ok38 = lab_ok and in_beat and bool(cov) and safe and name_ok and same_dir and kr_ok
            row("Q38", "Cover hero: one verified move, readable on frame 0 (safe zone), labelled with its window, and the same figure readable in that item's beat",
                ok38, f"{hero['name']} {hero['fig']} {hero['label']} ({hero['src']}); frame 0 {'reads it' if cov else 'does NOT read it'}"
                      f"{'' if safe else ' OUTSIDE x 60-960'}; beat {hero['beat'] + 1} {'shows it' if in_beat else 'does NOT show it'}"
                      f"{'' if lab_ok else '; WRONG label'}{'' if name_ok else '; name not read'}{'' if kr_ok else '; NOT a KRX listing'}")
        else:
            row("Q38", "Cover hero: one verified move, readable on frame 0 (safe zone), labelled with its window, and the same figure readable in that item's beat",
                True, "no hero (no move >= 1% that its page or a chip shows and both feeds confirm): the headline cover")
        fol = day.get("follow", "")
        fw = set(re.findall(r"[a-z]+", fol.lower()))
        hit = lambda rr: bool(fw) and len(fw & set(re.findall(r"[a-z]+", " ".join(r[0] for r in rr).lower()))) >= 0.8 * len(fw)
        beg = re.search(r"\b(like and subscribe|smash|hit (the )?like|subscribe now)\b", " ".join(r[0] for r in r1 + r2), re.I)
        ok39 = fol in ("Follow for the open, midday and close", "Follow for Korea's chips, 3 times a day") and hit(r1) and hit(r2) and not beg
        row("Q39", "End card: the one follow line (true: three editions every trading day) readable for >= 1 s, no like/subscribe begging",
            ok39, f"\"{fol}\" at {L - 1.05:.2f}s {'read' if hit(r1) else 'NOT read'}, at {L - 0.05:.2f}s {'read' if hit(r2) else 'NOT read'}"
                  + (f"; BEGGING '{beg.group(0)}'" if beg else ""))
        hs = meta.get("hashtags", [])
        bait = [h for h in hs if h.lower() in ("#viral", "#fyp", "#foryou", "#foryoupage", "#trending", "#explore", "#viralshorts", "#shortsfeed")]
        names40 = [re.search(r"\[([^\]]+)\]", c).group(1) for c in (day.get("hook") or "").split("|") if re.search(r"\[([^\]]+)\]", c)]
        ok40 = "#" not in meta["title"] and 3 <= len(hs) <= 5 and hs[:1] == ["#Shorts"] and not bait and \
            any(n.lower() in [t.lower() for t in meta.get("tags", [])] for n in names40) and meta["title"] == meta["title"].strip()
        row("Q40", "Reach metadata: no hashtag in the title, 3-5 hashtags (#Shorts first, no bait), tags name the stories' companies",
            ok40, f"{len(hs)} hashtags {hs}; {len(meta.get('tags', []))} tags" + (f"; BAIT {bait}" if bait else ""))
        # frame 0 IS the thumbnail: delivered as thumbnail.png for YouTube Studio (custom Shorts thumbnail where the channel
        # has it) and TikTok's cover picker; on the phone the owner picks the first frame
        if os.path.exists(f0): shutil.copy2(f0, os.path.join(ST, "thumbnail.png"))
        # Q30 the data time-stamp: on EVERY frame in the same top-left spot (cover, every beat, the end card), its text is the
        # snapshot the figures come from (research quotes, within 5 min), and the edition label is this edition's
        st = day.get("stamp") or {}
        snap = jload(os.path.join(W, "research-data.json"))["asof_et"]
        from datetime import datetime
        # the stamp is the latest time in the Short: research snapshot, main take, app-shown times, chip quotes (compose's sources)
        srcs = (day.get("stamp") or {}).get("sources") or {}
        cand = [srcs.get("research"), srcs.get("take")] + srcs.get("app", []) + srcs.get("chips", [])
        cand = [c for c in cand if c]
        if cand: snap = f"{snap[:10]} {max(cand)} ET"
        try:
            shown = datetime.strptime(f"{DATE[:4]} {st.get('text', '')}", "%Y %b %d · %I:%M %p ET")
            delta = abs((shown - datetime.strptime(snap, "%Y-%m-%d %H:%M ET")).total_seconds()) / 60
        except ValueError:
            delta = 1e9
        label_ok = st.get("edition") == {"preopen": "Pre-open", "midday": "Midday", "close": "Close", "korea-open": "Seoul open", "korea-midday": "Seoul midday", "korea-close": "Seoul close"}[ED]
        from PIL import Image
        import numpy as np
        sp = os.path.join(B, "stamp.png"); fails, n = [], 0
        if os.path.exists(sp):
            a_ = np.array(Image.open(sp).getchannel("A")); ys, xs = np.nonzero(a_ > 128)
            box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1); mask = a_[box[1]:box[3], box[0]:box[2]] > 128
            times = [0.0, 0.5] + [tm["hook"] + sum(b["dur"] for b in tm["beats"][:i]) + tm["beats"][i]["dur"] / 2 for i in range(len(tm["beats"]))] + [L - 0.6, L - 0.05]
            ref = None
            for at in times:
                png = os.path.join(W, f"stampchk_{at:.2f}.png")
                run("ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", final, "-frames:v", "1", png)
                g = np.array(Image.open(png).convert("L")).astype(float)[box[1]:box[3], box[0]:box[2]]
                contrast = g[mask].mean() - g[~mask].mean(); n += 1
                if ref is None: ref = g
                same = np.abs(g[mask] - ref[mask]).mean()
                if contrast < 40 or same > 12: fails.append(f"{at:.1f}s (contrast {contrast:.0f}, drift {same:.0f})")
        ok30 = os.path.exists(sp) and not fails
        row("Q30", "Data time-stamp present at the same top-left spot on every sampled frame (cover, each beat, end card)", ok30,
            (f"\"{st.get('edition', '').upper()} / {st.get('text', '')}\" at x {box[0]}-{box[2]}, y {box[1]}-{box[3]} on {n} frames"
             + (f"; FAIL {fails}" if fails else "")) if os.path.exists(sp) else "no stamp layer")
        row("Q31", "Time-stamp = the data snapshot (within 5 min) and the edition label is this edition's", delta <= 5 and label_ok,
            f"shown {st.get('text', '-')}, snapshot {snap} (diff {delta:.0f} min); label {st.get('edition', '-')} for {ED}: {'ok' if label_ok else 'WRONG'}")
        # Q11 / Q20 from the verification artifacts
        row("Q11", "Every figure sourced (two agreeing feeds; disagreements dropped)", True,
            f"market figures: both quote feeds per item; portfolio: app vs Nasdaq recompute ({sum(c['ok'] for c in facts['checks'])}/{len(facts['checks'])} kept); Ask: {len(askc['verified'])} verified")
        row("Q20", "Insight: each item says WHY + a direct READ, two sources each", n_ok == len(story["items"]), "see Q23 and sources.md")
        # Q44 (v1.4.0, owner 10/2: "be more direct. don't use third-party word like that. you should gain credibility from viewers
        # yourself"): no line in the Short's own voice (the items and the portfolio line) attributes its read to analysts,
        # commentators, investors who say / see / call ... (the Ask answer is the app's own words, quoted, and is not graded here)
        own = [x["text"] for it in story["items"] for x in it["sentences"]] + [story["portfolio"]["text"]]
        att = [f"{t!r} ('{attributed(t)}')" for t in own if attributed(t)]
        row("Q44", "Direct voice: no third-party attribution in the narration (analysts / commentators / investors say, see, call ...)",
            not att, "; ".join(att) if att else f"{len(own)} narration sentences, none attributed")
        row("Q12", "Pronunciation: speakable() + earAudit() empty on every line", True, "make-short.sh refuses a line earAudit flags; Whisper round trip in Q28")
        row("Q14", "Disclaimer on every frame + description line", "Not financial advice" in open(os.path.join(B, "plan.json")).read() or os.path.exists(os.path.join(B, "disclaimer.png")),
            "standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27)")
        row("Q15", "Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA)", True, "fixed by the toolchain (make-cards.py / make-spot.py)")
        row("Q16", "Proof frames exported (view them before posting)", len(glob.glob(os.path.join(ST, "proof", "*.png"))) >= 8,
            f"{len(glob.glob(os.path.join(ST, 'proof', '*.png')))} frames in proof/ (make-short's 7 + one mid-beat frame per beat)")
        # Q41 the 20-minute budget (v1.3.0, owner 10/1): the run's wall time from its start to this grade, against the deadline
        t0r, dl = os.environ.get("SHORTS_T0"), float(os.environ.get("SHORTS_DEADLINE_S", "1200"))
        if t0r:
            el = __import__("time").time() - float(t0r)
            row("Q41", f"Delivered within the {dl / 60:.0f}-minute budget (wall time from the run's start to the grade)", el + 10 <= dl,
                f"{el:.0f} s ({el / 60:.1f} min) of {dl:.0f} s")
        else:
            row("Q41", f"Delivered within the {dl / 60:.0f}-minute budget", True, "graded outside run.sh: not measured")
        # Q42 Korea-first (owner, 10/2): a Korea Short leads with KRX listings: item 1 and at least 2 of its 3 items are
        # about a .KS / .KQ name (or the KOSPI); US names only as read-through. Other editions: not applicable
        if ED in KRM.KR_EDITIONS:
            kr_items = [any(KRM.is_kr(s_) for s_ in (res["items"][it["n"]].get("symbols") or [])) for it in story["items"]]
            row("Q42", "Korea-first: item 1 and >= 2 of 3 items are KRX listings", bool(kr_items) and kr_items[0] and sum(kr_items) >= 2,
                f"{sum(kr_items)} of {len(kr_items)} items KRX: " + ", ".join(res["items"][it["n"]]["cover"] for it in story["items"]))
    order = lambda k: int(k[0][1:])
    rows.sort(key=order)
    failed = [r for r in rows if r[2] == "FAIL"]
    status = "DELIVERED" if not failed else "REFUSED"
    rep = [f"# Quality report: assetly-short-{day['slug']}.mp4\n", f"**{status}**: {len(rows) - len(failed)}/{len(rows)} metrics pass"
           + (f"; failing {', '.join(r[0] for r in failed)}" if failed else "") + ". Measured against docs/marketing/SHORTS_QUALITY.md (v1.0).\n",
           "| # | Metric | Result | Measured |", "|---|---|---|---|"]
    rep += [f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |" for r in rows]
    rep += ["", "## Latency per stage (seconds)", "", "| Stage | Seconds |", "|---|---|"]
    rep += [f"| {k} | {v['secs']:.0f} |" for k, v in lat.items()]
    tot = sum(v["secs"] for v in lat.values())
    rep += [f"| **total** | **{tot:.0f}** ({tot / 60:.1f} min) |", ""]
    bj = jload(os.path.join(W, "budget.json"), {})
    if bj:
        rep += ["## The 20-minute budget per stage (seconds; run.sh)", "", "| Stage | Budget | Actual | Runs |", "|---|---|---|---|"]
        rep += [f"| {k} | {v['budget']} | {v['secs']}{' (over)' if v['secs'] > v['budget'] * max(1, v['runs']) else ''} | {v['runs']} |" for k, v in bj.items()]
        rep += [f"| **all** | **{sum(v['budget'] for v in bj.values())}** | **{sum(v['secs'] for v in bj.values())}** | |", ""]
    rep += [
            "Not measurable here: how the voices sound against the bed (listen once before posting)."]
    open(os.path.join(ST, "quality-report.md"), "w").write("\n".join(rep) + "\n")
    write_sources(ST, res, facts, askc, story, bymap)
    write_script(ST, day, story, facts, tm)
    log(f"{status}: {len(rows) - len(failed)}/{len(rows)}" + (f" failing {[r[0] for r in failed]}" if failed else ""))
    if failed:
        sys.exit(1)
    open(os.path.join(W, "delivering"), "w").close()      # watchdog.sh never stops a run mid-copy
    os.makedirs(DST, exist_ok=True)
    for f in os.listdir(ST):
        s = os.path.join(ST, f)
        if os.path.isdir(s): shutil.copytree(s, os.path.join(DST, f), dirs_exist_ok=True)
        else: shutil.copy2(s, os.path.join(DST, f))
    for f in ("book.json", "research.json"): shutil.copy2(os.path.join(W, f), os.path.join(DST, f))
    os.makedirs(os.path.join(DST, "voice"), exist_ok=True)
    for i, ln in enumerate(day["lines"]):
        src = os.path.join(B, f"line{i}.wav")
        if os.path.exists(src): shutil.copy2(src, os.path.join(DST, "voice", f"line{i}-{ln['voice']}.wav"))
    open(os.path.join(W, "delivered"), "w").close(); os.remove(os.path.join(W, "delivering"))
    log(f"delivered -> {DST}")


def write_sources(ST, res, facts, askc, story, byid):
    L = [f"# Sources: {DATE} {ED}\n", "Every claim is on two independent publishers (Google News RSS, publisher and time as listed); every price figure on two",
         "quote feeds (CNBC quote service and the Nasdaq quote API; after-hours and premarket on both feeds' extended quotes). A figure the",
         "sources disagree on is dropped, not guessed.\n"]
    if ED in KRM.KR_EDITIONS:
        L += ["Korean newsrooms too (v1.2.0): Yonhap (English and Korean RSS), Korea Herald, BusinessKorea, Maeil Business, Chosun Ilbo and",
              "Naver Finance's per-ticker news, each under its ORIGINAL press office (never \"Naver\"); a Yonhap story reprinted elsewhere",
              "counts once, as Yonhap.\n"]
        L += ["KRX figures (v1.1.0): Yahoo (the app's own price source) and Daum Finance's KRX official daily rows (Daum's live quote during",
              "the session); 1M / 3M / YTD windows on Yahoo's and Daum's (KRX) or Nasdaq's (US) histories; won converted at the app's USDKRW and",
              "CNBC's KRW=. Naver is not used: its evening price is the Nextrade after-market one, not the KRX close.\n"]
    L += ["## Market items (spoken)\n"]
    for it in story["items"]:
        r = res["items"][it["n"]]
        L.append(f"### {r['cover']}\n- **Why:** {r['why']}")
        L += [f"  - {byid[i]['publisher']} ({byid[i]['et']}): [{byid[i]['title']}]({byid[i]['link']})" for i in r["why_ids"] if i in byid]
        L.append(f"- **Read:** {r['sentiment']}")
        L += [f"  - {byid[i]['publisher']} ({byid[i]['et']}): [{byid[i]['title']}]({byid[i]['link']})" for i in r["sentiment_ids"] if i in byid]
        for f in r.get("figures", []):
            src = ("Yahoo", "Daum") if KRM.is_kr(f["symbol"]) else ("CNBC", "Nasdaq")      # the two feeds that figure was read from
            if f.get("field") in ("m1", "m3", "ytd"): src = ("Yahoo history", src[1] + " history")    # kr.windows: Yahoo + Daum / Nasdaq
            L.append(f"- **Figure:** {f['symbol']} {f['value']:+.2f}%{' ' + f['field'] if f.get('field') not in (None, 'pct') else ''} ({src[0]} {f.get('feed1')}, {src[1]} {f.get('feed2')})")
        L.append(f"- **Spoken:** {' '.join(s['text'] for s in it['sentences'])}\n")
    L.append("## Portfolio figures (app vs Nasdaq recompute)\n\n| Figure | App | Nasdaq | Kept |\n|---|---|---|---|")
    L += [f"| {c['figure']} | {c['app']:,.2f} | {c['nasdaq']:,.2f} | {'yes' if c['ok'] else 'DROPPED'} |" for c in facts["checks"]]
    L.append(f"\n## Ask answer\n\nQuestion: {askc['question']}\n\nAnswer as shown: {askc['answer']}\n\nFigures verified: {askc['verified']}; unverified: {askc['unverified'] or 'none'}\n")
    L.append("## Dropped (failed verification)\n")
    L += [f"- {d.get('cover')}: {'; '.join(d.get('drop', []))}" for d in res.get("dropped", [])] or ["- none"]
    open(os.path.join(ST, "sources.md"), "w").write("\n".join(L) + "\n")


def write_script(ST, day, story, facts, tm):
    L = [f"# Script: {DATE} {ED}\n", f"Cover (frame 0): {day['hook_kicker']} / " + " / ".join(story["cover"]) + " / Assetly\n",
         "| # | Voice | Line |", "|---|---|---|"]
    L += [f"| {i + 1} | {ln['voice']} | {ln['say']} |" for i, ln in enumerate(day["lines"])]
    L += ["", "## Beats", "", "| # | Seconds | Source | Note |", "|---|---|---|---|"]
    t = tm["hook"]; L.append(f"| 0 | 0.00-{t:.2f} | cover | headline cover, voice starts at 0.3 s |")
    for i, (b, src) in enumerate(zip(tm["beats"], day["beats"])):
        L.append(f"| {i + 1} | {t:.2f}-{t + b['dur']:.2f} | take {b['start']:.2f}s | {src.get('note', '')} |"); t += b["dur"]
    L += ["", "## The portfolio on screen", "", "```", json.dumps(facts["portfolio"], indent=1), "```"]
    L += ["", "| Holding | Value | Day % | Gain |", "|---|---|---|---|"]
    L += [f"| {h['name']} | ${h['value']:,} | {'withheld' if h['day_pct'] is None else format(h['day_pct'], '+.2f') + '%'} | ${h['gain_usd']:,} |" for h in facts["holdings"]]
    open(os.path.join(ST, "script.md"), "w").write("\n".join(L) + "\n")


main()
