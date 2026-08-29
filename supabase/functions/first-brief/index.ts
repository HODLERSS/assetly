// First Brief: the moment a user finishes adding their portfolio, generate one brief
// (edition chosen by the clock) plus the portfolio intelligence — so within minutes
// of onboarding they can read AND listen to an assessment, without waiting for cron.
// Returns immediately; the heavy chain runs in the background.
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
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: ud } = await admin.auth.getUser(jwt);
  const uid = ud?.user?.id;
  if (!uid) return json({ ok: false, error: "not signed in" }, 401);

  // needs at least one priced, non-cash holding to be worth a brief
  const { data: rows } = await admin.from("portfolio").select("symbol, kind, value").eq("user_id", uid);
  const real = (rows ?? []).filter((r) => !String(r.symbol).startsWith("$") && r.kind !== "cash" && r.kind !== "debt");
  if (!real.length) return json({ ok: true, skipped: "no positions" });

  // one per UTC day per user: the cron editions take over afterwards
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const { data: have } = await admin.from("daily_briefs").select("id").eq("user_id", uid).eq("brief_date", today).limit(1);
  if (have && have.length) return json({ ok: true, skipped: "brief exists today" });

  // edition by the clock (mirrors daily-brief): pre-open -> morning, session -> midday, post-close -> close
  const utcMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const edition = utcMin >= 20 * 60 + 5 ? "close" : utcMin >= 15 * 60 ? "midday" : "morning";

  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json" };
  const work = (async () => {
    // portfolio intelligence first (fast, ~20s), then the brief chain (60-120s) with narration
    await fetch(`${base}/functions/v1/insights-sync`, { method: "POST", headers, body: JSON.stringify({ force: true, user_id: uid }) }).catch(() => null);
    await fetch(`${base}/functions/v1/daily-brief`, { method: "POST", headers, body: JSON.stringify({ force: true, user_id: uid, edition }) }).catch(() => null);
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, queued: true, edition });
});
