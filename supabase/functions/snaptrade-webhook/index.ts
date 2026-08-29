// SnapTrade webhook receiver (public; verify_jwt=false). SnapTrade pushes events when a
// connection is added or holdings change; each relevant event triggers a sync for that user.
// Verification: HMAC-SHA256(base64) of the raw body with the commercial consumer key must
// match the Signature header when present; the clientId in the payload must always match ours.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rawBody = await req.text();
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })() as Record<string, unknown> | null;
  if (!body) return new Response("bad", { status: 400 });

  let ccid = Deno.env.get("SNAPTRADE_COMM_CLIENT_ID") ?? "";
  if (!ccid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_client_id" }); ccid = data ?? ""; }
  let ckey = Deno.env.get("SNAPTRADE_COMM_CONSUMER_KEY") ?? "";
  if (!ckey) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_consumer_key" }); ckey = data ?? ""; }

  const clientIdInBody = String(body.clientId ?? "");
  if (clientIdInBody && clientIdInBody !== ccid) return new Response("wrong client", { status: 401 });
  const sigHeader = req.headers.get("Signature") ?? req.headers.get("x-snaptrade-signature") ?? "";
  if (sigHeader) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(ckey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)))));
    if (mac !== sigHeader) return new Response("bad signature", { status: 401 });
  }

  const stUserId = String(body.userId ?? "");   // commercial userId = our auth uid
  const event = String(body.eventType ?? body.event_type ?? "unknown");
  await admin.from("snaptrade_raw").insert({
    user_id: /^[0-9a-f-]{36}$/.test(stUserId) ? stUserId : null, account_id: String(body.accountId ?? "") || null,
    kind: "webhook:" + event, payload: body,
  }).then(() => {}, () => {});

  // CONNECTION_DELETED / CONNECTION_BROKEN also trigger a sync: orphan cleanup drops that connection's holdings
  const SYNC_EVENTS = ["CONNECTION_ADDED", "CONNECTION_UPDATED", "CONNECTION_DELETED", "CONNECTION_BROKEN", "ACCOUNT_HOLDINGS_UPDATED", "INITIAL_HOLDINGS_UPDATE", "ACCOUNT_TRANSACTIONS_INITIAL_UPDATE", "NEW_ACCOUNT_AVAILABLE"];
  if (/^[0-9a-f-]{36}$/.test(stUserId) && SYNC_EVENTS.includes(event)) {
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // CONNECTION_ADDED = the retention moment: full chain. Everything else = a plain re-sync.
    const target = event === "CONNECTION_ADDED" ? "brokerage-connected" : "snaptrade-sync";
    const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${target}`, {
      method: "POST", headers: { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: stUserId }),
    }).catch(() => null);
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
