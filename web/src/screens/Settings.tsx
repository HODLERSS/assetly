import { useEffect, useState } from "react";
import type { Api, PortfolioRow, Profile } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";
import { InvestorQuiz, investorLabel } from "../components/InvestorQuiz";
import { ConnectNote, connectMsg, type ConnectMsg } from "../components/ConnectNote";
import { timeAgo } from "../lib/format";
import { getTheme, setTheme, THEME_CHOICES, type ThemeChoice } from "../lib/theme";
import { isNative, openConnectPortal, openExternal, platformTag } from "../lib/native";
import { pushEnabled, registerPush, setPushEnabled } from "../lib/push";
import { LEGAL_BASE } from "../lib/legal";
import { marketOf } from "../lib/markets";
import { useInFlight } from "../lib/inflight";

// injected at build from package.json (vite.config.ts); "1.0" showed in the 1.0.1 build (r2 audits)
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

// Gap screen g2: account, currency matrix, markets, sign out. The matrix (totals / US assets /
// KR assets, each USD or KRW) appears once the book actually holds KRW — no clutter before that.
export function SettingsScreen({ api, profile, rows, email = null, onChanged, onSignedOut, bookUnknown = false }: {
  api: Api; profile: Profile | null; rows: PortfolioRow[]; email?: string | null;
  /** no book has loaded yet: the markets row says so instead of a placeholder dash */
  bookUnknown?: boolean;
  onChanged: () => Promise<void> | void; onSignedOut: () => void;
}) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => getTheme());
  const [fx, setFx] = useState<{ rate: number; asOf: string } | null>(null);
  const [st, setSt] = useState<{ connected: boolean; last_sync_at?: string | null; institutions?: string[] } | null>(null);
  const [conns, setConns] = useState<{ id: string; institution: string; disabled: boolean }[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [removing, setRemoving] = useState<{ id: string; institution: string } | null>(null);   // keep/delete sheet
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [stBusy, setStBusy] = useState(false);
  const [connErr, setConnErr] = useState<ConnectMsg | null>(null);
  useEffect(() => {
    let live = true;
    api.snaptrade("status").then(async (r) => {
      if (!live) return;
      setSt({ connected: !!r.connected, last_sync_at: r.last_sync_at, institutions: r.institutions });
      if (r.connected) {
        try { const c = await api.snaptrade("connections"); if (live) setConns(c.connections ?? []); } catch { /* list stays empty */ }
        try { const x = await api.snaptrade("exclusions"); if (live) setExcluded(x.exclusions ?? []); } catch { /* none */ }
      }
    }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [api]);
  const [busy, setBusy] = useState(false);
  const [editInv, setEditInv] = useState(false);
  const [push, setPush] = useState<boolean>(() => pushEnabled());
  const [pushBusy, setPushBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);          // confirm sheet
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [signingOut, signOut] = useInFlight();
  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (push) { setPushEnabled(false); setPush(false); await api.removePushToken().catch(() => {}); }
      else {
        setPushEnabled(true); setPush(true);
        // registerPush asks for permission on iOS and stores the token; on the web it is a no-op
        await registerPush((token) => api.savePushToken(token));
      }
    } finally { setPushBusy(false); }
  };
  const base = profile?.base_currency ?? "USD";
  const dispUs = profile?.display_us ?? "USD";
  const dispKr = profile?.display_kr ?? "KRW";
  const hasKrw = rows.some((r) => r.currency === "KRW") || base === "KRW";
  const heldMarkets = [...new Set(rows.map((r) => marketOf(r)).filter((m): m is "US" | "KR" | "CRYPTO" => m !== null))]
    .sort((a, b) => ["US", "KR", "CRYPTO"].indexOf(a) - ["US", "KR", "CRYPTO"].indexOf(b))
    .map((m) => (m === "KR" ? "Korea" : m === "CRYPTO" ? "Crypto" : "US"));

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
        <div className="row settings-signedin"><span>Signed in as</span><span className="sub settings-email" data-testid="signed-in-as">{email ?? profile?.display_name ?? "—"}</span></div>
        {hasKrw ? (
          <>
            {ccyRow("View totals in", base, (c) => api.updateBaseCurrency(c))}
            {ccyRow("US assets in", dispUs, (c) => api.updateDisplayCcy({ display_us: c }))}
            {ccyRow("KR assets in", dispKr, (c) => api.updateDisplayCcy({ display_kr: c }))}
          </>
        ) : (
          // the same quiet value as every other row's ("USD" was 15px ink beside 12.5px muted; r3-r5 design m7)
          <div className="row"><span>Base currency</span><span className="sub" data-testid="base-currency">{base}</span></div>
        )}
        {hasKrw && fx && (
          <div className="row"><span>Exchange rate</span>
            <span className="sub num" data-testid="fx-rate-row">₩{Math.round(fx.rate).toLocaleString("en-US")}/$ · {timeAgo(fx.asOf)}</span></div>
        )}
        <div className="row settings-appearance" style={{ alignItems: "center" }} data-testid="appearance-row">
          <span>Appearance</span>
          <span className="chips" role="group" aria-label="Appearance">
            {THEME_CHOICES.map((t) => (
              <button key={t.id} className="chip" aria-pressed={theme === t.id}
                onClick={() => { setThemeState(t.id); setTheme(t.id); }}>{t.label}</button>
            ))}
          </span>
        </div>
        {/* the markets actually held, not the ones picked at setup ("Markets: US" with two KRX holdings) */}
        <div className="row"><span>Markets</span><span className="sub" data-testid="markets-row">{heldMarkets.length ? heldMarkets.join(" · ")
          : bookUnknown ? "Not loaded yet" : (profile?.markets ?? []).join(" · ") || "None yet"}</span></div>
        <div className="row"><span>Price updates</span><span className="sub">Every minute, market hours</span></div>
      </div>
      <div className="card" style={{ marginBottom: 14 }} data-testid="investor-card">
        <div className="row investor-row" style={{ alignItems: "center" }}>
          <span>Investor profile<br /><span className="sub" data-testid="investor-label">{investorLabel(profile?.investor ?? INVESTOR_DEFAULT)}</span></span>
          <button className="chip" onClick={() => setEditInv(!editInv)}>{editInv ? "Close" : "Edit"}</button>
        </div>
        {editInv && (
          <div style={{ padding: "10px 14px 14px" }}>
            <InvestorQuiz initial={profile?.investor ?? INVESTOR_DEFAULT} doneLabel="Save"
              onDone={async (v) => { await api.updateInvestor(v); setEditInv(false); await onChanged(); }} />
            <p className="mutedc" style={{ fontSize: 12, margin: "10px 0 0" }}>Your next briefs, assessment and answers are written for this profile.</p>
          </div>
        )}
      </div>
      <div className="card" style={{ marginBottom: 14 }} data-testid="snaptrade-card">
        <div className="row"><span>Brokerage sync</span>
          <span className="sub">{st?.connected ? `Connected · ${(st.institutions ?? []).join(", ") || "SnapTrade"}` : "Not connected"}</span></div>
        {st?.connected && st.last_sync_at && (
          <div className="row"><span>Last import</span><span className="sub num">{timeAgo(st.last_sync_at)}</span></div>
        )}
        {removeErr && <div className="error-note" role="alert">{removeErr}</div>}
        {conns.map((c) => (
          <div className="row" key={c.id}>
            <span>{c.institution}{c.disabled ? <span className="sub"> · needs reconnect</span> : null}</span>
            <span style={{ display: "flex", gap: 8 }}>
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { await api.snaptradeSync(); await onChanged(); const r = await api.snaptrade("status"); setSt({ connected: !!r.connected, last_sync_at: r.last_sync_at, institutions: r.institutions }); }
              finally { setStBusy(false); }
            }}>Sync now</button>
            <button className="chip" disabled={stBusy} onClick={() => { setRemoveErr(null); setRemoving({ id: c.id, institution: c.institution }); }}>Remove</button>
            </span>
          </div>
        ))}
        {excluded.length > 0 && (
          <div className="row" data-testid="excluded-row">
            <span>Not imported<span className="sub"> · {excluded.join(", ")}</span></span>
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try { for (const sym of excluded) await api.snaptrade("restore", { symbol: sym }); setExcluded([]); await onChanged(); }
              finally { setStBusy(false); }
            }}>Restore</button>
          </div>
        )}
        <div className="chips" style={{ padding: "10px 14px 4px" }}>
          {!st?.connected && (
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              setConnErr(null);
              try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); }
              catch (e) { setConnErr(connectMsg(e)); }
              finally { setStBusy(false); }
            }}>Connect brokerage</button>
          )}
          {st?.connected && (
            <button className="chip" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              setConnErr(null);
              try { const r = await api.snaptrade("connect", { platform: platformTag() }); if (r.url) await openConnectPortal(r.url); }
              catch (e) { setConnErr(connectMsg(e)); }
              finally { setStBusy(false); }
            }}>+ Add another brokerage</button>
          )}
        </div>
        <ConnectNote msg={connErr} testId="settings-connect-error" style={{ margin: "4px 14px 12px" }} />
      </div>
      {removing && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Remove brokerage connection">
          <div className="sheet">
            <h2>Disconnect {removing.institution}?</h2>
            <p className="mutedc" style={{ marginBottom: 14 }}>
              Assetly stops syncing with {removing.institution}. Your imported positions can stay as regular holdings you manage yourself, or be removed.
            </p>
            <button className="btn" disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try {
                const r = await api.snaptrade("remove_connection", { authorization_id: removing.id, keep_holdings: true });
                if (!r.ok) throw new Error("Could not disconnect. Try again in a moment.");
                setConns((xs) => xs.filter((x) => x.id !== removing.id)); setRemoving(null); await onChanged();
              } catch (e) { setRemoveErr(e instanceof Error ? e.message : "Could not disconnect."); setRemoving(null); }
              finally { setStBusy(false); }
            }}>Disconnect, keep my positions</button>
            <button className="btn danger" style={{ marginTop: 8 }} disabled={stBusy} onClick={async () => {
              setStBusy(true);
              try {
                const r = await api.snaptrade("remove_connection", { authorization_id: removing.id, keep_holdings: false });
                if (!r.ok) throw new Error("Could not disconnect. Try again in a moment.");
                setConns((xs) => xs.filter((x) => x.id !== removing.id)); setRemoving(null); await onChanged();
              } catch (e) { setRemoveErr(e instanceof Error ? e.message : "Could not disconnect."); setRemoving(null); }
              finally { setStBusy(false); }
            }}>Disconnect and remove them</button>
            <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setRemoving(null)}>Keep connected</button>
          </div>
        </div>
      )}
      {isNative() && (
        <div className="card" style={{ marginBottom: 14 }} data-testid="notify-card">
          <div className="row" style={{ alignItems: "center" }}>
            <span>Brief notifications<br /><span className="sub">A push when your morning, midday and closing briefs are ready</span></span>
            <button className="chip" role="switch" aria-checked={push} disabled={pushBusy} onClick={togglePush} data-testid="push-toggle">{push ? "On" : "Off"}</button>
          </div>
        </div>
      )}
      <div className="card" style={{ marginBottom: 14 }} data-testid="legal-card">
        <div className="row" style={{ alignItems: "center" }}><span>Privacy policy</span>
          <button className="chip" onClick={() => void openExternal(`${LEGAL_BASE}/privacy.html`)}>Open</button></div>
        <div className="row" style={{ alignItems: "center" }}><span>Terms of use</span>
          <button className="chip" onClick={() => void openExternal(`${LEGAL_BASE}/terms.html`)}>Open</button></div>
        <div className="row" style={{ alignItems: "center" }}><span>Support</span>
          <button className="chip" onClick={() => void openExternal(`${LEGAL_BASE}/support.html`)}>Open</button></div>
        <div className="row"><span>Version</span><span className="sub num">{APP_VERSION}</span></div>
        <p className="mutedc" style={{ fontSize: 12.5, padding: "10px 14px 12px" }} data-testid="not-advice">
          Assetly describes what you own. It is information, not investment advice, and never a recommendation to buy or sell.
        </p>
      </div>
      <button className="btn secondary" disabled={signingOut} onClick={() => signOut(async () => { await api.signOut(); onSignedOut(); })}>{signingOut ? "Signing out…" : "Sign out"}</button>
      <button className="btn danger-quiet" style={{ marginTop: 10 }} onClick={() => { setDeleteErr(null); setDeleting(true); }} data-testid="delete-account">Delete account</button>
      {deleting && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Delete account">
          <div className="sheet">
            <h2>Delete your account?</h2>
            <p className="mutedc" style={{ marginBottom: 14 }}>
              This permanently deletes your holdings, briefs and brokerage connection. It can't be undone.
            </p>
            {deleteErr && <div className="error-note" role="alert">{deleteErr}</div>}
            <button className="btn danger" disabled={deleteBusy} data-testid="delete-confirm" onClick={async () => {
              setDeleteBusy(true); setDeleteErr(null);
              try { await api.deleteAccount(); setDeleting(false); onSignedOut(); }
              catch (e) { setDeleteErr(e instanceof Error ? e.message : "Could not delete the account. Try again."); }
              finally { setDeleteBusy(false); }
            }}>{deleteBusy ? "Deleting…" : "Delete everything"}</button>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={deleteBusy} onClick={() => setDeleting(false)}>Keep my account</button>
          </div>
        </div>
      )}
    </>
  );
}
