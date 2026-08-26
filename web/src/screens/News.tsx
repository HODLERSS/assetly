import { useEffect, useState } from "react";
import type { Api, NewsItem, PortfolioRow } from "../lib/api";
import { timeAgo } from "../lib/format";
import { InsightsCard } from "../components/InsightsCard";

// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows }: { api: Api; rows: PortfolioRow[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "pulling" | "error">("loading");
  const [pulled] = useState(() => new Set<string>());   // one on-demand pull per scope per visit
  const [cache] = useState(() => new Map<string, NewsItem[]>());   // instant chip flips

  useEffect(() => {
    let live = true;
    const key = filter ?? "__all__";
    if (cache.has(key)) { setItems(cache.get(key)!); setState("ok"); }   // show instantly, refresh behind
    else setState("loading");
    const held = rows.map((r) => r.symbol);
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
        {rows.map((r) => (
          <button key={r.symbol} className="chip" aria-pressed={filter === r.symbol} onClick={() => setFilter(r.symbol)}>
            {r.symbol}
          </button>
        ))}
      </div>
      {filter && <InsightsCard api={api} symbol={filter} />}
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
              <span className="sub">{n.symbol} · {n.source} · {timeAgo(n.published_at)}</span>
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
