import { openConnectPortal, platformTag } from "../lib/native";
import { useEffect, useState } from "react";
import type { Api, PortfolioRow } from "../lib/api";
import { BriefCard } from "../components/BriefCard";
import { AssessmentCard } from "../components/AssessmentCard";
import type { AssessState } from "../lib/assessment";
import { isMarketOpen, marketOf, moveSession, moverEligible, moverMode, sessionLabel } from "../lib/markets";
import { convertCcy, dayChangeAmount, glClass, labelParts, money, moneyClass, moneyExact, signedMoney, signedMoneyCompact, signedPct, type FxRates } from "../lib/format";
import { Icon } from "../components/Icon";
import { accountTag, isRetirement } from "../lib/accounts";
import { formatQty } from "../lib/numbers";
import { dayGroups, isHeld } from "../lib/portfolio";

// Canvas 2a: net worth, movers, market pulse.
const DETAIL_KEY = "assetly-nw-detail";
// The one-time "what next" hint: armed by the first run of adds (App), "done" once dismissed.
export const NEXT_KEY = "assetly-next-steps";
// crypto files under a market by its denomination, exactly as the old Holdings filter did:
// a USD coin belongs with the US book, a KRW-quoted one with the Korean book
const mktFor = (r: PortfolioRow): "US" | "KR" | null => {
  const m = marketOf(r);
  if (m === "CRYPTO") return r.currency === "KRW" ? "KR" : "US";
  return m;
};

export function Home({ api, rows: book, totals, baseCurrency, onOpen, onAdd, dispUs = "USD", dispKr = "KRW" , briefBanner = null, onBriefBannerDone, loading = false,
  assessment = null, onAssessRetry, onAssessDismiss, onOpenNews }: {
  api: Api; rows: PortfolioRow[]; loading?: boolean;
  totals: { value: number; assets: number; debt: number; gl: number; cost: number; day: number; mixed: boolean; fx: FxRates | number | null; unconverted: number };
  baseCurrency: "USD" | "KRW"; onOpen: (id: string) => void; onAdd: () => void;
  dispUs?: "USD" | "KRW"; dispKr?: "USD" | "KRW";
  briefBanner?: { audio: boolean; edition?: string } | null; onBriefBannerDone?: () => void;
  assessment?: AssessState | null; onAssessRetry?: () => void; onAssessDismiss?: () => void; onOpenNews?: () => void;
}) {
  // App already drops empty holdings; a 0-share row must never reach Movers or the list whoever renders Home
  const rows = book.filter(isHeld);
  // only the markets this book actually holds drive the session badge and mover mode
  const heldMkts = [...new Set(rows.map((r) => marketOf(r)).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const hasCrypto = rows.some((r) => marketOf(r) === "CRYPTO");
  const mode = moverMode(new Date(), heldMkts);
  const [pulse, setPulse] = useState<{ symbol: string; name: string; price: number; change_pct: number | null }[]>([]);
  const [filter, setFilter] = useState<"all" | "US" | "KR" | "ret">("all");
  // collapsed by default; whoever wants the split gets it back on every visit
  const [detail, setDetailState] = useState(() => { try { return localStorage.getItem(DETAIL_KEY) === "1"; } catch { return false; } });
  const setDetail = (v: boolean) => { setDetailState(v); try { localStorage.setItem(DETAIL_KEY, v ? "1" : "0"); } catch { /* private mode */ } };
  const [nextArmed, setNextArmed] = useState(() => { try { return localStorage.getItem(NEXT_KEY) === "armed"; } catch { return false; } });
  useEffect(() => { try { if (localStorage.getItem(NEXT_KEY) === "armed") setNextArmed(true); } catch { /* private mode */ } }, [assessment?.startedAt]);
  const setNextDone = () => { setNextArmed(false); try { localStorage.setItem(NEXT_KEY, "done"); } catch { /* private mode */ } };
  useEffect(() => {
    let live = true;
    if (mode.kind === "pulse") api.getPulse().then((p) => { if (live) setPulse(p); }).catch(() => {});
    return () => { live = false; };
  }, [api, mode.kind]);
  // Per-market display currency (Settings matrix).
  const show = (v: number | null, r: PortfolioRow): [number | null, string] => {
    const target = r.currency === "KRW" ? dispKr : dispUs;
    if (target === r.currency || v === null) return [v, r.currency];
    const c = convertCcy(v, r.currency, target, totals.fx);
    return c === null ? [v, r.currency] : [c, target];
  };
  // An empty book is only "no positions" once the first load has answered. Before that it is
  // unknown, and the screen holds the shape of Home rather than offering to connect a brokerage.
  if (rows.length === 0 && loading) {
    return (
      <div className="home-skeleton" aria-busy="true" aria-label="Loading your portfolio" data-testid="home-loading">
        <section style={{ margin: "8px 0 18px" }}>
          <div className="skel-line" style={{ height: 34, width: "58%", margin: "6px 0 10px" }} />
          <div className="skel-line" style={{ width: "44%" }} />
          <div className="skel-line" style={{ width: "40%" }} />
          <div className="nw-rule" aria-hidden="true" />
        </section>
        <div className="card" style={{ minHeight: 132 }}>
          <div className="skel-line" style={{ width: "36%" }} />
          <div className="skel-line" style={{ width: "88%" }} />
          <div className="skel-line" style={{ width: "72%" }} />
        </div>
        <div className="skel-line" style={{ width: "28%", height: 14, margin: "18px 0 12px" }} />
        {[0, 1, 2].map((i) => <div key={i} className="skel-line" style={{ height: 40, width: "100%" }} />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p style={{ marginBottom: 14 }}>No runners on the track.</p>
        <button className="btn" style={{ marginBottom: 10 }} onClick={async () => {
          try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); } catch { /* button stays */ }
        }}><Icon name="bolt" /> Connect your brokerage</button>
        <button className="btn secondary" onClick={onAdd}>Add positions manually</button>
      </div>
    );
  }
  // Holdings folded in: market / retirement filters with their own totals line
  const marketsHeld = [...new Set(rows.map(mktFor).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const hasRet = rows.some((r) => isRetirement(r.account));
  const filterChips: ("US" | "KR" | "ret")[] = [...(marketsHeld.length > 1 ? marketsHeld : []), ...(hasRet ? ["ret" as const] : [])];
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "ret" ? isRetirement(r.account) : mktFor(r) === filter));
  const movers = [...rows].filter((r) => r.change_pct !== null && moverEligible(r, new Date(), heldMkts))
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
  const quietMovers = [...rows].filter((r) => r.change_pct !== null && marketOf(r) !== null)
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
  const showPulse = mode.kind === "pulse" && pulse.length > 0;
  const isLive = (r: PortfolioRow) => { const m = marketOf(r); return m !== null && r.change_pct !== null && isMarketOpen(m); };
  const moverList = mode.kind === "pulse" && !showPulse ? quietMovers : movers;
  // The three supporting lines under the headline totals were the busiest thing on the screen and
  // none of them is what you open the app for. They fold away; the toggle only appears when there
  // is actually something folded, and the choice sticks.
  const twoMarkets = new Set(rows.map(mktFor).filter(Boolean)).size > 1 && !!totals.fx;
  const hasDetail = totals.debt > 0 || twoMarkets;
  const groups = dayGroups(rows, baseCurrency, typeof totals.fx === "number" ? { USD: 1, KRW: totals.fx } : totals.fx);
  return (
    <>
      <section aria-label="Net worth" style={{ margin: "8px 0 18px" }}>
        <div className="net num" data-testid="net-worth">{money(totals.value, baseCurrency)}</div>
        {groups.length <= 1 ? (
          <div className={`day num ${moneyClass(totals.day)}`} data-testid="total-day">
            {signedMoney(totals.day, baseCurrency)} ({signedPct(totals.value - totals.day !== 0 ? (totals.day / (totals.value - totals.day)) * 100 : 0)}) {groups[0] && !groups[0].today ? `· ${groups[0].label}` : "today"}
          </div>
        ) : (
          // moves from different sessions are never summed into one "today": each market says which session it is
          groups.map((g, i) => (
            <div key={g.label} className={`day num ${moneyClass(g.day)}${i ? " day-split" : ""}`} data-testid={i ? "total-day-other" : "total-day"}
              style={i ? { fontSize: 13.5 } : undefined}>
              {g.markets.join(" + ")} {signedMoney(g.day, baseCurrency)} ({signedPct(g.basis !== 0 ? (g.day / g.basis) * 100 : 0)}) {g.today ? "today" : `· ${g.label}`}
            </div>
          ))
        )}
        <div className={`day num ${moneyClass(totals.gl)}`} data-testid="total-gl" style={{ fontSize: 13.5 }}>
          {signedMoney(totals.gl, baseCurrency)} ({signedPct(totals.cost !== 0 ? (totals.gl / totals.cost) * 100 : 0)}) all time
        </div>
        <div className="nw-detail" id="nw-detail" hidden={!detail}>
        {totals.debt > 0 && (
          <div className="status-line num" data-testid="assets-debt">
            assets {money(totals.assets, baseCurrency)} · debt {signedMoney(-totals.debt, baseCurrency)}
          </div>
        )}
        {(() => {
          // Crypto folds into the market of its pricing currency ($ -> US), same as Holdings.
          const bucketOf = (r: PortfolioRow): "US" | "KR" | null => {
            const m = marketOf(r);
            if (m === "CRYPTO") return r.currency === "KRW" ? "KR" : "US";
            return m;
          };
          const buckets: ["US" | "KR", string][] = [["US", "US"], ["KR", "KRX"]];
          const held = buckets.filter(([m]) => rows.some((r) => bucketOf(r) === m));
          if (held.length < 2 || !totals.fx) return null;
          // debt has no market performance: keep it out of the per-market lines
          const agg = (m: string, f: (r: PortfolioRow) => number) => rows.filter((r) => bucketOf(r) === m && r.kind !== "debt")
            .reduce((a, r) => a + (convertCcy(f(r), r.currency, baseCurrency, totals.fx) ?? 0), 0);
          const line = (f: (r: PortfolioRow) => number, base: (r: PortfolioRow) => number) => held.map(([m, label]) => {
            const d = agg(m, f), b = agg(m, base);
            return `${label} ${signedMoney(d, baseCurrency)} (${signedPct(b !== 0 ? (d / b) * 100 : 0)})`;
          }).join(" · ");
          return (
            <div data-testid="market-breakdown">
              <div className="status-line num">{groups.length > 1 ? "latest sessions" : "today"}: {line((r) => dayChangeAmount(r.value, r.change_pct) ?? 0, (r) => (r.value ?? 0) - (dayChangeAmount(r.value, r.change_pct) ?? 0))}</div>
              <div className="status-line num">all time: {line((r) => r.total_gl ?? 0, (r) => r.cost_basis ?? 0)}</div>
            </div>
          );
        })()}
        </div>
        {hasDetail && (
          <button className="nw-more" type="button" data-testid="nw-detail-toggle"
            aria-expanded={detail} aria-controls="nw-detail" onClick={() => setDetail(!detail)}>
            {detail ? "Less" : "Breakdown"}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
        {totals.unconverted > 0 && (
          <div className="status-line" role="note">{totals.unconverted} position{totals.unconverted > 1 ? "s" : ""} awaiting FX rate — excluded from the total</div>
        )}
        <div className="nw-rule" aria-hidden="true" />
      </section>
      {briefBanner && (
        <div className="status-note ok" role="status" data-testid="brief-banner">
          <span className="lead"><Icon name="check" />{briefBanner.edition === "assessment" ? "Your portfolio assessment is ready" : "Your brief is ready"}{briefBanner.audio ? <> · tap <Icon name="play" size={10} /> Listen below</> : ""}</span>
          <button className="chip" onClick={onBriefBannerDone} aria-label="Dismiss"><Icon name="close" size={12} /></button>
        </div>
      )}
      {assessment && <AssessmentCard state={assessment} onRetry={() => onAssessRetry?.()} onDismiss={() => onAssessDismiss?.()} onOpenNews={onOpenNews} />}
      {/* a fresh assessment remounts the brief card so it shows at once (its own look-up gave up after 4 min) */}
      <BriefCard api={api} key={assessment?.readyAt ?? "brief"} />
      {nextArmed && rows.filter((r) => r.kind !== "cash" && r.kind !== "debt").length < 3 && (
        // after the first adds: the obvious next moves, until the book looks like a portfolio or it is dismissed
        <section className="card next-steps" data-testid="next-steps" aria-label="Next steps">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Next: add the rest of your portfolio</strong>
            <button className="chip" onClick={setNextDone} aria-label="Dismiss next steps"><Icon name="close" size={12} /></button>
          </div>
          <p className="sub" style={{ margin: "4px 0 0" }}>Your brief and assessment read the whole book, so they get sharper with every holding.</p>
          <div className="next-steps-actions">
            <button className="chip" onClick={onAdd}>+ Add another</button>
            <button className="chip" onClick={async () => {
              try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); } catch { /* the chip stays */ }
            }}><Icon name="bolt" size={12} /> Import from a brokerage</button>
            {onOpenNews && <button className="chip" onClick={onOpenNews}>Read your Intelligence</button>}
          </div>
        </section>
      )}
      <h2 className="h1" style={{ fontSize: 16 }}>Movers <span className="sub" data-testid="session-label" style={{ fontWeight: 400 }}>· {sessionLabel(new Date(), heldMkts, hasCrypto)}</span></h2>
      {showPulse && (
        <div className="card" style={{ marginBottom: 16 }} data-testid="pulse-card">
          {pulse.map((p) => (
            <div key={p.symbol} className="row" style={{ cursor: "default" }}>
              <span><span className="sym">{p.name}</span></span>
              <span className={`right ${glClass(p.change_pct)}`}>
                <span className="num">{p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                <span className="num sub"> · {signedPct(p.change_pct)}</span>
              </span>
            </div>
          ))}
          <p className="sub" style={{ margin: "6px 2px 2px" }}>Index futures ahead of the US open.</p>
        </div>
      )}
      {!showPulse && <div className="card" style={{ marginBottom: 16 }} data-testid="movers-card">
        {moverList.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{labelParts(r, dispKr === "KRW").main}</span> <span className="sub">{labelParts(r, dispKr === "KRW").sub}</span></span>
            <span className={`right ${glClass(r.change_pct)}`}>
              {(() => { const [dv, dc] = show(dayChangeAmount(r.value, r.change_pct), r); return <span className="num">{signedMoney(dv, dc)}</span>; })()}
              <span className="num sub"> · {signedPct(r.change_pct)}{isLive(r) && <span className="live-dot" aria-hidden="true" />}</span>
            </span>
          </button>
        ))}
      </div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h1" style={{ fontSize: 16 }}>Positions</h2>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="chip" aria-label="Import from brokerage" onClick={async () => {
            try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); } catch { /* connect button stays */ }
          }}><Icon name="bolt" size={12} /> Import</button>
          <button className="chip" onClick={onAdd} aria-label="Add position">+ Add</button>
        </span>
      </div>
      {filterChips.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by type">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          {filterChips.map((k) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {k === "US" ? "US" : k === "KR" ? "KR" : "Ret"}
            </button>
          ))}
        </div>
      )}
      {filter !== "all" && shown.length > 0 && (() => {
        let value = 0, day = 0, gl = 0;
        for (const r of shown) {
          const sign = r.kind === "debt" ? -1 : 1;
          const v = convertCcy(r.value ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          const g = convertCcy(r.total_gl ?? 0, r.currency, baseCurrency, totals.fx) ?? 0;
          value += sign * v; day += sign * d; gl += sign * g;
        }
        const dayPct = value - day !== 0 ? (day / (value - day)) * 100 : 0;
        const glPct = value - gl !== 0 ? (gl / (value - gl)) * 100 : 0;
        return (
          <div className="status-line num" data-testid="filter-totals" style={{ margin: "0 2px 8px" }}>
            {money(value, baseCurrency)} · today <span className={moneyClass(day)}>{signedMoney(day, baseCurrency)} ({signedPct(dayPct)})</span> · total <span className={moneyClass(gl)}>{signedMoney(gl, baseCurrency)} ({signedPct(glPct)})</span>
          </div>
        );
      })()}
      <div className="card" data-testid="positions-card">
        {shown.map((r) => {
          const [rv, rc] = show(r.value, r);
          return (
            <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
              <span>
                <span className="sym">{labelParts(r, dispKr === "KRW").main}</span> <span className="sub">{labelParts(r, dispKr === "KRW").sub}</span><br />
                <span className="sub num">{r.kind === "cash" ? "cash balance" : r.kind === "debt" ? "debt balance" : `${formatQty(r.qty ?? 0)} ${r.kind === "crypto" ? r.symbol : "sh"}`}{accountTag(r.account) ? ` · ${accountTag(r.account)}` : ""}{r.source === "snaptrade" ? <> · <Icon name="bolt" size={10} /></> : ""}{r.kind === "cash" || r.kind === "debt" ? "" : r.price !== null ? ` · ${moneyExact(r.price, r.currency)}` : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
              </span>
              <span className="right">
                <span className="num">{r.kind === "debt" ? signedMoney(-(rv ?? 0), rc) : money(rv, rc)}</span>
                {/* a balance has no daily move: "0.00% ($0) today" on cash was noise */}
                {r.kind !== "cash" && r.kind !== "debt" && (<><br />
                <span className={`num sub ${glClass(r.change_pct)}`}>{signedPct(r.change_pct)}{r.change_pct !== null && (() => { const [dv, dc] = show(dayChangeAmount(r.value, r.change_pct), r); return <> ({signedMoneyCompact(dv, dc)})</>; })()} {moveSession(r).label}{isLive(r) && <span className="live-dot" aria-hidden="true" />}</span></>)}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="empty">Nothing in this filter.</p>}
      </div>
    </>
  );
}
