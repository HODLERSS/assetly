// SnapTrade OAuth redirect target (public; verify_jwt=false). Exchanges the code,
// stores tokens, kicks the first import in the background, bounces back to the app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP = "https://hodlerss.github.io/assetly/";
const go = (q: string) => new Response(null, { status: 302, headers: { Location: APP + q } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const err = u.searchParams.get("error");
  const state = u.searchParams.get("state") ?? "";
  const code = u.searchParams.get("code") ?? "";
  if (err) return go("?snaptrade=denied");
  if (!state || !code) return go("?snaptrade=failed");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    user_id: st.user_id, refresh_token: tk.refresh_token, access_token: tk.access_token ?? null,
    access_expires_at: new Date(Date.now() + (Number(tk.expires_in) || 36000) * 1000).toISOString(),
    scope: tk.scope ?? "read", st_user_id: stUserId, updated_at: new Date().toISOString(),
  });
  if (upErr) return go("?snaptrade=failed");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const doSync = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/snaptrade-sync`, {
    method: "POST", headers: { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: st.user_id }),
  }).catch(() => null);
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(doSync); } catch { /* ignore */ }
  return go("?snaptrade=connected");
});
