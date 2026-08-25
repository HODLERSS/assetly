// Assetly price-sync — refreshes public.prices for every active symbol.
// Runs on a 1-minute schedule in production (see migrations/..._cron.sql); callable ad hoc.
// Sources: Yahoo v7 batch quote first, per-symbol v8 chart as fallback. Server-side only.
import { createClient } from "jsr:@supabase/supabase-js@2";

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
    out.set(symbol, {
      symbol,
      price: q.regularMarketPrice,
      prev_close: prev,
      change_pct: prev !== null ? ((q.regularMarketPrice / prev) - 1) * 100 : null,
      currency: q.currency ?? "USD",
      market_state: (q.marketState ?? "unknown").toLowerCase(),
      as_of: new Date((q.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
      source: "yahoo-v7",
    });
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
  return {
    symbol,
    price: meta.regularMarketPrice,
    prev_close: prev,
    change_pct: prev ? ((meta.regularMarketPrice / prev) - 1) * 100 : null,
    currency: meta.currency ?? "USD",
    market_state: "unknown",
    as_of: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    source: "yahoo-v8-chart",
  };
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Track what matters: symbols someone holds, plus anything registered in the last 36h
  // (a just-added ticker stays live while the user finishes setting it up).
  const cutoff = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const [held, recent] = await Promise.all([
    admin.from("holdings").select("symbol"),
    admin.from("symbols").select("symbol").eq("active", true).gte("created_at", cutoff),
  ]);
  if (held.error) return Response.json({ ok: false, error: held.error.message }, { status: 500 });
  const wanted = new Set([
    ...(held.data ?? []).map((h) => h.symbol),
    ...(recent.data ?? []).map((r) => r.symbol),
    "USDKRW",                                       // FX rate for cross-currency totals: always fresh
  ]);
  const { data: symbols, error } = await admin
    .from("symbols").select("symbol, yahoo").eq("active", true).in("symbol", [...wanted]);
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
    let fallbacks = 0;
    for (const p of targets) {                       // fallback for anything the batch missed
      if (!quotes.has(p.symbol) && fallbacks < 25) {
        fallbacks++;
        const q = await yahooChart(p.symbol, p.yahoo);
        if (q) quotes.set(p.symbol, q);
      }
    }
  }

  // Own-data previous close: when the session date (UTC) rolls over, yesterday's final
  // stored price IS the previous close; within a session, keep the stored prev. Yahoo's
  // prev/changePercent fields have repeatedly shipped garbage (BTC 110k, META year-ago
  // close) — our own tick history is the source of truth the charts already use.
  const { data: stored } = await admin.from("prices")
    .select("symbol, price, prev_close, as_of").in("symbol", [...quotes.keys()]);
  const byStored = new Map((stored ?? []).map((s) => [s.symbol, s]));
  for (const q of quotes.values()) {
    const st = byStored.get(q.symbol);
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
  return Response.json({ ok: true, requested: targets.length, wrote, missed: targets.length - wrote });
});
