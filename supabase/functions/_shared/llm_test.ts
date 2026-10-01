// The shared LLM client against two local fake providers. Run: deno test -A supabase/functions/_shared/llm_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { _resetBreakers, _resetBuckets, breakerState, chat, laneStartMs, LatencyWindow, takeSnToken } from "./llm.ts";

type Mode = { status?: number; delayMs?: number; content?: string | null; reasoning?: string; body?: string; stallBody?: boolean; byModel?: Record<string, Mode> };
const mk = (port: number) => {
  const st = { mode: {} as Mode, calls: 0, aborted: 0 };
  const server = Deno.serve({ port, onListen: () => {} }, async (req) => {
    st.calls++;
    const raw = await req.text();
    let model = ""; try { model = JSON.parse(raw).model ?? ""; } catch { /* ignore */ }
    const m = st.mode.byModel?.[model] ?? st.mode;
    if (m.delayMs) {
      const aborted = await new Promise<boolean>((r) => { const t = setTimeout(() => r(false), m.delayMs); req.signal.addEventListener("abort", () => { clearTimeout(t); r(true); }); });
      if (aborted) { st.aborted++; return new Response(null, { status: 499 }); }
    }
    if (m.stallBody) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"error\":")); } }), { status: m.status ?? 502 });
    if (m.body !== undefined) return new Response(m.body, { status: m.status ?? 200 });
    if (m.status && m.status !== 200) return Response.json({ error: { message: "nope" } }, { status: m.status });
    return Response.json({ choices: [{ message: { content: m.content === undefined ? `{"from":${port}}` : m.content, reasoning: m.reasoning ?? "" }, finish_reason: "stop" }] });
  });
  return { st, server };
};
const M = mk(54701), S = mk(54702);
Deno.env.set("MARA_BASE_URL", "http://localhost:54701");
Deno.env.set("SAMBANOVA_BASE_URL", "http://localhost:54702");
Deno.env.set("SAMBANOVA_API_KEY", "sn-test");
const REQ = { model: "gpt-oss-120b", messages: [{ role: "user", content: "hi" }], max_tokens: 50 };
const reset = (m: Mode, s: Mode) => { M.st.mode = m; S.st.mode = s; M.st.calls = S.st.calls = M.st.aborted = S.st.aborted = 0; _resetBreakers(); _resetBuckets(); };
const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

T("healthy MARA answers; SambaNova is never called", async () => {
  reset({}, {});
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000, hedgeMs: 1500 });
  assert(r.ok && r.provider === "mara" && !r.failover, JSON.stringify(r));
  assertEquals(S.st.calls, 0);
});
T("503 fails over at once", async () => {
  reset({ status: 503 }, {});
  const t = Date.now();
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000 });
  assert(r.ok && r.provider === "sambanova" && r.failover === "http 503", JSON.stringify(r));
  assert(Date.now() - t < 1000);
});
T("429 and 408 fail over", async () => {
  for (const s of [429, 408, 500, 502]) { reset({ status: s }, {}); const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000 }); assert(r.ok && r.provider === "sambanova", `${s} ${JSON.stringify(r)}`); }
});
T("a MARA timeout fails over inside the budget", async () => {
  reset({ delayMs: 5000 }, {});
  const t = Date.now();
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 800, budgetMs: 3000 });
  assert(r.ok && r.provider === "sambanova" && r.failover === "timeout", JSON.stringify(r));
  assert(Date.now() - t < 2000, `${Date.now() - t}ms`);
});
T("empty content fails over; reasoning-only counts only when the caller accepts it", async () => {
  reset({ content: null }, {});
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000 });
  assert(r.ok && r.provider === "sambanova" && r.failover?.startsWith("empty"), JSON.stringify(r));
  reset({ content: null, reasoning: '{"flag": []}' }, {});
  const j = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000, acceptReasoning: true });
  assert(j.ok && j.provider === "mara" && j.content === '{"flag": []}', JSON.stringify(j));
});
T("400 / 401 from our request do NOT fail over", async () => {
  for (const s of [400, 401, 404]) {
    reset({ status: s }, {});
    const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000, hedgeMs: 2000 });
    assert(!r.ok && r.reason === "client_error" && r.status === s, JSON.stringify(r));
    assertEquals(S.st.calls, 0);
  }
  reset({ status: 400, body: '{"error":"Model did not output valid JSON. The output was truncated"}' }, {});
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000 });
  assert(!r.ok && r.reason === "model_json", JSON.stringify(r));
  assertEquals(S.st.calls, 0);
});
T("a 502 whose body never ends is bounded by the timer and fails over (10/1 Ask outage)", async () => {
  reset({ stallBody: true, status: 502 }, {});
  const t = Date.now();
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 700, budgetMs: 3000 });
  assert(r.ok && r.provider === "sambanova", JSON.stringify(r));
  assert(Date.now() - t < 2000, `${Date.now() - t}ms`);
});
T("hedge: a slow MARA loses to SambaNova, and the loser is aborted", async () => {
  reset({ delayMs: 3000 }, { delayMs: 100 });
  const t = Date.now();
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 5000, hedgeMs: 300 });
  assert(r.ok && r.provider === "sambanova" && r.failover === "hedge", JSON.stringify(r));
  assert(Date.now() - t < 1000, `${Date.now() - t}ms`);
  await new Promise((x) => setTimeout(x, 100));
  assertEquals(M.st.aborted, 1);
  assertEquals(breakerState("mara"), "closed");   // losing a hedge is not a failure
});
T("hedge: MARA answering after the hedge started still wins when it is first; SambaNova is aborted", async () => {
  reset({ delayMs: 400 }, { delayMs: 3000 });
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 5000, hedgeMs: 200 });
  assert(r.ok && r.provider === "mara", JSON.stringify(r));
  await new Promise((x) => setTimeout(x, 100));
  assertEquals(S.st.aborted, 1);
});
T("breaker: three failures open it; calls skip MARA; after the window one probe closes it", async () => {
  reset({ status: 503 }, {});
  for (let i = 0; i < 3; i++) await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 });
  assertEquals(breakerState("mara"), "open");
  const before = M.st.calls;
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 });
  assert(r.ok && r.provider === "sambanova" && r.failover === "breaker_open", JSON.stringify(r));
  assertEquals(M.st.calls, before);   // MARA skipped
  // half-open after the window: the probe goes to MARA
  assertEquals(breakerState("mara", Date.now() + 61000), "probe");
  M.st.mode = {};
  const realNow = Date.now; Date.now = () => realNow() + 61000;
  try {
    const p = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 });
    assert(p.ok && p.provider === "mara", JSON.stringify(p));
    assertEquals(breakerState("mara"), "closed");
  } finally { Date.now = realNow; }
});
T("breaker: a failed probe re-opens it", async () => {
  reset({ status: 503 }, {});
  for (let i = 0; i < 3; i++) await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 });
  const realNow = Date.now; Date.now = () => realNow() + 61000;
  try {
    const p = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 });
    assert(p.ok && p.provider === "sambanova", JSON.stringify(p));
    assertEquals(breakerState("mara"), "open");
  } finally { Date.now = realNow; }
});
T("budget: both providers slow, the call ends at its budget", async () => {
  reset({ delayMs: 5000 }, { delayMs: 5000 });
  const t = Date.now();
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 1000, budgetMs: 1500, hedgeMs: 300 });
  assert(!r.ok && r.reason === "timeout", JSON.stringify(r));
  assert(Date.now() - t < 1800, `${Date.now() - t}ms`);
});
T("forceFallback (internal test flag) reaches SambaNova through a real refused connection", async () => {
  reset({}, {});
  const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000, forceFallback: true });
  assert(r.ok && r.provider === "sambanova" && r.failover?.startsWith("network"), JSON.stringify(r));
  assertEquals(M.st.calls, 0);
  // forced test calls never open the breaker for real traffic
  for (let i = 0; i < 4; i++) await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 3000, forceFallback: true });
  assertEquals(breakerState("mara"), "closed");
});
T("no MARA key: SambaNova alone; no keys at all: no_provider", async () => {
  reset({}, {});
  const r = await chat(REQ, { caller: "t", timeoutMs: 3000 });
  assert(r.ok && r.provider === "sambanova", JSON.stringify(r));
  Deno.env.delete("SAMBANOVA_API_KEY");
  try { const n = await chat(REQ, { caller: "t", timeoutMs: 3000 }); assert(!n.ok && n.reason === "no_provider"); }
  finally { Deno.env.set("SAMBANOVA_API_KEY", "sn-test"); }
});
T("a MARA_BASE_URL fixture override never spills onto SambaNova unless its base is set too", async () => {
  reset({ status: 503 }, {});
  Deno.env.delete("SAMBANOVA_BASE_URL");
  try { const r = await chat(REQ, { caller: "t", maraKey: "k", timeoutMs: 2000 }); assert(!r.ok && r.provider === "mara", JSON.stringify(r)); }
  finally { Deno.env.set("SAMBANOVA_BASE_URL", "http://localhost:54702"); }
});

// ---- round 2 (10/1): SambaNova 429 / queue_full and the batch token bucket ----
const M3 = { ...REQ, model: "MiniMax-M3" };
T("MARA down + SambaNova 429 on M3: the call moves to gpt-oss (altModel) inside the budget", async () => {
  reset({ status: 502 }, { byModel: { "MiniMax-M3": { status: 429 } } });
  const t = Date.now();
  const r = await chat(M3, { caller: "t", maraKey: "k", timeoutMs: 3000, altModel: "gpt-oss-120b" });
  assert(r.ok && r.model === "gpt-oss-120b" && r.provider === "sambanova" && r.failover === "alt_model MiniMax-M3 429", JSON.stringify(r));
  assert(Date.now() - t < 1500, `${Date.now() - t}ms`);
});
T("SambaNova 429 with no altModel: the 429 comes back fast (the caller's code-built answer takes over)", async () => {
  reset({ status: 502 }, { status: 429 });
  const t = Date.now();
  const r = await chat(M3, { caller: "t", maraKey: "k", timeoutMs: 3000 });
  assert(!r.ok && r.status === 429 && r.provider === "sambanova", JSON.stringify(r));
  assert(Date.now() - t < 1000);
});
T("both models 429 on SambaNova: the original 429 is returned, no loop", async () => {
  reset({ status: 502 }, { status: 429 });
  const r = await chat(M3, { caller: "t", maraKey: "k", timeoutMs: 3000, altModel: "gpt-oss-120b" });
  assert(!r.ok && r.status === 429 && r.model === "MiniMax-M3", JSON.stringify(r));
  assertEquals(S.st.calls, 2);
});
T("a 400 on MARA is still not retried on another model", async () => {
  reset({ status: 400 }, {});
  const r = await chat(M3, { caller: "t", maraKey: "k", timeoutMs: 3000, altModel: "gpt-oss-120b" });
  assert(!r.ok && r.reason === "client_error", JSON.stringify(r));
  assertEquals(S.st.calls, 0);
});
T("token bucket: 10 rpm allows a burst of 4, then refuses without waiting past maxWait", async () => {
  _resetBuckets();
  let now = 1_000_000;
  const clock = () => now;
  for (let i = 0; i < 4; i++) assert(await takeSnToken("m", 10, 0, clock), `burst ${i}`);
  assert(!await takeSnToken("m", 10, 0, clock), "5th in the same instant");
  now += 6000;   // 10 rpm = one token per 6s
  assert(await takeSnToken("m", 10, 0, clock));
  assert(await takeSnToken("other-model", 10, 0, clock), "buckets are per model");
});
T("batch caller over its SambaNova rate gets a local 429 and moves to gpt-oss", async () => {
  reset({ status: 502 }, {});
  const opts = { caller: "t", maraKey: "k", timeoutMs: 3000, snRpm: 1, altModel: "gpt-oss-120b" };
  const a = await chat(M3, opts);
  assert(a.ok && a.model === "MiniMax-M3" && a.provider === "sambanova", JSON.stringify(a));
  const b = await chat(M3, opts);   // the M3 bucket (1 rpm, burst 1) is empty: gpt-oss answers
  assert(b.ok && b.model === "gpt-oss-120b" && b.failover === "alt_model MiniMax-M3 429", JSON.stringify(b));
  const c = await chat(M3, { ...opts, altModel: undefined });   // both buckets empty and no alt: a fast local 429
  assert(!c.ok && c.status === 429 && /local rate limit/.test(c.detail), JSON.stringify(c));
});

T("adaptive lane start: 3s until 5 samples, p80(M3) - p50(gpt-oss), clamped 2.5-4s", async () => {
  const m3 = new LatencyWindow(), g = new LatencyWindow();
  assertEquals(laneStartMs(m3, g), 3000);
  for (const x of [6964, 13843, 5555, 6088, 6082, 7720, 4482, 5454, 3780, 8676]) m3.push(x);   // 10/1 prod, M3 on MARA
  for (const x of [4684, 4224, 4212, 3532]) g.push(x);
  assertEquals(laneStartMs(m3, g), 7720 - 4212);   // p80 7720 (8th of 10), p50 4212 (2nd of 4)
  const fast = new LatencyWindow(); for (let i = 0; i < 10; i++) fast.push(2000);
  assertEquals(laneStartMs(fast, g), 2500, "a fast MARA: the floor");
  const slow = new LatencyWindow(); for (let i = 0; i < 10; i++) slow.push(20000);
  assertEquals(laneStartMs(slow, g), 4000, "a slow MARA: the cap");
  const w = new LatencyWindow(3); for (const x of [1, 2, 3, 4]) w.push(x);
  assertEquals(w.size, 3);
});
