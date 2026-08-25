import { useEffect, useMemo, useState } from "react";
import type { Api, HistoryPoint } from "../lib/api";
import { moneyExact, signedPct } from "../lib/format";

// Minimal price chart: pure SVG, no library. Ranges map to hours of history;
// 1D/1W ride the 1-min cron + 15m backfill, 1M/3M ride daily closes.
const RANGES = [
  { key: "1D", hours: 24 },
  { key: "1W", hours: 24 * 7 },
  { key: "1M", hours: 24 * 30 },
  { key: "3M", hours: 24 * 92 },
  { key: "1Y", hours: 24 * 366 },
  { key: "5Y", hours: 24 * 366 * 5 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** Downsample to at most n points, always keeping the last. */
function thin(pts: HistoryPoint[], n = 180): HistoryPoint[] {
  if (pts.length <= n) return pts;
  const step = (pts.length - 1) / (n - 1);
  const out: HistoryPoint[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

export function PriceChart({ api, symbol, currency }: {
  api: Api; symbol: string; currency: "USD" | "KRW";
}) {
  const [range, setRange] = useState<RangeKey>("1D");
  const [pts, setPts] = useState<HistoryPoint[] | null>(null);   // null = loading

  useEffect(() => {
    let live = true;
    setPts(null);
    const hours = RANGES.find((r) => r.key === range)!.hours;
    api.getHistory(symbol, hours)
      .then((p) => { if (live) setPts(thin(p)); })
      .catch(() => { if (live) setPts([]); });
    return () => { live = false; };
  }, [api, symbol, range]);

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
    return { d, lo, hi, chg, W, H };
  }, [pts]);

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
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span className="sub num">L {moneyExact(view.lo, currency)}</span>
            <span className="sub num">H {moneyExact(view.hi, currency)}</span>
          </div>
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
