import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
// Canvas 3c/3d applied post-onboarding: search, then the two required fields.
export function AddPosition({ api, onDone, onCancel }) {
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [picked, setPicked] = useState(null);
    const [qty, setQty] = useState("");
    const [cost, setCost] = useState("");
    const [date, setDate] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const search = async (text) => {
        setQ(text);
        setPicked(null);
        if (!text.trim()) {
            setResults([]);
            return;
        }
        try {
            setResults(await api.searchSymbols(text.trim()));
        }
        catch {
            setResults([]);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", { className: "chip", onClick: onCancel, children: "\u2190 Cancel" }), _jsx("h2", { className: "h1", style: { margin: "12px 0" }, children: "Add position" }), !picked && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "add-q", children: "Ticker or name" }), _jsx("input", { id: "add-q", value: q, onChange: (e) => search(e.target.value), placeholder: "MARA, Reddit, \uC0BC\uC131\u2026", autoFocus: true })] }), _jsxs("div", { className: "card", children: [results.map((r) => (_jsxs("button", { className: "row", onClick: () => setPicked(r), children: [_jsxs("span", { children: [_jsx("span", { className: "sym", children: r.symbol }), " ", _jsx("span", { className: "sub", children: r.name })] }), _jsx("span", { className: "sub", children: r.exchange })] }, r.symbol))), q && results.length === 0 && _jsxs("p", { className: "empty", children: ["Nothing matched \u201C", q, "\u201D. The catalog grows \u2014 tell us what's missing."] })] })] })), picked && (_jsxs(_Fragment, { children: [_jsxs("p", { style: { marginBottom: 12 }, children: [_jsx("span", { className: "sym", children: picked.symbol }), " \u00B7 ", picked.name, _jsx("button", { className: "chip", style: { marginLeft: 10 }, onClick: () => setPicked(null), children: "Change" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "add-qty", children: "Shares" }), _jsx("input", { id: "add-qty", className: "num", inputMode: "decimal", value: qty, onChange: (e) => setQty(e.target.value), autoFocus: true })] }), _jsxs("div", { className: "field", children: [_jsxs("label", { htmlFor: "add-cost", children: ["Cost per share (", picked.currency === "KRW" ? "₩" : "$", ")"] }), _jsx("input", { id: "add-cost", className: "num", inputMode: "decimal", value: cost, onChange: (e) => setCost(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "add-date", children: "Purchase date (optional)" }), _jsx("input", { id: "add-date", type: "date", value: date, onChange: (e) => setDate(e.target.value) })] }), err && _jsx("div", { className: "error-note", role: "alert", children: err }), _jsx("button", { className: "btn", disabled: busy, onClick: async () => {
                            const nq = parseFloat(qty), nc = parseFloat(cost);
                            if (!(nq > 0)) {
                                setErr("Shares must be positive.");
                                return;
                            }
                            if (!(nc >= 0)) {
                                setErr("Cost can't be negative.");
                                return;
                            }
                            setBusy(true);
                            setErr(null);
                            try {
                                await api.addPosition(picked.symbol, nq, nc, date || undefined);
                                await onDone();
                            }
                            catch (e) {
                                setErr(e instanceof Error ? e.message : "Could not add position.");
                            }
                            finally {
                                setBusy(false);
                            }
                        }, children: busy ? "Adding…" : "Add position" })] }))] }));
}
