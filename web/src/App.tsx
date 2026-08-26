import { useCallback, useEffect, useMemo, useState } from "react";
import { convertCcy, dayChangeAmount } from "./lib/format";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { api as defaultApi, type Api, type PortfolioRow, type Profile } from "./lib/api";
import { AuthScreen } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Holdings } from "./screens/Holdings";
import { PositionScreen } from "./screens/Position";
import { AddPosition } from "./screens/AddPosition";
import { NewsScreen } from "./screens/News";
import { SettingsScreen } from "./screens/Settings";

export type Tab = "home" | "holdings" | "news" | "settings";
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
  const [lastSync, setLastSync] = useState<Date | null>(null);

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
      api.getFxRate().then((v) => setFx(v)).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The feed missed a handoff. Pull to retry.");
    }
  }, [api]);

  useEffect(() => {
    if (!session) { setProfile(null); setRows([]); return; }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [session, load]);

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
    return <Onboarding api={api} onDone={load} />;
  }

  const go = (v: View) => { setError(null); setView(v); };
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
        <span className="status-line" data-testid="status-line">
          {lastSync ? `synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "syncing…"}
        </span>
      </header>

      {error && (
        <div className="error-note" role="alert">
          {error} <button className="chip" onClick={load} style={{ marginLeft: 8 }}>Retry</button>
        </div>
      )}

      <main className="screen">
        <h1 className="sr-only">Assetly</h1>
        {view.kind === "add" && (
          <AddPosition api={api} onDone={async () => { await load(); go({ kind: "tab", tab: "holdings" }); }} onCancel={() => go({ kind: "tab", tab: "holdings" })} />
        )}
        {view.kind === "position" && (
          <PositionScreen api={api} row={rows.find((r) => r.holding_id === view.holdingId) ?? null}
            onChanged={load} onRemoved={async () => { await load(); go({ kind: "tab", tab: "holdings" }); }}
            onBack={() => go({ kind: "tab", tab: "holdings" })} />
        )}
        {view.kind === "tab" && view.tab === "home" && (
          <Home rows={rows} totals={totals} baseCurrency={profile?.base_currency ?? "USD"}
            onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })} />
        )}
        {view.kind === "tab" && view.tab === "holdings" && (
          <Holdings rows={rows} api={api} fxRate={fx} onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })} />
        )}
        {view.kind === "tab" && view.tab === "news" && <NewsScreen api={api} rows={rows} />}
        {view.kind === "tab" && view.tab === "settings" && (
          <SettingsScreen api={api} profile={profile} rows={rows} onChanged={load} onSignedOut={() => setView({ kind: "tab", tab: "home" })} />
        )}
      </main>

      <nav className="tabbar" aria-label="Tabs">
        {(["home", "holdings", "news", "settings"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go({ kind: "tab", tab: t })}>
            <span className="dot" aria-hidden="true" />
            {t === "home" ? "Home" : t === "holdings" ? "Holdings" : t === "news" ? "News" : "Settings"}
          </button>
        ))}
      </nav>
    </>
  );
}
