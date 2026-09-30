import { useCallback, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { AdminPushScreen, type AdminCall } from "./AdminPush";

// Sign in (GitHub or Google through Supabase Auth), then the push tool. Who counts as an admin is decided only by
// the admin-push function: a verified token, a confirmed email on the account, and the allowlist.
export function AdminApp({ sb }: { sb: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);
  const call: AdminCall = useCallback(async (body) => {
    const { data, error } = await sb.functions.invoke("admin-push", { body });
    if (!error) return { status: 200, body: (data ?? {}) as Record<string, unknown> };
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) return { status: ctx.status, body: (await ctx.json().catch(() => ({ ok: false, error: `HTTP ${ctx.status}` }))) as Record<string, unknown> };
    return { status: 0, body: { ok: false, error: error.message || "Network error" } };
  }, [sb]);
  const signIn = async (provider: "github" | "google") => {
    setErr(null);
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + "/" } });
    if (error) setErr(error.message);
  };

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <svg width="26" height="12" viewBox="0 0 32 12" aria-hidden="true">
            <rect x="0" y="3" width="14" height="6" rx="3" fill="currentColor" />
            <rect x="17" y="3" width="14" height="6" rx="3" fill="currentColor" opacity="0.45" />
          </svg>
          Assetly Admin
        </span>
      </header>
      <main className="screen">
        {session === undefined ? <p className="empty" aria-busy="true">Loading…</p>
          : session === null ? (
            <div className="admin-signin" data-testid="admin-signin">
              <h1 className="h1">Assetly Admin</h1>
              <p className="sub" style={{ marginBottom: 18 }}>Internal. Sign in with an admin account.</p>
              <button className="btn" onClick={() => void signIn("github")} data-testid="signin-github">Continue with GitHub</button>
              <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => void signIn("google")} data-testid="signin-google">Continue with Google</button>
              {err && <div className="error-note" role="alert" style={{ marginTop: 12 }}>{err}</div>}
            </div>
          ) : <AdminPushScreen call={call} onSignOut={() => void sb.auth.signOut()} />}
      </main>
    </>
  );
}
