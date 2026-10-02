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
from lib import ET, Stage, _num, agree, cnbc, get, jdump, jload, log, nasdaq, rest, stale_moves
import kr as KRM

ED, W = sys.argv[1], sys.argv[2]
KR = ED in KRM.KR_EDITIONS
FX = {}                       # Korea editions: won per dollar, "app" (the app's USDKRW row) and "two" (CNBC KRW=)


def history(sym, days=40):
    """Nasdaq daily closes {YYYY-MM-DD: close}; a KRX name: Daum's KRX official closes in dollars at the second rate."""
    if KRM.is_kr(sym):
        return {k: v[0] / FX["two"] for k, v in KRM.daum_days(sym, 2).items()}
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
        n = re.sub(r",?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Holdings?|Co\.?|Company|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|Group|Technologies|Technology|Platforms)$", "", n.strip().rstrip(","))
    return n.strip().rstrip(",")


def main_facts():
    acct = jload(os.path.join(W, "account.json")); uid = acct["uid"]
    with Stage(W, "facts.portfolio"):
        rows = rest(W, f"portfolio?select=symbol,name,kind,qty,price,value,change_pct,as_of,avg_cost,total_gl,currency&user_id=eq.{uid}")
        # v1.2.0 stale-session guard (the app's 10/2 fix): a day move printed in an earlier session is not today's (before
        # the first KRX bar the row still holds yesterday's +3.2%); it is withheld, so no day figure and no Ask check uses it
        try:
            stale = stale_moves(rows)
        except RuntimeError as e:
            sys.exit(f"REFUSE: {e}")
        for r in rows:
            if r["symbol"] in stale: r["change_pct"] = None
        if stale: log(f"day moves withheld (not this session's): {sorted(stale)}")
        mdate0 = jload(os.path.join(W, "research-data.json"))["date"]
        if any(r.get("currency") == "KRW" for r in rows):
            # Home converts won holdings at the app's USDKRW (format.ts convertCcy); the recompute uses CNBC's rate and
            # Daum's KRX price, so a figure only stands when both conversions agree
            FX["app"], FX["two"] = KRM.fx_pair(rest(W, "prices?select=symbol,price&symbol=eq.USDKRW"))
            if not FX["app"] or not FX["two"] or abs(FX["app"] / FX["two"] - 1) > 0.004:
                sys.exit(f"REFUSE: the won rate disagrees or is missing (app {FX.get('app')}, CNBC {FX.get('two')})")
            for r in rows:
                if r.get("currency") == "KRW":
                    r["price_krw"] = r["price"]
                    for k in ("price", "value", "avg_cost", "total_gl"):
                        if r.get(k) is not None: r[k] = float(r[k]) / FX["app"]
        eq = [r for r in rows if not str(r["symbol"]).startswith("$")]
        cash = sum(float(r["value"] or 0) for r in rows if str(r["symbol"]).startswith("$"))
        app_total = sum(float(r["value"] or 0) for r in rows)
        app_day = sum(float(r["value"]) * float(r["change_pct"] or 0) / (100 + float(r["change_pct"] or 0)) for r in eq)
        cost = sum(float(r["qty"]) * float(r["avg_cost"]) for r in eq)
        app_gl = sum(float(r["total_gl"] or 0) for r in eq)
        def second(r):
            if r.get("currency") != "KRW": return nasdaq(r["symbol"]) or {}
            q = KRM.kr_quote(r["symbol"], mdate0)
            if not q.get("last2"): return {}
            prev = q["last2"] / (1 + q["pct2"] / 100)
            return {"last": q["last2"] / FX["two"], "pct": q["pct2"], "chg": (q["last2"] - prev) / FX["two"]}
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:      # one quote per holding, side by side (v1.3.0)
            nq = dict(zip([r["symbol"] for r in eq], ex.map(second, eq)))
        n_total = cash + sum(float(r["qty"]) * (nq[r["symbol"]].get("last") or 0) for r in eq)
        n_day = sum(float(r["qty"]) * (nq[r["symbol"]].get("chg") or 0) for r in eq)
        n_gl = sum(float(r["qty"]) * ((nq[r["symbol"]].get("last") or 0) - float(r["avg_cost"])) for r in eq)
        # Home's convention (9/30 take: "Today +$2,152 (+0.86%)"): the day's gain over the invested positions, cash excluded
        app_day_pct = 100 * app_day / (app_total - cash - app_day); n_day_pct = 100 * n_day / (n_total - cash - n_day)
        figs, checks = {}, []
        def keep(name, a, b, tol, fmt):
            ok = agree(a, b, tol); checks.append({"figure": name, "app": round(a, 4), "nasdaq": round(b, 4), "ok": ok})
            if ok: figs[name] = fmt(a)
        live_kr = KR and KRM.krx_open_now()
        keep("total", app_total, n_total, app_total * (0.003 if live_kr else 0.0015 if KR else 0.001), money)
        if not KR:
            # Korea editions say no "today" figure: Home's Today sums only the markets whose session is today on their own
            # calendar (portfolio.ts dayGroups), US and KRX sessions cross midnight there, so the voice keeps to all time
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
        mdate = datetime.strptime(mdate0, "%Y-%m-%d").date()
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
        # v1.3.0 (the 20-minute budget): the ~300 lookups (holdings x window cuts) run side by side, same queries, same results
        def one(r):
            s = r["symbol"]; h = history(s, 400); out = {}
            for lab, dt in CUTS:
                ymd = str(dt)
                ph = rest(W, f"price_history?select=ts,price&symbol=eq.{s}&ts=lte.{ymd}T23:59:59Z&order=ts.desc&limit=1")
                a = float(ph[0]["price"]) if ph else None
                if a is not None and r.get("currency") == "KRW": a /= FX["app"]
                out[lab] = {"app_base": a, "nasdaq_base": base_at(h, ymd)}
            return s, out
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            for s, out in ex.map(one, eq): win.setdefault(s, {}).update(out)
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
            hrow = {"symbol": s, "name": r.get("name") or s, "value": round(float(r["value"])), "value_n": round(float(r["qty"]) * (n.get("last") or 0)),
                    "day_pct": None if r["change_pct"] is None else float(r["change_pct"]),
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
        # group weights the Ask may state ("memory chips are 31% of your portfolio"): a fixed taxonomy (kr.py), never
        # arbitrary sums, each as a share of assets (the Ask's own base, ask/index.ts weight())
        groups = {}
        for g, members in (("memory", KRM.MEMORY), ("chips", KRM.CHIPS), ("chips_no_samsung", KRM.CHIPS - {"005930.KS"}),
                           ("korea", {h["symbol"] for h in holdings if KRM.is_kr(h["symbol"])}),
                           ("memory_kr", {"000660.KS", "005930.KS"}), ("us", {h["symbol"] for h in holdings if not KRM.is_kr(h["symbol"])})):
            hs = [h for h in holdings if h["symbol"] in members]
            if hs: groups[g] = round(sum(h["weight"] for h in hs), 2)
        facts["groups"] = groups
        facts["figures"]["best_gain"] = money(best["gain_usd"]); facts["figures"]["best_gain_pct"] = f"{best['gain_pct']:.0f}%"
        jdump(facts, os.path.join(W, "facts.json"))
        log("portfolio facts: " + json.dumps(facts["portfolio"]))
        bad = [c for c in checks if not c["ok"]]
        if bad: log("DROPPED (feeds disagree):", bad)


def main_ask():
    facts = jload(os.path.join(W, "facts.json")); ask = jload(os.path.join(W, "ask.json"))
    with Stage(W, "facts.ask"):
        # v1.4.0 (lead 10/2: per-figure typing): dollar candidates are kept by kind, and a figure is checked against the kinds
        # its own bullet speaks of (a day move only against day moves, a window only against windows, a value only against
        # values). cands_usd = values, totals, groups, cash, dividends; day_c / win_c the typed moves
        cands_pct, cands_usd, day_c, win_c = [], [], [], []
        f = facts
        for k, v in f["windows"].items():
            if not k.endswith("_app_base"): continue
            o = f["windows"].get(k.replace("_app_base", "_nasdaq_base"))
            if not o or not agree(v["pct"], o["pct"], 0.15):
                continue                                # a window only one source can compute verifies nothing
            cands_pct += [abs(v["pct"]), abs(v["pct_eq"]), abs(o["pct"]), abs(o["pct_eq"])]; win_c += [abs(v["usd"]), abs(o["usd"])]
        for c in f["checks"]:
            for side in ("app", "nasdaq"):
                (cands_pct if "pct" in c["figure"] else day_c if c["figure"].startswith("day") else
                 cands_usd if c["figure"] == "total" else win_c).append(abs(c[side]))
        for h in f["holdings"]:
            cands_usd += [h["value"]]; win_c += [abs(h["gain_usd"])]
            cands_pct += [abs(x) for x in (h["gain_pct"], h["weight"]) if x is not None]
            # a day move verifies only when both feeds carry it for this session and agree (v1.2.0: alone, the app's
            # row could be yesterday's KRX move before the first bar, and the second feed's alone is one source)
            if h["day_pct"] is not None and h["day_pct_nasdaq"] is not None and agree(h["day_pct"], h["day_pct_nasdaq"], 0.35):
                cands_pct += [abs(h["day_pct"]), abs(h["day_pct_nasdaq"])]
            # mid-session KRX (10/2 korea-midday: Hanmi 1M app +28.34 vs Daum +28.10, refused): the app's price row and
            # Daum's trade are minutes apart while both histories agree on the base; the measured gap between the two
            # day moves (same previous close) is that price lag, so a window may differ by it, scaled, capped at 0.35
            lag = min(0.35, abs(h["day_pct"] - h["day_pct_nasdaq"])) if KRM.is_kr(h["symbol"]) and h["day_pct"] is not None \
                and h["day_pct_nasdaq"] is not None and KRM.krx_open_now() else 0
            for k, v in h.items():
                if k.endswith("_usdA") and v is not None and h.get(k[:-1] + "N") is not None and abs(v - h[k[:-1] + "N"]) <= max(3, 0.01 * abs(v)):
                    win_c += [abs(v), abs(h[k[:-1] + "N"])]
                if k.endswith("_app") and v is not None and h.get(k[:-4] + "_nasdaq") is not None and agree(v, h[k[:-4] + "_nasdaq"], 0.15 + lag * (1 + abs(v) / 100)):
                    cands_pct += [abs(v), abs(h[k[:-4] + "_nasdaq"])]
        for c in f["checks"]:
            if c["figure"] == "total": cands_usd += [c["app"], c["nasdaq"]]
        cands_pct += list((f.get("groups") or {}).values())
        # ... and the same groups in dollars ("$203,822 of $260,486" in AI chips): app values and the recompute's
        for g, members in (("memory", KRM.MEMORY), ("chips", KRM.CHIPS), ("chips_no_samsung", KRM.CHIPS - {"005930.KS"}),
                           ("korea", {h["symbol"] for h in f["holdings"] if KRM.is_kr(h["symbol"])}), ("memory_kr", {"000660.KS", "005930.KS"})):
            hs = [h for h in f["holdings"] if h["symbol"] in members]
            if not hs: continue
            a = sum(h["value"] for h in hs); b = sum(h.get("value_n") or h["value"] for h in hs)
            if abs(a - b) <= max(50, 0.004 * a): cands_usd += [a, b]
        # dividends ("~$3.30 to your 22 shares"): the Nasdaq dividend history x the shares held, a second source for the app's math
        qty = {r["symbol"]: float(r["qty"]) for r in rest(W, f"portfolio?select=symbol,qty&user_id=eq.{jload(os.path.join(W, 'account.json'))['uid']}")}
        def divs(item):                                  # one Nasdaq request per holding, side by side (v1.3.0)
            sym, q = item; got = []
            if sym.startswith("$") or KRM.is_kr(sym): return got
            try:
                dv = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/dividends?assetclass=stocks", tries=1))["data"]
                rows = ((dv.get("dividends") or {}).get("rows") or [])[:1]
                for amt in [_num(rows[0].get("amount"))] if rows else []:
                    if amt: got += [amt, amt * q]
                ann = _num(dv.get("annualizedDividend"))
                if ann: got += [ann, ann * q]
            except Exception:                            # noqa: BLE001
                pass
            return got
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            for got in ex.map(divs, list(qty.items())): cands_usd += got
        ans = ask["answer"]
        if KR:
            # a bucket the answer builds from names it lists ("AI chip bucket ~58% ($151,873): NVDA, AMD, TSM, MU, SK hynix",
            # then "Samsung raises it to ~68%"): the app picks the members, so the check follows the answer's own order:
            # running sums of the listed holdings' values (each verified on two feeds) in order of first mention
            tot = next((c["app"] for c in f["checks"] if c["figure"] == "total"), None)
            # how the answer may name a holding: ticker, code, short and Korean name, and the name's first word when no other
            # holding shares it ("Samsung" for Samsung Electronics, 10/2 korea-close: "(AMD, NVDA, TSM, SK hynix, Samsung, MU)")
            def nm_keys(h):
                full = [(f.get("names") or {}).get(h["symbol"], ""), KRM.KR_NAMES.get(h["symbol"], "")]
                firsts = {n.split()[0] for n in full if n and len(n.split()) > 1}
                others = {w for g in f["holdings"] if g is not h for w in " ".join([(f.get("names") or {}).get(g["symbol"], ""),
                          KRM.KR_NAMES.get(g["symbol"], "")]).split()}
                return {h["symbol"], h["symbol"].split(".")[0], *full, *(w for w in firsts if w not in others and len(w) >= 4)}
            pos = []
            for h in f["holdings"]:
                keys = nm_keys(h)
                hits = [m.start() for k in keys if k and len(k) >= 2 for m in re.finditer(r"(?<![A-Za-z])" + re.escape(k) + r"(?![a-z])", ans)]
                if hits: pos.append((min(hits), h))
            run_a = run_b = 0.0
            for _, h in sorted(pos, key=lambda x: x[0]):
                run_a += h["value"]; run_b += h.get("value_n") or h["value"]
                if tot: cands_usd += [run_a, run_b]; cands_pct += [100 * run_a / tot, 100 * run_b / tot]
            # ... and the same per bullet (10/2 korea-close, two takes refused: "Foundry/fab: TSM $36,736, Samsung $8,177 =
            # $44,913 (24.8%)", "Non-chip: GOOGL, MSFT, cash $7,500 = $48,666"): each bullet's own named holdings, summed
            # in its order, plus the cash row when the bullet names cash. Only names the bullet lists, never any subset
            cash = (tot - sum(h["value"] for h in f["holdings"])) if tot else None
            if cash is not None and cash >= 1: cands_usd.append(cash)
            for seg in re.split(r"\u2022|\n|\s-\s", ans):
                inseg = sorted((p_ - 0, h) for p_, h in [(min([m.start() for k in nm_keys(h) if k and len(k) >= 2
                               for m in re.finditer(r"(?<![A-Za-z])" + re.escape(k) + r"(?![a-z])", seg)] or [-1]), h) for h in f["holdings"]] if p_ >= 0)
                if len(inseg) < 2 or not tot: continue
                sa = sb = 0.0
                for _, h in sorted(inseg, key=lambda x: x[0]):
                    sa += h["value"]; sb += h.get("value_n") or h["value"]
                    cands_usd += [sa, sb]; cands_pct += [100 * sa / tot, 100 * sb / tot]
                if cash and re.search(r"\bcash\b", seg, re.I):
                    cands_usd += [sa + cash, sb + cash]; cands_pct += [100 * (sa + cash) / tot, 100 * (sb + cash) / tot]
        # v1.4.0 (10/2 midday refused on "+$9,181" and "$2.8k"; 10/1 close "$2,187", midday "$4,069"): the answer's portfolio
        # DOLLAR moves are the app's own arithmetic on its holdings at the moment it answered, minutes after the facts
        # stage. They are re-derived at take time from the account's holdings x two quote feeds (Nasdaq and CNBC: shares x
        # the day's change per share), per holding, for the whole book, and for each bullet's named holdings in its order,
        # and the app's own rows (value x day %) give the third reading. A figure stands when it is within the live band of
        # a reading that both feeds agree on (2% or $25, plus the shown rounding: "$2.8k" covers 2,750-2,850).
        live_usd = []
        if not KR:
            try:
                uid = jload(os.path.join(W, "account.json"))["uid"]
                prow = [r for r in rest(W, f"portfolio?select=symbol,qty,value,change_pct&user_id=eq.{uid}") if not str(r["symbol"]).startswith("$")]
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=8) as ex:
                    nq = dict(zip([r["symbol"] for r in prow], ex.map(lambda r: nasdaq(r["symbol"]) or {}, prow)))
                cq = cnbc([r["symbol"] for r in prow])
                day = {}
                for r in prow:
                    s_, q = r["symbol"], float(r["qty"])
                    a = float(r["value"]) * float(r["change_pct"]) / (100 + float(r["change_pct"])) if r.get("change_pct") is not None else None
                    n_ = q * nq[s_]["chg"] if (nq.get(s_) or {}).get("chg") is not None else None
                    c_ = q * cq[s_]["chg"] if (cq.get(s_) or {}).get("chg") is not None else None
                    # the two feeds must agree on the holding's day $ (live: within 2% or $10) before any reading counts
                    if n_ is not None and c_ is not None and abs(n_ - c_) <= max(10, 0.02 * abs(n_)):
                        day[s_] = [x for x in (a, n_, c_) if x is not None]
                if day and len(day) == len(prow):
                    for k in range(3):
                        tot_k = sum(v[min(k, len(v) - 1)] for v in day.values()); live_usd.append(abs(tot_k))
                for v in day.values(): live_usd += [abs(x) for x in v]
                names = {r["symbol"]: {r["symbol"], (f.get("names") or {}).get(r["symbol"], "")} for r in prow}
                for seg in re.split(r"\u2022|\n", ans):
                    hit = sorted((min(m.start() for k in ks if k and len(k) >= 2 for m in re.finditer(r"(?<![A-Za-z])" + re.escape(k) + r"(?![a-z])", seg)), s_)
                                 for s_, ks in names.items() if s_ in day and any(re.search(r"(?<![A-Za-z])" + re.escape(k) + r"(?![a-z])", seg) for k in ks if k and len(k) >= 2))
                    if len(hit) < 2: continue
                    for k in range(3):
                        run_ = 0.0
                        for _, s_ in hit:
                            run_ += day[s_][min(k, len(day[s_]) - 1)]; live_usd.append(abs(run_))
                # ... and at the answer's OWN moment: the percentages it shows next to each name (or for the whole book) times
                # the shares x the previous close both feeds agree on. Prices move between the answer and this check (10/2
                # midday: +3.2% in 6 min), the previous close does not: "+$9,181 (+3.79%)" = book x 3.79% = $9,182; "AMD
                # (+3.7%) and Nvidia (+2.6%) contribute $2.8k" = $2,751. Each shown % must pass the answer's own % check
                # (two feeds, its rounding), so it is the app's quote, not a free number
                prev = {}
                for r in prow:
                    s_ = r["symbol"]; n0, c0 = nq.get(s_) or {}, cq.get(s_) or {}
                    pn = n0["last"] - n0["chg"] if n0.get("last") is not None and n0.get("chg") is not None else None
                    pc = c0.get("prev")
                    if pn and pc and abs(pn / pc - 1) <= 0.002: prev[s_] = float(r["qty"]) * pc
                nowv = {r["symbol"]: float(r["qty"]) * ((cq.get(r["symbol"]) or {}).get("last") or 0) for r in prow}
                # a shown % is used only when it passes the answer's own % check (two feeds, the shown rounding)
                def pct_ok(t):
                    t = t.replace("\u2212", "").replace("\u2011", "").lstrip("+-"); d_ = len(t.split(".")[1]) if "." in t else 0
                    return any(abs(float(t) - c) <= 0.5 * 10 ** -d_ + 0.1 for c in cands_pct)
                book_pct = 100 * sum(day[s_][-1] for s_ in day) / sum(prev.values()) if prev and len(day) == len(prow) else None
                for seg in re.split(r"\u2022|\n", ans):
                    named = []
                    for s_, ks in names.items():
                        for k in ks:
                            # names case-blind ("Nvidia" for NVIDIA): the app writes them as people do
                            m = re.search(r"(?<![A-Za-z])" + re.escape(k) + r"(?![a-z])[^%$]{0,12}?\(?([+\-\u2212\u2011]?\d+(?:\.\d+)?)%", seg,
                                          re.I if len(k) >= 3 else 0) if k and len(k) >= 2 else None
                            if m and s_ in prev:
                                pct = float(m.group(1).replace("\u2212", "-").replace("\u2011", "-"))
                                if pct_ok(m.group(1)): named.append((m.start(), s_, pct)); break
                    if named:
                        # two conventions: the move on yesterday's value (the true day $), and the app Ask's own shortcut,
                        # today's value x the day % (10/2 midday: "Applied Digital (+10%) lifts $2.5k" = $25.5k x 10%; the
                        # book line used the first). Both are holdings x two feeds; the second overstates by the move itself
                        run_, run2 = 0.0, 0.0
                        for _, s_, pct in sorted(named):
                            run_ += prev[s_] * pct / 100; run2 += nowv[s_] * pct / 100; live_usd += [abs(run_), abs(run2)]
                    elif book_pct is not None and len(prev) == len(prow):
                        for m in re.finditer(r"([+\-\u2212]?\d+(?:\.\d+)?)%", seg):
                            pct = abs(float(m.group(1).replace("\u2212", "-")))
                            if pct_ok(m.group(1)) and abs(pct - abs(book_pct)) <= 1.5: live_usd.append(sum(prev.values()) * pct / 100)
                log(f"ask: take-time day $ from holdings x Nasdaq + CNBC: {len(day)}/{len(prow)} holdings agree, {len(live_usd)} readings")
            except Exception as e:                       # noqa: BLE001 (the checks below still run)
                log(f"ask: take-time day $ recompute failed: {str(e)[:100]}")
        heads = [{"publisher": h["publisher"], "title": h["title"]} for h in jload(os.path.join(W, "research-data.json"))["headlines"]]
        # plus the app's own stored news for the holdings (title + summary, many publishers): the same pool Ask read
        syms = ",".join(h["symbol"] for h in f["holdings"])
        try:
            heads += [{"publisher": n.get("source") or "?", "title": f"{n.get('title') or ''} {n.get('summary') or ''}"}
                      for n in rest(W, f"news?select=source,title,summary&symbol=in.({syms})&order=published_at.desc&limit=400")]
        except Exception:                                # noqa: BLE001
            pass
        WIN_W = r"\b(week|month|1W|1M|3M|6M|1Y|YTD|this year|year|years|all[- ]time|since|past \d+|\d+[- ]day|quarter|overall|gain on|cost)\b"
        LVL_W = r"\b(worth|value[sd]?|position|holds?|holding|total|cash|dividends?|bucket|exposure|weight|of your (?:assets|portfolio)|invested|=)\b"
        DAY_W = r"\b(today|so far|day|session|moving|mover|lifts?|adds?|contribut\w*|drags?|drops?|gains?|loses?|losing|falls?|rises?|up|down)\b"
        segs = [(m_.start(), m_.end()) for m_ in re.finditer(r"[^\u2022\n]+", ans)]
        def kinds(pos):
            """the kinds of dollar figure this bullet speaks of: window words win over day words; none found = any kind"""
            seg = next((ans[a:b] for a, b in segs if a <= pos < b), ans)
            k = set()
            if re.search(WIN_W, seg, re.I): k.add("win")
            if re.search(LVL_W, seg, re.I): k.add("level")
            if not k and (re.search(DAY_W, seg, re.I) or re.search(r"\btoday\b|moving", ask.get("question", ""), re.I)): k.add("day")
            return k or {"day", "win", "level"}
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
                # per-figure typing by the bullet's words (kinds() above; owner-approved 10/2, on by default):
                # SHORTS_ASK_TYPED=0 falls back to one pool of every kind
                kd = kinds(m.start()) if os.environ.get("SHORTS_ASK_TYPED", "1") != "0" else {"day", "win", "level"}
                pool = (cands_usd if "level" in kd else []) + (day_c if "day" in kd else []) + (win_c if "win" in kd else [])
                ok = any(abs(v - c) <= max(3, 0.006 * c) for c in pool)
                if not ok and live_usd and "day" in kd:
                    # the shown rounding ("$2.8k": half of 0.1k) plus the live band
                    num = tok.split()[0].rstrip("kKmMbB"); dec = len(num.split(".")[1]) if "." in num else 0
                    half = 0.5 * 10 ** -dec * mult if mult > 1 else 0.5
                    ok = any(abs(v - c) <= half + max(25, 0.02 * c) for c in live_usd)
            if not ok:
                # a company figure, not a portfolio one ("Micron guided ~$61.5B"): two publishers' headlines must carry it
                core = re.sub(r"[^\d.]", "", tok.split()[0])
                pubs = {h["publisher"] for h in heads if core and re.search(r"(?<![\d.])" + re.escape(core) + r"(?![\d])", h["title"])}
                ok = len(pubs) >= 2
            (verified if ok else unverified).append(tok)
        # wording a viewer reads on screen (owner review 10/1): desk jargon, and before the open a "today" that is really
        # the previous session ("US stocks today: +$314" at 5 AM). These prefer another take; the last take may keep them.
        quality = [f"jargon '{m.group(0)}'" for m in re.finditer(r"\b(swing factors?|narratives?|cost curves?|thesis|tape|tripwire|catalysts?|capex)\b", ans, re.I)]
        if ED == "preopen":
            quality += [f"says 'today' for the previous session: {b.strip()[:60]!r}" for b in re.split(r"\u2022|\n", ans)
                        if re.search(r"\btoday\b", b, re.I) and re.search(r"[+\-\u2212]\$?\d|\d%", b)]
        res = {"question": ask["question"], "answer": ans, "figures": found, "verified": verified, "unverified": unverified, "quality": quality}
        jdump(res, os.path.join(W, "ask-check.json"))
        log(f"ask figures: {len(verified)} verified {verified}, unverified {unverified}")
        if unverified:
            sys.exit(f"REFUSE: the Ask answer shows figures no second source confirms: {unverified}")
        rects = jload(os.path.join(W, "ask.json"), {}).get("answer_rects")
        if rects is not None and not any(r.get("visible") for r in rects):
            # the answer must be on screen in the held shot (10/1: the take ended on "Still thinking...")
            print("RETAKE: no answer line is visible in the held shot"); sys.exit(3)
        # the app's own failure message is not an answer (10/1 midday: "Couldn't finish that answer. Please ask again in a
        # moment."), and an answer with no figure on a visible point gives the voice nothing to quote
        if re.search(r"couldn.t finish|please (?:ask|try) again|something went wrong|try again in a moment", ans, re.I) or \
                (rects is not None and not any(r.get("visible") and re.search(r"\d", r.get("text", "")) for r in rects)):
            print("RETAKE: the Ask answer is an error message or carries no figure on screen"); sys.exit(3)
        if quality:
            log(f"ask wording: {quality}")
            # only jargon earns a retake: the pre-open "today" label comes from the app's Ask answer itself and never
            # cleared on a retake (10/1 7:32 run: three takes, ~11 minutes, same wording), so it is noted, not retaken
            retake = [q for q in quality if q.startswith("jargon")]
            if retake and os.environ.get("SHORTS_ASK_STRICT") == "1":
                print(f"RETAKE: the answer's wording: {retake}"); sys.exit(3)


if "--ask" in sys.argv:
    main_ask()
else:
    main_facts()
