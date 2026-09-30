// admin-push: the internal tool behind the Assetly Admin site (app/admin, https://assetly-admin.vercel.app). The
// consumer app carries none of it. Every rule is in _shared/admin_push.ts (identity, allowlist, validation, rate
// limits, broadcast confirmation, audit) and unit-tested in admin_push_test.ts. RUNBOOK "Admin app" has the how-to.
//
// CORS: only the admin origin(s) (ADMIN_ORIGINS, default the admin site) are answered, and a browser request from
// any other origin (the consumer site included) is refused outright, not merely left without CORS headers.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminOrigins, handleAdmin, originOk, supabaseAdminStore, verifyActor } from "../_shared/admin_push.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const allowed = adminOrigins(Deno.env.get("ADMIN_ORIGINS"));
  const cors: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    ...(origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!originOk(origin, allowed)) return json({ ok: false, error: "origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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
    return json({ ok: false, error: "Something went wrong. Check History before retrying." }, 500);
  }
});
