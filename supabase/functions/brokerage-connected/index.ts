// Brokerage-connected orchestrator: the retention moment. Every connect path (onboarding,
// Settings, Add Position, webhook CONNECTION_ADDED) runs ONE chain so the user sees a full,
// fresh set of intelligence within minutes: sync -> news -> symbol + portfolio insights -> brief.
// Callable by the signed-in user (self) or service callers (user_id). Returns immediately.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(base, svc);
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const body = await req.json().catch(() => ({}));
  // Internal callers (callback, webhook) present a shared secret: the platform JWT gate rejects the
  // legacy service token, so this function is deployed public and authorizes explicitly here.
  let internalTok = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (!internalTok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); internalTok = data ?? ""; }
  const hdrTok = req.headers.get("x-internal-token") ?? "";
  const isInternal = !!internalTok && hdrTok === internalTok;
  const isSvc = (() => { try { return JSON.parse(atob(bearer.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
  let uid: string | null = null;
  if ((isInternal || isSvc) && typeof body.user_id === "string") uid = body.user_id;
  else if (bearer) { const { data: ud } = await admin.auth.getUser(bearer); uid = ud?.user?.id ?? null; }
  if (!uid) return json({ ok: false, error: "not signed in" }, 401);

  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": internalTok };
  const call = (fn: string, b: unknown) => fetch(`${base}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(b) }).then((r) => r.json().catch(() => null)).catch(() => null);
  const h = new Date().getUTCHours();
  const edition = h >= 19 ? "close" : h >= 15 ? "midday" : "morning";

  const work = (async () => {
    // 1. positions in (serialized by the per-user lock; a concurrent webhook sync just yields)
    await call("snaptrade-sync", { user_id: uid });
    // 2. fresh headlines for everything now held
    const { data: rows } = await admin.from("portfolio").select("symbol").eq("user_id", uid);
    const syms = (rows ?? []).map((r) => String(r.symbol)).filter((sy) => !sy.startsWith("$"));
    if (syms.length) await call("news-sync", { symbols: syms });
    // 3. per-stock + portfolio intelligence, forced fresh (the hourly pipeline, targeted)
    await Promise.all([
      syms.length ? call("insights-sync", { symbols: syms.slice(0, 16) }) : Promise.resolve(null),
      call("insights-sync", { force: true, user_id: uid }),
    ]);
    // 4. today's brief: handed to brief-retry, which owns its own wall clock per attempt (up to 4 attempts
    //    with backoff) and narrates via daily-brief -> narrate. The orchestrator's clock is never spent here.
    await fetch(`${base}/functions/v1/brief-retry`, { method: "POST", headers, body: JSON.stringify({ user_id: uid, edition, attempt: 1 }) })
      .then((r) => r.text().catch(() => "")).catch(() => null);
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, queued: true, edition });
});
