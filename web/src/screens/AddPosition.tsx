import { useState } from "react";
import type { Account, Api, SymbolRow } from "../lib/api";

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
  const [account, setAccount] = useState<Account>("brokerage");
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
            <input id="add-q" value={q} onChange={(e) => search(e.target.value)} placeholder="FIG, Reddit, Samsung…" autoFocus />
          </div>
          <div className="card">
            {!q.trim() && (
              <button className="row" disabled={busy} onClick={() => setPicked({ symbol: "CASH", name: "Cash (USD)", exchange: "CASH", currency: "USD", kind: "cash" })}>
                <span><span className="sym">CASH</span> <span className="sub">Add a cash balance</span></span>
                <span className="sub">$</span>
              </button>
            )}
            {results.map((r) => (
              <button key={r.symbol} className="row" disabled={busy} onClick={async () => {
                setErr(null); setBusy(true);
                try { await api.ensureSymbol(r); setPicked(r); }
                catch (e) { setErr(e instanceof Error ? e.message : "Could not add that ticker."); }
                finally { setBusy(false); }
              }}>
                <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
                <span className="sub">{r.exchange}</span>
              </button>
            ))}
            {busy && <p className="empty">Adding to Assetly…</p>}
            {err && <div className="error-note" role="alert">{err}</div>}
            {q && results.length === 0 && <p className="empty">Nothing matched “{q}” — any US or Korean listing should appear as you type.</p>}
          </div>
        </>
      )}
      {picked && (
        <>
          <p style={{ marginBottom: 12 }}><span className="sym">{picked.symbol}</span> · {picked.name}
            <button className="chip" style={{ marginLeft: 10 }} onClick={() => setPicked(null)}>Change</button></p>
          <div className="field">
            <label>Account</label>
            <div className="chips" style={{ padding: 0 }} role="group" aria-label="Account">
              {(["brokerage", "401k", "ira"] as Account[]).map((a) => (
                <button key={a} className="chip" aria-pressed={account === a} onClick={() => setAccount(a)}>
                  {a === "brokerage" ? "Brokerage" : a === "401k" ? "401k" : "IRA"}
                </button>
              ))}
            </div>
          </div>
          {picked.kind === "cash" ? (
            <div className="field"><label htmlFor="add-qty">Amount ($)</label>
              <input id="add-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
          ) : (<>
          <div className="field"><label htmlFor="add-qty">Shares</label>
            <input id="add-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="add-cost">Cost per share ({picked.currency === "KRW" ? "₩" : "$"})</label>
            <input id="add-cost" className="num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="field"><label htmlFor="add-date">Purchase date (optional)</label>
            <input id="add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </>)}
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={async () => {
            const isCash = picked.kind === "cash";
            const nq = parseFloat(qty), nc = isCash ? 1 : parseFloat(cost);
            if (!(nq > 0)) { setErr(isCash ? "Amount must be positive." : "Shares must be positive."); return; }
            if (!(nc >= 0)) { setErr("Cost can't be negative."); return; }
            setBusy(true); setErr(null);
            try {
              await api.addPosition(picked.symbol, nq, nc, date || undefined, account);
              void api.refreshNews([picked.symbol]);        // stories land while the user looks around
              await onDone();
            }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not add position."); }
            finally { setBusy(false); }
          }}>{busy ? "Adding…" : "Add position"}</button>
        </>
      )}
    </>
  );
}
