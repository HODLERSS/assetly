#!/usr/bin/env python3
"""Stage 6, the storyline: the words, written by the LLM from verified facts only, then checked in code.

    storyline.py <edition> <work-dir>

Inputs: research.json (verified items), facts.json (portfolio figures the app shows, cross-checked), ask.json +
ask-check.json (the real answer and its verified figures). The model writes: the cover (3 headline lines), one line
per market item (sentence 1 = what happened and WHY, sentence 2 = the READ, v1.4.0: a direct fact in our own voice), the
portfolio line, the Ask answer line, and the YouTube title/description. Code then refuses anything that breaks the
rules: a figure not in the verified set, advice/hype/jargon words, em dashes, "demo", tickers, edition-wrong timing
words, more than 14 words in a sentence, or more than the word budget (the Short must end by 30.0 s). Failures go
back to the model with the reasons (3 rounds), then the stage fails.

Writes <work>/story.json.
"""
import copy, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, attributed, jdump, jload, llm, log
from screen import direction, fval, shows
import kr as KRM

ED, W = sys.argv[1], sys.argv[2]
KR = ED in KRM.KR_EDITIONS
BAN = re.compile(r"\b(buy|sell|should|must-own|recommend|guaranteed|skyrocket\w*|soar\w*|explod\w*|moon|crush\w*|massive|insane|huge|"
                 r"don't miss|act now|best stock|secret|bagger|yolo|alpha|beta|eps|p/e|guidance|bps|basis points|multiples?|catalysts?|"
                 r"thesis|tape|tripwire|setup|capex|tam|book|print|prints|demo|demonstration|swing factors?|narratives?|cost curves?)\b", re.I)
TIMING = {"preopen": {"need": r"\b(before the bell|premarket|pre-market|futures|today|ahead of the open)\b",
                      "never": r"\b(closed (?:up|down|at|higher|lower)|after the bell|today's close|so far today|this afternoon)\b"},
          "midday": {"need": r"\b(so far|midday|this afternoon|right now|today)\b",
                     "never": r"\b(closed (?:up|down|at|higher|lower)|today's close|before the bell|this morning's open|futures point)\b"},
          "close": {"need": r"\b(closed|today|after the bell|after hours|on the day|at the close)\b",
                    "never": r"\b(so far today|this morning|before the bell|futures point|this afternoon|right now)\b"},
          # v1.1.0, the Seoul editions: the KRX session is "in Seoul"; the long window is the point
          "korea-open": {"need": r"\b(in Seoul|Seoul|so far|this month|past month|a month)\b",
                         "never": r"\b(after the bell|before the bell|premarket|pre-market|today's close|futures point|after hours)\b"},
          "korea-midday": {"need": r"\b(in Seoul|Seoul|so far|midday|this year)\b",
                           "never": r"\b(after the bell|before the bell|premarket|pre-market|today's close|futures point|after hours|closed (?:up|down|at|higher|lower))\b"},
          "korea-close": {"need": r"\b(in Seoul|Seoul|three months|closed)\b",
                          "never": r"\b(so far today|this morning|before the bell|premarket|pre-market|futures point|right now|after hours)\b"}}
# names and terms said as letters or as a word: = narrate/ear.ts SPOKEN_CAPS (earAudit's allowlist) + AT&T
SPOKEN_CAPS = {"AI", "US", "UK", "EU", "CEO", "CFO", "ETF", "ETFs", "VIX", "AMD", "IBM", "HP", "NASA", "FDA", "SEC", "FTC", "DOJ",
               "GDP", "CPI", "PCE", "PPI", "IPO", "EV", "EVs", "OPEC", "NATO", "OK", "TV", "NVIDIA", "SK", "AM", "PM", "IBK", "KOSPI"}
LEAD = {"preopen": "Before the bell,", "midday": "At midday,", "close": "At the close,",   # the fallback's timing phrase
        "korea-open": "In Seoul,", "korea-midday": "In Seoul,", "korea-close": "In Seoul,"}
LEAD_SHORT = {"preopen": "Premarket,", "midday": "Midday,", "close": "Today,", "korea-open": "In Seoul,", "korea-midday": "In Seoul,", "korea-close": "In Seoul,"}
STORY_CAP_S, STORY_ROUNDS = 360, 12                    # storyline rounds: at most 12, inside the time cap (v1.3.0: was 8; the
                                                        # cap, from the budget, is what bounds them: Sonnet rounds take 8-30 s)
# v1.3.0: run.sh lowers the cap to what the 20-minute budget leaves after compose + build + qa (never above 6 minutes)
STORY_CAP_S = min(STORY_CAP_S, int(float(os.environ.get("SHORTS_STORY_CAP_S", STORY_CAP_S))))
# SHORTS_BUDGET / SHORTS_SPOKEN_MAX: run.sh lowers both when a build measures over 30 s (10/1 midday: 31.0 s)
_KRB = sys.argv[1:2] and sys.argv[1].startswith("korea")              # Korea lines carry longer names and window phrases:
BUDGET = int(os.environ.get("SHORTS_BUDGET", 52 if _KRB else 56))      # 10/1 korea-close tests: 56 words 31.9 s, 52 words 30.8 s, 50 fit; 49 never converged
SPOKEN_MAX = int(os.environ.get("SHORTS_SPOKEN_MAX", 58 if _KRB else 68))                                        # words as voiced (speakable): 66-68 made 26-27 s, 73 made 30.3 s
LABEL = {"preopen": "BEFORE THE BELL", "midday": "MIDDAY", "close": "MARKET CLOSE", "korea-open": "SEOUL OPEN", "korea-midday": "SEOUL MIDDAY", "korea-close": "SEOUL CLOSE"}


def nums(text):
    """Figures a viewer reads: 1.8%, $1,234, 3.9, 52-week (ignored), Q4 (ignored), 11-fold (kept as 11)."""
    t = re.sub(r"\b(?:52|fifty-two)-week\b|\bQ[1-4]\b|\b(?:19|20)\d{2}\b|\bS&P 500\b|\bNasdaq 100\b|\bGemini \d\b|\b\d{1,2}:\d{2}\b", " ", text)
    return [m.group(0) for m in re.finditer(r"[$]?\d[\d,]*(?:\.\d+)?(?:%| ?(?:billion|million|trillion)|[BMT]\b)?", t)]


def allowed_figures(res, facts, askc):
    out = set()
    def add_pct(v):
        if v is None: return
        a = abs(float(v))
        for s in {f"{a:.1f}", f"{a:.2f}", f"{round(a)}" if a >= 10 else f"{a:.1f}"}:
            out.add(s.rstrip("0").rstrip(".") if "." in s else s)
    for it in res["items"]:
        for f in it.get("figures", []): add_pct(f.get("value"))
        for m in re.finditer(r"\$?\d[\d,]*(?:\.\d+)?(?: ?(?:billion|million)|[BM]\b)?", it.get("why", "") + " " + it.get("sentiment", "")):
            out.add(norm(m.group(0)))          # a figure the two cited headlines state ("$1.2 billion", "11-fold")
    for k, v in facts.get("figures", {}).items(): out.add(norm(v))
    for v in askc.get("verified", []): out.add(norm(v))
    for v in ctx()["ext"].values(): add_pct(v["pct"])
    # Home moves while the take records (10/1 midday: facts 2.3%, Home +1.99% minutes later): a figure Home shows counts as
    # verified when a cross-checked facts figure of the same kind is within the live tolerance, so the voice says the screen
    tol = {"midday": 0.35, "close": 0.06, "preopen": 0.06, "korea-open": 0.35, "korea-midday": 0.35, "korea-close": 0.06}[ED]
    fv = [fval(v) for v in facts.get("figures", {}).values()] + [fval(v) for v in (facts.get("portfolio") or {}).values() if isinstance(v, str)]
    fv = [x for x in fv if x]
    tot = next((x[0] for x in [fval((facts.get("portfolio") or {}).get("total", ""))] if x), 0)
    # Korea, live session (korea-open): the page's 1M change moves with the price between research and the take; a page
    # change that shows the same move as the verified window figure (kr.window_close) is the figure the viewer reads, so it is the one said
    if KR:
        for it in res["items"]:
            for f in it.get("figures", []):
                if not f.get("ok"): continue
                if (f.get("field") or "pct") == "pct":            # the live session move the page header shows
                    pd = ctx()["screen"].get(f"pos_{f.get('symbol')}", {}).get("day_move")
                    if ED in KRM.LIVE_EDITIONS and pd is not None and abs(pd - float(f["value"])) <= 0.35: add_pct(pd)
                    continue
                pm = ctx()["screen"].get(f"pos_{f.get('symbol')}", {}).get("range_move")
                if KRM.window_close(pm, float(f["value"]), ED): add_pct(pm)
    for f in ctx()["screen"].get("home", {}).get("figures", []):
        a = fval(f)
        if not a or not a[1]: continue
        lim = tol if a[1] == "%" else max(1.0, tol / 100 * tot)
        if any(b[1] == a[1] and abs(abs(b[0]) - a[0]) <= lim for b in fv):
            add_pct(a[0]) if a[1] == "%" else out.add(norm(f))
    return out


def norm(x):
    x = str(x).replace("$", "").replace(",", "").replace("%", "").replace(" ", "").replace("+", "").replace("\u2212", "").lstrip("-").lower()
    x = re.sub(r"(\d)b$", r"\1billion", re.sub(r"(\d)m$", r"\1million", x))
    return x.rstrip("0").rstrip(".") if re.match(r"^\d+\.\d+$", x) else x


STOP = set("""that this with from into over under after before about while their there these those they them then than been have
has had were was are is its it's also just only still says said say today closed close shares share stock stocks investors analysts
commentators traders markets market session hours after-hours year week month portfolio company point percent record high low
amid despite following because when what which where why will would could more most less least
rose rise rises rising fell fall falls falling gained gains gaining slipped slips slid slides dropped drops declined declines
jumped jumps climbed climbs edged eased ended ending finished moved higher lower
little reaction movement muted cautious steady quiet flat barely calm unmoved
premarket pre-market overnight futures midday morning yesterday bell open opening ahead
seoul korea korean kospi months""".split())


# generic reaction and framing words (10/1 preopen refused on "cheer", "credit", "liked", "purchase"): they carry no
# claim of their own, so an attributed reaction ("Investors liked the deal.") never needs a source to use the same verb
REACT = set("""like liked likes liking cheer cheered cheers welcome welcomed welcomes credit credited credits praise praised
applaud applauded embrace embraced shrug shrugged react reacted reaction reactions cheerful upbeat cautious wary worried worry
worries concern concerns concerned hopeful optimism optimistic skeptical skeptics doubt doubts nervous confident confidence
view views viewed see sees seen think thinks expect expects expected hope hopes bet bets betting focus focused watch watching
read reads note notes noted call calls called point points argue argues upside downside sign signs signal signals boost boosted
lift lifted drive driving drove news move moves rollout launch launched deal deals purchase purchased buyout acquisition acquired
announcement announced plan plans report reports reported results update updates step steps push pushed bigger biggest strong
stronger weak weaker solid good well better best positive negative mixed welcome encouraging encouraged cite cites cited""".split())


def unsupported_words(text, corpus):
    """Claim-carrying words of a spoken sentence that the item's verified text and cited headlines never use (5-letter
    stems): named entities (capitalised past the first word) and specific nouns. Generic reaction wording is free."""
    stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
    have = {stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", corpus)}
    toks = re.findall(r"[A-Za-z][A-Za-z'&-]+", text)
    words = [w for w in toks if len(w) >= 4 and w.lower() not in STOP and w.lower() not in REACT and w.lower().rstrip("s") not in REACT]
    return [w for w in words if stem(w) not in have]


def unsupported_names(text, corpus):
    """Named entities (a capitalised word past the sentence's first, or an all-caps name) no source names: one is enough to fail."""
    have = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'&-]+", corpus)}
    toks = re.findall(r"[A-Za-z][A-Za-z'&-]+", text)
    return [w for k, w in enumerate(toks) if (k > 0 and w[0].isupper() or w.isupper() and len(w) > 1)
            and w.lower() not in have and w.lower().rstrip("'s") not in have and w not in SPOKEN_CAPS and w.lower() not in STOP]


def ear_audit(lines):
    """The product's own speakable() + earAudit() on every line that will be voiced (make-short refuses a line it flags)."""
    import subprocess
    from lib import APP
    ts = os.path.join(W, "ear_check.ts")
    open(ts, "w").write(f'''import {{ speakable, earAudit }} from "{APP}/supabase/functions/narrate/ear.ts";
const lines: string[] = JSON.parse(await new Response(Deno.stdin.readable).text());
console.log(JSON.stringify(lines.map((l) => {{ const s = speakable(l); return [earAudit(s), s.split(/\\s+/).filter(Boolean).length]; }})));''')
    r = subprocess.run(["npx", "-y", "deno@2", "run", "-A", ts], input=json.dumps(lines), capture_output=True, text=True, timeout=120)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:                                    # noqa: BLE001
        return [[[f"ear check did not run: {r.stderr[-200:]}"], 0]]


MOVE = r"\b(rose|rises?|rising|jump\w*|gain\w*|climb\w*|rall\w*|fell|fall\w*|drop\w*|slid|slides?|sank|sinks?|slip\w*|declin\w*|lift\w*|surg\w*|up|down|higher|lower)\b"


def restates(s1, s2):
    """Sentence 2 adds nothing (owner review, 10/1: "Alphabet unveils Gemini 4, lifting shares 2.2%. Shares rise on the
    model."): it is a price-move sentence about the shares when sentence 1 already gave the move, or every content word
    of it is already in sentence 1."""
    move1 = re.search(r"\d+(?:\.\d+)?%", s1) or (re.search(r"\b(shares?|stock)\b", s1, re.I) and re.search(MOVE, s1, re.I))
    move2 = re.match(r"^\s*(shares?|the stock|its stock|stock)\b", s2, re.I) and re.search(MOVE, s2, re.I)
    if move1 and move2 and not re.search(r"\b(record|high|low|after hours|after-hours|premarket|despite|but|still|since|year|week|month)\b", s2, re.I):
        return True
    stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
    w1 = {stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", s1)}
    w2 = [stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", s2) if len(w) >= 4 and w.lower() not in STOP]
    return bool(w2) and all(w in w1 for w in w2)


EXT_WORDS = {"PRE-MARKET": r"\b(premarket|pre-market)\b", "AFTER HOURS": r"\b(after hours|after-hours)\b"}
EXT_MAX_AGE = float(os.environ.get("SHORTS_EXT_MAX_AGE_MIN", "15"))    # a chip's quote must be this fresh at the take
_CTX = {}


def ctx():
    """What the take shows (screen.json), the fresh extended-hours quotes (ext.json) and the recorded answer's lines."""
    if not _CTX:
        _CTX["screen"] = (jload(os.path.join(W, "screen.json"), {}) or {}).get("windows", {})
        ext = jload(os.path.join(W, "ext.json"), {}) or {}
        take = (jload(os.path.join(W, "latency.json"), {}) or {}).get("record.take", {})
        t_take = take.get("start", 0) + take.get("secs", 0)          # the take's end: the chip quote must predate it by < 15 min
        _CTX["ext"] = {k: v for k, v in ext.items() if not t_take or abs(t_take - v.get("asof_ts", 0)) / 60 <= EXT_MAX_AGE}
        ask = jload(os.path.join(W, "ask.json"), {}) or {}
        _CTX["lines"] = [r for r in ask.get("answer_rects", []) if r.get("visible") and re.search(r"[A-Za-z0-9]", r["text"])]
    return _CTX


def item_shot(r):
    """The screen.json window an item's beat uses (compose: the held story name's page, else the brief / News)."""
    win = ctx()["screen"]
    sym = next((x for x in r.get("symbols", []) if f"pos_{x}" in win), None)
    if sym: return f"pos_{sym}", win[f"pos_{sym}"]["figures"], sym
    return "brief+news", (win.get("brief", {}).get("figures", []) + win.get("news", {}).get("figures", [])), None


def plain_line(t):
    """An answer point as a voice would quote it: no bullet or '(Seeking Alpha, investorshub)' attribution, signs as
    words, a bracketed % as ', or 3.1%' (one decimal)."""
    t = re.sub(r"\s*\([^)\d]*\)|\s*\[[^\]]*\]", "", t.replace("\u2022", "")).replace("~", "about ")
    t = re.sub(r"(\$[\d,.]+)\s*\(\s*[+\-\u2212]?(\d+(?:\.\d+)?)%\s*\)", lambda m: f"{m.group(1)}, or {float(m.group(2)):.1f}%", t)
    t = re.sub(r"\s*\(\s*([+\-\u2212]?)(\d+(?:\.\d+)?)%\s*\)", lambda m: " " + ("down" if m.group(1) in ("-", "\u2212") else "up") + f" {float(m.group(2)):.1f}%", t)
    t = re.sub(r"\+(?=\$?\d)", "up ", t); t = re.sub(r"[\u2212-](?=\$?\d)", "down ", t)
    t = re.sub(r"(\d+\.\d)\d+%", r"\1%", t)
    t = re.sub(r"\s+([,.;:])", r"\1", t)              # "$151,900 , roughly" as the app spaced it (10/1 korea-close)
    return re.sub(r"\s+", " ", t).strip(" .;:,") + "."


def short_name(n):
    """The name people say (= facts.short_name): "Accenture PLC" -> "Accenture"."""
    n = re.sub(r"\s*(?:Common Stock|Class [A-C]( Common Stock)?|Ordinary Shares|American Depositary Shares)\b.*$", "", str(n or ""))
    for _ in range(2):
        n = re.sub(r",?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Holdings?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|Group|Technologies|Technology|Platforms)$", "", n.strip())
    return n.strip()


def say_names(facts):
    """Ticker -> the name the voice says: the letters when people say them (IBM, AMD), else the short name."""
    nm = lambda v: v.title() if v.isupper() and len(v) > 3 else v                # "NIKE" -> "Nike" (the voice spells caps)
    return {k: (k if k in SPOKEN_CAPS else nm(short_name(v))) for k, v in facts.get("names", {}).items()}


def ticker_names(res, facts):
    """Ticker -> the name to say, for every candidate, held and story company (a ticker is never spoken)."""
    names = dict(facts.get("names", {}))
    data = jload(os.path.join(W, "research-data.json"))
    for c in data.get("candidates", []):
        sym = c.get("symbol") if isinstance(c, dict) else c
        if sym: names.setdefault(sym, (c.get("name") if isinstance(c, dict) else None) or sym)
    for it in res["items"]:
        for sym in it.get("symbols", []): names.setdefault(sym, sym)
    try:
        book = jload(os.path.join(W, "book.json"))
        for p in (book if isinstance(book, list) else book.get("positions", [])):
            if isinstance(p, dict) and p.get("symbol"): names.setdefault(p["symbol"], p.get("name") or p["symbol"])
    except Exception:                                    # noqa: BLE001
        pass
    return names


NEWS_WHEN = re.compile(r"\b(overnight|last night|this morning|earlier today|yesterday|late (?:yesterday|monday|tuesday|wednesday|thursday|friday))\b", re.I)


def when_supported(word, cited):
    """A news-timing word holds only when EVERY cited WHY headline was published inside its window (ET): overnight = after
    the previous 4 PM to 9:30 AM, this morning / earlier today = today after 4 AM, yesterday / last night = the day before."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    if not cited: return False
    day = datetime.strptime(jload(os.path.join(W, "research-data.json"))["date"], "%Y-%m-%d")
    try:
        ts = [datetime.strptime(h["utc"], "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)
              for h in cited]
    except Exception:                                    # noqa: BLE001
        return False
    w = word.lower()
    if w == "overnight": lo, hi = day - timedelta(hours=8), day + timedelta(hours=9, minutes=30)
    elif w in ("this morning", "earlier today"): lo, hi = day + timedelta(hours=4), day + timedelta(hours=12)
    else: lo, hi = day - timedelta(days=1), day
    return all(lo <= t <= hi for t in ts)


def check(story, res, facts, askc):
    errs = []
    heads = {h["id"]: h for h in jload(os.path.join(W, "research-data.json"))["headlines"]}
    tick = ticker_names(res, facts)
    for i, it in enumerate(story["items"]):
        try:
            r = res["items"][it["n"]]
        except (IndexError, KeyError, TypeError):
            errs.append(f"item {i + 1}: n must be one of the verified items"); continue
        corpus = " ".join([r["why"], r["sentiment"], r["cover"], " ".join(facts.get("names", {}).values())] +
                          [heads[x]["title"] for x in r["why_ids"] + r["sentiment_ids"] if x in heads])
        # a word the cited headlines do not use is still fine when two other publishers' headlines on the same name use it
        stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
        pubs_by_stem = {}
        for h in heads.values():
            if h["tag"] in r.get("symbols", []) or (not r.get("symbols") and h["tag"] == "MACRO"):
                for w in re.findall(r"[A-Za-z][A-Za-z'-]+", h["title"]): pubs_by_stem.setdefault(stem(w), set()).add(h["publisher"])
        corpus += " " + " ".join(k for k, v in pubs_by_stem.items() if len(v) >= 2)
        sign0 = next((f["value"] for f in r.get("figures", []) if f.get("symbol") in r.get("symbols", []) and (f.get("field") or "pct") == "pct"), None)
        for x in it["sentences"]:
            # a Korea line about a long window ("fell 28% over three months") is checked against that window's figure
            wf = KRM.window_field(x["text"]) if KR else None
            sign = next((f["value"] for f in r.get("figures", []) if f.get("symbol") in r.get("symbols", []) and f.get("field") == wf), None) if wf else \
                (sign0 if KR else next((f["value"] for f in r.get("figures", []) if f.get("symbol") in r.get("symbols", [])), None))
            m_t = NEWS_WHEN.search(x["text"])
            if m_t and not when_supported(m_t.group(0), [heads[h] for h in r.get("why_ids", []) if h in heads]):
                errs.append(f"item {i + 1}: '{m_t.group(0)}' says when the news happened, but its sources' times do not show it "
                            f"-> drop it; use a neutral lead about our time ('{LEAD[ED]}') if a timing word is needed")
            if sign is not None and not re.search(r"after[- ]hours|premarket|pre-market", x["text"], re.I):
                if abs(sign) >= 1.0 and re.search(r"\b(flat|barely|little (?:reaction|movement|changed?)|unmoved|muted)\b", x["text"], re.I):
                    errs.append(f"item {i + 1}: says flat, the verified move is {sign:+.2f}%")
                if sign < 0 and re.search(r"\b(rose|gained|jumped|climbed|rallied|higher)\b", x["text"], re.I): errs.append(f"item {i + 1}: says up, the verified move is {sign:+.2f}%")
                if sign > 0 and re.search(r"\b(fell|dropped|slid|slipped|declined|sank|lower)\b", x["text"], re.I) and not re.search(r"\b(despite|but|after)\b", x["text"], re.I):
                    errs.append(f"item {i + 1}: says down, the verified move is {sign:+.2f}%")
            # every figure spoken over the shot is on the shot: the app's screen, or the edit's labelled extended-hours chip
            shot, figs, sym = item_shot(r); ex = ctx()["ext"].get(sym or next(iter(r.get("symbols", [])), ""), None)
            says_ext = re.search(r"premarket|pre-market|after hours|after-hours", x["text"], re.I)
            for f in nums(x["text"]):
                v = fval(f)
                is_ext = bool(ex and v and v[1] == "%" and round(abs(ex["pct"]), v[2]) == v[0])
                if is_ext and not re.search(EXT_WORDS[ex["label"]], x["text"], re.I):
                    errs.append(f"item {i + 1}: '{f}' is the {ex['label'].lower()} move -> say '{ex['label'].lower()}' in that sentence (the edit shows it on a chip)")
                elif not is_ext and not shows(f, figs):
                    alt = (f"the fresh {ex['label'].lower()} move {abs(ex['pct']):.1f}% with the word '{ex['label'].lower()}'" if ex else "no figure")
                    errs.append(f"item {i + 1}: '{f}' is not on screen during its shot ({shot} shows {[g for g in figs if '%' in g or '$' in g][:6]}) "
                                f"-> use one of those, {alt}, or drop it")
            # a price direction about the holding agrees with what its page shows in the shot (owner, 10/1: "Shares rise."
            # over "-0.03% since last close"), unless the sentence is the labelled extended-hours move on a chip
            dv = direction(x["text"]); mv = ctx()["screen"].get(shot, {}).get("day_move") if sym else None
            if wf and sym:
                # the page is filmed on the edition's range (1M / 3M): a window claim must be THAT window and agree with it
                pr, pm = ctx()["screen"].get(shot, {}).get("range"), ctx()["screen"].get(shot, {}).get("range_move")
                want = {"m1": "1M", "m3": "3M", "ytd": "YTD"}[wf]
                if pr != want:
                    errs.append(f"item {i + 1}: {x['text']!r} speaks about the {want} window but the page shows the {pr or '?'} change "
                                f"-> use the {KRM.RANGE[ED]} window ('{KRM.WIN_PHRASE[KRM.RANGE[ED]]}')")
                elif dv and (pm is None or (pm > 0) != (dv > 0)):
                    errs.append(f"item {i + 1}: {x['text']!r} gives a direction the page's {pr} change ({pm}) does not show")
                mv = None; dv = 0                         # the session check below does not apply to a window sentence
            if dv and sym and not (says_ext and ex):
                if mv is None or abs(mv) < 0.05 or (mv > 0) != (dv > 0):
                    errs.append(f"item {i + 1}: {x['text']!r} says the stock went {'up' if dv > 0 else 'down'} but its page shows "
                                f"{'no day move' if mv is None else f'{mv:+.2f}%'} -> say what happened without a price direction"
                                + (f", or use the move the page shows ({mv:+.1f}%)" if mv is not None and abs(mv) >= 0.05 else ""))
            if says_ext and not ex:
                errs.append(f"item {i + 1}: says extended hours in {x['text']!r} but there is no fresh two-feed quote for a chip -> "
                            f"say what the app shows instead")
            names = unsupported_names(x["text"], corpus)
            miss = [w for w in unsupported_words(x["text"], corpus) if w not in names]
            if names or len(miss) > 1 or (miss and len(x["text"].split()) < 5):
                errs.append(f"item {i + 1}: words the verified sources never say: {names + miss} in {x['text']!r} "
                            f"-> rewrite it with the item's own wording (WHY: {r['why']!r}; READ: {r['sentiment']!r})")
    if KR:
        # the long view is the point (owner, 10/1): a Korea item whose page shows a verified window change says it
        # korea-midday (v1.2.0): YTD figures are three digits ("182.8%" is six spoken words) and the rule fought the voiced
        # budget (10/2: 3 x 8 rounds alternating "say its YTD move" / "cut 2 words", refused). There a window figure is
        # optional: "rose this year" carries the window and the cover hero shows the page's YTD figure
        fld, said = KRM.RANGE_FIELD[KRM.RANGE[ED]], False
        for i, it in enumerate(story["items"]):
            try: r = res["items"][it["n"]]
            except (IndexError, KeyError, TypeError): continue
            f = next((f for f in r.get("figures", []) if f.get("field") == fld and f.get("ok") and KRM.is_kr(f.get("symbol", ""))), None)
            # v1.3.x Korea-first: no Korean item is forced to SAY its window figure (the page header and the KRX cover hero
            # show it); 10/2 korea-close: 5 rebuilds never converged between "say 15.8%" and the 52-word budget
            if f: continue
            # Korea-first (10/2): with three Korean items, a window figure in each blew the word budget (korea-close v2:
            # 5 rounds, refused); the first Korean item says it, the rest may say the window without a figure
            if f and said: continue
            if f: said = True
            if f and not any(nums(x["text"]) for x in it["sentences"]):
                # live: the page's own header figure, the one the viewer reads (and the one allowed_figures accepts)
                pm = ctx()["screen"].get(f"pos_{f['symbol']}", {}).get("range_move")
                shown = pm if KRM.window_close(pm, float(f["value"]), ED) else f["value"]
                errs.append(f"item {i + 1}: say its {KRM.RANGE[ED]} move in sentence 1 (the page shows it: {abs(shown):.1f}% "
                            f"{KRM.WIN_PHRASE[KRM.RANGE[ED]]}); trim other words to stay in budget")
    allowed = allowed_figures(res, facts, askc)
    sents = [(f"item {i + 1}", s["text"]) for i, it in enumerate(story["items"]) for s in it["sentences"]]
    sents += [("portfolio", story["portfolio"]["text"]), ("ask answer", story["ask"]["answer_text"])]
    words = sum(len(t.split()) for _, t in sents) + len(askc["question"].split())
    if words > story.get("_budget", BUDGET):
        # Korea: never point the cut at the line carrying the window figure the check requires (10/2 korea-close: 12
        # rounds alternating "say 15.8%" / "shorten 'SK hynix fell 15.8% ...'")
        cut_from = [x for x in sents if not (KR and nums(x[1]))] or sents
        longest = max(cut_from, key=lambda x: len(x[1].split()))
        errs.append(f"{words} spoken words, budget {story.get('_budget', BUDGET)}: cut at least {words - story.get('_budget', BUDGET)} words "
                    f"-> shorten {longest[0]} ({len(longest[1].split())} words: {longest[1]!r}) first; keep every fact you keep exact")
    if not 3 <= len(story["items"]) <= 5: errs.append(f"{len(story['items'])} market items, need 3 to 5")
    for where, t in sents + [("cover", " ".join(story["cover"])), ("title", story["title"]), ("description", story["description"])]:
        spoken_line = where not in ("cover", "title", "description")
        for m in BAN.finditer(t): errs.append(f"{where}: banned word '{m.group(0)}'")
        if "—" in t or "–" in t: errs.append(f"{where}: em/en dash")
        for tok in re.findall(r"\b[A-Z]{2,5}\b", re.sub(r"\bAT&T\b|\bS&P\b", " ", t)):
            # a ticker of a candidate or held company is said as its name; names said as letters (IBM, AMD) are fine
            if spoken_line and tok in tick and tok not in SPOKEN_CAPS:
                errs.append(f"{where}: ticker '{tok}' -> write the company name {short_name(tick[tok])!r} instead")
    for where, t in sents:
        if len(t.split()) > 15: errs.append(f"{where}: sentence over 15 words: {t!r}")
        for f in nums(t):
            nf = norm(f)
            if nf not in allowed and not re.match(r"^\d+-fold$", f) and not any(a.startswith(nf) and a[len(nf):].isalpha() for a in allowed):
                errs.append(f"{where}: figure {f!r} is not in the verified set -> delete it (or use one of {sorted(allowed)[:12]})")
    audits = ear_audit([t for _, t in sents] + [askc["question"]])
    spoken = sum(n for _, n in audits)
    if spoken > SPOKEN_MAX:                              # figures read long: "5.8%" is four spoken words (10/1: 73 -> 30.3 s)
        longest = max([z for z in zip(sents, audits) if not (KR and nums(z[0][1]))] or list(zip(sents, audits)), key=lambda x: x[1][1])
        errs.append(f"{spoken} words once figures are read aloud ('5.8%' = 'five point eight percent'), max {SPOKEN_MAX}: cut "
                    f"{spoken - SPOKEN_MAX} -> shorten {longest[0][0]} ({longest[0][1]!r}); fewer figures read shorter")
    for (where, t), (a, _) in zip(sents, audits):
        if a: errs.append(f"{where}: the voice would stumble on {a} in {t!r} -> use plain words; names said as letters "
                          f"({', '.join(sorted(SPOKEN_CAPS)[:12])}...) are fine, other acronyms are not")
    all_spoken = " ".join(t for _, t in sents)
    if not re.search(TIMING[ED]["need"], all_spoken, re.I):
        errs.append(f"timing: none of the {ED} words appear -> start item 1's first sentence with {LEAD[ED]!r}")
    for m in re.finditer(TIMING[ED]["never"], all_spoken, re.I): errs.append(f"timing: '{m.group(0)}' is wrong for the {ED} edition")
    for i, it in enumerate(story["items"]):
        if len(it["sentences"]) != 2: errs.append(f"item {i + 1}: needs exactly 2 sentences (why, then the read)")
        elif restates(it["sentences"][0]["text"], it["sentences"][1]["text"]):
            r = res["items"][it["n"]]
            errs.append(f"item {i + 1}: sentence 2 only restates sentence 1 ({it['sentences'][1]['text']!r}) -> replace it with the "
                        f"direct read, e.g. {r['sentiment']!r} shortened")
        # (a thin read is the judge's call, not a word count: a 5-word floor looped the 10/2 korea-midday rebuild 12 rounds
        # against the 52-word budget)
        # v1.4.0 (owner 10/2: "instead of saying commentators said this, be more direct. don't use third-party word like that"):
        # the inverse of the v1.0 rule that REQUIRED "Analysts / Investors ..." here: no sentence of the Short attributes its read
        for j, x in enumerate(it["sentences"]):
            if attributed(x["text"]):
                errs.append(f"item {i + 1}: sentence {j + 1} {x['text']!r} attributes it to others ('{attributed(x['text'])}') -> say "
                            f"the fact directly in our own voice (its scale, its driver, what it means, or what comes next with a date), "
                            + (f"e.g. {res['items'][it['n']]['sentiment']!r}" if not attributed(res['items'][it['n']]['sentiment'])
                               else "using only the item's verified facts") + "; never an opinion stated as fact")
    if KR:
        # Korea-first (owner, 10/2): item 1 and at least two of the three items are KRX listings (or the KOSPI); US names
        # only as read-through context
        krs = [any(KRM.is_kr(s) for s in (res["items"][it["n"]].get("symbols") or [])) if isinstance(it.get("n"), int)
               and it["n"] < len(res["items"]) else False for it in story["items"]]
        spare = [n for n, r in enumerate(res["items"]) if any(KRM.is_kr(s) for s in r.get("symbols") or [])]
        if not krs or not krs[0] or sum(krs) < 2:
            errs.append(f"Korea-first: item 1 and at least 2 of the 3 items must be Korean listings -> use verified items n={spare} "
                        f"(US names only as the third item or as context)")
    # fluency (owner review 10/2: "Broadcom reportedly got Samsung Electronics memory favors. Analysts see gap closing.")
    for k, it in enumerate(story["items"]):
        for x in it["sentences"]:
            t = x["text"]
            if re.search(r"got.*favou?rs|(see|sees|expect|expects)\s+(gap|demand|growth|margin|price|prices)\s+\w+ing", t, re.I):
                errs.append(f"item {k + 1}: {t!r} is not natural English (a missing article or an odd phrase) -> say it as a person would")
    for it in story["items"]:
        for x in it["sentences"]:
            if len(x["eyebrow"]) > 26: errs.append(f"eyebrow {x['eyebrow']!r} over 26 characters (use the short name)")
    pt, at = story["portfolio"]["text"], story["ask"]["answer_text"]
    # second person (owner, 10/1): the narration talks to the viewer about THEIR portfolio; only the typed question is theirs
    if "your portfolio" not in pt.lower() or len(pt.split()) < 5:
        errs.append(f"portfolio: a full sentence that names 'Your portfolio' (got {pt!r}) -> write it as "
                    f"'Your portfolio <moved> <figure> <when>.' in 5-8 words, e.g. 'Your portfolio is up 28% all time.'")
    for where, t in sents + [("title", story["title"]), ("description", story["description"])]:
        m = re.search(r"\b(my|I'm|I am|I|me|mine|we|our)\b", t)
        if m:
            errs.append(f"{where}: first person '{m.group(0)}' in {t!r} -> second person: 'Your portfolio ...', 'you ...'")
    # the portfolio figure carries its window word, the one Home labels it with (owner, 10/1: "up 28%" over "All time +28.33%")
    htexts = ctx()["screen"].get("home", {}).get("texts", [])
    for f in nums(pt):
        lab = next((("all time", r"\b(all[- ]time)\b") if re.search(r"all time", t, re.I) else ("today", r"\b(today|so far today|yesterday)\b")
                    for t in htexts if re.search(r"all time|today", t, re.I) and shows(f, re.findall(r"[+\-\u2212]?\$?\d[\d,]*(?:\.\d+)?%?", t))), None)
        if lab and not re.search(lab[1], pt, re.I):
            errs.append(f"portfolio: '{f}' is Home's {lab[0]} figure -> say '{lab[0]}' with it (e.g. 'Your portfolio is up {f} {lab[0]}.')")
        elif not lab and not re.search(r"\b(all[- ]time|today|yesterday|this week|this month|this year)\b", pt, re.I):
            errs.append(f"portfolio: '{f}' needs its window (all time / today / this week / this month)")
    # every figure spoken over Home must be on Home in the take
    home = ctx()["screen"].get("home", {}).get("figures")
    if home is not None:
        for f in nums(pt):
            if not shows(f, home): errs.append(f"portfolio: '{f}' is not on Home in the take (Home shows {home[:6]}) -> use one of those")
    # the Ask answer is a recorded, visible answer line, quoted or closely paraphrased, with the same figures
    lines = ctx()["lines"]; k = story["ask"].get("line")
    if not lines:
        errs.append("ask answer: the take recorded no visible answer line (re-record: the answer must be on screen)")
    elif not isinstance(k, int) or not 0 <= k < len(lines):
        errs.append(f"ask answer: 'line' must be the number of the visible answer line it quotes (0-{len(lines) - 1})")
    else:
        lt = lines[k]["text"]; lf = nums(lt)
        say = say_names(facts)
        lt_said = lt + " " + " ".join(say.get(x, short_name(tick.get(x, x))) for x in re.findall(r"\b[A-Z]{2,5}\b", lt) if x in tick)
        for f in nums(at):
            if not shows(f, lf): errs.append(f"ask answer: '{f}' is not in answer line {k} ({lt!r}) -> use that line's own figures")
        stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
        aw = [stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", at) if len(w) >= 3 and w.lower() not in STOP]
        have = {stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", lt_said)} | {"your", "port"}
        if aw and sum(w in have for w in aw) / len(aw) < 0.6:
            errs.append(f"ask answer: {at!r} does not follow answer line {k} ({lt!r}) -> quote it or paraphrase it closely")
    if len(at.split()) < 4 or (ED in ("midday", "close") and not re.search(r"\b(up|down|flat|gained|lost|rose|fell)\b", at, re.I)):
        errs.append(f"ask answer: a full spoken sentence with the direction words (up / down / flat), got {at!r} -> "
                    f"e.g. 'Up 3.8% this month and 31% over the year.' (4-13 words, verified figures only)")
    for where, t in sents:
        for m in re.finditer(r"\d+\.\d{2,}%", t): errs.append(f"{where}: {m.group(0)}: one decimal for percentages")
    # owner, 10/1: short and catchy, no edition label ("Midday:", "After the bell") and no date
    if len(story["title"]) > 50: errs.append(f"title is {len(story['title'])} chars (max 50): make it shorter and punchier")
    if re.search(r"\b(before the bell|pre-?open|midday|after the bell|at the close|close:|seoul open|seoul close)|\|\s*\w{3} \d", story["title"], re.I):
        errs.append("title: no edition label or date -> just the hook, e.g. 'Micron pops, Boeing lands $20B'")
    if len(story["cover"]) != 3: errs.append("cover needs exactly 3 lines")
    # covers, title and description state no price direction the screen contradicts (owner, 10/1: "IBM rallies." over a
    # page at -0.03%), unless a chip shows that move
    from screen import direction as _dir
    names_i = []
    for r_ in res["items"]:
        nm_ = [short_name(tick.get(x_, x_)) for x_ in r_.get("symbols", [])] + list(r_.get("symbols", [])) + [r_["cover"].split()[0]]
        names_i.append((r_, [n_ for n_ in nm_ if n_]))
    def dir_conflict(seg):
        for r_, nm_ in names_i:
            if not any(re.search(rf"\b{re.escape(n_)}\b", seg, re.I) for n_ in nm_): continue
            shot_, _, sym_ = item_shot(r_)
            if not sym_: continue
            dv_ = _dir(seg); mv_ = ctx()["screen"].get(shot_, {}).get("day_move")
            rm_ = ctx()["screen"].get(shot_, {}).get("range_move") if KR else None
            if KR and dv_ and rm_ is not None and abs(rm_) >= 0.05 and (rm_ > 0) == (dv_ > 0): continue   # the page's 1M / 3M change shows it
            if dv_ and sym_ not in ctx()["ext"] and (mv_ is None or abs(mv_) < 0.05 or (mv_ > 0) != (dv_ > 0)): return sym_, mv_
        return None
    for where, t in [("cover", c) for c in story["cover"]] + [("title", story["title"]), ("description", story["description"])]:
        for seg in re.split(r",|;|\band\b|(?<=[.!?])\s+|:", t.replace("[", "").replace("]", "")):
            bad_ = dir_conflict(seg)
            if bad_:
                errs.append(f"{where}: {seg.strip()!r} gives a price direction its page does not show ({bad_[0]} "
                            f"{'no day move' if bad_[1] is None else format(bad_[1], '+.2f') + '%'}) -> describe the news instead ('IBM launches AI platform.')")
    # the accent bracket is code's job: the leading name (one word, or two when the second is capitalised)
    story["cover"] = [re.sub(r"\s*:\s*", " ", c.replace("[", "").replace("]", "")).strip() for c in story["cover"]]
    story["cover"] = [c if c.endswith(".") else c + "." for c in story["cover"]]
    # names whose second word is lowercase or that are three words ("SK hynix", "Samsung Electronics") bracket whole
    MULTI = r"SK hynix|Samsung Electro-Mechanics|Samsung Electronics|Hanmi Semiconductor|EO Technics|Wonik IPS|DB HiTek|Leeno Industrial"
    story["cover"] = [re.sub(rf"^({MULTI})\b", r"[\1]", c, count=1) if re.match(rf"^({MULTI})\b", c) else
                      re.sub(r"^((?:[A-Z][\w&'.-]*)(?: [A-Z][\w&'.-]*)?)", r"[\1]", c, count=1) for c in story["cover"]]
    for c in story["cover"]:
        if len(c) > 30 or " " not in c: errs.append(f"cover line {c!r}: 'Name verb.' with a short name, <= 28 chars")
    # a bare "Stocks slipped" (10/1 midday) contradicted "US stocks today +2.00%" in the Ask on screen: a whole-market line
    # names its index
    for k, it in enumerate(story.get("items", [])):
        for snt in (it.get("sentences") or []) if isinstance(it, dict) else []:
            t = snt.get("text", "") if isinstance(snt, dict) else ""
            if re.search(r"\b(Stocks|Markets|The market|Wall Street|U\.?S\. stocks)\b[^.]*\b(slipped|slid|fell|dropped|rose|climbed|gained|rallied|jumped|sank|dipped)\b", t) \
               and not re.search(r"S&P|Nasdaq|Dow|Russell|KOSPI|Kospi", t):
                errs.append(f"item {k + 1}: a whole-market line must name its index (S&P 500 / Nasdaq / Dow) -> rewrite '{t}' with the index and its verified figure, or drop the market line")
    # owner, 10/1 close: "The Boeing won Navy's fighter." -- no article before a company name, and no "<Org>'s <noun>."
    # ending that drops what was won (a possessive whose object is one bare word at the end of the sentence)
    cos = {v.split()[0] for v in say_names(facts).values() if v} | {re.sub(r"\s+\w+\.?$", "", it.get("cover", "")).strip().split(" ")[0]
                                                                       for it in res.get("items", []) if it.get("cover")}
    cos = {c for c in cos if c and c[0].isupper() and c not in ("The", "Fed")}
    spoken = [(f"item {k + 1}", snt.get("text", "")) for k, it in enumerate(story.get("items", [])) if isinstance(it, dict)
              for snt in (it.get("sentences") or []) if isinstance(snt, dict)]
    spoken += [("portfolio", (story.get("portfolio") or {}).get("text", "")), ("ask answer", (story.get("ask") or {}).get("answer_text", ""))]
    for where, t in spoken:
        m_a = re.search(r"\b[Tt]he (" + "|".join(map(re.escape, sorted(cos))) + r")\b", t) if cos else None
        if m_a: errs.append(f"{where}: 'the {m_a.group(1)}' -> drop the article before a company name ('{m_a.group(1)} ...')")
        if re.search(r"\b(won|beat|signed|landed|took|lost)\s+[A-Z][\w&.-]*'s\s+\w+\.\s*$", t):
            errs.append(f"{where}: '{t}' drops what the possessive refers to -> say it in full ('won a $20B Navy fighter contract')")
    return errs, words


def judge(story, res, askc):
    """A native-speaker editor's pass over a draft every code check passed (owner review 10/2): each spoken line must be
    natural, grammatical English; each item's read must add a concrete fact in the Short's own voice (not restate the why,
    no "Analysts say ..." attribution, no opinion stated as fact); the spoken Ask answer must answer the typed question; a Korea Short must say what it means for a US
    investor's AI-heavy portfolio somewhere. Returns problems as rewrite instructions ([] = pass, or the judge failed)."""
    lines = [f"item {k + 1}, sentence {j + 1}: {x['text']}" for k, it in enumerate(story["items"]) for j, x in enumerate(it["sentences"])]
    lines += [f"portfolio: {story['portfolio']['text']}", f"ask question: {askc['question']}", f"ask answer: {story['ask']['answer_text']}"]
    reads = "\n".join(f"item {k + 1} sources say: WHY {res['items'][it['n']]['why']!r}; READ {res['items'][it['n']]['sentiment']!r}"
                      for k, it in enumerate(story["items"]))
    jp = ("Lines of a 25-second market video for US retail investors, read aloud:\n" + "\n".join(lines) + "\n\nWhat the sources say:\n" + reads +
          "\n\nJudge strictly, as a native English-speaking editor:\n"
          "1. fluent: would a native speaker say this line exactly so? (articles present, no odd phrasing like 'got memory favors' or "
          "'see gap closing', no headline-ese)\n"
          "2. read_adds: for each item, does sentence 2 add a concrete new FACT said directly in the video's own voice (the scale, "
          "the driver, a flow, what it means, what comes next with a date) rather than restating sentence 1, attributing it to "
          "others ('Analysts say ...', 'Commentators call it ...') or stating an opinion or forecast as fact?\n"
          "3. answers: does the ask answer directly answer the ask question (the figure it asks for)?\n" +
          ("4. read_through: does at least one line say what it means for a US investor's AI chip holdings (context, not advice)?\n" if KR else "") +
          'Return {"problems": [{"where": "item 2, sentence 2", "issue": "...", "fix": "a natural rewrite using only facts above"}]} '
          "with [] when every line passes. Never suggest advice or a forecast.")
    try:
        v = llm(W, "You are a strict copy editor. Natural, concrete, correct English only.", jp, max_tokens=3000, temperature=0,
                timeout=60, prefer="openrouter")
    except RuntimeError as e:
        log(f"storyline judge failed ({str(e)[:80]}): code checks stand"); return []
    return [f"{p.get('where', '?')}: {p.get('issue', '')} -> {p.get('fix', '')}" for p in v.get("problems") or [] if isinstance(p, dict)]


def short_title(covers):
    """The fallback title: the first two covers joined, <= 50 chars, no edition label, no date."""
    cs = [c.rstrip(".") for c in covers if c]
    t = ", ".join(cs[:2])
    return t if len(t) <= 50 else cs[0][:50]


def fallback(story, res, facts, askc):
    """Last resort, deterministic: lines that still fail are told with the item's verified WHY and READ (trimmed at a
    clause when the budget needs it), the edition's timing phrase leads item 1, and the portfolio / Ask lines fall back
    to templates from the cross-checked figures. Returns (story, errs, words); it can still fail, and then the run refuses."""
    story = copy.deepcopy(story) if isinstance(story, dict) else {}
    if not isinstance(story.get("items"), list) or len(story["items"]) < 3:
        story["items"] = [{"n": i} for i in range(min(3, len(res["items"])))]
    for k, v in (("portfolio", {"eyebrow": "MY PORTFOLIO", "text": ""}), ("ask", {"answer_text": ""})):
        if not isinstance(story.get(k), dict): story[k] = v
    story.setdefault("cover", [res["items"][it.get("n", 0)]["cover"] for it in story["items"][:3]])
    story.setdefault("title", short_title([res["items"][it.get("n", 0)]["cover"] for it in story["items"][:3]]))
    story.setdefault("description", " ".join(res["items"][it.get("n", 0)]["why"] for it in story["items"][:3]))
    story.setdefault("hashtags", ["#Shorts", "#stockmarket"]); story["_budget"] = BUDGET

    def trims(t):
        """The sentence, then shorter versions cut at a clause boundary (each still a verified claim, just less of it)."""
        t = t.strip().rstrip(".") ; out = [t]
        # " but " / " yet ": the contrast clause is often the stale price read ("... but the stock barely budged" while
        # the verified move is +3.03%, 10/1 close); the head is still a verified claim
        for sep in (" but ", " yet ", " though ", ", ", " and ", " with ", " as ", " after ", " on "):
            if sep in t:
                head = t.split(sep)[0].strip()
                if len(head.split()) >= 4 and head not in out: out.append(head)
        return [x + "." for x in sorted(out, key=lambda x: -len(x.split()))]

    def item_errs(errs):
        return {int(m.group(1)) - 1 for e in errs for m in [re.match(r"item (\d+):", e)] if m}

    opts = {}
    def verified(i):
        it = story["items"][i] if isinstance(story["items"][i], dict) else {}
        n = it.get("n", i) if isinstance(it.get("n"), int) and 0 <= it.get("n") < len(res["items"]) else i
        # v1.4.0: a READ that attributes ("Analysts say ...", research from before v1.4.0) is never spoken: the next verified
        # item whose read is direct takes the slot; if there is none the check refuses as before
        if attributed(res["items"][n]["sentiment"]):
            used = {x.get("n") for x in story["items"] if isinstance(x, dict)}
            n = next((k for k, rr in enumerate(res["items"]) if k not in used and not attributed(rr["sentiment"])), n)
        r = res["items"][n]; eb = it.get("sentences") if len(it.get("sentences") or []) == 2 else [{}, {}]
        story["items"][i] = {"n": n, "sentences": [
            {"eyebrow": (eb[0].get("eyebrow") or r["cover"].rstrip(".")).upper()[:26], "text": r["why"]},
            {"eyebrow": (eb[-1].get("eyebrow") or "THE READ").upper()[:26], "text": r["sentiment"]}]}
        opts[i] = (trims(r["why"]), trims(r["sentiment"]))
    for i, it in enumerate(story["items"]):
        if not isinstance(it, dict) or not isinstance(it.get("n"), int) or len(it.get("sentences") or []) != 2: verified(i)
    errs, words = check(story, res, facts, askc)
    bad = item_errs(errs)
    for i in bad - set(opts):
        if i < len(story["items"]): verified(i)
    pf = facts.get("portfolio", {})
    for k in ("title", "description"):              # second person in the metadata too
        story[k] = re.sub(r"\bI'm\b", "you're", re.sub(r"\b[Mm]y\b", lambda m: "Your" if m.group(0) == "My" else "your", story[k]))
    if any(e.startswith("portfolio") for e in errs):
        # a figure Home shows in the take: the day's move when the session has one, else the all-time gain
        home = ctx()["screen"].get("home", {}).get("figures", [])
        opts_p = []
        if pf.get("today"):
            moved = re.sub(r"^up\b", "rose", re.sub(r"^down\b", "fell", pf["today"]))
            opts_p.append({"preopen": f"Your portfolio {moved} yesterday.", "midday": f"Your portfolio is {pf['today']} so far today.",
                           "close": f"Your portfolio closed {pf['today']} today."}[ED])
        if pf.get("all_time"): opts_p.append(f"Your portfolio is up {pf['all_time']} all time.")
        # the day's gain exactly as Home shows it, when it is within the live tolerance of the cross-checked one
        allowed = allowed_figures(res, facts, askc)
        for f in home:
            if f.startswith(("+$", "-$", "\u2212$")) and norm(f) in allowed and ED in ("midday", "close"):
                d = "up" if f.startswith("+") else "down"
                amt = f.lstrip("+-\u2212")
                opts_p.append({"midday": f"Your portfolio is {d} {amt} so far today.", "close": f"Your portfolio closed {d} {amt} today."}[ED])
                break
        ok_p = [t for t in opts_p if all(shows(f, home) for f in nums(t))] or opts_p
        if ok_p: story["portfolio"]["text"] = ok_p[0]
    if any(e.startswith("ask answer") for e in errs):
        # the shortest visible answer line that carries a figure, quoted as it reads
        # a whole visible line, or (v1.1.0: long Ask bullets, 10/1 korea-close "Core AI chip stocks (...) total about
        # $151,900, roughly 58% of your $260,524 portfolio") its leading clauses up to a comma, each still the line's own words
        def quotes(t):
            p_ = plain_line(t); out = [p_]; parts = p_.rstrip(".").split(", ")
            for j in range(1, len(parts)): out.append(", ".join(parts[:j]) + ".")
            return [q for q in out if nums(q) and 4 <= len(q.split()) <= 13]
        cands = sorted([(len(q.split()), k, q) for k, r in enumerate(ctx()["lines"]) for q in quotes(r["text"])
                        if not re.search(r"\b(my|I|I'm)\b", r["text"])])
        for _, k, said in cands:                   # the first that passes its own checks
            for sym, nm in sorted(say_names(facts).items(), key=lambda x: -len(x[0])): said = re.sub(rf"\b{re.escape(sym)}\b", nm, said)
            story["ask"] = {"line": k, "answer_text": said}
            if not [e for e in check(copy.deepcopy(story), res, facts, askc)[0] if e.startswith("ask answer")]: break
    # the edition's timing phrase leads item 1 when no timing word is spoken; then the budget and the 15-word sentence
    # limit: cut the longest verified sentence at a clause until both fit
    s0 = story["items"][0]["sentences"][0]
    base0 = s0["text"]; lead = LEAD[ED] if not re.search(TIMING[ED]["need"], " ".join(
        [x["text"] for it in story["items"] for x in it["sentences"]] + [story["portfolio"]["text"], story["ask"]["answer_text"]]), re.I) else ""
    pick = {}
    def render():
        for i in opts: pick.setdefault(i, [0, 0])
        for i, o in opts.items():
            for j in (0, 1): story["items"][i]["sentences"][j]["text"] = o[j][pick[i][j]]
        t = story["items"][0]["sentences"][0]["text"] if 0 in opts else base0
        story["items"][0]["sentences"][0]["text"] = f"{lead} {t}" if lead else t
        return check(story, res, facts, askc)
    for _ in range(12):
        errs, words = render()
        long_ = [(len(o[j][pick[i][j]].split()), i, j) for i, o in opts.items() for j in (0, 1) if pick[i][j] < len(o[j]) - 1]
        over = words > BUDGET or any("sentence over 15 words" in e or "read aloud" in e for e in errs)
        if not over: break
        if not long_:                                    # only the model's own lines are left long: tell one with verified wording
            ln = lambda k: sum(len(x["text"].split()) for x in story["items"][k]["sentences"])
            short = lambda k: sum(len(x.split()) for x in (trims(res["items"][story["items"][k]["n"]]["why"])[-1], trims(res["items"][story["items"][k]["n"]]["sentiment"])[-1]))
            rest = [i for i in range(len(story["items"])) if i not in opts and short(i) < ln(i) - (3 if i == 0 and lead else 0)]
            if not rest: break
            verified(max(rest, key=lambda k: ln(k) - short(k))); continue
        _, i, j = max(long_); pick[i][j] += 1
    if lead and (words > BUDGET or any("read aloud" in e for e in errs)):
        lead = LEAD_SHORT[ED]; errs, words = render()
    # covers / title / description that state a direction the screen does not show: the news, neutrally
    if any(e.startswith(("cover:", "title:", "description:")) for e in errs):
        nm = [re.sub(r"\s+\w+\.?$", "", res["items"][it["n"]]["cover"]).strip() for it in story["items"][:3]]
        story["cover"] = [f"{n} in focus." for n in nm]
        story["title"] = short_title([f"{n} in focus." for n in nm])
        story["description"] = " ".join(res["items"][it["n"]]["why"].rstrip(".") + "." for it in story["items"][:3]) + " " + story["portfolio"]["text"]
        errs, words = render()
    log(f"storyline fallback (verified wording for items {sorted(x + 1 for x in opts)}): {words} words, {len(errs)} problems {errs[:4]}")
    return story, errs, words


KR_GUIDE = ("" if not KR else f"""THE KOREA EDITION (v1.1.0, owner 10/1): for US investors with an AI-heavy portfolio, MID-TO-LONG TERM, never day to day.
  Each story page is filmed on the app's {KRM.RANGE[ED]} chart: its header reads "Price · {KRM.RANGE[ED]}" and the {KRM.RANGE[ED]} change. Lead
  each Korean item with that window ('{KRM.WIN_PHRASE[KRM.RANGE[ED]]}') and its WHY{" (YTD figures are long to say: at most ONE, in item 1, and only if the budget allows; 'rose this year' without a figure is fine)" if ED == "korea-midday" else " (the figure in item 1; later items may name the window without one)"}; the session move in
  Seoul is secondary ('{"closed up 3.2% in Seoul" if ED == "korea-close" else "is up 1.1% so far in Seoul"}'). A US name's move is its last
  New York session. Say the names as people do: "SK hynix", "Samsung", "Hanmi" (the full names cost words the 30 s does not have). Each read
  is a direct, concrete FACT in our own voice ("Memory prices rose for a third straight quarter."), never attributed to others
  ("Analysts expect ...", "Commentators call it cheap." are refused) and never an opinion stated as fact. The portfolio line is the
  all-time gain Home shows ("Your portfolio is up 18% all time."): never a 'today' figure (Home's Today mixes the US and Korean
  sessions). Never what to do, never a forecast for the US open: context ("Micron's results show the same memory demand.").
  Examples of the density wanted (style only, not facts):
    "SK hynix fell 28.4% over three months as foreign funds sold Korean chips. <a verified fact: what comes next, with its date>."
    "Micron posted record revenue on AI memory demand. <a verified fact: its scale or its driver>."
""")


def main():
    res = jload(os.path.join(W, "research.json")); facts = jload(os.path.join(W, "facts.json")); askc = jload(os.path.join(W, "ask-check.json"))
    n_items = 3                     # three items fit 30 s with the portfolio and Ask beats at a natural pace
    with Stage(W, "storyline.llm"):
        sys_p = ("You write the voice-over for a 25-second YouTube Short for general retail investors, for the Assetly app. "
                 "Plain, warm, specific, never hype. Every claim comes from the facts given.")
        # v1.4.0: an attributed read (research from before v1.4.0) is an opinion: "read" is null, never restated as fact
        base = f"""Edition: {LABEL[ED]} ({ED}). Tense rules: {json.dumps(TIMING[ED])} ("need": use at least one; "never": never use).

VERIFIED MARKET ITEMS (ranked; each WHY and READ is already backed by two publishers; reuse their wording closely):
{json.dumps([{"n": i, "kind": it["kind"], "symbols": it["symbols"], "cover": it["cover"], "why": it["why"],
              "read": None if attributed(it["sentiment"]) else it["sentiment"],
              "figures": [{"symbol": f["symbol"], "pct": f["value"]} for f in it.get("figures", [])]} for i, it in enumerate(res["items"])], indent=0)}
Company names to say (never tickers; letters only where shown, like IBM): {json.dumps(say_names(facts))}

THE PORTFOLIO (the app's own numbers; the narration calls it "Your portfolio", never "my"): {json.dumps(facts["portfolio"])}
{"BEFORE THE OPEN the portfolio's 'today' figure is the PREVIOUS session: say 'yesterday' (or the weekday), never 'today'." if ED == "preopen" else ""}
ON SCREEN (read off the recorded take; every figure you speak during a shot must be one the viewer can read in it):
  each item's shot: {json.dumps({str(i): item_shot(it)[1] for i, it in enumerate(res["items"])})}
  the portfolio line plays over Home, which shows: {json.dumps(ctx()["screen"].get("home", {}).get("figures", []))}
FRESH EXTENDED-HOURS QUOTES (two feeds agree; the edit draws a labelled chip with this value and time next to the shot):
  {json.dumps({s: {"label": v["label"], "pct": round(v["pct"], 2), "asof": v["asof"]} for s, v in ctx()["ext"].items()}) or "none: speak only what the app shows"}
  To use one, say it with its label word in the same sentence ("IBM rose 5.8% premarket ..."); never say premarket / after
  hours without one of these.
THE ASK BEAT: the question typed on camera: {askc['question']!r}. The answer lines VISIBLE in the recorded shot (numbered):
{json.dumps({i: r["text"] for i, r in enumerate(ctx()["lines"])}, indent=0)}
The spoken answer quotes ONE of these lines or paraphrases it closely, with exactly its figures; the edit highlights it.

{KR_GUIDE if KR else ""}
THE APPROVED STYLE (the 9/30 Short, v1.4.0 direct reads; match its density and tone, not its facts):
  "Micron beat on AI memory demand, yet barely moved after hours. <a verified fact: its scale, e.g. a record>."
  "Google's Gemini 4 beat rivals on most tests, but few can use it yet. Shares jumped over 3%, then closed up 0.9%."
  "Meta slipped 1.8% as OpenAI launched a Muse rival. <a verified fact: what it means or what comes next, with a date>."
  (<...> marks where the item's own verified READ goes; never copy an example's facts. An item whose "read" is null has no
  usable read: write sentence 2 from its WHY's facts or the move its page shows, never from an opinion.)
HOOK (Shorts practice: viewers decide in the first 1-2 s): item 1 is the most surprising verified fact, usually the biggest
verified move or the most unexpected news, and the cover's first line is item 1. Lead with the fact itself, never a
teaser, a question, "you won't believe" or a greeting. The Short ends on the real answer (no sign-off line: the end card
carries the follow line).
Each item: sentence 1 names the company, what happened AND the cause, with a figure when one is verified (an upcoming event,
like a report or a data release, needs no cause: say what and when); sentence 2 is the
READ, said directly in our own voice as a confident, factual sentence: the scale (only a verified record or "biggest since"),
the driver, what it means, or what comes next with its date. Never attribute it ("Analysts / Commentators / Investors say, see,
call, cite ..." is refused), never an opinion or forecast stated as fact, never advice. Eyebrows are short:
"HPE · RECORD", "MICRON · THE READ" (<= 26 characters).

Write JSON:
{{"items": [ {n_items} entries, the most useful for this edition, AI-focused but not only AI, in this shape:
   {{"n": <item n>, "sentences": [{{"eyebrow": "MICRON · AFTER THE BELL", "text": "<what happened and WHY, <= 13 words>"}},
                                  {{"eyebrow": "MICRON · THE READ", "text": "<the direct read: a verified fact in our own voice, <= 8 words>"}}]}} ],
 "portfolio": {{"eyebrow": "YOUR PORTFOLIO", "text": "<one sentence, <= 12 words, a TRUE note from the portfolio numbers Home shows: lean
               positive if the numbers allow, e.g. 'Your portfolio is up 28% all time.'>"}},
 "ask": {{"line": <the number of the visible answer line you quote>, "answer_text": "<<= 13 words: that line quoted or closely
         paraphrased in plain spoken words, its own figures only, no + or - signs, no 'I' / 'my'>"}},
 "cover": ["Micron beats.", "HPE hits a record.", "Stocks end mixed."]   (one per item, in order; short name first; <= 24 chars),
 "title": "<= 50 chars, short and catchy, the hook only: NO edition label (Midday / After the bell) and NO date, e.g. 'Micron pops, Boeing lands $20B' or 'Accenture's record day lifts IBM'; lead with the most surprising verified fact and
           name the company (people search by name); no hashtags, no question bait, no ALL CAPS, every claim true",
 "description": "<two plain sentences with the verified figures, second person ('your portfolio'), no advice>",
 "hashtags": ["#Shorts", "#Accenture", "#IBM", "#stockmarket"]   (3-5 total: #Shorts, the stories' companies, one niche tag; never #viral / #fyp)}}
Budget: at most {{budget}} spoken words in total (the question adds {len(askc['question'].split())} more).
Percentages with ONE decimal ("3.7%", never "3.71%"). The cover reads as plain English ("HPE hits a record.", never
"Hewlett Packard record."). The Ask answer line must add something the portfolio line did not say, never repeat it.
Second person throughout: "Your portfolio", never "my portfolio", "I'm" or "we".
A portfolio figure carries the window Home labels it with ("up 28% all time", "up $3,965 today").
Covers, title and description describe the NEWS ("IBM launches AI platform."), never a price direction the item's page
does not show (no "rallies / climbs / gains" before the open unless a chip shows the move).
A line about the whole market names its index ("The S&P 500 slipped 0.4%"), never a bare "Stocks slipped", and only
with a figure from the verified items; never contradict the portfolio or Ask lines on screen.
Never say when the news happened (overnight, this morning, yesterday) unless the sources' times show it; "Before the bell,"
is about our time and always fine.
Figures: write them as digits ("1.8%", "$1.2 billion"), only from the verified items, the portfolio, or the verified answer figures.
No advice or hype words, no jargon (thesis, tape, book, print, catalyst, guidance, capex, swing factor, narrative, cost curve),
sentence 2 never restates sentence 1 (no second "shares rose" line), no em dashes, no tickers, never "demo"."""
        budget = BUDGET - len(askc["question"].split())
        prompt = base.replace("{budget}", str(budget))
        # a tighten pass (run.sh after a build over 30 s) starts from the story that passed every check: cutting a few words
        # from it converges in a round, a fresh draft at a lower budget often did not (10/1 korea-close test: 8 rounds, refused)
        prev = jload(os.path.join(W, "story.json"), {}) or {}
        if os.environ.get("SHORTS_BUDGET") and prev.get("items") and not prev.get("_errors"):
            pw = prev.get("_words") or 0
            prompt += ("\n\nYOUR LAST DRAFT (it passed every check, but the video ran over 30 seconds):\n" +
                       json.dumps({k: v for k, v in prev.items() if not k.startswith("_")}) +
                       f"\nCUT IT to at most {budget} spoken words (it has {pw}): shorten the longest sentences, drop a clause or a "
                       "figure; keep every remaining fact and figure exactly; change nothing else.")
        story, errs, words, best = None, ["not run"], 0, None
        t0, rounds = time.time(), int(os.environ.get("SHORTS_STORY_ROUNDS", STORY_ROUNDS))
        for rnd in range(rounds):
            left = STORY_CAP_S - (time.time() - t0)
            if rnd and left < 50:                        # a round takes 20-45 s: do not start one the cap would cut off
                log(f"storyline: {STORY_CAP_S}s cap reached after {rnd} rounds"); break
            try:
                story = llm(W, sys_p, prompt, max_tokens=16000, temperature=0.4, timeout=max(40, min(150, int(left))),
                            prefer=os.environ.get("SHORTS_STORY_MODEL", "openrouter"))   # M3 reasons long: 8000 truncated its JSON
            except RuntimeError as e:
                log(f"storyline round {rnd + 1}: no draft ({str(e)[:120]})"); continue
            if "items" not in story:                     # a reply wrapped in one key ({"story": {...}}, seen on tighten rounds)
                inner = [v for v in story.values() if isinstance(v, dict) and "items" in v]
                if inner: story = {**inner[0], "_model": story.get("_model")}
            story["_budget"] = BUDGET
            try:
                errs, words = check(story, res, facts, askc)
            except Exception as e:                       # noqa: BLE001  (a malformed shape is a failed round)
                errs, words = [f"malformed: {e}"], 0
            log(f"storyline round {rnd + 1} ({time.time() - t0:.0f}s): {words} words, {len(errs)} problems {errs[:6]}")
            if not errs and os.environ.get("SHORTS_JUDGE", "1" if KR else "0") != "0":   # Korea editions first (10/2)
                errs = judge(story, res, askc)
                log(f"storyline judge: {len(errs)} problems {errs[:4]}")
                if errs: story["_judged"] = errs
            if not errs:
                break
            if best is None or len(errs) <= len(best[1]) and not errs[0].startswith("malformed"):
                best = (copy.deepcopy(story), errs)
            prompt = base.replace("{budget}", str(budget)) + "\n\nYOUR LAST DRAFT:\n" + json.dumps({k: v for k, v in story.items() if not k.startswith("_")}) + \
                "\nREWRITE IT. Keep every line that is not named below word for word; change only these, exactly as instructed:\n- " + \
                "\n- ".join(errs)
        if errs:
            if best: story = best[0]
            try:
                story, errs, words = fallback(story, res, facts, askc)
                # 10/1 midday: the fallback's verified wording itself failed an item (a figure its shot does not show). An
                # item that still fails is swapped for the next verified research item, told in verified wording, until
                # only non-item problems remain or the research list runs out; the run refuses only after that.
                tried = {it.get("n") for it in story.get("items", []) if isinstance(it, dict)}
                for _ in range(6):
                    bad = sorted({int(m.group(1)) - 1 for e in errs for m in [re.match(r"item (\d+):", e)] if m})
                    spare = [i for i in range(len(res["items"])) if i not in tried]
                    if bad and not spare:
                        # no spare item (10/1 close: research kept three, item 1 said "barely budged" on a verified +3.03%):
                        # tell a direction-wrong item with the verified figure instead of refusing
                        fixed = False
                        for e in errs:
                            m_d = re.match(r"item (\d+): says (?:flat|up|down), the verified move is ([+-][\d.]+)%", e)
                            if not m_d: continue
                            k, v = int(m_d.group(1)) - 1, float(m_d.group(2))
                            it = story["items"][k]; r = res["items"][it.get("n", k)]
                            s1 = re.split(r",? (?:but|yet|though|while)\b", r["why"].rstrip("."))[0].strip() + "."
                            s2 = f"Shares {'rose' if v > 0 else 'fell'} {abs(v):.1f}% today."
                            # the fallback re-tells failing items from the research wording: correct that wording itself
                            r["why"], r["sentiment"] = s1, s2
                            r["cover"] = re.sub(r"\s+\w+\.?$", "", r["cover"]).strip() + (" rises." if v > 0 else " falls.")
                            ebs = it.get("sentences") or [{}, {}]
                            it["sentences"] = [{"eyebrow": (ebs[0] or {}).get("eyebrow", r["cover"].rstrip(".").upper()[:26]), "text": s1},
                                               {"eyebrow": (ebs[-1] or {}).get("eyebrow", "THE MOVE"), "text": s2}]
                            fixed = True
                        if fixed:
                            for key in ("cover", "title", "description"): story.pop(key, None)
                            story, errs, words = fallback(story, res, facts, askc)
                            log(f"storyline fallback told direction-wrong item(s) with the verified move: {len(errs)} problems {errs[:4]}")
                        break
                    if not bad or not spare: break
                    for k in bad:
                        if not spare or k >= len(story["items"]): continue
                        n = spare.pop(0); tried.add(n); story["items"][k] = {"n": n}
                    for key in ("cover", "title", "description"): story.pop(key, None)
                    story, errs, words = fallback(story, res, facts, askc)
                    log(f"storyline fallback swapped item(s) {[b + 1 for b in bad]}: {len(errs)} problems {errs[:4]}")
            except Exception as e:                       # noqa: BLE001
                errs = errs + [f"fallback failed: {e}"]; story = story if isinstance(story, dict) else {}
        story["_errors"] = errs; story["_words"] = words
        jdump(story, os.path.join(W, "story.json"))
        if errs:
            sys.exit("REFUSE: storyline failed its checks: " + "; ".join(errs[:6]))


if __name__ == "__main__":
    main()
