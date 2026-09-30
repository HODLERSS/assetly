// Push a finished brief to a user's devices over APNs. Called by daily-brief (x-internal-token) when an edition is written.
//
// Inert until the APNs credentials exist: without them it answers {ok:true, sent:0, reason:"not configured"} rather
// than failing, so a missing key never costs anyone a brief.
//
// What a send guarantees (all in _shared/apns.ts + _shared/push_core.ts, unit-tested in push_send_test.ts):
//  - opt-out is the absence of tokens: Settings > Off deletes this device's token, so there is nothing to send to
//  - idempotent: one push per user, date and edition (push_log.dedupe_key); a regeneration or a retry sends nothing
//  - apns-collapse-id per edition and day, thread-id per edition, badge 1, and a `link` that opens that brief
//  - each device on its own APNs host (sandbox for Xcode builds, production for TestFlight/App Store)
//  - 410 / Unregistered / BadDeviceToken / DeviceTokenNotForTopic delete the token
//  - every send is written to push_log (service role only)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { briefPush, supabaseStore } from "../_shared/push_core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // operator/internal only: this sends to real devices
  const itok = Deno.env.get("INTERNAL_TOKEN") || (await admin.rpc("get_secret", { secret_name: "internal_token" })).data || "";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const isInternal = !!itok && req.headers.get("x-internal-token") === itok;
  const isSvc = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isInternal && !isSvc) return json({ ok: false, error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    const r = await briefPush({ store: supabaseStore(admin), env: (k) => Deno.env.get(k) }, body);
    return json(r.body, r.status);
  } catch (e) {
    console.error("push-send", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "send failed" }, 500);
  }
});
