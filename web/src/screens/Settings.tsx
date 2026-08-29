import { useEffect, useState } from "react";
import type { Api, PortfolioRow, Profile } from "../lib/api";
import { timeAgo } from "../lib/format";

// Gap screen g2: account, currency matrix, markets, sign out. The matrix (totals / US assets /
// KR assets, each USD or KRW) appears once the book actually holds KRW — no clutter before that.
export function SettingsScreen({ api, profile, rows, onChanged, onSignedOut }: {
  api: Api; profile: Profile | null; rows: PortfolioRow[];
  onChanged: () => Promise<void> | void; onSignedOut: () => void;
}) {
  const [fx, setFx] = useState<{ rate: number; asOf: string } | null>(null);
  const [st, setSt] = useState<{ connected: boolean; last_sync_at?: string | null; institutions?: string[] } | null>(null);
  const [conns, setConns] = useState<{ id: string; institution: string; disabled: boolean }[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);   // two-tap confirm per connection
  const [stBusy, setStBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.snaptrade("status").then(async (r) => {
      if (!live) return;
      setSt({ connected: !!r.connected, last_sync_at: r.last_sync_at, institutions: r.institutions });
      if (r.connected) { try { const c = await api.snaptrade("connections"); if (live) setConns(c.connections ?? []); } catch { /* list stays empty */ } }
    }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [api]);
  const [busy, setBusy] = useState(false);
  const base = profile?.base_currency ?? "USD";
  const dispUs = profile?.display_us ?? "USD";
  const dispKr = profile?.display_kr ?? "KRW";
  const hasKrw = rows.some((r) => r.currency === "KRW") || base === "KRW";

  useEffect(() => {
    let live = true;
    if (hasKrw) api.getFxInfo().then((v) => { if (live) setFx(v); }).catch(() => {});
    return () => { live = false; };
  }, [api, hasKrw]);

  const ccyRow = (label: string, value: "USD" | "KRW", pick: (c: "USD" | "KRW") => Promise<void>) => (
    <div className="row" style={{ alignItems: "center" }}>
      <span>{label}</span>
      <span className="chips" style={{ padding: 0 }} role="group" aria-label={`${label} currency`}>
        {(["USD", "KRW"] as const).map((c) => (
          <button key={c} className="chip" aria-pressed={value === c} disabled={busy}
            aria-label={`${label} ${c === "USD" ? "$ USD" : "₩ KRW"}`}
            onClick={async () => {
              if (c === value) return;
              setBusy(true);
              try { await pick(c); await onChanged(); } finally { setBusy(false); }
            }}>{c === "USD" ? "$ USD" : "₩ KRW"}</button>
        ))}
      </span>
    </div>
  );

  return (
    <>
      <h2 className="h1">Settings</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><span>Signed in as</span><span className="sub">{profile?.display_name ?? "—"}</span></div>
        {hasKrw ? (
          <>
            {ccyRow("View totals in", base, (c) => api.updateBaseCurrency(c))}
            {ccyRow("US assets in", dispUs, (c) => api.updateDisplayCcy({ display_us: c }))}
            {ccyRow("KR assets in", dispKr, (c) => api.updateDisplayCcy({ display_kr: c }))}
          </>
        ) : (
          <div className="row"><span>Base currency</span><span className="num">{base}</span></div>
        )}
        {hasKrw && fx && (
          <div className="row"><span>Exchange rate</span>
            <span className="sub num" data-testid="fx-rate-row">₩{Math.round(fx.rate).toLocaleString("en-US")}/$ · {timeAgo(fx.asOf)}</span></div>
        )}
        <div className="row"><span>Markets</span><span className="sub">{(profile?.markets ?? []).join(" · ") || "—"}</span></div>
        <div className="row"><span>Price cadence</span><span className="sub num">every 60s market hours</span></div>
      </div>
      <div className="card" style={{ marginBottom: 14 }} data-testid="snaptrade-card">
        <div className="row"><span>Brokerage sync</span>
          <span className="sub">{st?.connected ? `Connected · ${(st.institutions ?? []).join(", ") || "SnapTrade"}` : "Not connected"}</span></div>
        {st?.connected && st.last_sync_at && (
          <div className="row"><span>Last import</span><span className="sub num">{timeAgo(st.last_sync_at)}</span></div>
        )}
        {conns.map((c) => (
          <div className="row" key={c.id}>
            <span>{c.institution}{c.disabled ? <span className="sub"> · needs reconnect</span> : null}</span>
            <button className="chip" disabled={stBusy} onClick={async () => {
              if (removing !== c.id) { setRemoving(c.id); setTimeout(() => setRemoving((v) => v === c.id ? null : v), 4000); return; }
              setStBusy(true);
              try {
                await api.snaptrade("remove_connection", { authorization_id: c.id });
                setConns((xs) => xs.filter((x) => x.id !== c.id));
                setRemoving(null);
                await onChanged();
              } finally { setStBusy(false); }
            }}>{removing === c.id ? "Sure? Remove" : "Remove"}</button>
          </div>
        ))}
        <div className="chips" style={{ padding: "10px 14px 4px" }}>
          {!st?.connected && (
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { const r = await api.snaptrade("connect"); if (r.url) window.location.assign(r.url); } finally { setStBusy(false); }
            }}>Connect brokerage</button>
          )}
          {st?.connected && (<>
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { const r = await api.snaptrade("connect"); if (r.url) window.location.assign(r.url); } finally { setStBusy(false); }
            }}>+ Add another brokerage</button>
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { await api.snaptradeSync(); await onChanged(); const r = await api.snaptrade("status"); setSt({ connected: !!r.connected, last_sync_at: r.last_sync_at, institutions: r.institutions }); }
              finally { setStBusy(false); }
            }}>Sync now</button>
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { await api.snaptrade("disconnect"); setSt({ connected: false }); } finally { setStBusy(false); }
            }}>Disconnect all</button>
          </>)}
        </div>
      </div>
      <button className="btn secondary" onClick={async () => { await api.signOut(); onSignedOut(); }}>Sign out</button>
      <p className="mutedc" style={{ fontSize: 12.5, marginTop: 14 }}>
        Deleting your account removes every holding and lot permanently. Contact support until in-app deletion ships in the next lap.
      </p>
    </>
  );
}
