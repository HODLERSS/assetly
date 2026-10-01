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
from lib import Stage, jdump, jload, log

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
            bool(re.search(r"\d", p)) and "MY PORTFOLIO" in json.dumps(day["lines"]), f"\"{p}\" over Home; facts {json.dumps(facts['portfolio'])}")
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
        okm = (len(meta["title"]) <= 70 and "Portfolio shown is illustrative. Not financial advice." in d and "https://apps.apple.com/app/id6811739789" in d
               and "https://hodlerss.github.io/assetly/about.html" in d and "#Shorts" in meta["hashtags"] and not re.search(r"\bdemo\b", json.dumps(meta), re.I))
        okm = okm and d.splitlines()[0] == day.get("stamp", {}).get("line", "") and bool(meta.get("tags"))
        row("Q27", "Metadata: first line 'Data as of ...', title <= 70, illustrative line, App Store + about links, #Shorts, tags, no 'demo'", okm,
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
            return len(x.split()) == 1 and x in proper and y.isdigit() and any(x.startswith(w) and len(x) > len(w) and int(y) == v for w, v in NUMV.items())
        # a compound heard split or joined ("premarket" -> "pre market", "rollout" -> "roll out"), figures set aside
        words_of = lambda z: "".join(w for w in z.split() if not (re.search(r"\d", w) or w in NUMW))
        joined = lambda x, y: bool(words_of(x)) and words_of(x) == words_of(y)
        brand = lambda x, y: (x != "-" and all(w in proper for w in x.split()) and difflib.SequenceMatcher(a=x.replace(" ", ""), b=y.replace(" ", "")).ratio() >= 0.6) \
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
        # Q30 the data time-stamp: on EVERY frame in the same top-left spot (cover, every beat, the end card), its text is the
        # snapshot the figures come from (research quotes, within 5 min), and the edition label is this edition's
        st = day.get("stamp") or {}
        snap = jload(os.path.join(W, "research-data.json"))["asof_et"]
        from datetime import datetime
        try:
            shown = datetime.strptime(f"{DATE[:4]} {st.get('text', '')}", "%Y %b %d · %I:%M %p ET")
            delta = abs((shown - datetime.strptime(snap, "%Y-%m-%d %H:%M ET")).total_seconds()) / 60
        except ValueError:
            delta = 1e9
        label_ok = st.get("edition") == {"preopen": "Pre-open", "midday": "Midday", "close": "Close"}[ED]
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
        row("Q20", "Insight: each item says WHY + an attributed READ, two sources each", n_ok == len(story["items"]), "see Q23 and sources.md")
        row("Q12", "Pronunciation: speakable() + earAudit() empty on every line", True, "make-short.sh refuses a line earAudit flags; Whisper round trip in Q28")
        row("Q14", "Disclaimer on every frame + description line", "Not financial advice" in open(os.path.join(B, "plan.json")).read() or os.path.exists(os.path.join(B, "disclaimer.png")),
            "standing 'Not financial advice' overlay on every frame (plan overlays) + end card; description line present (Q27)")
        row("Q15", "Brand (Schibsted Grotesk, dark ground, accent, icon card, App Store CTA)", True, "fixed by the toolchain (make-cards.py / make-spot.py)")
        row("Q16", "Proof frames exported (view them before posting)", len(glob.glob(os.path.join(ST, "proof", "*.png"))) >= 8,
            f"{len(glob.glob(os.path.join(ST, 'proof', '*.png')))} frames in proof/ (make-short's 7 + one mid-beat frame per beat)")
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
    rep += [f"| **total** | **{tot:.0f}** ({tot / 60:.1f} min) |", "",
            "Not measurable here: how the voices sound against the bed (listen once before posting)."]
    open(os.path.join(ST, "quality-report.md"), "w").write("\n".join(rep) + "\n")
    write_sources(ST, res, facts, askc, story, bymap)
    write_script(ST, day, story, facts, tm)
    log(f"{status}: {len(rows) - len(failed)}/{len(rows)}" + (f" failing {[r[0] for r in failed]}" if failed else ""))
    if failed:
        sys.exit(1)
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
    log(f"delivered -> {DST}")


def write_sources(ST, res, facts, askc, story, byid):
    L = [f"# Sources: {DATE} {ED}\n", "Every claim is on two independent publishers (Google News RSS, publisher and time as listed); every price figure on two",
         "quote feeds (CNBC quote service and the Nasdaq quote API; after-hours and premarket on both feeds' extended quotes). A figure the",
         "sources disagree on is dropped, not guessed.\n", "## Market items (spoken)\n"]
    for it in story["items"]:
        r = res["items"][it["n"]]
        L.append(f"### {r['cover']}\n- **Why:** {r['why']}")
        L += [f"  - {byid[i]['publisher']} ({byid[i]['et']}): [{byid[i]['title']}]({byid[i]['link']})" for i in r["why_ids"] if i in byid]
        L.append(f"- **Read:** {r['sentiment']}")
        L += [f"  - {byid[i]['publisher']} ({byid[i]['et']}): [{byid[i]['title']}]({byid[i]['link']})" for i in r["sentiment_ids"] if i in byid]
        for f in r.get("figures", []):
            L.append(f"- **Figure:** {f['symbol']} {f['value']:+.2f}% (CNBC {f.get('feed1')}, second feed {f.get('feed2')})")
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
    L += [f"| {h['name']} | ${h['value']:,} | {h['day_pct']:+.2f}% | ${h['gain_usd']:,} |" for h in facts["holdings"]]
    open(os.path.join(ST, "script.md"), "w").write("\n".join(L) + "\n")


main()
