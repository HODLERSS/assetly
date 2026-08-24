// Assetly symbol-search — universal ticker discovery + on-demand catalog growth.
// GET/POST {q}: proxies Yahoo Finance search (US exchanges + KRX + major crypto), normalized.
// POST {ensure}: server-side verify via Yahoo chart, upsert symbols + current price
//                + ~3 months of daily price history, so a brand-new ticker is live instantly.
// The 1-min price cron then keeps it fresh (held or recently-created symbols).
import { createClient } from "jsr:@supabase/supabase-js@2";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Yahoo exchange codes we serve: all major US venues + OTC, Korea (KOSPI/KOSDAQ), crypto.
const US_EXCH = new Set(["NYQ", "NMS", "NGM", "NGS", "NCM", "ASE", "PCX", "BTS", "PNK", "CXI"]);
const KR_EXCH = new Set(["KSC", "KOE"]);
const KINDS: Record<string, string> = { EQUITY: "equity", ETF: "etf", MUTUALFUND: "fund", CRYPTOCURRENCY: "crypto" };

type CatalogRow = {
  symbol: string; name: string; exchange: string; currency: "USD" | "KRW";
  kind: string; yahoo: string;
};

function exchDisplay(code: string, disp: string | undefined, kr: boolean, crypto: boolean): string {
  if (crypto) return "CRYPTO";
  if (kr) return "KRX";
  if (code === "PNK") return "OTC";
  if (code === "NYQ") return "NYSE";
  if (code === "ASE") return "AMEX";
  if (code.startsWith("N")) return "NASDAQ";
  return disp ?? code;
}

export function mapQuote(q: Record<string, unknown>): CatalogRow | null {
  const kind = KINDS[String(q.quoteType ?? "")];
  if (!kind) return null;
  const ysym = String(q.symbol ?? "");
  if (!ysym || !/^[A-Z0-9.\-=^]+$/i.test(ysym)) return null;
  const exch = String(q.exchange ?? "");
  const crypto = kind === "crypto";
  const kr = ysym.endsWith(".KS") || ysym.endsWith(".KQ");
  if (crypto) { if (!ysym.endsWith("-USD")) return null; }
  else if (kr) { if (!KR_EXCH.has(exch)) return null; }
  else if (!US_EXCH.has(exch)) return null;                 // other countries: out of scope
  const name = String(q.longname ?? q.shortname ?? "").trim();
  if (!name) return null;
  // Display symbol: BRK-B -> BRK.B for US listings, BTC-USD -> BTC, KR codes as-is.
  const symbol = crypto ? ysym.replace(/-USD$/, "") : kr ? ysym : ysym.replace(/-/g, ".");
  return {
    symbol, name, yahoo: ysym, kind,
    exchange: exchDisplay(exch, q.exchDisp as string | undefined, kr, crypto),
    currency: kr ? "KRW" : "USD",
  };
}

async function yahooSearch(q: string): Promise<CatalogRow[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return [];
  const body = await r.json().catch(() => null);
  const out: CatalogRow[] = [];
  for (const raw of body?.quotes ?? []) {
    const row = mapQuote(raw);
    if (row && !out.some((x) => x.symbol === row.symbol)) out.push(row);
  }
  return out.slice(0, 12);
}

type ChartData = {
  price: number; prev_close: number | null; currency: string; market_state: string;
  as_of: string; history: { ts: string; price: number }[];
};

async function yahooChart(yahoo: string): Promise<ChartData | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=3mo&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  const body = await r.json().catch(() => null);
  const res = body?.chart?.result?.[0];
  const meta = res?.meta;
  if (!meta || !(meta.regularMarketPrice > 0)) return null;
  const stamps: number[] = res?.timestamp ?? [];
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
  const history: { ts: string; price: number }[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    if (c && c > 0) history.push({ ts: new Date(stamps[i] * 1000).toISOString(), price: c });
  }
  return {
    price: meta.regularMarketPrice,
    prev_close: meta.chartPreviousClose ?? meta.previousClose ?? null,
    currency: meta.currency ?? "USD",
    market_state: "unknown",
    as_of: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    history,
  };
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const q = (url.searchParams.get("q") ?? body.q ?? "").trim();

  // ---- ensure: verify + register + price + history ----
  if (body.ensure) {
    const e = body.ensure as CatalogRow;
    if (!e.symbol || !e.yahoo || !e.name) {
      return Response.json({ ok: false, error: "ensure needs symbol, yahoo, name" }, { status: 400 });
    }
    const chart: ChartData | null = fixture ? (body.chart ?? null) : await yahooChart(e.yahoo);
    if (!chart) return Response.json({ ok: false, error: `Could not verify ${e.symbol} with the market data source` }, { status: 422 });
    const currency = chart.currency === "KRW" ? "KRW" : "USD";
    const row = {
      symbol: e.symbol, name: e.name.slice(0, 200),
      exchange: (e.exchange ?? "NASDAQ").slice(0, 40), currency,
      kind: ["equity", "etf", "fund", "crypto"].includes(e.kind) ? e.kind : "equity",
      yahoo: e.yahoo, active: true,
    };
    const { error: sErr } = await admin.from("symbols").upsert(row, { onConflict: "symbol" });
    if (sErr) return Response.json({ ok: false, error: sErr.message }, { status: 500 });
    const prev = chart.prev_close;
    const { error: pErr } = await admin.from("prices").upsert({
      symbol: row.symbol, price: chart.price, prev_close: prev,
      change_pct: prev ? ((chart.price / prev) - 1) * 100 : null,
      currency, market_state: chart.market_state, as_of: chart.as_of, source: "yahoo-v8-chart",
    }, { onConflict: "symbol" });
    if (pErr) return Response.json({ ok: false, error: pErr.message }, { status: 500 });
    const hist = [...chart.history, { ts: chart.as_of, price: chart.price }]
      .map((h) => ({ symbol: row.symbol, ts: h.ts, price: h.price }));
    if (hist.length) await admin.from("price_history").upsert(hist, { onConflict: "symbol,ts" });
    return Response.json({ ok: true, symbol: row, price: chart.price, history: hist.length });
  }

  // ---- search ----
  if (!q) return Response.json({ ok: true, results: [] });
  const results = fixture
    ? (body.results ?? []).map((r: Record<string, unknown>) => mapQuote(r)).filter(Boolean)
    : await yahooSearch(q);
  return Response.json({ ok: true, results });
});
