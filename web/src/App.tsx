import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertCcy, dayChangeAmount, type FxRates } from "./lib/format";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { api as defaultApi, type Api, type BriefEdition, type Insight, type PortfolioRow, type Profile } from "./lib/api";
import { AuthScreen } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { TabIcon } from "./components/TabIcon";
import { PositionScreen } from "./screens/Position";
import { AddPosition } from "./screens/AddPosition";
import { NewsScreen } from "./screens/News";
import { SettingsScreen } from "./screens/Settings";
import { AskScreen } from "./screens/Ask";

export type Tab = "home" | "news" | "ask" | "settings";
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
  const [fx, setFx] = useState<FxRates | null>(null);   // units per USD, every currency the price pipeline tracks
  const [view, setView] = useState<View>({ kind: "tab", tab: "home" });
  const [error, setError] = useState<string | null>(null);
  const [askAlert, setAskAlert] = useState(false);
  const [newsAlert, setNewsAlert] = useState(false);
  const [homeAlert, setHomeAlert] = useState(false);
  const [briefBanner, setBriefBanner] = useState<{ audio: boolean; edition: BriefEdition } | null>(null);   // first-arrival banner on Home
  const [autoAsk, setAutoAsk] = useState<{ question: string; key: string } | null>(null);
  const connectPendingRef = useRef<string | null>(null);   // set at the connect moment; consumed when fresh intelligence lands
  const seenBriefRef = useRef<string | null>(null);   // latest brief generated_at the user has seen
  // brief watcher: a new brief (first brief, or the next edition) lights Home when the user is elsewhere
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try {
        const bs = await api.getDailyBriefs();
        if (!live) return;
        // baseline on the very first look: "no brief yet" is itself a state, so a fresh account's
        // first brief counts as NEW when it lands instead of being swallowed as the baseline
        if (!bs.length) { if (seenBriefRef.current === null) seenBriefRef.current = "none"; return; }
        const latest = bs[bs.length - 1];
        const key = `${latest.brief_date}:${latest.edition}:${latest.generated_at}`;
        if (seenBriefRef.current === null) { seenBriefRef.current = key; return; }
        if (key !== seenBriefRef.current) {
          const onHome = viewRef.current.kind === "tab" && viewRef.current.tab === "home";
          if (onHome) seenBriefRef.current = key;
          setBriefBanner({ audio: !!latest.audio_path, edition: latest.edition });
          if (!onHome) setHomeAlert(true);
        }
      } catch { /* quiet */ }
    };
    tick();
    const t = setInterval(tick, 20000);   // a fresh account's first brief lands in 1-3 min; catch it promptly
    return () => { live = false; clearInterval(t); };
  }, [session, api]);
  const seenInsightRef = useRef<string | null>(null);   // generated_at the user has already seen
  const [pinsRefreshing, setPinsRefreshing] = useState(false);
  // per-stock refreshes: keyed by symbol so several can run and each survives tab changes
  const [symRefreshing, setSymRefreshing] = useState<Record<string, boolean>>({});
  const [symFresh, setSymFresh] = useState<Record<string, Insight>>({});
  const refreshSymbol = useCallback(async (symbol: string) => {
    if (symRefreshing[symbol]) return;
    setSymRefreshing((m) => ({ ...m, [symbol]: true }));
    try {
      const v = await api.refreshSymbolInsights(symbol);
      if (v) {
        setSymFresh((m) => ({ ...m, [symbol]: v }));
        const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
        if (cur !== "news") setNewsAlert(true);
      }
    } finally { setSymRefreshing((m) => ({ ...m, [symbol]: false })); }
  }, [api, symRefreshing]);
  const [pinsFresh, setPinsFresh] = useState<Insight | null>(null);   // result of the last app-level refresh
  // Refresh lives here, not in a screen: it keeps running across tabs and lights the tab when done.
  const refreshInsights = useCallback(async () => {
    if (pinsRefreshing) return;
    setPinsRefreshing(true);
    try {
      const v = await api.refreshPortfolioInsights();
      if (v) {
        setPinsFresh(v);
        const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
        if (cur === "news") seenInsightRef.current = v.generated_at;
        if (cur !== "news") setNewsAlert(true);
        if (cur !== "news") setNewsAlert(true);
      }
    } finally { setPinsRefreshing(false); }
  }, [api, pinsRefreshing]);
  // background watch: a newer portfolio assessment (cron/refresh) lights the News tab, where it now lives
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try {
        const v = await api.getPortfolioInsights();
        if (!live || !v) return;
        // a connect moment survives the callback's full page load via sessionStorage
        let connectAt: string | null = null;
        try { connectAt = sessionStorage.getItem("assetly-connect-at"); } catch { /* none */ }
        const freshSinceConnect = !!connectAt && v.generated_at > connectAt;
        if (seenInsightRef.current === null && !freshSinceConnect) { seenInsightRef.current = v.generated_at; return; }
        if (v.generated_at !== seenInsightRef.current) {
          const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
          if (cur === "news") seenInsightRef.current = v.generated_at;
          if (cur !== "news") setNewsAlert(true);
          if (cur !== "news") setNewsAlert(true);
          // connect moment: a fresh assessment means news + intelligence are in -> ask the first question now
          if (connectPendingRef.current || freshSinceConnect) {
            setAutoAsk({ question: "Assess my portfolio and provide insights", key: connectPendingRef.current ?? connectAt ?? String(Date.now()) });
            connectPendingRef.current = null;
            try { sessionStorage.removeItem("assetly-connect-at"); } catch { /* none */ }
          }
        }
      } catch { /* quiet */ }
    };
    const t = setInterval(tick, 15000);   // 15s: a connect-moment assessment is noticed within seconds
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
      api.getFxRates().then((v) => setFx(v)).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The feed missed a handoff. Pull to retry.");
    }
  }, [api]);

  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"busy" | "ok" | "warn">("ok");
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
      setNoticeKind("busy"); setNotice("Connected · importing your positions");
      // the callback already queued the full chain server-side; here we wait for the import to land, then
      // kick the chain again as a belt-and-braces (idempotent: the per-user lock makes a duplicate sync yield)
      connectPendingRef.current = String(Date.now());
      try { sessionStorage.setItem("assetly-connect-at", new Date().toISOString()); } catch { /* storage unavailable */ }
      // Imported rows land over several seconds (callback sync + webhook syncs). Poll the book quickly
      // until it stops growing so Home shows the new stocks immediately, not on the next 60s tick.
      let lastCount = -1, stable = 0, ticks = 0;
      const settle = async () => {
        if (ticks++ > 30) return;                       // ~60s ceiling
        try {
          const r = await api.getPortfolio();
          setRows(r);
          if (r.length === lastCount) stable++; else { stable = 0; lastCount = r.length; }
        } catch { /* keep polling */ }
        if (stable < 3) setTimeout(settle, 2000);        // three quiet ticks = import has landed
      };
      void settle();
      api.snaptradeSync().then(async () => {
        await load(); void api.brokerageConnected();
        setNoticeKind("ok"); setNotice("Import complete · fresh intelligence and your brief are on the way"); setTimeout(() => setNotice(null), 8000);
      }).catch(() => { setNoticeKind("ok"); setNotice("Connected · import finishing in the background"); setTimeout(() => setNotice(null), 8000); });
    } else {
      setNoticeKind("warn");
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

  // Book-changed pipeline for MANUAL adds: a run of adds (one after another) is coalesced into ONE
  // orchestrator call, the same chain a brokerage connect runs (sync -> news -> intelligence -> assessment).
  // Trailing 25s debounce; flushed early when the user leaves the Add screen or backgrounds the app.
  const bookChangeRef = useRef<{ timer: number | null; pending: boolean }>({ timer: null, pending: false });
  const runBookPipeline = useCallback(() => {
    const b = bookChangeRef.current;
    if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    if (!b.pending) return;
    b.pending = false;
    connectPendingRef.current = String(Date.now());
    try { sessionStorage.setItem("assetly-connect-at", new Date().toISOString()); } catch { /* storage unavailable */ }
    setNoticeKind("busy"); setNotice("Updating your intelligence and portfolio assessment");
    void api.brokerageConnected().finally(() => {
      setNoticeKind("ok"); setNotice("Fresh intelligence and your assessment are on the way"); setTimeout(() => setNotice(null), 7000);
    });
  }, [api]);
  const scheduleBookChange = useCallback(() => {
    const b = bookChangeRef.current;
    b.pending = true;
    if (b.timer) clearTimeout(b.timer);
    b.timer = window.setTimeout(runBookPipeline, 25000);
  }, [runBookPipeline]);
  useEffect(() => { if (view.kind !== "add") runBookPipeline(); }, [view.kind, runBookPipeline]);   // leaving Add = the run is over
  useEffect(() => {
    const h = () => { if (document.visibilityState === "hidden") runBookPipeline(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [runBookPipeline]);

  const base = profile?.base_currency ?? "USD";
  const totals = useMemo(() => {
    let assets = 0, debt = 0, cost = 0, day = 0, unconverted = 0, mixed = false;
    for (const r of rows) {
      if (r.currency !== base) mixed = true;
      const v = convertCcy(r.value ?? 0, r.currency, base, fx);
      if (v === null) { unconverted += 1; continue; }   // no FX rate yet: exclude, never mislabel
      if (r.kind === "debt") { debt += v; continue; }   // debt reduces net worth only; it has no cost basis, G/L, or day move
      const c = convertCcy(r.cost_basis ?? 0, r.currency, base, fx) ?? 0;
      const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, base, fx) ?? 0;
      assets += v; cost += c; day += d;
    }
    const value = assets - debt;
    return { value, assets, debt, gl: assets - cost, cost, day, mixed, fx, unconverted };
  }, [rows, fx, base]);

  if (!authReady) return <div className="screen" aria-busy="true" />;
  if (!session) return <AuthScreen />;
  if (profile && !profile.onboarded_at) {
    return <Onboarding api={api} onDone={load} snaptrade={obSnap} onBookChanged={() => { bookChangeRef.current.pending = true; runBookPipeline(); }} />;
  }

  const go = (v: View) => { setError(null); if (v.kind === "tab" && v.tab === "ask") setAskAlert(false); if (v.kind === "tab" && v.tab === "news") setNewsAlert(false); if (v.kind === "tab" && v.tab === "home") setHomeAlert(false); setView(v); };
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

      {notice && (noticeKind === "warn"
        ? <div className="error-note" role="status">{notice}</div>
        : <div className={"status-note" + (noticeKind === "ok" ? " ok" : "")} role="status" data-testid="brokerage-notice">
            <span className="lead">{noticeKind === "busy" ? <span className="progress-dot" aria-hidden="true" /> : <span aria-hidden="true">✓</span>}{notice}</span>
          </div>)}
      {error && (
        <div className="error-note" role="alert">
          {error} <button className="chip" onClick={load} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      <main className="screen">
        <h1 className="sr-only">Assetly</h1>
        {view.kind === "add" && (
          <AddPosition api={api} onRefresh={load} onAdded={scheduleBookChange}
            onDone={() => go({ kind: "tab", tab: "home" })}
            onCancel={() => go({ kind: "tab", tab: "home" })} />
        )}
        {view.kind === "position" && (
          <PositionScreen api={api} dispKr={profile?.display_kr ?? "KRW"} row={rows.find((r) => r.holding_id === view.holdingId) ?? null}
            onChanged={load} onRemoved={async () => { await load(); go({ kind: "tab", tab: "home" }); }}
            onBack={() => go({ kind: "tab", tab: "home" })} />
        )}
        {view.kind === "tab" && view.tab === "home" && (
          <Home api={api} rows={rows} totals={totals} baseCurrency={profile?.base_currency ?? "USD"}
            dispUs={profile?.display_us ?? "USD"} dispKr={profile?.display_kr ?? "KRW"}
            onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })}
            briefBanner={briefBanner} onBriefBannerDone={() => setBriefBanner(null)} />
        )}
        {view.kind === "tab" && view.tab === "news" && (
          <NewsScreen api={api} rows={rows} dispKr={profile?.display_kr ?? "KRW"}
            onRefreshInsights={refreshInsights} insightsRefreshing={pinsRefreshing} freshInsights={pinsFresh}
            onInsightsSeen={(g) => { seenInsightRef.current = g; setNewsAlert(false); }}
            onRefreshSymbol={refreshSymbol} symbolRefreshing={symRefreshing} symbolFresh={symFresh} />
        )}
        {/* Ask stays mounted so an in-flight answer keeps generating across tabs */}
        <div style={view.kind === "tab" && view.tab === "ask" ? undefined : { display: "none" }}>
          <AskScreen api={api} autoAsk={autoAsk} onAnswered={() => {
            const v = viewRef.current;
            if (!(v.kind === "tab" && v.tab === "ask")) setAskAlert(true);
          }} />
        </div>
        {view.kind === "tab" && view.tab === "settings" && (
          <SettingsScreen api={api} profile={profile} rows={rows} onChanged={load} onSignedOut={() => setView({ kind: "tab", tab: "home" })} />
        )}
      </main>

      <nav className="tabbar" aria-label="Tabs">
        {(["home", "news", "ask", "settings"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go({ kind: "tab", tab: t })}>
            <TabIcon tab={t} active={tab === t} />
            {t === "home" ? "Home" : t === "news" ? "News" : t === "ask" ? "Ask" : "Settings"}
            {t === "ask" && askAlert && <span className="tab-alert" aria-label="New answer ready" />}
            {t === "news" && newsAlert && <span className="tab-alert" aria-label="New Assetly Intelligence" />}
            {t === "home" && homeAlert && <span className="tab-alert" aria-label="Your brief is ready" />}
          </button>
        ))}
      </nav>
    </>
  );
}
