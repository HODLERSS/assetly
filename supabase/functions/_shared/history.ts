// Price-history access for the intelligence functions, and the daily-close backfill that gives a newly
// held symbol real 1W / 1M / 1Y windows on day one.
//
// Why a helper: every function used to pull "all rows since N days ago, ascending, limit 2000" and read
// the LAST element as today's price. price_history keeps every tick for 7 days (one per minute while a
// market trades, 1,440 a day for crypto) and PostgREST caps a response at 1,000 rows, so the ascending
// slice stopped days short of today and the "latest" price was stale. Windows are now read point by point:
// the latest price, and for each window the last price at or before its start.
import { CLOSE_MIN, isTradingDay, type Mkt, marketOf, TZ, zonedEpoch, zonedParts } from "./calendar.ts";
import { parseDividends, pctOver, type Pt, windowCutoff } from "./intel.ts";

// deno-lint-ignore no-explicit-any
type Db = any;   // the supabase-js client (typed loosely: the functions use the untyped builder)

/** Latest price plus the percent change over each window (null = the history does not reach back, or its
 *  base is not on the window's start in `mkt`'s sessions: see pctOver). `mkt` null = crypto, undefined = US. */
export async function windowReturns(admin: Db, symbol: string, days: number[], now = Date.now(), mkt?: Mkt | null): Promise<{ last: Pt | null; pct: Record<number, number | null> }> {
  const one = (q: Db) => q.limit(1).then((r: { data: { ts: string; price: number }[] | null }) => r.data?.[0] ? { ts: String(r.data[0].ts), price: Number(r.data[0].price) } : null, () => null);
  const tbl = () => admin.from("price_history").select("ts,price").eq("symbol", symbol);
  const [last, ...bases] = await Promise.all([
    one(tbl().order("ts", { ascending: false })),
    // the price AS OF the end of the window's target date (never a later one: pctOver judges how stale it is)
    ...days.map((d) => one(tbl().lte("ts", new Date(windowCutoff(d, now, mkt)).toISOString()).order("ts", { ascending: false }))),
  ]);
  const pct: Record<number, number | null> = {};
  days.forEach((d, i) => { const b = bases[i]; pct[d] = b && last ? pctOver([b, last], d, now, mkt) : null; });
  return { last, pct };
}

/** Does this symbol lack ~13 months of daily history (no point older than 400 days)? 400, not 365: the 1Y
 *  window needs a base AT its start, and a year-ago close must exist on a day the market traded. */
export const SHORT_DAYS = 400;
export async function historyIsShort(admin: Db, symbol: string, now = Date.now()): Promise<boolean> {
  const { data } = await admin.from("price_history").select("ts").eq("symbol", symbol)
    .lte("ts", new Date(now - SHORT_DAYS * 86400000).toISOString()).limit(1);
  return !(data ?? []).length;
}

type YahooChart = { chart?: { result?: { meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] } }[] } };
/** Daily closes from a Yahoo v8 chart response, each stamped at its session's CLOSE (the timestamp Yahoo
 *  gives a daily bar is the session OPEN; storing that would put yesterday's close at this morning's open
 *  on a chart). Crypto bars are UTC days, stamped at the day's last second. Bars that have not closed yet
 *  (today's live session) are skipped: the 1-minute ticks own the live price. Minor-unit venues (pence,
 *  cents, agorot) are converted the way price-sync converts quotes. */
export function parseYahooDaily(body: YahooChart, now = Date.now()): Pt[] {
  const res = body?.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const close = res?.indicators?.quote?.[0]?.close ?? [];
  const meta = (res?.meta ?? {}) as { exchangeTimezoneName?: string; instrumentType?: string; currency?: string; currentTradingPeriod?: { regular?: { end?: number; gmtoffset?: number } } };
  const tz = meta.exchangeTimezoneName || "America/New_York";
  const crypto = meta.instrumentType === "CRYPTOCURRENCY" || tz === "UTC";
  const minor = ["GBp", "GBX", "ZAc", "ZAC", "ILA"].includes(String(meta.currency ?? ""));
  const endEpoch = meta.currentTradingPeriod?.regular?.end;
  // the two markets the app models have fixed closes (Yahoo reports a shortened period on a KRX holiday);
  // anything else takes the close Yahoo gives for its regular session
  const closeMin = tz === "America/New_York" ? CLOSE_MIN.US : tz === "Asia/Seoul" ? CLOSE_MIN.KR
    : typeof endEpoch === "number" ? zonedParts(new Date(endEpoch * 1000), tz).minutes : 16 * 60;
  const out: Pt[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (c === null || c === undefined || !(c > 0)) continue;
    const barMs = ts[i] * 1000;
    const at = crypto ? Math.floor(barMs / 86400000) * 86400000 + 86399000 : zonedEpoch(zonedParts(new Date(barMs), tz).ymd, closeMin, tz);
    if (at > now) continue;
    out.push({ ts: new Date(at).toISOString(), price: Number((minor ? c / 100 : c).toFixed(6)) });
  }
  return out;
}

/** Weekly closes from a Yahoo v8 weekly chart, each stamped at the week's LAST session close (Friday's close
 *  time). Yahoo stamps a weekly bar at the week's start (Monday 00:00 local), so a stored weekly row used to
 *  carry Friday's close four days early; symbol-search wrote them that way at register time. Weeks that have
 *  not finished are skipped. `before` keeps only bars older than an instant (the daily series covers the rest). */
export function parseYahooWeekly(body: YahooChart, now = Date.now(), before = Infinity): Pt[] {
  const res = body?.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const close = res?.indicators?.quote?.[0]?.close ?? [];
  const meta = (res?.meta ?? {}) as { exchangeTimezoneName?: string; instrumentType?: string; currency?: string };
  const tz = meta.exchangeTimezoneName || "America/New_York";
  const crypto = meta.instrumentType === "CRYPTOCURRENCY" || tz === "UTC";
  const minor = ["GBp", "GBX", "ZAc", "ZAC", "ILA"].includes(String(meta.currency ?? ""));
  const closeMin = tz === "Asia/Seoul" ? CLOSE_MIN.KR : CLOSE_MIN.US;
  const out: Pt[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (c === null || c === undefined || !(c > 0)) continue;
    const startYmd = zonedParts(new Date(ts[i] * 1000), crypto ? "UTC" : tz).ymd;
    const end = new Date(startYmd + "T12:00:00Z"); end.setUTCDate(end.getUTCDate() + (crypto ? 6 : 4));
    const endYmd = end.toISOString().slice(0, 10);
    const at = crypto ? Date.parse(endYmd + "T23:59:59Z") : zonedEpoch(endYmd, closeMin, tz);
    if (at > now || at >= before) continue;
    out.push({ ts: new Date(at).toISOString(), price: Number((minor ? c / 100 : c).toFixed(6)) });
  }
  return out;
}

/** Does a held symbol's daily history have holes? Over the last 60 days (the minute ticks own the last 7),
 *  more than 2 of its market's sessions without a stored price. Price-sync outages and register-time gaps left
 *  such holes, and a window whose target date falls in one reads a stale base or none at all. */
export async function historyHasGaps(admin: Db, symbol: string, mkt: Mkt | null, now = Date.now()): Promise<boolean> {
  const from = now - 60 * 86400000, to = now - 7 * 86400000;
  const { data } = await admin.from("price_history").select("ts").eq("symbol", symbol)
    .gte("ts", new Date(from).toISOString()).lte("ts", new Date(to).toISOString()).order("ts", { ascending: true }).limit(1000);
  const tz = mkt ? TZ[mkt] : "UTC";
  const have = new Set(((data ?? []) as { ts: string }[]).map((r) => zonedParts(new Date(r.ts), tz).ymd));
  let missing = 0;
  for (let t = from + 86400000; t < to; t += 86400000) {
    const ymd = zonedParts(new Date(t), tz).ymd;
    if ((mkt ? isTradingDay(mkt, ymd) : true) && !have.has(ymd)) missing++;
  }
  return missing > 2;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
/** Fetch ~`range` of daily closes for one symbol and upsert them into price_history. Idempotent: rows are
 *  keyed (symbol, ts), and a re-run writes the same close timestamps. Returns the number of days written. */
export async function backfillDaily(admin: Db, symbol: string, yahoo: string, range = "2y"): Promise<number> {
  const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${range}&interval=1d&includePrePost=false`,
    { headers: { "User-Agent": UA, Accept: "application/json" } }).catch(() => null);
  if (!r || !r.ok) return 0;
  const pts = parseYahooDaily(await r.json().catch(() => ({})));
  let wrote = 0;
  for (let i = 0; i < pts.length; i += 500) {
    const chunk = pts.slice(i, i + 500).map((p) => ({ symbol, ts: p.ts, price: p.price }));
    const { error } = await admin.from("price_history").upsert(chunk, { onConflict: "symbol,ts", ignoreDuplicates: true });
    if (!error) wrote += chunk.length;
  }
  return wrote;
}

// Symbols this worker already tried recently: a young listing (an IPO under 400 days old) is short forever,
// so without a memo every insights lap would refetch it. The DB stamp (symbols.history_backfilled_at,
// migration 37) carries the same memo across workers; this map covers the time before that migration.
const tried = new Map<string, number>();
const RETRY_MS = 7 * 86400000;

/** Backfill every symbol in the list whose history is short (or all of them with force); at most `cap`
 *  per call, four at a time. A symbol backfilled in the last 7 days is skipped unless forced (it is as long
 *  as Yahoo has it). Returns days written per symbol and how many were left for a re-run. */
export async function backfillShort(admin: Db, symbols: string[], opts: { force?: boolean; cap?: number } = {}): Promise<{ backfilled: Record<string, number>; remaining: number }> {
  const want = [...new Set(symbols.filter((s) => s && !s.startsWith("$")))]
    .filter((s) => opts.force || Date.now() - (tried.get(s) ?? 0) > 86400000);   // looked at in this worker today: skip
  if (!want.length) return { backfilled: {}, remaining: 0 };
  // the stamp column arrives with migration 37; until then the read falls back to the old shape
  const withStamp = await admin.from("symbols").select("symbol, yahoo, kind, currency, history_backfilled_at").in("symbol", want).not("kind", "in", "(cash,debt)");
  const { data: syms } = withStamp.error
    ? await admin.from("symbols").select("symbol, yahoo, kind, currency").in("symbol", want).not("kind", "in", "(cash,debt)")
    : withStamp;
  const todo: { symbol: string; yahoo: string }[] = [];
  for (const sy of (syms ?? []) as { symbol: string; yahoo: string | null; kind: string | null; currency: string | null; history_backfilled_at?: string | null }[]) {
    const age = sy.history_backfilled_at ? Date.now() - +new Date(sy.history_backfilled_at) : Infinity;
    // short history: once a week at most; holes in a long history: once a day at most (the refill is idempotent)
    const due = opts.force || (age >= RETRY_MS && await historyIsShort(admin, sy.symbol))
      || (age >= 86400000 && await historyHasGaps(admin, sy.symbol, marketOf(sy.symbol, sy.kind, sy.currency)));
    if (due) todo.push({ symbol: sy.symbol, yahoo: sy.yahoo ?? sy.symbol });
    else tried.set(sy.symbol, Date.now());   // whole and gap-free (or recently done): no need to look again for a while
  }
  const batch = todo.slice(0, opts.cap ?? 60);
  const backfilled: Record<string, number> = {};
  for (let i = 0; i < batch.length; i += 4) {
    const part = await Promise.all(batch.slice(i, i + 4).map(async (t) => [t.symbol, await backfillDaily(admin, t.symbol, t.yahoo, "2y")] as const));
    for (const [sy, n] of part) {
      backfilled[sy] = n;
      if (n > 0) {
        tried.set(sy, Date.now());
        await admin.from("symbols").update({ history_backfilled_at: new Date().toISOString() }).eq("symbol", sy).then(() => {}, () => {});
      }
    }
  }
  return { backfilled, remaining: Math.max(0, todo.length - batch.length) };
}

/** Self-healing history: any function that is about to read windows for held symbols calls this, so a
 *  symbol whose history does not reach back 400 days gets its two years of daily closes without anyone
 *  running the manual sweep (round 2: AMZN, held since Aug 28, was never backfilled and its 1M was wrong).
 *  Bounded (cap symbols, budget ms), idempotent (upserts keyed on symbol+ts), and never throws. */
export async function ensureHistory(admin: Db, symbols: string[], opts: { cap?: number; budgetMs?: number } = {}): Promise<Record<string, number> | "timeout"> {
  const run = backfillShort(admin, symbols, { cap: opts.cap ?? 4 }).then((r) => r.backfilled, () => ({}));
  return await Promise.race([run, new Promise<"timeout">((res) => setTimeout(() => res("timeout"), opts.budgetMs ?? 20000))]);
}

/** Held symbols whose catalog name is just the ticker ("AVGO", round 2: the Home list read "AVGO AVGO" and
 *  every prompt called Broadcom "AVGO") get Yahoo's long name. A few per call; a no-op once names are real. */
export async function repairNames(admin: Db, symbols: string[], cap = 5): Promise<string[]> {
  const want = [...new Set(symbols.filter((s) => s && !s.startsWith("$")))];
  if (!want.length) return [];
  const { data } = await admin.from("symbols").select("symbol, yahoo, name, kind").in("symbol", want).not("kind", "in", "(cash,debt)");
  const bad = ((data ?? []) as { symbol: string; yahoo: string | null; name: string | null }[])
    .filter((r) => !r.name || !r.name.trim() || r.name.trim().toUpperCase() === r.symbol.toUpperCase() || r.name.trim().toUpperCase() === String(r.yahoo ?? "").toUpperCase())
    .slice(0, cap);
  const fixed: string[] = [];
  for (const r of bad) {
    const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(r.yahoo ?? r.symbol)}?range=1d&interval=1d`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }).then((x) => x.ok ? x.json() : null).catch(() => null) as YahooChart | null;
    const meta = (res?.chart?.result?.[0]?.meta ?? {}) as { longName?: string; shortName?: string };
    const name = String(meta.longName || meta.shortName || "").trim();
    if (!name || name.toUpperCase() === r.symbol.toUpperCase()) continue;
    const { error } = await admin.from("symbols").update({ name: name.slice(0, 200) }).eq("symbol", r.symbol);
    if (!error) fixed.push(r.symbol);
  }
  return fixed;
}

/** Dividend data for held symbols from Yahoo's chart events, stored on `symbols` (migration 40). A few per call;
 *  a symbol refreshed in the last three days is skipped, and one that pays nothing is stamped so it is not
 *  asked again every lap. Never throws. */
export async function refreshDividends(admin: Db, symbols: string[], cap = 6): Promise<string[]> {
  const want = [...new Set(symbols.filter((s) => s && !s.startsWith("$")))];
  if (!want.length) return [];
  const r = await admin.from("symbols").select("symbol, yahoo, kind, div_as_of").in("symbol", want).not("kind", "in", "(cash,debt,crypto)");
  if (r.error) return [];   // before migration 40
  const due = ((r.data ?? []) as { symbol: string; yahoo: string | null; div_as_of: string | null }[])
    .filter((x) => !x.div_as_of || Date.now() - +new Date(x.div_as_of) > 3 * 86400000).slice(0, cap);
  if (!due.length) return [];
  const { data: px } = await admin.from("prices").select("symbol, price").in("symbol", due.map((d) => d.symbol));
  const priceOf = new Map(((px ?? []) as { symbol: string; price: number }[]).map((p) => [p.symbol, Number(p.price)]));
  const today = new Date().toISOString().slice(0, 10);
  const done: string[] = [];
  await Promise.all(due.map(async (d) => {
    const body = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(d.yahoo ?? d.symbol)}?range=2y&interval=1mo&events=div`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!body) return;
    const info = parseDividends(body, priceOf.get(d.symbol) ?? null, today);
    const { error } = await admin.from("symbols").update({
      div_last: info?.last ?? null, div_last_ex: info?.lastEx ?? null, div_ttm: info?.ttm ?? null, div_freq_days: info?.freqDays ?? null,
      div_next_ex: info?.nextEx ?? null, div_yield: info?.yieldPct ?? null, div_as_of: new Date().toISOString(),
    }).eq("symbol", d.symbol);
    if (!error) done.push(d.symbol);
  }));
  return done;
}

export type DivRow = { symbol: string; div_as_of?: string | null; div_last: number | null; div_last_ex: string | null; div_ttm: number | null; div_freq_days: number | null; div_next_ex: string | null; div_yield: number | null };
/** The stored dividend rows for some symbols (empty before migration 40). */
export async function dividendRows(admin: Db, symbols: string[]): Promise<Map<string, DivRow>> {
  if (!symbols.length) return new Map();
  const r = await admin.from("symbols").select("symbol, div_as_of, div_last, div_last_ex, div_ttm, div_freq_days, div_next_ex, div_yield").in("symbol", symbols);
  if (r.error) return new Map();
  return new Map(((r.data ?? []) as DivRow[]).map((x) => [x.symbol, x]));
}
/** One labelled, symbol-keyed line of dividend facts for a prompt, and the amounts a stated figure may use. */
/** `ccy` is the holding's currency and `perUsd` how many units of it buy one dollar (1 for USD). Per-share and
 *  per-holding figures stay in the holding's currency; `annual` is always US dollars, so a portfolio total can sum
 *  it (Samsung's ₩50,460 a year was summed as $50,460 into a "$65,824 income, 56% of assets" answer, 2026-09-25). */
export function dividendLine(name: string, d: DivRow | undefined, shares: number, ccy = "USD", perUsd = 1): { line: string; amounts: number[]; annual: number } {
  // never checked yet (div_as_of null) is "unknown", not "pays nothing": a $0.00 income answer was shown live
  if (!d || !d.div_as_of) return { line: `${name}: dividend data not loaded yet (unknown, do not state an amount or $0)`, amounts: [], annual: 0 };
  if (!(Number(d.div_last) > 0)) return { line: `${name}: pays no dividend`, amounts: [], annual: 0 };
  const last = Number(d.div_last), ttm = Number(d.div_ttm ?? 0), freq = Number(d.div_freq_days ?? 0);
  const perYear = freq ? last * Math.max(1, Math.round(365 / freq)) : ttm;
  const rhythm = freq ? (freq < 45 ? "monthly" : freq < 120 ? "quarterly" : freq < 250 ? "twice a year" : "yearly") : "irregular";
  const annualNative = shares * (ttm || perYear);
  const rate = perUsd > 0 ? perUsd : 1;
  const annual = annualNative / rate;
  const usdF = (v: number) => "$" + (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 1 ? 4 : 2));
  const f = ccy === "USD" ? usdF : ccy === "KRW" ? (v: number) => "₩" + Math.round(v).toLocaleString("en-US") : (v: number) => `${v.toFixed(2)} ${ccy}`;
  return {
    line: `${name}: last dividend ${f(last)} per share (ex-date ${d.div_last_ex}), paid ${rhythm}; last 12 months ${f(ttm)} per share${d.div_yield ? ` (yield ${d.div_yield}%)` : ""}; `
      + `your ${shares} shares ≈ ${f(annualNative)} a year${ccy === "USD" ? "" : ` (≈ ${usdF(annual)})`}, ≈ ${f(shares * last)} per payment${d.div_next_ex ? `; next ex-date expected around ${d.div_next_ex} (est)` : ""}`,
    amounts: [last, ttm, perYear, annualNative, shares * last, ...(ccy === "USD" ? [] : [annual])].filter((x) => x > 0),
    annual,
  };
}
