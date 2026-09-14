// In-app account deletion (App Store Review Guideline 5.1.1(v)). The signed-in user deletes themself:
// brokerage link revoked at SnapTrade, narration audio removed from storage, then the auth user is
// deleted and every table cascades (all user_id columns reference auth.users on delete cascade).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(base, svc);
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!bearer) return json({ ok: false, error: "not signed in" }, 401);
  const { data: ud, error: uerr } = await admin.auth.getUser(bearer);
  const uid = ud?.user?.id ?? null;
  if (!uid || uerr) return json({ ok: false, error: "not signed in" }, 401);
  // Only the user themself, with their own session: a service token may not delete on someone's behalf here.
  const steps: Record<string, string> = {};

  // 1. brokerage: revoke the SnapTrade user (best effort; the row cascades regardless)
  try {
    const r = await fetch(`${base}/functions/v1/snaptrade-connect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? svc, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    steps.snaptrade = r.ok ? "revoked" : `skip ${r.status}`;
  } catch (e) { steps.snaptrade = `skip ${e instanceof Error ? e.message : String(e)}`; }

  // 2. narration audio under briefs-audio/<uid>/
  try {
    const { data: files } = await admin.storage.from("briefs-audio").list(uid, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${uid}/${f.name}`);
    if (paths.length) await admin.storage.from("briefs-audio").remove(paths);
    steps.audio = `${paths.length} removed`;
  } catch (e) { steps.audio = `skip ${e instanceof Error ? e.message : String(e)}`; }

  // 3. the auth user; every public table cascades
  const { error: derr } = await admin.auth.admin.deleteUser(uid);
  if (derr) { console.error("delete-account failed", uid, derr.message, steps); return json({ ok: false, error: "Could not delete the account. Try again.", steps }, 500); }
  // belt and braces: anything keyed by user_id without a cascade (none today) goes here
  for (const t of ["portfolio_insights", "daily_briefs", "push_tokens", "snaptrade_events"]) {
    await admin.from(t).delete().eq("user_id", uid).then(() => {}, () => {});
  }
  console.log("delete-account", uid, JSON.stringify(steps));
  return json({ ok: true, steps });
});
