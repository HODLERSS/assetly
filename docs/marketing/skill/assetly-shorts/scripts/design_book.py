#!/usr/bin/env python3
"""Stage 2, the portfolio: designs a believable book around the verified research BEFORE anything is recorded.

    design_book.py <work-dir> [--seed N]

Rules (owner, 9/30): ~$150-300k; the stock stories are holdings (so their position pages carry the story on
screen); AI leaders and supply-chain names a long-term tech holder would plausibly own; one or two of the day's
hot names; round share counts; cost bases inside each stock's own 52-week range (bought over the last year), so
"All time" is a gain a real holder could have. The day's P&L leans positive when the day's moves allow it
(weights among the core names are chosen for that), never by inventing a number: every figure on screen is the
app's own arithmetic on real prices.

Writes <work>/book.json ([{symbol, qty, cost}], cash last) and <work>/book-plan.json (the reasoning: weights,
the expected day P&L at the latest prices, which item each story holding serves).
"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Stage, _num, cnbc, get, jdump, jload, log, rest as sb_rest
import kr as KRM

W = sys.argv[1]
SEED = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else None
rng = random.Random(SEED)
CORE = ["NVDA", "MSFT", "GOOGL", "AVGO", "TSM", "AMZN", "META", "AMD", "AAPL"]
NO_HOLD: set = set()     # stories told without holding the name (none by default)


def range52(sym):
    if KRM.is_kr(sym):                                   # KRX: the year's closes (Yahoo, the app's source), in won
        try:
            c = list(KRM.yahoo_chart(sym, "1y", "1d")[1].values())
            return (min(c), max(c)) if c else (None, None)
        except Exception:                                # noqa: BLE001
            return None, None
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/info?assetclass=stocks", tries=2))["data"]
        lo, hi = [_num(x) for x in d["keyStats"]["fiftyTwoWeekHighLow"]["value"].split(" - ")]
        return lo, hi
    except Exception:                                    # noqa: BLE001
        return None, None


def nice_qty(value, price):
    q = value / price
    step = 1 if price > 400 else 5 if price > 60 else 10 if price > 15 else 25
    return max(step, int(round(q / step)) * step)


def main():
    res = jload(os.path.join(W, "research.json"))
    with Stage(W, "book.design"):
        story = []
        for it in res["items"]:
            for s in it.get("symbols", []):
                if it.get("kind") in ("stock", "earnings") and s not in story and s not in NO_HOLD:
                    story.append(s)
        story = story[:4]
        hot = [s for s in res.get("hot", []) if s not in story][:2]
        core_list = CORE
        fx = 1.0
        if res.get("edition") in KRM.KR_EDITIONS:
            # Korea editions (v1.1.0): a US investor's AI book that also holds Korea's memory leaders. SK hynix and Samsung
            # are always held (the Ask asks about memory / AI chip exposure), the US chip names they move with are the core
            for k in ("000660.KS", "005930.KS"):
                if k not in story and k not in hot: hot.append(k)
            hot = hot[:3]
            core_list = ["NVDA", "MU", "AVGO", "TSM", "AMD", "MSFT", "GOOGL", "AMZN"]
            fx = float(next(r["price"] for r in sb_rest(W, "prices?select=symbol,price&symbol=eq.USDKRW")))
        q = cnbc([s for s in dict.fromkeys(story + hot + core_list) if not KRM.is_kr(s)])
        rows = {r["symbol"]: r for r in jload(os.path.join(W, "research-data.json")).get("candidates", [])}
        for s in story + hot:
            if KRM.is_kr(s) and s in rows and rows[s].get("last"):
                q[s] = {"last": rows[s]["last"] / fx, "pct": rows[s].get("pct_feed1"), "krw": rows[s]["last"]}   # USD for sizing
        day = lambda s: (q.get(s) or {}).get("pct") or 0.0
        # core: 4-5 leaders, preferring the day's gainers among them so the day reads true and, when the day allows, positive
        core = sorted([s for s in core_list if s not in story + hot and (q.get(s) or {}).get("last")], key=lambda s: -day(s))
        n_core = 5 if len(story) <= 3 else 4
        picks = core[:max(2, n_core - 1)] + [rng.choice(core[max(2, n_core - 1):])] if len(core) > n_core else core
        names = list(dict.fromkeys(story + hot + picks))[:11]
        total = rng.uniform(175_000, 265_000)
        cash = rng.choice([4000, 5000, 6000, 7500, 8000])
        # weights: story names 7-12%, hot 4-7%, the rest of the money across the core, the day's best core name largest
        w = {}
        for s in story: w[s] = rng.uniform(0.08, 0.12) if day(s) >= 0 else rng.uniform(0.035, 0.06)   # a falling story is a small holding
        for s in hot: w[s] = rng.uniform(0.04, 0.07)
        rest = [s for s in names if s not in w]
        left = max(0.25, 1 - sum(w.values()) - cash / total)
        raw = {s: (1.6 if i == 0 else 1.0) * rng.uniform(0.8, 1.2) for i, s in enumerate(rest)}
        for s in rest: w[s] = left * raw[s] / sum(raw.values())
        # lean positive (only when the day allows): try a few re-draws of the core tilt and keep the best day P&L
        best = None
        for _ in range(40):
            ww = dict(w)
            for s in rest: ww[s] = w[s] * rng.uniform(0.7, 1.4)
            sc = (1 - cash / total) / sum(ww.values())
            ww = {s: v * sc for s, v in ww.items()}
            pnl = sum(ww[s] * day(s) for s in ww)
            if best is None or pnl > best[0]: best = (pnl, ww)
        w = best[1]
        book, plan = [], []
        for s in names:
            px = (q.get(s) or {}).get("last")
            if not px: continue
            qty = nice_qty(total * w[s], px)
            lp = (q.get(s) or {}).get("krw") or px              # the cost basis in the stock's own currency (won for KRX)
            lo, hi = range52(s)
            lo = lo or lp * 0.55; hi = hi or lp
            top = min(lp * 0.92, hi)
            cost = round(rng.uniform(lo, max(lo, top)) if top > lo else lo, 2)
            if KRM.is_kr(s): cost = float(round(cost, -2))      # whole won, rounded like a KRX tick
            book.append({"symbol": s, "qty": qty, "cost": cost, **({"name": KRM.KR_NAMES[s]} if s in KRM.KR_NAMES else {})})
            plan.append({"symbol": s, "qty": qty, "price": px, "value": round(qty * px), "day_pct": day(s), "cost": cost,
                         "range52": [lo, hi], "role": "story" if s in story else "hot" if s in hot else "core"})
        book.append({"symbol": "$CASH", "qty": cash, "cost": 1, "account": "bank"})
        tot = sum(p["value"] for p in plan) + cash
        day_usd = sum(p["value"] * p["day_pct"] / (100 + p["day_pct"]) for p in plan)
        info = {"total": round(tot), "day_usd_est": round(day_usd), "day_pct_est": round(100 * day_usd / (tot - day_usd), 2),
                "story": story, "hot": hot, "positions": plan, "seed": SEED}
        jdump(book, os.path.join(W, "book.json")); jdump(info, os.path.join(W, "book-plan.json"))
        log(f"book: {len(plan)} positions, ${tot:,.0f}, est day {info['day_pct_est']:+.2f}% (${day_usd:+,.0f}); story {story}, hot {hot}")
        if not 150_000 <= tot <= 300_000:
            sys.exit(f"REFUSE: book total ${tot:,.0f} outside $150-300k")


main()
