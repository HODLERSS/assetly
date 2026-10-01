// ONE chat client for every edge function: MARA Cloud primary, SambaNova Cloud fallback (owner, 10/1).
//
// Both serve the same OpenAI-compatible /v1/chat/completions with the same model ids (MiniMax-M3, gpt-oss-120b), so a
// failover changes the provider, never the model, the prompt or the guards after it. What a caller gets:
//  - failover on network error, timeout, 408 / 429 / 5xx, an unreadable body, or empty content;
//  - NO failover on 400 / 401 / 403 / 404 / 410 / 422: that is our request (bad parameter, bad key, unknown model) and the
//    other provider would refuse it too. Logged loudly. 400 "Model did not output valid JSON" (the model ran out of
//    max_tokens) is the model's failure on this prompt, not the provider's; it is returned as "model_json" so the
//    caller's own model fallback (M3 -> gpt-oss) handles it, as before;
//  - every attempt reads the WHOLE body under its timer (10/1 Ask outage: a judge read a 502's body after clearing its
//    timer and hung the request into the hard deadline);
//  - a HEDGE: when `hedgeMs` is given and the primary has not answered by then, the fallback starts in parallel; the
//    first good answer wins and the loser is aborted. Interactive calls hedge near the primary's healthy p90; batch
//    calls do not (they fail over sequentially, so a healthy MARA costs nothing extra);
//  - a per-isolate CIRCUIT BREAKER: after 3 consecutive failover-class failures MARA is skipped for 60s, then one
//    request probes it (half-open) while the rest keep going to SambaNova;
//  - one log line per call: caller, provider, model, latency, outcome, failover reason. Never content, never keys.
// Fixture runs keep their MARA_BASE_URL override; SambaNova is off under that override unless SAMBANOVA_BASE_URL is also
// set explicitly, so a local fake never spills onto the real fallback.

export type Msg = { role: string; content: string };
export type ChatRequest = {
  model: string; messages: Msg[]; temperature?: number; max_tokens?: number;
  response_format?: { type: string; [k: string]: unknown };
};
export type Provider = "mara" | "sambanova";
export type FailReason = "timeout" | "network" | "http" | "empty" | "bad_body" | "client_error" | "model_json" | "budget" | "no_provider" | "aborted";
export type ChatOk = { ok: true; content: string; reasoning: string; finish: string; provider: Provider; model: string; ms: number; failover?: string };
export type ChatFail = { ok: false; reason: FailReason; status: number | null; detail: string; provider: Provider | null; model: string; ms: number };
export type ChatResult = ChatOk | ChatFail;
export type ChatOpts = {
  caller: string;              // for the log line: "ask.answer", "brief.editor", ...
  maraKey?: string;            // the caller's MARA key (vault or env)
  timeoutMs: number;           // the primary attempt's cap (what the caller used before; a healthy MARA sees no change)
  budgetMs?: number;           // the whole call, fallback included (default timeoutMs: a fallback only uses what a fast failure left)
  hedgeMs?: number;            // start the fallback in parallel when the primary has not answered by then
  acceptReasoning?: boolean;   // gpt-oss may leave content null and answer in message.reasoning (the judge accepts that)
  forceFallback?: boolean;     // test only (internal token): MARA is treated as unreachable
  signal?: AbortSignal;        // the caller gave up
};

type ProviderCfg = { name: Provider; base: string; key: string };
const normBase = (b: string) => b.replace(/\/+$/, "").replace(/\/v1$/, "");
export function providers(maraKey = ""): ProviderCfg[] {
  const maraOverride = Deno.env.get("MARA_BASE_URL");
  const snKey = Deno.env.get("SAMBANOVA_API_KEY") ?? "";
  const snBaseEnv = Deno.env.get("SAMBANOVA_BASE_URL");
  const out: ProviderCfg[] = [];
  if (maraKey) out.push({ name: "mara", base: normBase(maraOverride ?? "https://api.cloud.mara.com"), key: maraKey });
  if (snKey && (!maraOverride || snBaseEnv)) out.push({ name: "sambanova", base: normBase(snBaseEnv ?? "https://api.sambanova.ai"), key: snKey });
  return out;
}

// ---- circuit breaker (per isolate, MARA only: SambaNova is the place we go when MARA is out) ----
const BREAK_AFTER = 3, OPEN_MS = 60000;
type Breaker = { fails: number; openUntil: number; probing: boolean };
const breakers = new Map<Provider, Breaker>();
const br = (p: Provider) => breakers.get(p) ?? (breakers.set(p, { fails: 0, openUntil: 0, probing: false }), breakers.get(p)!);
/** "closed" (use it), "open" (skip it), "probe" (this call is the half-open probe). */
export function breakerState(p: Provider, now = Date.now()): "closed" | "open" | "probe" {
  const b = br(p);
  if (b.fails < BREAK_AFTER) return "closed";
  if (now < b.openUntil || b.probing) return "open";
  return "probe";
}
function breakerResult(p: Provider, ok: boolean, probe: boolean) {
  const b = br(p);
  if (probe) b.probing = false;
  if (ok) { b.fails = 0; b.openUntil = 0; return; }
  b.fails++;
  if (b.fails >= BREAK_AFTER) b.openUntil = Date.now() + OPEN_MS;
}
/** tests only */
export function _resetBreakers() { breakers.clear(); }

const FAILOVER_STATUS = (s: number) => s === 408 || s === 429 || s >= 500;
type Attempt = ChatResult & { failoverable: boolean };

async function attempt(p: ProviderCfg, req: ChatRequest, ms: number, outer?: AbortSignal, forceDown = false): Promise<Attempt> {
  const t0 = Date.now();
  const fail = (reason: FailReason, status: number | null, detail: string, failoverable: boolean): Attempt =>
    ({ ok: false, reason, status, detail, provider: p.name, model: req.model, ms: Date.now() - t0, failoverable });
  if (ms < 300) return fail("budget", null, `no time left (${ms}ms)`, false);
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
  const onOuter = () => ac.abort();
  outer?.addEventListener("abort", onOuter);
  try {
    const base = forceDown && p.name === "mara" ? "http://127.0.0.1:9" : p.base;   // a real refused connection, not a shortcut
    const r = await fetch(`${base}/v1/chat/completions`, {
      signal: ac.signal, method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const text = await r.text();   // the body is read under the same timer
    if (!r.ok) {
      const snippet = text.slice(0, 160).replace(/\s+/g, " ");
      if (FAILOVER_STATUS(r.status)) return fail("http", r.status, snippet, true);
      if (r.status === 400 && /did not output valid JSON|truncated/i.test(text)) return fail("model_json", 400, snippet, false);
      return fail("client_error", r.status, snippet, false);
    }
    let body: { choices?: { message?: { content?: string | null; reasoning?: string; reasoning_content?: string }; finish_reason?: string }[] } | null = null;
    try { body = JSON.parse(text); } catch { return fail("bad_body", r.status, text.slice(0, 80), true); }
    const m = body?.choices?.[0]?.message ?? {};
    const content = String(m.content ?? "");
    const reasoning = String(m.reasoning ?? m.reasoning_content ?? "");
    const finish = String(body?.choices?.[0]?.finish_reason ?? "?");
    if (!content.trim() && !reasoning.trim()) return fail("empty", r.status, `finish=${finish}`, true);
    return { ok: true, content, reasoning, finish, provider: p.name, model: req.model, ms: Date.now() - t0, failoverable: false };
  } catch (e) {
    if (timedOut) return fail("timeout", null, `${ms}ms`, true);
    if (outer?.aborted) return fail("aborted", null, "caller aborted", false);
    if (ac.signal.aborted) return fail("aborted", null, "lost the hedge", false);
    return fail("network", null, String((e as Error)?.message ?? e).slice(0, 120), true);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}

const usable = (a: Attempt, acceptReasoning: boolean): boolean => a.ok && (!!a.content.trim() || (acceptReasoning && !!a.reasoning.trim()));

/** One chat completion with failover, hedging and the breaker. Never throws. */
export async function chat(req: ChatRequest, opts: ChatOpts): Promise<ChatResult> {
  const t0 = Date.now();
  const deadline = t0 + Math.max(0, opts.budgetMs ?? opts.timeoutMs);
  const left = () => deadline - Date.now();
  const all = providers(opts.maraKey ?? "");
  const log = (res: ChatResult, extra: Record<string, unknown>) => {
    const line = { llm: opts.caller, model: req.model, provider: res.provider, ms: Date.now() - t0, ok: res.ok,
      ...(res.ok ? (res.failover ? { failover: res.failover } : {}) : { reason: res.reason, status: res.status, detail: res.detail }), ...extra };
    if (!res.ok && (res.reason === "client_error" || res.reason === "no_provider")) console.error("LLM REQUEST ERROR", JSON.stringify(line));
    else console.log(JSON.stringify(line));
  };
  if (!all.length) { const r: ChatFail = { ok: false, reason: "no_provider", status: null, detail: "no MARA key and no SambaNova key", provider: null, model: req.model, ms: 0 }; log(r, {}); return r; }

  const mara = all.find((p) => p.name === "mara"), sn = all.find((p) => p.name === "sambanova");
  const state = mara ? breakerState("mara") : "open";
  const probe = state === "probe";
  if (probe) br("mara").probing = true;
  const primary = mara && state !== "open" ? mara : null;
  const acceptR = !!opts.acceptReasoning;
  const toOk = (a: Attempt, failover?: string): ChatResult => {
    const { failoverable: _f, ...rest } = a;
    if (!rest.ok) return rest;
    // gpt-oss answered only in its reasoning and the caller takes that: the text is the content
    const content = rest.content.trim() ? rest.content : rest.reasoning;
    return { ...rest, content, ...(failover ? { failover } : {}) };
  };
  const contentOk = (a: Attempt) => usable(a, acceptR);
  const asEmpty = (a: Attempt): Attempt => (a.ok && !contentOk(a)) ? { ok: false, reason: "empty", status: 200, detail: `finish=${a.finish} (reasoning only)`, provider: a.provider, model: a.model, ms: a.ms, failoverable: true } : a;

  // no usable primary: straight to the fallback
  if (!primary) {
    if (!sn) { const r: ChatFail = { ok: false, reason: "no_provider", status: null, detail: "MARA breaker open and no SambaNova", provider: null, model: req.model, ms: 0 }; log(r, { breaker: state }); return r; }
    const a = asEmpty(await attempt(sn, req, left(), opts.signal));
    const res = toOk(a, mara ? "breaker_open" : "no_mara_key"); log(res, { breaker: state }); return res;
  }

  // primary with an optional hedge
  const hedgeAt = sn && opts.hedgeMs !== undefined && opts.hedgeMs < (opts.budgetMs ?? opts.timeoutMs) ? opts.hedgeMs : null;
  const pAbort = new AbortController(), fAbort = new AbortController();
  const link = (c: AbortController) => opts.signal?.addEventListener("abort", () => c.abort());
  link(pAbort); link(fAbort);
  return await new Promise<ChatResult>((resolve) => {
    let done = false, fbStarted = false, pFail: Attempt | null = null, fFail: Attempt | null = null, pending = 1;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (res: ChatResult, extra: Record<string, unknown>) => {
      if (done) return; done = true; clearTimeout(hedgeTimer);
      pAbort.abort(); fAbort.abort();   // the loser stops spending
      log(res, extra); resolve(res);
    };
    const settleIfAllFailed = () => {
      if (pending > 0 || done) return;
      const last = (fFail ?? pFail)!;
      finish(toOk(last), { hedged: fbStarted, primary_reason: pFail && !pFail.ok ? pFail.reason : undefined });
    };
    const startFallback = (why: string) => {
      if (fbStarted || done || !sn) return;
      if (left() < 500) return;
      fbStarted = true; pending++;
      attempt(sn, req, left(), fAbort.signal).then((a0) => {
        pending--;
        const a = asEmpty(a0);
        if (done) return;
        if (a.ok) finish(toOk(a, why), { hedged: why === "hedge" });
        else { fFail = a; settleIfAllFailed(); }
      });
    };
    attempt(primary, req, Math.min(opts.timeoutMs, left()), pAbort.signal, !!opts.forceFallback).then((a0) => {
      pending--;
      const a = asEmpty(a0);
      if (a.ok) { breakerResult("mara", true, probe); finish(toOk(a), { ...(fbStarted ? { hedged: true, hedge_winner: "mara" } : {}), ...(probe ? { breaker: "probe_ok" } : {}) }); return; }
      if (a.reason === "aborted") { if (probe) br("mara").probing = false; settleIfAllFailed(); return; }   // it lost the hedge
      if (a.failoverable) breakerResult("mara", false, probe); else if (probe) br("mara").probing = false;
      pFail = a;
      // our own request was refused (or the model overran its tokens): the other provider would say the same
      if (!a.failoverable) { finish(toOk(a), { hedged: fbStarted }); return; }
      if (!done && sn) {
        if (!fbStarted) startFallback(`${a.reason}${a.status ? " " + a.status : ""}`);
        else if (pending > 0) return;   // the hedge is already running: let it answer
      }
      settleIfAllFailed();
    });
    if (hedgeAt !== null) hedgeTimer = setTimeout(() => startFallback("hedge"), hedgeAt);
  });
}

/** The first {...} object in a model's text (a <think> block stripped), or null. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{"); if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) { if (cleaned[i] === "{") depth++; else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } } }
  if (end < 0) return null;
  try { return JSON.parse(cleaned.slice(start, end)); } catch { return null; }
}
