import { useEffect, useRef, useState } from "react";
import type { Api, Investor, PortfolioRow, SymbolRow } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";
import { InvestorQuiz } from "../components/InvestorQuiz";
import { marketOf } from "../lib/markets";
import { openConnectPortal, platformTag } from "../lib/native";

// Setup: connect a brokerage (positions import in seconds) OR add the first
// position manually. After the OAuth return, this screen shows the live import
// and finishes onboarding in one tap — markets are inferred, never asked.
export function Onboarding({ api, onDone, snaptrade = null, onBookChanged }: {
  api: Api; onDone: () => Promise<void> | void; snaptrade?: string | null; onBookChanged?: () => void;
}) {
  const [step, setStep] = useState(1);
  // the 5-question tap quiz answered (or skipped) before holdings; a brokerage return skips straight to the import
  const [inv, setInv] = useState<Investor | null>(null);
  const [quizDone, setQuizDone] = useState(snaptrade === "connected");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [picked, setPicked] = useState<SymbolRow | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imported, setImported] = useState<PortfolioRow[] | null>(null);   // null = not polling
  const [importDone, setImportDone] = useState(false);
  const pollRef = useRef(0);

  // Returned from the brokerage OAuth: watch the import land, then offer one-tap finish.
  useEffect(() => {
    if (snaptrade !== "connected") return;
    setImported([]);
    let live = true;
    pollRef.current = 0;
    const tick = async () => {
      if (!live) return;
      pollRef.current += 1;
      try {
        const rows = (await api.getPortfolio()).filter((r) => !r.symbol.startsWith("$"));
        if (!live) return;
        if (rows.length > 0) {
          setImported((prev) => {
            // live ticker feed: rows land one by one; settle once the count stops growing
            if (prev && rows.length === prev.length && pollRef.current > 2) setImportDone(true);
            return rows;
          });
        }
      } catch { /* keep polling */ }
      if (pollRef.current < 16) setTimeout(tick, 1500);
      else if (live) setImportDone(true);   // give up waiting; they can continue anyway
    };
    void tick();
    return () => { live = false; };
  }, [api, snaptrade]);

  const marketsOf = (rows: PortfolioRow[]) => {
    const set = new Set<string>();
    for (const r of rows) {
      const m = marketOf({ symbol: r.symbol, kind: r.kind });
      set.add(m === "KR" ? "KR" : m === "CRYPTO" ? "Crypto" : "US");
    }
    return set.size ? [...set] : ["US"];
  };
  const finishImported = async () => {
    setBusy(true); setErr(null);
    try {
      await api.completeOnboarding(marketsOf(imported ?? []), "USD", inv ?? INVESTOR_DEFAULT);
      // the connect callback already queued the book-changed chain (sync -> news -> intelligence -> assessment)
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  };

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
      await api.completeOnboarding([m === "KR" ? "KR" : m === "CRYPTO" ? "Crypto" : "US"], "USD", inv ?? INVESTOR_DEFAULT);
      onBookChanged?.();   // same pipeline as a brokerage connect: intelligence + Portfolio Assessment within minutes
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally { setBusy(false); }
  };

  // The import panel replaces the choice once the user comes back connected.
  if (imported !== null) {
    const n = imported.length;
    return (
      <main className="screen" style={{ paddingTop: 28 }}>
        <h1 className="h1">Set up Assetly</h1>
        <p className="mutedc" style={{ marginBottom: 18 }}>Brokerage connected</p>
        <div className="card" data-testid="ob-import">
          {!importDone && (<>
            <p style={{ margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><span className="progress-dot" aria-hidden="true" />Importing your positions</p>
            <p className="sub" style={{ margin: "6px 0 0" }}>
              {(imported?.length ?? 0) > 0
                ? `Found so far: ${imported!.slice(-4).map((r) => r.symbol).join(" · ")}${imported!.length > 4 ? ` (+${imported!.length - 4} more)` : ""}`
                : "Shares and cost basis are landing now. This usually takes a few seconds."}
            </p>
          </>)}
          {importDone && n > 0 && (<>
            <p style={{ margin: 0, fontWeight: 600, color: "var(--as-gain)" }}>✓ Imported {n} position{n === 1 ? "" : "s"}</p>
            <p className="sub" style={{ margin: "6px 0 0" }}>
              {imported.slice(0, 4).map((r) => r.symbol).join(" · ")}{n > 4 ? ` · +${n - 4} more` : ""}
            </p>
          </>)}
          {importDone && n === 0 && (<>
            <p style={{ margin: 0, fontWeight: 600 }}>Connected — the import is still running</p>
            <p className="sub" style={{ margin: "6px 0 0" }}>Your positions will appear on Home in a minute. You can continue now.</p>
          </>)}
        </div>
        {err && <div className="error-note" role="alert">{err}</div>}
        <button className="btn" disabled={busy || (!importDone && true)} onClick={finishImported} style={{ marginTop: 14 }}>
          {busy ? "Finishing…" : "Continue"}
        </button>
      </main>
    );
  }

  if (!quizDone) {
    return (
      <main className="screen" style={{ paddingTop: 28 }}>
        <h1 className="h1">Set up Assetly</h1>
        <p className="mutedc" style={{ marginBottom: 18 }}>30 seconds, all taps — it shapes every insight you get</p>
        <InvestorQuiz
          onDone={(v) => { setInv(v); setQuizDone(true); }}
          onSkip={() => { setInv(INVESTOR_DEFAULT); setQuizDone(true); }} />
      </main>
    );
  }

  return (
    <main className="screen" style={{ paddingTop: 28 }}>
      <h1 className="h1">Set up Assetly</h1>
      <p className="mutedc" style={{ marginBottom: 18 }}>Step {step + 1} of 3</p>

      {step === 1 && (
        <section aria-label="Add your holdings">
          <button className="btn" data-testid="ob-connect" disabled={busy} onClick={async () => {
            setErr(null); setBusy(true);
            try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not start the brokerage link."); setBusy(false); }
          }}>⚡ Connect your brokerage</button>
          <p className="mutedc" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>
            Robinhood, Fidelity, Schwab, and more. Positions and cost basis import in seconds.
            Read-only — Assetly can never trade or move money.
          </p>
          {snaptrade && snaptrade !== "connected" && (
            <div className="error-note" role="alert" style={{ marginTop: 10 }}>
              {snaptrade === "denied" ? "The brokerage link was declined. You can try again or add positions manually." : "The brokerage link didn't complete. Try again or add positions manually."}
            </div>
          )}
          <p className="mutedc" style={{ textAlign: "center", margin: "16px 0 10px", fontSize: 12.5, textTransform: "uppercase", letterSpacing: 1 }}>
            or add one manually
          </p>
          <div className="field">
            <label htmlFor="ob-q">Find your first position</label>
            <input id="ob-q" value={q} onChange={(e) => search(e.target.value)} placeholder="Ticker or name — try FIG or Samsung" />
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
