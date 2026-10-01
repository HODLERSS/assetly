#!/usr/bin/env python3
"""Stage 6, the storyline: the words, written by the LLM from verified facts only, then checked in code.

    storyline.py <edition> <work-dir>

Inputs: research.json (verified items), facts.json (portfolio figures the app shows, cross-checked), ask.json +
ask-check.json (the real answer and its verified figures). The model writes: the cover (3 headline lines), one line
per market item (sentence 1 = what happened and WHY, sentence 2 = the attributed market/community READ), the
portfolio line, the Ask answer line, and the YouTube title/description. Code then refuses anything that breaks the
rules: a figure not in the verified set, advice/hype/jargon words, em dashes, "demo", tickers, edition-wrong timing
words, more than 14 words in a sentence, or more than the word budget (the Short must end by 30.0 s). Failures go
back to the model with the reasons (3 rounds), then the stage fails.

Writes <work>/story.json.
"""
import copy, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, jdump, jload, llm, log

ED, W = sys.argv[1], sys.argv[2]
BAN = re.compile(r"\b(buy|sell|should|must-own|recommend|guaranteed|skyrocket\w*|soar\w*|explod\w*|moon|crush\w*|massive|insane|huge|"
                 r"don't miss|act now|best stock|secret|bagger|yolo|alpha|beta|eps|p/e|guidance|bps|basis points|multiples?|catalysts?|"
                 r"thesis|tape|tripwire|setup|capex|tam|book|print|prints|demo|demonstration|swing factors?|narratives?|cost curves?)\b", re.I)
TIMING = {"preopen": {"need": r"\b(this morning|before the bell|premarket|pre-market|futures|today|overnight|ahead of the open)\b",
                      "never": r"\b(closed (?:up|down|at|higher|lower)|after the bell|today's close|so far today|this afternoon)\b"},
          "midday": {"need": r"\b(so far|midday|this afternoon|right now|today)\b",
                     "never": r"\b(closed (?:up|down|at|higher|lower)|today's close|before the bell|this morning's open|futures point)\b"},
          "close": {"need": r"\b(closed|today|after the bell|after hours|on the day|at the close)\b",
                    "never": r"\b(so far today|this morning|before the bell|futures point|this afternoon|right now)\b"}}
# names and terms said as letters or as a word: = narrate/ear.ts SPOKEN_CAPS (earAudit's allowlist) + AT&T
SPOKEN_CAPS = {"AI", "US", "UK", "EU", "CEO", "CFO", "ETF", "ETFs", "VIX", "AMD", "IBM", "HP", "NASA", "FDA", "SEC", "FTC", "DOJ",
               "GDP", "CPI", "PCE", "PPI", "IPO", "EV", "EVs", "OPEC", "NATO", "OK", "TV", "NVIDIA", "SK", "AM", "PM", "IBK", "KOSPI"}
LEAD = {"preopen": "Before the bell,", "midday": "At midday,", "close": "At the close,"}   # the fallback's timing phrase
LEAD_SHORT = {"preopen": "Premarket,", "midday": "Midday,", "close": "Today,"}           # ... when the budget is tight
STORY_CAP_S, STORY_ROUNDS = 360, 8                     # storyline rounds: at most 8, inside 6 minutes
SPOKEN_MAX = 68                                        # words as voiced (speakable): 66-68 made 26-27 s, 73 made 30.3 s
LABEL = {"preopen": "BEFORE THE BELL", "midday": "MIDDAY", "close": "MARKET CLOSE"}


def nums(text):
    """Figures a viewer reads: 1.8%, $1,234, 3.9, 52-week (ignored), Q4 (ignored), 11-fold (kept as 11)."""
    t = re.sub(r"\b(?:52|fifty-two)-week\b|\bQ[1-4]\b|\b(?:19|20)\d{2}\b|\bS&P 500\b|\bNasdaq 100\b|\bGemini \d\b|\b\d{1,2}:\d{2}\b", " ", text)
    return [m.group(0) for m in re.finditer(r"[$]?\d[\d,]*(?:\.\d+)?(?:%| ?(?:billion|million|trillion))?", t)]


def allowed_figures(res, facts, askc):
    out = set()
    def add_pct(v):
        if v is None: return
        a = abs(float(v))
        for s in {f"{a:.1f}", f"{a:.2f}", f"{round(a)}" if a >= 10 else f"{a:.1f}"}:
            out.add(s.rstrip("0").rstrip(".") if "." in s else s)
    for it in res["items"]:
        for f in it.get("figures", []): add_pct(f.get("value"))
        for m in re.finditer(r"\$?\d[\d,]*(?:\.\d+)?(?: ?(?:billion|million))?", it.get("why", "") + " " + it.get("sentiment", "")):
            out.add(norm(m.group(0)))          # a figure the two cited headlines state ("$1.2 billion", "11-fold")
    for k, v in facts.get("figures", {}).items(): out.add(norm(v))
    for v in askc.get("verified", []): out.add(norm(v))
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
premarket pre-market overnight futures midday morning yesterday bell open opening ahead""".split())


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


def short_name(n):
    """The name people say (= facts.short_name): "Accenture PLC" -> "Accenture"."""
    n = re.sub(r"\s*(?:Common Stock|Class [A-C]( Common Stock)?|Ordinary Shares|American Depositary Shares)\b.*$", "", str(n or ""))
    for _ in range(2):
        n = re.sub(r",?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Holdings?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|Group|Technologies|Technology|Platforms)$", "", n.strip())
    return n.strip()


def say_names(facts):
    """Ticker -> the name the voice says: the letters when people say them (IBM, AMD), else the short name."""
    return {k: (k if k in SPOKEN_CAPS else short_name(v)) for k, v in facts.get("names", {}).items()}


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
        sign = next((f["value"] for f in r.get("figures", []) if f.get("symbol") in r.get("symbols", [])), None)
        for x in it["sentences"]:
            if sign is not None and not re.search(r"after[- ]hours|premarket|pre-market", x["text"], re.I):
                if abs(sign) >= 1.0 and re.search(r"\b(flat|barely|little (?:reaction|movement|changed?)|unmoved|muted)\b", x["text"], re.I):
                    errs.append(f"item {i + 1}: says flat, the verified move is {sign:+.2f}%")
                if sign < 0 and re.search(r"\b(rose|gained|jumped|climbed|rallied|higher)\b", x["text"], re.I): errs.append(f"item {i + 1}: says up, the verified move is {sign:+.2f}%")
                if sign > 0 and re.search(r"\b(fell|dropped|slid|slipped|declined|sank|lower)\b", x["text"], re.I) and not re.search(r"\b(despite|but|after)\b", x["text"], re.I):
                    errs.append(f"item {i + 1}: says down, the verified move is {sign:+.2f}%")
            names = unsupported_names(x["text"], corpus)
            miss = [w for w in unsupported_words(x["text"], corpus) if w not in names]
            if names or len(miss) > 1 or (miss and len(x["text"].split()) < 5):
                errs.append(f"item {i + 1}: words the verified sources never say: {names + miss} in {x['text']!r} "
                            f"-> rewrite it with the item's own wording (WHY: {r['why']!r}; READ: {r['sentiment']!r})")
    allowed = allowed_figures(res, facts, askc)
    sents = [(f"item {i + 1}", s["text"]) for i, it in enumerate(story["items"]) for s in it["sentences"]]
    sents += [("portfolio", story["portfolio"]["text"]), ("ask answer", story["ask"]["answer_text"])]
    words = sum(len(t.split()) for _, t in sents) + len(askc["question"].split())
    if words > story.get("_budget", 56):
        longest = max(sents, key=lambda x: len(x[1].split()))
        errs.append(f"{words} spoken words, budget {story.get('_budget', 56)}: cut at least {words - story.get('_budget', 56)} words "
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
        longest = max(zip(sents, audits), key=lambda x: x[1][1])
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
                        f"attributed read, e.g. {r['sentiment']!r} shortened")
        elif not re.search(r"\b(analysts?|commentators?|investors?|traders?|shares|the stock|markets?|economists?|strategists?|wall street|critics|fans|users|observers|futures|policymakers|officials|fed|bond traders|yields|economists|the market)\b",
                           it["sentences"][1]["text"], re.I):
            errs.append(f"item {i + 1}: the second sentence must be the attributed read (analysts/investors/traders/shares...)")
    for it in story["items"]:
        for x in it["sentences"]:
            if len(x["eyebrow"]) > 26: errs.append(f"eyebrow {x['eyebrow']!r} over 26 characters (use the short name)")
    pt, at = story["portfolio"]["text"], story["ask"]["answer_text"]
    if "portfolio" not in pt.lower() or len(pt.split()) < 5: errs.append(f"portfolio: a full sentence that names 'My portfolio' (got {pt!r}) -> write it as "
                                                                               f"'My portfolio <moved> <figure> <when>.' in 5-8 words, e.g. 'My portfolio closed up 0.8% today.'")
    if len(at.split()) < 4 or (ED != "preopen" and not re.search(r"\b(up|down|flat|gained|lost|rose|fell)\b", at, re.I)):
        errs.append(f"ask answer: a full spoken sentence with the direction words (up / down / flat), got {at!r} -> "
                    f"e.g. 'Up 3.8% this month and 31% over the year.' (4-13 words, verified figures only)")
    for where, t in sents:
        for m in re.finditer(r"\d+\.\d{2,}%", t): errs.append(f"{where}: {m.group(0)}: one decimal for percentages")
    if len(story["title"]) > 70: errs.append(f"title is {len(story['title'])} chars (max 70)")
    if len(story["cover"]) != 3: errs.append("cover needs exactly 3 lines")
    # the accent bracket is code's job: the leading name (one word, or two when the second is capitalised)
    # the accent bracket is code's job: the leading name (one word, or two when the second is capitalised)
    story["cover"] = [re.sub(r"\s*:\s*", " ", c.replace("[", "").replace("]", "")).strip() for c in story["cover"]]
    story["cover"] = [c if c.endswith(".") else c + "." for c in story["cover"]]
    story["cover"] = [re.sub(r"^((?:[A-Z][\w&'.-]*)(?: [A-Z][\w&'.-]*)?)", r"[\1]", c, count=1) for c in story["cover"]]
    for c in story["cover"]:
        if len(c) > 30 or " " not in c: errs.append(f"cover line {c!r}: 'Name verb.' with a short name, <= 28 chars")
    return errs, words


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
    story.setdefault("title", f"{LABEL[ED].title()}: " + ", ".join(res["items"][it.get("n", 0)]["cover"].rstrip(".") for it in story["items"][:3])[:60])
    story.setdefault("description", " ".join(res["items"][it.get("n", 0)]["why"] for it in story["items"][:3]))
    story.setdefault("hashtags", ["#Shorts", "#stockmarket"]); story["_budget"] = 56

    def trims(t):
        """The sentence, then shorter versions cut at a clause boundary (each still a verified claim, just less of it)."""
        t = t.strip().rstrip(".") ; out = [t]
        for sep in (", ", " and ", " with ", " as ", " after ", " on "):
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
    if any(e.startswith("portfolio") for e in errs) and pf.get("today"):
        moved = re.sub(r"^up\b", "rose", re.sub(r"^down\b", "fell", pf["today"]))
        story["portfolio"]["text"] = {"preopen": f"My portfolio {moved} yesterday.", "midday": f"My portfolio is {pf['today']} so far today.",
                                      "close": f"My portfolio closed {pf['today']} today."}[ED]
    if any(e.startswith("ask answer") for e in errs):
        win = next(((w, pf[w]) for w in ("month", "week") if pf.get(w)), None)
        if win: story["ask"]["answer_text"] = f"{win[1][0].upper() + win[1][1:]} this {win[0]}."
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
        over = words > 56 or any("sentence over 15 words" in e or "read aloud" in e for e in errs)
        if not over: break
        if not long_:                                    # only the model's own lines are left long: tell one with verified wording
            ln = lambda k: sum(len(x["text"].split()) for x in story["items"][k]["sentences"])
            short = lambda k: sum(len(x.split()) for x in (trims(res["items"][story["items"][k]["n"]]["why"])[-1], trims(res["items"][story["items"][k]["n"]]["sentiment"])[-1]))
            rest = [i for i in range(len(story["items"])) if i not in opts and short(i) < ln(i) - (3 if i == 0 and lead else 0)]
            if not rest: break
            verified(max(rest, key=lambda k: ln(k) - short(k))); continue
        _, i, j = max(long_); pick[i][j] += 1
    if lead and (words > 56 or any("read aloud" in e for e in errs)):
        lead = LEAD_SHORT[ED]; errs, words = render()
    log(f"storyline fallback (verified wording for items {sorted(x + 1 for x in opts)}): {words} words, {len(errs)} problems {errs[:4]}")
    return story, errs, words


def main():
    res = jload(os.path.join(W, "research.json")); facts = jload(os.path.join(W, "facts.json")); askc = jload(os.path.join(W, "ask-check.json"))
    n_items = 3                     # three items fit 30 s with the portfolio and Ask beats at a natural pace
    with Stage(W, "storyline.llm"):
        sys_p = ("You write the voice-over for a 25-second YouTube Short for general retail investors, for the Assetly app. "
                 "Plain, warm, specific, never hype. Every claim comes from the facts given.")
        base = f"""Edition: {LABEL[ED]} ({ED}). Tense rules: {json.dumps(TIMING[ED])} ("need": use at least one; "never": never use).

VERIFIED MARKET ITEMS (ranked; each WHY and READ is already backed by two publishers; reuse their wording closely):
{json.dumps([{"n": i, "kind": it["kind"], "symbols": it["symbols"], "cover": it["cover"], "why": it["why"], "read": it["sentiment"],
              "figures": [{"symbol": f["symbol"], "pct": f["value"]} for f in it.get("figures", [])]} for i, it in enumerate(res["items"])], indent=0)}
Company names to say (never tickers; letters only where shown, like IBM): {json.dumps(say_names(facts))}

THE PORTFOLIO ON SCREEN (the app's own numbers; this is "My portfolio"): {json.dumps(facts["portfolio"])}
{"BEFORE THE OPEN the portfolio's 'today' figure is the PREVIOUS session: say 'yesterday' (or the weekday), never 'today'." if ED == "preopen" else ""}
THE ASK BEAT: the question typed on camera: {askc['question']!r}. The app's real answer (verified figures: {askc['verified']}):
{askc['answer'][:900]}

THE APPROVED STYLE (the 9/30 Short; match its density and tone, not its facts):
  "Micron beat on AI memory demand, yet barely moved after hours. Commentators say it was priced in."
  "Google's Gemini 4 beat rivals on most tests, but few can use it yet. Shares jumped over 3%, then closed up 0.9%."
  "Meta slipped 1.8% as OpenAI launched a Muse rival. Analysts still back Muse."
Each item: sentence 1 names the company, what happened AND the cause, with a figure when one is verified (an upcoming event,
like a report or a data release, needs no cause: say what and when); sentence 2 is the
read, starting with who holds it (Analysts / Commentators / Investors / Traders / Shares ...). Eyebrows are short:
"HPE · RECORD", "MICRON · THE READ" (<= 26 characters).

Write JSON:
{{"items": [ {n_items} entries, the most useful for this edition, AI-focused but not only AI, in this shape:
   {{"n": <item n>, "sentences": [{{"eyebrow": "MICRON · AFTER THE BELL", "text": "<what happened and WHY, <= 13 words>"}},
                                  {{"eyebrow": "MICRON · THE READ", "text": "<the attributed read or reaction, <= 8 words>"}}]}} ],
 "portfolio": {{"eyebrow": "MY PORTFOLIO", "text": "<one sentence, <= 12 words, a TRUE note from the portfolio numbers: lean positive if the
               numbers allow (today, all time, or a holding's gain), e.g. 'My portfolio closed up 0.8% today.'>"}},
 "ask": {{"answer_text": "<<= 13 words: the answer's key point in plain spoken words ('Up 3.8% this month and 31.2% over the year.'),
         ONLY figures from the verified list, no + or - signs>"}},
 "cover": ["Micron beats.", "HPE hits a record.", "Stocks end mixed."]   (one per item, in order; short name first; <= 24 chars),
 "title": "<= 70 chars, e.g. '{LABEL[ED].title()}: Micron beats, HPE record, AppLovin slides | Sep 30'",
 "description": "<two plain sentences with the verified figures, no advice>",
 "hashtags": ["#Shorts", "#stockmarket", ...5-8 total, include the companies]}}
Budget: at most {{budget}} spoken words in total (the question adds {len(askc['question'].split())} more).
Percentages with ONE decimal ("3.7%", never "3.71%"). The cover reads as plain English ("HPE hits a record.", never
"Hewlett Packard record."). The Ask answer line must add something the portfolio line did not say (the week, the month,
the biggest mover), never repeat it.
Figures: write them as digits ("1.8%", "$1.2 billion"), only from the verified items, the portfolio, or the verified answer figures.
No advice or hype words, no jargon (thesis, tape, book, print, catalyst, guidance, capex, swing factor, narrative, cost curve),
sentence 2 never restates sentence 1 (no second "shares rose" line), no em dashes, no tickers, never "demo"."""
        budget = 56 - len(askc["question"].split())
        prompt = base.replace("{budget}", str(budget))
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
            story["_budget"] = 56
            try:
                errs, words = check(story, res, facts, askc)
            except Exception as e:                       # noqa: BLE001  (a malformed shape is a failed round)
                errs, words = [f"malformed: {e}"], 0
            log(f"storyline round {rnd + 1} ({time.time() - t0:.0f}s): {words} words, {len(errs)} problems {errs[:6]}")
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
            except Exception as e:                       # noqa: BLE001
                errs = errs + [f"fallback failed: {e}"]; story = story if isinstance(story, dict) else {}
        story["_errors"] = errs; story["_words"] = words
        jdump(story, os.path.join(W, "story.json"))
        if errs:
            sys.exit("REFUSE: storyline failed its checks: " + "; ".join(errs[:6]))


if __name__ == "__main__":
    main()
