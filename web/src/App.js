import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { api as defaultApi } from "./lib/api";
import { AuthScreen } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Holdings } from "./screens/Holdings";
import { PositionScreen } from "./screens/Position";
import { AddPosition } from "./screens/AddPosition";
import { NewsScreen } from "./screens/News";
import { SettingsScreen } from "./screens/Settings";
const REFRESH_MS = 60_000;
export function App({ api = defaultApi }) {
    const [session, setSession] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [profile, setProfile] = useState(null);
    const [rows, setRows] = useState([]);
    const [view, setView] = useState({ kind: "tab", tab: "home" });
    const [error, setError] = useState(null);
    const [lastSync, setLastSync] = useState(null);
    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
        const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
        return () => sub.subscription.unsubscribe();
    }, []);
    const load = useCallback(async () => {
        try {
            const [p, r] = await Promise.all([api.getProfile(), api.getPortfolio()]);
            setProfile(p);
            setRows(r);
            setError(null);
            setLastSync(new Date());
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "The feed missed a handoff. Pull to retry.");
        }
    }, [api]);
    useEffect(() => {
        if (!session) {
            setProfile(null);
            setRows([]);
            return;
        }
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [session, load]);
    const totals = useMemo(() => {
        let value = 0, cost = 0;
        for (const r of rows) {
            value += r.value ?? 0;
            cost += r.cost_basis ?? 0;
        }
        return { value, gl: value - cost, cost };
    }, [rows]);
    if (!authReady)
        return _jsx("div", { className: "screen", "aria-busy": "true" });
    if (!session)
        return _jsx(AuthScreen, {});
    if (profile && !profile.onboarded_at) {
        return _jsx(Onboarding, { api: api, onDone: load });
    }
    const go = (v) => { setError(null); setView(v); };
    const tab = view.kind === "tab" ? view.tab : null;
    return (_jsxs(_Fragment, { children: [_jsxs("header", { className: "topbar", children: [_jsxs("span", { className: "brand", children: [_jsxs("svg", { width: "26", height: "12", viewBox: "0 0 32 12", "aria-hidden": "true", children: [_jsx("rect", { x: "0", y: "3", width: "14", height: "6", rx: "3", fill: "#2A3F92" }), _jsx("rect", { x: "17", y: "3", width: "14", height: "6", rx: "3", fill: "#2A3F92", opacity: "0.45" })] }), "Assetly"] }), _jsx("span", { className: "status-line", "data-testid": "status-line", children: lastSync ? `synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · next in 60s` : "syncing…" })] }), error && (_jsxs("div", { className: "error-note", role: "alert", children: [error, " ", _jsx("button", { className: "chip", onClick: load, style: { marginLeft: 8 }, children: "Retry" })] })), _jsxs("main", { className: "screen", children: [_jsx("h1", { className: "sr-only", children: "Assetly" }), view.kind === "add" && (_jsx(AddPosition, { api: api, onDone: async () => { await load(); go({ kind: "tab", tab: "holdings" }); }, onCancel: () => go({ kind: "tab", tab: "holdings" }) })), view.kind === "position" && (_jsx(PositionScreen, { api: api, row: rows.find((r) => r.holding_id === view.holdingId) ?? null, onChanged: load, onRemoved: async () => { await load(); go({ kind: "tab", tab: "holdings" }); }, onBack: () => go({ kind: "tab", tab: "holdings" }) })), view.kind === "tab" && view.tab === "home" && (_jsx(Home, { rows: rows, totals: totals, baseCurrency: profile?.base_currency ?? "USD", onOpen: (id) => go({ kind: "position", holdingId: id }), onAdd: () => go({ kind: "add" }) })), view.kind === "tab" && view.tab === "holdings" && (_jsx(Holdings, { rows: rows, onOpen: (id) => go({ kind: "position", holdingId: id }), onAdd: () => go({ kind: "add" }) })), view.kind === "tab" && view.tab === "news" && _jsx(NewsScreen, { api: api, rows: rows }), view.kind === "tab" && view.tab === "settings" && (_jsx(SettingsScreen, { api: api, profile: profile, onSignedOut: () => setView({ kind: "tab", tab: "home" }) }))] }), _jsx("nav", { className: "tabbar", "aria-label": "Tabs", children: ["home", "holdings", "news", "settings"].map((t) => (_jsxs("button", { "aria-current": tab === t ? "page" : undefined, onClick: () => go({ kind: "tab", tab: t }), children: [_jsx("span", { className: "dot", "aria-hidden": "true" }), t === "home" ? "Home" : t === "holdings" ? "Holdings" : t === "news" ? "News" : "Settings"] }, t))) })] }));
}
