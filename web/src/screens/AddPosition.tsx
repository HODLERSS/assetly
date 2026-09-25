import { openConnectPortal, platformTag } from "../lib/native";
import { useState } from "react";
import type { Account, Api, SymbolRow } from "../lib/api";
import { InsightsCard } from "../components/InsightsCard";
import { Icon } from "../components/Icon";
import { AmountField, EntryPreview } from "../components/AmountField";
import { ACCOUNTS, accountLabel, defaultAccount } from "../lib/accounts";
import { entryPreview, readAmount } from "../lib/numbers";
import { ccySymbol } from "../lib/format";
import { useSymbolSearch } from "../lib/search";

// Canvas 3c/3d applied post-onboarding: search, then the two required fields.
// Serial adds: after each save the form resets for the next ticker while the
// just-added stock's intelligence card fades in right below the search. Each add is
// reported via onAdded; the app coalesces a run of adds into ONE book-changed pipeline
// (news -> intelligence -> Portfolio Assessment), the same chain a brokerage connect runs.
export function AddPosition({ api, onDone, onRefresh, onCancel, onAdded, baseCurrency = "USD" }: {
  api: Api; onDone: () => Promise<void> | void; onRefresh: () => Promise<void> | void; onCancel: () => void; onAdded?: () => void;
  baseCurrency?: string;
}) {
  const [added, setAdded] = useState<string[]>([]);          // newest first, this session
  const { q, setQ, results, error: searchErr, searching, reset: resetSearch } = useSymbolSearch(api, { preferCcy: baseCurrency });
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState("");
  const [account, setAccount] = useState<Account>("brokerage");
  const [ccy, setCcy] = useState("USD");   // cash/debt only: the balance's currency
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ qty?: string; cost?: string }>({});

  // Everything about the form is derived from what was picked, never inherited from the previous add:
  // a Cash add used to leave "Bank" selected, and the next stock saved into it.
  const pick = (r: SymbolRow | null) => {
    setPicked(r); setFieldErr({}); setErr(null);
    if (!r) return;
    setAccount(defaultAccount(r.kind));
    setCcy(r.currency || "USD");
  };

  const search = (text: string) => {
    setQ(text); setPicked(null);
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
            <input id="add-q" value={q} onChange={(e) => search(e.target.value)} placeholder="NVDA, Tesla, VOO, Bitcoin…" autoFocus />
          </div>
          <div className="card">
            {!q.trim() && (<>
              <button className="row" disabled={busy} data-testid="snaptrade-import" onClick={async () => {
                setErr(null); setBusy(true);
                try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); }
                catch (e) { setErr(e instanceof Error ? e.message : "Could not start the brokerage link."); setBusy(false); }
              }}>
                <span><span className="sym"><Icon name="bolt" size={13} /> Import</span> <span className="sub">Connect a brokerage, positions land in seconds</span></span>
                <span className="sub">→</span>
              </button>
              <button className="row" disabled={busy} onClick={() => pick({ symbol: "$CASH", name: "Cash (USD)", exchange: "CASH", currency: "USD", kind: "cash" })}>
                <span><span className="sym">CASH</span> <span className="sub">Add a cash balance</span></span>
                <span className="sub">$</span>
              </button>
              <button className="row" disabled={busy} onClick={() => pick({ symbol: "$DEBT", name: "Debt (USD)", exchange: "DEBT", currency: "USD", kind: "debt" })}>
                <span><span className="sym">DEBT</span> <span className="sub">Add a loan or debt balance</span></span>
                <span className="sub">−$</span>
              </button>
            </>)}
            {results.map((r) => (
              <button key={r.symbol} className="row" disabled={busy} onClick={async () => {
                setErr(null); setBusy(true);
                try {
                  await api.ensureSymbol(r);
                  pick(r);
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
            {searchErr && <div className="error-note" role="alert">{searchErr}</div>}
            {q.trim() && !searching && !searchErr && results.length === 0 && <p className="empty">No match for “{q.trim()}”. Try a ticker (AAPL) or a company name.</p>}
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
            <button className="chip" style={{ marginLeft: 10 }} onClick={() => pick(null)}>Change</button></p>
          <div className="field">
            <label>Account</label>
            <div className="chips" style={{ padding: 0 }} role="group" aria-label="Account">
              {ACCOUNTS.map((a) => (
                <button key={a} className="chip" aria-pressed={account === a} onClick={() => setAccount(a)}>{accountLabel(a)}</button>
              ))}
            </div>
          </div>
          {picked.kind === "cash" || picked.kind === "debt" ? (<>
            <div className="field">
              <label>Currency</label>
              <div className="chips" style={{ padding: 0 }} role="group" aria-label="Currency">
                {[...new Set(["USD", "KRW", ccy])].map((c) => (
                  <button key={c} className="chip" aria-pressed={ccy === c} onClick={() => setCcy(c)}>
                    {`${ccySymbol(c).trim()} ${c}`}
                  </button>
                ))}
              </div>
            </div>
            <AmountField id="add-qty" label={`${picked.kind === "debt" ? "Amount owed" : "Amount"} (${ccySymbol(ccy).trim()})`}
              value={qty} onChange={(v) => { setQty(v); setFieldErr((f) => ({ ...f, qty: undefined })); }} error={fieldErr.qty} autoFocus />
            <div className="field"><label htmlFor="add-label">Label (optional)</label>
              <input id="add-label" value={label} onChange={(e) => setLabel(e.target.value)}
                     placeholder={picked.kind === "debt" ? "e.g. Car loan" : "e.g. Emergency fund"} /></div>
          </>) : (<>
          <AmountField id="add-qty" label={picked.kind === "crypto" ? "Quantity" : "Shares"} value={qty}
            onChange={(v) => { setQty(v); setFieldErr((f) => ({ ...f, qty: undefined })); }} error={fieldErr.qty} autoFocus />
          <AmountField id="add-cost" label={`Cost per ${picked.kind === "crypto" ? "coin" : "share"} (${ccySymbol(picked.currency).trim()})`} value={cost}
            onChange={(v) => { setCost(v); setFieldErr((f) => ({ ...f, cost: undefined })); }} error={fieldErr.cost} placeholder="What you paid" />
          <div className="field"><label htmlFor="add-date">Purchase date (optional)</label>
            <input id="add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </>)}
          <EntryPreview text={entryPreview({ kind: picked.kind, qty, cost, currency: picked.kind === "cash" || picked.kind === "debt" ? ccy : picked.currency,
            unit: picked.kind === "crypto" ? picked.symbol : undefined })} />
          <div className="field"><label htmlFor="add-note">Note (optional)</label>
            <input id="add-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Earnings dip buy" /></div>
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={async () => {
            const isCash = picked.kind === "cash" || picked.kind === "debt";
            const q = readAmount(qty, isCash ? (picked.kind === "debt" ? "debt" : "cash") : picked.kind === "crypto" ? "units" : "shares");
            const c = isCash ? { value: 1, error: null } : readAmount(cost, "cost");
            setFieldErr({ qty: q.error ?? undefined, cost: c.error ?? undefined });
            if (q.value === null || c.value === null) return;
            const nq = q.value, nc = c.value;
            setBusy(true); setErr(null);
            // cash rows are "$CASH" in dollars and "$CASH.<CCY>" otherwise ("$CASH.KRW"), whichever row was picked
            const root = picked.symbol.split(".")[0];
            const sym = isCash ? (ccy === "USD" ? root : `${root}.${ccy}`) : picked.symbol;
            try {
              await api.addPosition(sym, nq, nc, date || undefined, account, isCash ? label.trim() : "", note.trim());
              if (!sym.startsWith("$")) void api.warmup(sym);   // first-look intelligence, fire-and-forget
              if (!isCash) void api.refreshNews([picked.symbol]);        // stories land while the user looks around
              onAdded?.();                                               // the app batches this run of adds into one pipeline (intelligence + assessment)
              await onRefresh();
              // stay here for the next add; the fresh card renders below the search
              setAdded((a) => [sym, ...a]);
              pick(null); setQty(""); setCost(""); setDate(""); setLabel(""); setNote(""); resetSearch();
              setAccount("brokerage"); setCcy("USD");
            }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not add position."); }
            finally { setBusy(false); }
          }}>{busy ? "Adding…" : "Add position"}</button>
        </>
      )}
    </>
  );
}
