#!/usr/bin/env python3
"""Stage 7, the edit plan: turns story.json + the take's marks into the day.json that make-short.sh builds, plus the
viewer-facing metadata (checked by the QA scan before the build).

    compose.py <edition> <date> <work-dir> <out-dir>

Voices (owner, 10/1): every line in the app's own brief voice (the Minjae ElevenLabs clone), at 1.06x; each line's
"voice" field (items marin / cedar alternating, the question the other one) is the OpenRouter gpt-audio backup that
voice-lines.py uses only when ElevenLabs fails (SHORTS_VOICE=mixed restores that casting at 1.12x).
Beats: each item on its holding's position page (1D chart, then the scroll to the intelligence and the position), a macro item on the brief (then News), the portfolio line on Home (total value, Today, All time,
scrolling to the movers), the question on the Ask composer as it is typed, the answer on the real answer, held into
the end card. One camera language: the same 1.3x push on every beat, cuts on the 0.3 s music grid.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, jdump, jload, log, rest
import kr as KRM

UP = r"\b(rose|rises|climbed|jumped|gained|rallied|advanced|popped|higher|lifted|boosted)\b"
DOWN = r"\b(fell|falls|dropped|drops|slid|slides|sank|sinks|slipped|declined|tumbled|lower|dragged|selloff|sell-off)\b"


def card_conflicts(sym, row):
    """Intelligence bullets on the position page that contradict BOTH quote feeds (9/30: "capex fears dragged Micron after
    hours" while both feeds had it +0.37%). Such a page is not used as the beat: the item goes on the brief or News."""
    try:
        b = rest(W, f"insights?select=bullets&symbol=eq.{sym}&order=generated_at.desc&limit=1")
    except Exception:                                    # noqa: BLE001
        return []
    bl = b[0].get("bullets") if b else []
    if isinstance(bl, str):
        try: bl = json.loads(bl)
        except ValueError: bl = [bl]
    text = " ".join(map(str, bl or []))
    bad = []
    for sent in re.split(r"(?<=[.!?])\s+|\n|\u2022", text):
        ext = re.search(r"after[- ]hours|after the bell|extended trading|premarket|pre-market", sent, re.I)
        a, c = (row.get("ext1"), row.get("ext2")) if ext else (row.get("pct_feed1"), row.get("pct_feed2"))
        if a is None or c is None or not re.search(r"\b(shares?|stock|micron|traded|session)\b|" + re.escape(sym), sent, re.I):
            continue
        if re.search(DOWN, sent, re.I) and a > 0.25 and c > 0.25: bad.append(sent.strip())
        elif re.search(UP, sent, re.I) and a < -0.25 and c < -0.25: bad.append(sent.strip())
    return bad

ED, DATE, W, OUT = sys.argv[1:5]
LABEL = {"preopen": "BEFORE THE BELL", "midday": "MIDDAY", "close": "MARKET CLOSE", "korea-open": "SEOUL OPEN", "korea-midday": "SEOUL MIDDAY", "korea-close": "SEOUL CLOSE"}
KR = ED in KRM.KR_EDITIONS
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
FOCUS = {"pos": 640, "home": 620, "brief": 1000, "news": 1000, "ask_q": 1450, "ask_a": 900}
EXT_RE = {"PRE-MARKET": r"\b(premarket|pre-market)\b", "AFTER HOURS": r"\b(after hours|after-hours)\b"}


def corner_block(path, lines):
    """The Short's own overlay in the top-right corner, mirroring the data stamp top-left: right-aligned lines, clear of
    the phone (owner, 10/1: a tag over the status bar hid the clock) and inside the Shorts safe zone (x <= 950).
    lines: [(text, size, colour)]"""
    from PIL import Image, ImageDraw, ImageFont
    fonts = os.path.expanduser("~/Library/Fonts/assetly-brand")
    img = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    y = 104
    for text, size, col in lines:
        f = ImageFont.truetype(os.path.join(fonts, "SchibstedGrotesk[wght].ttf"), size); f.set_variation_by_axes([700])
        w = sum(d.textlength(ch, font=f) + 2 for ch in text) - 2; x = 950 - w
        for ch in text: d.text((x, y), ch, font=f, fill=col + (255,)); x += d.textlength(ch, font=f) + 2
        y += int(size * 1.25)
    img.save(path)


def chip_png(path, name, label, pct, asof):
    """The labelled extended-hours quote ('PRE-MARKET' / 'IBM +5.8%' / '8:47 AM ET') in the top-right corner block."""
    acc, ink, muted = (139, 152, 224), (233, 236, 241), (155, 163, 176)
    val = ("+" if pct >= 0 else "\u2212") + f"{abs(pct):.1f}%"
    corner_block(path, [(label, 24, acc), (f"{name} {val}", 34, (88, 196, 140) if pct >= 0 else (232, 106, 106)), (asof, 24, muted)])
    return {"label": label, "name": name, "value": val, "asof": asof, "text": f"{label} {name} {val} {asof}"}


def tokens(text):
    """Display tokens for the word-synced subtitle: a name and its number stay together ("Gemini\u00a04")."""
    t = re.sub(r"(\b[A-Z][a-z]+) (\d+\b)(?!%|\.\d)", "\\1\u00a0\\2", text.strip())
    return t.split()


def tag_png(path, text):
    """A time tag for a beat recorded at another moment ('ASK RECORDED' / '11:26 AM ET'), in the top-right corner block."""
    head, _, when = text.rpartition(" ") if False else (text.split(" ", 2)[0] + " " + text.split(" ", 2)[1], "", text.split(" ", 2)[2])
    corner_block(path, [(head, 24, (139, 152, 224)), (when, 24, (233, 236, 241))])
    return {"png": path, "text": text}


def facts_name(sym, text):
    """The chip's name: the name the line says (IBM, Rocket Lab), else the ticker's short name."""
    names = (jload(os.path.join(W, "facts.json"), {}) or {}).get("names", {})
    n = names.get(sym, sym)
    first = re.match(r"^(?:[A-Z][\w&'.-]*)(?: [A-Z][\w&'.-]*)?", re.sub(r"^(Before the bell|At the close|At midday|Premarket|Midday|Today|In Seoul),\s*", "", text))
    return first.group(0) if first and first.group(0).split()[0].lower() in n.lower() + " " + sym.lower() else re.sub(r",?\s+(Inc\.?|Corporation|Corp\.?)$", "", n)



def first_visible(take, t0, t1, pattern, step=0.1):
    """(time, box) of the first frame in [t0, t1] of the take where OCR reads `pattern` (regex) and no "Still thinking"
    is on screen; (None, None) if never. Owner, 10/1 preopen-v3: the Ask beat started on the UI test's ask_answer mark,
    but the recorded display still showed "Still thinking..." for 1.3 s, with the highlight box drawn around EMPTY space
    while the voice already said the answer. Beats and highlights now start from what the recording actually shows."""
    import shutil, tempfile
    from screen import frames as _frames, ocr as _ocr
    d = tempfile.mkdtemp(prefix="vis-", dir=W)
    try:
        ts = [round(t0 + k * step, 2) for k in range(int((t1 - t0) / step) + 1)]
        rows = _ocr(_frames(take, ts, d, "v"))
        for t, rs in zip(ts, rows):
            if any(re.search(r"still thinking", r[0], re.I) for r in rs): continue
            # a pattern, or a list of words: the row holding at least two of them (OCR reads "−4.0%" and bold tickers
            # unreliably, words are stable; 10/1 midday: an exact-prefix match never fired on a line that was on screen)
            if isinstance(pattern, list):
                hit = next((r for r in rs if sum(w.lower() in r[0].lower() for w in pattern) >= min(2, len(pattern))), None)
            else:
                hit = next((r for r in rs if re.search(pattern, r[0], re.I)), None)
            if hit: return t, hit[1:5]
        return None, None
    finally:
        shutil.rmtree(d, ignore_errors=True)

# owner, 10/1: every line in Minjae's ElevenLabs voice (voice-lines.py SHORTS_VOICE=minjae, the default; the line's
# "voice" stays the gpt-audio backup if ElevenLabs fails). The clone's raw read is ~2.4-2.65 words/s against gpt-audio's
# ~1.9-2.15 (10/1 midday takes), so the gpt-audio 1.12x would run it at ~2.7-3.0 w/s, rushed on figures; 1.06x keeps
# it near the old pace (~2.55-2.8 w/s). SHORTS_VOICE=mixed restores 1.12 for the gpt-audio items and the question.
T_GPT = 1.12 if os.environ.get("SHORTS_VOICE", "minjae") == "mixed" else 1.06
FOLLOW = "Follow for the open, midday and close"     # the end card's one CTA: true (three editions every trading day)
FOLLOW_KR = "Follow for Korea's chips, 3 times a day"   # v1.2.0: open, midday and close every KRX trading day; "three"
# spelled out ran to x 974 on the centred end card, past the 950 safe edge (10/2 korea-midday Q10): <= ~40 characters
if KR: FOLLOW = FOLLOW_KR
HERO_MIN = 1.0                                       # a smaller move is not a thumbnail hook: the headline cover stays
BAIT = {"#viral", "#fyp", "#foryou", "#foryoupage", "#trending", "#explore", "#viralshorts", "#shortsfeed"}


def cover_hero(story, res, beats, ext):
    """The cover's one big number (Shorts practice, 10/1: the thumbnail carries the biggest verified figure). Only a move
    the viewer then reads in that item's beat: a holding page's day move (midday / close; both quote feeds must agree with
    it, same sign, within max(0.5 pt, 5%)), or the beat's labelled extended-hours chip (two feeds already). Before the open
    the page shows the previous session, so only a chip qualifies. None when nothing reaches HERO_MIN."""
    scr = (jload(os.path.join(W, "screen.json"), {}) or {}).get("windows", {})
    best = None
    for i, it in enumerate(story["items"]):
        if i >= len(beats): break
        ref, b = res["items"][it["n"]], beats[i]
        m = re.match(r"^(\S+) page", b.get("note", ""))   # "000660.KS page" (v1.1.0)
        if not m: continue
        sym = m.group(1)
        ch = b.get("chip") or {}
        # Korea editions are Korea-first (owner, 10/2: the korea-midday thumbnail led with "Micron +284.5%"): the hero is
        # a KRX listing or nothing
        if KR and not KRM.is_kr(sym): continue
        if KR:
            # Korea editions: the page is filmed on the 1M / 3M chart, so the hero is that window's change as the page's own
            # header reads it, and both histories agree with it (research figure of the same field)
            sc = scr.get(f"pos_{sym}") or {}
            v, fld = sc.get("range_move"), KRM.RANGE_FIELD.get(sc.get("range") or "")
            fig = next((f for f in ref.get("figures", []) if f.get("symbol") == sym and f.get("field") == fld and f.get("ok")), None)
            if not fig or not KRM.window_close(v, fig["value"], ED): continue
            label, src = {"m1": "PAST MONTH", "m3": "PAST 3 MONTHS", "ytd": "THIS YEAR"}[fld], f"{sym} page {sc.get('range')} {v:+.2f}% vs histories {fig['feed1']:+.2f}/{fig['feed2']:+.2f}"
        elif ch.get("label") and sym in ext:
            v, label, src = float(ext[sym]["pct"]), ch["label"], f"{ch['label'].lower()} chip ({sym}, two feeds)"
        elif ED != "preopen":
            v = (scr.get(f"pos_{sym}") or {}).get("day_move")
            fig = next((f for f in ref.get("figures", []) if f.get("symbol") == sym and f.get("field") == "pct" and f.get("ok")), None)
            if v is None or not fig or (v > 0) != (fig["value"] > 0) or abs(v - fig["value"]) > max(0.5, 0.05 * abs(v)): continue
            label, src = ("SO FAR TODAY" if ED == "midday" else "TODAY"), f"{sym} page {v:+.2f}% vs feeds {fig['feed1']:+.2f}/{fig['feed2']:+.2f}"
        else:
            continue
        if abs(v) < HERO_MIN or (best and abs(v) <= abs(best["value"])): continue
        cov = story["cover"][i] if i < len(story.get("cover", [])) else ""
        nm = re.search(r"\[([^\]]+)\]", cov)
        best = {"sym": sym, "beat": i, "value": round(v, 2), "fig": ("+" if v > 0 else "\u2212") + f"{abs(v):.1f}%", "label": label,
                "dir": "up" if v > 0 else "down", "name": nm.group(1) if nm else facts_name(sym, cov), "src": src}
    return best


def reach_hashtags(tags):
    """3-5 hashtags in the description: #Shorts, the stories' companies, one niche tag; never bait (#viral, #fyp)."""
    seen, out = set(), ["#Shorts"]
    for t in tags:
        t = "#" + re.sub(r"[^\w]", "", t.lstrip("#"))
        if len(t) > 1 and t.lower() not in BAIT and t.lower() not in seen and t.lower() != "#shorts": seen.add(t.lower()); out.append(t)
    niche = [t for t in out[1:] if t.lower() in ("#stockmarket", "#stocks", "#investing", "#stockmarketnews")]
    firms = [t for t in out[1:] if t not in niche]
    out = ["#Shorts"] + firms[:3] + (niche[:1] or ["#stockmarket"])
    return out + [t for t in ("#stocks", "#investing") if t not in out][:max(0, 3 - len(out))]   # a macro day still gets 3


def reach_tags(story, res, hashtags):
    """YouTube's hidden tags: what the post is (its companies, '<name> stock'), the niche, the brand; no bait."""
    names = [re.search(r"\[([^\]]+)\]", c).group(1) for c in story.get("cover", []) if re.search(r"\[([^\]]+)\]", c)]
    post = [x for n in names for x in (n, f"{n} stock")]
    niche = (["Korea stocks", "AI chip stocks", "HBM", "semiconductor stocks", "KOSPI"] if KR else
             ["stock market today", "stock market news", "AI stocks", "investing", "stocks"])
    out = []
    for t in post + niche + [h.lstrip("#") for h in hashtags if h.lower() != "#shorts"] + ["Assetly", "Shorts"]:
        if t.lower() not in {o.lower() for o in out} and "#" + t.lower() not in BAIT: out.append(t)
    return out[:20]


def main():
    story = jload(os.path.join(W, "story.json")); res = jload(os.path.join(W, "research.json")); mk = jload(os.path.join(W, "marks.json"))["marks"]
    askc = jload(os.path.join(W, "ask-check.json")); acct = jload(os.path.join(W, "account.json"))
    ext = jload(os.path.join(W, "ext.json"), {}) or {}
    # the Ask beats may come from a later take of the same account (a rebuild that re-records only Ask): ask-take.json
    # {"take": "takeask.mp4", "marks": {...}, "recorded_at": "2026-10-01 11:05"} (ET)
    at = jload(os.path.join(W, "ask-take.json"), {}) or {}
    amk, atake = (at.get("marks") or mk), at.get("take", "take60.mp4")
    vis = [r for r in (jload(os.path.join(W, "ask.json"), {}) or {}).get("answer_rects", []) if r.get("visible") and re.search(r"[A-Za-z0-9]", r["text"])]
    held = {b["symbol"] for b in acct.get("book", [])}
    with Stage(W, "compose"):
        lines, beats, cue = [], [], 0
        gpt = ["marin", "cedar"]
        macro_src = ["brief", "news"]
        items = story["items"]
        for i, it in enumerate(items):
            ref = res["items"][it["n"]]
            s1, s2 = it["sentences"]
            lines.append({"voice": gpt[i % 2], "say": f"{s1['text']} {s2['text']}", "tempo": T_GPT,
                          "cues": [{"eyebrow": s1["eyebrow"].upper(), "show": tokens(s1["text"])},
                                   {"eyebrow": s2["eyebrow"].upper(), "show": tokens(s2["text"])}]})
            sym = next((s for s in ref.get("symbols", []) if s in held and f"pos_{s}_chart" in mk), None)
            rows = {r["symbol"]: r for r in jload(os.path.join(W, "research-data.json"))["candidates"]}
            if sym and sym in rows:
                cc = card_conflicts(sym, rows[sym])
                if cc:
                    log(f"{sym}: its intelligence card contradicts both feeds ({cc[0][:90]}...): the item goes on the brief/News instead")
                    sym = None
            if sym:
                b = {"take": "take60.mp4", "start": round(mk[f"pos_{sym}_chart"] + 0.5, 2), "focus_src": FOCUS["pos"], "note": f"{sym} page, chart then scroll"}
            else:
                src = macro_src.pop(0) if macro_src else "news"
                b = {"take": "take60.mp4", "start": round(mk["brief_open"] + 0.6 if src == "brief" else mk["news"] + 0.2, 2),
                     "focus_src": FOCUS[src], "note": f"{src} scrolling ({ref['cover']})"}
            # an extended-hours move in the line is shown on the Short's own labelled chip for the whole beat (owner, 10/1:
            # the app shows only regular-session moves, so voice and screen must never disagree)
            xs = next((x for x in ref.get("symbols", []) if x in ext), None)
            if xs and re.search(EXT_RE[ext[xs]["label"]], s1["text"] + " " + s2["text"], re.I):
                shown_t = ext[xs]["asof"]
                if ext[xs].get("asof_ts"):                 # the chip prints the quote's own time (the same value the stamp uses)
                    from datetime import datetime as _dt
                    from zoneinfo import ZoneInfo
                    shown_t = _dt.fromtimestamp(ext[xs]["asof_ts"], ZoneInfo("America/New_York")).strftime("%-I:%M %p ET")
                b["chip"] = chip_png(os.path.join(OUT, f"chip{i + 1}.png"), facts_name(xs, s1["text"]), ext[xs]["label"], ext[xs]["pct"], shown_t)
                b["chip"]["png"] = os.path.join(OUT, f"chip{i + 1}.png")
                if ext[xs].get("asof_ts"):
                    from datetime import datetime as _dt
                    from zoneinfo import ZoneInfo
                    b["chip"]["asof_iso"] = _dt.fromtimestamp(ext[xs]["asof_ts"], ZoneInfo("America/New_York")).strftime("%Y-%m-%d %H:%M")
            cue += 2; b["to_cue"] = cue; beats.append(b)
        # the portfolio, on Home
        p = story["portfolio"]
        lines.append({"voice": "minjae", "say": p["text"], "tempo": 1.06, "cues": [{"eyebrow": "YOUR PORTFOLIO", "show": tokens(p["text"])}]})
        cue += 1
        hb = {"take": "take60.mp4", "start": round(mk["home_top"] + 1.0, 2), "focus_src": FOCUS["home"], "to_cue": cue,
              "note": "Home: total value, Today, All time, scrolling to the movers"}
        # owner, 10/1: outline the Home figure the portfolio line speaks ("up 28% all time" -> the All time row), the same
        # accent box as the Ask answer, on only while Home holds still (it goes off before the scroll to the movers)
        win = "All time" if re.search(r"all time|overall|since", p["text"], re.I) else "Today" if re.search(r"today", p["text"], re.I) else None
        if win:
            hold = mk.get("home_scroll", hb["start"] + 2.0)
            t_h, box = first_visible(os.path.join(W, "take60.mp4"), hb["start"], max(hb["start"], hold - 0.2), rf"^{win}\b.*\d")
            if box:
                hb.update(highlight={"src_box": box, "pad": 8, "until": round(max(0.6, hold - hb["start"] - 0.15), 2)},
                          note=hb["note"] + f"; {win} row highlighted")
            else:
                log(f"compose: the Home '{win}' row was not readable in the take: no highlight on the portfolio beat")
        beats.append(hb)
        # Ask: the question typed on camera, then the real answer
        q = askc["question"]
        lines.append({"voice": gpt[len(items) % 2], "say": q, "tempo": T_GPT, "cues": [{"eyebrow": "ASK ASSETLY", "show": tokens(q)}]})
        cue += 1
        qb = {"take": atake, "start": round(amk["ask_typing"] - 0.3, 2), "focus_src": FOCUS["ask_q"], "to_cue": cue,
              "note": "Ask: the question typed"}
        beats.append(qb)
        a = story["ask"]["answer_text"]
        lines.append({"voice": "minjae", "say": a, "tempo": 1.06, "cues": [{"eyebrow": "THE ANSWER", "show": tokens(a)}]})
        ab = {"take": atake, "start": round(amk["ask_answer"] + 0.3, 2), "focus_src": FOCUS["ask_a"], "tail": 1.0,
              "note": "Ask: the real answer, held into the card"}
        k = story["ask"].get("line")
        if isinstance(k, int) and 0 <= k < len(vis):
            # the beat (and so its highlight) starts only once the quoted line is ON SCREEN in the recording
            key = [w for w in re.findall(r"[A-Za-z]{3,}", vis[k]["text"])][:4]
            t_v, _ = first_visible(os.path.join(W, atake), amk["ask_answer"], amk["ask_answer"] + 15, key)
            if t_v is None:
                raise SystemExit("REFUSE: the quoted Ask answer line never shows on screen in the recording")
            if t_v + 0.1 > ab["start"]:
                log(f"compose: the answer shows at {t_v:.2f}s, {t_v - amk['ask_answer']:.2f}s after the ask_answer mark: the beat starts there")
                ab["start"] = round(t_v + 0.1, 2)
        if isinstance(k, int) and 0 <= k < len(vis):
            # the quoted line, outlined on screen as the voice says it; the push goes to it
            x0, y0, x1, y1 = vis[k]["box"]
            ab.update(highlight={"src_box": [x0, y0, x1, y1], "pad": 6}, focus_src=round((y0 + y1) / 2),
                      quote={"line": k, "text": vis[k]["text"]}, note=f"Ask: the real answer, line {k} highlighted")
        beats.append(ab)
        # an Ask recorded at another moment than the rest says so on screen (one honest moment per shot)
        if at.get("recorded_at"):
            from datetime import datetime as _dt
            t = _dt.strptime(at["recorded_at"], "%Y-%m-%d %H:%M")
            tg = tag_png(os.path.join(OUT, "ask-tag.png"), f"ASK RECORDED {t.strftime('%-I:%M %p')} ET")
            for b in (qb, ab): b["chip"] = dict(tg); b["tag"] = {"text": tg["text"]}
        # the data time-stamp: when the quotes behind every figure were captured (research.data), not the render time
        from datetime import datetime
        snap = datetime.strptime(jload(os.path.join(W, "research-data.json"))["asof_et"], "%Y-%m-%d %H:%M ET")
        # the corner stamp is the LATEST time anywhere in the Short (owner, 10/1): the research snapshot, the main take's end,
        # any time the app shows in a story beat ("Written at 8:42 AM ET"), any chip quote. A beat with its own time tag (an
        # Ask re-recorded later) is labelled separately and does not move it.
        from screen import take_minutes
        day0 = snap.replace(hour=0, minute=0)
        src = {"research": snap.strftime("%H:%M")}
        tk = take_minutes(W)
        if tk is not None: src["take"] = f"{tk // 60:02d}:{tk % 60:02d}"
        scr = (jload(os.path.join(W, "screen.json"), {}) or {}).get("windows", {})
        app_t = sorted({m for k, v in scr.items() if k != "ask_a" for m in v.get("times", [])})
        if app_t: src["app"] = [f"{m // 60:02d}:{m % 60:02d}" for m in app_t]
        chips_t = [datetime.strptime(b["chip"]["asof_iso"], "%Y-%m-%d %H:%M") for b in beats if (b.get("chip") or {}).get("asof_iso")]
        if chips_t: src["chips"] = [c.strftime("%H:%M") for c in chips_t]
        mins = [snap.hour * 60 + snap.minute] + ([tk] if tk is not None else []) + app_t + [c.hour * 60 + c.minute for c in chips_t]
        from datetime import timedelta
        snap = day0 + timedelta(minutes=max(mins))
        hm = snap.strftime("%-I:%M %p")
        stamp = {"edition": {"preopen": "Pre-open", "midday": "Midday", "close": "Close", "korea-open": "Seoul open", "korea-midday": "Seoul midday", "korea-close": "Seoul close"}[ED],
                 "text": f"{snap.strftime('%b %-d')} · {hm} ET", "asof": snap.strftime("%Y-%m-%d %H:%M"),
                 "line": f"Data as of {snap.strftime('%b %-d, %Y')} {hm} ET", "sources": src}
        hero = cover_hero(story, res, beats, ext)
        y, m, d = DATE.split("-")
        day = {"date": DATE, "slug": f"{DATE}-{ED}", "demo": 0, "edition": ED,
               "hook": "|".join(story["cover"]), "hook_kicker": f"{LABEL[ED]} · {MON[int(m) - 1]} {int(d)}", "hook_foot": "Assetly",
               "hook_dur": 1.5, "follow": FOLLOW, "stamp": stamp, "script": " ".join(ln["say"] for ln in lines), "grid": 0.3, "card": 1.8, "len_range": [20, 30],
               "motion": {"to": 1.15, "in": 0.7, "out": 0.6}, "lines": lines, "beats": beats}
        if hero:
            day["hook_hero"] = "|".join([hero["name"], hero["fig"], hero["label"], hero["dir"]]); day["hero"] = hero
            log(f"cover hero: {hero['name']} {hero['fig']} {hero['label']} ({hero['src']})")
        else:
            log("cover hero: none (no move >= 1% that the page or a chip shows and both feeds confirm): the headline cover")
        os.makedirs(OUT, exist_ok=True)
        jdump(day, os.path.join(OUT, "day.json"))
        tags = " ".join(reach_hashtags(story.get("hashtags", [])))
        desc = (stamp["line"] + "\n" + story["description"].strip() + "\nPortfolio shown is illustrative. Not financial advice.\n\n"
                "Assetly on the App Store: https://apps.apple.com/app/id6811739789\nMore: https://hodlerss.github.io/assetly/about.html")
        # owner, 10/1 pm: the title is the hook only, no edition label and no date (the description carries "Data as of")
        story["title"] = re.sub(r"^\s*(before the bell|pre-?open|midday|after the bell|at the close|close|seoul open|seoul close)\s*[:|·-]\s*", "", story["title"], flags=re.I)
        story["title"] = re.sub(r"\s*[|·-]?\s*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(, \d{4})?\s*$", "", story["title"]).strip(" |·-")
        story["title"] = re.sub(r"\s*#\w+", "", story["title"]).strip()      # hashtags never in the title (they go in the description)
        meta = {"title": story["title"], "description": desc, "hashtags": tags.split(), "data_as_of_et": stamp["asof"],
                "tags": reach_tags(story, res, tags.split()), "thumbnail": "frame 0 (the headline cover" + (", hero figure)" if hero else ")"),
                "category": "News & Politics", "made_for_kids": False}
        jdump(meta, os.path.join(OUT, "youtube-metadata.json"))
        open(os.path.join(OUT, "youtube-metadata.md"), "w").write(f"# YouTube metadata\n\n**Title** ({len(meta['title'])} chars)\n{meta['title']}\n\n"
                                                                  f"**Description**\n{desc}\n\n**Hashtags**\n{tags}\n")
        log(f"day.json: {len(lines)} lines, {len(beats)} beats; cover {story['cover']}")


main()
