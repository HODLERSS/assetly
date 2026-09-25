// Price-history access for the intelligence functions, and the daily-close backfill that gives a newly
// held symbol real 1W / 1M / 1Y windows on day one.
//
// Why a helper: every function used to pull "all rows since N days ago, ascending, limit 2000" and read
// the LAST element as today's price. price_history keeps every tick for 7 days (one per minute while a
// market trades, 1,440 a day for crypto) and PostgREST caps a response at 1,000 rows, so the ascending
// slice stopped days short of today and the "latest" price was stale. Windows are now read point by point:
// the latest price, and for each window the last price at or before its start.
import { CLOSE_MIN, zonedEpoch, zonedParts } from "./calendar.ts";
import { pctOver, type Pt } from "./intel.ts";

// deno-lint-ignore no-explicit-any
type Db = any;   // the supabase-js client (typed loosely: the functions use the untyped builder)

/** Latest price plus the percent change over each window (null = the history does not reach back). */
export async function windowReturns(admin: Db, symbol: string, days: number[], now = Date.now()): Promise<{ last: Pt | null; pct: Record<number, number | null> }> {
  const one = (q: Db) => q.limit(1).then((r: { data: { ts: string; price: number }[] | null }) => r.data?.[0] ? { ts: String(r.data[0].ts), price: Number(r.data[0].price) } : null, () => null);
  const tbl = () => admin.from("price_history").select("ts,price").eq("symbol", symbol);
  const [last, ...bases] = await Promise.all([
    one(tbl().order("ts", { ascending: false })),
    ...days.map(async (d) => {
      const cutoff = new Date(now - d * 86400000).toISOString();
      // the price AS OF the window start; failing that, the first price after it (pctOver judges the gap)
      return (await one(tbl().lte("ts", cutoff).order("ts", { ascending: false })))
        ?? (await one(tbl().gt("ts", cutoff).order("ts", { ascending: true })));
    }),
  ]);
  const pct: Record<number, number | null> = {};
  days.forEach((d, i) => { const b = bases[i]; pct[d] = b && last ? pctOver([b, last], d, now) : null; });
  return { last, pct };
}

/** Does this symbol lack a year of daily history (no point older than ~11 months)? */
export async function historyIsShort(admin: Db, symbol: string, now = Date.now()): Promise<boolean> {
  const { data } = await admin.from("price_history").select("ts").eq("symbol", symbol)
    .lte("ts", new Date(now - 330 * 86400000).toISOString()).limit(1);
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

/** Backfill every symbol in the list whose history is short (or all of them with force); at most `cap`
 *  per call, four at a time. Returns days written per symbol and how many were left for a re-run. */
export async function backfillShort(admin: Db, symbols: string[], opts: { force?: boolean; cap?: number } = {}): Promise<{ backfilled: Record<string, number>; remaining: number }> {
  const want = [...new Set(symbols.filter((s) => s && !s.startsWith("$")))];
  if (!want.length) return { backfilled: {}, remaining: 0 };
  const { data: syms } = await admin.from("symbols").select("symbol, yahoo, kind").in("symbol", want).not("kind", "in", "(cash,debt)");
  const todo: { symbol: string; yahoo: string }[] = [];
  for (const sy of (syms ?? []) as { symbol: string; yahoo: string | null }[]) {
    if (opts.force || await historyIsShort(admin, sy.symbol)) todo.push({ symbol: sy.symbol, yahoo: sy.yahoo ?? sy.symbol });
  }
  const batch = todo.slice(0, opts.cap ?? 60);
  const backfilled: Record<string, number> = {};
  for (let i = 0; i < batch.length; i += 4) {
    const part = await Promise.all(batch.slice(i, i + 4).map(async (t) => [t.symbol, await backfillDaily(admin, t.symbol, t.yahoo, "2y")] as const));
    for (const [sy, n] of part) backfilled[sy] = n;
  }
  return { backfilled, remaining: Math.max(0, todo.length - batch.length) };
}
