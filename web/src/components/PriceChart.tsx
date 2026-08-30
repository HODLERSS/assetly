import { useEffect, useMemo, useState } from "react";
import type { Api, HistoryPoint } from "../lib/api";
import { moneyExact, signedPct } from "../lib/format";

// Minimal price chart: pure SVG, no library. Ranges map to hours of history;
// 1D/1W ride the 1-min cron + 15m backfill, 1M/3M ride daily closes.
function ytdHours(): number {
  const now = new Date();
  return Math.max(48, (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 3600e3);
}
const RANGES = [
  { key: "1D", hours: 24 },
  { key: "1W", hours: 24 * 8 },
  { key: "1M", hours: 24 * 31 },
  { key: "3M", hours: 24 * 92 },
  { key: "6M", hours: 24 * 183 },
  { key: "YTD", hours: 0 },                    // dynamic: see ytdHours()
  { key: "1Y", hours: 24 * 366 },
  { key: "2Y", hours: 24 * 366 * 2 },
  { key: "5Y", hours: 24 * 366 * 5 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
const rangeHours = (key: RangeKey): number => {
  const r = RANGES.find((x) => x.key === key)!;
  return r.key === "YTD" ? ytdHours() : r.hours;
};

/** One point per calendar day: the last stored print of each past day is its close;
 *  today's point is the LIVE price while the market is trading. */
function dailyCloses(pts: HistoryPoint[], livePrice: number | null, liveAsOf: string | null): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const p of pts) byDay.set(p.ts.slice(0, 10), p);        // ascending input: last print wins
  if (livePrice !== null && liveAsOf) {
    const day = liveAsOf.slice(0, 10);
    byDay.set(day, { ts: liveAsOf, price: livePrice });
  }
  return [...byDay.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Intraday series for 1D: keep every print, append the live price as the newest point. */
function withLiveTick(pts: HistoryPoint[], livePrice: number | null, liveAsOf: string | null): HistoryPoint[] {
  const out = [...pts];
  if (livePrice !== null && liveAsOf && (!out.length || liveAsOf > out[out.length - 1].ts)) {
    out.push({ ts: liveAsOf, price: livePrice });
  }
  return out;
}

/** Downsample to at most n points, always keeping the last. */
function thin(pts: HistoryPoint[], n = 180): HistoryPoint[] {
  if (pts.length <= n) return pts;
  const step = (pts.length - 1) / (n - 1);
  const out: HistoryPoint[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

export function PriceChart({ api, symbol, currency, livePrice, liveAsOf, avgCost }: {
  api: Api; symbol: string; currency: string; livePrice: number | null; liveAsOf: string | null;
  avgCost?: number | null;
}) {
  const [range, setRange] = useState<RangeKey>("1M");
  const [pts, setPts] = useState<HistoryPoint[] | null>(null);   // null = loading

  useEffect(() => {
    let live = true;
    setPts(null);
    const intraday = range === "1D";
    api.getHistory(symbol, rangeHours(range))
      .then((p) => { if (live) setPts(thin(intraday ? withLiveTick(p, livePrice, liveAsOf) : dailyCloses(p, livePrice, liveAsOf))); })
      .catch(() => { if (live) setPts([]); });
    return () => { live = false; };
  }, [api, symbol, range, livePrice, liveAsOf]);

  const view = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const W = 320, H = 96, PAD = 4;
    const prices = pts.map((p) => p.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const span = hi - lo || hi * 0.001 || 1;
    const t0 = +new Date(pts[0].ts), t1 = +new Date(pts[pts.length - 1].ts);
    const x = (t: string) => PAD + ((+new Date(t) - t0) / (t1 - t0 || 1)) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
    const chg = ((pts[pts.length - 1].price / pts[0].price) - 1) * 100;
    const spanDays = (t1 - t0) / 86400000;
    const avgY = avgCost != null && avgCost >= lo && avgCost <= hi ? y(avgCost) : null;
    return { d, lo, hi, chg, W, H, spanDays, avgY };
  }, [pts, avgCost]);

  const up = (view?.chg ?? 0) >= 0;

  return (
    <section className="card" aria-label={`${symbol} price chart`} style={{ padding: "12px 14px", margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span className="sub">Price · {range}</span>
        {view && (
          <span className={`num ${up ? "gain" : "loss"}`} data-testid="range-change" style={{ fontSize: 13 }}>
            {signedPct(view.chg)}
          </span>
        )}
      </div>

      {pts === null && <div className="chart-skeleton" aria-busy="true" aria-label="Loading chart" />}
      {pts !== null && !view && (
        <p className="empty" style={{ padding: "22px 8px" }}>
          Not enough history yet — it builds as we track {symbol}.
        </p>
      )}
      {view && (
        <>
          <svg viewBox={`0 0 ${view.W} ${view.H}`} role="img" data-testid="price-chart"
               aria-label={`${symbol} ${range} price line`} style={{ width: "100%", height: "auto", display: "block" }}>
            <path d={view.d} fill="none" stroke={up ? "var(--as-gain)" : "var(--as-loss)"} strokeWidth={1.8}
                  strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {view.avgY !== null && (
              <line data-testid="avg-cost-line" x1={4} x2={view.W - 4} y1={view.avgY} y2={view.avgY}
                    stroke="var(--as-muted)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {view.avgY !== null && avgCost != null && (
            <div className="sub num" style={{ textAlign: "right", marginTop: 1 }}>avg {moneyExact(avgCost, currency)}</div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span className="sub num">L {moneyExact(view.lo, currency)}</span>
            <span className="sub num">H {moneyExact(view.hi, currency)}</span>
          </div>
          {range !== "1D" && view.spanDays < 0.7 * (rangeHours(range) / 24) && (
            <div className="sub" data-testid="partial-note" style={{ textAlign: "center", marginTop: 1 }}>
              showing {Math.max(1, Math.round(view.spanDays))}d of data
            </div>
          )}
        </>
      )}

      <div className="chips" role="tablist" aria-label="Chart range" style={{ paddingBottom: 0, marginTop: 8 }}>
        {RANGES.map((r) => (
          <button key={r.key} className="chip" role="tab" aria-selected={range === r.key}
                  aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.key}
          </button>
        ))}
      </div>
    </section>
  );
}
