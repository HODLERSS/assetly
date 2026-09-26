// Assetly price-sync — refreshes public.prices for every active symbol.
// Runs on a 1-minute schedule in production (see migrations/..._cron.sql); callable ad hoc.
// Sources: Yahoo v7 batch quote first, per-symbol v8 chart as fallback. Server-side only.
//
// BACKFILL (?backfill=1, or body.backfill): two years of DAILY closes for held symbols whose stored history
// does not reach back ~11 months. The minute ticks only start the day a symbol is first held, so a new
// holding had 1W == 1M == "since I added it" (TSLA "+3.7% on the week" and "+3.7% on the month", 2026-09-25).
// Idempotent and cheap when nothing is short. The orchestrator and warmup run the same backfill in-process
// (_shared/history.ts) for the symbols they touch; this route is the operator's sweep over every held symbol.
// ?symbols=A,B limits it; force=1 (internal token only) refetches even when history looks long enough.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { backfillShort } from "../_shared/history.ts";
import { marketOf } from "../_shared/calendar.ts";
import { prevSessionWindow, resolvePrevClose, sessionsOf } from "../_shared/prevclose.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Yahoo occasionally returns a garbage previous close (seen: BTC prev 110k vs price 80k
// => -26.8% "today"). A >50% implied single-day move on a tracked major is far more likely
// bad data than reality — show no change rather than a wrong one.
function plausiblePrev(price: number, prev: number | null): number | null {
  if (prev === null || !(prev > 0)) return null;
  return Math.abs(price / prev - 1) > 0.5 ? null : prev;
}

type Quote = {
  symbol: string; price: number; prev_close: number | null; change_pct: number | null;
  currency: string; market_state: string; as_of: string; source: string;
};

// Yahoo quotes some venues in MINOR units (LSE in pence "GBp"/"GBX", JSE in cents "ZAc", TASE in agorot "ILA"):
// normalise to the major unit so a 72p share is stored as £0.72, never £72.
const MINOR: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ZAC: "ZAR", ILA: "ILS" };
const deMinor = (q: Quote): Quote => {
  const major = MINOR[q.currency];
  if (!major) return q;
  return { ...q, currency: major, price: q.price / 100, prev_close: q.prev_close === null ? null : q.prev_close / 100 };
};
async function yahooBatch(pairs: { symbol: string; yahoo: string }[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const syms = pairs.map((p) => p.yahoo).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return out;
  const body = await r.json().catch(() => null);
  const results = body?.quoteResponse?.result ?? [];
  const byYahoo = new Map(pairs.map((p) => [p.yahoo, p.symbol]));
  for (const q of results) {
    const symbol = byYahoo.get(q.symbol);
    if (!symbol || !(q.regularMarketPrice > 0)) continue;
    const prev = plausiblePrev(q.regularMarketPrice, q.regularMarketPreviousClose ?? null);
    out.set(symbol, deMinor({
      symbol,
      price: q.regularMarketPrice,
      prev_close: prev,
      change_pct: prev !== null ? ((q.regularMarketPrice / prev) - 1) * 100 : null,
      currency: q.currency ?? "USD",
      market_state: (q.marketState ?? "unknown").toLowerCase(),
      as_of: new Date((q.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
      source: "yahoo-v7",
    }));
  }
  return out;
}

async function yahooChart(symbol: string, yahoo: string): Promise<Quote | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1d&interval=1m`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  const body = await r.json().catch(() => null);
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta || !(meta.regularMarketPrice > 0)) return null;
  const prev = plausiblePrev(meta.regularMarketPrice, meta.chartPreviousClose ?? meta.previousClose ?? null);
  return deMinor({
    symbol,
    price: meta.regularMarketPrice,
    prev_close: prev,
    change_pct: prev ? ((meta.regularMarketPrice / prev) - 1) * 100 : null,
    currency: meta.currency ?? "USD",
    market_state: "unknown",
    as_of: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    source: "yahoo-v8-chart",
  });
}

// deno-lint-ignore no-explicit-any
async function backfill(admin: any, req: Request, url: URL): Promise<Response> {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
  const force = (url.searchParams.get("force") === "1" || body.force === true) && !!itok && req.headers.get("x-internal-token") === itok;
  const asked = url.searchParams.get("symbols")?.split(",") ?? (Array.isArray(body.symbols) ? body.symbols.map(String) : null);
  // only symbols somebody holds: this endpoint is reachable with the publishable key
  const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
  if (hErr) return Response.json({ ok: false, error: hErr.message }, { status: 500 });
  const held: string[] = [...new Set<string>((heldRows ?? []).map((h: { symbol: string }) => String(h.symbol)))].filter((sy) => !asked || asked.includes(sy));
  const res = await backfillShort(admin, held, { force });
  return Response.json({ ok: true, checked: held.length, ...res });
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  {
    const u0 = new URL(req.url);
    if (u0.searchParams.get("backfill") === "1") return backfill(admin, req, u0);
    const peek = req.method === "POST" ? await req.clone().json().catch(() => ({})) : {};
    if (peek?.backfill === true) return backfill(admin, req, u0);
  }
  // Track what matters: symbols someone holds, plus anything registered in the last 36h
  // (a just-added ticker stays live while the user finishes setting it up).
  const cutoff = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const [held, recent, fxSyms] = await Promise.all([
    admin.from("holdings").select("symbol"),
    admin.from("symbols").select("symbol").eq("active", true).gte("created_at", cutoff),
    admin.from("symbols").select("symbol").eq("active", true).like("symbol", "USD___"),
  ]);
  if (held.error) return Response.json({ ok: false, error: held.error.message }, { status: 500 });
  const wanted = new Set([
    ...(held.data ?? []).map((h) => h.symbol),
    ...(recent.data ?? []).map((r) => r.symbol),
    "USDKRW",                                       // FX rate for cross-currency totals: always fresh
    ...(fxSyms.data ?? []).map((r) => r.symbol),    // every USDxxx pair (CAD, GBP, EUR, JPY, AUD, HKD, INR ...) for brokerage imports in those currencies
    "ES=F", "NQ=F",                                 // US index futures: the pre-open pulse card
    "^VIX", "^KS11", "^GSPC",                       // market context for the Daily Brief
  ]);
  const { data: symbols, error } = await admin
    .from("symbols").select("symbol, yahoo, kind, currency").eq("active", true)
    .not("kind", "in", "(cash,debt)").in("symbol", [...wanted]);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const pairs = (symbols ?? []).map((s) => ({ symbol: s.symbol, yahoo: s.yahoo ?? s.symbol }));
  // Optional test hook: ?symbols=A,B limits the run; ?fixture=1 uses injected quotes (no network).
  const url = new URL(req.url);
  const only = url.searchParams.get("symbols")?.split(",");
  const targets = only ? pairs.filter((p) => only.includes(p.symbol)) : pairs;

  let quotes: Map<string, Quote>;
  if (url.searchParams.get("fixture") === "1") {
    const body = await req.json().catch(() => ({}));
    quotes = new Map((body.quotes ?? []).map((q: Quote) => [q.symbol, q]));
  } else {
    quotes = new Map();
    for (let i = 0; i < targets.length; i += 40) {   // chunked so any catalog size stays in URL limits
      const part = await yahooBatch(targets.slice(i, i + 40));
      for (const [k, v] of part) quotes.set(k, v);
    }
    // Yahoo v7 batch now often 401s (crumb requirement); the chart endpoint stays
    // reliable. Fetch EVERY missing symbol in parallel chunks — no cap, or the same
    // tail symbols go permanently stale (seen: 10 of 35 stuck at Thursday's close).
    const missing = targets.filter((p) => !quotes.has(p.symbol));
    for (let i = 0; i < missing.length; i += 8) {
      const part = await Promise.all(missing.slice(i, i + 8).map((p) => yahooChart(p.symbol, p.yahoo)));
      for (const q of part) if (q) quotes.set(q.symbol, q);
    }
  }

  // Own-data previous close: our history's close of the previous session first (see below). Yahoo's
  // prev/changePercent fields have shipped garbage (BTC 110k, META year-ago close), so the provider's
  // previousClose is a plausibility-checked fallback, not the first source.
  const { data: stored } = await admin.from("prices")
    .select("symbol, price, prev_close, as_of").in("symbol", [...quotes.keys()]);
  const byStored = new Map((stored ?? []).map((s) => [s.symbol, s]));
  const kindOf = new Map((symbols ?? []).map((s) => [s.symbol, { kind: s.kind as string | null, currency: (s as { currency?: string | null }).currency ?? null }]));
  // Round 9: the previous close is the LAST COMPLETED SESSION's close (_shared/prevclose.ts), never a stale stored row.
  // It is RECOMPUTED on every run from our own history (the close tick / daily bar of the session before the quote's
  // session), so a wrong stored base heals on the next run with no manual trigger: symbol-search wrote the close of
  // two sessions back after hours (Yahoo's daily bar for today has a null close until the next morning), and the old
  // rule kept that stored prev all weekend. One batched history read per market window, not one per symbol.
  const byWindow = new Map<string, { from: number; cut: number; syms: string[] }>();
  const ctx = new Map<string, { mkt: "US" | "KR" | null; key: string }>();
  for (const q of quotes.values()) {
    if (q.symbol.endsWith("=F") || q.symbol.startsWith("^") || /^USD[A-Z]{3}$/.test(q.symbol)) continue;   // futures / indices / FX keep their own rules below
    const k = kindOf.get(q.symbol);
    const mkt = marketOf(q.symbol, k?.kind ?? null, k?.currency ?? q.currency);
    const w = prevSessionWindow(q.as_of, mkt);
    // the close tick (price-sync stamps it at regularMarketTime = the close) or the daily bar stamped at the close
    const cut = mkt === null ? w.to : w.from + 31 * 60000;
    const key = `${w.from}:${cut}`;
    const g = byWindow.get(key) ?? { from: w.from, cut, syms: [] };
    g.syms.push(q.symbol);
    byWindow.set(key, g);
    ctx.set(q.symbol, { mkt, key });
  }
  const closeOf = new Map<string, number>();
  await Promise.all([...byWindow.values()].map(async (g) => {
    for (let off = 0; off < 20000; off += 1000) {
      const { data } = await admin.from("price_history").select("symbol, price, ts").in("symbol", g.syms)
        .gte("ts", new Date(g.from).toISOString()).lte("ts", new Date(g.cut).toISOString())
        .order("ts", { ascending: true }).range(off, off + 999);
      const rows = (data ?? []) as { symbol: string; price: number; ts: string }[];
      for (const r of rows) if (Number(r.price) > 0) closeOf.set(`${g.from}:${g.cut}|${r.symbol}`, Number(r.price));   // ascending: the last write wins
      if (rows.length < 1000) break;
    }
  })).catch(() => {});
  let corrected = 0;
  for (const q of quotes.values()) {
    const c = ctx.get(q.symbol);
    if (!c) continue;
    const st = byStored.get(q.symbol) ?? null;
    const hc = closeOf.get(`${c.key}|${q.symbol}`) ?? null;
    const prev = resolvePrevClose({ price: q.price, asOf: q.as_of, providerPrev: q.prev_close, stored: st ? { price: Number(st.price), prev_close: st.prev_close === null ? null : Number(st.prev_close), as_of: st.as_of } : null, historyClose: hc, mkt: c.mkt });
    const sameSession = !!st?.as_of && sessionsOf(String(st.as_of), c.mkt).session === sessionsOf(q.as_of, c.mkt).session;
    if (sameSession && prev !== null && st?.prev_close != null && Math.abs(prev - Number(st.prev_close)) > 1e-9) corrected++;
    q.prev_close = prev;
    q.change_pct = prev !== null ? ((q.price / prev) - 1) * 100 : null;
    (q as Quote & { _done?: boolean })._done = true;
  }
  for (const q of quotes.values()) {
    if ((q as Quote & { _done?: boolean })._done) { delete (q as Quote & { _done?: boolean })._done; continue; }
    const st = byStored.get(q.symbol);
    // Futures trade almost around the clock and settle at 5 PM ET: the last price before a UTC midnight is not
    // their previous close, the exchange SETTLE is (round 4: Nasdaq futures showed +0.7% against a 7:59 PM ET
    // price; against the settle they were +0.4%). Yahoo's chart meta carries the prior settle; use it.
    if (q.symbol.endsWith("=F")) {
      const prev = plausiblePrev(q.price, q.prev_close);
      q.prev_close = prev;
      q.change_pct = prev !== null ? ((q.price / prev) - 1) * 100 : null;
      continue;
    }
    if (st && st.as_of) {
      const rolled = q.as_of.slice(0, 10) > String(st.as_of).slice(0, 10);
      const derived = rolled ? Number(st.price) : (st.prev_close !== null ? Number(st.prev_close) : null);
      if (derived !== null && derived > 0) {
        q.prev_close = derived;
        q.change_pct = ((q.price / derived) - 1) * 100;
        continue;
      }
    }
    const prev = plausiblePrev(q.price, q.prev_close);   // first insert: best-effort Yahoo prev
    q.prev_close = prev;
    q.change_pct = prev !== null ? ((q.price / prev) - 1) * 100 : null;
  }

  const rows = [...quotes.values()];
  let wrote = 0;
  if (rows.length) {
    const { error: upErr } = await admin.from("prices").upsert(rows, { onConflict: "symbol" });
    if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 });
    wrote = rows.length;
    const hist = rows.map((q) => ({ symbol: q.symbol, ts: q.as_of, price: q.price }));
    await admin.from("price_history").upsert(hist, { onConflict: "symbol,ts" });
  }
  return Response.json({ ok: true, requested: targets.length, wrote, missed: targets.length - wrote, corrected });
});
