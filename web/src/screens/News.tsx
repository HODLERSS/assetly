import { useEffect, useRef, useState } from "react";
import type { Api, Insight, NewsItem, PortfolioRow } from "../lib/api";
import { labelParts, timeAgo } from "../lib/format";
import { decodeEntities, dedupeNews } from "../lib/news";
import { InsightsCard } from "../components/InsightsCard";
import { heldOnly, readRemovals } from "../lib/heldIntel";
import { Icon } from "../components/Icon";
import { PullToRefresh } from "../components/PullToRefresh";
// headlines open in the in-app browser sheet (like Privacy and Terms), not by leaving for Safari
import { openExternal } from "../lib/native";

const NEWS_TIMEOUT_MS = 12_000;

// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows, dispKr = "KRW", uid = null, intelPending = false, onRefreshInsights, insightsRefreshing = false, freshInsights = null, onInsightsSeen, onRefreshSymbol, symbolRefreshing = {}, symbolFresh = {} }: {
  api: Api; rows: PortfolioRow[]; dispKr?: "USD" | "KRW";
  /** whose removals to screen the portfolio card against (see lib/heldIntel) */
  uid?: string | null;
  /** a book-changed run is being written: the card says it is catching up */
  intelPending?: boolean;
  onRefreshInsights?: () => void; insightsRefreshing?: boolean; freshInsights?: Insight | null; onInsightsSeen?: (generatedAt: string) => void;
  onRefreshSymbol?: (symbol: string) => void; symbolRefreshing?: Record<string, boolean>; symbolFresh?: Record<string, Insight>;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "pulling" | "error">("loading");
  const [pulled] = useState(() => new Set<string>());   // one on-demand pull per scope per visit
  const [cache] = useState(() => new Map<string, NewsItem[]>());   // instant chip flips
  const [top5, setTop5] = useState<Insight | null>(null);          // Assetly Intelligence, portfolio-wide
  const [retryN, setRetryN] = useState(0);                         // Retry after a failed load, or a pull to refresh
  // pull to refresh bumps the same counter; its promise settles once the reload has landed
  const settled = useRef<(() => void) | null>(null);
  const refresh = () => new Promise<void>((resolve) => { settled.current = resolve; setRetryN((n) => n + 1); });
  // cash and debt have no news; one chip per symbol even when held in several accounts
  const newsRows = rows.filter((r, i) => r.kind !== "cash" && r.kind !== "debt"
    && rows.findIndex((x) => x.symbol === r.symbol) === i);

  useEffect(() => {
    let live = true;
    if (rows.length > 0) api.getPortfolioInsights().then((v) => {
      if (!live) return;
      const best = freshInsights && (!v || freshInsights.generated_at >= v.generated_at) ? freshInsights : v;
      setTop5(best); if (best) onInsightsSeen?.(best.generated_at);
    }).catch(() => {});
    return () => { live = false; };
  }, [api, rows.length, retryN]);
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
    // one copy per story (URL or headline), entities decoded. Offline, a request can hang instead of failing,
    // and a pull then spun and settled on nothing (r2 power-user audit): past the limit it is an error with Retry.
    const load = () => Promise.race([api.getNews(scope),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), NEWS_TIMEOUT_MS))]).then(dedupeNews);
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
      .catch(() => { if (live) setState("error"); })
      .finally(() => { settled.current?.(); settled.current = null; });
    return () => { live = false; };
  }, [api, filter, rows, retryN]);

  // only what is still held: bullets about a removed holding wait for the rerun instead of leading the card
  const intel = top5 ? heldOnly(top5, rows, readRemovals(uid)) : null;
  const catchingUp = !!intel && (intel.hidden > 0 || (intelPending && top5 !== null));

  return (
    <PullToRefresh onRefresh={refresh}>
      <h2 className="h1">News</h2>
      <div className="chips" role="group" aria-label="Filter news by holding">
        <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>All holdings</button>
        {newsRows.map((r) => (
          <button key={r.symbol} className="chip" aria-pressed={filter === r.symbol} onClick={() => setFilter(r.symbol)}>
            {labelParts(r, dispKr === "KRW").main}
          </button>
        ))}
      </div>
      {filter && <InsightsCard api={api} symbol={filter} onRefresh={onRefreshSymbol ? () => onRefreshSymbol(filter) : undefined} refreshing={!!symbolRefreshing[filter]} fresh={symbolFresh[filter] ?? null} />}
      {!filter && intel && (intel.bullets.length > 0 || intel.news5.length > 0 || catchingUp) && (
        <section className="card insights" data-testid="news-top5-card" aria-label="Portfolio intelligence">
          <div className="insights-head">
            <span className="insights-brand">Assetly Intelligence</span>
            <button className="insights-toggle" onClick={() => onRefreshInsights?.()} disabled={insightsRefreshing} aria-label="Refresh Assetly Intelligence">
              {insightsRefreshing ? <>Refreshing <Icon name="refresh" size={12} className="spin" /></> : <>{timeAgo(top5!.generated_at)} · <Icon name="refresh" size={12} /></>}
            </button>
          </div>
          {catchingUp && (
            <p className="sub" data-testid="intel-updating" style={{ margin: "0 2px 6px", display: "flex", alignItems: "center", gap: 6 }}>
              <span className="step-mark active" aria-hidden="true" />Updating for your latest changes…
            </p>
          )}
          {/* the portfolio read that used to live on the Holdings tab */}
          {intel.bullets.length > 0 && (
            <ul className="insights-list" data-testid="portfolio-insights-card">
              {intel.bullets.map((b, i) => <li key={i}>{decodeEntities(b)}</li>)}
            </ul>
          )}
          {intel.news5.length > 0 && (
            <>
              {intel.bullets.length > 0 && <p className="sub" style={{ margin: "10px 2px 4px", borderTop: "1px solid var(--as-rule)", paddingTop: 8 }}>This week across your holdings</p>}
              <ul className="insights-list" data-testid="news-top5-list">
                {intel.news5.map((b, i) => <li key={i}>{decodeEntities(b)}</li>)}
              </ul>
            </>
          )}
          <p className="insights-foot">Not financial advice</p>
        </section>
      )}
      {state === "error" && (
        <div className="error-note" role="alert">
          Couldn't load news. <button className="chip" onClick={() => setRetryN((n) => n + 1)} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}
      {state === "pulling" && (
        <p className="empty" aria-busy="true">Pulling the latest stories{filter ? ` for ${filter}` : ""}…</p>
      )}
      {state === "ok" && items.length === 0 && (
        <p className="empty">{rows.length === 0 ? "Add a position and its news follows." : `Nothing fresh${filter ? ` for ${filter}` : ""} right now — we'll keep watching.`}</p>
      )}
      <div className="card">
        {items.map((n) => (
          <a key={n.id} className="row" href={n.url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none", display: "flex" }}
             onClick={(e) => { e.preventDefault(); void openExternal(n.url); }}>
            <span>
              <span style={{ fontWeight: 500 }}>{n.title}</span><br />
              <span className="sub">{(() => { const rr = rows.find((x) => x.symbol === n.symbol); return rr ? labelParts(rr, dispKr === "KRW").main : n.symbol; })()} · {n.source} · {timeAgo(n.published_at)}</span>
            </span>
          </a>
        ))}
      </div>
    </PullToRefresh>
  );
}
