import type { Api, Profile } from "../lib/api";

// Gap screen g2: account, currency, markets, sign out. (Account deletion runbook in ops docs —
// App Store requires it; server-side RPC ships with the production checklist.)
export function SettingsScreen({ api, profile, onSignedOut }: {
  api: Api; profile: Profile | null; onSignedOut: () => void;
}) {
  return (
    <>
      <h2 className="h1">Settings</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><span>Signed in as</span><span className="sub">{profile?.display_name ?? "—"}</span></div>
        <div className="row"><span>Base currency</span><span className="num">{profile?.base_currency ?? "USD"}</span></div>
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
