#!/usr/bin/env python3
"""Stage 1, research: what a retail investor needs to know for this edition, with every claim on two sources.

    research.py <edition: preopen|midday|close> <date YYYY-MM-DD> <work-dir> [--exclude SYM,SYM] [--seed N]

1. Data, deterministic: index/futures levels and a ~90-name universe (megacap, AI chips and infrastructure,
   AI software, power, popular retail names, plus today's large-cap earnings reporters) from TWO independent
   quote feeds (CNBC quote service, Nasdaq quote API). The US economic calendar and the earnings calendar from
   Nasdaq. Headlines from Google News RSS (publisher, time, link) for every candidate and for the macro queries.
2. Judgment, LLM (MARA MiniMax-M3, OpenRouter fallback): rank 3-5 items for this edition; for each, WHY it moved
   or matters and the market/community SENTIMENT, each citing headline ids from at least two publishers.
3. Verification, code + a second LLM pass: cited ids must exist; >= 2 distinct publishers for the why and for the
   sentiment; every figure must agree across both quote feeds (and with the claim) or it is dropped; a judge
   call re-reads the cited headlines verbatim and must confirm support. Items that fail are dropped. Fewer than
   3 surviving items is a hard failure (the pipeline refuses to continue).

Writes <work>/research.json and <work>/research-sources.json.
"""
import json, os, re, sys, time, urllib.parse, xml.etree.ElementTree as ET_
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (CT, ET, Stage, agree, cnbc, get, jdump, jload, llm, log, nasdaq, nasdaq_pre, rest)

ED, DATE, W = sys.argv[1], sys.argv[2], sys.argv[3]
REVERIFY = "--reverify" in sys.argv
EXCL = set(sys.argv[sys.argv.index("--exclude") + 1].split(",")) if "--exclude" in sys.argv else set()
os.makedirs(W, exist_ok=True)

UNIVERSE = """NVDA MSFT AAPL GOOGL AMZN META TSLA AVGO ORCL AMD TSM MU INTC QCOM ARM ASML SMCI DELL HPE ANET CRWV NBIS
PLTR SNOW CRM ADBE NOW IBM CSCO MRVL LRCX AMAT KLAC TXN CEG VST NRG GEV ETN VRT OKLO SMR IREN APLD CIFR WULF MARA
COIN HOOD MSTR NFLX UBER SHOP SPOT RDDT APP DDOG CRWD PANW NET MDB SOUN PATH TEM RKLB ASTS IONQ RGTI QBTS JPM GS
BAC WMT COST NKE LLY NVO UNH XOM BA DIS PYPL SOFI""".split()
NAMES = {"GOOGL": "Google", "META": "Meta", "NVDA": "Nvidia", "MSFT": "Microsoft", "AAPL": "Apple", "AMZN": "Amazon",
         "TSLA": "Tesla", "AVGO": "Broadcom", "ORCL": "Oracle", "AMD": "AMD", "TSM": "TSMC", "MU": "Micron", "INTC": "Intel",
         "QCOM": "Qualcomm", "ARM": "Arm", "ASML": "ASML", "SMCI": "Super Micro", "DELL": "Dell", "HPE": "Hewlett Packard Enterprise",
         "ANET": "Arista", "CRWV": "CoreWeave", "NBIS": "Nebius", "PLTR": "Palantir", "SNOW": "Snowflake", "CRM": "Salesforce",
         "ADBE": "Adobe", "NOW": "ServiceNow", "IBM": "IBM", "CSCO": "Cisco", "MRVL": "Marvell", "LRCX": "Lam Research",
         "AMAT": "Applied Materials", "KLAC": "KLA", "TXN": "Texas Instruments", "CEG": "Constellation Energy", "VST": "Vistra",
         "NRG": "NRG", "GEV": "GE Vernova", "ETN": "Eaton", "VRT": "Vertiv", "OKLO": "Oklo", "SMR": "NuScale", "IREN": "IREN",
         "APLD": "Applied Digital", "CIFR": "Cipher", "WULF": "TeraWulf", "MARA": "MARA", "COIN": "Coinbase", "HOOD": "Robinhood",
         "MSTR": "Strategy", "NFLX": "Netflix", "UBER": "Uber", "SHOP": "Shopify", "SPOT": "Spotify", "RDDT": "Reddit",
         "APP": "AppLovin", "DDOG": "Datadog", "CRWD": "CrowdStrike", "PANW": "Palo Alto Networks", "NET": "Cloudflare",
         "MDB": "MongoDB", "SOUN": "SoundHound", "PATH": "UiPath", "TEM": "Tempus AI", "RKLB": "Rocket Lab", "ASTS": "AST SpaceMobile",
         "IONQ": "IonQ", "RGTI": "Rigetti", "QBTS": "D-Wave", "JPM": "JPMorgan", "GS": "Goldman Sachs", "BAC": "Bank of America",
         "WMT": "Walmart", "COST": "Costco", "NKE": "Nike", "LLY": "Eli Lilly", "NVO": "Novo Nordisk", "UNH": "UnitedHealth",
         "XOM": "Exxon", "BA": "Boeing", "DIS": "Disney", "PYPL": "PayPal", "SOFI": "SoFi"}
MACRO = ["ES=F", "NQ=F", "^GSPC", "^IXIC", "^VIX"]          # only levels with a second feed (app prices / Nasdaq COMP)
KEY_ECON = re.compile(r"Nonfarm|Unemployment Rate|CPI|PCE|GDP|ISM|Jobless Claims|Retail Sales|FOMC|Fed (?:Chair|Governor)|Powell|"
                      r"Interest Rate Decision|JOLTS|Consumer Confidence|Michigan|PPI|Durable Goods|Payrolls|ADP", re.I)


def gnews(q, hours):
    """Google News RSS: [(title, publisher, utc datetime, link)] newer than `hours`."""
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + f" when:{max(1, round(hours / 24))}d") + "&hl=en-US&gl=US&ceid=US:en"
    try:
        root = ET_.fromstring(get(url, tries=2))
    except Exception as e:                                       # noqa: BLE001
        log("gnews failed", q, str(e)[:80]); return []
    out, cut = [], datetime.now(timezone.utc) - timedelta(hours=hours)
    for it in root.iter("item"):
        try:
            when = parsedate_to_datetime(it.findtext("pubDate"))
        except Exception:                                        # noqa: BLE001
            continue
        pub = (it.findtext("source") or "").strip()
        title = re.sub(r"\s+-\s+" + re.escape(pub) + r"\s*$", "", (it.findtext("title") or "").strip()) if pub else it.findtext("title")
        if when >= cut and pub and title:
            out.append((title, pub, when, it.findtext("link")))
    return out


def main():
    now = datetime.now(ET)
    if REVERIFY:          # re-check the stored items against the current rules (no new data, no new pick)
        data = jload(os.path.join(W, "research-data.json")); cand_rows, macro = data["candidates"], data["macro"]
        pick = jload(os.path.join(W, "research-pick.json")); pick["items"] = jload(os.path.join(W, "research.json"))["items"]
    else:
        with Stage(W, "research.data"):
            # 1a. quotes, two feeds
            earn = []
            for d in ([DATE] if ED != "preopen" else [DATE, (datetime.fromisoformat(DATE) - timedelta(days=1)).strftime("%Y-%m-%d")]):
                try:
                    rows = json.loads(get(f"https://api.nasdaq.com/api/calendar/earnings?date={d}"))["data"]["rows"] or []
                except Exception:                                    # noqa: BLE001
                    rows = []
                for r in rows:
                    mc = float((r.get("marketCap") or "0").replace("$", "").replace(",", "") or 0)
                    if mc >= 2e10:
                        earn.append({"symbol": r["symbol"], "name": r["name"], "date": d, "time": r.get("time"), "mcap": mc,
                                     "eps_forecast": r.get("epsForecast")})
            # tomorrow's big reporters, so "what to watch" can name them
            nxt = (datetime.fromisoformat(DATE) + timedelta(days=1)).strftime("%Y-%m-%d")
            try:
                rows = json.loads(get(f"https://api.nasdaq.com/api/calendar/earnings?date={nxt}"))["data"]["rows"] or []
            except Exception:                                        # noqa: BLE001
                rows = []
            earn_next = [{"symbol": r["symbol"], "name": r["name"], "date": nxt, "time": r.get("time")} for r in rows
                         if float((r.get("marketCap") or "0").replace("$", "").replace(",", "") or 0) >= 5e10]
            uni = [s for s in dict.fromkeys(UNIVERSE + [e["symbol"] for e in earn]) if s not in EXCL]
            cq = cnbc(uni + MACRO)
            app_px = {r["symbol"]: r for r in rest(W, "prices?select=symbol,price,change_pct,prev_close,updated_at&symbol=in.(" +
                                                    ",".join(urllib.parse.quote(s) for s in ["ES=F", "NQ=F", "^GSPC", "^VIX"] + uni) + ")")}

            def move(s):
                q = cq.get(s) or {}
                if ED == "preopen":
                    return q.get("ext_pct") if q.get("ext_type") in ("PRE_MKT", "POST_MKT") else None
                return q.get("pct")
            ranked = sorted([s for s in uni if move(s) is not None], key=lambda s: -abs(move(s)))
            cands = list(dict.fromkeys(ranked[:14] + [e["symbol"] for e in earn][:6] + ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "AAPL"]))
            # second feed for every candidate
            def second(s):
                n = nasdaq(s)
                if ED == "preopen": n = dict(n or {}, pre=nasdaq_pre(s, "pre") or nasdaq_pre(s, "post"))
                elif ED == "close": n = dict(n or {}, post=nasdaq_pre(s, "post"))
                return s, n
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(6) as ex:
                nq = dict(ex.map(second, cands))
            cand_rows = []
            for s in cands:
                c, n = cq.get(s) or {}, nq.get(s) or {}
                if ED == "preopen":
                    a = c.get("ext_pct") if c.get("ext_type") else None
                    b = (n.get("pre") or {}).get("pct") if n.get("pre") else n.get("ext_pct")
                    session = (c.get("ext_type") or "").lower() or "none"
                else:
                    a, b, session = c.get("pct"), n.get("pct"), "regular" if ED == "close" else "live"
                ok = agree(a, b, 0.06 if ED != "midday" else 0.35)   # live quotes are seconds apart mid-session
                cand_rows.append({"symbol": s, "name": NAMES.get(s, c.get("name") or s), "last": c.get("last"),
                                  "pct_feed1": a, "pct_feed2": b, "feeds_agree": ok, "session": session,
                                  "regular_pct": c.get("pct"), "high": c.get("high"), "low": c.get("low"), "prev": c.get("prev"),
                                  "app_pct": (app_px.get(s) or {}).get("change_pct"),
                                  "ext1": c.get("ext_pct") if c.get("ext_type") else None,
                                  "ext2": (n.get("post") or n.get("pre") or {}).get("pct") if (n.get("post") or n.get("pre")) else n.get("ext_pct")})
            macro = {}
            comp = nasdaq("COMP", "index") or {}
            for s in MACRO:
                c = cq.get(s) or {}
                a2 = app_px.get(s) or ({"price": comp.get("last"), "change_pct": comp.get("pct")} if s == "^IXIC" and comp else {})
                macro[s] = {"last": c.get("last"), "pct": c.get("pct"), "time": c.get("time"),
                            "app_last": a2.get("price"), "app_pct": a2.get("change_pct"),
                            "feeds_agree": agree(c.get("pct"), a2.get("change_pct"), 0.08) if a2 else None}
            try:
                ev = json.loads(get(f"https://api.nasdaq.com/api/calendar/economicevents?date={DATE}"))["data"]
                econ = [{"time_et": r["gmt"], "event": r["eventName"], "actual": r.get("actual", "").strip(), "consensus": r.get("consensus", "").strip(),
                         "previous": r.get("previous", "").strip()} for r in ev["rows"] if r["country"] == "United States" and KEY_ECON.search(r["eventName"])]
                econ_asof = ev.get("asOf")
                # the feed ignores ?date= and serves the current ET day: never present another day's calendar as today's
                want = datetime.fromisoformat(DATE).strftime("%b %-d, %Y")
                if want not in str(econ_asof):
                    log(f"econ calendar is for {econ_asof}, not {DATE}: left out"); econ = []
            except Exception:                                        # noqa: BLE001
                econ, econ_asof = [], None

            # 1b. headlines
            hours = {"preopen": 18, "midday": 16, "close": 14}[ED]
            heads, hid = [], 0
            queries = [(s, f'"{NAMES.get(s, s)}" stock') for s in cands[:16]] + [(s, f'"{NAMES.get(s, s)}" shares') for s in cands[:10]]
            queries += [("MACRO", "stock market today"), ("MACRO", "Nasdaq S&P 500 futures" if ED == "preopen" else "stocks Nasdaq S&P 500"),
                        ("MACRO", "Federal Reserve rates"), ("MACRO", "AI stocks")]
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(8) as ex:                 # ~30 feeds: 2 min sequential, ~20 s in parallel
                got = list(ex.map(lambda tq: (tq[0], gnews(tq[1], hours)), queries))
            for tag, items in got:
                for t, pub, when, link in items[:14]:
                    hid += 1
                    heads.append({"id": f"h{hid}", "tag": tag, "title": t, "publisher": pub, "utc": when.strftime("%Y-%m-%d %H:%M"),
                                  "et": when.astimezone(ET).strftime("%a %-I:%M %p ET"), "link": link})
            # same story under two queries keeps one id per (title, publisher)
            seen, dedup = set(), []
            for h in heads:
                k = (h["title"].lower()[:80], h["publisher"])
                if k not in seen:
                    seen.add(k); dedup.append(h)
            heads = dedup
            data = {"edition": ED, "date": DATE, "asof_et": now.strftime("%Y-%m-%d %H:%M ET"), "candidates": cand_rows, "macro": macro,
                    "econ": econ, "econ_asof": econ_asof, "earnings_today": earn, "earnings_next": earn_next[:12], "headlines": heads}
            jdump(data, os.path.join(W, "research-data.json"))
            log(f"{len(cand_rows)} candidates, {len(heads)} headlines, {len(econ)} econ events, {len(earn)} earnings")

        with Stage(W, "research.llm"):
            frame = {"preopen": "BEFORE THE US OPEN (the Short posts ~9:00 AM ET). Items: what moved overnight and in the premarket (futures, "
                                "premarket movers and why), and today's calendar (US economic data with ET times, Fed speakers, big earnings). "
                                "Tense: 'this morning', 'before the bell', 'today'. Never 'closed' for today.",
                     "midday": "MIDDAY (the Short posts ~1:00 PM ET, the market is OPEN). Items: what is moving so far today and why. "
                               "Tense: 'so far', 'this afternoon', 'midday'. Never 'closed' for today.",
                     "close": "AFTER THE CLOSE (the Short posts ~4:20 PM ET). Items: what moved in today's session and why, plus a big "
                              "after-the-bell report if one is out. Tense: past, 'today', 'closed'."}[ED]
            compact_heads = "\n".join(f'{h["id"]} [{h["tag"]}] {h["publisher"]} ({h["et"]}): {h["title"]}' for h in data["headlines"])
            prompt = f"""Edition: {frame}
    Date: {DATE}. Data as of {data['asof_et']}.

    QUOTES (two feeds; only use a figure where feeds_agree is true; pct is percent change):
    {json.dumps(cand_rows, separators=(',', ':'))}
    MACRO: {json.dumps(macro, separators=(',', ':'))}
    US ECONOMIC CALENDAR ({econ_asof}): {json.dumps(econ, separators=(',', ':'))}
    EARNINGS (large caps): {json.dumps(earn, separators=(',', ':'))}   NEXT DAY: {json.dumps(earn_next[:8], separators=(',', ':'))}

    HEADLINES (id [query] publisher (time): title):
    {compact_heads}

    Pick the 6 most useful things a general retail investor should know for this edition: AI-focused but not only AI (macro, Fed,
    big earnings, sector moves, other hot stocks). Prefer stories with a clear WHY and a visible market or analyst reaction.
    For each item:
    - "kind": "stock" | "macro" | "earnings" | "calendar"
    - "symbols": the tickers it is about ([] for pure macro)
    - "cover": a 2-4 word headline for the title card, company or event name first, e.g. "Micron beats." / "Meta slips." / "Jobs report at 8:30."
    - "why": one plain sentence, <= 14 words: what happened and WHY (the cause), only what the cited headlines say
    - "why_ids": headline ids from AT LEAST TWO DIFFERENT publishers that state that cause
    - "sentiment": one plain sentence, <= 9 words: the market or community READ of it, attributed ("Analysts ...", "Commentators ...",
      "Investors ...") OR the market's reaction ("Shares barely moved after hours."). It must be something at least TWO different
      publishers' headlines say; if only one says it, choose a reaction that two of them do state.
    - "sentiment_ids": ids from AT LEAST TWO DIFFERENT publishers whose headline states that read or reaction
    - "figures": [{{"symbol": "MU", "field": "pct", "value": -1.84}}] every number the item needs, copied from QUOTES/MACRO (pct of the
      session for this edition); [] if none
    Rules: plain English, no jargon (never: thesis, tape, book, print, catalyst, guidance, capex, EPS, beta, multiple, bps),
    no advice or hype words (buy, sell, should, soar, skyrocket, massive, huge, crush), no em dashes, no figure that is not in QUOTES/MACRO,
    no claim that is not in the cited headlines. Also return "hot": up to 4 tickers from QUOTES that are big, liquid, and in today's
    conversation (for building a believable portfolio), and "context": one sentence on the overall market for this edition.
    Return {{"items": [...], "hot": [...], "context": "..."}}."""
            pick = llm(W, "You are a careful markets editor for a 25-second video. You only state what the cited headlines and quotes support.", prompt)
            jdump(pick, os.path.join(W, "research-pick.json"))

    with Stage(W, "research.verify"):
        byid = {h["id"]: h for h in data["headlines"]}
        rowsym = {r["symbol"]: r for r in cand_rows}
        kept, dropped = verify(pick.get("items", []), byid, rowsym, macro)
    if len(kept) < 4 and dropped:
        with Stage(W, "research.repair"):
            rp = "These items failed verification. For each, rewrite WHY and SENTIMENT so that each is stated by headlines from AT LEAST " \
                 "TWO DIFFERENT publishers (use the ids below; pick a reaction two of them state if no opinion is shared), drop any figure " \
                 "the feeds disagree on, or return null for the item if two publishers do not support it. Same JSON shape as before: " \
                 "{\"items\": [...]}. Same rules: plain English, no jargon, no advice/hype words, no em dashes.\n\n"
            for it in dropped:
                syms = set(it.get("symbols", []))
                rel = [h for h in data["headlines"] if h["tag"] in syms or h["id"] in set(it.get("why_ids", []) + it.get("sentiment_ids", []))][:24]
                rp += f"ITEM: {json.dumps({k: it.get(k) for k in ('kind', 'symbols', 'cover', 'why', 'why_ids', 'sentiment', 'sentiment_ids', 'figures')})}\n"
                rp += f"FAILED BECAUSE: {it.get('drop')}\nHEADLINES:\n" + "".join(f"  {h['id']} {h['publisher']}: {h['title']}\n" for h in rel)
            rp += "\nQUOTES (feeds_agree must be true): " + json.dumps([r for r in cand_rows if set([r['symbol']]) & set(sum((d.get('symbols', []) for d in dropped), []))], separators=(',', ':'))
            fix = llm(W, "You are a careful markets editor. Only claims two publishers state.", rp)
            k2, d2 = verify([i for i in fix.get("items", []) if i], byid, rowsym, macro)
            have = {tuple(i.get("symbols", [])) for i in kept}
            kept += [i for i in k2 if tuple(i.get("symbols", [])) not in have]
            dropped = d2 + [d for d in dropped if tuple(d.get("symbols", [])) not in {tuple(i.get("symbols", [])) for i in k2}]
    for d in dropped: log("DROP", d.get("cover"), d.get("drop"))
    res = {"edition": ED, "date": DATE, "asof_et": data["asof_et"], "context": pick.get("context", ""),
           "hot": [s for s in pick.get("hot", []) if s in {r["symbol"] for r in cand_rows if r["feeds_agree"]}],
           "items": kept, "dropped": dropped, "model": pick.get("_model")}
    jdump(res, os.path.join(W, "research.json"))
    log(f"kept {len(kept)} items: " + " | ".join(i["cover"] for i in kept))
    if len(kept) < 3:
        sys.exit(f"REFUSE: only {len(kept)} research items survived verification (need 3)")


UP = r"(?:rose|rises|climbed|jumped|jumps|gained|rallied|advanced|popped|pops|higher|up)"
DOWN = r"(?:fell|falls|dropped|drops|slid|slides|sank|sinks|slipped|slips|declined|tumbled|lower|down)"
FLAT = r"(?:barely moved|flat|little changed|unchanged|isn't moving|is not moving)"


def direction_conflicts(it, rowsym):
    """A direction word the price feeds contradict. After-hours / premarket words are checked against BOTH feeds'
    extended quotes (the owner's rule: an extended-hours figure or direction needs two agreeing sources)."""
    bad = []
    text = f"{it.get('why', '')} {it.get('sentiment', '')}"
    for s in it.get("symbols", []):
        r = rowsym.get(s)
        if not r:
            continue
        for clause in re.split(r"[.;]|, (?:then|but|and) ", text):
            ext = re.search(r"after[- ]hours|after the bell|late trading|extended trading|premarket|pre-market|before the bell", clause, re.I)
            if not (ext or re.search(r"\b(shares|stock|closed|trading)\b", clause, re.I)):
                continue                                    # "revenue jumped 11-fold" is not a price claim
            if ext and ED != "preopen":
                a, b = r.get("ext1"), r.get("ext2")
            else:
                a, b = (r["pct_feed1"], r["pct_feed2"])
            if a is None or b is None:
                if ext: bad.append(f"{s}: extended-hours claim without two extended quotes")
                continue
            strong = re.search(r"\b(jump\w*|surg\w*|soar\w*|popp?\w*|spik\w*|plung\w*|sank|sinks?|tumbl\w*|slump\w*|crater\w*)\b", clause, re.I)
            if strong and not (abs(a) >= 2.0 and abs(b) >= 2.0):
                bad.append(f"{s}: '{strong.group(0)}' needs a 2%+ move on both feeds, got {a:+.2f}/{b:+.2f}")
            elif re.search(DOWN, clause, re.I) and not (a < -0.25 and b < -0.25): bad.append(f"{s}: says down, feeds {a:+.2f}/{b:+.2f}")
            elif re.search(UP, clause, re.I) and not re.search(FLAT, clause, re.I) and not (a > 0.25 and b > 0.25):
                bad.append(f"{s}: says up, feeds {a:+.2f}/{b:+.2f}")
            elif re.search(FLAT, clause, re.I) and not (abs(a) < 1.0 and abs(b) < 1.0): bad.append(f"{s}: says flat, feeds {a:+.2f}/{b:+.2f}")
    return bad


def verify(items, byid, rowsym, macro):
    """Code checks (ids exist, two publishers each, figures agree across both feeds), then the judge."""
    kept, dropped = [], []
    for it in items:
        why = [byid[i] for i in it.get("why_ids", []) if i in byid]
        sen = [byid[i] for i in it.get("sentiment_ids", []) if i in byid]
        reasons = []
        # two sources = two publishers AND two different headlines (a syndicated copy of one story is one source)
        two = lambda hs: len({h["publisher"] for h in hs}) >= 2 and len({re.sub(r"[^a-z0-9]", "", h["title"].lower())[:60] for h in hs}) >= 2
        if not two(why): reasons.append("why: fewer than 2 independent sources")
        if not two(sen): reasons.append("sentiment: fewer than 2 independent sources")
        reasons += direction_conflicts(it, rowsym)
        figs = []
        for f in it.get("figures", []):
            s, v = f.get("symbol"), f.get("value")
            r = rowsym.get(s); m = macro.get(s)
            if r:
                ok = r["feeds_agree"] and agree(v, r["pct_feed1"], 0.051) and agree(v, r["pct_feed2"], 0.051 if ED != "midday" else 0.35)
                figs.append({**f, "feed1": r["pct_feed1"], "feed2": r["pct_feed2"], "ok": ok})
            elif m:
                ok = bool(m["feeds_agree"]) and agree(v, m["pct"], 0.051)
                figs.append({**f, "feed1": m["pct"], "feed2": m["app_pct"], "ok": ok})
            else:
                figs.append({**f, "ok": False, "why": "not in quotes"})
        bad = [f for f in figs if not f["ok"]]
        if bad: reasons.append("figures disagree or unknown: " + ", ".join(f"{f.get('symbol')} {f.get('value')}" for f in bad))
        for s in it.get("symbols", []):
            if s in rowsym and not rowsym[s]["feeds_agree"]: reasons.append(f"{s}: feeds disagree on the move")
        it["figures"] = figs
        (dropped if reasons else kept).append({**it, "drop": reasons} if reasons else it)
    if not kept:
        return kept, dropped
    jp = "For each claim, decide if the quoted headlines (and only them) support it. A claim is supported only if at least two of " \
         "its headlines, from different publishers, state it or clearly imply it. A WHY must also state a CAUSE (the reason " \
         "something moved or matters); a WHY that only restates the move ('shares fell to a low') is why_ok false. Return {\"verdicts\": [{\"n\": 1, \"why_ok\": true, " \
         "\"why_support\": [\"h1\",\"h5\"], \"sentiment_ok\": true, \"sentiment_support\": [...], \"note\": \"...\"}]}.\n\n"
    for n, it in enumerate(kept, 1):
        jp += f"CLAIM {n} WHY: {it['why']}\n" + "".join(f"  {i}: {byid[i]['publisher']}: {byid[i]['title']}\n" for i in it["why_ids"] if i in byid)
        jp += f"CLAIM {n} SENTIMENT: {it['sentiment']}\n" + "".join(f"  {i}: {byid[i]['publisher']}: {byid[i]['title']}\n" for i in it["sentiment_ids"] if i in byid)
    judge = llm(W, "You are a strict fact checker. Unsupported means unsupported.", jp, max_tokens=6000, temperature=0)
    verdicts = {v.get("n"): v for v in judge.get("verdicts", [])}
    final = []
    pubs = lambda ids: len({byid[i]["publisher"] for i in ids if i in byid})
    for n, it in enumerate(kept, 1):
        v = verdicts.get(n, {})
        wsup = [i for i in v.get("why_support", []) if i in it["why_ids"]]
        ssup = [i for i in v.get("sentiment_support", []) if i in it["sentiment_ids"]]
        if v.get("why_ok") and v.get("sentiment_ok") and pubs(wsup) >= 2 and pubs(ssup) >= 2:
            final.append({**it, "why_ids": wsup, "sentiment_ids": ssup, "judge_note": v.get("note", "")})
        else:
            dropped.append({**it, "drop": [f"judge: {v.get('note', 'no verdict')}"]})
    return final, dropped


main()
