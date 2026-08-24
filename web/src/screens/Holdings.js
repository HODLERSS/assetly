import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { glClass, money, signedPct } from "../lib/format";
// Canvas 2b: the table as a touch list with filter chips.
export function Holdings({ rows, onOpen, onAdd }) {
    const [filter, setFilter] = useState("all");
    const kinds = ["all", ...new Set(rows.map((r) => r.kind))];
    const shown = rows.filter((r) => filter === "all" || r.kind === filter);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("h2", { className: "h1", children: "Holdings" }), _jsx("button", { className: "chip", onClick: onAdd, "aria-label": "Add position", children: "+ Add" })] }), _jsx("div", { className: "chips", role: "group", "aria-label": "Filter by type", children: kinds.map((k) => (_jsx("button", { className: "chip", "aria-pressed": filter === k, onClick: () => setFilter(k), children: k === "all" ? "All" : k }, k))) }), _jsxs("div", { className: "card", children: [shown.map((r) => (_jsxs("button", { className: "row", onClick: () => onOpen(r.holding_id), children: [_jsxs("span", { children: [_jsx("span", { className: "sym", children: r.symbol }), " ", _jsx("span", { className: "sub", children: r.name }), _jsx("br", {}), _jsxs("span", { className: "sub num", children: [r.qty ?? 0, " sh \u00B7 avg ", money(r.avg_cost, r.currency)] })] }), _jsxs("span", { className: "right", children: [_jsx("span", { className: "num", children: money(r.value, r.currency) }), _jsx("br", {}), _jsxs("span", { className: `num sub ${glClass(r.change_pct)}`, children: [signedPct(r.change_pct), " today"] })] })] }, r.holding_id))), shown.length === 0 && _jsx("p", { className: "empty", children: "Nothing in this filter." })] })] }));
}
