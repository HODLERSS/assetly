// Book-changed orchestrator: the retention moment. Every connect path (onboarding, Settings, Add Position,
// webhook CONNECTION_ADDED) AND a run of manual adds run ONE chain so the user sees a full, fresh set of
// intelligence within minutes: sync -> news + price history -> portfolio assessment (kicked) -> symbol +
// portfolio insights. Callable by the signed-in user (self) or service callers (user_id). Returns immediately.
//
// Latency (2026-09-25 audit: a new account's assessment arrived ~8 minutes after its first add). The chain
// awaited the portfolio insight before it kicked the assessment, and that insight's primary model can burn
// ~85s failing before its fallback; together with news and per-stock insights the chain outran the 150s
// wall clock, the worker was reaped, and the assessment was never requested at all (no trace row either:
// the trace was only written at the very end). Now the assessment is handed to brief-retry as soon as the
// positions, headlines and price history are in (~15s), insights run after it in parallel, and the trace
// is written at the start and updated as each step lands.
//
// Progress for the client: public.assessment_status (one row per user: queued -> running -> ready | failed,
// with started_at / updated_at / finished_at). This function writes "queued"; brief-retry owns the rest.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearerOf, userIdFrom } from "../_shared/auth.ts";
import { backfillShort } from "../_shared/history.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(base, svc);
  const bearer = bearerOf(req);
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
  // a user token is verified by signature + expiry (see _shared/auth.ts): a session revoked by a sign-out
  // elsewhere no longer turns a still-valid token into "not signed in" for this one function
  else if (bearer) uid = await userIdFrom(admin, bearer);
  if (!uid) {
    // diagnosable auth failure: a caller with an EMPTY token header is almost always a function deployed
    // before INTERNAL_TOKEN existed (env is frozen at deploy time) -> redeploy that caller.
    const why = typeof body.user_id === "string" ? (hdrTok === "" ? "internal token missing (caller env stale?)" : "internal token mismatch")
      : bearer.split(".").length === 3 ? "session expired: sign in again" : "not signed in";
    console.error("brokerage-connected auth fail:", why);
    return json({ ok: false, error: why }, 401);
  }

  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": internalTok };
  const call = (fn: string, b: unknown) => fetch(`${base}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(b) }).then((r) => r.json().catch(() => null)).catch(() => null);
  // The first brief after a connect (or a run of manual adds) is the PORTFOLIO ASSESSMENT: quality, structure,
  // horizons, gaps. The clock editions (morning / midday / close) keep arriving on their cron cadence.
  const edition = "assessment";
  const startedAt = new Date().toISOString();
  // the progress row the client polls; an error here (table not migrated yet) never blocks the chain.
  // A new run upserts the whole row; later steps PATCH it (a partial upsert would trip the NOT NULL state).
  await admin.from("assessment_status").upsert({ user_id: uid, state: "queued", step: "sync", attempt: 0, started_at: startedAt,
    updated_at: startedAt, finished_at: null, error: null }, { onConflict: "user_id" }).then(() => {}, () => {});
  const setStatus = (patch: Record<string, unknown>) => admin.from("assessment_status")
    .update({ updated_at: new Date().toISOString(), ...patch }).eq("user_id", uid).then(() => {}, () => {});

  const trace: Record<string, unknown> = { started: startedAt, edition };
  // written first and updated per step, so a chain the runtime reaps still leaves evidence
  const traceId = await admin.from("snaptrade_events").insert({ user_id: uid, kind: "chain_trace", seen: true, detail: trace }).select("id").single()
    .then((r) => (r.data as { id?: number } | null)?.id ?? null, () => null);
  const saveTrace = () => traceId === null ? Promise.resolve()
    : admin.from("snaptrade_events").update({ detail: { ...trace, at: new Date().toISOString() } }).eq("id", traceId).then(() => {}, () => {});
  const work = (async () => {
    // 1. positions in (serialized by the per-user lock; a concurrent webhook sync just yields)
    trace.sync = await call("snaptrade-sync", { user_id: uid, no_kick: true }) ?? "null";   // this chain IS the kick
    const { data: rows } = await admin.from("portfolio").select("symbol").eq("user_id", uid);
    const syms = [...new Set((rows ?? []).map((r) => String(r.symbol)).filter((sy) => !sy.startsWith("$")))];
    trace.syms = syms.length;
    await setStatus({ step: "news" });
    // 2. fresh headlines and a year of daily prices for everything now held (both bounded: the assessment
    //    reads 14 days of headlines and 30d/1y windows, and must not wait on a slow feed)
    const [news, hist] = await Promise.all([
      syms.length ? within(call("news-sync", { symbols: syms }), 25000, "timeout") : Promise.resolve("no symbols"),
      // in-process, not a hop: price-sync sits behind the platform JWT gate, which refuses the service token
      syms.length ? within(backfillShort(admin, syms, { cap: 25 }).catch((e) => String(e).slice(0, 80)), 25000, "timeout") : Promise.resolve("no symbols"),
    ]);
    trace.news = news === "timeout" || news === "no symbols" ? news : news ? "ok" : "null";
    trace.history = hist ?? "null";
    await saveTrace();
    // 3. the assessment: handed to brief-retry NOW, which owns its own wall clock per attempt (up to 6
    //    attempts with backoff) and narrates via daily-brief -> narrate. The orchestrator's clock is never spent here.
    try {
      const br = await fetch(`${base}/functions/v1/brief-retry`, { method: "POST", headers, body: JSON.stringify({ user_id: uid, edition, attempt: 1 }) });
      trace.brief = `${br.status} ` + (await br.text().catch(() => "")).slice(0, 120);
      // a refused hand-off (stale INTERNAL_TOKEN in a function's frozen env, a boot error) must not leave the
      // client's progress card waiting on a run that never started
      if (!br.ok) await setStatus({ state: "failed", error: `could not start the assessment (${br.status})`, finished_at: new Date().toISOString() });
    } catch (e) {
      trace.brief = "fetcherr " + String(e).slice(0, 120);
      await setStatus({ state: "failed", error: "could not start the assessment", finished_at: new Date().toISOString() });
    }
    await saveTrace();
    // 4. per-stock + portfolio intelligence, forced fresh (the hourly pipeline, targeted), alongside the assessment
    const [sy1, pf1] = await Promise.all([
      syms.length ? call("insights-sync", { symbols: syms.slice(0, 16) }) : Promise.resolve(null),
      call("insights-sync", { force: true, user_id: uid }),
    ]);
    trace.perstock = sy1 ?? "null"; trace.pf1 = pf1 ?? "null";
    // the portfolio-level insight is what lights the tabs: a transient model failure here must not end the moment
    if (!(pf1 as { portfolioWrote?: number } | null)?.portfolioWrote) {
      await new Promise((res) => setTimeout(res, 5000));
      trace.pf2 = (await call("insights-sync", { force: true, user_id: uid })) ?? "null";
    }
    trace.done = new Date().toISOString();
    await saveTrace();
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, queued: true, edition, started_at: startedAt });
});
