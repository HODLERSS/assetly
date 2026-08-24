import { useEffect, useState } from "react";
import type { Api, NewsItem, PortfolioRow } from "../lib/api";
import { timeAgo } from "../lib/format";

// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows }: { api: Api; rows: PortfolioRow[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    api.getNews(filter ?? undefined)
      .then((n) => { if (live) { setItems(n); setState("ok"); } })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [api, filter]);

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
      {state === "error" && <div className="error-note" role="alert">News missed the handoff — pull to retry.</div>}
      {state === "ok" && items.length === 0 && (
        <p className="empty">No stories yet{filter ? ` for ${filter}` : ""}. The news lap runs every 15 minutes.</p>
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
