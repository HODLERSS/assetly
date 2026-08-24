import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { glClass, money, signedMoney, signedPct, timeAgo } from "../lib/format";
// Canvas 2c + 3i + the remove flow (gap screen g1): detail, every lot editable, delete with confirm.
export function PositionScreen({ api, row, onChanged, onRemoved, onBack }) {
    const [lots, setLots] = useState([]);
    const [confirming, setConfirming] = useState(false);
    const [editing, setEditing] = useState(null);
    const [adding, setAdding] = useState(false);
    const [err, setErr] = useState(null);
    useEffect(() => {
        if (row)
            api.getLots(row.holding_id).then(setLots).catch(() => setLots([]));
    }, [api, row]);
    if (!row)
        return _jsxs("p", { className: "empty", children: ["Position not found. ", _jsx("button", { className: "chip", onClick: onBack, children: "Back" })] });
    const reload = async () => {
        setLots(await api.getLots(row.holding_id));
        await onChanged();
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", { className: "chip", onClick: onBack, children: "\u2190 Holdings" }), _jsxs("div", { style: { margin: "12px 0 6px" }, children: [_jsxs("h2", { className: "h1", children: [row.symbol, " ", _jsx("span", { className: "mutedc", style: { fontWeight: 400, fontSize: 15 }, children: row.name })] }), _jsx("div", { className: "net num", style: { fontSize: 30 }, children: money(row.price, row.currency) }), _jsxs("div", { className: `num ${glClass(row.change_pct)}`, children: [signedPct(row.change_pct), " today \u00B7 ", timeAgo(row.as_of) || "no print yet"] })] }), _jsxs("div", { className: "card", style: { padding: "12px 14px", margin: "12px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: [_jsxs("div", { children: [_jsx("span", { className: "sub", children: "Shares" }), _jsx("br", {}), _jsx("span", { className: "num", children: row.qty ?? 0 })] }), _jsxs("div", { children: [_jsx("span", { className: "sub", children: "Value" }), _jsx("br", {}), _jsx("span", { className: "num", children: money(row.value, row.currency) })] }), _jsxs("div", { children: [_jsx("span", { className: "sub", children: "Avg cost" }), _jsx("br", {}), _jsx("span", { className: "num", children: money(row.avg_cost, row.currency) })] }), _jsxs("div", { children: [_jsx("span", { className: "sub", children: "Total G/L" }), _jsx("br", {}), _jsx("span", { className: `num ${glClass(row.total_gl)}`, children: signedMoney(row.total_gl, row.currency) })] })] }), _jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, children: [_jsx("h3", { className: "h1", style: { fontSize: 15 }, children: "Lots" }), _jsx("button", { className: "chip", onClick: () => setAdding(true), children: "+ Lot" })] }), _jsxs("div", { className: "card", children: [lots.map((l) => (_jsxs("button", { className: "row", onClick: () => setEditing(l), "aria-label": `Edit lot ${l.qty} shares`, children: [_jsxs("span", { className: "num", children: [l.qty, " sh @ ", money(l.cost_per_share, row.currency)] }), _jsx("span", { className: "sub", children: l.acquired_on ?? "no date" })] }, l.id))), lots.length === 0 && _jsx("p", { className: "empty", children: "No lots yet." })] }), _jsx("p", { className: "mutedc", style: { fontSize: 12.5, margin: "8px 0 16px" }, children: "The average is derived from lots \u2014 never typed." }), err && _jsx("div", { className: "error-note", role: "alert", children: err }), _jsx("button", { className: "btn danger", onClick: () => setConfirming(true), children: "Remove position" }), confirming && (_jsx("div", { className: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": "Confirm removal", children: _jsxs("div", { className: "sheet", children: [_jsxs("h2", { children: ["Remove ", row.symbol, "?"] }), _jsxs("p", { className: "mutedc", style: { marginBottom: 14 }, children: ["This deletes the position and its ", lots.length, " lot", lots.length === 1 ? "" : "s", " from your account. Prices and news for ", row.symbol, " are unaffected."] }), _jsx("button", { className: "btn danger", onClick: async () => {
                                try {
                                    await api.removeHolding(row.holding_id);
                                    await onRemoved();
                                }
                                catch (e) {
                                    setErr(e instanceof Error ? e.message : "Could not remove.");
                                    setConfirming(false);
                                }
                            }, children: "Remove position" }), _jsx("button", { className: "btn secondary", style: { marginTop: 8 }, onClick: () => setConfirming(false), children: "Keep it" })] }) })), (editing || adding) && (_jsx(LotSheet, { currency: row.currency, lot: editing, onClose: () => { setEditing(null); setAdding(false); }, onSave: async (qty, cost, date) => {
                    try {
                        if (editing)
                            await api.updateLot(editing.id, { qty, cost_per_share: cost, acquired_on: date || null });
                        else
                            await api.addLot(row.holding_id, qty, cost, date || undefined);
                        setEditing(null);
                        setAdding(false);
                        await reload();
                    }
                    catch (e) {
                        setErr(e instanceof Error ? e.message : "Could not save lot.");
                    }
                }, onDelete: editing ? async () => {
                    try {
                        await api.deleteLot(editing.id);
                        setEditing(null);
                        await reload();
                    }
                    catch (e) {
                        setErr(e instanceof Error ? e.message : "Could not delete lot.");
                    }
                } : undefined }))] }));
}
function LotSheet({ currency, lot, onClose, onSave, onDelete }) {
    const [qty, setQty] = useState(lot ? String(lot.qty) : "");
    const [cost, setCost] = useState(lot ? String(lot.cost_per_share) : "");
    const [date, setDate] = useState(lot?.acquired_on ?? "");
    const [msg, setMsg] = useState(null);
    return (_jsx("div", { className: "sheet-back", role: "dialog", "aria-modal": "true", "aria-label": lot ? "Edit lot" : "Add lot", children: _jsxs("div", { className: "sheet", children: [_jsx("h2", { children: lot ? "Edit lot" : "Add lot" }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "lot-qty", children: "Shares" }), _jsx("input", { id: "lot-qty", className: "num", inputMode: "decimal", value: qty, onChange: (e) => setQty(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsxs("label", { htmlFor: "lot-cost", children: ["Cost per share (", currency === "KRW" ? "₩" : "$", ")"] }), _jsx("input", { id: "lot-cost", className: "num", inputMode: "decimal", value: cost, onChange: (e) => setCost(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "lot-date", children: "Acquired (optional)" }), _jsx("input", { id: "lot-date", type: "date", value: date, onChange: (e) => setDate(e.target.value) })] }), msg && _jsx("div", { className: "error-note", role: "alert", children: msg }), _jsx("button", { className: "btn", onClick: () => {
                        const nq = parseFloat(qty), nc = parseFloat(cost);
                        if (!(nq > 0)) {
                            setMsg("Shares must be positive.");
                            return;
                        }
                        if (!(nc >= 0)) {
                            setMsg("Cost can't be negative.");
                            return;
                        }
                        onSave(nq, nc, date);
                    }, children: lot ? "Save changes" : "Add lot" }), onDelete && _jsx("button", { className: "btn danger", style: { marginTop: 8 }, onClick: onDelete, children: "Delete this lot" }), _jsx("button", { className: "btn secondary", style: { marginTop: 8 }, onClick: onClose, children: "Cancel" })] }) }));
}
