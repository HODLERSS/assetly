// SnapTrade connect: commercial-first (Connection Portal with in-app broker picker).
// status / connect / disconnect for the signed-in user. The dormant OAuth-app path
// remains for rows created before the commercial switch.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const canon = (o: unknown): string => {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  const r = o as Record<string, unknown>;
  return "{" + Object.keys(r).sort().map((k) => JSON.stringify(k) + ":" + canon(r[k])).join(",") + "}";
};
async function stCall(cid: string, key: string, method: string, path: string, extraQuery: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const ts = Math.floor(Date.now() / 1000);
  const q = `clientId=${cid}&timestamp=${ts}` + (extraQuery ? `&${extraQuery}` : "");
  const payload = { content: body ?? null, path: `/api/v1${path}`, query: q };
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode(canon(payload))))));
  const r = await fetch(`https://api.snaptrade.com/api/v1${path}?${q}`, {
    method, headers: { Signature: sig, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!r) return { status: 0, data: null };
  return { status: r.status, data: await r.json().catch(() => null) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: ud } = await admin.auth.getUser(jwt);
  const uid = ud?.user?.id;
  if (!uid) return json({ ok: false, error: "not signed in" }, 401);
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "status";

  let cid = Deno.env.get("SNAPTRADE_COMM_CLIENT_ID") ?? "";
  if (!cid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_client_id" }); cid = data ?? ""; }
  let key = Deno.env.get("SNAPTRADE_COMM_CONSUMER_KEY") ?? "";
  if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_consumer_key" }); key = data ?? ""; }
  if (!cid || !key) return json({ ok: false, error: "not configured" }, 500);

  const { data: row } = await admin.from("snaptrade_tokens")
    .select("mode, st_secret, refresh_token, connected_at, last_sync_at, institutions").eq("user_id", uid).maybeSingle();

  if (action === "status") {
    const connected = !!row && ((row.institutions ?? []).length > 0 || !!row.last_sync_at);
    return json({ ok: true, connected, pending: !!row && !connected, last_sync_at: row?.last_sync_at ?? null, institutions: row?.institutions ?? [] });
  }
  if (action === "connections") {
    if (!row?.st_secret) return json({ ok: true, connections: [] });
    const uq = `userId=${encodeURIComponent(uid)}&userSecret=${encodeURIComponent(row.st_secret)}`;
    const res = await stCall(cid, key, "GET", "/authorizations", uq, null);
    const list = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]).map((a) => ({
      id: String(a.id ?? ""),
      institution: String((a.brokerage as { display_name?: string; name?: string } | undefined)?.display_name ?? (a.brokerage as { name?: string } | undefined)?.name ?? a.name ?? "Brokerage"),
      disabled: a.disabled === true,
      created: String(a.created_date ?? ""),
    })) : [];
    return json({ ok: true, connections: list });
  }
  if (action === "remove_connection") {
    const authId = typeof body.authorization_id === "string" ? body.authorization_id : "";
    if (!authId || !row?.st_secret) return json({ ok: false, error: "missing connection" }, 400);
    const uq = `userId=${encodeURIComponent(uid)}&userSecret=${encodeURIComponent(row.st_secret)}`;
    const res = await stCall(cid, key, "DELETE", `/authorizations/${authId}`, uq, null);
    if (res.status >= 300) return json({ ok: false, error: "could not remove connection" }, 502);
    // sync afterwards so orphan cleanup drops that connection's holdings
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pr = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/snaptrade-sync`, {
      method: "POST", headers: { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: uid }),
    }).catch(() => null);
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(pr); } catch { /* ignore */ }
    return json({ ok: true, removed: authId });
  }
  if (action === "disconnect") {
    if (row?.mode === "commercial" || row?.st_secret) {
      await stCall(cid, key, "DELETE", "/snapTrade/deleteUser", `userId=${encodeURIComponent(uid)}`, null);
    } else if (row?.refresh_token) {
      let ocid = Deno.env.get("SNAPTRADE_CLIENT_ID") ?? "";
      if (!ocid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_client_id" }); ocid = data ?? ""; }
      let osec = Deno.env.get("SNAPTRADE_CONSUMER_KEY") ?? "";
      if (!osec) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_consumer_key" }); osec = data ?? ""; }
      await fetch("https://api.snaptrade.com/oauth/revoke_token/", {
        method: "POST", headers: { Authorization: "Basic " + btoa(`${ocid}:${osec}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.refresh_token, token_type_hint: "refresh_token" }),
      }).catch(() => null);
    }
    await admin.from("snaptrade_tokens").delete().eq("user_id", uid);
    return json({ ok: true, connected: false });
  }
  // action === "connect": ensure a SnapTrade user, then hand back the Connection Portal URL
  let secret = row?.st_secret ?? null;
  if (!secret) {
    const reg = await stCall(cid, key, "POST", "/snapTrade/registerUser", "", { userId: uid });
    secret = (reg.data as { userSecret?: string } | null)?.userSecret ?? null;
    if (!secret && reg.status === 400) {
      // already registered under this clientId but the secret is lost: reset the user
      await stCall(cid, key, "DELETE", "/snapTrade/deleteUser", `userId=${encodeURIComponent(uid)}`, null);
      const reg2 = await stCall(cid, key, "POST", "/snapTrade/registerUser", "", { userId: uid });
      secret = (reg2.data as { userSecret?: string } | null)?.userSecret ?? null;
    }
    if (!secret) return json({ ok: false, error: "brokerage service unavailable" }, 502);
    await admin.from("snaptrade_tokens").upsert({
      user_id: uid, mode: "commercial", st_secret: secret, st_user_id: uid, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  }
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await admin.from("snaptrade_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
  await admin.from("snaptrade_oauth_states").insert({ state, user_id: uid, verifier: "portal" });
  const cb = `${Deno.env.get("SUPABASE_URL")}/functions/v1/snaptrade-callback?u=${state}`;
  const login = await stCall(cid, key, "POST", "/snapTrade/login",
    `userId=${encodeURIComponent(uid)}&userSecret=${encodeURIComponent(secret)}`,
    { immediateRedirect: true, customRedirect: cb, connectionType: "read" });
  const url = (login.data as { redirectURI?: string } | null)?.redirectURI ?? null;
  if (!url) return json({ ok: false, error: "could not open the connection portal" }, 502);
  return json({ ok: true, url });
});
