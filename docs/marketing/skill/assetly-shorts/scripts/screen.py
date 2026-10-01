#!/usr/bin/env python3
"""What the viewer can read on screen, and fresh extended-hours quotes for the chips.

    screen.py <edition> <work-dir>

Owner rule (10/1): every figure spoken during a beat must be visible during that beat, on the app's screen or on an
overlay chip the edit draws. This reads the take with the Mac's own text recognition (Vision, scripts/ocr.swift) over
each beat's window (the same starts compose.py uses) and writes <work>/screen.json:
    {"windows": {"pos_IBM": {"t": [s, e], "texts": [...], "figures": ["-5.51%", "$219.93", ...]}, "home": ..., "ask_a": ...}}
and, before the open / after the close, re-quotes the story names' extended-hours move on both feeds (CNBC + Nasdaq,
as research.py does) so a chip shows a quote taken minutes before the edit, not the research snapshot:
    <work>/ext.json {"IBM": {"label": "PRE-MARKET", "pct": 5.81, "feed2": 5.77, "asof": "8:47 AM ET", "age_min": 3}}
"""
import hashlib, json, os, re, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import jdump, jload, log

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = re.compile(r"[+\-−]?\$?\d[\d,]*(?:\.\d+)?(?:%|\s?(?:billion|million|trillion)\b|[BMT]\b)?")
MAG = {"billion": 1e9, "million": 1e6, "trillion": 1e12, "b": 1e9, "m": 1e6, "t": 1e12}


def ocr_bin():
    src = os.path.join(HERE, "ocr.swift"); h = hashlib.sha1(open(src, "rb").read()).hexdigest()[:10]
    out = f"/tmp/assetly-shorts/ocr-{h}"
    if not os.path.exists(out):
        os.makedirs("/tmp/assetly-shorts", exist_ok=True)
        subprocess.run(["swiftc", "-O", src, "-o", out + ".tmp"], check=True, capture_output=True); os.replace(out + ".tmp", out)
    return out


def ocr(pngs):
    """[[text, x0, y0, x1, y1, conf], ...] per image (image pixels, top-left origin)."""
    if not pngs: return []
    r = subprocess.run([ocr_bin()] + list(pngs), capture_output=True, text=True, timeout=300)
    return json.loads(r.stdout)


def frames(video, times, outdir, tag):
    os.makedirs(outdir, exist_ok=True); out = []
    for t in times:
        p = os.path.join(outdir, f"{tag}_{t:.2f}.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, t):.2f}", "-i", video, "-frames:v", "1", p], check=True)
        if os.path.exists(p): out.append(p)
    return out


def figures(texts):
    """The figures a viewer reads (a lone small integer such as a share count or a date is kept too: matching decides)."""
    return [m.group(0).replace("−", "-") for t in texts for m in FIG.finditer(t)]


def fval(f):
    """'+5.81%' -> (5.81, '%', 2); '$1,428' -> (1428.0, '$', 0); None if not a figure."""
    s = str(f).replace("−", "-").replace(",", "").replace("+", "").replace("-", "").strip()
    unit = "%" if s.endswith("%") else "$" if s.startswith("$") else ""
    m = re.match(r"^\$?(\d+(?:\.\d+)?)\s?(billion|million|trillion|[BMT])?%?$", s, re.I)
    if not m: return None
    v, mag = float(m.group(1)), MAG.get((m.group(2) or "").lower(), 1)
    d = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
    # a magnitude figure ("$3 billion" / "$3B") compares in whole units: $3.5 billion -> 3.5e9 at 1e8 precision
    return v * mag, unit, d - (len(str(int(mag))) - 1 if mag > 1 else 0)


def shows(spoken, shown):
    """A spoken figure is on screen when a shown figure of the same kind rounds to it ('28%' <- '+28.33%', '0.7%' <-
    '+0.67%', '$1,428' <- '+$1,428')."""
    a = fval(spoken)
    if not a: return True
    for s in shown:
        b = fval(s)
        if not b or (a[1] and b[1] and a[1] != b[1]) or (a[1] and not b[1] and a[1] != "%"): continue
        if a[1] != b[1] and not (a[1] == "%" and b[1] == ""): continue
        if round(b[0], a[2]) == round(a[0], a[2]) or abs(b[0] - a[0]) < 1e-9: return True
    return False


TIME = re.compile(r"\b(1[0-2]|[1-9]):([0-5]\d)\s?(AM|PM)\s?ET\b", re.I)
DAYMOVE = re.compile(r"([+\-\u2212])\s?(\d+(?:\.\d+)?)%\s*(?:today|since last close)", re.I)
UPW = r"\b(rise|rises|rose|rising|gain|gains|gained|jump\w*|climb\w*|rall\w*|advanc\w*|surg\w*|soar\w*|higher|lift\w*|up \d)"
DOWNW = r"\b(fall|falls|fell|falling|drop\w*|slid|slide\w*|sank|sink\w*|slip\w*|declin\w*|lower|tumbl\w*|down \d)"


def shown_times(texts):
    """App-shown clock times ('Written at 8:42 AM ET.') as minutes after midnight ET (the status bar's 9:41 has no ET)."""
    return sorted({(int(h) % 12 + (12 if ap.upper() == "PM" else 0)) * 60 + int(m) for t in texts for h, m, ap in TIME.findall(t)})


def day_move(texts):
    """The holding's day move the page shows ('-0.03% since last close', '+4.68% today'), or None."""
    for t in texts:
        m = DAYMOVE.search(t.replace("\u2212", "-"))
        if m: return float(m.group(2)) * (-1 if m.group(1) in "-\u2212" else 1)
    return None


RANGEHEAD = re.compile(r"\bPrice\s*[·•.\-]?\s*(1W|1M|3M|6M|YTD|1Y|2Y|5Y)\b")


def range_move(texts):
    """(range, move) the position page's chart header shows ("Price · 3M" then "-28.40%"), or (None, None). The header
    reads left to right, so the figure is the next % after the label in OCR order (same text or the one after)."""
    # Vision reads the chip's "M" as Cyrillic "М" now and then ("Price • 3М", 10/1 test): fold look-alikes first; the first
    # header OCR'd is often the loading one (no change yet), so every header occurrence is tried
    texts = [t.translate(str.maketrans("МТУОАВЕКРСХ", "MTYOABEKPCX")) for t in texts]
    for i, t in enumerate(texts):
        m = RANGEHEAD.search(t)
        if not m: continue
        for u in [t[m.end():]] + list(texts[i + 1:i + 3]):
            f = re.search(r"([+\-\u2212])\s?(\d+(?:\.\d+)?)%", u.replace("\u2212", "-"))
            if f: return m.group(1), float(f.group(2)) * (-1 if f.group(1) in "-\u2212" else 1)
    return None, None


def range_move_rows(frames_rows):
    """range_move from OCR rows with boxes ([[text, x0, y0, x1, y1, conf], ...] per frame): the % figure on the SAME line
    as the "Price · 3M" header (vertical centres within 0.6 of the label's height), right of it. Vision does not always
    list the header's change next to it (10/1 test: Samsung's "-12.24%" came out of order), the box does."""
    fold = str.maketrans("МТУОАВЕКРСХ", "MTYOABEKPCX")
    for rows in frames_rows:
        for r in rows:
            m = RANGEHEAD.search(r[0].translate(fold))
            if not m: continue
            cy, h = (r[2] + r[4]) / 2, max(1, r[4] - r[2])
            for q in rows:
                if q is r or q[1] <= r[3] or abs((q[2] + q[4]) / 2 - cy) > 0.6 * h: continue
                f = re.fullmatch(r"\s*([+\-\u2212])\s?(\d+(?:\.\d+)?)%\s*", q[0])
                if f: return m.group(1), float(f.group(2)) * (-1 if f.group(1) in "-\u2212" else 1)
    return None, None


def direction(text):
    """+1 / -1 when a sentence states a price direction, 0 when it does not."""
    text = re.sub(r"(?:n't|\bnot|\bnever)\s+(?:\w+\s+){0,2}?\w+(?:ing|ed)?\b", " ", text, flags=re.I)   # "isn't lifting" says no direction
    u, d = re.search(UPW, text, re.I), re.search(DOWNW, text, re.I)
    return 0 if bool(u) == bool(d) else (1 if u else -1)


def take_minutes(W):
    """The main take's end, minutes after midnight ET (latency.json record.take)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    t = (jload(os.path.join(W, "latency.json"), {}) or {}).get("record.take", {})
    if not t.get("start"): return None
    d = datetime.fromtimestamp(t["start"] + t.get("secs", 0), ZoneInfo("America/New_York"))
    return d.hour * 60 + d.minute


def windows(ed, mk, story_syms):
    """Beat windows in take60 seconds, matching compose.py's starts (a spoken line runs ~4-6 s)."""
    w = {}
    for s in story_syms:
        if f"pos_{s}_chart" in mk: w[f"pos_{s}"] = [mk[f"pos_{s}_chart"] + 0.5, mk[f"pos_{s}_chart"] + 6.0]
    if "home_top" in mk: w["home"] = [mk["home_top"] + 1.0, mk["home_top"] + 5.0]
    if "brief_open" in mk: w["brief"] = [mk["brief_open"] + 0.6, mk.get("brief_end", mk["brief_open"] + 8)]
    if "news" in mk: w["news"] = [mk["news"] + 0.2, mk.get("news_end", mk["news"] + 6)]
    if "ask_answer" in mk: w["ask_a"] = [mk["ask_answer"] + 0.3, mk.get("ask_end", mk["ask_answer"] + 7)]
    return w


def ask_take(W):
    """(take path, marks) of the Ask beats: a later Ask-only take when ask-take.json names one, else the main take."""
    at = jload(os.path.join(W, "ask-take.json"), {}) or {}
    return os.path.join(W, at.get("take", "take60.mp4")), at.get("marks")


def ext_quotes(ed, syms):
    """Fresh extended-hours moves on both feeds (pre-open: PRE_MKT; close: POST_MKT). Kept only when the feeds agree."""
    from lib import cnbc, nasdaq, nasdaq_pre, agree, now_et
    if ed in ("midday", "korea-open", "korea-close") or not syms: return {}   # KRX: no extended-hours chip (v1.1.0)
    kind, label = ("pre", "PRE-MARKET") if ed == "preopen" else ("post", "AFTER HOURS")
    cq, out = cnbc(list(syms)), {}
    for s in syms:
        c = cq.get(s) or {}
        if not c.get("ext_type") or ("POST" in c["ext_type"]) != (kind == "post") or c["ext_type"].endswith("_PREV"): continue
        n = nasdaq(s) or {}; x = nasdaq_pre(s, kind) or {}
        b = round(100 * (x["last"] / n["last"] - 1), 2) if x.get("last") and n.get("last") else x.get("pct")
        if agree(c.get("ext_pct"), b, 0.2):
            t = now_et()
            out[s] = {"label": label, "pct": c["ext_pct"], "feed2": b, "asof": t.strftime("%-I:%M %p ET"), "asof_ts": time.time()}
    return out


def main():
    ED, W = sys.argv[1], sys.argv[2]
    mk = jload(os.path.join(W, "marks.json"))["marks"]; res = jload(os.path.join(W, "research.json"))
    syms = list(dict.fromkeys(s for it in res["items"] for s in it.get("symbols", [])))
    take = os.path.join(W, "take60.mp4"); out = {"windows": {}}
    win = windows(ED, mk, syms)
    atk, amk = ask_take(W)
    if amk and "ask_answer" in amk: win["ask_a"] = [amk["ask_answer"] + 0.3, amk.get("ask_end", amk["ask_answer"] + 7)]
    shots = {k: frames(atk if k == "ask_a" else take, [a + (b - a) * f for f in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)], os.path.join(W, "screen"), k)
             for k, (a, b) in win.items()}
    flat = [p for v in shots.values() for p in v]; rows = ocr(flat); by = dict(zip(flat, rows))
    for k, (a, b) in win.items():
        texts = list(dict.fromkeys(r[0] for p in shots[k] for r in by.get(p, []) if r[5] >= 0.3))
        rg, rm = range_move_rows([[r for r in by.get(p, []) if r[5] >= 0.3] for p in shots[k]])
        if rm is None: rg, rm = range_move(texts)
        out["windows"][k] = {"t": [round(a, 2), round(b, 2)], "texts": texts, "figures": list(dict.fromkeys(figures(texts))),
                             "times": shown_times(texts), "day_move": day_move(texts), "range": rg, "range_move": rm}
    jdump(out, os.path.join(W, "screen.json"))
    log("screen: " + "; ".join(f"{k}: {v['figures'][:8]}" for k, v in out["windows"].items()))
    if os.environ.get("SHORTS_KEEP_EXT") == "1" and os.path.exists(os.path.join(W, "ext.json")):   # tests: a fixed quote set
        log("ext: kept the existing ext.json (SHORTS_KEEP_EXT=1)"); return
    try:
        ext = ext_quotes(ED, syms)
    except Exception as e:                               # noqa: BLE001  (no chip then; the line must use what the app shows)
        log(f"ext quotes failed: {str(e)[:120]}"); ext = {}
    jdump(ext, os.path.join(W, "ext.json"))
    if ext: log("ext: " + ", ".join(f"{s} {v['label']} {v['pct']:+.2f}% / {v['feed2']:+.2f}% @ {v['asof']}" for s, v in ext.items()))


if __name__ == "__main__":
    main()
