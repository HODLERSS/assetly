import { useState } from "react";
import type { Api, SymbolRow } from "../lib/api";
import { marketOf } from "../lib/markets";

// Canvas 3b→3f: markets → first position → shares + cost → first real number.
export function Onboarding({ api, onDone }: { api: Api; onDone: () => Promise<void> | void }) {
  const [step, setStep] = useState(1);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 1) { setResults([]); return; }
    try { setResults(await api.searchSymbols(text.trim())); } catch { setResults([]); }
  };

  const finish = async () => {
    setBusy(true); setErr(null);
    try {
      const nQty = parseFloat(qty), nCost = parseFloat(cost);
      if (!picked || !(nQty > 0) || !(nCost >= 0)) throw new Error("Shares must be positive and cost can't be negative.");
      await api.addPosition(picked.symbol, nQty, nCost);
      void api.refreshNews([picked.symbol]);                // stories land while the user looks around
      const m = marketOf({ symbol: picked.symbol, kind: picked.kind });   // inferred, never asked
      await api.completeOnboarding([m === "KR" ? "KR" : m === "CRYPTO" ? "Crypto" : "US"], "USD");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <main className="screen" style={{ paddingTop: 28 }}>
      <h1 className="h1">Set up Assetly</h1>
      <p className="mutedc" style={{ marginBottom: 18 }}>Step {step} of 2</p>

      {step === 1 && (
        <section aria-label="Find your first position">
          <div className="field">
            <label htmlFor="ob-q">Find your first position</label>
            <input id="ob-q" value={q} onChange={(e) => search(e.target.value)} placeholder="Ticker or name — try FIG or Samsung" autoFocus />
          </div>
          <div className="card">
            {results.map((r) => (
              <button key={r.symbol} className="row" disabled={busy} onClick={async () => {
                setErr(null); setBusy(true);
                try { await api.ensureSymbol(r); setPicked(r); setStep(2); }
                catch (e) { setErr(e instanceof Error ? e.message : "Could not add that ticker."); }
                finally { setBusy(false); }
              }}>
                <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
                <span className="sub">{r.exchange}</span>
              </button>
            ))}
            {busy && <p className="empty">Adding to Assetly…</p>}
            {err && <div className="error-note" role="alert">{err}</div>}
            {q && results.length === 0 && <p className="empty">Nothing matched “{q}”.</p>}
          </div>
        </section>
      )}

      {step === 2 && picked && (
        <section aria-label="Shares and cost">
          <p style={{ marginBottom: 12 }}><span className="sym">{picked.symbol}</span> · {picked.name}</p>
          <div className="field">
            <label htmlFor="ob-qty">Shares</label>
            <input id="ob-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="10" />
          </div>
          <div className="field">
            <label htmlFor="ob-cost">Cost per share ({picked.currency === "KRW" ? "₩" : "$"})</label>
            <input id="ob-cost" className="num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="166.55" />
          </div>
          <p className="mutedc" style={{ fontSize: 12.5, marginBottom: 12 }}>Purchase date is optional — add it later from the position.</p>
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={finish}>{busy ? "Saving…" : "Add position"}</button>
        </section>
      )}
    </main>
  );
}
