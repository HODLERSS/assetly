import { useState } from "react";
import type { PortfolioRow } from "../lib/api";
import { glClass, money, moneyExact, signedMoney, signedPct } from "../lib/format";

// Canvas 2b: the table as a touch list with filter chips.
export function Holdings({ rows, onOpen, onAdd }: {
  rows: PortfolioRow[]; onOpen: (id: string) => void; onAdd: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const kinds = ["all", ...new Set(rows.map((r) => r.kind))];
  const shown = rows.filter((r) => filter === "all" || r.kind === filter);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h1">Holdings</h2>
        <button className="chip" onClick={onAdd} aria-label="Add position">+ Add</button>
      </div>
      <div className="chips" role="group" aria-label="Filter by type">
        {kinds.map((k) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k === "etf" ? "ETF" : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="card">
        {shown.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span>
              <span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span><br />
              <span className="sub num">{r.kind === "cash" ? "cash balance" : r.kind === "debt" ? "debt balance" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{r.account !== "brokerage" ? ` · ${r.account === "401k" ? "401k" : "IRA"}` : ""}{r.kind === "cash" || r.kind === "debt" ? "" : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
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
