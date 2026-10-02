#!/usr/bin/env python3
"""Stage 1, research: what a retail investor needs to know for this edition, with every claim on two sources.

    research.py <edition: preopen|midday|close> <date YYYY-MM-DD> <work-dir> [--exclude SYM,SYM] [--seed N]

1. Data, deterministic: index/futures levels and a ~90-name universe (megacap, AI chips and infrastructure,
   AI software, power, popular retail names, plus today's large-cap earnings reporters) from TWO independent
   quote feeds (CNBC quote service, Nasdaq quote API). The US economic calendar and the earnings calendar from
   Nasdaq. Headlines from Google News RSS (publisher, time, link) for every candidate and for the macro queries.
2. Judgment, LLM (MARA MiniMax-M3, then SambaNova M3, then claude -p): rank 3-5 items for this edition; for each, WHY it moved
   or matters and the READ (field "sentiment"; v1.4.0: a direct fact in the Short's own voice, never "analysts say"),
   each citing headline ids from at least two publishers. v1.4.0 ranking: the session's top 10 AI movers are always
   candidates, the CNBC / Bloomberg / Reuters / MarketWatch front pages give each name its salience (and their
   headlines join the pool), and a positive story leads a comparable negative one (a big drop that is the story stays).
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
from lib import (CT, ET, Stage, agree, attributed, cnbc, get, jdump, jload, llm, log, nasdaq, nasdaq_pre, rest)
import kr as KRM
import kr_news as KRN

ED, DATE, W = sys.argv[1], sys.argv[2], sys.argv[3]
REVERIFY = "--reverify" in sys.argv
EXCL = set(sys.argv[sys.argv.index("--exclude") + 1].split(",")) if "--exclude" in sys.argv else set()
os.makedirs(W, exist_ok=True)
KR = ED in KRM.KR_EDITIONS                   # v1.1.0: the Seoul editions (Korean AI-chip names, long windows)

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
# v1.4.0 (owner 10/2: "prioritize AI news (like at least top 10 popular moves)"): the AI names whose session moves are ranked
# first; the top 10 by move (dollar volume breaks ties) always join the candidates
AI = set("""NVDA AVGO AMD MU TSM ARM SMCI ORCL MSFT META GOOGL PLTR AMZN MRVL ANET DELL HPE CRWV NBIS VRT ASML AMAT LRCX KLAC
INTC QCOM IBM SNOW NOW CRM ADBE SOUN PATH TEM APP AAPL TSLA APLD IREN CIFR WULF CEG VST GEV ETN""".split())   # + AI power / data centers
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


# v1.4.0 (owner 10/2: "refer to CNBC, bloomberg some news channel and see what they are talking about in their headlines"):
# the front pages' public RSS (no login, no paywall scraping). A name these lead with ranks higher, and their headlines join
# the pool as citable sources (two publishers are still required for every claim). Reuters has no public feed: Google News
# restricted to reuters.com stands in. Yahoo Finance's rssindex was probed 10/2 and is stale (newest item Sep 24, each under
# another publisher), so MarketWatch's top stories stand in for the third newsroom.
FRONT = [("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"), ("CNBC", "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
         ("CNBC", "https://www.cnbc.com/id/19854910/device/rss/rss.html"), ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
         ("Bloomberg", "https://feeds.bloomberg.com/technology/news.rss"), ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories")]


def front_pages(hours):
    """[(title, publisher, utc datetime, link)] from the front-page feeds (+ Reuters via Google News), newer than `hours`."""
    from concurrent.futures import ThreadPoolExecutor
    cut = datetime.now(timezone.utc) - timedelta(hours=hours)

    def one(pu):
        pub, url = pu
        try:
            root = ET_.fromstring(get(url, tries=2, timeout=10))
        except Exception as e:                                   # noqa: BLE001 (a missing front page costs only salience)
            log(f"front page {pub} failed: {str(e)[:60]}"); return []
        out = []
        for it in root.iter("item"):
            try:
                when = parsedate_to_datetime(it.findtext("pubDate"))
            except Exception:                                    # noqa: BLE001
                continue
            t = re.sub(r"\s+", " ", (it.findtext("title") or "").strip())
            if t and when >= cut: out.append((t, pub, when, it.findtext("link")))
        return out
    with ThreadPoolExecutor(7) as ex:
        got = list(ex.map(one, FRONT)); rt = ex.submit(gnews, "stocks site:reuters.com", hours).result()
    return [h for g in got for h in g] + [h for h in rt if h[1].lower().startswith("reuters")]


def mentions(title, sym):
    """A front-page headline names this company (its spoken name or its ticker as a word)."""
    nm = NAMES.get(sym, sym)
    return bool(re.search(r"\b" + re.escape(nm) + r"(?:'s)?\b", title, re.I) or re.search(r"\b\(?" + re.escape(sym) + r"\)?\b", title))


window_field = KRM.window_field


def kr_data(now):
    """Korea editions: the KRX AI-chip universe on two KRX feeds (Yahoo, the app's own source; Daum's official days)
    and the US chip names on CNBC + Nasdaq, each with 1M / 3M / YTD windows on two histories (kr.py); KOSPI on
    Yahoo + Naver, the SOX on CNBC + Nasdaq; English headlines from Google News."""
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date as _date
    today_kr = _date.fromisoformat(DATE)
    cq = cnbc(KRM.US_CHIPS + [".SOX"])
    us_today = datetime.now(ET).date() if datetime.now(ET).hour * 60 + datetime.now(ET).minute >= 570 else datetime.now(ET).date() - timedelta(days=1)
    while us_today.weekday() >= 5: us_today -= timedelta(days=1)

    def kr_row(s):
        q = KRM.kr_quote(s, DATE)
        a, b = q.get("pct"), q.get("pct2")
        w = KRM.windows(s, today_kr, q.get("last"), q.get("last2"))
        return {"symbol": s, "name": KRM.KR_NAMES.get(s, s), "market": "KR", "last": q.get("last"), "currency": "KRW",
                "pct_feed1": a, "pct_feed2": b, "feeds_agree": agree(a, b, 0.35 if q.get("live") else 0.06),
                "session": "stale: " + q["stale"] if q.get("stale") else "live" if q.get("live") else "regular", "regular_pct": a, "ext1": None, "ext2": None, "win": w,
                "feeds": "Yahoo (the app's source) + Daum (KRX days)"}

    def us_row(s):
        c, n = cq.get(s) or {}, nasdaq(s) or {}
        w = KRM.windows(s, us_today, c.get("last"), n.get("last"))
        return {"symbol": s, "name": NAMES.get(s, c.get("name") or s), "market": "US", "last": c.get("last"), "currency": "USD",
                "pct_feed1": c.get("pct"), "pct_feed2": n.get("pct"), "feeds_agree": agree(c.get("pct"), n.get("pct"), 0.06),
                "session": f"US {us_today:%a} close", "regular_pct": c.get("pct"), "ext1": None, "ext2": None, "win": w,
                "feeds": "CNBC + Nasdaq"}
    with ThreadPoolExecutor(6) as ex:
        rows = list(ex.map(kr_row, KRM.KR_UNIVERSE)) + list(ex.map(us_row, [s for s in KRM.US_CHIPS if s not in EXCL]))
    for r in rows:
        r["window_moves"] = {f: v["a"] for f, v in r["win"].items() if v["ok"]}
    macro = {}
    try:
        if KRM.krx_open_now(): raise RuntimeError("live session: the KOSPI level is left out (Yahoo's index runs ~20 min behind Naver's)")
        _, ks = KRM.yahoo_chart("^KS11", "5d", "1d"); kk = sorted(ks)
        nv = json.loads(get("https://m.stock.naver.com/api/index/KOSPI/basic", tries=2))
        a = round(100 * (ks[kk[-1]] / ks[kk[-2]] - 1), 2) if len(kk) >= 2 and kk[-1] == DATE else None
        b = float(nv["fluctuationsRatio"]) * (-1 if nv.get("compareToPreviousPrice", {}).get("name") == "FALLING" else 1)
        macro["^KS11"] = {"name": "KOSPI", "last": ks[kk[-1]] if kk else None, "pct": a, "app_pct": b, "feeds_agree": agree(a, b, 0.06 if not KRM.krx_open_now() else 0.35)}
    except Exception as e:                                       # noqa: BLE001
        log(f"KOSPI quote failed: {str(e)[:80]}")
    sox, soxn = cq.get(".SOX") or {}, nasdaq("SOX", "index") or {}
    macro[".SOX"] = {"name": "Philadelphia semiconductor index", "last": sox.get("last"), "pct": sox.get("pct"), "app_pct": soxn.get("pct"),
                     "feeds_agree": agree(sox.get("pct"), soxn.get("pct"), 0.06)}
    hours = {"korea-open": 60, "korea-midday": 60, "korea-close": 96}[ED]
    queries = [("000660.KS", '"SK hynix"'), ("000660.KS", '"SK hynix" shares'), ("005930.KS", '"Samsung Electronics" shares'),
               ("005930.KS", '"Samsung Electronics" chip'), ("042700.KS", '"Hanmi Semiconductor"'), ("MU", '"Micron" stock'),
               ("NVDA", '"Nvidia" stock'), ("MACRO", "Kospi chip stocks"), ("MACRO", "HBM memory demand"), ("MACRO", "memory chip prices"),
               ("MACRO", "Korea stocks foreign investors"), ("MACRO", "AI chip stocks")]
    movers = sorted([r for r in rows if r["market"] == "US" and r["window_moves"].get(KRM.RANGE_FIELD[KRM.RANGE[ED]]) is not None],
                    key=lambda r: -abs(r["window_moves"][KRM.RANGE_FIELD[KRM.RANGE[ED]]]))[:3]
    queries += [(r["symbol"], f'"{r["name"]}" stock') for r in movers if r["symbol"] not in ("MU", "NVDA")]
    # v1.2.0 (owner 10/1): Korean newsrooms too (Yonhap EN/KO, Korea Herald, BusinessKorea, Maeil, Chosun, Naver Finance's
    # per-ticker news under each item's ORIGINAL press office), so a Korea claim can meet the two-publisher rule; the
    # 10/2 19:32 korea-open refused with only 2 items on Google News alone. Publishers are canonical (kr_news.py): one
    # newsroom one name, a Yonhap reprint counts as Yonhap, never "Naver".
    with ThreadPoolExecutor(9) as ex:
        kn = ex.submit(KRN.kr_headlines, hours)
        got = list(ex.map(lambda tq: (tq[0], gnews(tq[1], hours)), queries))
        try:
            krh = kn.result()
        except Exception as e:                                   # noqa: BLE001 (Google News alone still runs)
            log(f"Korean news failed: {str(e)[:80]}"); krh = []
    heads, hid = [], 0
    for tag, items in got:
        for t, pub, when, link in items[:16]:
            pub = KRN.canonical_publisher(pub, t)
            if not pub: continue
            hid += 1
            heads.append({"id": f"h{hid}", "tag": tag, "title": t, "publisher": pub, "utc": when.strftime("%Y-%m-%d %H:%M"),
                          "et": when.astimezone(ET).strftime("%a %-I:%M %p ET"), "link": link})
    # the Korean feeds: names first (a ticker's own news), then the sector; capped so the prompt stays readable
    krh = sorted(krh, key=lambda h: (h["tag"] == "MACRO", -h["when"].timestamp()))[:70]
    for h in krh:
        hid += 1
        heads.append({"id": f"h{hid}", "tag": h["tag"], "title": h["title"], "publisher": h["publisher"],
                      "utc": h["when"].strftime("%Y-%m-%d %H:%M"), "et": h["when"].astimezone(ET).strftime("%a %-I:%M %p ET"),
                      "link": h["link"], "lang": h["lang"], "via": h["via"]})
    seen, dedup = set(), []
    for h in heads:
        k = (h["title"].lower()[:80], h["publisher"])
        if k not in seen: seen.add(k); dedup.append(h)
    log(f"headlines: {len(dedup)} ({len(krh)} from Korean newsrooms, {len({h['publisher'] for h in dedup})} publishers)")
    return rows, macro, dedup


US_PICK = """Pick the 6 most useful things a general retail investor should know for this edition: AI-focused but not only AI (macro, Fed,
    big earnings, sector moves, other hot stocks). Prefer stories with a clear WHY and a concrete fact that puts them in context.
    PRIORITIES (v1.4.0, owner 10/2), in order: (1) AI first: at least 3 of the 6 about the session's top AI movers (QUOTES rows with
    "ai": true; "ai_rank" 1-10 = the biggest AI moves); (2) what the big newsrooms lead with: rows with "front_page" > 0 are named
    in today's CNBC / Bloomberg / Reuters / MarketWatch front-page headlines (the more, the bigger the story); (3) when two
    stories are comparable, prefer the POSITIVE one (a gain, a beat, a record, a deal, a launch). A big drop is still the story
    when it is one (front-page news or a move of 5% or more): tell it plainly, never cheerlead, never hide it."""
KR_PICK = """Pick the 6 most useful things a US retail investor with an AI-heavy portfolio should know from Korea's chip market for this
    edition: at least 3 items about Korean names (SK hynix, Samsung Electronics, Hanmi Semiconductor or a peer in QUOTES), the rest the
    US chip names they move with or the KOSPI. Lead with the multi-week trend and its cause, not the day's noise. When two stories
    are comparable, prefer the POSITIVE one (a gain, a record, a deal); a big drop that is THE story is still told, plainly. Each QUOTES row has
    "win": {"m1"|"m3"|"ytd": {"a": pct, "b": pct, "ok": both histories agree}}; use a window only where ok is true. Upcoming events
    (earnings, a results date) only when a headline states the date. Never a price target, never what to do. Some HEADLINES are
    Korean-language (Yonhap, Maeil Business, Naver Finance's press offices): cite them like any other, but write every field in
    plain English and claim only what the Korean headline itself says (translate faithfully, add nothing)."""
FIG_FIELDS = ("pct = the session move; for the long view use field \"" + KRM.RANGE_FIELD[KRM.RANGE[ED]] + "\" (the app pages show the "
              + KRM.RANGE[ED] + " change) with the value from win." + KRM.RANGE_FIELD[KRM.RANGE[ED]] + ".a; no other window field") if KR else \
    "pct of the session for this edition"


def main():
    now = datetime.now(ET)
    if REVERIFY:          # re-check the stored items against the current rules (no new data, no new pick)
        data = jload(os.path.join(W, "research-data.json")); cand_rows, macro = data["candidates"], data["macro"]
        pick = jload(os.path.join(W, "research-pick.json")); pick["items"] = jload(os.path.join(W, "research.json"))["items"]
    elif KR:
        with Stage(W, "research.data"):
            cand_rows, macro, heads = kr_data(now)
            data = {"edition": ED, "date": DATE, "asof_et": now.strftime("%Y-%m-%d %H:%M ET"), "candidates": cand_rows, "macro": macro,
                    "econ": [], "econ_asof": None, "earnings_today": [], "earnings_next": [], "headlines": heads,
                    "range": KRM.RANGE[ED], "asof_kst": KRM.kst_now().strftime("%Y-%m-%d %H:%M KST")}
            jdump(data, os.path.join(W, "research-data.json"))
            log(f"{len(cand_rows)} candidates (KR + US chips), {len(heads)} headlines")
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
                    return q.get("ext_pct") if q.get("ext_type") else None   # PRE_MKT, POST_MKT, POST_MKT_PREV
                return q.get("pct")
            ranked = sorted([s for s in uni if move(s) is not None], key=lambda s: -abs(move(s)))
            dv = lambda s: (cq.get(s) or {}).get("last") and (cq.get(s) or {}).get("vol") and cq[s]["last"] * cq[s]["vol"] or 0
            ai_top = sorted([s for s in uni if s in AI and move(s) is not None], key=lambda s: (-round(abs(move(s)), 1), -dv(s)))[:10]
            # v1.4.0: the session's top 10 AI movers are always candidates, and lead the headline queries
            cands = list(dict.fromkeys(ranked[:8] + ai_top + ranked[8:14] + [e["symbol"] for e in earn][:6] + ["NVDA", "MSFT", "GOOGL", "META", "AMZN", "AAPL"]))
            # second feed for every candidate
            def second(s):
                n = nasdaq(s)
                if ED == "preopen":
                    # compare like with like: the session CNBC's extended quote is in (PRE_MKT in the morning; POST_MKT for a
                    # night-time test, when Nasdaq's "pre" table still holds the previous morning: 1 Oct 01:30, JBL -9.08 vs +0.97)
                    kind = "post" if "POST" in str((cq.get(s) or {}).get("ext_type") or "") else "pre"   # POST_MKT or POST_MKT_PREV
                    n = dict(n or {}, pre=nasdaq_pre(s, kind))
                    # Nasdaq's stated extended % can be against the day BEFORE (JBL at 2 AM: -9.08% = the regular -10% plus
                    # after-hours); measure it against Nasdaq's own last regular close instead
                    if n.get("pre") and n["pre"].get("last") and n.get("last"):
                        n["pre"]["pct"] = round(100 * (n["pre"]["last"] / n["last"] - 1), 2)
                elif ED == "close":
                    n = dict(n or {}, post=nasdaq_pre(s, "post"))
                    if n.get("post") and n["post"].get("last") and n.get("last"):
                        n["post"]["pct"] = round(100 * (n["post"]["last"] / n["last"] - 1), 2)
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
                # live quotes are seconds apart mid-session; extended-hours lasts differ by venue (JBL 9/30 night: 0.97 vs 1.05)
                ok = agree(a, b, {"close": 0.06, "midday": 0.35, "preopen": 0.2}[ED])
                cand_rows.append({"symbol": s, "name": NAMES.get(s, c.get("name") or s), "last": c.get("last"), "ai": s in AI,
                                  "ai_rank": ai_top.index(s) + 1 if s in ai_top else None,
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
                fp = ex.submit(front_pages, hours)
                got = list(ex.map(lambda tq: (tq[0], gnews(tq[1], hours)), queries))
                try:
                    front = fp.result()
                except Exception as e:                       # noqa: BLE001
                    log(f"front pages failed: {str(e)[:80]}"); front = []
            # the front pages: each headline under the candidate it names (else MACRO), and each candidate's salience
            for r in cand_rows:
                r["front_page"] = sum(1 for t, *_ in front if mentions(t, r["symbol"]))
            # into the pool: every front headline that names a candidate, and the 12 newest of the rest as MACRO (the pick
            # prompt stays near its v1.3 size: 343 headlines cut M3's reply at 12,000 tokens twice on 10/2, ~250-280 never did)
            fr = [(next((r["symbol"] for r in cand_rows if mentions(t, r["symbol"])), "MACRO"), [(t, pub, when, link)]) for t, pub, when, link in front]
            fr = [x for x in fr if x[0] != "MACRO"] + sorted([x for x in fr if x[0] == "MACRO"], key=lambda x: x[1][0][2], reverse=True)[:12]
            got = fr + got
            log(f"front pages: {len(front)} headlines ({', '.join(sorted({p for _, p, _, _ in front}))}); named: "
                + ", ".join(f"{r['symbol']} {r['front_page']}" for r in sorted(cand_rows, key=lambda r: -r["front_page"]) if r["front_page"]))
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

    if not REVERIFY:
        econ, econ_asof, earn, earn_next = data["econ"], data["econ_asof"], data["earnings_today"], data["earnings_next"]
        with Stage(W, "research.llm"):
            frame = {"preopen": "BEFORE THE US OPEN (the Short posts ~9:00 AM ET). Items: what moved overnight and in the premarket (futures, "
                                "premarket movers and why), and today's calendar (US economic data with ET times, Fed speakers, big earnings). "
                                "Tense: 'this morning', 'before the bell', 'today'. Never 'closed' for today.",
                     "midday": "MIDDAY (the Short posts ~1:00 PM ET, the market is OPEN). Items: what is moving so far today and why. "
                               "Tense: 'so far', 'this afternoon', 'midday'. Never 'closed' for today.",
                     "close": "AFTER THE CLOSE (the Short posts ~4:20 PM ET). Items: what moved in today's session and why, plus a big "
                              "after-the-bell report if one is out. Tense: past, 'today', 'closed'.",
                     # v1.1.0 (owner, 10/1): Korea's AI-chip names for US investors, mid-to-long term, never day-to-day
                     "korea-open": "SEOUL OPEN (the Short posts ~8:00 PM CT, about 35 minutes into the KRX session in Seoul; US investors "
                                   "watch it the evening before the next US session). MID-TO-LONG TERM, not day to day: Korea's AI memory "
                                   "and chip-equipment names (SK hynix, Samsung Electronics, Hanmi Semiconductor and peers) in the context "
                                   "of their PAST-MONTH move (field m1, the window the app's pages show tonight), WHY (HBM and AI memory "
                                   "demand, memory prices, earnings dates, foreign investors), and what it means as context for the US AI "
                                   "chip names a US investor holds (Micron, Nvidia): context only, never a call on the US open. The KRX "
                                   "session move (field pct) may be mentioned with 'so far' or 'in Seoul'. Tense: 'in Seoul', 'so far', "
                                   "'this month', 'over the past month'.",
                     # v1.2.0 (owner 10/1): a third Seoul edition, mid-session
                     "korea-midday": "SEOUL MIDDAY (the Short posts ~10:20 PM CT, around noon in Seoul, the KRX session half done; "
                                     "US investors watch it the night before the next US session). MID-TO-LONG TERM: how Korea's AI "
                                     "chip names (SK hynix, Samsung Electronics, Hanmi Semiconductor and peers) stand THIS YEAR (field "
                                     "ytd, the window the app's pages show tonight) and WHY (HBM and AI memory demand, memory prices, "
                                     "earnings dates, foreign investors), how they are trading so far in the Seoul session, and the "
                                     "read-through for the US AI chip names a US investor holds (Micron, Nvidia): context only, never a "
                                     "call on the US open. The KRX session move (field pct) may be mentioned with 'so far' or 'in "
                                     "Seoul'. Tense: 'in Seoul', 'so far', 'at midday', 'this year'.",
                     "korea-close": "SEOUL CLOSE, THE LONG VIEW (the Short posts ~2:15 AM CT, after the KRX close at 3:30 PM KST; US "
                                    "investors read it in their morning). MID-TO-LONG TERM: the THREE-MONTH trend (field m3, the window the "
                                    "app's pages show) of Korea's AI chip names and the US chip names they move with, WHY over that "
                                    "horizon (HBM supply and demand, memory prices, AI spending, earnings dates), upcoming dated events "
                                    "(only with the date a headline states), and the read-through for an AI-heavy portfolio's "
                                    "concentration. The KRX session move (field pct) may lead an item ('closed up 3.2% in Seoul'). "
                                    "Tense: 'closed', 'over three months', 'in Seoul'."}[ED]
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

    {KR_PICK if KR else US_PICK}
    For each item:
    - "kind": "stock" | "macro" | "earnings" | "calendar"
    - "symbols": the tickers it is about ([] for pure macro)
    - "cover": a 2-4 word headline for the title card, company or event name first, e.g. "Micron beats." / "Meta slips." / "Jobs report at 8:30."
    - "why": one plain sentence, <= 14 words: what happened and WHY (the cause), only what the cited headlines say
    - "why_ids": headline ids from AT LEAST TWO DIFFERENT publishers that state that cause
    - "sentiment": THE READ, one plain sentence, <= 9 words, said directly in the video's own voice with NO attribution (never
      "Analysts / Commentators / Investors / Traders say, see, call, cite, expect ...", never "according to"): a FACT that puts the
      story in context: its scale ("Its biggest one-day gain since March." only if a headline states it), the driver ("Memory
      prices rose for a third straight month."), what it means as a fact, or what comes next with its date ("Results are due
      October 23."). Never an opinion or forecast stated as fact, never advice. It must be something at least TWO different
      publishers' headlines state; if none is shared, use the market's reaction the quotes show ("Shares barely moved after hours.").
    - "sentiment_ids": ids from AT LEAST TWO DIFFERENT publishers whose headline states that read or reaction
    - "figures": [{{"symbol": "MU", "field": "pct", "value": -1.84}}] every number the item needs, copied from QUOTES/MACRO ({FIG_FIELDS}); [] if none
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
                 "TWO DIFFERENT publishers (use the ids below; SENTIMENT is a direct fact in our own voice with no 'analysts / " \
                 "commentators / investors say' attribution; use a reaction the quotes show if no fact is shared), drop any figure " \
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
    # Korea editions are Korea-first (owner, 10/2): at least two kept items about KRX listings (or the KOSPI)
    kr_n = lambda its: sum(1 for i in its if any(KRM.is_kr(s) for s in i.get("symbols", [])))
    if (len(kept) < 3 or (KR and kr_n(kept) < 2)) and not REVERIFY:
        # one fresh pick before refusing: other stories, or the same ones told only with what two publishers state
        with Stage(W, "research.second_pick"):
            note = ("\n\nA first pick kept only these items: " + "; ".join(i["cover"] for i in kept) + ". These FAILED verification "
                    "(do not repeat them as written): " + "; ".join(f"{d.get('cover')} ({'; '.join(d.get('drop', []))[:160]})" for d in dropped)
                    + ". Pick 6 items again; each WHY and READ must be stated by two different publishers' headlines, word for word close."
                    + (" At least 4 of the 6 must be about KRX listings (SK hynix, Samsung Electronics, Hanmi Semiconductor and peers, "
                       "or the KOSPI), using the Korean newsrooms' headlines too." if KR else ""))
            pick2 = llm(W, "You are a careful markets editor for a 25-second video. You only state what the cited headlines and quotes support.", prompt + note)
            k2, d2 = verify(pick2.get("items", []), byid, rowsym, macro)
            have = {tuple(i.get("symbols", [])) or (i["cover"],) for i in kept}
            kept += [i for i in k2 if (tuple(i.get("symbols", [])) or (i["cover"],)) not in have]
            dropped += d2
    if not KR and kept:
        # v1.4.0 (owner 10/2): the verified items in the order the storyline reads them: the LLM's pick, then AI first, front-page
        # salience, and a positive story ahead of a comparable negative one. A drop of 5%+ or one the front pages lead with keeps
        # its place (truthful, not cheerleading). Stable: equal scores keep the pick's order. Korea editions keep the pick's
        # order (Korea-first is the storyline's gate).
        rs = {r["symbol"]: r for r in cand_rows}
        def rank_note(i, it):
            rows = [rs[x] for x in it.get("symbols", []) if x in rs]
            mv = next((f.get("value") for f in it.get("figures", []) if f.get("ok") and f.get("field", "pct") == "pct"), None)
            if mv is None and rows: mv = rows[0].get("pct_feed1")
            front = max([r.get("front_page", 0) for r in rows] or [0]); ai = any(r.get("ai") for r in rows)
            big_neg = mv is not None and mv < 0 and (mv <= -5 or front >= 2)
            score = i - 1.2 * ai - 0.5 * min(front, 3) - (0.6 if (mv or 0) > 0 else 0) + (0.6 if (mv or 0) < 0 and not big_neg else 0)
            return {"pick": i + 1, "ai": ai, "front_page": front, "move": mv, "score": round(score, 2)}
        for i, it in enumerate(kept): it["rank_note"] = rank_note(i, it)
        kept.sort(key=lambda it: it["rank_note"]["score"])
        log("ranked: " + " | ".join(f"{it['cover']} ({it['rank_note']})" for it in kept))
    for d in dropped: log("DROP", d.get("cover"), d.get("drop"))
    res = {"edition": ED, "date": DATE, "asof_et": data["asof_et"], "context": pick.get("context", ""),
           "hot": [s for s in pick.get("hot", []) if s in {r["symbol"] for r in cand_rows if r["feeds_agree"]}],
           "items": kept, "dropped": dropped, "model": pick.get("_model")}
    jdump(res, os.path.join(W, "research.json"))
    log(f"kept {len(kept)} items: " + " | ".join(i["cover"] for i in kept))
    if len(kept) < 3:
        sys.exit(f"REFUSE: only {len(kept)} research items survived verification (need 3)")
    if KR and kr_n(kept) < 2:
        sys.exit(f"REFUSE: only {kr_n(kept)} verified items are about KRX listings (a Korea Short needs 2 of its 3)")


UP = r"(?:rose|rises|climbed|jumped|jumps|gained|rallied|advanced|popped|pops|higher|up)"
DOWN = r"(?:fell|falls|dropped|drops|slid|slides|sank|sinks|slipped|slips|declined|tumbled|lower|down)"
FLAT = r"(?:barely (?:moved|moves|budged|budges|reacted)|\bbarely\b|flat|little changed|unchanged|muted|isn't moving|is not moving|unmoved)"   # 10/1 close: "barely budged" on +3.03% slipped through


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
            if not (ext or re.search(r"\b(shares|stock|stocks|closed|trading)\b", clause, re.I) or (KR and window_field(clause))):
                continue                                    # "revenue jumped 11-fold" is not a price claim
            wf = window_field(clause) if KR else None
            if wf:                                          # "down 28% over three months": the window's two histories
                w = (r.get("win") or {}).get(wf) or {}
                a, b = (w.get("a"), w.get("b")) if w.get("ok") else (None, None)
                if a is None: bad.append(f"{s}: a {wf} claim without two agreeing histories"); continue
            elif ext and ED != "preopen":
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
        if attributed(it.get("sentiment")):          # v1.4.0: the read is ours, direct (owner 10/2)
            reasons.append(f"sentiment: third-party attribution '{attributed(it.get('sentiment'))}' (say the fact directly, in our own voice)")
        reasons += direction_conflicts(it, rowsym)
        figs = []
        for f in it.get("figures", []):
            s, v = f.get("symbol"), f.get("value")
            r = rowsym.get(s); m = macro.get(s)
            fld = f.get("field") or "pct"
            if r and fld in ("m1", "m3", "ytd"):
                # a long window (Korea editions): both histories agree and the value is theirs (the app page shows feed a)
                w = (r.get("win") or {}).get(fld) or {}
                ok = bool(w.get("ok")) and agree(v, w.get("a"), 0.06) and (not KR or fld == KRM.RANGE_FIELD[KRM.RANGE[ED]])
                figs.append({**f, "feed1": w.get("a"), "feed2": w.get("b"), "ok": ok})
            elif r:
                live = {"close": 0.051, "midday": 0.35, "preopen": 0.2, "korea-close": 0.051, "korea-open": 0.35, "korea-midday": 0.35}[ED]
                ok = r["feeds_agree"] and agree(v, r["pct_feed1"], 0.051 if ED != "preopen" else 0.15) and agree(v, r["pct_feed2"], live)
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
         "something moved or matters); a WHY that only restates the move ('shares fell to a low') is why_ok false. A SENTIMENT must " \
         "be a FACT the headlines state (not an opinion or forecast presented as fact); otherwise sentiment_ok false. Return {\"verdicts\": [{\"n\": 1, \"why_ok\": true, " \
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
