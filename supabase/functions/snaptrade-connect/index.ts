// SnapTrade OAuth: status / start-connect / disconnect for the signed-in user.
// The stored "consumer key" secret is the OAuth app CLIENT SECRET (naming kept for vault consistency).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: ud } = await admin.auth.getUser(jwt);
  const uid = ud?.user?.id;
  if (!uid) return json({ ok: false, error: "not signed in" }, 401);
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "status";

  let cid = Deno.env.get("SNAPTRADE_CLIENT_ID") ?? "";
  if (!cid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_client_id" }); cid = data ?? ""; }
  let sec = Deno.env.get("SNAPTRADE_CONSUMER_KEY") ?? "";
  if (!sec) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_consumer_key" }); sec = data ?? ""; }
  if (!cid || !sec) return json({ ok: false, error: "not configured" }, 500);

  if (action === "status") {
    const { data: t } = await admin.from("snaptrade_tokens").select("connected_at,last_sync_at,institutions").eq("user_id", uid).maybeSingle();
    return json({ ok: true, connected: !!t, last_sync_at: t?.last_sync_at ?? null, institutions: t?.institutions ?? [] });
  }
  if (action === "disconnect") {
    const { data: t } = await admin.from("snaptrade_tokens").select("refresh_token").eq("user_id", uid).maybeSingle();
    if (t) {
      await fetch("https://api.snaptrade.com/oauth/revoke_token/", {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${cid}:${sec}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t.refresh_token, token_type_hint: "refresh_token" }),
      }).catch(() => null);
      await admin.from("snaptrade_tokens").delete().eq("user_id", uid);
    }
    // imported rows stay (now user-owned); they just stop refreshing
    return json({ ok: true, connected: false });
  }
  // action === "connect": PKCE + state, then hand back the authorize URL
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await admin.from("snaptrade_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
  const { error: insErr } = await admin.from("snaptrade_oauth_states").insert({ state, user_id: uid, verifier });
  if (insErr) return json({ ok: false, error: insErr.message }, 500);
  const redirect = `${Deno.env.get("SUPABASE_URL")}/functions/v1/snaptrade-callback`;
  const url = `https://dashboard.snaptrade.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(cid)}&redirect_uri=${encodeURIComponent(redirect)}&scope=read&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
  return json({ ok: true, url });
});
