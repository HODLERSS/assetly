import { useEffect, useState } from "react";
import type { Api, Lot, PortfolioRow } from "../lib/api";
import { glClass, labelParts, money, moneyExact, priceAsOf, signedMoney, signedPct } from "../lib/format";
import { PriceChart } from "../components/PriceChart";
import { InsightsCard } from "../components/InsightsCard";

// Canvas 2c + 3i + the remove flow (gap screen g1): detail, every lot editable, delete with confirm.
export function PositionScreen({ api, row, onChanged, onRemoved, onBack, dispKr = "KRW" }: {
  api: Api; row: PortfolioRow | null; dispKr?: "USD" | "KRW";
  onChanged: () => Promise<void> | void; onRemoved: () => Promise<void> | void; onBack: () => void;
}) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotsLoaded, setLotsLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLotsLoaded(false);
    if (row) api.getLots(row.holding_id)
      .then((l) => { if (live) { setLots(l); setLotsLoaded(true); } })
      .catch(() => { if (live) { setLots([]); setLotsLoaded(true); } });
    return () => { live = false; };
  }, [api, row?.holding_id]);

  if (!row) return <p className="empty">Position not found. <button className="chip" onClick={onBack}>Back</button></p>;

  const reload = async () => {
    setLots(await api.getLots(row.holding_id));
    await onChanged();
  };
  const cashish = row.kind === "cash" || row.kind === "debt";

  return (
    <>
      <button className="chip" onClick={onBack}>&larr; Holdings</button>
      <div style={{ margin: "12px 0 6px" }}>
        <h2 className="h1">{labelParts(row, dispKr === "KRW").main} <span className="mutedc" style={{ fontWeight: 400, fontSize: 15 }}>{labelParts(row, dispKr === "KRW").sub}</span></h2>
        <div className="net num" style={{ fontSize: 30 }}>{moneyExact(row.price, row.currency)}</div>
        <div className={`num ${glClass(row.change_pct)}`}>
          {signedPct(row.change_pct)} {row.as_of && Date.now() - +new Date(row.as_of) > 20 * 3600 * 1000 ? "since last close" : "today"} · {priceAsOf(row.as_of)}
        </div>
      </div>

      {row.account !== "brokerage" && <p className="sub" style={{ margin: "2px 0 0" }}>{row.account === "bank" ? "Bank" : row.account === "401k" ? "401k" : "IRA"} account</p>}
      {row.kind !== "cash" && row.kind !== "debt" && <PriceChart api={api} symbol={row.symbol} currency={row.currency} livePrice={row.price} liveAsOf={row.as_of} avgCost={row.avg_cost} />}

      {row.kind !== "cash" && row.kind !== "debt" && <InsightsCard api={api} symbol={row.symbol} />}

      <div className="card" style={{ padding: "12px 14px", margin: "12px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><span className="sub">{row.kind === "crypto" ? "Quantity" : "Shares"}</span><br /><span className="num">{row.qty ?? 0}</span></div>
        <div><span className="sub">Value</span><br /><span className="num">{money(row.value, row.currency)}</span></div>
        <div><span className="sub">Avg cost</span><br /><span className="num">{moneyExact(row.avg_cost, row.currency)}</span></div>
        <div><span className="sub">Total G/L</span><br /><span className={`num ${glClass(row.total_gl)}`}>{signedMoney(row.total_gl, row.currency)}</span></div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 className="h1" style={{ fontSize: 15 }}>{cashish ? "Balance" : "Lots"}</h3>
        {!cashish && <button className="chip" onClick={() => setAdding(true)}>+ Lot</button>}
      </div>
      <div className="card">
        {lots.map((l) => (
          <button key={l.id} className="row" onClick={() => setEditing(l)} aria-label={`Edit lot ${l.qty} shares`}>
            <span><span className="num">{cashish ? money(l.qty, row.currency) : `${l.qty} sh @ ${moneyExact(l.cost_per_share, row.currency)}`}</span>{l.note ? <><br /><span className="sub">{l.note}</span></> : null}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {!cashish && <span className="sub">{l.acquired_on ?? "no date"}</span>}
              <span className="edit-pill">Edit</span>
            </span>
          </button>
        ))}
        {lotsLoaded && lots.length === 0 && <p className="empty">No lots yet.</p>}
        {!lotsLoaded && <div className="row" aria-busy="true" aria-label="Loading lots"><span className="sub">Loading lots…</span></div>}
      </div>
      {!cashish && <p className="mutedc" style={{ fontSize: 12.5, margin: "8px 0 16px" }}>{row.source === "snaptrade" ? "⚡ Synced from your brokerage — shares and cost refresh automatically." : "The average is derived from lots — never typed."}</p>}

      {err && <div className="error-note" role="alert">{err}</div>}
      {lots.length === 1 && (
        <button className="btn secondary" style={{ marginBottom: 8 }} onClick={() => setEditing(lots[0])}>
          {cashish ? "Edit amount" : "Edit position"}
        </button>
      )}
      <button className="btn danger" style={{ marginBottom: 20 }} onClick={() => setConfirming(true)}>Remove position</button>

      {confirming && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Confirm removal">
          <div className="sheet">
            <h2>Remove {row.symbol}?</h2>
            <p className="mutedc" style={{ marginBottom: 14 }}>
              {row.source === "snaptrade"
                ? `This position is synced from your brokerage. Removing it alone brings it back on the next sync.`
                : `This deletes the position and its ${lots.length} lot${lots.length === 1 ? "" : "s"} from your account. Prices and news for ${row.symbol} are unaffected.`}
            </p>
            {row.source === "snaptrade" && (
              <button className="btn danger" onClick={async () => {
                try { await api.excludeImport(row.symbol); await api.removeHolding(row.holding_id); await onRemoved(); }
                catch (e) { setErr(e instanceof Error ? e.message : "Could not remove."); setConfirming(false); }
              }}>Remove and stop importing it</button>
            )}
            <button className="btn danger" style={row.source === "snaptrade" ? { marginTop: 8 } : undefined} onClick={async () => {
              try { await api.removeHolding(row.holding_id); await onRemoved(); }
              catch (e) { setErr(e instanceof Error ? e.message : "Could not remove."); setConfirming(false); }
            }}>{row.source === "snaptrade" ? "Remove (returns on next sync)" : "Remove position"}</button>
            <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}

      {(editing || adding) && (
        <LotSheet
          currency={row.currency}
          cashish={cashish}
          lot={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={async (qty, cost, date, note) => {
            try {
              if (editing) await api.updateLot(editing.id, { qty, cost_per_share: cost, acquired_on: date || null, note: note || null });
              else await api.addLot(row.holding_id, qty, cost, date || undefined, note);
              setEditing(null); setAdding(false); await reload();
            } catch (e) { setErr(e instanceof Error ? e.message : "Could not save lot."); }
          }}
          onDelete={editing ? async () => {
            try { await api.deleteLot(editing.id); setEditing(null); await reload(); }
            catch (e) { setErr(e instanceof Error ? e.message : "Could not delete lot."); }
          } : undefined}
        />
      )}
    </>
  );
}

function LotSheet({ currency, cashish = false, lot, onClose, onSave, onDelete }: {
  currency: "USD" | "KRW"; cashish?: boolean; lot: Lot | null; onClose: () => void;
  onSave: (qty: number, cost: number, date: string, note: string) => void; onDelete?: () => void;
}) {
  const [qty, setQty] = useState(lot ? String(lot.qty) : "");
  const [cost, setCost] = useState(lot ? String(lot.cost_per_share) : "");
  const [date, setDate] = useState(lot?.acquired_on ?? "");
  const [note, setNote] = useState(lot?.note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="sheet-back" role="dialog" aria-modal="true" aria-label={lot ? "Edit lot" : "Add lot"}>
      <div className="sheet">
        <h2>{cashish ? (lot ? "Edit balance" : "Add balance") : lot ? "Edit lot" : "Add lot"}</h2>
        <div className="field"><label htmlFor="lot-qty">{cashish ? `Amount (${currency === "KRW" ? "₩" : "$"})` : "Shares"}</label>
          <input id="lot-qty" className="num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        {!cashish && (<>
        <div className="field"><label htmlFor="lot-cost">Cost per share ({currency === "KRW" ? "₩" : "$"})</label>
          <input id="lot-cost" className="num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div className="field"><label htmlFor="lot-date">Acquired (optional)</label>
          <input id="lot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </>)}
        <div className="field"><label htmlFor="lot-note">Note (optional)</label>
          <input id="lot-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. DCA week 3" /></div>
        {msg && <div className="error-note" role="alert">{msg}</div>}
        <button className="btn" onClick={() => {
          const nq = parseFloat(qty), nc = cashish ? 1 : parseFloat(cost);
          if (!(nq > 0)) { setMsg(cashish ? "Amount must be positive." : "Shares must be positive."); return; }
          if (!(nc >= 0)) { setMsg("Cost can't be negative."); return; }
          onSave(nq, nc, date, note);
        }}>{lot ? "Save changes" : "Add lot"}</button>
        {onDelete && <button className="btn danger" style={{ marginTop: 8 }} onClick={onDelete}>Delete this lot</button>}
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
