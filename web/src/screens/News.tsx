import { useEffect, useState } from "react";
import type { Api, Insight, NewsItem, PortfolioRow } from "../lib/api";
import { labelParts, timeAgo } from "../lib/format";
import { InsightsCard } from "../components/InsightsCard";

// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows, dispKr = "KRW", onRefreshInsights, insightsRefreshing = false, freshInsights = null, onInsightsSeen }: {
  api: Api; rows: PortfolioRow[]; dispKr?: "USD" | "KRW";
  onRefreshInsights?: () => void; insightsRefreshing?: boolean; freshInsights?: Insight | null; onInsightsSeen?: (generatedAt: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "pulling" | "error">("loading");
  const [pulled] = useState(() => new Set<string>());   // one on-demand pull per scope per visit
  const [cache] = useState(() => new Map<string, NewsItem[]>());   // instant chip flips
  const [top5, setTop5] = useState<Insight | null>(null);          // Assetly Intelligence, portfolio-wide
  // cash and debt have no news; one chip per symbol even when held in several accounts
  const newsRows = rows.filter((r, i) => r.kind !== "cash" && r.kind !== "debt"
    && rows.findIndex((x) => x.symbol === r.symbol) === i);

  useEffect(() => {
    let live = true;
    if (rows.length > 0) api.getPortfolioInsights().then((v) => { if (live) { setTop5(v); if (v) onInsightsSeen?.(v.generated_at); } }).catch(() => {});
    return () => { live = false; };
  }, [api, rows.length]);
  // an app-level refresh that finished while this screen was away (or open) lands here
  useEffect(() => {
    if (freshInsights && freshInsights.generated_at !== top5?.generated_at) { setTop5(freshInsights); onInsightsSeen?.(freshInsights.generated_at); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshInsights]);

  useEffect(() => {
    let live = true;
    const key = filter ?? "__all__";
    if (cache.has(key)) { setItems(cache.get(key)!); setState("ok"); }   // show instantly, refresh behind
    else setState("loading");
    const held = newsRows.map((r) => r.symbol);
    const scope = filter ?? held;
    const load = () => api.getNews(scope).then((n) => {
      const seen = new Set<string>();
      return n.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
    });
    load()
      .then(async (n) => {
        if (!live) return;
        const key = filter ?? "__all__";
        if (n.length === 0 && rows.length > 0 && !pulled.has(key)) {
          pulled.add(key);
          setState("pulling");                          // pull the first stories right now
          await api.refreshNews(filter ? [filter] : held.slice(0, 5));
          n = await load();
          if (!live) return;
        }
        cache.set(key, n);
        setItems(n);
        setState("ok");
      })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [api, filter, rows]);

  return (
    <>
      <h2 className="h1">News</h2>
      <div className="chips" role="group" aria-label="Filter news by holding">
        <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>All holdings</button>
        {newsRows.map((r) => (
          <button key={r.symbol} className="chip" aria-pressed={filter === r.symbol} onClick={() => setFilter(r.symbol)}>
            {labelParts(r, dispKr === "KRW").main}
          </button>
        ))}
      </div>
      {filter && <InsightsCard api={api} symbol={filter} />}
      {!filter && (top5?.news5?.length ?? 0) > 0 && (
        <section className="card insights" data-testid="news-top5-card" aria-label="Top portfolio signals">
          <div className="insights-head">
            <span className="insights-brand">Assetly Intelligence</span>
            <button className="insights-toggle" onClick={() => onRefreshInsights?.()} disabled={insightsRefreshing} aria-label="Refresh Assetly Intelligence">
              {insightsRefreshing ? <>Refreshing <span className="spin" aria-hidden="true">↻</span></> : <>{timeAgo(top5!.generated_at)} · ↻</>}
            </button>
          </div>
          <ul className="insights-list">
            {top5!.news5!.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <p className="insights-foot">Not financial advice</p>
        </section>
      )}
      {state === "error" && <div className="error-note" role="alert">News missed the handoff — pull to retry.</div>}
      {state === "pulling" && (
        <p className="empty" aria-busy="true">Pulling the latest stories{filter ? ` for ${filter}` : ""}…</p>
      )}
      {state === "ok" && items.length === 0 && (
        <p className="empty">{rows.length === 0 ? "Add a position and its news follows." : `Nothing fresh${filter ? ` for ${filter}` : ""} right now — we'll keep watching.`}</p>
      )}
      <div className="card">
        {items.map((n) => (
          <a key={n.id} className="row" href={n.url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none", display: "flex" }}>
            <span>
              <span style={{ fontWeight: 500 }}>{n.title}</span><br />
              <span className="sub">{(() => { const rr = rows.find((x) => x.symbol === n.symbol); return rr ? labelParts(rr, dispKr === "KRW").main : n.symbol; })()} · {n.source} · {timeAgo(n.published_at)}</span>
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
