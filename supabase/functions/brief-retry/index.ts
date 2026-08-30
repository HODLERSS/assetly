// Brief-retry: own the "get today's brief written" job with a full 150s per attempt.
// Each request makes ONE daily-brief attempt; on failure it re-schedules itself (waitUntil) with
// backoff up to MAX attempts, so the orchestrator never spends its clock on the brief.
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX = 6;   // ~15 min of coverage across a text-API slow wave; each attempt is its own request

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const base = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(base, svc);
  const body = await req.json().catch(() => ({}));
  let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const isInternal = !!itok && (req.headers.get("x-internal-token") ?? "") === itok;
  const isSvc = (() => { try { return JSON.parse(atob(bearer.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
  if (!isInternal && !isSvc) return json({ ok: false, error: "internal only" }, 401);
  const uid = String(body.user_id ?? ""), edition = String(body.edition ?? "morning"), attempt = Number(body.attempt ?? 1);
  if (!uid) return json({ ok: false, error: "user_id required" }, 400);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": itok };

  const work = (async () => {
    const { data: before } = await admin.from("daily_briefs").select("generated_at").eq("user_id", uid).eq("brief_date", today).eq("edition", edition).maybeSingle();
    let dbStatus = "none"; let dbBody = "";
    const r = await fetch(`${base}/functions/v1/daily-brief`, { method: "POST", headers, body: JSON.stringify({ force: true, user_id: uid, edition }) })
      .then(async (x) => { dbStatus = String(x.status); const t = await x.text().catch(() => ""); dbBody = t.slice(0, 200); try { return JSON.parse(t); } catch { return null; } })
      .catch((e) => { dbStatus = "fetcherr"; dbBody = String(e).slice(0, 200); return null; }) as { wrote?: number } | null;
    await admin.from("snaptrade_events").insert({ user_id: uid, kind: "brief_trace", seen: true, detail: { attempt, edition, dbStatus, dbBody } }).then(() => {}, () => {});
    const { data: after } = await admin.from("daily_briefs").select("generated_at, model").eq("user_id", uid).eq("brief_date", today).eq("edition", edition).maybeSingle();
    const wrote = (r?.wrote ?? 0) > 0 || (after && (!before || after.generated_at !== before.generated_at));
    if (wrote) return;
    if (attempt < MAX) {
      await new Promise((res) => setTimeout(res, Math.min(120000, 15000 * Math.pow(2, attempt - 1))));   // 15s, 30s, 60s, 120s, 120s
      await fetch(`${base}/functions/v1/brief-retry`, { method: "POST", headers, body: JSON.stringify({ user_id: uid, edition, attempt: attempt + 1 }) }).catch(() => null);
    }
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, attempt });
});
