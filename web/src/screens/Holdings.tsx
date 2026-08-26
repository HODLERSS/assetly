import { useEffect, useState } from "react";
import type { Api, Insight, PortfolioRow } from "../lib/api";
import { convertCcy, dayChangeAmount, glClass, money, moneyExact, signedMoney, signedPct, timeAgo } from "../lib/format";
import { marketOf } from "../lib/markets";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const marketsHeld = [...new Set(rows.map((r) => marketOf(r)).filter((m): m is "US" | "KR" => m === "US" || m === "KR"))];
  const kindsHeld = [...new Set(rows.map((r) => r.kind))];
  const hasRet = rows.some((r) => r.account === "401k" || r.account === "ira");
  const chips = [...(marketsHeld.length > 1 ? marketsHeld : []), ...(hasRet ? ["ret"] : []), ...kindsHeld];
  const isRet = (r: PortfolioRow) => r.account === "401k" || r.account === "ira";
  const matches = (r: PortfolioRow): boolean => {
    if (selected.size === 0) return true;
    const selMkts = [...selected].filter((f) => f === "US" || f === "KR");
    const selKinds = [...selected].filter((f) => f !== "US" && f !== "KR" && f !== "ret");
    if (selMkts.length && !(selMkts as string[]).includes(marketOf(r) ?? "")) return false;
    if (selected.has("ret") && !isRet(r)) return false;
    if (selKinds.length && !selKinds.includes(r.kind)) return false;
    return true;
  };
  const shown = rows.filter(matches);
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
        <button className="chip" aria-pressed={selected.size === 0} onClick={() => setSelected(new Set())}>All</button>
        {chips.map((k) => (
          <button key={k} className="chip" aria-pressed={selected.has(k)} onClick={() => {
            const next = new Set(selected);
            if (next.has(k)) next.delete(k); else next.add(k);
            setSelected(next);
          }}>
            {k === "US" ? "US" : k === "KR" ? "KR" : k === "ret" ? "Ret" : k === "etf" ? "ETF" : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {selected.size > 0 && shown.length > 0 && (() => {
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
          const [rg] = [show(r.total_gl, r)[0]];
          void rg;
          return (
          <button key={r.holding_id} className="row" onClick={() => onOpen(r.holding_id)}>
            <span>
              <span className="sym">{r.symbol}</span> <span className="sub">{r.nickname || r.name}</span><br />
              <span className="sub num">{r.kind === "cash" ? "cash balance" : r.kind === "debt" ? "debt balance" : `${r.qty ?? 0} ${r.kind === "crypto" ? r.symbol : "sh"}`}{ACCT[r.account] ? ` · ${ACCT[r.account]}` : ""}{r.kind === "cash" || r.kind === "debt" ? "" : ` · avg ${moneyExact(r.avg_cost, r.currency)}`}</span>
            </span>
            <span className="right">
              <span className="num">{r.kind === "debt" ? signedMoney(-(rv ?? 0), rc) : money(rv, rc)}</span><br />
              <span className={`num sub ${glClass(r.change_pct)}`}>{signedPct(r.change_pct)} today</span>
            </span>
          </button>
          );
        })}
        {shown.length === 0 && rows.length === 0 && (
          <div className="empty"><p style={{ marginBottom: 14 }}>No runners on the track.</p>
            <button className="btn" onClick={onAdd}>Add your first position</button></div>
        )}
        {shown.length === 0 && rows.length > 0 && <p className="empty">Nothing in this filter.</p>}
      </div>
    </>
  );
}
