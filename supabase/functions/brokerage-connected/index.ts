// Book-changed orchestrator: the retention moment. Every connect path (onboarding, Settings, Add Position,
// webhook CONNECTION_ADDED) AND a run of manual adds run ONE chain so the user sees a full, fresh set of
// intelligence within minutes: sync -> news -> symbol + portfolio insights -> portfolio assessment.
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
  if (!uid) {
    // diagnosable auth failure: a caller with an EMPTY token header is almost always a function deployed
    // before INTERNAL_TOKEN existed (env is frozen at deploy time) -> redeploy that caller.
    const why = typeof body.user_id === "string" ? (hdrTok === "" ? "internal token missing (caller env stale?)" : "internal token mismatch") : "not signed in";
    console.error("brokerage-connected auth fail:", why);
    return json({ ok: false, error: why }, 401);
  }

  const headers = { Authorization: `Bearer ${svc}`, apikey: svc, "Content-Type": "application/json", "x-internal-token": internalTok };
  const call = (fn: string, b: unknown) => fetch(`${base}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(b) }).then((r) => r.json().catch(() => null)).catch(() => null);
  // The first brief after a connect (or a run of manual adds) is the PORTFOLIO ASSESSMENT: quality, structure,
  // horizons, gaps. The clock editions (morning / midday / close) keep arriving on their cron cadence.
  const edition = "assessment";

  const trace: Record<string, unknown> = { started: new Date().toISOString(), edition };
  const saveTrace = () => admin.from("snaptrade_events").insert({ user_id: uid, kind: "chain_trace", seen: true, detail: trace }).then(() => {}, () => {});
  const work = (async () => {
    // 1. positions in (serialized by the per-user lock; a concurrent webhook sync just yields)
    trace.sync = await call("snaptrade-sync", { user_id: uid, no_kick: true }) ?? "null";   // this chain IS the kick
    // 2. fresh headlines for everything now held
    const { data: rows } = await admin.from("portfolio").select("symbol").eq("user_id", uid);
    const syms = (rows ?? []).map((r) => String(r.symbol)).filter((sy) => !sy.startsWith("$"));
    trace.syms = syms.length;
    if (syms.length) trace.news = (await call("news-sync", { symbols: syms })) ? "ok" : "null";
    // 3. per-stock + portfolio intelligence, forced fresh (the hourly pipeline, targeted)
    const [sy1, pf1] = await Promise.all([
      syms.length ? call("insights-sync", { symbols: syms.slice(0, 16) }) : Promise.resolve(null),
      call("insights-sync", { force: true, user_id: uid }),
    ]);
    trace.perstock = sy1 ?? "null"; trace.pf1 = pf1 ?? "null";
    // the portfolio-level insight is what lights the tabs: a transient model failure here must not end the moment
    if (!(pf1 as { portfolioWrote?: number } | null)?.portfolioWrote) {
      await new Promise((res) => setTimeout(res, 8000));
      trace.pf2 = (await call("insights-sync", { force: true, user_id: uid })) ?? "null";
    }
    // 4. the assessment: handed to brief-retry, which owns its own wall clock per attempt (up to 6 attempts
    //    with backoff) and narrates via daily-brief -> narrate. The orchestrator's clock is never spent here.
    try {
      const br = await fetch(`${base}/functions/v1/brief-retry`, { method: "POST", headers, body: JSON.stringify({ user_id: uid, edition, attempt: 1 }) });
      trace.brief = `${br.status} ` + (await br.text().catch(() => "")).slice(0, 120);
    } catch (e) { trace.brief = "fetcherr " + String(e).slice(0, 120); }
    trace.done = new Date().toISOString();
    await saveTrace();
  })();
  try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work); } catch { /* ignore */ }
  return json({ ok: true, queued: true, edition });
});
