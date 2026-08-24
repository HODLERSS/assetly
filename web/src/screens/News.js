import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
// Canvas 5a/5b: newest first, one-tap per-holding filter.
export function NewsScreen({ api, rows }) {
    const [filter, setFilter] = useState(null);
    const [items, setItems] = useState([]);
    const [state, setState] = useState("loading");
    useEffect(() => {
        let live = true;
        setState("loading");
        api.getNews(filter ?? undefined)
            .then((n) => { if (live) {
            setItems(n);
            setState("ok");
        } })
            .catch(() => { if (live)
            setState("error"); });
        return () => { live = false; };
    }, [api, filter]);
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: "h1", children: "News" }), _jsxs("div", { className: "chips", role: "group", "aria-label": "Filter news by holding", children: [_jsx("button", { className: "chip", "aria-pressed": filter === null, onClick: () => setFilter(null), children: "All holdings" }), rows.map((r) => (_jsx("button", { className: "chip", "aria-pressed": filter === r.symbol, onClick: () => setFilter(r.symbol), children: r.symbol }, r.symbol)))] }), state === "error" && _jsx("div", { className: "error-note", role: "alert", children: "News missed the handoff \u2014 pull to retry." }), state === "ok" && items.length === 0 && (_jsxs("p", { className: "empty", children: ["No stories yet", filter ? ` for ${filter}` : "", ". The news lap runs every 15 minutes."] })), _jsx("div", { className: "card", children: items.map((n) => (_jsx("a", { className: "row", href: n.url, target: "_blank", rel: "noreferrer noopener", style: { textDecoration: "none", display: "flex" }, children: _jsxs("span", { children: [_jsx("span", { style: { fontWeight: 500 }, children: n.title }), _jsx("br", {}), _jsxs("span", { className: "sub", children: [n.symbol, " \u00B7 ", n.source, " \u00B7 ", timeAgo(n.published_at)] })] }) }, n.id))) })] }));
}
