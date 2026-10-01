#!/usr/bin/env python3
"""Stage 7, the edit plan: turns story.json + the take's marks into the day.json that make-short.sh builds, plus the
viewer-facing metadata (checked by the QA scan before the build).

    compose.py <edition> <date> <work-dir> <out-dir>

Voices: market items alternate marin / cedar (OpenRouter gpt-audio); the portfolio line and the Ask answer are the
app's own brief voice (the Minjae ElevenLabs clone); the Ask question is read by the other gpt-audio voice while it is
typed on screen. Beats: each item on its holding's position page (1D chart, then the scroll to the intelligence and
the position), a macro item on the brief (then News), the portfolio line on Home (total value, Today, All time,
scrolling to the movers), the question on the Ask composer as it is typed, the answer on the real answer, held into
the end card. One camera language: the same 1.3x push on every beat, cuts on the 0.3 s music grid.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, jdump, jload, log, rest

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
LABEL = {"preopen": "BEFORE THE BELL", "midday": "MIDDAY", "close": "MARKET CLOSE"}
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
FOCUS = {"pos": 640, "home": 620, "brief": 1000, "news": 1000, "ask_q": 1450, "ask_a": 900}


def tokens(text):
    """Display tokens for the word-synced subtitle: a name and its number stay together ("Gemini\u00a04")."""
    t = re.sub(r"(\b[A-Z][a-z]+) (\d+\b)(?!%|\.\d)", "\\1\u00a0\\2", text.strip())
    return t.split()


def main():
    story = jload(os.path.join(W, "story.json")); res = jload(os.path.join(W, "research.json")); mk = jload(os.path.join(W, "marks.json"))["marks"]
    askc = jload(os.path.join(W, "ask-check.json")); acct = jload(os.path.join(W, "account.json"))
    held = {b["symbol"] for b in acct.get("book", [])}
    with Stage(W, "compose"):
        lines, beats, cue = [], [], 0
        gpt = ["marin", "cedar"]
        macro_src = ["brief", "news"]
        items = story["items"]
        for i, it in enumerate(items):
            ref = res["items"][it["n"]]
            s1, s2 = it["sentences"]
            lines.append({"voice": gpt[i % 2], "say": f"{s1['text']} {s2['text']}", "tempo": 1.12,
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
            cue += 2; b["to_cue"] = cue; beats.append(b)
        # the portfolio, on Home
        p = story["portfolio"]
        lines.append({"voice": "minjae", "say": p["text"], "tempo": 1.06, "cues": [{"eyebrow": p.get("eyebrow", "MY PORTFOLIO").upper(), "show": tokens(p["text"])}]})
        cue += 1
        beats.append({"take": "take60.mp4", "start": round(mk["home_top"] + 1.0, 2), "focus_src": FOCUS["home"], "to_cue": cue,
                      "note": "Home: total value, Today, All time, scrolling to the movers"})
        # Ask: the question typed on camera, then the real answer
        q = askc["question"]
        lines.append({"voice": gpt[len(items) % 2], "say": q, "tempo": 1.12, "cues": [{"eyebrow": "ASK ASSETLY", "show": tokens(q)}]})
        cue += 1
        beats.append({"take": "take60.mp4", "start": round(mk["ask_typing"] - 0.3, 2), "focus_src": FOCUS["ask_q"], "to_cue": cue,
                      "note": "Ask: the question typed"})
        a = story["ask"]["answer_text"]
        lines.append({"voice": "minjae", "say": a, "tempo": 1.06, "cues": [{"eyebrow": "THE ANSWER", "show": tokens(a)}]})
        beats.append({"take": "take60.mp4", "start": round(mk["ask_answer"] + 1.4, 2), "focus_src": FOCUS["ask_a"], "tail": 1.0,
                      "note": "Ask: the real answer, held into the card"})
        # the data time-stamp: when the quotes behind every figure were captured (research.data), not the render time
        from datetime import datetime
        snap = datetime.strptime(jload(os.path.join(W, "research-data.json"))["asof_et"], "%Y-%m-%d %H:%M ET")
        hm = snap.strftime("%-I:%M %p")
        stamp = {"edition": {"preopen": "Pre-open", "midday": "Midday", "close": "Close"}[ED],
                 "text": f"{snap.strftime('%b %-d')} · {hm} ET", "asof": snap.strftime("%Y-%m-%d %H:%M"),
                 "line": f"Data as of {snap.strftime('%b %-d, %Y')} {hm} ET"}
        y, m, d = DATE.split("-")
        day = {"date": DATE, "slug": f"{DATE}-{ED}", "demo": 0, "edition": ED,
               "hook": "|".join(story["cover"]), "hook_kicker": f"{LABEL[ED]} · {MON[int(m) - 1]} {int(d)}", "hook_foot": "Assetly",
               "hook_dur": 1.5, "stamp": stamp, "script": " ".join(ln["say"] for ln in lines), "grid": 0.3, "card": 1.8, "len_range": [20, 30],
               "motion": {"to": 1.3, "in": 0.7, "out": 0.6}, "lines": lines, "beats": beats}
        os.makedirs(OUT, exist_ok=True)
        jdump(day, os.path.join(OUT, "day.json"))
        tags = " ".join(story.get("hashtags", [])) or "#Shorts #stockmarket"
        if "#Shorts" not in tags: tags = "#Shorts " + tags
        desc = (stamp["line"] + "\n" + story["description"].strip() + "\nPortfolio shown is illustrative. Not financial advice.\n\n"
                "Assetly on the App Store: https://apps.apple.com/app/id6811739789\nMore: https://hodlerss.github.io/assetly/about.html")
        meta = {"title": story["title"], "description": desc, "hashtags": tags.split(), "data_as_of_et": stamp["asof"],
                "tags": [t.lstrip("#") for t in tags.split()] + ["Assetly", "stock market today", "AI stocks"], "thumbnail": "frame 0 (the headline cover)",
                "category": "News & Politics", "made_for_kids": False}
        jdump(meta, os.path.join(OUT, "youtube-metadata.json"))
        open(os.path.join(OUT, "youtube-metadata.md"), "w").write(f"# YouTube metadata\n\n**Title** ({len(meta['title'])} chars)\n{meta['title']}\n\n"
                                                                  f"**Description**\n{desc}\n\n**Hashtags**\n{tags}\n")
        log(f"day.json: {len(lines)} lines, {len(beats)} beats; cover {story['cover']}")


main()
