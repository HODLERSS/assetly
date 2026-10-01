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
//  - SambaNova 429 (insufficient_quota or queue_full: the 60 RPM / model Developer tier) with `altModel` given: the call is
//    retried once on the other model (gpt-oss), on either provider, inside the same budget (round 2, 10/1). Without it the
//    429 is returned and the caller's own fallback (its code-built text) answers;
//  - `snRpm`: a per-isolate token bucket per model in front of SambaNova, for batch sweeps, so a long MARA outage stays
//    under the tier's per-model rate. A call that cannot get a token in time is a local 429 (and so takes `altModel`);
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
  altModel?: string;           // a SambaNova 429 retries once on this model (both providers), inside the budget
  snRpm?: number;              // batch callers: per-isolate SambaNova requests per minute, per model (token bucket)
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

// ---- SambaNova token bucket (per isolate, per model; only for callers that pass snRpm) ----
// Developer tier: 60 RPM per model. The daily-brief sweep fans out to at most 6 users per run, so its per-isolate share is
// 60 / 6 = 10 RPM; a burst of BURST covers one brief's parallel memo calls.
const BURST = 4;
type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();
/** Take one SambaNova token for `model`, waiting up to `maxWaitMs`. true when taken. */
export async function takeSnToken(model: string, rpm: number, maxWaitMs: number, now = () => Date.now()): Promise<boolean> {
  const perMs = rpm / 60000, cap = Math.max(1, Math.min(BURST, rpm));
  const stop = now() + Math.max(0, maxWaitMs);
  for (;;) {
    const b = buckets.get(model) ?? { tokens: cap, at: now() };
    const t = now();
    b.tokens = Math.min(cap, b.tokens + (t - b.at) * perMs); b.at = t;
    buckets.set(model, b);
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    const wait = Math.ceil((1 - b.tokens) / perMs);
    if (t + wait > stop) return false;
    await new Promise((r) => setTimeout(r, wait));
  }
}
/** tests only */
export function _resetBuckets() { buckets.clear(); }

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

/** One chat completion with failover, hedging, the breaker and (on a SambaNova 429) the other model. Never throws. */
export async function chat(req: ChatRequest, opts: ChatOpts): Promise<ChatResult> {
  const t0 = Date.now();
  const res = await chatOnce(req, opts);
  // SambaNova is out of quota or queue for this model (a real 429 or our own bucket): the other model has its own limit
  if (res.ok || res.status !== 429 || res.provider !== "sambanova" || !opts.altModel || opts.altModel === req.model) return res;
  const left = (opts.budgetMs ?? opts.timeoutMs) - (Date.now() - t0);
  if (left < 1500 || opts.signal?.aborted) return res;
  const alt = await chatOnce({ ...req, model: opts.altModel }, { ...opts, caller: `${opts.caller}.alt`, timeoutMs: Math.min(opts.timeoutMs, left), budgetMs: left, hedgeMs: 0 });
  return alt.ok ? { ...alt, failover: `alt_model ${req.model} 429` } : res;
}

async function chatOnce(req: ChatRequest, opts: ChatOpts): Promise<ChatResult> {
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
  // a forced test call never reads or moves the breaker: test traffic must not send real users to the fallback
  const forced = !!opts.forceFallback;
  const state = mara ? (forced ? "closed" : breakerState("mara")) : "open";
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
  // every SambaNova attempt takes a bucket token first when the caller rate-limits (batch sweeps)
  const attemptSn = async (p: ProviderCfg, ms: () => number, signal?: AbortSignal): Promise<Attempt> => {
    if (opts.snRpm) {
      const t1 = Date.now();
      if (!await takeSnToken(req.model, opts.snRpm, Math.min(8000, ms() - 1500))) {
        return { ok: false, reason: "http", status: 429, detail: `local rate limit (${opts.snRpm} rpm)`, provider: p.name, model: req.model, ms: Date.now() - t1, failoverable: false };
      }
    }
    return await attempt(p, req, ms(), signal);
  };
  const asEmpty = (a: Attempt): Attempt => (a.ok && !contentOk(a)) ? { ok: false, reason: "empty", status: 200, detail: `finish=${a.finish} (reasoning only)`, provider: a.provider, model: a.model, ms: a.ms, failoverable: true } : a;

  // no usable primary: straight to the fallback
  if (!primary) {
    if (!sn) { const r: ChatFail = { ok: false, reason: "no_provider", status: null, detail: "MARA breaker open and no SambaNova", provider: null, model: req.model, ms: 0 }; log(r, { breaker: state }); return r; }
    const a = asEmpty(await attemptSn(sn, left, opts.signal));
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
      attemptSn(sn, left, fAbort.signal).then((a0) => {
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
      if (a.ok) { if (!forced) breakerResult("mara", true, probe); finish(toOk(a), { ...(fbStarted ? { hedged: true, hedge_winner: "mara" } : {}), ...(probe ? { breaker: "probe_ok" } : {}) }); return; }
      if (a.reason === "aborted") { if (probe) br("mara").probing = false; settleIfAllFailed(); return; }   // it lost the hedge
      if (a.failoverable && !forced) breakerResult("mara", false, probe); else if (probe) br("mara").probing = false;
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

// ---- adaptive hedge start (10/1 round 2: Ask's gpt-oss lane) ----
/** A rolling window of latencies (ms), per isolate. */
export class LatencyWindow {
  private xs: number[] = [];
  constructor(private n = 40) {}
  push(ms: number) { if (Number.isFinite(ms) && ms >= 0) { this.xs.push(ms); if (this.xs.length > this.n) this.xs.shift(); } }
  get size() { return this.xs.length; }
  quantile(q: number): number | null {
    if (!this.xs.length) return null;
    const s = [...this.xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  }
}
/** When to start a second lane: when the primary would usually have answered by the time the second one does, i.e. the
 *  primary's p80 minus the second lane's p50, clamped. Too few samples: the default. */
export function laneStartMs(primary: LatencyWindow, second: LatencyWindow, o: { min?: number; max?: number; dflt?: number; secondDefault?: number; minSamples?: number } = {}): number {
  const min = o.min ?? 2500, max = o.max ?? 4000, dflt = o.dflt ?? 3000;
  if (primary.size < (o.minSamples ?? 5)) return dflt;
  const g = second.size >= 3 ? second.quantile(0.5)! : (o.secondDefault ?? 4500);
  return Math.round(Math.min(max, Math.max(min, primary.quantile(0.8)! - g)));
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
