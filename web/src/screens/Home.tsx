import { useEffect, useState } from "react";
import type { Api, PortfolioRow } from "../lib/api";
import { marketOf, moverEligible, moverMode, sessionLabel } from "../lib/markets";
import { convertCcy, dayChangeAmount, glClass, money, signedMoney, signedPct } from "../lib/format";

// Canvas 2a: net worth, movers, market pulse.
const ACCT: Record<string, string> = { brokerage: "", bank: "Bank", "401k": "401k", ira: "IRA", crypto: "Crypto" };

export function Home({ api, rows, totals, baseCurrency, onOpen, onAdd, dispUs = "USD", dispKr = "KRW" }: {
  api: Api; rows: PortfolioRow[];
  totals: { value: number; gl: number; cost: number; day: number; mixed: boolean; fx: number | null; unconverted: number };
  baseCurrency: "USD" | "KRW"; onOpen: (id: string) => void; onAdd: () => void;
  dispUs?: "USD" | "KRW"; dispKr?: "USD" | "KRW";
}) {
  const mode = moverMode();
  const [pulse, setPulse] = useState<{ symbol: string; name: string; price: number; change_pct: number | null }[]>([]);
  useEffect(() => {
    let live = true;
    if (mode.kind === "pulse") api.getPulse().then((p) => { if (live) setPulse(p); }).catch(() => {});
    return () => { live = false; };
  }, [api, mode.kind]);
  // Per-market display currency (Settings matrix).
  const show = (v: number | null, r: PortfolioRow): [number | null, "USD" | "KRW"] => {
    const target = r.currency === "KRW" ? dispKr : dispUs;
    if (target === r.currency || v === null) return [v, r.currency];
    const c = convertCcy(v, r.currency, target, totals.fx);
    return c === null ? [v, r.currency] : [c, target];
  };
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
  const quietMovers = [...rows].filter((r) => r.change_pct !== null && marketOf(r) !== null)
    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 3);
  const showPulse = mode.kind === "pulse" && pulse.length > 0;
  const moverList = mode.kind === "pulse" && !showPulse ? quietMovers : movers;
  return (
    <>
      <section aria-label="Net worth" style={{ margin: "8px 0 18px" }}>
        <div className="net num" data-testid="net-worth">{money(totals.value, baseCurrency)}</div>
        <div className={`day num ${glClass(totals.day)}`} data-testid="total-day">
          {signedMoney(totals.day, baseCurrency)} ({signedPct(totals.value - totals.day !== 0 ? (totals.day / (totals.value - totals.day)) * 100 : 0)}) today
        </div>
        <div className={`day num ${glClass(totals.gl)}`} data-testid="total-gl" style={{ fontSize: 13.5 }}>
          {signedMoney(totals.gl, baseCurrency)} ({signedPct(totals.cost !== 0 ? (totals.gl / totals.cost) * 100 : 0)}) all time
        </div>
        {(() => {
          const buckets: ["US" | "KR" | "CRYPTO", string][] = [["US", "US"], ["KR", "KRX"], ["CRYPTO", "Crypto"]];
          const held = buckets.filter(([m]) => rows.some((r) => marketOf(r) === m));
          if (held.length < 2 || !totals.fx) return null;
          const agg = (m: string, f: (r: PortfolioRow) => number) => rows.filter((r) => marketOf(r) === m)
            .reduce((a, r) => a + (convertCcy(f(r), r.currency, baseCurrency, totals.fx) ?? 0), 0);
          const line = (f: (r: PortfolioRow) => number, base: (r: PortfolioRow) => number) => held.map(([m, label]) => {
            const d = agg(m, f), b = agg(m, base);
            return `${label} ${signedMoney(d, baseCurrency)} (${signedPct(b !== 0 ? (d / b) * 100 : 0)})`;
          }).join(" · ");
          return (
            <div data-testid="market-breakdown">
              <div className="status-line num">today: {line((r) => dayChangeAmount(r.value, r.change_pct) ?? 0, (r) => (r.value ?? 0) - (dayChangeAmount(r.value, r.change_pct) ?? 0))}</div>
              <div className="status-line num">all time: {line((r) => r.total_gl ?? 0, (r) => r.cost_basis ?? 0)}</div>
            </div>
          );
        })()}
        {totals.unconverted > 0 && (
          <div className="status-line" role="note">{totals.unconverted} position{totals.unconverted > 1 ? "s" : ""} awaiting FX rate — excluded from the total</div>
        )}
        <div className="countdown" aria-hidden="true"><div style={{ width: "38%" }} /></div>
      </section>
      <h2 className="h1" style={{ fontSize: 16 }}>Movers <span className="sub" data-testid="session-label" style={{ fontWeight: 400 }}>· {sessionLabel()}</span></h2>
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
      {!showPulse && <div className="card" style={{ marginBottom: 16 }}>
        {moverList.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
            <span className={`right ${glClass(r.change_pct)}`}>
              {(() => { const [dv, dc] = show(dayChangeAmount(r.value, r.change_pct), r); return <span className="num">{signedMoney(dv, dc)}</span>; })()}
              <span className="num sub"> · {signedPct(r.change_pct)}</span>
            </span>
          </button>
        ))}
      </div>}
      <h2 className="h1" style={{ fontSize: 16 }}>Positions</h2>
      <div className="card">
        {rows.map((r) => (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span><span className="sym">{r.symbol}</span><br />
              <span className="sub">{r.kind === "cash" ? "cash" : r.kind === "debt" ? "debt" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{ACCT[r.account] ? ` · ${ACCT[r.account]}` : ""}</span>
              {r.change_pct !== null && <span className={`sub num ${glClass(r.change_pct)}`}> · {signedPct(r.change_pct)}</span>}</span>
            <span className="right">
              {(() => { const [v, c] = show(r.value, r); return <span className="num">{r.kind === "debt" ? signedMoney(-(v ?? 0), c) : money(v, c)}</span>; })()}<br />
              {(() => { const [g, c] = show(r.total_gl, r); return <span className={`num sub ${glClass(r.total_gl)}`}>{signedMoney(g, c)}</span>; })()}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
