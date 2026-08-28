import { useEffect, useState } from "react";
import type { Api, Insight, PortfolioRow } from "../lib/api";
import { convertCcy, dayChangeAmount, glClass, labelParts, money, moneyExact, signedMoney, signedMoneyCompact, signedPct, timeAgo } from "../lib/format";
import { isMarketOpen, marketOf } from "../lib/markets";

// Canvas 2b: the table as a touch list with multi-select filter chips.
const ACCT: Record<string, string> = { brokerage: "", bank: "Bank", "401k": "401k", ira: "IRA", crypto: "Crypto" };

export function Holdings({ rows, onOpen, onAdd, api, fxRate, totalsCcy = "USD", dispUs = "USD", dispKr = "KRW" }: {
  rows: PortfolioRow[]; onOpen: (id: string) => void; onAdd: () => void; api: Api; fxRate: number | null;
  totalsCcy?: "USD" | "KRW"; dispUs?: "USD" | "KRW"; dispKr?: "USD" | "KRW";
}) {
  const [pins, setPins] = useState<Insight | null>(null);
  useEffect(() => {
    let live = true;
    if (rows.length > 0) api.getPortfolioInsights().then((v) => { if (live) setPins(v); }).catch(() => {});
    return () => { live = false; };
  }, [api, rows.length]);
  const [filter, setFilter] = useState<"all" | "US" | "KR" | "ret">("all");
  // Crypto files under the market of its pricing currency ($ -> US, \u20a9 -> KR).
  const mktFor = (r: PortfolioRow): "US" | "KR" | null => {
    const m = marketOf(r);
    if (m === "CRYPTO") return r.currency === "KRW" ? "KR" : "US";
    return m;
  };
  const marketsHeld = [...new Set(rows.map(mktFor).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const hasRet = rows.some((r) => r.account === "401k" || r.account === "ira");
  const chips: ("US" | "KR" | "ret")[] = [...(marketsHeld.length > 1 ? marketsHeld : []), ...(hasRet ? ["ret" as const] : [])];
  const isRet = (r: PortfolioRow) => r.account === "401k" || r.account === "ira";
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "ret" ? isRet(r) : mktFor(r) === filter));
  const isLive = (r: PortfolioRow) => { const m = marketOf(r); return m !== null && r.change_pct !== null && isMarketOpen(m); };
  // Per-market display currency (Settings matrix): KRW rows follow dispKr, everything else dispUs.
  const show = (v: number | null, r: PortfolioRow): [number | null, "USD" | "KRW"] => {
    const target = r.currency === "KRW" ? dispKr : dispUs;
    if (target === r.currency || v === null) return [v, r.currency];
    const c = convertCcy(v, r.currency, target, fxRate);
    return c === null ? [v, r.currency] : [c, target];
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h1">Holdings</h2>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="chip" aria-label="Import from brokerage" onClick={async () => {
            try { const r = await api.snaptrade("connect"); if (r.url) window.location.assign(r.url); } catch { /* connect button stays */ }
          }}>⚡ Import</button>
          <button className="chip" onClick={onAdd} aria-label="Add position">+ Add</button>
        </span>
      </div>
      {pins && (
        <section className="card insights" data-testid="portfolio-insights-card" aria-label="Portfolio insights">
          <div className="insights-head">
            <span className="insights-brand">Your portfolio</span>
            <span className="sub num">{timeAgo(pins.generated_at)}</span>
          </div>
          <ul className="insights-list">
            {pins.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <p className="insights-foot">Not financial advice</p>
        </section>
      )}
      <div className="chips" role="group" aria-label="Filter by type">
        <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        {chips.map((k) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "US" ? "US" : k === "KR" ? "KR" : "Ret"}
          </button>
        ))}
      </div>
      {filter !== "all" && shown.length > 0 && (() => {
        let value = 0, day = 0, gl = 0;
        for (const r of shown) {
          const sign = r.kind === "debt" ? -1 : 1;
          const v = convertCcy(r.value ?? 0, r.currency, totalsCcy, fxRate) ?? 0;
          const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, totalsCcy, fxRate) ?? 0;
          const g = convertCcy(r.total_gl ?? 0, r.currency, totalsCcy, fxRate) ?? 0;
          value += sign * v; day += sign * d; gl += sign * g;
        }
        const dayPct = value - day !== 0 ? (day / (value - day)) * 100 : 0;
        const glPct = value - gl !== 0 ? (gl / (value - gl)) * 100 : 0;
        return (
          <div className="status-line num" data-testid="filter-totals" style={{ margin: "0 2px 8px" }}>
            {money(value, totalsCcy)} · today <span className={glClass(day)}>{signedMoney(day, totalsCcy)} ({signedPct(dayPct)})</span> · total <span className={glClass(gl)}>{signedMoney(gl, totalsCcy)} ({signedPct(glPct)})</span>
          </div>
        );
      })()}
      <div className="card">
        {shown.map((r) => {
          const [rv, rc] = show(r.value, r);
          return (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span>
              <span className="sym">{labelParts(r, dispKr === "KRW").main}</span> <span className="sub">{labelParts(r, dispKr === "KRW").sub}</span><br />
              <span className="sub num">{r.kind === "cash" ? "cash balance" : r.kind === "debt" ? "debt balance" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{ACCT[r.account] ? ` · ${ACCT[r.account]}` : ""}{r.kind === "cash" || r.kind === "debt" ? "" : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
            </span>
            <span className="right">
              <span className="num">{r.kind === "debt" ? signedMoney(-(rv ?? 0), rc) : money(rv, rc)}</span><br />
              <span className={`num sub ${glClass(r.change_pct)}`}>{signedPct(r.change_pct)}{r.change_pct !== null && (() => { const [dv, dc] = show(dayChangeAmount(r.value, r.change_pct), r); return <> ({signedMoneyCompact(dv, dc)})</>; })()} today{isLive(r) && <span className="live-dot" aria-hidden="true" />}</span>
            </span>
          </button>
          );
        })}
        {shown.length === 0 && rows.length === 0 && (
          <div className="empty"><p style={{ marginBottom: 14 }}>No runners on the track.</p>
            <button className="btn" style={{ marginBottom: 10 }} onClick={async () => {
              try { const r = await api.snaptrade("connect"); if (r.url) window.location.assign(r.url); } catch { /* stay */ }
            }}>⚡ Connect your brokerage</button>
            <button className="btn secondary" onClick={onAdd}>Add positions manually</button></div>
        )}
        {shown.length === 0 && rows.length > 0 && <p className="empty">Nothing in this filter.</p>}
      </div>
    </>
  );
}
