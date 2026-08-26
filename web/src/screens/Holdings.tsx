import { useState } from "react";
import type { PortfolioRow } from "../lib/api";
import { marketOf } from "../lib/markets";
import { glClass, money, moneyExact, signedMoney, signedPct } from "../lib/format";

// Canvas 2b: the table as a touch list with filter chips.
const ACCT: Record<string, string> = { brokerage: "", bank: "Bank", "401k": "401k", ira: "IRA" };

export function Holdings({ rows, onOpen, onAdd }: {
  rows: PortfolioRow[]; onOpen: (id: string) => void; onAdd: () => void;
}) {
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
      <div className="chips" role="group" aria-label="Filter by type">
        {kinds.map((k) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k === "US" ? "US" : k === "KR" ? "KR" : k === "etf" ? "ETF" : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
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
