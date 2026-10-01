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
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, jdump, jload, llm, log

ED, W = sys.argv[1], sys.argv[2]
BAN = re.compile(r"\b(buy|sell|should|must-own|recommend|guaranteed|skyrocket\w*|soar\w*|explod\w*|moon|crush\w*|massive|insane|huge|"
                 r"don't miss|act now|best stock|secret|bagger|yolo|alpha|beta|eps|p/e|guidance|bps|basis points|multiples?|catalysts?|"
                 r"thesis|tape|tripwire|setup|capex|tam|book|print|prints|demo|demonstration)\b", re.I)
TIMING = {"preopen": {"need": r"\b(this morning|before the bell|premarket|pre-market|futures|today|overnight|ahead of the open)\b",
                      "never": r"\b(closed (?:up|down|at|higher|lower)|after the bell|today's close|so far today|this afternoon)\b"},
          "midday": {"need": r"\b(so far|midday|this afternoon|right now|today)\b",
                     "never": r"\b(closed (?:up|down|at|higher|lower)|today's close|before the bell|this morning's open|futures point)\b"},
          "close": {"need": r"\b(closed|today|after the bell|after hours|on the day)\b",
                    "never": r"\b(so far today|this morning|before the bell|futures point|this afternoon|right now)\b"}}
TICKER_OK = {"AI", "US", "UK", "EU", "CEO", "ETF", "VIX", "AMD", "OK", "TV", "NVIDIA", "SK", "AM", "PM", "KOSPI", "S&P", "AMD's"}   # = narrate/ear.ts earAudit allowlist
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
jumped jumps climbed climbs edged eased ended ending finished moved higher lower""".split())


def unsupported_words(text, corpus):
    """Content words of a spoken sentence the item's verified text and cited headlines never use (5-letter stems)."""
    stem = lambda w: re.sub(r"[^a-z]", "", w.lower())[:5]
    have = {stem(w) for w in re.findall(r"[A-Za-z][A-Za-z'-]+", corpus)}
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]+", text) if len(w) >= 4 and w.lower() not in STOP]
    return [w for w in words if stem(w) not in have]


def ear_audit(lines):
    """The product's own speakable() + earAudit() on every line that will be voiced (make-short refuses a line it flags)."""
    import subprocess
    from lib import APP
    ts = os.path.join(W, "ear_check.ts")
    open(ts, "w").write(f'''import {{ speakable, earAudit }} from "{APP}/supabase/functions/narrate/ear.ts";
const lines: string[] = JSON.parse(await new Response(Deno.stdin.readable).text());
console.log(JSON.stringify(lines.map((l) => earAudit(speakable(l)))));''')
    r = subprocess.run(["npx", "-y", "deno@2", "run", "-A", ts], input=json.dumps(lines), capture_output=True, text=True, timeout=120)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:                                    # noqa: BLE001
        return [[f"ear check did not run: {r.stderr[-200:]}"]] 


def check(story, res, facts, askc):
    errs = []
    heads = {h["id"]: h for h in jload(os.path.join(W, "research-data.json"))["headlines"]}
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
                if sign < 0 and re.search(r"\b(rose|gained|jumped|climbed|rallied|higher)\b", x["text"], re.I): errs.append(f"item {i + 1}: says up, the verified move is {sign:+.2f}%")
                if sign > 0 and re.search(r"\b(fell|dropped|slid|slipped|declined|sank|lower)\b", x["text"], re.I) and not re.search(r"\b(despite|but|after)\b", x["text"], re.I):
                    errs.append(f"item {i + 1}: says down, the verified move is {sign:+.2f}%")
            miss = unsupported_words(x["text"], corpus)
            if len(miss) > 1 or (miss and len(x["text"].split()) < 5):
                errs.append(f"item {i + 1}: words the verified sources never say: {miss} in {x['text']!r} (stay with the item's WHY and READ)")
    allowed = allowed_figures(res, facts, askc)
    sents = [(f"item {i + 1}", s["text"]) for i, it in enumerate(story["items"]) for s in it["sentences"]]
    sents += [("portfolio", story["portfolio"]["text"]), ("ask answer", story["ask"]["answer_text"])]
    words = sum(len(t.split()) for _, t in sents) + len(askc["question"].split())
    if words > story.get("_budget", 56): errs.append(f"{words} spoken words, budget {story.get('_budget', 56)}: shorten")
    if not 3 <= len(story["items"]) <= 5: errs.append(f"{len(story['items'])} market items, need 3 to 5")
    for where, t in sents + [("cover", " ".join(story["cover"])), ("title", story["title"]), ("description", story["description"])]:
        for m in BAN.finditer(t): errs.append(f"{where}: banned word '{m.group(0)}'")
        if "—" in t or "–" in t: errs.append(f"{where}: em/en dash")
        for tok in re.findall(r"\b[A-Z]{2,5}\b", t):
            if tok not in TICKER_OK and where not in ("title", "description"): errs.append(f"{where}: ticker-like token '{tok}' (say the company name)")
    for where, t in sents:
        if len(t.split()) > 15: errs.append(f"{where}: sentence over 15 words: {t!r}")
        for f in nums(t):
            nf = norm(f)
            if nf not in allowed and not re.match(r"^\d+-fold$", f) and not any(a.startswith(nf) and a[len(nf):].isalpha() for a in allowed):
                errs.append(f"{where}: figure {f!r} is not in the verified set")
    for (where, t), a in zip(sents, ear_audit([t for _, t in sents])):
        if a: errs.append(f"{where}: the voice would stumble on {a} in {t!r} (plain words, no acronyms)")
    all_spoken = " ".join(t for _, t in sents)
    if not re.search(TIMING[ED]["need"], all_spoken, re.I): errs.append(f"timing: none of the {ED} words ({TIMING[ED]['need']}) appear")
    for m in re.finditer(TIMING[ED]["never"], all_spoken, re.I): errs.append(f"timing: '{m.group(0)}' is wrong for the {ED} edition")
    for i, it in enumerate(story["items"]):
        if len(it["sentences"]) != 2: errs.append(f"item {i + 1}: needs exactly 2 sentences (why, then the read)")
        elif res["items"][it["n"]].get("figures") and not re.search(r"\b(on|as|after|because|despite|with|amid|following|from|thanks to|when|while|but|yet|over|for|since|to)\b", it["sentences"][0]["text"], re.I):
            errs.append(f"item {i + 1}: sentence 1 must give the cause (on / as / after / despite ...): {it['sentences'][0]['text']!r}")
        elif not re.search(r"\b(analysts?|commentators?|investors?|traders?|shares|the stock|markets?|economists?|strategists?|wall street|critics|fans|users|observers|futures|policymakers|officials|fed|bond traders|yields|economists|the market)\b",
                           it["sentences"][1]["text"], re.I):
            errs.append(f"item {i + 1}: the second sentence must be the attributed read (analysts/investors/traders/shares...)")
    for it in story["items"]:
        for x in it["sentences"]:
            if len(x["eyebrow"]) > 26: errs.append(f"eyebrow {x['eyebrow']!r} over 26 characters (use the short name)")
    pt, at = story["portfolio"]["text"], story["ask"]["answer_text"]
    if "portfolio" not in pt.lower() or len(pt.split()) < 5: errs.append(f"portfolio: a full sentence that names 'My portfolio' (got {pt!r})")
    if len(at.split()) < 5 or (ED != "preopen" and not re.search(r"\b(up|down|flat|gained|lost|rose|fell)\b", at, re.I)):
        errs.append(f"ask answer: a full spoken sentence with the direction words (up / down / flat), got {at!r}")
    for where, t in sents:
        for m in re.finditer(r"\d+\.\d{2,}%", t): errs.append(f"{where}: {m.group(0)}: one decimal for percentages")
    if len(story["title"]) > 70: errs.append(f"title is {len(story['title'])} chars (max 70)")
    if len(story["cover"]) != 3: errs.append("cover needs exactly 3 lines")
    # the accent bracket is code's job: the leading name (one word, or two when the second is capitalised)
    story["cover"] = [c if "[" in c else re.sub(r"^((?:[A-Z][\w&'.-]*)(?: [A-Z][\w&'.-]*)?)", r"[\1]", c.strip(), count=1) for c in story["cover"]]
    for c in story["cover"]:
        if not re.match(r"^\[[^\]]+\] [^\[\]]+\.$", c) or len(c) > 30: errs.append(f"cover line {c!r}: 'Name verb.' with a short name, <= 28 chars")
    return errs, words


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
Company names to say (never tickers): {json.dumps(facts.get("names", {}))}

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
No advice or hype words, no jargon (thesis, tape, book, print, catalyst, guidance, capex), no em dashes, no tickers, never "demo"."""
        budget = 56 - len(askc["question"].split())
        prompt = base.replace("{budget}", str(budget))
        story, errs = None, ["not run"]
        for rnd in range(5):
            story = llm(W, sys_p, prompt, max_tokens=16000, temperature=0.4, prefer=os.environ.get("SHORTS_STORY_MODEL", "openrouter"))   # M3 reasons long: 8000 truncated its JSON
            story["_budget"] = 56
            try:
                errs, words = check(story, res, facts, askc)
            except Exception as e:                       # noqa: BLE001  (a malformed shape is a failed round)
                errs, words = [f"malformed: {e}"], 0
            log(f"storyline round {rnd + 1}: {words} words, {len(errs)} problems {errs[:6]}")
            if not errs:
                break
            prompt = base.replace("{budget}", str(budget)) + "\n\nYOUR LAST DRAFT:\n" + json.dumps({k: v for k, v in story.items() if not k.startswith("_")}) + \
                "\nFIX ALL OF THESE PROBLEMS:\n- " + "\n- ".join(errs)
        if errs and story and isinstance(story.get("items"), list):
            # last resort, deterministic: an item whose sentences fail is told with its verified WHY and READ verbatim
            bad = {int(m.group(1)) - 1 for e in errs for m in [re.match(r"item (\d+):", e)] if m}
            for i in bad:
                if i < len(story["items"]) and isinstance(story["items"][i], dict) and "n" in story["items"][i]:
                    r = res["items"][story["items"][i]["n"]]; eb = (story["items"][i].get("sentences") or [{}, {}])
                    story["items"][i]["sentences"] = [{"eyebrow": (eb[0].get("eyebrow") or r["cover"]).upper()[:26], "text": r["why"]},
                                                      {"eyebrow": (eb[-1].get("eyebrow") or "THE READ").upper()[:26], "text": r["sentiment"]}]
            try:
                errs, words = check(story, res, facts, askc)
            except Exception as e:                       # noqa: BLE001
                errs = [f"malformed: {e}"]
            log(f"storyline fallback (verified wording for items {sorted(x + 1 for x in bad)}): {len(errs)} problems {errs[:4]}")
        story["_errors"] = errs; story["_words"] = words
        jdump(story, os.path.join(W, "story.json"))
        if errs:
            sys.exit("REFUSE: storyline failed its checks: " + "; ".join(errs[:6]))


if __name__ == "__main__":
    main()
