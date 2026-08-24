import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
// Canvas 3b→3f: markets → first position → shares + cost → first real number.
export function Onboarding({ api, onDone }) {
    const [step, setStep] = useState(0);
    const [markets, setMarkets] = useState(["US"]);
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    const [picked, setPicked] = useState(null);
    const [qty, setQty] = useState("");
    const [cost, setCost] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const toggle = (m) => setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
    const search = async (text) => {
        setQ(text);
        if (text.trim().length < 1) {
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
    const finish = async () => {
        setBusy(true);
        setErr(null);
        try {
            const nQty = parseFloat(qty), nCost = parseFloat(cost);
            if (!picked || !(nQty > 0) || !(nCost >= 0))
                throw new Error("Shares must be positive and cost can't be negative.");
            await api.addPosition(picked.symbol, nQty, nCost);
            await api.completeOnboarding(markets, markets.includes("KR") && !markets.includes("US") ? "KRW" : "USD");
            await onDone();
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save. Try again.");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("main", { className: "screen", style: { paddingTop: 28 }, children: [_jsx("h1", { className: "h1", children: "Set up Assetly" }), _jsxs("p", { className: "mutedc", style: { marginBottom: 18 }, children: ["Step ", step + 1, " of 3"] }), step === 0 && (_jsxs("section", { "aria-label": "Pick your markets", children: [_jsx("p", { style: { marginBottom: 12 }, children: "Where do you hold? This sets currency and feeds." }), _jsx("div", { className: "chips", children: ["US", "KR", "Crypto"].map((m) => (_jsx("button", { className: "chip", "aria-pressed": markets.includes(m), onClick: () => toggle(m), children: m === "US" ? "US markets" : m === "KR" ? "Korea (KRX)" : "Crypto" }, m))) }), _jsx("button", { className: "btn", disabled: markets.length === 0, onClick: () => setStep(1), style: { marginTop: 16 }, children: "Next" })] })), step === 1 && (_jsxs("section", { "aria-label": "Find your first position", children: [_jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "ob-q", children: "Find your first position" }), _jsx("input", { id: "ob-q", value: q, onChange: (e) => search(e.target.value), placeholder: "Ticker or name \u2014 try MARA, \uC0BC\uC131", autoFocus: true })] }), _jsxs("div", { className: "card", children: [results.map((r) => (_jsxs("button", { className: "row", onClick: () => { setPicked(r); setStep(2); }, children: [_jsxs("span", { children: [_jsx("span", { className: "sym", children: r.symbol }), " ", _jsx("span", { className: "sub", children: r.name })] }), _jsx("span", { className: "sub", children: r.exchange })] }, r.symbol))), q && results.length === 0 && _jsxs("p", { className: "empty", children: ["Nothing matched \u201C", q, "\u201D."] })] })] })), step === 2 && picked && (_jsxs("section", { "aria-label": "Shares and cost", children: [_jsxs("p", { style: { marginBottom: 12 }, children: [_jsx("span", { className: "sym", children: picked.symbol }), " \u00B7 ", picked.name] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "ob-qty", children: "Shares" }), _jsx("input", { id: "ob-qty", className: "num", inputMode: "decimal", value: qty, onChange: (e) => setQty(e.target.value), placeholder: "10" })] }), _jsxs("div", { className: "field", children: [_jsxs("label", { htmlFor: "ob-cost", children: ["Cost per share (", picked.currency === "KRW" ? "₩" : "$", ")"] }), _jsx("input", { id: "ob-cost", className: "num", inputMode: "decimal", value: cost, onChange: (e) => setCost(e.target.value), placeholder: "166.55" })] }), _jsx("p", { className: "mutedc", style: { fontSize: 12.5, marginBottom: 12 }, children: "Purchase date is optional \u2014 add it later from the position." }), err && _jsx("div", { className: "error-note", role: "alert", children: err }), _jsx("button", { className: "btn", disabled: busy, onClick: finish, children: busy ? "Saving…" : "Add position" })] }))] }));
}
