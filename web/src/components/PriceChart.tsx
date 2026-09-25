import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Api, HistoryPoint } from "../lib/api";
import { glClass, moneyExact, signedPct } from "../lib/format";

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
// 1D asks for four days so a market holiday or a weekend still has a last session to show
const ONE_D_FETCH_HOURS = 96;

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

/** The latest trading session of an intraday series. The 1D line used to run from yesterday's last print
 *  straight across the night into today's open (r1 + r2 power-user audits). A session ends at a gap in
 *  the prints, or at a long flat stretch (a quote repeated overnight), and never reaches back past 24h,
 *  which is also all a 24/7 coin shows. */
export function latestSession(pts: HistoryPoint[], gapMs = 90 * 60_000, windowMs = 24 * 3600_000): HistoryPoint[] {
  const n = pts.length;
  if (n < 2) return pts;
  const t = pts.map((p) => +new Date(p.ts));
  let start = 0, runEnd = n - 1;   // runEnd: last index of the equal-price run ending at i
  for (let i = n - 1; i > 0; i--) {
    if (t[n - 1] - t[i - 1] > windowMs || t[i] - t[i - 1] > gapMs) { start = i; break; }
    if (pts[i - 1].price !== pts[i].price) { runEnd = i - 1; continue; }
    // a flat stretch longer than a gap, with trading after it: the session starts at its last print
    if (runEnd < n - 1 && t[runEnd] - t[i - 1] > gapMs) { start = runEnd; break; }
  }
  return pts.slice(start);
}

/** Downsample to at most n points, always keeping the last. */
function thin(pts: HistoryPoint[], n = 180): HistoryPoint[] {
  if (pts.length <= n) return pts;
  const step = (pts.length - 1) / (n - 1);
  const out: HistoryPoint[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

const dayKey = (ts: string) => ts.slice(0, 10);
/** The zone a market's sessions are dated in: a KRX close is Wednesday in Seoul, even when it is still
 *  Tuesday evening in Pacific (the header said "Wed close" over a chart that said "Tue"; r3 power-user). */
export const chartZone = (symbol: string): string | undefined => (/\.(KS|KQ)$/i.test(symbol) ? "Asia/Seoul" : undefined);
/** The scrub readout's time: the hour on 1D, the day within a year (no year: it only added noise), the
 *  full date from 1Y out (r3 design m5). */
export function scrubLabel(ts: string, range: RangeKey, timeZone?: string): string {
  const d = new Date(ts);
  if (range === "1D") return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone });
  if (range === "1Y" || range === "2Y" || range === "5Y") return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}
const dayIn = (d: Date, timeZone?: string) => d.toLocaleDateString("en-CA", { timeZone });

export function PriceChart({ api, symbol, currency, livePrice, liveAsOf, avgCost, dayPct = null, crypto = false }: {
  api: Api; symbol: string; currency: string; livePrice: number | null; liveAsOf: string | null;
  avgCost?: number | null;
  /** The page's own "today" move. 1D shows exactly this, so the chart and the header never disagree. */
  dayPct?: number | null;
  /** trades every day: a full week is 7 daily points, not 5 */
  crypto?: boolean;
}) {
  const [range, setRange] = useState<RangeKey>("1M");
  const [pts, setPts] = useState<HistoryPoint[] | null>(null);   // null = loading; full resolution
  const [scrub, setScrub] = useState<number | null>(null);        // index into the drawn points under the finger
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let live = true;
    setPts(null); setScrub(null);
    const intraday = range === "1D";
    api.getHistory(symbol, intraday ? ONE_D_FETCH_HOURS : rangeHours(range))
      .then((p) => { if (live) setPts(intraday ? latestSession(withLiveTick(p, livePrice, liveAsOf)) : dailyCloses(p, livePrice, liveAsOf)); })
      .catch(() => { if (live) setPts([]); });
    return () => { live = false; };
  }, [api, symbol, range, livePrice, liveAsOf]);

  const view = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const W = 320, H = 96, PAD = 4;
    // high and low from every stored point: the drawn line is thinned, and a thinned 2Y used to report a
    // lower high than the 1Y (r2 power-user audit)
    const prices = pts.map((p) => p.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const drawn = thin(pts);
    const span = hi - lo || hi * 0.001 || 1;
    const t0 = +new Date(drawn[0].ts), t1 = +new Date(drawn[drawn.length - 1].ts);
    const x = (t: string) => PAD + ((+new Date(t) - t0) / (t1 - t0 || 1)) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
    const d = drawn.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
    const chg = ((pts[pts.length - 1].price / pts[0].price) - 1) * 100;
    const spanDays = (t1 - t0) / 86400000;
    const days = new Set(pts.map((p) => dayKey(p.ts))).size;
    const avgY = avgCost != null && avgCost >= lo && avgCost <= hi ? y(avgCost) : null;
    return { d, lo, hi, chg, W, H, spanDays, days, avgY, drawn, x, y };
  }, [pts, avgCost]);

  const intraday = range === "1D";
  // 1D: the page's day move (vs the previous close), not first-print-to-last-print of the session
  const headPct = intraday && dayPct !== null ? dayPct : view?.chg ?? 0;
  // 1D on a holiday or a weekend: the line is the last session, and the header says which day it was
  const last = pts?.length ? new Date(pts[pts.length - 1].ts) : null;
  const tz = chartZone(symbol);
  const notToday = intraday && last !== null && dayIn(last, tz) !== dayIn(new Date(), tz);
  // partial history: distinct trading days against what the range holds. Five sessions is a full stock
  // week ("showing 5d of data" on a complete week was wrong); a coin trades all seven days.
  const expected = (rangeHours(range) / 24) * ((crypto ? 7 : 5) / 7);
  const partial = !intraday && view !== null && view.days < 0.7 * expected;

  const onScrub = (e: PointerEvent<SVGSVGElement>) => {
    if (!view || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / (box.width || 1)) * view.W;
    let best = 0, bestD = Infinity;
    view.drawn.forEach((p, i) => { const dd = Math.abs(view.x(p.ts) - px); if (dd < bestD) { bestD = dd; best = i; } });
    setScrub(best);
  };
  const sp = view && scrub !== null ? view.drawn[scrub] : null;

  return (
    <section className="card" aria-label={`${symbol} price chart`} style={{ padding: "12px 14px", margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, minHeight: 18 }}>
        {sp ? (
          // the scrub readout replaces the header while a finger is on the line
          <span className="sub num" data-testid="scrub-readout" aria-live="polite">
            <strong className="num" style={{ color: "var(--as-ink)" }}>{moneyExact(sp.price, currency)}</strong> · {scrubLabel(sp.ts, range, tz)}
          </span>
        ) : (
          <span className="sub">Price · {notToday && last ? `last session, ${last.toLocaleDateString("en-US", { weekday: "short", timeZone: tz })}` : range}</span>
        )}
        {view && !sp && (
          <span className={`num ${glClass(headPct)}`} data-testid="range-change" style={{ fontSize: 13 }}>
            {signedPct(headPct)}
          </span>
        )}
      </div>

      {pts === null && (
        // same footprint as the loaded chart (the 320x96 viewBox scaled to the card, plus the L/H line),
        // so the lots and the Remove button below do not jump when the history lands
        <div aria-busy="true" aria-label="Loading chart">
          <div className="chart-skeleton" style={{ height: "auto", aspectRatio: "320 / 96" }} />
          <div style={{ height: 22 }} />
        </div>
      )}
      {pts !== null && !view && (
        <p className="empty" style={{ padding: "22px 8px" }}>
          {intraday ? "Market closed today. The 1W chart shows the latest sessions." : `Not enough history yet. It builds as we track ${symbol}.`}
        </p>
      )}
      {view && (
        <>
          <svg ref={svgRef} viewBox={`0 0 ${view.W} ${view.H}`} role="img" data-testid="price-chart"
               aria-label={`${symbol} ${range} price line`} style={{ width: "100%", height: "auto", display: "block", touchAction: "pan-y" }}
               onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); onScrub(e); }}
               onPointerMove={(e) => { if (scrub !== null || e.pointerType === "mouse") onScrub(e); }}
               onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} onPointerLeave={() => setScrub(null)}>
            <path d={view.d} fill="none" stroke={headPct >= 0 ? "var(--as-gain)" : "var(--as-loss)"} strokeWidth={1.8}
                  strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {view.avgY !== null && (
              <line data-testid="avg-cost-line" x1={4} x2={view.W - 4} y1={view.avgY} y2={view.avgY}
                    stroke="var(--as-muted)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            )}
            {sp && (<>
              <line x1={view.x(sp.ts)} x2={view.x(sp.ts)} y1={0} y2={view.H} stroke="var(--as-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <circle cx={view.x(sp.ts)} cy={view.y(sp.price)} r={3} fill="var(--as-ink)" />
            </>)}
          </svg>
          {view.avgY !== null && avgCost != null && (
            <div className="sub num" style={{ textAlign: "right", marginTop: 1 }}>avg {moneyExact(avgCost, currency)}</div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span className="sub num" data-testid="range-low">L {moneyExact(view.lo, currency)}</span>
            <span className="sub num" data-testid="range-high">H {moneyExact(view.hi, currency)}</span>
          </div>
          {partial && (
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
