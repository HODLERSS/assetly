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


# ---- LLM: claude -p (Sonnet, the owner's Claude subscription), MARA Cloud MiniMax-M3, SambaNova Cloud MiniMax-M3 ----------
# v1.4.0 (owner 10/2: "Shorts script writer, can you use this claude session or claude -p? you shouldn't use openrouter for
# sonnet"): OpenRouter is gone. The script writer (prefer="claude") tries claude-cli -> MARA -> SambaNova; research and the
# judges (prefer="mara") keep MARA first: MARA -> SambaNova -> claude-cli. SHORTS_LLM_FORCE_FAIL="claude,mara" makes those
# tiers fail at once (the fallback test: `python3 lib.py --selftest-llm`).
_NOJSON: dict = {}
CLAUDE_BIN = os.environ.get("SHORTS_CLAUDE_BIN", os.path.expanduser("~/.local/bin/claude"))


def _largest_json(c):
    """The LARGEST JSON object in a reply (a reasoning model can quote a small object before its answer); fences and
    <think> blocks stripped. ValueError("max() arg is an empty sequence") when there is none."""
    c = re.sub(r"(?s)<think>.*?</think>", "", c or "").strip()
    c = re.sub(r"^```(?:json)?\s*|\s*```$", "", c)
    dec, objs, i = json.JSONDecoder(), [], c.find("{")
    while i != -1:
        try:
            o, n = dec.raw_decode(c[i:]); objs.append((n, o)); i = c.find("{", i + n)
        except ValueError:
            i = c.find("{", i + 1)
    return max(objs, key=lambda x: x[0])[1]


def _claude_cli(system, prompt, timeout):
    """One `claude -p` call (Sonnet) from an empty temp dir (no CLAUDE.md, no tools, no MCP, no session saved). launchd's
    environment is thin: HOME, USER and LOGNAME are passed explicitly (without USER the CLI finds no keychain login and
    answers an EMPTY result with is_error false: treated as a failure). Never --bare (that wants an API key)."""
    import tempfile
    env = {"HOME": os.path.expanduser("~"), "USER": os.environ.get("USER") or os.path.basename(os.path.expanduser("~")),
           "PATH": f"{os.path.dirname(CLAUDE_BIN)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"}
    env["LOGNAME"] = os.environ.get("LOGNAME") or env["USER"]
    with tempfile.TemporaryDirectory(prefix="shorts-claude-") as d:
        r = subprocess.run([CLAUDE_BIN, "-p", "--model", os.environ.get("SHORTS_CLAUDE_MODEL", "sonnet"), "--output-format", "json",
                            "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", system],
                           input=prompt, capture_output=True, text=True, cwd=d, env=env, timeout=timeout)
    if r.returncode: raise RuntimeError(f"claude-cli exit {r.returncode}: {(r.stderr or r.stdout)[-160:]}")
    j = json.loads(r.stdout)
    if j.get("is_error"): raise RuntimeError(f"claude-cli error: {str(j.get('result'))[:160]}")
    if not (j.get("result") or "").strip(): raise RuntimeError("claude-cli returned an empty result (login not found?)")
    return j["result"]


CLAUDE_LOG = os.path.expanduser("~/.config/assetly-shorts/claude-calls.log")
CLAUDE_LIMIT = os.path.expanduser("~/.config/assetly-shorts/claude-limit")


def _claude_gate(work):
    """None when a claude -p call may go out, else why not. Lead 10/2 (the owner's Claude window also serves the main
    session and the US Shorts): SHORTS_CLAUDE_MAX caps the calls per run (counted in <work>/claude-calls.txt), and after a
    usage-limit error no claude call goes out for an hour (CLAUDE_LIMIT marker): the run uses MARA / SambaNova instead."""
    try:
        if time.time() - os.path.getmtime(CLAUDE_LIMIT) < 3600: return "the Claude usage limit was hit < 1 h ago"
    except OSError:
        pass
    cap = os.environ.get("SHORTS_CLAUDE_MAX")
    if cap:
        f = os.path.join(work, "claude-calls.txt")
        n = int(open(f).read() or 0) if os.path.exists(f) else 0
        if n >= int(cap): return f"SHORTS_CLAUDE_MAX={cap} calls used this run"
    return None


def _claude_count(work):
    try:
        f = os.path.join(work, "claude-calls.txt")
        n = int(open(f).read() or 0) if os.path.exists(f) else 0
        open(f, "w").write(str(n + 1))
        with open(CLAUDE_LOG, "a") as g:                 # the daily tally (lead's cost guardrail)
            g.write(f"{datetime.now(CT):%Y-%m-%d %H:%M:%S} CT {os.path.basename(sys.argv[0])} {os.path.basename(work)}\n")
    except OSError:
        pass


def llm(work, system, prompt, max_tokens=12000, temperature=0.2, timeout=150, prefer="mara"):
    """Returns parsed JSON from the model. prefer="claude" (the script writer): claude-cli, MARA, SambaNova; else MARA,
    SambaNova, claude-cli. ("openrouter" is read as "claude": OpenRouter is no longer used, v1.4.0.)"""
    if prefer == "openrouter": prefer = "claude"
    force = {x.strip() for x in os.environ.get("SHORTS_LLM_FORCE_FAIL", "").split(",") if x.strip()}
    tries = []
    try:
        tries.append(("mara", "https://api.cloud.mara.com/v1/chat/completions", vault(work, "mara_api_key"), "MiniMax-M3"))
    except Exception as e:                           # noqa: BLE001
        log("mara key unavailable:", str(e)[:80])
    # SambaNova Cloud serves the same MiniMax-M3 (OpenAI-compatible). The key FILE wins: a stale SAMBANOVA_API_KEY in the
    # shell env returns 401 (10/1).
    snf = os.path.expanduser("~/.private_keys/sambanova.txt")
    if os.path.exists(snf) and open(snf).read().strip():
        tries.append(("sambanova", "https://api.sambanova.ai/v1/chat/completions", open(snf).read().strip(), "MiniMax-M3"))
    if os.path.exists(CLAUDE_BIN):
        cl = ("claude", None, None, os.environ.get("SHORTS_CLAUDE_MODEL", "sonnet"))
        if prefer == "claude": tries.insert(0, cl)
        else: tries.append(cl)
    # a reply with no JSON object goes straight to the next provider (no second attempt); a provider that did that twice in
    # this process goes last for the rest of it (10/2 korea-open: 5 x "max() arg is an empty sequence" ate 2.5 min)
    tries.sort(key=lambda t: _NOJSON.get(t[0], 0) >= 2)
    last = None
    for name, url, key, model in tries:
        for attempt in range(2):
            t0 = time.time()
            # one hung call must not eat the budget: never wait past what the run can spend on it
            to = max(20, min(timeout, int(budget_left() - 240)))
            try:
                if name in force: raise RuntimeError(f"forced failure (SHORTS_LLM_FORCE_FAIL={','.join(sorted(force))})")
                if name == "claude":
                    why = _claude_gate(work)
                    if why: raise RuntimeError(f"claude skipped: {why}")
                    _claude_count(work)
                    c = _claude_cli(system + " Respond with ONE JSON object only, first character '{'.", prompt, to)
                else:
                    body = {"model": model, "temperature": temperature, "max_tokens": max_tokens,
                            "response_format": {"type": "json_object"},
                            "messages": [{"role": "system", "content": system + " Respond with ONE JSON object only, first character '{'."},
                                         {"role": "user", "content": prompt}]}
                    r = post(url, body, {"Authorization": f"Bearer {key}"}, timeout=to)
                    c = r["choices"][0]["message"]["content"] or ""
                    if r["choices"][0].get("finish_reason") == "length":
                        raise RuntimeError(f"reply cut at max_tokens {max_tokens} ({(r.get('usage') or {}).get('completion_tokens')} tokens)")
                out = _largest_json(c)
                log(f"llm {name}/{model} {time.time() - t0:.0f}s ok")
                out["_model"] = f"{name}/{model}"
                return out
            except Exception as e:                   # noqa: BLE001
                last = e; log(f"llm {name} attempt {attempt + 1} failed after {time.time() - t0:.0f}s: {str(e)[:160]}")
                # a forced failure, a bad key or no credit: retrying the same provider cannot help, go to the next one at once
                if name == "claude" and re.search(r"usage limit|limit · resets|rate limit", str(e), re.I):
                    try: open(CLAUDE_LIMIT, "w").write(str(e)[:200])
                    except OSError: pass
                if name in force or re.search(r"-> (401|402|403) |claude skipped|usage limit|limit · resets", str(e)) or "empty result" in str(e): break
                if isinstance(e, ValueError) and "empty sequence" in str(e):      # no JSON in the reply: next provider at once
                    _NOJSON[name] = _NOJSON.get(name, 0) + 1; break
    raise RuntimeError(f"every model failed: {last}")


def _selftest_llm():
    """python3 lib.py --selftest-llm: a tiny JSON prompt through each tier for real (claude-cli, MARA, SambaNova), forcing
    the tiers above it to fail; prints the tier that answered and its latency. Exit 1 if any case fails."""
    import tempfile
    w = os.environ.get("SHORTS_SELFTEST_WORK") or tempfile.mkdtemp(prefix="shorts-llm-test-")
    os.chmod(w, 0o700)
    cases = [("", "claude", "claude"), ("claude", "claude", "mara"), ("claude,mara", "claude", "sambanova"),
             ("", "mara", "mara"), ("mara", "mara", "sambanova"), ("mara,sambanova", "mara", "claude")]
    bad = 0
    for force, prefer, want in cases:
        os.environ["SHORTS_LLM_FORCE_FAIL"] = force; t0 = time.time()
        try:
            o = llm(w, "You return tiny JSON.", 'Return {"ok": true, "n": 7}.', max_tokens=2000, timeout=90, prefer=prefer)
            got = o.get("_model", "?").split("/")[0]; ok = o.get("ok") is True and o.get("n") == 7 and got == want
        except Exception as e:                       # noqa: BLE001
            got, ok = f"error {str(e)[:80]}", False
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'} prefer={prefer:<6} force_fail={force or '-':<15} -> {got:<10} {time.time() - t0:5.1f}s", flush=True)
    os.environ.pop("SHORTS_LLM_FORCE_FAIL", None)
    print("ALL PASS" if not bad else f"{bad} FAILED"); return 1 if bad else 0


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


if __name__ == "__main__" and "--selftest-llm" in sys.argv:
    sys.exit(_selftest_llm())
