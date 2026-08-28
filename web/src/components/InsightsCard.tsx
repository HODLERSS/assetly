import { useEffect, useState } from "react";

const insightCache = new Map<string, Insight | null>();
import type { Api, Insight } from "../lib/api";
import { timeAgo } from "../lib/format";

// Assetly Intelligence — visually distinct from raw news: accent bar, labeled header,
// no links. 3-5 opinionated bullets (7-day focus) + one-liners per horizon.
const HORIZONS: [string, string][] = [["d7", "7D"], ["d30", "30D"], ["d60", "60D"], ["y1", "1Y"], ["y2", "2Y"]];

const PHASES = [
  "Reading {sym}'s last earnings call and this month's news…",
  "Scanning SEC filings and price history…",
  "Writing the first take…",
];

export function InsightsCard({ api, symbol, pollMs = 2000 }: { api: Api; symbol: string; pollMs?: number }) {
  const [ins, setIns] = useState<Insight | null | undefined>(undefined);   // undefined = loading
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (ins !== null) return;
    const t = setInterval(() => setPhase((x) => (x + 1) % PHASES.length), 2500);
    return () => clearInterval(t);
  }, [ins]);

  useEffect(() => {
    let live = true, tries = 0;
    if (insightCache.has(symbol)) setIns(insightCache.get(symbol));   // instant on revisit
    else setIns(undefined);
    const check = () => api.getInsights(symbol).then((v) => {
      if (!live) return;
      insightCache.set(symbol, v);
      setIns(v);
      // warmup writes the first card within ~15s of a symbol being added — keep looking
      if (v === null && tries++ < 14) setTimeout(check, pollMs);
    }).catch(() => { if (live) setIns(null); });
    check();
    return () => { live = false; };
  }, [api, symbol, pollMs]);

  if (ins === undefined) return null;                     // quiet while loading
  if (ins === null) {
    return (
      <section className="card insights" data-testid="insights-pending" aria-busy="true" aria-label={`Preparing insights for ${symbol}`}>
        <div className="insights-head">
          <span className="insights-brand">Assetly Intelligence</span>
        </div>
        <div className="skel-line" style={{ width: "92%" }} />
        <div className="skel-line" style={{ width: "76%" }} />
        <div className="skel-line" style={{ width: "58%" }} />
        <p className="sub" style={{ margin: "10px 0 0" }}>{PHASES[phase].replace("{sym}", symbol)}</p>
      </section>
    );
  }

  return (
    <section className="card insights" data-testid="insights-card" aria-label={`AI insights for ${symbol}`}>
      <div className="insights-head">
        <span className="insights-brand">Assetly Intelligence</span>
        <span className="sub num">{timeAgo(ins.generated_at)}</span>
      </div>
      <ul className="insights-list">
        {ins.bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      {ins.windows && (ins.windows.trend || HORIZONS.some(([k]) => ins.windows![k])) && (
        <p className="sub" data-testid="insights-trend" style={{ marginTop: 8, borderTop: "1px solid var(--as-rule)", paddingTop: 8 }}>
          {ins.windows.trend ?? [ins.windows.d7, ins.windows.y1].filter(Boolean).join(" ")}
        </p>
      )}
      <p className="insights-foot">Not financial advice</p>
    </section>
  );
}
