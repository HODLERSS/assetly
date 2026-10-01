#!/usr/bin/env python3
"""Stage 5, the numbers on screen: the portfolio figures the app shows, re-derived from a second source, and the
Ask answer's figures checked against them.

    facts.py <edition> <work-dir> [--ask]

Without --ask (after the account stage): reads the account's rows from the app (the `portfolio` view: the same
numbers Home draws) and recomputes them from Nasdaq quotes (a second, independent feed). A figure is usable only when
both agree (total within 0.1%, day % within 0.03 points, all-time % within 0.1 points); a disagreement drops it.
Also the week (7-day) and month (30-day) change of the portfolio and every holding, from the app's price history and
from Nasdaq daily history. Writes <work>/facts.json.

With --ask (after the take): every $ and % figure in the on-screen Ask answer must match one of those figures
(either window convention, either feed) within rounding, or the stage refuses. Writes <work>/ask-check.json.
"""
import json, os, re, sys
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import ET, Stage, _num, agree, get, jdump, jload, log, nasdaq, rest

ED, W = sys.argv[1], sys.argv[2]


def history(sym, days=40):
    """Nasdaq daily closes {YYYY-MM-DD: close}."""
    to = datetime.now(ET).date(); fr = to - timedelta(days=days)
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=stocks&fromdate={fr}&todate={to}&limit=400", tries=2))
        return {datetime.strptime(r["date"], "%m/%d/%Y").strftime("%Y-%m-%d"): _num(r["close"]) for r in d["data"]["tradesTable"]["rows"]}
    except Exception:                                    # noqa: BLE001
        return {}


def base_at(hist, ymd):
    ks = sorted(k for k in hist if k <= ymd)
    return hist[ks[-1]] if ks else None


def money(x): return f"${abs(round(x)):,}"


def short_name(n):
    """The name people say: "AppLovin Corporation" -> "AppLovin" (Whisper heard the long form as "app love inc")."""
    n = re.sub(r"\s*(?:Common Stock|Class [A-C]( Common Stock)?|Ordinary Shares|American Depositary Shares)\b.*$", "", str(n or ""))
    for _ in range(2):
        n = re.sub(r",?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Holdings?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|Group|Technologies|Technology|Platforms)$", "", n.strip())
    return n.strip()


def main_facts():
    acct = jload(os.path.join(W, "account.json")); uid = acct["uid"]
    with Stage(W, "facts.portfolio"):
        rows = rest(W, f"portfolio?select=symbol,name,kind,qty,price,value,change_pct,avg_cost,total_gl&user_id=eq.{uid}")
        eq = [r for r in rows if not str(r["symbol"]).startswith("$")]
        cash = sum(float(r["value"] or 0) for r in rows if str(r["symbol"]).startswith("$"))
        app_total = sum(float(r["value"] or 0) for r in rows)
        app_day = sum(float(r["value"]) * float(r["change_pct"] or 0) / (100 + float(r["change_pct"] or 0)) for r in eq)
        cost = sum(float(r["qty"]) * float(r["avg_cost"]) for r in eq)
        app_gl = sum(float(r["total_gl"] or 0) for r in eq)
        nq = {r["symbol"]: nasdaq(r["symbol"]) or {} for r in eq}
        n_total = cash + sum(float(r["qty"]) * (nq[r["symbol"]].get("last") or 0) for r in eq)
        n_day = sum(float(r["qty"]) * (nq[r["symbol"]].get("chg") or 0) for r in eq)
        n_gl = sum(float(r["qty"]) * ((nq[r["symbol"]].get("last") or 0) - float(r["avg_cost"])) for r in eq)
        # Home's convention (9/30 take: "Today +$2,152 (+0.86%)"): the day's gain over the invested positions, cash excluded
        app_day_pct = 100 * app_day / (app_total - cash - app_day); n_day_pct = 100 * n_day / (n_total - cash - n_day)
        figs, checks = {}, []
        def keep(name, a, b, tol, fmt):
            ok = agree(a, b, tol); checks.append({"figure": name, "app": round(a, 4), "nasdaq": round(b, 4), "ok": ok})
            if ok: figs[name] = fmt(a)
        keep("total", app_total, n_total, app_total * 0.001, money)
        keep("day_usd", app_day, n_day, max(25, abs(app_day) * 0.05), money)
        keep("day_pct", app_day_pct, n_day_pct, 0.03, lambda v: f"{abs(v):.2f}%")
        keep("day_pct_1", app_day_pct, n_day_pct, 0.03, lambda v: f"{abs(v):.1f}%")
        keep("alltime_usd", app_gl, n_gl, max(50, abs(app_gl) * 0.003), money)
        keep("alltime_pct", 100 * app_gl / cost, 100 * n_gl / cost, 0.1, lambda v: f"{abs(v):.2f}%")
        keep("alltime_pct_0", 100 * app_gl / cost, 100 * n_gl / cost, 0.1, lambda v: f"{abs(v):.0f}%")
        # windows: the app's price history and Nasdaq daily closes, both conventions the app uses (7 and 30 days back)
        # Window anchors: the run's market date (the session the figures belong to) AND the wall-clock ET date when they
        # differ (a run after midnight ET: 9/30 clean run 1 computed "the week" from Oct 1 and the app's Ask from Sep 30)
        import calendar as _c
        win = {}
        mdate = datetime.strptime(jload(os.path.join(W, "research-data.json"))["date"], "%Y-%m-%d").date()
        # ...and the LAST SESSION: before the open (and through the night) the app's Ask counts its windows from the previous
        # trading day's close (10/1 4 AM pre-open: "1W -$393" is Sep 30 back to Sep 23)
        def prev_session(d):
            d = d - timedelta(days=1)
            while d.weekday() >= 5: d -= timedelta(days=1)
            return d
        wall = datetime.now(ET).date(); seen, anchors = set(), []
        for sfx, d in (("", mdate), ("_w", wall), ("_p", prev_session(mdate)), ("_pw", prev_session(wall))):
            if d not in seen: seen.add(d); anchors.append((sfx, d))
        def months_back(today, n):
            y, m = today.year, today.month - n
            while m <= 0: m += 12; y -= 1
            return today.replace(year=y, month=m, day=min(today.day, _c.monthrange(y, m)[1]))
        # "week"/"month" are what a line may say; the rest only verify an Ask answer (1M calendar, 3M, 1Y, YTD)
        # the app's Ask labels 1M as the same date a month back (9/30: base Aug 28 close, +3.8%), so "month" means that
        CUTS = []
        for sfx, today in anchors:
            CUTS += [("week" + sfx, today - timedelta(days=7)), ("month" + sfx, months_back(today, 1)), ("d30" + sfx, today - timedelta(days=30)),
                     ("m3" + sfx, today - timedelta(days=90)), ("m3cal" + sfx, months_back(today, 3)), ("y1" + sfx, today - timedelta(days=365)),
                     ("ytd" + sfx, today.replace(month=1, day=1) - timedelta(days=1))]
        for r in eq:
            s = r["symbol"]; h = history(s, 400)
            for lab, dt in CUTS:
                ymd = str(dt)
                ph = rest(W, f"price_history?select=ts,price&symbol=eq.{s}&ts=lte.{ymd}T23:59:59Z&order=ts.desc&limit=1")
                a = float(ph[0]["price"]) if ph else None
                b = base_at(h, ymd)
                win.setdefault(s, {})[lab] = {"app_base": a, "nasdaq_base": b}
        port = {}
        for lab, _ in CUTS:
            for src in ("app_base", "nasdaq_base"):
                last = {r["symbol"]: (float(r["price"]) if src == "app_base" else nq[r["symbol"]].get("last")) for r in eq}
                bases = {s: win[s][lab][src] for s in win}
                if all(bases.values()) and all(last.values()):
                    now_v = sum(float(r["qty"]) * last[r["symbol"]] for r in eq); then_v = sum(float(r["qty"]) * bases[r["symbol"]] for r in eq)
                    port[f"{lab}_{src}"] = {"usd": now_v - then_v, "pct": 100 * (now_v - then_v) / (then_v + cash), "pct_eq": 100 * (now_v - then_v) / then_v}
        for lab in ("week", "month"):
            a, b = port.get(f"{lab}_app_base"), port.get(f"{lab}_nasdaq_base")
            if a and b:
                keep(f"{lab}_pct", a["pct_eq"], b["pct_eq"], 0.15, lambda v: f"{abs(v):.1f}%")   # Ask's convention (cash excluded)
                keep(f"{lab}_usd", a["usd"], b["usd"], max(50, abs(a["usd"]) * 0.02), money)
        holdings = []
        for r in eq:
            s = r["symbol"]; n = nq[s]
            hrow = {"symbol": s, "name": r.get("name") or s, "value": round(float(r["value"])), "day_pct": float(r["change_pct"] or 0),
                    "day_pct_nasdaq": n.get("pct"), "gain_usd": round(float(r["total_gl"] or 0)),
                    "gain_pct": 100 * float(r["total_gl"] or 0) / (float(r["qty"]) * float(r["avg_cost"])), "weight": 100 * float(r["value"]) / app_total}
            for lab, _ in CUTS:
                w = win[s][lab]; hrow[f"{lab}_app"] = 100 * (float(r["price"]) / w["app_base"] - 1) if w["app_base"] else None
                # the holding's own dollar change over the window ("HPE +$468 this week"), both feeds
                hrow[f"{lab}_usdA"] = float(r["qty"]) * (float(r["price"]) - w["app_base"]) if w["app_base"] else None
                hrow[f"{lab}_usdN"] = float(r["qty"]) * ((n.get("last") or 0) - w["nasdaq_base"]) if w["nasdaq_base"] and n.get("last") else None
                hrow[f"{lab}_nasdaq"] = 100 * ((n.get("last") or 0) / w["nasdaq_base"] - 1) if w["nasdaq_base"] and n.get("last") else None
            holdings.append(hrow)
        best = max(holdings, key=lambda h: h["gain_usd"])
        facts = {"portfolio": {"name": "My portfolio", "total": figs.get("total"), "today": (("up " if app_day >= 0 else "down ") + figs["day_pct_1"]) if "day_pct_1" in figs else None,
                               "today_usd": figs.get("day_usd"), "all_time": figs.get("alltime_pct_0"), "all_time_usd": figs.get("alltime_usd"),
                               "week": (("up " if port.get("week_app_base", {}).get("usd", 0) >= 0 else "down ") + figs["week_pct"]) if "week_pct" in figs else None,
                               "month": (("up " if port.get("month_app_base", {}).get("usd", 0) >= 0 else "down ") + figs["month_pct"]) if "month_pct" in figs else None,
                               "today_note": "Home shows Today as the day's gain over the invested positions (cash excluded)",
                               "biggest_gain": {"name": best["name"], "gain": money(best["gain_usd"]), "pct": f"{best['gain_pct']:.0f}%"},
                               "positions": len(eq)},
                 "figures": figs, "checks": checks, "holdings": holdings, "windows": port,
                 "names": {h["symbol"]: short_name(h["name"]) for h in holdings}}
        facts["figures"]["best_gain"] = money(best["gain_usd"]); facts["figures"]["best_gain_pct"] = f"{best['gain_pct']:.0f}%"
        jdump(facts, os.path.join(W, "facts.json"))
        log("portfolio facts: " + json.dumps(facts["portfolio"]))
        bad = [c for c in checks if not c["ok"]]
        if bad: log("DROPPED (feeds disagree):", bad)


def main_ask():
    facts = jload(os.path.join(W, "facts.json")); ask = jload(os.path.join(W, "ask.json"))
    with Stage(W, "facts.ask"):
        cands_pct, cands_usd = [], []
        f = facts
        for k, v in f["windows"].items():
            if not k.endswith("_app_base"): continue
            o = f["windows"].get(k.replace("_app_base", "_nasdaq_base"))
            if not o or not agree(v["pct"], o["pct"], 0.15):
                continue                                # a window only one source can compute verifies nothing
            cands_pct += [abs(v["pct"]), abs(v["pct_eq"]), abs(o["pct"]), abs(o["pct_eq"])]; cands_usd += [abs(v["usd"]), abs(o["usd"])]
        for c in f["checks"]:
            for side in ("app", "nasdaq"):
                (cands_pct if "pct" in c["figure"] else cands_usd).append(abs(c[side]))
        for h in f["holdings"]:
            cands_usd += [h["value"], abs(h["gain_usd"])]
            cands_pct += [abs(x) for x in (h["day_pct"], h["day_pct_nasdaq"], h["gain_pct"], h["weight"]) if x is not None]
            for k, v in h.items():
                if k.endswith("_usdA") and v is not None and h.get(k[:-1] + "N") is not None and abs(v - h[k[:-1] + "N"]) <= max(3, 0.01 * abs(v)):
                    cands_usd += [abs(v), abs(h[k[:-1] + "N"])]
                if k.endswith("_app") and v is not None and h.get(k[:-4] + "_nasdaq") is not None and agree(v, h[k[:-4] + "_nasdaq"], 0.15):
                    cands_pct += [abs(v), abs(h[k[:-4] + "_nasdaq"])]
        for c in f["checks"]:
            if c["figure"] == "total": cands_usd += [c["app"], c["nasdaq"]]
        # dividends ("~$3.30 to your 22 shares"): the Nasdaq dividend history x the shares held, a second source for the app's math
        qty = {r["symbol"]: float(r["qty"]) for r in rest(W, f"portfolio?select=symbol,qty&user_id=eq.{jload(os.path.join(W, 'account.json'))['uid']}")}
        for sym, q in qty.items():
            if sym.startswith("$"): continue
            try:
                dv = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/dividends?assetclass=stocks", tries=1))["data"]
                rows = ((dv.get("dividends") or {}).get("rows") or [])[:1]
                for amt in [_num(rows[0].get("amount"))] if rows else []:
                    if amt: cands_usd += [amt, amt * q]
                ann = _num(dv.get("annualizedDividend"))
                if ann: cands_usd += [ann, ann * q]
            except Exception:                            # noqa: BLE001
                pass
        ans = ask["answer"]
        heads = [{"publisher": h["publisher"], "title": h["title"]} for h in jload(os.path.join(W, "research-data.json"))["headlines"]]
        # plus the app's own stored news for the holdings (title + summary, many publishers): the same pool Ask read
        syms = ",".join(h["symbol"] for h in f["holdings"])
        try:
            heads += [{"publisher": n.get("source") or "?", "title": f"{n.get('title') or ''} {n.get('summary') or ''}"}
                      for n in rest(W, f"news?select=source,title,summary&symbol=in.({syms})&order=published_at.desc&limit=400")]
        except Exception:                                # noqa: BLE001
            pass
        found, verified, unverified = [], [], []
        for m in re.finditer(r"([+\-−]?\$[\d,]+(?:\.\d+)?(?:\s?[kKmMbB]\b)?)|([+\-−]?\d+(?:\.\d+)?%)", ans):
            tok = m.group(0); found.append(tok)
            v = float(re.sub(r"[^\d.]", "", tok.split()[0]) or 0)
            if tok.endswith("%"):
                # tolerance follows the shown precision: "+31%" covers 30.5-31.5, "+3.8%" 3.75-3.85 (+0.1 feed slack)
                dec = len(tok.rstrip("%").split(".")[1]) if "." in tok else 0
                ok = any(abs(v - c) <= 0.5 * 10 ** -dec + 0.1 for c in cands_pct)
            else:
                mult = 1e3 if re.search(r"[kK]$", tok) else 1e6 if re.search(r"[mM]$", tok) else 1e9 if re.search(r"[bB]$", tok) else 1
                v *= mult
                ok = any(abs(v - c) <= max(3, 0.006 * c) for c in cands_usd)
            if not ok:
                # a company figure, not a portfolio one ("Micron guided ~$61.5B"): two publishers' headlines must carry it
                core = re.sub(r"[^\d.]", "", tok.split()[0])
                pubs = {h["publisher"] for h in heads if core and re.search(r"(?<![\d.])" + re.escape(core) + r"(?![\d])", h["title"])}
                ok = len(pubs) >= 2
            (verified if ok else unverified).append(tok)
        res = {"question": ask["question"], "answer": ans, "figures": found, "verified": verified, "unverified": unverified}
        jdump(res, os.path.join(W, "ask-check.json"))
        log(f"ask figures: {len(verified)} verified {verified}, unverified {unverified}")
        if unverified:
            sys.exit(f"REFUSE: the Ask answer shows figures no second source confirms: {unverified}")


if "--ask" in sys.argv:
    main_ask()
else:
    main_facts()
