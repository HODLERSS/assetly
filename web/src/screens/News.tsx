import { useEffect, useRef, useState } from "react";
import type { Api, Insight, NewsItem, PortfolioRow } from "../lib/api";
import { labelParts, marketClock, timeAgo } from "../lib/format";
import { decodeEntities, dedupeNews } from "../lib/news";
import { InsightsCard } from "../components/InsightsCard";
import { heldOnly, readRemovals } from "../lib/heldIntel";
import { Icon } from "../components/Icon";
import { PullToRefresh } from "../components/PullToRefresh";
// headlines open in the in-app browser sheet (like Privacy and Terms), not by leaving for Safari
import { openExternal } from "../lib/native";

const NEWS_TIMEOUT_MS = 12_000;
// The feed was one ungrouped wall about 5,600pt tall (r1-r3 design audits): a page at a time, by day.
export const NEWS_PAGE = 40;
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const clock = (ms: number) => marketClock(ms, "US");   // ET with its label, like every app time (r9 designer m-3)

// The last list each scope loaded, kept past the screen: News offline used to show only "You're offline." once
// the reader had been to Home and back, because the list lived in the screen's own state (r5 designer m-h).
// "All holdings" is also kept on the device per user (cleared at sign-out, lib/localState), for a cold start
// offline; the per-holding filters are kept for the session.
// `held`: the holdings the "All holdings" list was read for (sorted symbols). A list read for another set, or
// for no set at all, is never shown for this one (r11 designer: a read made before the holdings were known came
// back empty, was kept, and showed "Nothing fresh right now" once they arrived).
type Kept = { items: NewsItem[]; at: number; held?: string };
// per api and per user: the next account signed in on this device never sees the last one's list
const newsMemo = new WeakMap<Api, { uid: string | null; scopes: Map<string, Kept> }>();
const memoFor = (api: Api, uid: string | null) => {
  let m = newsMemo.get(api);
  if (!m || m.uid !== uid) { m = { uid, scopes: new Map() }; newsMemo.set(api, m); }
  return m.scopes;
};
const ALL = "__all__";
export const newsKey = (uid: string) => `assetly-news:${uid}`;
function readKept(uid: string | null): Kept | null {
  if (!uid) return null;
  try {
    const v = JSON.parse(localStorage.getItem(newsKey(uid)) ?? "null") as Kept | null;
    return v && Array.isArray(v.items) && typeof v.at === "number" ? v : null;
  } catch { return null; }
}
function writeKept(uid: string | null, kept: Kept) {
  if (!uid) return;
  // a page's worth is what the screen shows first; the rest reloads
  try { localStorage.setItem(newsKey(uid), JSON.stringify({ items: kept.items.slice(0, NEWS_PAGE), at: kept.at, held: kept.held })); } catch { /* private mode or quota */ }
}

/** "Today", "Yesterday", else "Wed, Sep 23" (the reader's own calendar); no date: "Earlier". */
export function newsDay(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "Earlier";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Consecutive runs of items under their day's heading (the list is newest first). */
export function groupByDay(items: NewsItem[], now: Date = new Date()): { day: string; items: NewsItem[] }[] {
  const out: { day: string; items: NewsItem[] }[] = [];
  for (const n of items) {
    const day = newsDay(n.published_at, now);
    if (out.length && out[out.length - 1].day === day) out[out.length - 1].items.push(n);
    else out.push({ day, items: [n] });
  }
  return out;
}

// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows, dispKr = "KRW", uid = null, pricesDown = false, intelPending = false, onRefreshInsights, insightsRefreshing = false, freshInsights = null, onInsightsSeen, onRefreshSymbol, symbolRefreshing = {}, symbolFresh = {}, bookUnknown = false }: {
  api: Api; rows: PortfolioRow[]; dispKr?: "USD" | "KRW";
  /** no book has loaded yet (the first load failed or is still out): an empty `rows` is unknown, not "no positions" */
  bookUnknown?: boolean;
  /** whose removals to screen the portfolio card against (see lib/heldIntel) */
  uid?: string | null;
  /** the app's own "Couldn't refresh prices." banner is up: News says its part quietly, not in a second red box */
  pricesDown?: boolean;
  /** a book-changed run is being written: the card says it is catching up */
  intelPending?: boolean;
  onRefreshInsights?: () => void; insightsRefreshing?: boolean; freshInsights?: Insight | null; onInsightsSeen?: (generatedAt: string) => void;
  onRefreshSymbol?: (symbol: string) => void; symbolRefreshing?: Record<string, boolean>; symbolFresh?: Record<string, Insight>;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  // cash and debt have no news; one chip per symbol even when held in several accounts
  const newsRows = rows.filter((r, i) => r.kind !== "cash" && r.kind !== "debt"
    && rows.findIndex((x) => x.symbol === r.symbol) === i);
  const heldKey = newsRows.map((r) => r.symbol).sort().join(",");
  // "All holdings" is cached per holdings set; a one-symbol filter is the same list whatever else is held
  const ck = (key: string) => (key === ALL ? `${ALL}|${heldKey}` : key);
  // the kept list paints at once (a device copy fills in on a cold start); the refresh runs behind it
  const [cache] = useState(() => memoFor(api, uid));
  const keptFor = (key: string): Kept | undefined => {
    if (bookUnknown) return undefined;   // no holdings known yet: nothing kept applies
    // the device copy: for these holdings, or (an older copy, from before lists carried their holdings) one with
    // stories in it; an empty older copy may be the empty read this guards against
    if (!cache.has(ck(key)) && key === ALL) {
      const k = readKept(uid);
      if (k && (k.held === heldKey || (k.held === undefined && k.items.length > 0))) cache.set(ck(ALL), k);
    }
    return cache.get(ck(key));
  };
  const [items, setItems] = useState<NewsItem[]>(() => keptFor(ALL)?.items ?? []);
  const [state, setState] = useState<"loading" | "ok" | "pulling" | "error">(() => (keptFor(ALL) ? "ok" : "loading"));
  const [limit, setLimit] = useState(NEWS_PAGE);
  const [keptAt, setKeptAt] = useState<number | null>(null);   // a failed refresh over a list loaded earlier: its time
  const [pulled] = useState(() => new Set<string>());   // one on-demand pull per scope per visit
  const [top5, setTop5] = useState<Insight | null>(null);          // Assetly Intelligence, portfolio-wide
  const [retryN, setRetryN] = useState(0);                         // Retry after a failed load, or a pull to refresh
  // pull to refresh bumps the same counter; its promise settles once the reload has landed
  const settled = useRef<(() => void) | null>(null);
  const refresh = () => new Promise<void>((resolve) => { settled.current = resolve; setRetryN((n) => n + 1); });
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
    const key = filter ?? ALL;
    setKeptAt(null);
    // until the holdings are known there is nothing to read: a read now comes back empty and would be kept
    if (bookUnknown) { setItems([]); setState("ok"); return () => { live = false; }; }   // says "once your portfolio loads"
    const hit = keptFor(key);
    if (hit) { setItems(hit.items); setState("ok"); }   // show instantly, refresh behind
    else { setItems([]); setState("loading"); }
    const held = newsRows.map((r) => r.symbol);
    const scope = filter ?? held;
    // one copy per story (URL or headline), entities decoded. Offline, a request can hang instead of failing,
    // and a pull then spun and settled on nothing (r2 power-user audit): past the limit it is an error with Retry.
    // offline it fails at once instead of spinning over an empty page (r3 native m4)
    const load = () => offline() ? Promise.reject(new Error("offline")) : Promise.race([api.getNews(scope),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), NEWS_TIMEOUT_MS))]).then(dedupeNews);
    load()
      .then(async (n) => {
        if (!live) return;
        const key = filter ?? ALL;
        if (n.length === 0 && rows.length > 0 && !pulled.has(key)) {
          pulled.add(key);
          setState("pulling");                          // pull the first stories right now
          await api.refreshNews(filter ? [filter] : held.slice(0, 5));
          n = await load();
          if (!live) return;
        }
        const kept = { items: n, at: Date.now(), held: heldKey };
        cache.set(ck(key), kept);
        if (key === ALL) writeKept(uid, kept);
        setItems(n);
        setState("ok");
      })
      .catch(() => {
        if (!live) return;
        // a list this visit already loaded stays on screen, dated, under the error (r3 design m3)
        const kept = cache.get(ck(key));
        if (kept) { setItems(kept.items); setKeptAt(kept.at); }
        setState("error");
      })
      .finally(() => { settled.current?.(); settled.current = null; });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filter, heldKey, bookUnknown, retryN]);
  useEffect(() => { setLimit(NEWS_PAGE); }, [filter]);

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
      {filter && <InsightsCard api={api} symbol={filter} onRefresh={onRefreshSymbol ? () => onRefreshSymbol(filter) : undefined} refreshing={!!symbolRefreshing[filter]} fresh={symbolFresh[filter] ?? null}
        crypto={rows.some((r) => r.symbol === filter && r.kind === "crypto")} />}
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
                {intel.news5.map((b, i) => <li key={i}>{decodeEntities(b.text)}{b.source && <span className="sub" data-testid="news-line-source"> · {b.source}</span>}</li>)}
              </ul>
            </>
          )}
          <p className="insights-foot">Not financial advice</p>
        </section>
      )}
      {state === "error" && (pricesDown ? (
        // the app's banner above already says the connection is down, with its Retry (which reloads this list
        // too): a second red box with a second Retry under it was two alarms for one fact (r5 designer m-1)
        <p className="sub news-kept" role="status" data-testid="news-kept">
          {keptAt !== null ? `Showing news from ${clock(keptAt)}.` : "News will load when the connection is back."}
        </p>
      ) : (
        <div className="error-note inline-note" role="alert" data-testid="news-error">
          <span>{offline() ? "You're offline." : "Couldn't load news."}{keptAt !== null ? ` Showing news from ${clock(keptAt)}.` : ""}</span>
          <button className="chip" onClick={() => setRetryN((n) => n + 1)}>Retry</button>
        </div>
      ))}
      {state === "loading" && items.length === 0 && (
        // the first read of the feed: say so, and hold the list's shape (blank under the chips for up to 11s
        // under load; r10 designer)
        <div aria-busy="true" data-testid="news-loading">
          <p className="empty" style={{ padding: "18px 0 10px" }}>Loading news{filter ? ` for ${filter}` : ""}…</p>
          {[0, 1, 2].map((i) => <div key={i} className="skel-line" style={{ height: 40, width: "100%" }} />)}
        </div>
      )}
      {state === "pulling" && (
        <p className="empty" aria-busy="true">Pulling the latest stories{filter ? ` for ${filter}` : ""}…</p>
      )}
      {state === "ok" && items.length === 0 && (
        <p className="empty" data-testid="news-empty">{rows.length === 0 && bookUnknown ? "Your news shows here once your portfolio loads." : rows.length === 0 ? "Add a position and its news follows." : `Nothing fresh${filter ? ` for ${filter}` : ""} right now. We'll keep watching.`}</p>
      )}
      {(state === "ok" || state === "loading" || keptAt !== null) && groupByDay(items.slice(0, limit)).map((g) => (
        <section key={g.day} aria-label={g.day} data-testid="news-day">
          <h3 className="news-day">{g.day}</h3>
          <div className="card">
            {g.items.map((n) => (
              <a key={n.id} className="row" href={n.url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none", display: "flex" }}
                 onClick={(e) => { e.preventDefault(); void openExternal(n.url); }}>
                <span>
                  <span style={{ fontWeight: 500 }}>{n.title}</span><br />
                  <span className="sub">{(() => { const rr = rows.find((x) => x.symbol === n.symbol); return rr ? labelParts(rr, dispKr === "KRW").main : n.symbol; })()} · {n.source} · {timeAgo(n.published_at)}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
      {(state === "ok" || state === "loading" || keptAt !== null) && items.length > limit && (
        <button className="btn secondary" data-testid="news-more" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + NEWS_PAGE)}>
          Show more ({items.length - limit} older)
        </button>
      )}
    </PullToRefresh>
  );
}
