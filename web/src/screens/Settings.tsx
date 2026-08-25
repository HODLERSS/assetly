import { useEffect, useState } from "react";
import type { Api, PortfolioRow, Profile } from "../lib/api";
import { timeAgo } from "../lib/format";

// Gap screen g2: account, currency, markets, sign out. The USD/KRW view toggle appears
// once the book actually holds KRW (or the base is already KRW) — no clutter before that.
export function SettingsScreen({ api, profile, rows, onChanged, onSignedOut }: {
  api: Api; profile: Profile | null; rows: PortfolioRow[];
  onChanged: () => Promise<void> | void; onSignedOut: () => void;
}) {
  const [fx, setFx] = useState<{ rate: number; asOf: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = profile?.base_currency ?? "USD";
  const hasKrw = rows.some((r) => r.currency === "KRW") || base === "KRW";

  useEffect(() => {
    let live = true;
    if (hasKrw) api.getFxInfo().then((v) => { if (live) setFx(v); }).catch(() => {});
    return () => { live = false; };
  }, [api, hasKrw]);

  return (
    <>
      <h2 className="h1">Settings</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><span>Signed in as</span><span className="sub">{profile?.display_name ?? "—"}</span></div>
        {hasKrw ? (
          <div className="row" style={{ alignItems: "center" }}>
            <span>View totals in</span>
            <span className="chips" style={{ padding: 0 }} role="group" aria-label="Base currency">
              {(["USD", "KRW"] as const).map((c) => (
                <button key={c} className="chip" aria-pressed={base === c} disabled={busy} onClick={async () => {
                  if (c === base) return;
                  setBusy(true);
                  try { await api.updateBaseCurrency(c); await onChanged(); } finally { setBusy(false); }
                }}>{c === "USD" ? "$ USD" : "₩ KRW"}</button>
              ))}
            </span>
          </div>
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
      <button className="btn secondary" onClick={async () => { await api.signOut(); onSignedOut(); }}>Sign out</button>
      <p className="mutedc" style={{ fontSize: 12.5, marginTop: 14 }}>
        Deleting your account removes every holding and lot permanently. Contact support until in-app deletion ships in the next lap.
      </p>
    </>
  );
}
