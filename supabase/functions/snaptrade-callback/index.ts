// SnapTrade redirect target (public; verify_jwt=false).
// Commercial portal returns with ?u=<state> (no code exchange; the user secret is already stored):
// look up the state, kick the first import, bounce back to the app.
// The legacy OAuth-app path (?code&state) is kept for rows created before the commercial switch.
import { createClient } from "jsr:@supabase/supabase-js@2";

// INTERNAL_TOKEN: env first, Vault fallback. Env is frozen at deploy time, so a function deployed
// before the secret existed would otherwise send an empty token forever.
let _itok: string | null = null;
async function internalToken(): Promise<string> {
  if (_itok !== null) return _itok;
  const e = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (e) { _itok = e; return e; }
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" });
    _itok = String(data ?? "");
  } catch { _itok = ""; }
  return _itok;
}

const APP = "https://hodlerss.github.io/assetly/";
const go = (q: string) => new Response(null, { status: 302, headers: { Location: APP + q } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const kickSync = async (userId: string) => {
    // the connect moment runs the full intelligence chain, not just the import
    const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/brokerage-connected`, {
      method: "POST", headers: { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": await internalToken() },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => null);
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ }
  };

  // ---- commercial Connection Portal return ----
  const portalState = u.searchParams.get("u");
  if (portalState) {
    const { data: st } = await admin.from("snaptrade_oauth_states").select("user_id,created_at").eq("state", portalState).maybeSingle();
    await admin.from("snaptrade_oauth_states").delete().eq("state", portalState);
    if (!st || Date.now() - +new Date(st.created_at) > 3600000) return go("?snaptrade=expired");
    kickSync(st.user_id);
    return go("?snaptrade=connected");
  }

  // ---- legacy OAuth-app return ----
  const err = u.searchParams.get("error");
  const state = u.searchParams.get("state") ?? "";
  const code = u.searchParams.get("code") ?? "";
  if (err) return go("?snaptrade=denied");
  if (!state || !code) return go("?snaptrade=failed");
  const { data: st } = await admin.from("snaptrade_oauth_states").select("user_id,verifier,created_at").eq("state", state).maybeSingle();
  await admin.from("snaptrade_oauth_states").delete().eq("state", state);
  if (!st || Date.now() - +new Date(st.created_at) > 900000) return go("?snaptrade=expired");

  let cid = Deno.env.get("SNAPTRADE_CLIENT_ID") ?? "";
  if (!cid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_client_id" }); cid = data ?? ""; }
  let sec = Deno.env.get("SNAPTRADE_CONSUMER_KEY") ?? "";
  if (!sec) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_consumer_key" }); sec = data ?? ""; }

  const redirect = `${Deno.env.get("SUPABASE_URL")}/functions/v1/snaptrade-callback`;
  const tr = await fetch("https://api.snaptrade.com/oauth/token/", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${cid}:${sec}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: st.verifier, redirect_uri: redirect }),
  }).catch(() => null);
  if (!tr || !tr.ok) return go("?snaptrade=failed");
  const tk = await tr.json().catch(() => null);
  if (!tk?.refresh_token) return go("?snaptrade=failed");
  const sub = tk.sub;
  const stUserId = sub && typeof sub === "object" ? String((sub as { snaptrade_user_id?: string }).snaptrade_user_id ?? "") : String(sub ?? "");
  const { error: upErr } = await admin.from("snaptrade_tokens").upsert({
    user_id: st.user_id, mode: "oauth", refresh_token: tk.refresh_token, access_token: tk.access_token ?? null,
    access_expires_at: new Date(Date.now() + (Number(tk.expires_in) || 36000) * 1000).toISOString(),
    scope: tk.scope ?? "read", st_user_id: stUserId, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (upErr) return go("?snaptrade=failed");
  kickSync(st.user_id);
  return go("?snaptrade=connected");
});
