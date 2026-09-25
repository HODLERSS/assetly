import { useEffect, useRef, useState } from "react";
import type { Api, Investor, PortfolioRow, SymbolRow } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";
import { InvestorQuiz } from "../components/InvestorQuiz";
import { marketOf } from "../lib/markets";
import { openConnectPortal, platformTag } from "../lib/native";
import { Icon } from "../components/Icon";
import { AmountField, EntryPreview } from "../components/AmountField";
import { entryPreview, readAmount } from "../lib/numbers";
import { ccySymbol } from "../lib/format";
import { useSymbolSearch } from "../lib/search";

// Long enough for a slow phone network, short enough that nobody thinks the app has died.
const SETUP_TIMEOUT_MS = 12000;

// Setup survives a reload and the round trip through the brokerage portal (on the web that is a full
// page load): quiz answers, where the reader was, and a half-filled first position. Before this, backing
// out of the portal meant answering six questions again, and a connected return saved default answers.
const OB_KEY = "assetly-onboarding";
type ObSaved = { draft?: Investor; qi?: number; inv?: Investor | null; quizDone?: boolean; step?: number; picked?: SymbolRow | null; qty?: string; cost?: string };
function readOb(): ObSaved {
  try { return JSON.parse(sessionStorage.getItem(OB_KEY) ?? "{}") as ObSaved; } catch { return {}; }
}
function writeOb(v: ObSaved) { try { sessionStorage.setItem(OB_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } }
export function clearOnboardingDraft() { try { sessionStorage.removeItem(OB_KEY); } catch { /* storage unavailable */ } }

// Setup: connect a brokerage (positions import in seconds) OR add the first
// position manually. After the OAuth return, this screen shows the live import
// and finishes onboarding in one tap — markets are inferred, never asked.
export function Onboarding({ api, onDone, snaptrade = null, onBookChanged }: {
  api: Api; onDone: () => Promise<void> | void; snaptrade?: string | null; onBookChanged?: () => void;
}) {
  const [saved] = useState(readOb);
  const [step, setStep] = useState(saved.step === 2 && saved.picked ? 2 : 1);
  // the six-question tap quiz answered (or skipped) before holdings; a brokerage return skips straight to the import
  const [inv, setInv] = useState<Investor | null>(saved.inv ?? null);
  const [quizDone, setQuizDone] = useState(snaptrade === "connected" || !!saved.quizDone);
  const [draft, setDraft] = useState<{ raw: Investor; i: number } | null>(saved.draft ? { raw: saved.draft, i: saved.qi ?? 0 } : null);
  // the first position is a holding with shares and a cost: cash/debt rows go through Add position later
  const { q, setQ, results, error: searchErr, searching } = useSymbolSearch(api, { filter: (r) => r.kind !== "cash" && r.kind !== "debt" });
  const [picked, setPicked] = useState<SymbolRow | null>(saved.picked ?? null);
  const [qty, setQty] = useState(saved.qty ?? "");
  const [cost, setCost] = useState(saved.cost ?? "");
  useEffect(() => {
    writeOb({ draft: draft?.raw, qi: draft?.i, inv, quizDone, step, picked, qty, cost });
  }, [draft, inv, quizDone, step, picked, qty, cost]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ qty?: string; cost?: string }>({});
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
      await guard(api.completeOnboarding(marketsOf(imported ?? []), "USD", inv ?? INVESTOR_DEFAULT));
      clearOnboardingDraft();
      // the connect callback already queued the book-changed chain (sync -> news -> intelligence -> assessment)
      await guard(Promise.resolve(onDone()));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  };

  // Setup must never trap anyone. App Review got stuck here on "Finishing…" when the call behind the
  // Continue button never settled (Guideline 2.1(a), 2026-09-21), so every await on this screen is
  // bounded: worst case the user sees an error and can press the button again, or skip past it.
  const guard = <T,>(p: Promise<T>): Promise<T> => Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("That took too long. Check your connection and try again — or skip and add holdings later.")), SETUP_TIMEOUT_MS)),
  ]);

  /** Leave setup with nothing in the book: Home's empty state offers connect and manual add. */
  const skipForNow = async () => {
    setBusy(true); setErr(null);
    try {
      await guard(api.completeOnboarding(["US"], "USD", inv ?? INVESTOR_DEFAULT));
      clearOnboardingDraft();
      await guard(Promise.resolve(onDone()));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  };


  const finish = async () => {
    if (!picked) return;
    const q = readAmount(qty, picked.kind === "crypto" ? "units" : "shares"), c = readAmount(cost, "cost");
    setFieldErr({ qty: q.error ?? undefined, cost: c.error ?? undefined });
    if (q.value === null || c.value === null) return;
    setBusy(true); setErr(null);
    try {
      await api.addPosition(picked.symbol, q.value, c.value);
      void api.refreshNews([picked.symbol]);                // stories land while the user looks around
      const m = marketOf({ symbol: picked.symbol, kind: picked.kind });   // inferred, never asked
      await api.completeOnboarding([m === "KR" ? "KR" : m === "CRYPTO" ? "Crypto" : "US"], "USD", inv ?? INVESTOR_DEFAULT);
      clearOnboardingDraft();
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
            <p style={{ margin: 0, fontWeight: 600, color: "var(--as-gain)" }}><Icon name="check" /> Imported {n} position{n === 1 ? "" : "s"}</p>
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
        <button className="btn" disabled={busy || !importDone} onClick={finishImported} style={{ marginTop: 14 }}>
          {busy ? "Finishing…" : "Continue"}
        </button>
        {err && (
          <button className="linky" data-testid="ob-skip-import" disabled={busy} onClick={skipForNow} style={{ marginTop: 6 }}>
            Skip for now — your positions are already imported
          </button>
        )}
      </main>
    );
  }

  if (!quizDone) {
    return (
      <main className="screen" style={{ paddingTop: 28 }}>
        <h1 className="h1">Set up Assetly</h1>
        <p className="mutedc" style={{ marginBottom: 18 }} data-testid="ob-step">Step 1 of 3 · About a minute, all taps. It shapes every insight you get.</p>
        <InvestorQuiz draft={draft?.raw} startAt={draft?.i ?? 0}
          onProgress={(raw, i) => setDraft({ raw, i })}
          onDone={(v) => { setInv(v); setQuizDone(true); }}
          onSkip={(v) => { setInv(v); setQuizDone(true); }} />
      </main>
    );
  }

  return (
    <main className="screen" style={{ paddingTop: 28 }}>
      <h1 className="h1">Set up Assetly</h1>
      <p className="mutedc" style={{ marginBottom: 18 }} data-testid="ob-step">Step {step + 1} of 3</p>

      {step === 1 && (
        <section aria-label="Add your holdings">
          <button className="btn" data-testid="ob-connect" disabled={busy} onClick={async () => {
            setErr(null); setBusy(true);
            try {
              const r = await guard(api.snaptrade("connect", { platform: platformTag() }));
              if (!r.url) throw new Error("The brokerage link didn't come back. Try again.");
              await openConnectPortal(r.url);
            } catch (e) { setErr(e instanceof Error ? e.message : "Could not start the brokerage link."); }
            finally { setBusy(false); }   // without this the screen stays disabled forever
          }}><Icon name="bolt" /> Connect your brokerage</button>
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
            <input id="ob-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name — try NVDA or Tesla"
                   autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="search" />
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
            {searchErr && <div className="error-note" role="alert">{searchErr}</div>}
            {q.trim() && !searching && !searchErr && results.length === 0 && <p className="empty">No match for “{q.trim()}”. Try a ticker (AAPL) or a company name.</p>}
          </div>
          <button className="linky" data-testid="ob-skip" disabled={busy} onClick={skipForNow} style={{ marginTop: 6 }}>
            Skip for now — add holdings later
          </button>
          <button className="chip" disabled={busy} onClick={() => setQuizDone(false)} style={{ marginTop: 6 }}>← Back</button>
        </section>
      )}

      {step === 2 && picked && (
        <section aria-label="Shares and cost">
          <p style={{ marginBottom: 12 }}><span className="sym">{picked.symbol}</span> · {picked.name}
            <button className="chip" style={{ marginLeft: 10 }} disabled={busy} onClick={() => { setStep(1); setPicked(null); setFieldErr({}); setErr(null); }}>Change</button></p>
          <AmountField id="ob-qty" label={picked.kind === "crypto" ? "Quantity" : "Shares"} value={qty} placeholder="e.g. 10"
            onChange={(v) => { setQty(v); setFieldErr((f) => ({ ...f, qty: undefined })); }} error={fieldErr.qty} />
          <AmountField id="ob-cost" label={`Cost per ${picked.kind === "crypto" ? "coin" : "share"} (${ccySymbol(picked.currency).trim()})`} value={cost}
            placeholder="What you paid" onChange={(v) => { setCost(v); setFieldErr((f) => ({ ...f, cost: undefined })); }} error={fieldErr.cost} />
          <EntryPreview text={entryPreview({ kind: picked.kind, qty, cost, currency: picked.currency, unit: picked.kind === "crypto" ? picked.symbol : undefined })} />
          <p className="mutedc" style={{ fontSize: 12.5, marginBottom: 12 }}>Don't know your cost? Use today's price and fix it later from the position. Purchase date is optional too.</p>
          {err && <div className="error-note" role="alert">{err}</div>}
          <button className="btn" disabled={busy} onClick={finish}>{busy ? "Saving…" : "Add position"}</button>
          <button className="chip" disabled={busy} onClick={() => { setStep(1); setFieldErr({}); setErr(null); }} style={{ marginTop: 10 }}>← Back</button>
        </section>
      )}
    </main>
  );
}
