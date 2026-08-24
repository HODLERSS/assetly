import { useState } from "react";
import type { Api, SymbolRow } from "../lib/api";

// Canvas 3c/3d applied post-onboarding: search, then the two required fields.
export function AddPosition({ api, onDone, onCancel }: {
  api: Api; onDone: () => Promise<void> | void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (text: string) => {
    setQ(text); setPicked(null);
    if (!text.trim()) { setResults([]); return; }
    try { setResults(await api.searchSymbols(text.trim())); } catch { setResults([]); }
  };

  return (
    <>
      <button className="chip" onClick={onCancel}>&larr; Cancel</button>
      <h2 className="h1" style={{ margin: "12px 0" }}>Add position</h2>
      {!picked && (
        <>
          <div className="field">
            <label htmlFor="add-q">Ticker or name</label>
            <input id="add-q" value={q} onChange={(e) => search(e.target.value)} placeholder="MARA, Reddit, 삼성…" autoFocus />
          </div>
          <div className="card">
            {results.map((r) => (
              <button key={r.symbol} className="row" onClick={() => setPicked(r)}>
                <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
                <span className="sub">{r.exchange}</span>
              </button>
            ))}
            {q && results.length === 0 && <p className="empty">Nothing matched “{q}”. The catalog grows — tell us what's missing.</p>}
          </div>
        </>
      )}
      {picked && (
        <>
          <p style={{ marginBottom: 12 }}><span className="sym">{picked.symbol}</span> · {picked.name}
            <button className="chip" style={{ marginLeft: 10 }} onClick={() => setPicked(null)}>Change</button></p>
          <div className="field"><label htmlFor="add-qty">Shares</label>
            <input id="add-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="add-cost">Cost per share ({picked.currency === "KRW" ? "₩" : "$"})</label>
            <input id="add-cost" className="num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="field"><label htmlFor="add-date">Purchase date (optional)</label>
            <input id="add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={async () => {
            const nq = parseFloat(qty), nc = parseFloat(cost);
            if (!(nq > 0)) { setErr("Shares must be positive."); return; }
            if (!(nc >= 0)) { setErr("Cost can't be negative."); return; }
            setBusy(true); setErr(null);
            try { await api.addPosition(picked.symbol, nq, nc, date || undefined); await onDone(); }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not add position."); }
            finally { setBusy(false); }
          }}>{busy ? "Adding…" : "Add position"}</button>
        </>
      )}
    </>
  );
}
