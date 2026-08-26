import { useEffect, useState } from "react";
import type { Api, Insight, PortfolioRow } from "../lib/api";
import { convertCcy, dayChangeAmount, glClass, money, moneyExact, signedMoney, signedPct, timeAgo } from "../lib/format";
import { marketOf } from "../lib/markets";

// Canvas 2b: the table as a touch list with filter chips.
const ACCT: Record<string, string> = { brokerage: "", bank: "Bank", "401k": "401k", ira: "IRA" };

export function Holdings({ rows, onOpen, onAdd, api, fxRate }: {
  rows: PortfolioRow[]; onOpen: (id: string) => void; onAdd: () => void; api: Api; fxRate: number | null;
}) {
  const [pins, setPins] = useState<Insight | null>(null);
  useEffect(() => {
    let live = true;
    if (rows.length > 0) api.getPortfolioInsights().then((v) => { if (live) setPins(v); }).catch(() => {});
    return () => { live = false; };
  }, [api, rows.length]);
  const [filter, setFilter] = useState<string>("all");
  const marketsHeld = [...new Set(rows.map((r) => marketOf(r)).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const kinds = ["all", ...(marketsHeld.length > 1 ? marketsHeld : []), ...new Set(rows.map((r) => r.kind))];
  const shown = rows.filter((r) =>
    filter === "all" ? true :
    filter === "US" || filter === "KR" ? marketOf(r) === filter :
    r.kind === filter);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h1">Holdings</h2>
        <button className="chip" onClick={onAdd} aria-label="Add position">+ Add</button>
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
        {kinds.map((k) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k === "US" ? "US" : k === "KR" ? "KR" : k === "etf" ? "ETF" : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {filter !== "all" && shown.length > 0 && (() => {
        let value = 0, day = 0, gl = 0;
        for (const r of shown) {
          const sign = r.kind === "debt" ? -1 : 1;
          const v = convertCcy(r.value ?? 0, r.currency, "USD", fxRate) ?? 0;
          const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, "USD", fxRate) ?? 0;
          const g = convertCcy(r.total_gl ?? 0, r.currency, "USD", fxRate) ?? 0;
          value += sign * v; day += sign * d; gl += sign * g;
        }
        const dayPct = value - day !== 0 ? (day / (value - day)) * 100 : 0;
        const glPct = value - gl !== 0 ? (gl / (value - gl)) * 100 : 0;
        return (
          <div className="status-line num" data-testid="filter-totals" style={{ margin: "0 2px 8px" }}>
            {money(value, "USD")} · today <span className={glClass(day)}>{signedMoney(day, "USD")} ({signedPct(dayPct)})</span> · total <span className={glClass(gl)}>{signedMoney(gl, "USD")} ({signedPct(glPct)})</span>
          </div>
        );
      })()}
      <div className="card">
        {shown.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span>
              <span className="sym">{r.symbol}</span> <span className="sub">{r.nickname || r.name}</span><br />
              <span className="sub num">{r.kind === "cash" ? "cash balance" : r.kind === "debt" ? "debt balance" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{ACCT[r.account] ? ` · ${ACCT[r.account]}` : ""}{r.kind === "cash" || r.kind === "debt" ? "" : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
            </span>
            <span className="right">
              <span className="num">{r.kind === "debt" ? signedMoney(-(r.value ?? 0), r.currency) : money(r.value, r.currency)}</span><br />
              <span className={`num sub ${glClass(r.change_pct)}`}>{signedPct(r.change_pct)} today</span>
            </span>
          </button>
        ))}
        {shown.length === 0 && rows.length === 0 && (
          <div className="empty"><p style={{ marginBottom: 14 }}>No runners on the track.</p>
            <button className="btn" onClick={onAdd}>Add your first position</button></div>
        )}
        {shown.length === 0 && rows.length > 0 && <p className="empty">Nothing in this filter.</p>}
      </div>
    </>
  );
}
