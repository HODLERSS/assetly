"""Shared helpers for the assetly-shorts pipeline: paths, secrets (never printed), HTTP, quotes from two
independent feeds, the LLM client, and the per-stage latency log.

Secrets are read into memory or into chmod-600 files inside the run's work dir. Nothing in this module
prints a key, puts one in a URL, or writes one to a log.
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York"); CT = ZoneInfo("America/Chicago")
APP = os.environ.get("ASSETLY_APP", "/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app")
CODE = os.environ.get("SHORTS_CODE", APP)     # where the seed + build scripts are read from (a worktree for a --test of new code)


# ---- the 20-minute budget (v1.3.0, owner 10/1: "build each clip within 20 minutes max") -------------------------
def budget_left():
    """Seconds left before the run's hard deadline (run.sh exports SHORTS_T0 and SHORTS_DEADLINE_S); a large number
    when a script runs on its own."""
    t0 = os.environ.get("SHORTS_T0")
    if not t0: return 1e9
    return float(t0) + float(os.environ.get("SHORTS_DEADLINE_S", "1200")) - time.time()
SB = "https://hhdpthrfmsdmxdrfckxq.supabase.co"; REF = "hhdpthrfmsdmxdrfckxq"
SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
EDITIONS = {"preopen": "morning", "midday": "midday", "close": "close",     # skill edition -> app brief edition
            "korea-open": "kr_open", "korea-close": "kr_close",           # v1.1.0: the Seoul editions (kr.py)
            "korea-midday": "kr_open"}         # v1.2.0: the app has no midday Korea brief; kr_open is the live one until 15:30 KST


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def jload(p, default=None):
    try:
        return json.load(open(p))
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def jdump(o, p):
    tmp = p + ".tmp"; json.dump(o, open(tmp, "w"), indent=1, ensure_ascii=False); os.replace(tmp, p)


# ---- latency log: one line per stage, read back into the quality report ------------------------------
class Stage:
    def __init__(self, work, name):
        self.f, self.name = os.path.join(work, "latency.json"), name

    def __enter__(self):
        self.t0 = time.time(); log(f"== {self.name}"); return self

    def __exit__(self, et, ev, tb):
        d = jload(self.f, {}); d[self.name] = {"start": round(self.t0, 1), "secs": round(time.time() - self.t0, 1), "ok": et is None}
        jdump(d, self.f)


# ---- HTTP --------------------------------------------------------------------------------------------
def get(url, headers=None, timeout=20, tries=6, raw=False):
    # 10/1 11:13 a ~1 min DNS blip ("nodename nor servname provided") killed a midday run after a good take: retry
    # network errors with backoff (2, 4, 8, 16, 30 s) so a short outage is ridden out instead of failing the stage
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
            b = urllib.request.urlopen(req, timeout=timeout).read()
            return b if raw else b.decode("utf-8", "replace")
        except Exception as e:                       # noqa: BLE001 (network: retry, then report)
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code not in (408, 429): break
            if i < tries - 1: time.sleep(min(30, 2 ** (i + 1)))
    raise RuntimeError(f"GET failed {url.split('?')[0]}: {last}")


def post(url, body, headers=None, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read() or b"null")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {url.split('?')[0]} -> {e.code} {e.read()[:300]!r}") from None


# ---- secrets -----------------------------------------------------------------------------------------
def srk(work):
    """Supabase service key, cached chmod 600 in the work dir. Comes from the logged-in Supabase CLI."""
    p = os.path.join(work, "srk")
    if not os.path.exists(p) or not open(p).read().strip():
        out = subprocess.run(["npx", "--no-install", "supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"],
                             cwd=APP, capture_output=True, text=True).stdout
        key = [k["api_key"] for k in json.loads(out) if k.get("name") == "service_role"][0]
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, key.encode()); os.close(fd)
    return open(p).read().strip()


def vault(work, name):
    """A Vault secret (mara_api_key, eleven_api_key, internal_token) via the get_secret RPC; cached chmod 600."""
    p = os.path.join(work, name)
    if not os.path.exists(p):
        k = srk(work)
        v = post(f"{SB}/rest/v1/rpc/get_secret", {"secret_name": name}, {"apikey": k, "Authorization": f"Bearer {k}"})
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, str(v or "").encode()); os.close(fd)
    return open(p).read().strip()


def rest(work, path, method="GET", body=None):
    k = srk(work); h = {"apikey": k, "Authorization": f"Bearer {k}"}
    if method == "GET":
        return json.loads(get(f"{SB}/rest/v1/{path}", h))
    return post(f"{SB}/rest/v1/{path}", body, h)


# ---- LLM: MARA Cloud MiniMax-M3 first (the app's own model and key), OpenRouter as the fallback -------
_NOJSON: dict = {}


def llm(work, system, prompt, max_tokens=12000, temperature=0.2, timeout=150, prefer="mara"):
    """Returns parsed JSON from the model. Tries MARA MiniMax-M3, then OpenRouter (anthropic/claude-sonnet-5.5)."""
    tries = []
    try:
        tries.append(("mara", "https://api.cloud.mara.com/v1/chat/completions", vault(work, "mara_api_key"), "MiniMax-M3"))
    except Exception as e:                           # noqa: BLE001
        log("mara key unavailable:", str(e)[:80])
    # SambaNova Cloud serves the same MiniMax-M3 (OpenAI-compatible). The key FILE wins: a stale SAMBANOVA_API_KEY in the
    # shell env returns 401 (10/1). Added after OpenRouter ran out of credits (402) mid-storyline on 10/1.
    snf = os.path.expanduser("~/.private_keys/sambanova.txt")
    if os.path.exists(snf) and open(snf).read().strip():
        tries.append(("sambanova", "https://api.sambanova.ai/v1/chat/completions", open(snf).read().strip(), "MiniMax-M3"))
    orf = os.path.expanduser("~/.private_keys/openrouter.txt")
    if os.environ.get("OPENROUTER_API_KEY") or os.path.exists(orf):
        ork = os.environ.get("OPENROUTER_API_KEY") or next((l.split("=", 1)[1].strip() for l in open(orf) if l.startswith("key=")), "")
        tries.append(("openrouter", "https://openrouter.ai/api/v1/chat/completions", ork,
                      os.environ.get("SHORTS_OR_MODEL", "anthropic/claude-sonnet-5.5")))
    if prefer == "openrouter": tries.reverse()
    # a reply with no JSON object goes straight to the next provider (no second attempt); a provider that did that twice in
    # this process goes last for the rest of it (10/2 korea-open: OpenRouter Sonnet 5 x "max() arg is an empty sequence" at
    # ~32 s each, 2.5 min of the budget). Once is not enough: Sonnet is what converges the storyline (v1.3.0 test 4)
    tries.sort(key=lambda t: _NOJSON.get(t[0], 0) >= 2)
    last = None
    for name, url, key, model in tries:
        cut, afford = False, None
        for attempt in range(2):
            t0 = time.time()
            try:
                # OpenRouter reserves credit for max_tokens up front: 16000 got a 402 on a low balance (10/1 close) while
                # a storyline reply is ~1-2k tokens; Sonnet does not need the reasoning headroom M3 does. A reply still cut at
                # that cap (finish_reason "length") gets the full budget on the retry (10/2 korea-midday)
                mt = min(max_tokens, int(os.environ.get("SHORTS_OR_MAX_TOKENS", "8000"))) if name == "openrouter" and not cut else max_tokens
                if afford: mt = afford   # v1.3.0: 4000 truncated Sonnet replies (no JSON, 10/1-2)
                body = {"model": model, "temperature": temperature, "max_tokens": mt,
                        "response_format": {"type": "json_object"},
                        "messages": [{"role": "system", "content": system + " Respond with ONE JSON object only, first character '{'."},
                                     {"role": "user", "content": prompt}]}
                # one hung call must not eat the budget: never wait past what the run can spend on it
                r = post(url, body, {"Authorization": f"Bearer {key}"}, timeout=max(20, min(timeout, int(budget_left() - 240))))
                c = r["choices"][0]["message"]["content"] or ""
                if r["choices"][0].get("finish_reason") == "length":
                    cut = True; raise RuntimeError(f"reply cut at max_tokens {mt} ({(r.get('usage') or {}).get('completion_tokens')} tokens)")
                c = re.sub(r"(?s)<think>.*?</think>", "", c).strip()
                # a reasoning model can quote a small object before its answer: keep the LARGEST object in the reply
                dec, objs, i = json.JSONDecoder(), [], c.find("{")
                while i != -1:
                    try:
                        o, n = dec.raw_decode(c[i:]); objs.append((n, o)); i = c.find("{", i + n)
                    except ValueError:
                        i = c.find("{", i + 1)
                out = max(objs, key=lambda x: x[0])[1]
                log(f"llm {name}/{model} {time.time() - t0:.0f}s ok")
                out["_model"] = f"{name}/{model}"
                return out
            except Exception as e:                   # noqa: BLE001
                last = e; log(f"llm {name} attempt {attempt + 1} failed after {time.time() - t0:.0f}s: {str(e)[:160]}")
                # out of credits / bad key: retrying the same provider cannot help, go to the next one at once
                # ... except a 402 that only asks for fewer max_tokens (10/2 03:06: a low OpenRouter balance refused every 8000-token
                # storyline call, so every round fell to M3, which never converged): retry once inside what the balance affords
                m_af = re.search(r"can only afford (\d+)", str(e)) if "402" in str(e) else None
                if m_af and not afford and int(m_af.group(1)) >= 1500:
                    afford = int(m_af.group(1)) - 50; continue
                if re.search(r"-> (401|402|403) ", str(e)): break
                if isinstance(e, ValueError) and "empty sequence" in str(e):      # no JSON in the reply: next provider at once
                    _NOJSON[name] = _NOJSON.get(name, 0) + 1; break
    raise RuntimeError(f"every model failed: {last}")


# ---- quotes from two independent feeds ---------------------------------------------------------------
def _num(s):
    if s in (None, "", "N/A", "UNCH"):
        return None
    s = str(s).replace("$", "").replace(",", "").replace("%", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


CNBC_ALIAS = {"ES=F": "@SP.1", "NQ=F": "@ND.1", "YM=F": "@DJ.1", "^GSPC": ".SPX", "^IXIC": ".IXIC", "^DJI": ".DJI",
              "^VIX": ".VIX", "^TNX": "US10Y", "CL=F": "@CL.1", "GC=F": "@GC.1", "BTC-USD": "BTC.CM="}


def cnbc(symbols):
    """CNBC quote service: regular last + change, and the extended-hours (pre/post) quote when there is one."""
    out = {}
    syms = list(symbols)
    for i in range(0, len(syms), 40):
        chunk = syms[i:i + 40]
        q = "%7C".join(urllib.parse.quote(CNBC_ALIAS.get(s, s)) for s in chunk)
        d = json.loads(get(f"https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols={q}"
                           "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json"))
        res = d.get("FormattedQuoteResult", {}).get("FormattedQuote", [])
        back = {CNBC_ALIAS.get(s, s): s for s in chunk}
        for r in res:
            s = back.get(r.get("symbol"), r.get("symbol"))
            e = r.get("ExtendedMktQuote") or {}
            out[s] = {"last": _num(r.get("last")), "pct": _num(r.get("change_pct")), "chg": _num(r.get("change")),
                      "prev": _num(r.get("previous_day_closing")), "time": r.get("last_time"), "name": r.get("name"),
                      "high": _num(r.get("high")), "low": _num(r.get("low")), "vol": _num(r.get("volume")),
                      "ext_type": e.get("type"), "ext_last": _num(e.get("last")), "ext_pct": _num(e.get("change_pct")),
                      "ext_time": e.get("last_time")}
    return out


def nasdaq(sym, kind="stocks"):
    """Nasdaq quote API: primaryData = last (regular or extended label), secondaryData = the regular close when
    an extended session is showing."""
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/quote/{urllib.parse.quote(sym)}/info?assetclass={kind}", tries=2))["data"]
    except Exception:                                # noqa: BLE001
        return None
    if not d:
        return None
    p, s = d.get("primaryData") or {}, d.get("secondaryData") or {}
    reg = s if s and s.get("lastSalePrice") else p
    return {"last": _num(reg.get("lastSalePrice")), "pct": _num(reg.get("percentageChange")), "chg": _num(reg.get("netChange")),
            "time": reg.get("lastTradeTimestamp"), "status": d.get("marketStatus"), "name": d.get("companyName"),
            "ext_last": _num(p.get("lastSalePrice")) if s and s.get("lastSalePrice") else None,
            "ext_pct": _num(p.get("percentageChange")) if s and s.get("lastSalePrice") else None,
            "ext_label": p.get("lastTradeTimestamp") if s and s.get("lastSalePrice") else None}


def nasdaq_pre(sym, kind="pre"):
    """Nasdaq pre-market (kind="pre") or after-hours (kind="post") consolidated last trade, or None."""
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/extended-trading?markettype={kind}&assetclass=stocks", tries=1))["data"]
        row = (d.get("infoTable") or {}).get("rows") or []
        m = re.match(r"\$([\d,.]+)\s+([+\-][\d.,]+|UNCH)\s+\(([+\-]?[\d.]+)%\)", row[0]["consolidated"]) if row else None
        return {"last": _num(m.group(1)), "pct": _num(m.group(3))} if m else None
    except Exception:                                # noqa: BLE001
        return None


# v1.4.0 (owner 10/2: "instead of saying commentators said this, be more direct. don't use third-party word like that"): the
# read is said in the Short's own voice. A third-party attribution is refused in research (the READ field), the storyline
# (item sentences) and the gate (Q44): "commentators / observers / pundits" anywhere, "according to", and analysts, Wall
# Street, investors, traders ... as the SUBJECT of a say / see / expect verb. A fact that names them stays: "topped Wall
# Street estimates", "beat analysts' forecasts", a flow ("Foreign investors sold $2 billion of Korean chips.").
ATTRIB = re.compile(r"\b(?:commentators?|observers?|pundits|market watchers)\b|\baccording to\b|"
                    r"\b(?:(?:analysts?|strategists?|economists?|experts?|critics|wall street|investors?|traders?|bulls|bears|skeptics|fans)"
                    r"\s+(?:\w+\s+){0,2}|(?:many|some)\s+)(?:say|says|said|see|sees|saw|call|calls|called|"
                    r"cite|cites|cited|expect|expects|expected|think|thinks|believe|believes|worry|worries|worried|doubt|doubts|doubted|"
                    r"view|views|viewed|back|backs|backed|like|likes|liked|cheer|cheers|cheered|welcome|welcomes|welcomed|shrug|shrugs|shrugged|"
                    r"watch|watches|bet|bets|fear|fears|feared|hope|hopes|hoped|question|questions|questioned|praise|praised|remain|remains|stay|stays|"
                    r"await|awaits|awaited|monitor|monitors|eye|eyes|eyed|weigh|weighs|weighed|digest|digests|focus|focuses|brace|braces|"
                    r"warn|warns|warned|note|notes|noted|argue|argues|argued|predict|predicts|predicted|"
                    r"upgrade|upgrades|upgraded|downgrade|downgrades|downgraded|raise|raises|raised|cut|cuts|lift|lifted|love|loves|loved|"
                    r"saying|seeing|calling|citing|expecting|weighing|awaiting|watching|eyeing|monitoring|betting|digesting|bracing|"
                    r"cheering|questioning|worrying|doubting|focusing|hoping|fearing|warning|predicting|pricing in|piling into|fleeing)\b",
                    re.I)


def attributed(text):
    """The third-party attribution in a line, or None (v1.4.0: the read is ours, direct and factual)."""
    m = ATTRIB.search(text or "")
    return m.group(0) if m else None


def agree(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


# ---- the trading calendar (the app's own: supabase/functions/_shared/calendar.ts) -----------------------
def calendar_check(ymd, mkt="US"):
    """Asks the app's calendar whether ymd is a trading day on mkt ("US" or "KR", the KRX holiday table incl. the
    substitute days, e.g. 2026-10-05 for Gaecheonjeol on a Saturday). Returns (trading: bool, why: str)."""
    ts = f"""import {{ isTradingDay }} from "{APP}/supabase/functions/_shared/calendar.ts";
console.log(JSON.stringify({{ trading: isTradingDay("{mkt}", "{ymd}") }}));"""
    p = f"/tmp/assetly-shorts-cal-{os.getpid()}.ts"; open(p, "w").write(ts)
    r = subprocess.run(["npx", "-y", "deno@2", "run", "-A", p], capture_output=True, text=True, timeout=120)
    os.remove(p)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])["trading"], r.stderr[-200:]
    except Exception:                                # noqa: BLE001
        return None, (r.stdout + r.stderr)[-300:]


def stale_moves(rows, now_iso=None):
    """The symbols whose stored day move is NOT the current session's, by the app's own rule (calendar.ts
    withholdStaleMoves / dayMoveCurrent, the 10/2 fix ff99849): Yahoo's KRX feed lags ~20 min, so before the day's first
    bar a KRX row still holds yesterday's close and change_pct. rows: [{symbol, change_pct, as_of, kind, currency}].
    Raises when the check cannot run (a figure we cannot place in its session is not used)."""
    p = f"/tmp/assetly-shorts-stale-{os.getpid()}.ts"
    open(p, "w").write(f"""import {{ withholdStaleMoves }} from "{APP}/supabase/functions/_shared/calendar.ts";
const rows = JSON.parse(await new Response(Deno.stdin.readable).text());
const now = {json.dumps(now_iso)} ? new Date({json.dumps(now_iso)}) : new Date();
console.log(JSON.stringify([...withholdStaleMoves(rows, now)]));""")
    try:
        r = subprocess.run(["npx", "-y", "deno@2", "run", "-A", p], input=json.dumps(
            [{k: x.get(k) for k in ("symbol", "change_pct", "as_of", "kind", "currency")} for x in rows]),
            capture_output=True, text=True, timeout=120)
        return set(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception as e:                           # noqa: BLE001
        raise RuntimeError(f"stale-move check failed: {(r.stderr if 'r' in dir() else str(e))[-200:]}") from None
    finally:
        os.remove(p)


def now_et():
    return datetime.now(ET)
