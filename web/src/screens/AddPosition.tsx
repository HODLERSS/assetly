import { useState } from "react";
import type { Account, Api, SymbolRow } from "../lib/api";
import { InsightsCard } from "../components/InsightsCard";
import { Icon } from "../components/Icon";

// Canvas 3c/3d applied post-onboarding: search, then the two required fields.
// Serial adds: after each save the form resets for the next ticker while the
// just-added stock's intelligence card fades in right below the search. Each add is
// reported via onAdded; the app coalesces a run of adds into ONE book-changed pipeline
// (news -> intelligence -> Portfolio Assessment), the same chain a brokerage connect runs.
export function AddPosition({ api, onDone, onRefresh, onCancel, onAdded }: {
  api: Api; onDone: () => Promise<void> | void; onRefresh: () => Promise<void> | void; onCancel: () => void; onAdded?: () => void;
}) {
  const [added, setAdded] = useState<string[]>([]);          // newest first, this session
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState("");
  const [account, setAccount] = useState<Account>("brokerage");
  const [ccy, setCcy] = useState<"USD" | "KRW">("USD");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (text: string) => {
    setQ(text); setPicked(null);
    if (!text.trim()) { setResults([]); return; }
    try { setResults(await api.searchSymbols(text.trim())); } catch { setResults([]); }
  };

  return (
    <>
      <button className="chip" onClick={() => (added.length ? void onDone() : onCancel())}>
        {added.length ? "\u2713 Done" : "\u2190 Cancel"}
      </button>
      <h2 className="h1" style={{ margin: "12px 0" }}>Add position</h2>
      {!picked && (
        <>
          <div className="field">
            <label htmlFor="add-q">Ticker or name</label>
            <input id="add-q" value={q} onChange={(e) => search(e.target.value)} placeholder="FIG, Reddit, Samsung…" autoFocus />
          </div>
          <div className="card">
            {!q.trim() && (<>
              <button className="row" disabled={busy} data-testid="snaptrade-import" onClick={async () => {
                setErr(null); setBusy(true);
                try { const r = await api.snaptrade("connect"); if (r.url) window.location.assign(r.url); }
                catch (e) { setErr(e instanceof Error ? e.message : "Could not start the brokerage link."); setBusy(false); }
              }}>
                <span><span className="sym"><Icon name="bolt" size={13} /> Import</span> <span className="sub">Connect a brokerage, positions land in seconds</span></span>
                <span className="sub">→</span>
              </button>
              <button className="row" disabled={busy} onClick={() => { setAccount("bank"); setPicked({ symbol: "$CASH", name: "Cash (USD)", exchange: "CASH", currency: "USD", kind: "cash" }); }}>
                <span><span className="sym">CASH</span> <span className="sub">Add a cash balance</span></span>
                <span className="sub">$</span>
              </button>
              <button className="row" disabled={busy} onClick={() => { setAccount("bank"); setPicked({ symbol: "$DEBT", name: "Debt (USD)", exchange: "DEBT", currency: "USD", kind: "debt" }); }}>
                <span><span className="sym">DEBT</span> <span className="sub">Add a loan or debt balance</span></span>
                <span className="sub">−$</span>
              </button>
            </>)}
            {results.map((r) => (
              <button key={r.symbol} className="row" disabled={busy} onClick={async () => {
                setErr(null); setBusy(true);
                try {
                  await api.ensureSymbol(r);
                  setPicked(r);
                  // head start: intelligence generates WHILE they type shares and cost
                  if (!r.symbol.startsWith("$")) void api.warmup(r.symbol);
                }
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
          {added.length > 0 && (
            <div data-testid="added-strip" style={{ marginTop: 14 }}>
              <p className="sub" style={{ margin: "0 2px 6px" }}>
                Added: {added.join(" · ")} — keep going, or tap <strong>Done</strong>.
              </p>
              {(() => { const latest = added.find((sy) => !sy.startsWith("$")); return latest ? <InsightsCard api={api} symbol={latest} /> : null; })()}
            </div>
          )}
        </>
      )}
      {picked && (
        <>
          <p style={{ marginBottom: 12 }}><span className="sym">{picked.symbol}</span> · {picked.name}
            <button className="chip" style={{ marginLeft: 10 }} onClick={() => setPicked(null)}>Change</button></p>
          <div className="field">
            <label>Account</label>
            <div className="chips" style={{ padding: 0 }} role="group" aria-label="Account">
              {(["brokerage", "bank", "401k", "ira", "crypto"] as Account[]).map((a) => (
                <button key={a} className="chip" aria-pressed={account === a} onClick={() => setAccount(a)}>
                  {a === "brokerage" ? "Brokerage" : a === "bank" ? "Bank" : a === "401k" ? "401k" : a === "ira" ? "IRA" : "Crypto"}
                </button>
              ))}
            </div>
          </div>
          {picked.kind === "cash" || picked.kind === "debt" ? (<>
            <div className="field">
              <label>Currency</label>
              <div className="chips" style={{ padding: 0 }} role="group" aria-label="Currency">
                {(["USD", "KRW"] as const).map((c) => (
                  <button key={c} className="chip" aria-pressed={ccy === c} onClick={() => setCcy(c)}>
                    {c === "USD" ? "$ USD" : "₩ KRW"}
                  </button>
                ))}
              </div>
            </div>
            <div className="field"><label htmlFor="add-qty">{picked.kind === "debt" ? `Amount owed (${ccy === "KRW" ? "₩" : "$"})` : `Amount (${ccy === "KRW" ? "₩" : "$"})`}</label>
              <input id="add-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
            <div className="field"><label htmlFor="add-label">Label (optional)</label>
              <input id="add-label" value={label} onChange={(e) => setLabel(e.target.value)}
                     placeholder={picked.kind === "debt" ? "e.g. Car loan" : "e.g. Cash (Yeonhwa)"} /></div>
          </>) : (<>
          <div className="field"><label htmlFor="add-qty">Shares</label>
            <input id="add-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="add-cost">Cost per share ({picked.currency === "KRW" ? "₩" : "$"})</label>
            <input id="add-cost" className="num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="field"><label htmlFor="add-date">Purchase date (optional)</label>
            <input id="add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </>)}
          <div className="field"><label htmlFor="add-note">Note (optional)</label>
            <input id="add-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Earnings dip buy" /></div>
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={async () => {
            const isCash = picked.kind === "cash" || picked.kind === "debt";
            const nq = parseFloat(qty), nc = isCash ? 1 : parseFloat(cost);
            if (!(nq > 0)) { setErr(isCash ? "Amount must be positive." : "Shares must be positive."); return; }
            if (!(nc >= 0)) { setErr("Cost can't be negative."); return; }
            setBusy(true); setErr(null);
            const sym = isCash && ccy === "KRW" ? `${picked.symbol}.KRW` : picked.symbol;
            try {
              await api.addPosition(sym, nq, nc, date || undefined, account, isCash ? label.trim() : "", note.trim());
              if (!sym.startsWith("$")) void api.warmup(sym);   // first-look intelligence, fire-and-forget
              if (!isCash) void api.refreshNews([picked.symbol]);        // stories land while the user looks around
              onAdded?.();                                               // the app batches this run of adds into one pipeline (intelligence + assessment)
              await onRefresh();
              // stay here for the next add; the fresh card renders below the search
              setAdded((a) => [sym, ...a]);
              setPicked(null); setQty(""); setCost(""); setDate(""); setLabel(""); setNote(""); setQ(""); setResults([]);
            }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not add position."); }
            finally { setBusy(false); }
          }}>{busy ? "Adding…" : "Add position"}</button>
        </>
      )}
    </>
  );
}
