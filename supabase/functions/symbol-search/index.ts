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

// Yahoo's search API rejects Hangul queries ("Invalid Search Query"), so common Korean
// names are rewritten to their English search terms. English-first product; KR listings
// stay fully searchable either way.
const KR_ALIAS: [RegExp, string][] = [
  [/삼성/, "Samsung"], [/하이닉스|에스케이/, "hynix"], [/현대/, "Hyundai"], [/기아/, "Kia"],
  [/네이버/, "NAVER"], [/카카오/, "Kakao"], [/엘지|LG에너지/, "LG"], [/포스코/, "POSCO"],
  [/셀트리온/, "Celltrion"], [/두산/, "Doosan"], [/한화/, "Hanwha"], [/롯데/, "Lotte"],
];

async function yahooSearch(qRaw: string): Promise<CatalogRow[]> {
  let q = qRaw;
  if (/[가-힣]/.test(q)) {
    const hit = KR_ALIAS.find(([re]) => re.test(q));
    if (hit) q = hit[1]; else return [];              // unmapped Hangul: Yahoo would 400
  }
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

function chartPoints(res: Record<string, any>): { ts: string; price: number }[] {
  const stamps: number[] = res?.timestamp ?? [];
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
  const out: { ts: string; price: number }[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    if (c && c > 0) out.push({ ts: new Date(stamps[i] * 1000).toISOString(), price: c });
  }
  return out;
}

async function fetchChart(yahoo: string, range: string, interval: string): Promise<Record<string, any> | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  const body = await r.json().catch(() => null);
  return body?.chart?.result?.[0] ?? null;
}

async function yahooChart(yahoo: string): Promise<ChartData | null> {
  // Backfilled at register time so every range is meaningful the moment a ticker is added:
  // 5y weekly (5Y/1Y context) + 1y daily (1Y/3M/1M) + 5d 15-minute bars (1W/1D).
  const res = await fetchChart(yahoo, "1y", "1d");
  const meta = res?.meta;
  if (!meta || !(meta.regularMarketPrice > 0)) return null;
  const history = chartPoints(res!);
  const [weekly, intra] = await Promise.all([fetchChart(yahoo, "5y", "1wk"), fetchChart(yahoo, "5d", "15m")]);
  if (weekly) history.push(...chartPoints(weekly));
  if (intra) history.push(...chartPoints(intra));
  history.sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    price: meta.regularMarketPrice,
    prev_close: meta.chartPreviousClose ?? meta.previousClose ?? null,
    currency: meta.currency ?? "USD",
    market_state: "unknown",
    as_of: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    history,
  };
}

// Browser-called (supabase-js functions.invoke): preflight + CORS on every response.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
      return json({ ok: false, error: "ensure needs symbol, yahoo, name" }, 400);
    }
    const chart: ChartData | null = fixture ? (body.chart ?? null) : await yahooChart(e.yahoo);
    if (!chart) return json({ ok: false, error: `Could not verify ${e.symbol} with the market data source` }, 422);
    const currency = chart.currency === "KRW" ? "KRW" : "USD";
    const row = {
      symbol: e.symbol, name: e.name.slice(0, 200),
      exchange: (e.exchange ?? "NASDAQ").slice(0, 40), currency,
      kind: ["equity", "etf", "fund", "crypto"].includes(e.kind) ? e.kind : "equity",
      yahoo: e.yahoo, active: true,
    };
    const { error: sErr } = await admin.from("symbols").upsert(row, { onConflict: "symbol" });
    if (sErr) return json({ ok: false, error: sErr.message }, 500);
    const prev = chart.prev_close;
    const { error: pErr } = await admin.from("prices").upsert({
      symbol: row.symbol, price: chart.price, prev_close: prev,
      change_pct: prev ? ((chart.price / prev) - 1) * 100 : null,
      currency, market_state: chart.market_state, as_of: chart.as_of, source: "yahoo-v8-chart",
    }, { onConflict: "symbol" });
    if (pErr) return json({ ok: false, error: pErr.message }, 500);
    // Dedupe by ts (a day's first 15m bar shares its timestamp with the daily bar —
    // duplicate keys in one statement make Postgres reject the whole upsert).
    const byTs = new Map<string, number>();
    for (const h of [...chart.history, { ts: chart.as_of, price: chart.price }]) byTs.set(h.ts, h.price);
    const hist = [...byTs.entries()].map(([ts, price]) => ({ symbol: row.symbol, ts, price }));
    if (hist.length) {
      const { error: hErr } = await admin.from("price_history").upsert(hist, { onConflict: "symbol,ts" });
      if (hErr) return json({ ok: false, error: hErr.message }, 500);
    }
    return json({ ok: true, symbol: row, price: chart.price, history: hist.length });
  }

  // ---- search ----
  if (!q) return json({ ok: true, results: [] });
  const results = fixture
    ? (body.results ?? []).map((r: Record<string, unknown>) => mapQuote(r)).filter(Boolean)
    : await yahooSearch(q);
  return json({ ok: true, results });
});
