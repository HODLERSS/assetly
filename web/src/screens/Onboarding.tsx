import { useState } from "react";
import type { Api, SymbolRow } from "../lib/api";

// Canvas 3b→3f: markets → first position → shares + cost → first real number.
export function Onboarding({ api, onDone }: { api: Api; onDone: () => Promise<void> | void }) {
  const [step, setStep] = useState(0);
  const [markets, setMarkets] = useState<string[]>(["US"]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (m: string) =>
    setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

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
      await api.completeOnboarding(markets, markets.includes("KR") && !markets.includes("US") ? "KRW" : "USD");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <main className="screen" style={{ paddingTop: 28 }}>
      <h1 className="h1">Set up Assetly</h1>
      <p className="mutedc" style={{ marginBottom: 18 }}>Step {step + 1} of 3</p>

      {step === 0 && (
        <section aria-label="Pick your markets">
          <p style={{ marginBottom: 12 }}>Where do you hold? This sets currency and feeds.</p>
          <div className="chips">
            {["US", "KR", "Crypto"].map((m) => (
              <button key={m} className="chip" aria-pressed={markets.includes(m)} onClick={() => toggle(m)}>
                {m === "US" ? "US markets" : m === "KR" ? "Korea (KRX)" : "Crypto"}
              </button>
            ))}
          </div>
          <button className="btn" disabled={markets.length === 0} onClick={() => setStep(1)} style={{ marginTop: 16 }}>Next</button>
        </section>
      )}

      {step === 1 && (
        <section aria-label="Find your first position">
          <div className="field">
            <label htmlFor="ob-q">Find your first position</label>
            <input id="ob-q" value={q} onChange={(e) => search(e.target.value)} placeholder="Ticker or name — try MARA, 삼성" autoFocus />
          </div>
          <div className="card">
            {results.map((r) => (
              <button key={r.symbol} className="row" onClick={() => { setPicked(r); setStep(2); }}>
                <span><span className="sym">{r.symbol}</span> <span className="sub">{r.name}</span></span>
                <span className="sub">{r.exchange}</span>
              </button>
            ))}
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
