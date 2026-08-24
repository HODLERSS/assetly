import type { PortfolioRow } from "../lib/api";
import { glClass, money, signedMoney, signedPct } from "../lib/format";

// Canvas 2a: net worth, movers, market pulse.
export function Home({ rows, totals, baseCurrency, onOpen, onAdd }: {
  rows: PortfolioRow[]; totals: { value: number; gl: number; cost: number };
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
  const movers = [...rows].filter((r) => r.change_pct !== null)
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
  return (
    <>
      <section aria-label="Net worth" style={{ margin: "8px 0 18px" }}>
        <div className="net num" data-testid="net-worth">{money(totals.value, baseCurrency)}</div>
        <div className={`day num ${glClass(totals.gl)}`} data-testid="total-gl">
          {signedMoney(totals.gl, baseCurrency)} all time
        </div>
        <div className="countdown" aria-hidden="true"><div style={{ width: "38%" }} /></div>
      </section>
      <h2 className="h1" style={{ fontSize: 16 }}>Movers</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        {movers.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
            <span className={`num right ${glClass(r.change_pct)}`}>{signedPct(r.change_pct)}</span>
          </button>
        ))}
      </div>
      <h2 className="h1" style={{ fontSize: 16 }}>Positions</h2>
      <div className="card">
        {rows.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span><br /><span className="sub">{r.qty ?? 0} sh</span></span>
            <span className="right">
              <span className="num">{money(r.value, r.currency)}</span><br />
              <span className={`num sub ${glClass(r.total_gl)}`}>{signedMoney(r.total_gl, r.currency)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
