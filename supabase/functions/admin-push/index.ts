// admin-push: the internal tool behind Settings > Send a push (web/src/screens/AdminPush.tsx).
// Signed-in admins only; every rule is in _shared/admin_push.ts (identity, allowlist, validation, rate limits,
// broadcast confirmation, audit) and unit-tested in admin_push_test.ts. RUNBOOK "Push notifications" has the how-to.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleAdmin, supabaseAdminStore, verifyActor } from "../_shared/admin_push.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({}));
  try {
    const r = await handleAdmin({
      store: supabaseAdminStore(admin),
      env: (k) => Deno.env.get(k),
      verify: (t) => verifyActor(admin, t),
    }, jwt, body && typeof body === "object" ? body : {});
    return json(r.body, r.status);
  } catch (e) {
    console.error("admin-push", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "Something went wrong. Nothing was sent." }, 500);
  }
});
