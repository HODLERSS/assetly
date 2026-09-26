import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Api, HistoryPoint } from "../lib/api";
import { glClass, moneyExact, signedPct } from "../lib/format";
import { anchorRange, dailyCloses, fetchHours, hourlyCloses, hourlyRange, hourlyRecentHours, RANGE_KEYS, rangeStartYmd, seriesZone, ymdIn, type RangeKey } from "../lib/chartRange";
import { onForeground } from "../lib/native";
export type { RangeKey };

// Minimal price chart: pure SVG, no library. 1D is the latest session's prints; every longer range is one close
// per trading day, anchored on the last close on or before the range's start date (lib/chartRange.ts).

// 1D asks for four days so a market holiday or a weekend still has a last session to show. A coin always has a
// last 24 hours: four days of its minute prints were ~6 pages for a one-day line.
const ONE_D_FETCH_HOURS = 96, ONE_D_COIN_FETCH_HOURS = 26;
// The daily ranges need one close per day and nothing finer: the server folds every day up to now. A 48-hour raw
// window came along with every range, ~2,900 minute rows over 4 sequential pages for a coin's 5Y (r5 power-user).
const DAILY = 0;
// a coin's hourly week: ~10k minute prints, fetched four pages at a time
const HOURLY_PAGES = 14, HOURLY_WAVE = 4;
// The last series each range drew this session, per api: offline (or on a failed refresh) a position shows the
// chart it last had instead of an endless skeleton (r4 power-user M4).
const seriesMemo = new WeakMap<Api, Map<string, HistoryPoint[]>>();
const memoFor = (api: Api) => { let m = seriesMemo.get(api); if (!m) { m = new Map(); seriesMemo.set(api, m); } return m; };
// which memoized series are a coin's hourly week (not the daily first pass or its fallback)
const fineMemo = new WeakMap<Api, Set<string>>();
const fineFor = (api: Api) => { let m = fineMemo.get(api); if (!m) { m = new Set(); fineMemo.set(api, m); } return m; };
// A coin's hourly week, read once per session and shared: 1W draws it, and every longer range folds it into its
// L/H. It is fetched as soon as any coin chart opens, in parallel with that range, so a range's H/L appear once,
// already final. 1M read H $86,602.91 until 1W had been opened, then $87,333.28 (r9 designer m-5).
const WEEK_TTL_MS = 10 * 60_000;   // a week read this old is read again when a chart next asks
const weekCache = new WeakMap<Api, Map<string, { p: Promise<HistoryPoint[]>; at: number }>>();
function hourlyWeek(api: Api, symbol: string, zone: string): Promise<HistoryPoint[]> {
  let m = weekCache.get(api);
  if (!m) { m = new Map(); weekCache.set(api, m); }
  const hit = m.get(symbol);
  if (hit && Date.now() - hit.at < WEEK_TTL_MS) return hit.p;
  const now = new Date();
  const p = api.getHistory(symbol, fetchHours("1W", now, zone),
    { tz: zone, recentHours: hourlyRecentHours(now, zone), maxPages: HOURLY_PAGES, wave: HOURLY_WAVE });
  const entry = { p, at: Date.now() };
  m.set(symbol, entry);
  p.catch(() => { if (m!.get(symbol) === entry) m!.delete(symbol); });   // a failed read is tried again next time
  return p;
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

/** The zone a market's sessions are dated in: a KRX close is Wednesday in Seoul, even when it is still
 *  Tuesday evening in Pacific (the header said "Wed close" over a chart that said "Tue"; r3 power-user). */
export const chartZone = (symbol: string): string | undefined => (/\.(KS|KQ)$/i.test(symbol) ? "Asia/Seoul" : undefined);
/** The scrub readout's time: the hour on 1D, the day within a year (no year: it only added noise), the
 *  full date from 1Y out (r3 design m5). */
export function scrubLabel(ts: string, range: RangeKey, timeZone?: string, hourly = false): string {
  const d = new Date(ts);
  if (hourly) return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZone });
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
  const [raw, setRaw] = useState<HistoryPoint[] | null>(null);   // null = nothing to draw yet; full resolution
  const [failed, setFailed] = useState(false);                    // the last fetch failed
  const [attempt, setAttempt] = useState(0);                      // Retry, reconnect and foreground refetch
  const [scrub, setScrub] = useState<number | null>(null);        // index into the drawn points under the finger
  // what `raw` is on an hourly range: "hourly" = the hourly line landed; "daily" = the daily line is final (the
  // hourly read failed); null = the daily first pass, with the hourly line still coming
  const [res, setRes] = useState<"hourly" | "daily" | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const intraday = range === "1D";
  const zone = seriesZone(symbol, crypto);

  useEffect(() => { setScrub(null); }, [symbol, range]);
  // 1D refetches on every live tick (the session grows); the daily ranges only when the range, a Retry or a
  // reconnect asks, so a minute's tick is not a new query for five years of closes
  const tick = intraday ? liveAsOf : null;
  useEffect(() => {
    let live = true;
    // a range the reader has already left stops fetching (quick switches used to interleave their pages)
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const signal = ctl?.signal;
    const key = `${symbol}:${range}`;
    const memo = memoFor(api).get(key) ?? null;
    setRaw(memo);
    setRes(memo ? (fineFor(api).has(key) ? "hourly" : "daily") : null);
    setFailed(false);
    const keep = (p: HistoryPoint[], hourlyLine = false) => {
      if (!live) return;
      memoFor(api).set(key, p);
      if (hourlyLine) fineFor(api).add(key); else fineFor(api).delete(key);
      setRaw(p); setRes(hourlyLine ? "hourly" : "daily");
    };
    const fail = () => { if (live) setFailed(true); };   // keep what is drawn; with nothing drawn, say so with Retry
    const now = new Date();
    if (range === "1D") {
      api.getHistory(symbol, crypto ? ONE_D_COIN_FETCH_HOURS : ONE_D_FETCH_HOURS, undefined, { signal }).then(keep).catch(fail);
    } else if (!hourlyRange(range, crypto)) {
      api.getHistory(symbol, fetchHours(range, now, zone), { tz: zone, recentHours: DAILY }, { signal }).then(keep).catch(fail);
    } else {
      // progressive: the daily line (one small page) draws at once, the hourly week replaces it when it lands.
      // Both share the base close and the live price, so the figure never moves; only the line gains detail.
      let fine = false;
      const daily = api.getHistory(symbol, fetchHours(range, now, zone), { tz: zone, recentHours: DAILY }, { signal });
      const hourly = hourlyWeek(api, symbol, zone).then((p) => { fine = true; keep(p, true); });
      daily.then((p) => { if (live && !fine && !memo) setRaw(p); }).catch(() => {});
      hourly.catch(() => daily.then((p) => { if (!fine) keep(p); }).catch(fail));
    }
    return () => { live = false; ctl?.abort(); };
  }, [api, symbol, range, zone, crypto, attempt, tick]);
  // a coin's hourly week, in parallel with whatever range is open: longer ranges hold their L/H until it is in
  // (or has failed), so the value never changes after it appears
  const [week, setWeek] = useState<{ symbol: string; pts: HistoryPoint[] | null } | null>(null);
  useEffect(() => {
    if (!crypto) return;
    let live = true;
    hourlyWeek(api, symbol, zone)
      .then((p) => { if (live) setWeek({ symbol, pts: p }); })
      .catch(() => { if (live) setWeek({ symbol, pts: null }); });   // no hourly week: daily closes alone
    return () => { live = false; };
  }, [api, symbol, zone, crypto, attempt]);
  const weekPts = week && week.symbol === symbol ? week.pts : undefined;   // undefined: still coming

  // a chart that failed comes back by itself when the connection or the app does
  useEffect(() => {
    if (!failed) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    const off = onForeground(again);
    return () => { window.removeEventListener("online", again); off(); };
  }, [failed]);

  const series = useMemo(() => {
    if (!raw) return null;
    if (range === "1D") { const pts = latestSession(withLiveTick(raw, livePrice, liveAsOf)); return { pts, partial: false, closes: pts }; }
    const start = rangeStartYmd(range, new Date(), zone);
    const daily = anchorRange(dailyCloses(raw, zone, livePrice, liveAsOf), start, zone);
    if (!hourlyRange(range, crypto)) {
      if (!crypto) return { ...daily, closes: daily.pts };
      // A coin's longer range folds in the hourly week, on the same basis 1W draws it (the last print of each
      // hour), so its L/H are never narrower than 1W's (r8 designer). Until the week is in, L/H are the drawn
      // daily closes, shown at once (they sat blank ~3s on a cold open; r10 designer). The week can only ADD
      // points to that set, so on arrival H can only rise and L only fall: they widen, never shrink.
      const extra = weekPts ? hourlyCloses(weekPts, livePrice, liveAsOf).filter((pt) => ymdIn(pt.ts, zone) > start) : [];
      return { ...daily, closes: extra.length ? [...daily.pts, ...extra] : daily.pts };
    }
    // A coin's week draws by the hour, and its L and H come from that same hourly line (r7 design n-5). Before the
    // hourly line lands they are the daily first pass's, shown at once. Every daily close is the last print of its
    // day, so also the last print of its hour: the daily set is inside the hourly one, and the H/L only widen
    // when the hourly line replaces it (never the r6 m-2 jump inward).
    if (res !== "hourly") return { ...anchorRange(hourlyCloses(raw, livePrice, liveAsOf), start, zone), closes: daily.pts };
    const hourly = anchorRange(hourlyCloses(raw, livePrice, liveAsOf), start, zone);
    return { ...hourly, closes: hourly.pts };
  }, [raw, range, zone, crypto, livePrice, liveAsOf, res, weekPts]);
  const pts = series?.pts ?? null;
  const closes = series?.closes ?? null;

  const view = useMemo(() => {
    if (!pts || pts.length < 2) return null;
    const W = 320, H = 96, PAD = 4;
    // high and low from every stored point: the drawn line is thinned, and a thinned 2Y used to report a
    // lower high than the 1Y (r2 power-user audit)
    const prices = pts.map((p) => p.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);   // the drawn line's extent: the y scale
    const hl = closes?.length ? closes.map((p) => p.price) : prices;
    const low = Math.min(...hl), high = Math.max(...hl);       // the L and H shown: closes on every daily range
    const drawn = thin(pts);
    const span = hi - lo || hi * 0.001 || 1;
    const t0 = +new Date(drawn[0].ts), t1 = +new Date(drawn[drawn.length - 1].ts);
    const x = (t: string) => PAD + ((+new Date(t) - t0) / (t1 - t0 || 1)) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
    const d = drawn.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
    const chg = ((pts[pts.length - 1].price / pts[0].price) - 1) * 100;
    const spanDays = (t1 - t0) / 86400000;
    const avgY = avgCost != null && avgCost >= lo && avgCost <= hi ? y(avgCost) : null;
    return { d, lo, hi, low, high, chg, W, H, spanDays, avgY, drawn, x, y };
  }, [pts, closes, avgCost]);

  // 1D: the page's day move (vs the previous close), not first-print-to-last-print of the session
  const headPct = intraday && dayPct !== null ? dayPct : view?.chg ?? 0;
  // 1D on a holiday or a weekend: the line is the last session, and the header says which day it was
  const last = pts?.length ? new Date(pts[pts.length - 1].ts) : null;
  const tz = chartZone(symbol);
  const notToday = intraday && last !== null && dayIn(last, tz) !== dayIn(new Date(), tz);
  // partial history: the stored closes do not reach back to the range's base (a symbol tracked for a month has
  // no 1Y base). A full 5Y of sparse older closes is complete; the day-count guess called it "1825d of data".
  const partial = !intraday && view !== null && !!series?.partial;

  const onScrub = (e: PointerEvent<SVGSVGElement>) => {
    if (!view || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / (box.width || 1)) * view.W;
    let best = 0, bestD = Infinity;
    view.drawn.forEach((p, i) => { const dd = Math.abs(view.x(p.ts) - px); if (dd < bestD) { bestD = dd; best = i; } });
    setScrub(best);
  };
  const sp = view && scrub !== null ? view.drawn[scrub] : null;
  // A time of day reads in the reader's own zone (as 1D does). A coin's week is bucketed by the UTC day, but its
  // hours read in UTC with no zone said "Fri 9 PM" at 2:43 PM Pacific (r6 power-user m1). Whole days keep the
  // zone their sessions are dated in.
  const hourly = hourlyRange(range, crypto);
  const labelZone = intraday || hourly ? tz : zone;

  return (
    <section className="card" aria-label={`${symbol} price chart`} style={{ padding: "12px 14px", margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, minHeight: 18 }}>
        {sp ? (
          // the scrub readout replaces the header while a finger is on the line
          <span className="sub num" data-testid="scrub-readout" aria-live="polite">
            <strong className="num" style={{ color: "var(--as-ink)" }}>{moneyExact(sp.price, currency)}</strong> · {scrubLabel(sp.ts, range, labelZone, hourly)}
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

      {pts === null && failed && (
        <p className="empty" role="alert" style={{ padding: "22px 8px" }} data-testid="chart-error">
          Couldn't load the chart.{" "}
          <button className="chip" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {pts === null && !failed && (
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
            {/* L/H show at once and only widen as the hourly week lands (r10 designer) */}
            <span className="sub num" data-testid="range-low">L {moneyExact(view.low, currency)}</span>
            <span className="sub num" data-testid="range-high">H {moneyExact(view.high, currency)}</span>
          </div>
          {partial && (
            <div className="sub" data-testid="partial-note" style={{ textAlign: "center", marginTop: 1 }}>
              showing {Math.max(1, Math.round(view.spanDays))}d of data
            </div>
          )}
        </>
      )}

      <div className="chips" role="tablist" aria-label="Chart range" style={{ paddingBottom: 0, marginTop: 8 }}>
        {RANGE_KEYS.map((k) => (
          <button key={k} className="chip" role="tab" aria-selected={range === k}
                  aria-pressed={range === k} onClick={() => setRange(k)}>
            {k}
          </button>
        ))}
      </div>
    </section>
  );
}
