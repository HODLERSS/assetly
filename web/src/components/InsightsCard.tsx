import { useEffect, useState } from "react";

const insightCache = new Map<string, Insight | null>();
import type { Api, Insight } from "../lib/api";
import { timeAgo } from "../lib/format";

// Assetly Intelligence — visually distinct from raw news: accent bar, labeled header,
// no links. 3-5 opinionated bullets (7-day focus) + one-liners per horizon.
const HORIZONS: [string, string][] = [["d7", "7D"], ["d30", "30D"], ["d60", "60D"], ["y1", "1Y"], ["y2", "2Y"]];

export function InsightsCard({ api, symbol }: { api: Api; symbol: string }) {
  const [ins, setIns] = useState<Insight | null | undefined>(undefined);   // undefined = loading

  useEffect(() => {
    let live = true;
    if (insightCache.has(symbol)) setIns(insightCache.get(symbol));   // instant on revisit
    else setIns(undefined);
    api.getInsights(symbol).then((v) => { insightCache.set(symbol, v); if (live) setIns(v); })
      .catch(() => { if (live) setIns(null); });
    return () => { live = false; };
  }, [api, symbol]);

  if (ins === undefined) return null;                     // quiet while loading
  if (ins === null) {
    return (
      <p className="status-line" data-testid="insights-pending" style={{ margin: "4px 2px 8px" }}>
        Intelligence for {symbol} lands on the next hourly lap.
      </p>
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
