import type { PortfolioRow } from "../lib/api";
import { marketOf, moverEligible, sessionLabel, isMarketOpen } from "../lib/markets";
import { dayChangeAmount, glClass, money, signedMoney, signedPct } from "../lib/format";

// Canvas 2a: net worth, movers, market pulse.
const ACCT: Record<string, string> = { brokerage: "", bank: "Bank", "401k": "401k", ira: "IRA" };

export function Home({ rows, totals, baseCurrency, onOpen, onAdd }: {
  rows: PortfolioRow[];
  totals: { value: number; gl: number; cost: number; day: number; mixed: boolean; fx: number | null; unconverted: number };
  baseCurrency: "USD" | "KRW"; onOpen: (id: string) => void; onAdd: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p style={{ marginBottom: 14 }}>No runners on the track.</p>
        <button className="btn" onClick={onAdd}>Add your first position</button>
      </div>
    );
  }
  const movers = [...rows].filter((r) => r.change_pct !== null && moverEligible(r))
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
  return (
    <>
      <section aria-label="Net worth" style={{ margin: "8px 0 18px" }}>
        <div className="net num" data-testid="net-worth">{money(totals.value, baseCurrency)}</div>
        <div className={`day num ${glClass(totals.day)}`} data-testid="total-day">
          {signedMoney(totals.day, baseCurrency)} today
        </div>
        {(() => {
          const has = (m: "US" | "KR") => rows.some((r) => marketOf(r) === m);
          if (!(has("US") && has("KR"))) return null;
          return (
            <div className="status-line" data-testid="today-markets">
              across US ({isMarketOpen("US") ? "open" : "closed"}) + KRX ({isMarketOpen("KR") ? "open" : "closed"})
            </div>
          );
        })()}
        <div className={`day num ${glClass(totals.gl)}`} data-testid="total-gl" style={{ fontSize: 13.5 }}>
          {signedMoney(totals.gl, baseCurrency)} all time
        </div>
        {totals.unconverted > 0 && (
          <div className="status-line" role="note">{totals.unconverted} position{totals.unconverted > 1 ? "s" : ""} awaiting FX rate — excluded from the total</div>
        )}
        <div className="countdown" aria-hidden="true"><div style={{ width: "38%" }} /></div>
      </section>
      <h2 className="h1" style={{ fontSize: 16 }}>Movers <span className="sub" data-testid="session-label" style={{ fontWeight: 400 }}>· {sessionLabel()}</span></h2>
      <div className="card" style={{ marginBottom: 16 }}>
        {movers.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
            <span className={`right ${glClass(r.change_pct)}`}>
              <span className="num">{signedMoney(dayChangeAmount(r.value, r.change_pct), r.currency)}</span>
              <span className="num sub"> · {signedPct(r.change_pct)}</span>
            </span>
          </button>
        ))}
      </div>
      <h2 className="h1" style={{ fontSize: 16 }}>Positions</h2>
      <div className="card">
        {rows.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span><br />
              <span className="sub">{r.kind === "cash" ? "cash" : r.kind === "debt" ? "debt" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{ACCT[r.account] ? ` · ${ACCT[r.account]}` : ""}</span>
              {r.change_pct !== null && <span className={`sub num ${glClass(r.change_pct)}`}> · {signedPct(r.change_pct)}</span>}</span>
            <span className="right">
              <span className="num">{r.kind === "debt" ? signedMoney(-(r.value ?? 0), r.currency) : money(r.value, r.currency)}</span><br />
              <span className={`num sub ${glClass(r.total_gl)}`}>{signedMoney(r.total_gl, r.currency)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
