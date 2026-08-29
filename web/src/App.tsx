import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertCcy, dayChangeAmount } from "./lib/format";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { api as defaultApi, type Api, type Insight, type PortfolioRow, type Profile } from "./lib/api";
import { AuthScreen } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Holdings } from "./screens/Holdings";
import { PositionScreen } from "./screens/Position";
import { AddPosition } from "./screens/AddPosition";
import { NewsScreen } from "./screens/News";
import { SettingsScreen } from "./screens/Settings";
import { AskScreen } from "./screens/Ask";

export type Tab = "home" | "holdings" | "news" | "ask" | "settings";
export type View =
  | { kind: "tab"; tab: Tab }
  | { kind: "add" }
  | { kind: "position"; holdingId: string };

const REFRESH_MS = 60_000;

export function App({ api = defaultApi }: { api?: Api }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [fx, setFx] = useState<number | null>(null);
  const [view, setView] = useState<View>({ kind: "tab", tab: "home" });
  const [error, setError] = useState<string | null>(null);
  const [askAlert, setAskAlert] = useState(false);
  const [holdAlert, setHoldAlert] = useState(false);
  const [newsAlert, setNewsAlert] = useState(false);
  const seenInsightRef = useRef<string | null>(null);   // generated_at the user has already seen
  const [pinsRefreshing, setPinsRefreshing] = useState(false);
  const [pinsFresh, setPinsFresh] = useState<Insight | null>(null);   // result of the last app-level refresh
  // Refresh lives here, not in Holdings: it keeps running across tabs and lights the tab when done.
  const refreshInsights = useCallback(async () => {
    if (pinsRefreshing) return;
    setPinsRefreshing(true);
    try {
      const v = await api.refreshPortfolioInsights();
      if (v) {
        setPinsFresh(v);
        const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
        if (cur === "holdings" || cur === "news") seenInsightRef.current = v.generated_at;
        if (cur !== "holdings") setHoldAlert(true);
        if (cur !== "news") setNewsAlert(true);
      }
    } finally { setPinsRefreshing(false); }
  }, [api, pinsRefreshing]);
  // background watch: a newer portfolio assessment (cron/refresh) lights the Holdings tab
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try {
        const v = await api.getPortfolioInsights();
        if (!live || !v) return;
        if (seenInsightRef.current === null) { seenInsightRef.current = v.generated_at; return; }
        if (v.generated_at !== seenInsightRef.current) {
          const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
          if (cur === "holdings" || cur === "news") seenInsightRef.current = v.generated_at;
          if (cur !== "holdings") setHoldAlert(true);
          if (cur !== "news") setNewsAlert(true);
        }
      } catch { /* quiet */ }
    };
    const t = setInterval(tick, 60000);
    return () => { live = false; clearInterval(t); };
  }, [session, api]);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    // stale-bundle guard: the PWA can cache an old build; check the served index once per open
    (async () => {
      try {
        if (sessionStorage.getItem("assetly-updated")) return;
        const html = await (await fetch(window.location.pathname || "./", { cache: "no-store" })).text();
        const served = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0];
        const running = [...document.querySelectorAll("script[src]")].map((el) => el.getAttribute("src") ?? "").find((src) => src.includes("index-"))?.match(/index-[A-Za-z0-9_-]+\.js/)?.[0];
        if (served && running && served !== running) {
          sessionStorage.setItem("assetly-updated", "1");
          window.location.reload();
        }
      } catch { /* offline or blocked: run what we have */ }
    })();
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
      api.getFxRate().then((v) => setFx(v)).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The feed missed a handoff. Pull to retry.");
    }
  }, [api]);

  const [notice, setNotice] = useState<string | null>(null);
  const [obSnap, setObSnap] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    const q = new URLSearchParams(window.location.search);
    const stp = q.get("snaptrade");
    if (!stp) return;
    setObSnap(stp);
    q.delete("snaptrade");
    window.history.replaceState({}, "", window.location.pathname + (q.toString() ? "?" + q.toString() : "") + window.location.hash);
    if (stp === "connected") {
      setNotice("Brokerage connected. Importing your positions…");
      api.snaptradeSync().then(async () => { await load(); setNotice("Brokerage import complete."); setTimeout(() => setNotice(null), 6000); })
        .catch(() => { setNotice("Connected. The first import runs in the background — pull to refresh."); setTimeout(() => setNotice(null), 8000); });
    } else {
      setNotice(stp === "denied" ? "Brokerage link was declined." : "Brokerage link didn't complete. Try again from Settings.");
      setTimeout(() => setNotice(null), 8000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!session) { setProfile(null); setRows([]); return; }
    load();
    // brokerage auto-sync deltas: greet returning users with what arrived while they were away
    api.snaptradeEvents().then(async (evs) => {
      if (!evs.length) return;
      const coll = [...new Set(evs.flatMap((e) => e.detail.collisions ?? []))];
      const groups = new Map<string, Set<string>>();
      for (const e of evs) {
        const by = e.detail.by_institution?.length ? e.detail.by_institution : (e.detail.added?.length ? [{ institution: e.detail.institution ?? "your brokerage", symbols: e.detail.added }] : []);
        for (const g of by) { const set = groups.get(g.institution) ?? new Set<string>(); g.symbols.forEach((x) => set.add(x)); groups.set(g.institution, set); }
      }
      if (groups.size) {
        const parts = [...groups.entries()].slice(0, 3).map(([inst, syms]) => {
          const list = [...syms];
          return `${inst}: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` +${list.length - 4} more` : ""}`;
        });
        setNotice(`Added from ${parts.join(" · ")}${coll.length ? ` · ${coll.join(", ")} also exists manually` : ""}`);
        setTimeout(() => setNotice(null), 12000);
      }
      await api.snaptradeEventsSeen(evs.map((e) => e.id));
    }).catch(() => {});
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [session, load, api]);

  const base = profile?.base_currency ?? "USD";
  const totals = useMemo(() => {
    let value = 0, cost = 0, day = 0, unconverted = 0, mixed = false;
    for (const r of rows) {
      if (r.currency !== base) mixed = true;
      const sign = r.kind === "debt" ? -1 : 1;           // consolidated view: debt subtracts
      const v = convertCcy(r.value ?? 0, r.currency, base, fx);
      const c = convertCcy(r.cost_basis ?? 0, r.currency, base, fx);
      const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, base, fx);
      if (v === null || c === null) { unconverted += 1; continue; }   // no FX rate yet: exclude, never mislabel
      value += sign * v; cost += sign * c; day += sign * (d ?? 0);
    }
    return { value, gl: value - cost, cost, day, mixed, fx, unconverted };
  }, [rows, fx, base]);

  if (!authReady) return <div className="screen" aria-busy="true" />;
  if (!session) return <AuthScreen />;
  if (profile && !profile.onboarded_at) {
    return <Onboarding api={api} onDone={load} snaptrade={obSnap} />;
  }

  const go = (v: View) => { setError(null); if (v.kind === "tab" && v.tab === "ask") setAskAlert(false); if (v.kind === "tab" && v.tab === "holdings") setHoldAlert(false); if (v.kind === "tab" && v.tab === "news") setNewsAlert(false); setView(v); };
  const tab = view.kind === "tab" ? view.tab : null;

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <svg width="26" height="12" viewBox="0 0 32 12" aria-hidden="true">
            <rect x="0" y="3" width="14" height="6" rx="3" fill="#2A3F92" />
            <rect x="17" y="3" width="14" height="6" rx="3" fill="#2A3F92" opacity="0.45" />
          </svg>
          Assetly
        </span>
      </header>

      {notice && <div className="error-note" role="status" style={{ borderColor: "#2A3F92" }}>{notice}</div>}
      {error && (
        <div className="error-note" role="alert">
          {error} <button className="chip" onClick={load} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      <main className="screen">
        <h1 className="sr-only">Assetly</h1>
        {view.kind === "add" && (
          <AddPosition api={api} onRefresh={load}
            onDone={() => go({ kind: "tab", tab: "holdings" })}
            onCancel={() => go({ kind: "tab", tab: "holdings" })} />
        )}
        {view.kind === "position" && (
          <PositionScreen api={api} dispKr={profile?.display_kr ?? "KRW"} row={rows.find((r) => r.holding_id === view.holdingId) ?? null}
            onChanged={load} onRemoved={async () => { await load(); go({ kind: "tab", tab: "holdings" }); }}
            onBack={() => go({ kind: "tab", tab: "holdings" })} />
        )}
        {view.kind === "tab" && view.tab === "home" && (
          <Home api={api} rows={rows} totals={totals} baseCurrency={profile?.base_currency ?? "USD"}
            dispUs={profile?.display_us ?? "USD"} dispKr={profile?.display_kr ?? "KRW"}
            onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })} />
        )}
        {view.kind === "tab" && view.tab === "holdings" && (
          <Holdings rows={rows} api={api} fxRate={fx} totalsCcy={base} dispUs={profile?.display_us ?? "USD"} dispKr={profile?.display_kr ?? "KRW"} onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })}
            onInsightsChanged={(g) => { seenInsightRef.current = g; setHoldAlert(false); }}
            onRefreshInsights={refreshInsights} insightsRefreshing={pinsRefreshing} freshInsights={pinsFresh} />
        )}
        {view.kind === "tab" && view.tab === "news" && (
          <NewsScreen api={api} rows={rows} dispKr={profile?.display_kr ?? "KRW"}
            onRefreshInsights={refreshInsights} insightsRefreshing={pinsRefreshing} freshInsights={pinsFresh}
            onInsightsSeen={(g) => { seenInsightRef.current = g; setNewsAlert(false); }} />
        )}
        {/* Ask stays mounted so an in-flight answer keeps generating across tabs */}
        <div style={view.kind === "tab" && view.tab === "ask" ? undefined : { display: "none" }}>
          <AskScreen api={api} onAnswered={() => {
            const v = viewRef.current;
            if (!(v.kind === "tab" && v.tab === "ask")) setAskAlert(true);
          }} />
        </div>
        {view.kind === "tab" && view.tab === "settings" && (
          <SettingsScreen api={api} profile={profile} rows={rows} onChanged={load} onSignedOut={() => setView({ kind: "tab", tab: "home" })} />
        )}
      </main>

      <nav className="tabbar" aria-label="Tabs">
        {(["home", "holdings", "news", "ask", "settings"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go({ kind: "tab", tab: t })}>
            <span className="dot" aria-hidden="true" />
            {t === "home" ? "Home" : t === "holdings" ? "Holdings" : t === "news" ? "News" : t === "ask" ? "Ask" : "Settings"}
            {t === "ask" && askAlert && <span className="tab-alert" aria-label="New answer ready" />}
            {t === "holdings" && holdAlert && <span className="tab-alert" aria-label="New portfolio assessment" />}
            {t === "news" && newsAlert && <span className="tab-alert" aria-label="New Assetly Intelligence" />}
          </button>
        ))}
      </nav>
    </>
  );
}
