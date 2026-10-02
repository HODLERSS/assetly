"""Korea editions (v1.1.0): KRX quotes and history from two independent feeds, the won rate, and the long windows.

Feeds, chosen on 10/1 (KST evening) by comparing them with the app's own prices row:
- Yahoo v8 chart (the app's price pipeline reads the same source; called directly here): the KRX regular session.
- Daum Finance: `days` = the KRX official daily closes (close, previous close, change rate); `quotes` = the live price
  during the KRX session. After 15:30 KST its `quotes.tradePrice` is the Nextrade (NXT) after-market price, so a
  finished session is read from `days`, never from `quotes`.
- Naver is NOT a KRX feed in the evening: m.stock / fchart / polling serve the NXT-integrated last price (SK hynix 10/1:
  1,828,000 against the KRX close 1,833,000), so it would disagree with the app's screen by design.
Won rate: the app's USDKRW row (Yahoo) and CNBC "KRW=".
"""
import json, os, sys, time, urllib.parse
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import _num, cnbc, get, log

KST = ZoneInfo("Asia/Seoul")
KR_EDITIONS = ("korea-open", "korea-midday", "korea-close")
LIVE_EDITIONS = ("korea-open", "korea-midday")   # filmed while the KRX session trades: live tolerances
# the Korean AI-chip universe (KOSPI + KOSDAQ): memory, HBM equipment and packaging, substrates
KR_UNIVERSE = ["000660.KS", "005930.KS", "042700.KS", "009150.KS", "000990.KS", "403870.KQ", "058470.KQ", "240810.KQ", "039030.KQ"]
KR_NAMES = {"000660.KS": "SK hynix", "005930.KS": "Samsung Electronics", "042700.KS": "Hanmi Semiconductor",
            "009150.KS": "Samsung Electro-Mechanics", "000990.KS": "DB HiTek", "403870.KQ": "HPSP", "058470.KQ": "Leeno Industrial",
            "240810.KQ": "Wonik IPS", "039030.KQ": "EO Technics", "^KS11": "KOSPI"}
# the US read-through: the AI chip and memory names a US investor actually holds
US_CHIPS = ["NVDA", "MU", "AMD", "AVGO", "TSM", "SNDK", "WDC", "STX", "ASML", "LRCX", "AMAT", "KLAC", "ARM", "MRVL", "INTC", "QCOM", "SMCI"]
MEMORY = {"MU", "000660.KS", "005930.KS", "SNDK", "WDC", "STX"}
CHIPS = set(US_CHIPS) | set(KR_UNIVERSE)
WINDOWS = {"m1": 1, "m3": 3, "ytd": None}            # the app's 1M / 3M / YTD chart ranges (chartRange.ts)
RANGE = {"korea-open": "1M", "korea-midday": "YTD", "korea-close": "3M"}     # the range the story pages are filmed on
WIN_PHRASE = {"1M": "this month", "3M": "over three months", "YTD": "this year"}   # how a line names that window
RANGE_FIELD = {"1M": "m1", "3M": "m3", "YTD": "ytd"}
ASKQ = {"korea-open": "How exposed is my portfolio to memory chips?", "korea-midday": "How much of my portfolio is in Korean stocks?",
        "korea-close": "What's my AI chip concentration?"}


def is_kr(sym):
    return str(sym).endswith((".KS", ".KQ")) or sym == "^KS11"


def kst_now():
    return datetime.now(KST)


def _code(sym):
    return "A" + sym.split(".")[0]


def daum(path, sym):
    return json.loads(get(f"https://finance.daum.net/api/{path}", headers={"Referer": f"https://finance.daum.net/quotes/{_code(sym)}"}, tries=3))


def daum_days(sym, pages=3):
    """{YYYY-MM-DD: (close, prev_close, change_pct)} from the KRX official daily rows."""
    out = {}
    for p in range(1, pages + 1):
        try:
            d = daum(f"quote/{_code(sym)}/days?symbolCode={_code(sym)}&page={p}&perPage=100&pagination=true", sym)
        except Exception as e:                       # noqa: BLE001
            log(f"daum days {sym} p{p}: {str(e)[:80]}"); break
        for r in d.get("data") or []:
            out[r["date"][:10]] = (r["tradePrice"], r["prevClosingPrice"], 100 * r["changeRate"] * (1 if r["change"] != "FALL" else -1))
        if p >= (d.get("totalPages") or 1): break
    return out


def yahoo_chart(sym, rng="1y", interval="1d"):
    """(meta, {YYYY-MM-DD KST: close}) from Yahoo v8 (the app's own price source)."""
    d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={interval}",
                   headers={"User-Agent": "Mozilla/5.0"}, tries=4))    # the full Chrome UA gets 429 from Yahoo; a bare one does not (10/1)
    r = d["chart"]["result"][0]; tz = ZoneInfo(r["meta"].get("exchangeTimezoneName") or "Asia/Seoul")
    closes = {}
    for t, c in zip(r.get("timestamp") or [], r["indicators"]["quote"][0].get("close") or []):
        if c is not None: closes[datetime.fromtimestamp(t, tz).strftime("%Y-%m-%d")] = float(c)
    return r["meta"], closes


def krx_open_now():
    z = kst_now(); m = z.hour * 60 + z.minute
    return z.weekday() < 5 and 540 <= m < 930


def kr_quote_live(sym, session_date=None, waits=(20, 20)):
    """During the KRX session, the two feeds at the SAME minute: Yahoo runs ~20 min behind (10/1 9:37 KST: Yahoo's last
    bar 9:17, Daum live), so a live-vs-live comparison disagreed on every name and the first korea-open refused. Feed a:
    Yahoo's last 1-minute bar (what the app's price-sync stores and the page shows); feed b: Daum's per-minute KRX trade
    at that minute (`quote/<code>/times`), both against the previous KRX close (Yahoo meta / Daum quote).

    Stale-session guard (v1.2.0; the app's 10/2 fix ff99849): before Yahoo's first bar of the day (~9:20 KST) range=1d
    still returns YESTERDAY's bars, and their move against the day before would read as today's. A bar counts only when it
    is inside today's KRX session (dated `session_date`, at or after 9:00 KST); likewise Daum's minute rows. Otherwise wait
    and retry (`waits`, seconds), then return {"live": True, "stale": why} with no figures: the name's move is refused."""
    session_date = session_date or kst_now().strftime("%Y-%m-%d")
    why = ""
    for i in range(len(waits) + 1):
        if i: log(f"live quote {sym}: {why}; retry in {waits[i - 1]} s"); time.sleep(waits[i - 1])
        d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=1d&interval=1m",
                           headers={"User-Agent": "Mozilla/5.0"}, tries=4))["chart"]["result"][0]
        bars = [(t, c) for t, c in zip(d.get("timestamp") or [], d["indicators"]["quote"][0].get("close") or []) if c is not None]
        if not bars: why = "Yahoo has no bar yet"; continue
        t, last = bars[-1]
        at = datetime.fromtimestamp(t, KST)
        if not in_session(at, session_date):
            why = f"Yahoo's last bar is {at:%Y-%m-%d %H:%M} KST, not inside the {session_date} session"; continue
        break
    else:
        return {"live": True, "stale": why}
    prev = float(d["meta"].get("chartPreviousClose") or d["meta"].get("previousClose"))
    hm = at.strftime("%H:%M")
    out = {"live": True, "last": float(last), "prev": prev, "pct": round(100 * (last / prev - 1), 2), "asof_kst": hm}
    q = daum(f"quotes/{_code(sym)}?summary=false", sym)
    prev2 = float(q["prevClosingPrice"])
    rows = []
    for page in (1, 2, 3):
        rows += (daum(f"quote/{_code(sym)}/times?page={page}&perPage=30", sym).get("data") or [])
        if any(r["tradeTime"][:5] <= hm for r in rows): break
    # a minute row from another day (Daum's list before today's first trade) is not this session's
    same = [r for r in rows if r["tradeTime"][:5] <= hm and str(r.get("date") or session_date)[:10] == session_date]
    if same:
        r = max(same, key=lambda r: r["tradeTime"])
        out.update(last2=float(r["tradePrice"]), pct2=round(100 * (r["tradePrice"] / prev2 - 1), 2), asof2_kst=r["tradeTime"][:5])
    return out


def in_session(at, session_date):
    """Is the KST datetime `at` inside the KRX regular session dated `session_date` (9:00-15:30, plus the closing print)?"""
    m = at.hour * 60 + at.minute
    return at.strftime("%Y-%m-%d") == session_date and 540 <= m <= 935


def kr_quote(sym, session_date):
    """Two KRX feeds for the session dated `session_date` (KST): {last, pct (Yahoo), last2, pct2 (Daum), live}."""
    live = krx_open_now() and kst_now().strftime("%Y-%m-%d") == session_date
    if live:
        try:
            return kr_quote_live(sym, session_date)
        except Exception as e:                       # noqa: BLE001
            log(f"live quote {sym}: {str(e)[:80]}"); return {"live": True}
    out = {"live": live}
    try:
        meta, closes = yahoo_chart(sym, "5d", "1d")
        ks = sorted(closes)
        if ks and ks[-1] == session_date and len(ks) >= 2:
            out.update(last=closes[ks[-1]], prev=closes[ks[-2]], pct=round(100 * (closes[ks[-1]] / closes[ks[-2]] - 1), 2))
        if live and meta.get("regularMarketPrice") and len(ks) >= 2:
            base = closes[ks[-2]] if ks[-1] == session_date else closes[ks[-1]]
            out.update(last=float(meta["regularMarketPrice"]), prev=base, pct=round(100 * (meta["regularMarketPrice"] / base - 1), 2))
    except Exception as e:                           # noqa: BLE001
        log(f"yahoo {sym}: {str(e)[:80]}")
    try:
        if live:
            q = daum(f"quotes/{_code(sym)}?summary=false", sym)
            out.update(last2=q["tradePrice"], pct2=round(100 * (q["tradePrice"] / q["prevClosingPrice"] - 1), 2))
        else:
            row = daum_days(sym, 1).get(session_date)
            if row: out.update(last2=row[0], pct2=round(100 * (row[0] / row[1] - 1), 2))
    except Exception as e:                           # noqa: BLE001
        log(f"daum {sym}: {str(e)[:80]}")
    return out


def months_back(d, n):
    import calendar as _c
    y, m = d.year, d.month - n
    while m <= 0: m += 12; y -= 1
    return d.replace(year=y, month=m, day=min(d.day, _c.monthrange(y, m)[1]))


def window_start(field, today):
    """The app's range start (chartRange.ts rangeStartYmd): 1M/3M the same date N months back, YTD Dec 31 prior year."""
    return date(today.year - 1, 12, 31) if field == "ytd" else months_back(today, WINDOWS[field])


def base_at(hist, ymd):
    ks = sorted(k for k in hist if k <= ymd)
    return hist[ks[-1]] if ks else None


def us_history(sym):
    """Nasdaq daily closes for a US name {YYYY-MM-DD: close} (the US second feed)."""
    to = datetime.now(ZoneInfo("America/New_York")).date(); fr = to - timedelta(days=400)
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=stocks&fromdate={fr}&todate={to}&limit=400", tries=2))
        return {datetime.strptime(r["date"], "%m/%d/%Y").strftime("%Y-%m-%d"): _num(r["close"]) for r in d["data"]["tradesTable"]["rows"]}
    except Exception:                                # noqa: BLE001
        return {}


def windows(sym, today, last_a, last_b):
    """{field: {"a": pct, "b": pct, "ok": bool}} for 1M/3M/YTD. Feed a: Yahoo daily closes (the app's source); feed b:
    Daum KRX days (KR) or Nasdaq history (US). `today` = the market's current day (its own zone)."""
    try:
        _, ha = yahoo_chart(sym, "2y", "1d")
    except Exception:                                # noqa: BLE001
        ha = {}
    hb = {k: v[0] for k, v in daum_days(sym, 2).items()} if is_kr(sym) else us_history(sym)
    out = {}
    for f in WINDOWS:
        ymd = str(window_start(f, today))
        a0, b0 = base_at(ha, ymd), base_at(hb, ymd)
        a = round(100 * (last_a / a0 - 1), 2) if a0 and last_a else None
        b = round(100 * (last_b / b0 - 1), 2) if b0 and last_b else None
        out[f] = {"a": a, "b": b, "base_date": ymd, "ok": a is not None and b is not None and abs(a - b) <= max(0.6, 0.015 * abs(a))}
    return out


def fx_pair(app_rows=None):
    """(app USDKRW, CNBC KRW=) won per dollar."""
    a = None
    if app_rows:
        a = next((float(r["price"]) for r in app_rows if r["symbol"] == "USDKRW"), None)
    try:
        b = cnbc(["KRW="]).get("KRW=", {}).get("last")
    except Exception:                                # noqa: BLE001
        b = None
    return a, b


WIN_WORDS = [("ytd", r"\b(this year|year[- ]to[- ]date|since (?:january|the start of the year)|in 2026)\b"),
             ("m3", r"\b(three months|3 months|past quarter|since (?:june|july))\b"),
             ("m1", r"\b(this month|past month|a month|one month|in september|since (?:august|september))\b")]


def window_field(text):
    """The long window a clause speaks about (m1 / m3 / ytd), or None for the session move."""
    import re
    for f, rx in WIN_WORDS:
        if re.search(rx, text, re.I): return f
    return None
