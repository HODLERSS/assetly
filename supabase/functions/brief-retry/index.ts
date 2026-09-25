// Brief-retry: own the "get today's brief written" job with a full 150s per attempt.
// Each request makes ONE daily-brief attempt; on failure it re-schedules itself (waitUntil) with
// backoff up to MAX attempts, so the orchestrator never spends its clock on the brief.
// For the PORTFOLIO ASSESSMENT it also owns public.assessment_status (the row the client's progress card
// polls): running (with the attempt number) while it works, ready when the row lands, failed when the
// attempts run out or the book is too small to assess.
// A run is identified by its started_at (`run`, set by brokerage-connected). Every status write is scoped to
// that run, so an older run finishing late can no longer mark a NEWER queued run "ready" (round 2: a
// newcomer saw "Your portfolio assessment is ready" and "Updating your Portfolio Assessment" at once, over a
// one-stock verdict about a book that had moved on), and a superseded run stops retrying.
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX = 6;   // ~8-10 min of coverage across a text-API slow wave; each attempt is its own request
// the backoff runs at the START of the next attempt's own request (its own wall clock): a sleep inside this
// request's waitUntil can be reaped silently, and then no retry ever fires (bit the connect demo on 08-30)
const DELAY = [0, 15000, 30000, 45000, 60000, 60000];

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
  const run = typeof body.run === "string" && body.run ? body.run : null;
  if (!uid) return json({ ok: false, error: "user_id required" }, 400);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": itok };

  const assess = edition === "assessment";
  // scoped to this run when it has one (callers before this change send none and keep the old upsert)
  const setStatus = (patch: Record<string, unknown>) => !assess ? Promise.resolve()
    : run ? admin.from("assessment_status").update({ updated_at: new Date().toISOString(), ...patch }).eq("user_id", uid).eq("started_at", run).then(() => {}, () => {})
    : admin.from("assessment_status").upsert({ user_id: uid, updated_at: new Date().toISOString(), ...patch }, { onConflict: "user_id" }).then(() => {}, () => {});
  /** A newer run has started for this user: this one stops (no status writes, no retries). */
  const superseded = async () => {
    if (!assess || !run) return false;
    const { data } = await admin.from("assessment_status").select("started_at").eq("user_id", uid).maybeSingle().then((r) => r, () => ({ data: null }));
    return !!data?.started_at && +new Date(String(data.started_at)) > +new Date(run) + 1000;
  };
  const work = (async () => {
    await new Promise((res) => setTimeout(res, DELAY[Math.min(attempt - 1, DELAY.length - 1)]));
    if (await superseded()) return;
    await setStatus({ state: "running", step: "writing", attempt });
    const { data: before } = await admin.from("daily_briefs").select("generated_at").eq("user_id", uid).eq("brief_date", today).eq("edition", edition).maybeSingle();
    let dbStatus = "none"; let dbBody = "";
    const r = await fetch(`${base}/functions/v1/daily-brief`, { method: "POST", headers, body: JSON.stringify({ force: true, user_id: uid, edition, ...(run ? { run } : {}) }) })
      .then(async (x) => { dbStatus = String(x.status); const t = await x.text().catch(() => ""); dbBody = t.slice(0, 200); try { return JSON.parse(t); } catch { return null; } })
      .catch((e) => { dbStatus = "fetcherr"; dbBody = String(e).slice(0, 200); return null; }) as { wrote?: number } | null;
    await admin.from("snaptrade_events").insert({ user_id: uid, kind: "brief_trace", seen: true, detail: { attempt, edition, dbStatus, dbBody } }).then(() => {}, () => {});
    const { data: after } = await admin.from("daily_briefs").select("generated_at, model").eq("user_id", uid).eq("brief_date", today).eq("edition", edition).maybeSingle();
    // daily-brief declined to write a superseded run's assessment: the newer run owns the row and the status
    if ((r as { superseded?: boolean } | null)?.superseded || await superseded()) return;
    const wrote = (r?.wrote ?? 0) > 0 || (after && (!before || after.generated_at !== before.generated_at));
    if (wrote) { await setStatus({ state: "ready", step: "done", finished_at: new Date().toISOString(), error: null }); return; }
    // daily-brief skips an empty book, or one under $100, without an error: nothing to retry, and the client
    // must stop waiting
    const users = (r as { users?: number } | null)?.users;
    const skipped = r !== null && (users === 0 || users === 1) && !((r as { errors?: unknown[] }).errors ?? []).length;
    if (skipped) { await setStatus({ state: "failed", step: "skipped", finished_at: new Date().toISOString(), error: users === 0 ? "no positions to assess" : "book too small to assess (under $100)" }); return; }
    if (attempt >= MAX) { await setStatus({ state: "failed", step: "gave up", finished_at: new Date().toISOString(), error: dbBody.slice(0, 200) || dbStatus }); return; }
    if (attempt < MAX) {
      // hand off IMMEDIATELY; the next request sleeps its own backoff on its own clock
      await fetch(`${base}/functions/v1/brief-retry`, { method: "POST", headers, body: JSON.stringify({ user_id: uid, edition, attempt: attempt + 1, ...(run ? { run } : {}) }) }).catch(() => null);
    }
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, attempt });
});
