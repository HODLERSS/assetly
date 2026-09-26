import { useEffect, useState } from "react";
import type { Account, Api, Lot, PortfolioRow } from "../lib/api";
import { mutatedSince, mutationMark } from "../lib/mutations";
import { sinceBuyLabel } from "../lib/portfolio";
import { ccySymbol, displayName, formatDate, glClass, labelParts, marketClock, money, moneyExact, priceAsOf, qtyUnit, signedMoney, signedPct } from "../lib/format";
import { ACCOUNTS, accountHeading, accountLabel, shownAccount } from "../lib/accounts";
import { isMarketOpen, marketOf, moveSession } from "../lib/markets";
import { entryPreview, formatAmountInput, formatQty, readAmount } from "../lib/numbers";
import { useInFlight } from "../lib/inflight";
import { PriceChart } from "../components/PriceChart";
import { InsightsCard } from "../components/InsightsCard";
import { Icon } from "../components/Icon";
import { AmountField, DateField, EntryPreview } from "../components/AmountField";
import { onForeground } from "../lib/native";

// Each position's lots as last read this session: offline, a position shows the lots it had instead of none.
import { lotsFor } from "../lib/lotsCache";

/** A failed write, said in words the user can act on. supabase-js rejects with a PostgrestError (not an Error)
 *  whose message is the browser's "Load failed" / "The network connection was lost": the merge that died on a
 *  dropped connection read "Could not change the account." with no hint why (r4 power-user). */
export function writeError(e: unknown, fallback: string): string {
  const msg = typeof (e as { message?: unknown } | null)?.message === "string" ? (e as { message: string }).message : "";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || /load failed|failed to fetch|network|timed out|internet connection/i.test(msg)) {
    return `${fallback.replace(/\.$/, "")}: the connection dropped. Check it and try again.`;
  }
  return e instanceof Error && msg ? msg : fallback;
}

// Canvas 2c + 3i + the remove flow (gap screen g1): detail, every lot editable, delete with confirm.
// Every write here (save, delete, remove, change account) runs through one in-flight guard: a second tap
// while the first is out is ignored, and the button says what it is doing.
export function PositionScreen({ api, row, onChanged, onRemoved, onBack, onMoved, dispKr = "KRW", others = [], onNotice }: {
  api: Api; row: PortfolioRow | null; dispKr?: "USD" | "KRW";
  /** a short note of what a write actually did ("Lot deleted", "VOO removed"), shown by the app */
  onNotice?: (message: string) => void;
  /** the same symbol held in other accounts: moving into one of them merges, and asks first */
  others?: PortfolioRow[];
  onChanged: () => Promise<void> | void; onRemoved: () => Promise<void> | void; onBack: () => void;
  /** The position now lives under another holding id (moved into an account that already held it). */
  onMoved?: (holdingId: string) => Promise<void> | void;
}) {
  const [lots, setLots] = useState<Lot[]>(() => (row ? lotsFor(api).get(row.holding_id) : undefined) ?? []);
  const [lotsLoaded, setLotsLoaded] = useState(false);
  // a failed read is not an empty list: offline, "No lots yet." beside an average cost read as lost records,
  // and it stayed after reconnecting (r4 power-user M4)
  const [lotsFailed, setLotsFailed] = useState(false);
  const [lotsAttempt, setLotsAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);
  // For ~400ms after a lot sheet closes, the page's own "Remove position" takes no taps: it sits right under the
  // sheet's confirm button, and a fast second tap on "Delete lot" passed through to it (r10 native, data loss).
  const [tapGuard, setTapGuard] = useState(false);
  const closeSheet = () => {
    setEditing(null); setAdding(false);
    setTapGuard(true);
    setTimeout(() => setTapGuard(false), 400);
  };
  const [adding, setAdding] = useState(false);
  const [movingAcct, setMovingAcct] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, run] = useInFlight();
  const [busyWhat, setBusyWhat] = useState<"remove" | "import" | "move" | null>(null);
  const [mergeInto, setMergeInto] = useState<PortfolioRow | null>(null);   // the move waiting on "Merge?"

  const holdingId = row?.holding_id;
  useEffect(() => {
    let live = true;
    if (!holdingId) return;
    const memo = lotsFor(api).get(holdingId);
    setLots(memo ?? []);
    setLotsLoaded(!!memo);
    // a read that started before a lot was added, edited or deleted answers with the lots as they were: dropped
    // (a deleted lot came back for a moment on a slow backend; r8 power-user). The write's reload paints.
    const mark = mutationMark();
    api.getLots(holdingId)
      .then((l) => { if (live && !mutatedSince(mark)) { lotsFor(api).set(holdingId, l); setLots(l); setLotsLoaded(true); setLotsFailed(false); } })
      .catch(() => { if (live) setLotsFailed(true); });   // keep what is shown; with nothing shown, say so with Retry
    return () => { live = false; };
  }, [api, holdingId, lotsAttempt]);
  // back online, back in the foreground, or a fresh book after the price Retry: read the lots again
  const bookAt = row?.as_of;
  useEffect(() => {
    if (!lotsFailed) return;
    const again = () => setLotsAttempt((n) => n + 1);
    window.addEventListener("online", again);
    const off = onForeground(again);
    return () => { window.removeEventListener("online", again); off(); };
  }, [lotsFailed]);
  useEffect(() => { if (lotsFailed) setLotsAttempt((n) => n + 1); }, [bookAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return <p className="empty">Position not found. <button className="chip" onClick={onBack}>Back</button></p>;

  const reload = async () => {
    // the lots and the book (Avg cost, the totals) are read together: one after the other, Avg cost lagged the
    // lot list by ~2.5s on a slow link (r10 power-user). The lots paint once both are back.
    const mark = mutationMark();
    const [lotsRead] = await Promise.allSettled([api.getLots(row.holding_id), Promise.resolve().then(() => onChanged())]);
    if (lotsRead.status === "rejected") throw lotsRead.reason;
    if (!mutatedSince(mark)) {   // another write went out meanwhile: its own reload paints
      lotsFor(api).set(row.holding_id, lotsRead.value);
      setLots(lotsRead.value); setLotsLoaded(true); setLotsFailed(false);
    }
  };
  const cashish = row.kind === "cash" || row.kind === "debt";
  const name = displayName(row);
  // A synced row's account comes from the brokerage; moving it here would be undone by the next sync.
  const canMove = row.source !== "snaptrade";
  // Moving into an account that already holds this symbol folds the lots into that position. It used to
  // happen without a word (r2 + r3 power-user): now it asks first.
  const requestMove = async (a: Account) => {
    if (a === row.account) return;
    const target = others.find((o) => o.account === a && o.source !== "snaptrade");
    if (target) { setMergeInto(target); return; }
    await moveTo(a);
  };
  const moveTo = async (a: Account) => {
    if (a === row.account) return;
    setErr(null);
    try {
      const id = await api.setHoldingAccount(row.holding_id, a);
      if (id !== row.holding_id) await onMoved?.(id);
      else await reload();
    } catch (e) { setErr(writeError(e, "Could not change the account.")); }
  };
  const remove = (excludeToo: boolean) => run(async () => {
    setBusyWhat(excludeToo ? "import" : "remove");
    try {
      if (excludeToo) await api.excludeImport(row.symbol);
      await api.removeHolding(row.holding_id);
      await onRemoved();
    } catch (e) { setErr(writeError(e, "Could not remove.")); setConfirming(false); }
    finally { setBusyWhat(null); }
  });
  const qtyLabel = row.kind === "crypto" ? "Quantity" : "Shares";
  const session = moveSession(row);
  const mkt = marketOf(row);
  const closedNow = !!row.as_of && mkt !== null && mkt !== "CRYPTO" && !isMarketOpen(mkt);
  const sinceBuy = sinceBuyLabel(row);

  return (
    <>
      <button className="chip" onClick={onBack}>&larr; Home</button>
      <div style={{ margin: "12px 0 6px" }}>
        <h2 className="h1">{labelParts(row, dispKr === "KRW").main} <span className="mutedc" style={{ fontWeight: 400, fontSize: 15 }}>{labelParts(row, dispKr === "KRW").sub}</span></h2>
        {/* cash and debt lead with the balance: a "$1.00 price" and a 0.00% day move mean nothing for them */}
        <div className="net num" style={{ fontSize: 30 }} data-testid="position-headline">{cashish ? money(row.value, row.currency) : moneyExact(row.price, row.currency)}</div>
        {!cashish && (
          <div className={`num ${glClass(row.change_pct)}`}>
            {/* the session is dated in the market's own zone: a KRX close is "Wed close" in Seoul, not Pacific's Tuesday */}
            {/* after the close the price is the close: "4h ago" made it look stale; say when it closed (r9 designer) */}
            {/* every lot bought in this session: the move is from the buy, and says so (e2e p10) */}
            {sinceBuy
              ? `0.00% · ${sinceBuy}${closedNow ? ` · closed ${marketClock(row.as_of!, mkt)}` : ""}`
              : <>{signedPct(row.change_pct)} {session.today ? `today · ${closedNow ? `closed ${marketClock(row.as_of!, mkt)}` : priceAsOf(row.as_of)}` : `since last close · ${session.label}`}</>}
          </div>
        )}
      </div>

      <p className="sub" style={{ margin: "2px 0 0", display: "flex", alignItems: "center", gap: 8 }} data-testid="position-account">
        <span>{row.source === "snaptrade" && row.account_label ? row.account_label : accountHeading(row)}</span>
        {canMove && <button className="chip" onClick={() => setMovingAcct((v) => !v)} aria-expanded={movingAcct} disabled={busy}>
          {busyWhat === "move" ? "Moving…" : "Change"}</button>}
      </p>
      {movingAcct && canMove && (
        <div className="chips" style={{ padding: 0 }} role="group" aria-label="Move to account" aria-busy={busyWhat === "move"}>
          {ACCOUNTS.map((a) => (
            <button key={a} className="chip" aria-pressed={shownAccount(row) === a} disabled={busy} onClick={() => run(async () => {
              setBusyWhat("move");
              try { await requestMove(a); setMovingAcct(false); } finally { setBusyWhat(null); }
            })}>{accountLabel(a)}</button>
          ))}
        </div>
      )}
      {!cashish && <PriceChart api={api} symbol={row.symbol} currency={row.currency} livePrice={row.price} liveAsOf={row.as_of} avgCost={row.avg_cost} dayPct={row.change_pct} crypto={row.kind === "crypto"} />}

      {!cashish && <InsightsCard api={api} symbol={row.symbol} crypto={row.kind === "crypto"} />}

      {/* a balance says its amount once (the headline) and has one Edit: the tile, the Balance list and a second
          edit button repeated it four times (r3 newcomer) */}
      {cashish ? null : (
        <div className="card" style={{ padding: "12px 14px", margin: "12px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><span className="sub">{qtyLabel}</span><br /><span className="num">{formatQty(row.qty ?? 0)}</span></div>
          <div><span className="sub">Value</span><br /><span className="num">{money(row.value, row.currency)}</span></div>
          <div><span className="sub">Avg cost</span><br /><span className="num">{moneyExact(row.avg_cost, row.currency)}</span></div>
          <div><span className="sub">Total gain/loss</span><br /><span className={`num ${glClass(row.total_gl)}`}>{signedMoney(row.total_gl, row.currency)}</span></div>
        </div>
      )}

      {!(cashish && lots.length <= 1) && (<>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 className="h1" style={{ fontSize: 15 }}>{cashish ? "Balance" : "Lots"}</h3>
        {!cashish && <button className="chip" onClick={() => setAdding(true)}>+ Lot</button>}
      </div>
      <div className="card">
        {lots.map((l) => (
          <button key={l.id} className="row lot-row" onClick={() => setEditing(l)} aria-label={cashish ? `Edit ${money(l.qty, row.currency)}` : `Edit lot ${l.qty} ${row.kind === "crypto" ? qtyUnit(row) : "shares"}`}>
            {/* at 320 the date moves under the amount instead of squeezing between it and Edit (r11 designer) */}
            <span className="lot-main"><span className="num">{cashish ? money(l.qty, row.currency) : `${formatQty(l.qty)} ${qtyUnit(row)} @ ${moneyExact(l.cost_per_share, row.currency)}`}</span>
              {!cashish && <span className="sub lot-date-narrow" aria-hidden="true">{l.acquired_on ? formatDate(l.acquired_on) : "no date"}</span>}
              {l.note ? <span className="sub lot-note">{l.note}</span> : null}</span>
            <span className="lot-side">
              {!cashish && <span className="sub lot-date-wide" data-testid="lot-date">{l.acquired_on ? formatDate(l.acquired_on) : "no date"}</span>}
              <span className="edit-pill">Edit</span>
            </span>
          </button>
        ))}
        {lotsLoaded && lots.length === 0 && <p className="empty">No lots yet.</p>}
        {!lotsLoaded && lotsFailed && (
          <p className="empty" role="alert" data-testid="lots-error">
            Couldn't load your lots.{" "}
            <button className="chip" onClick={() => setLotsAttempt((n) => n + 1)}>Retry</button>
          </p>
        )}
        {!lotsLoaded && !lotsFailed && <div className="row" aria-busy="true" aria-label="Loading lots" style={{ minHeight: 76 }}><span className="sub">Loading lots…</span></div>}
      </div>
      </>)}
      {!cashish && <p className="mutedc" style={{ fontSize: 12.5, margin: "8px 0 16px" }}>{row.source === "snaptrade" ? <><Icon name="bolt" size={12} /> Synced from {row.account_label ?? "your brokerage"}. Shares and cost update automatically.</> : row.account_label ? `Imported from ${row.account_label} (no longer syncing). Average cost comes from your lots.` : "Average cost comes from your lots."}</p>}

      {err && <div className="error-note" role="alert">{err}</div>}
      {lots.length === 1 && (
        <button className="btn secondary" style={{ marginBottom: 8 }} onClick={() => setEditing(lots[0])}>
          {cashish ? "Edit amount" : "Edit position"}
        </button>
      )}
      <button className="btn danger-quiet" style={{ marginBottom: 20 }} disabled={tapGuard} data-testid="remove-position"
        onClick={() => { if (!tapGuard) setConfirming(true); }}>
        {row.kind === "cash" ? "Remove cash balance" : row.kind === "debt" ? "Remove debt" : "Remove position"}</button>

      {mergeInto && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Confirm merge">
          <div className="sheet" aria-busy={busy}>
            <h2>Merge into your {accountLabel(mergeInto.account)} {name} position?</h2>
            <p className="mutedc sheet-confirm">
              {`You already hold ${formatQty(mergeInto.qty ?? 0)} ${qtyUnit(row)} of ${name} in ${accountLabel(mergeInto.account)}. Moving these ${formatQty(row.qty ?? 0)} combines them into one position, with every lot kept.`}
            </p>
            <button className="btn" disabled={busy} data-testid="merge-confirm" onClick={() => run(async () => {
              setBusyWhat("move");
              try { await moveTo(mergeInto.account); setMergeInto(null); } finally { setBusyWhat(null); }
            })}>{busyWhat === "move" ? "Merging…" : "Merge"}</button>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setMergeInto(null)}>Keep separate</button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Confirm removal">
          <div className="sheet" aria-busy={busy}>
            <h2>Remove {name}?</h2>
            <p className="mutedc" style={{ marginBottom: 14 }}>
              {row.source === "snaptrade"
                ? `This position is synced from your brokerage. Removing it alone brings it back on the next sync.`
                : cashish
                  ? `This removes ${name} from your portfolio. You can add it back anytime.`
                  : `This removes ${name} and its ${!lotsLoaded ? "lots" : lots.length === 1 ? "lot" : `${lots.length} lots`}. You can add it back anytime.`}
            </p>
            {row.source === "snaptrade" && (
              <button className="btn danger" disabled={busy} onClick={() => remove(true)}>
                {busyWhat === "import" ? "Removing…" : "Remove and stop importing it"}</button>
            )}
            <button className="btn danger" style={row.source === "snaptrade" ? { marginTop: 8 } : undefined} disabled={busy} onClick={() => remove(false)}>
              {busyWhat === "remove" ? "Removing…" : row.source === "snaptrade" ? "Remove (returns on next sync)" : cashish ? "Remove" : "Remove position"}</button>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}

      {(editing || adding) && (
        <LotSheet
          currency={row.currency}
          cashish={cashish}
          crypto={row.kind === "crypto"}
          unit={qtyUnit(row)}
          name={name}
          lot={editing}
          holdingId={row.holding_id}
          lastLot={!!editing && lots.length === 1}
          account={editing && lots.length === 1 && canMove ? row.account : undefined}
          onClose={closeSheet}
          onSave={async (qty, cost, date, note, account) => {
            try {
              if (editing) await api.updateLot(editing.id, { qty, cost_per_share: cost, acquired_on: date || null, note: note || null });
              else await api.addLot(row.holding_id, qty, cost, date || undefined, note);
              closeSheet();
              if (account && account !== row.account) { await reload(); await requestMove(account); }
              else await reload();
            } catch (e) { setErr(writeError(e, "Could not save lot.")); }
          }}
          onDelete={editing ? async (target) => {
            // `target` was frozen when the confirm opened: a read that lands while it is open cannot change which
            // lot (or holding) this deletes. The lot leaves the list at once, so a ghost row can't be tapped again.
            setLots((ls) => ls.filter((l) => l.id !== target.lotId));
            try {
              // The holding goes only when the SERVER says this lot is its one lot, right now. A delete of a stale or
              // ghost lot, or a lot count read before another lot landed, used to turn "Delete lot" into "Remove
              // position" and wiped a 1,000-share VOO (r10 native, data loss).
              const now = await api.getLots(target.holdingId);
              // what actually happened is said after, in a short note: the server's lot list can differ from what
              // the confirm showed, and the outcome with it (r11 designer)
              if (now.length === 1 && now[0].id === target.lotId) {
                await api.removeHolding(target.holdingId); closeSheet();
                onNotice?.(`${name} removed`);
                await onRemoved(); return;
              }
              const exists = now.some((l) => l.id === target.lotId);
              if (exists) await api.deleteLot(target.lotId);
              closeSheet();
              onNotice?.(exists ? (cashish ? "Balance deleted" : "Lot deleted") : `That ${cashish ? "balance" : "lot"} was already gone. ${name} is unchanged.`);
              await reload();
            } catch (e) {
              setErr(writeError(e, "Could not delete lot."));
              void reload().catch(() => {});   // put back what is really there
            }
          } : undefined}
        />
      )}
    </>
  );
}

function LotSheet({ currency, cashish = false, crypto = false, unit = "coins", name, lot, holdingId, lastLot = false, account, onClose, onSave, onDelete }: {
  currency: string; cashish?: boolean; crypto?: boolean; name: string; lot: Lot | null; lastLot?: boolean;
  /** a coin's own unit ("ETH") for the echo */
  unit?: string;
  /** Present when this sheet edits the whole (single-lot) position: the account is editable here too. */
  account?: Account;
  onClose: () => void;
  onSave: (qty: number, cost: number, date: string, note: string, account?: Account) => Promise<void>;
  /** the holding the lot belongs to (frozen with the lot id when the delete confirm opens) */
  holdingId?: string;
  onDelete?: (target: { lotId: string; holdingId: string }) => Promise<void>;
}) {
  // prefilled the way the Add form shows a typed amount ("3,000", not "3000")
  const [qty, setQty] = useState(lot ? formatAmountInput(lot.qty) : "");
  const [cost, setCost] = useState(lot ? formatAmountInput(lot.cost_per_share) : "");
  const [date, setDate] = useState(lot?.acquired_on ?? "");
  const [note, setNote] = useState(lot?.note ?? "");
  const [acct, setAcct] = useState<Account | undefined>(account);
  const [fieldErr, setFieldErr] = useState<{ qty?: string; cost?: string }>({});
  // the delete confirm, with its target frozen as it opened: which lot, which holding, and whether it read as the
  // last lot. Nothing that lands while it is open (a fresh read, a ghost row) changes what the button does.
  const [confirmDelete, setConfirmDelete] = useState<{ lotId: string; holdingId: string; last: boolean } | null>(null);
  // the confirm's red button opens under the finger that just tapped "Delete this lot": it takes no taps for the
  // first 500ms, so a double tap cannot skip the confirmation (e2e p02 F1)
  const [confirmArmed, setConfirmArmed] = useState(false);
  useEffect(() => {
    if (!confirmDelete) { setConfirmArmed(false); return; }
    const t = setTimeout(() => setConfirmArmed(true), 500);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  const [busy, run] = useInFlight();
  const sym = ccySymbol(currency).trim();
  // the sheet names the position it edits ("Edit NVDA lot · 5 sh"): a trader juggling tickers could not tell which
  // one the sheet was for (e2e p02 F9)
  const sheetTitle = cashish
    ? (lot ? `Edit ${name} balance` : `Add ${name} balance`)
    : lot ? `Edit ${name} lot · ${formatQty(lot.qty)} ${unit}` : `Add ${name} lot`;

  if (confirmDelete && onDelete) {
    const last = confirmDelete.last;
    const target = { lotId: confirmDelete.lotId, holdingId: confirmDelete.holdingId };
    return (
      <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Confirm delete">
        <div className="sheet" aria-busy={busy}>
          <h2>{last ? `Remove ${name}?` : "Delete this lot?"}</h2>
          <p className="mutedc sheet-confirm">
            {last
              ? `This is the only ${cashish ? "balance" : "lot"}, so deleting it removes ${name} from your portfolio.`
              : "The position's shares and average cost update without it. This can't be undone."}
          </p>
          <button className="btn danger" disabled={busy || !confirmArmed} aria-disabled={!confirmArmed || undefined} data-testid="confirm-delete-lot" onClick={() => { if (confirmArmed) run(() => onDelete(target)); }}>
            {busy ? (last ? "Removing…" : "Deleting…") : last ? "Remove position" : "Delete lot"}</button>
          <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirmDelete(null)}>Keep it</button>
        </div>
      </div>
    );
  }
  const save = () => {
    const q = readAmount(qty, cashish ? "cash" : crypto ? "units" : "shares", currency);
    const c = cashish ? { value: 1, error: null } : readAmount(cost, "cost", currency);
    setFieldErr({ qty: q.error ?? undefined, cost: c.error ?? undefined });
    if (q.value === null || c.value === null) return;
    const qv = q.value, cv = c.value;
    void run(() => onSave(qv, cv, date, note, acct));
  };
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-label={sheetTitle}>
      <div className="sheet" aria-busy={busy}>
        {/* the decimal pad has no Done key and covered Cancel (r4 native m4): while the keyboard is up the sheet
            carries its own Done, pinned to the top of the (scrolling) sheet. Pointer-down keeps the field's focus
            from moving before the tap lands. */}
        <div className="sheet-kbbar">
          <button type="button" className="chip" data-testid="sheet-kb-done" onPointerDown={(e) => e.preventDefault()}
            onClick={() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); }}>Done</button>
        </div>
        <h2>{sheetTitle}</h2>
        <AmountField id="lot-qty" label={cashish ? `Amount (${sym})` : crypto ? "Quantity" : "Shares"} value={qty}
          onChange={(v) => { setQty(v); setFieldErr((f) => ({ ...f, qty: undefined })); }} error={fieldErr.qty} />
        {!cashish && (<>
        <AmountField id="lot-cost" label={`Cost per ${crypto ? "coin" : "share"} (${sym})`} value={cost}
          onChange={(v) => { setCost(v); setFieldErr((f) => ({ ...f, cost: undefined })); }} error={fieldErr.cost} />
        {/* never beside an error it contradicts */}
        {!fieldErr.qty && !fieldErr.cost && <EntryPreview text={entryPreview({ kind: cashish ? "cash" : "stock", qty, cost, currency, unit: crypto ? unit : undefined })} />}
        <DateField id="lot-date" label="Acquired (optional)" value={date} onChange={setDate} />
        </>)}
        {acct && (
          <div className="field">
            <label>Account</label>
            <div className="chips" style={{ padding: 0 }} role="group" aria-label="Account">
              {ACCOUNTS.map((a) => (
                <button key={a} type="button" className="chip" aria-pressed={acct === a} onClick={() => setAcct(a)}>{accountLabel(a)}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field"><label htmlFor="lot-note">Note (optional)</label>
          <input id="lot-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. DCA week 3" enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></div>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : lot ? "Save changes" : "Add lot"}</button>
        {onDelete && <button className="btn danger-quiet" style={{ marginTop: 8 }} disabled={busy} onClick={() => { if (lot && holdingId) setConfirmDelete({ lotId: lot.id, holdingId, last: lastLot }); }}>{lastLot ? "Delete lot and position" : "Delete this lot"}</button>}
        <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
