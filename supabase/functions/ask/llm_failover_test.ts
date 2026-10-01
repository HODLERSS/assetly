// 10/1: Ask with MARA down answers through SambaNova inside the budget, and the 10/1 outage (a MARA 502 whose body never
// ends, on the judge call) no longer hangs the request into the hard deadline. The real handler against a local stand-in
// for Supabase, a dead MARA and a fake SambaNova. Run: deno test -A supabase/functions/ask/llm_failover_test.ts
import { assert } from "jsr:@std/assert@1";

const PORT = 54541, SN_PORT = 54542, MARA_PORT = 54543;
const READ_DELAY = 0;
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
const b64u = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const UID = "11111111-2222-3333-4444-555555555555";
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "k1" }));
const claims = b64u(JSON.stringify({ sub: UID, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now }));
const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(`${head}.${claims}`)));
const TOKEN = `${head}.${claims}.${b64u(sig)}`;

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const T: Record<string, unknown[]> = {
  portfolio: [
    { holding_id: "h1", symbol: "NVDA", name: "NVIDIA", kind: "stock", account: "brokerage", currency: "USD", qty: 100, price: 180, value: 18000, change_pct: 0.5, avg_cost: 100, total_gl: 8000, as_of: day(0) },
    { holding_id: "h2", symbol: "AMZN", name: "Amazon", kind: "stock", account: "brokerage", currency: "USD", qty: 50, price: 200, value: 10000, change_pct: -0.4, avg_cost: 150, total_gl: 2500, as_of: day(0) },
    { holding_id: "h3", symbol: "$CASH", name: "Cash", kind: "cash", account: "bank", currency: "USD", qty: 1, price: 1, value: 2000, change_pct: 0, avg_cost: 1, total_gl: 0, as_of: day(0) },
  ],
  profiles: [{ id: UID, investor: null, base_currency: "USD" }],
  prices: [{ symbol: "USDKRW", price: 1357 }],
};
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [jwk] });
  if (u.pathname.startsWith("/rest/v1/")) {
    await new Promise((r) => setTimeout(r, READ_DELAY));   // a saturated pool: every read waits
    const t = u.pathname.split("/").pop()!;
    const rows = T[t] ?? [];
    if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) return rows.length ? Response.json(rows[0]) : Response.json({ code: "PGRST116" }, { status: 406 });
    return Response.json(rows);
  }
  return new Response("not mocked", { status: 404 });
});

// SambaNova stand-in: answers, and counts the calls. snMode "echo" answers like the 10/1 models did (the book's day line
// restated from the prompt, rounded); "429" is the Developer tier's queue_full on every model.
let snCalls = 0;
let snMode: "ok" | "echo" | "429" = "ok";
Deno.serve({ port: SN_PORT, onListen: () => {} }, async (req) => {
  snCalls++;
  const b = await req.json();
  const user = String(b.messages?.[1]?.content ?? "");
  const judge = /Return ONLY \{"flag"/.test(user);
  if (snMode === "429") return Response.json({ error: { message: "queue_full", type: "queue_full" } }, { status: 429 });
  let answer = "• NVDA is up 0.5% today.";
  if (snMode === "echo") {
    const m = /TODAY \([^)]*\): ([+-]\$[\d,]+) \(([+-]?[\d.]+)%\)/.exec(user);
    const usd = m?.[1] ?? "+$0", pct = Number(m?.[2] ?? 0);
    answer = `• US stocks today: ${usd} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%).\n• Portfolio up ${usd.replace(/^[+-]/, "")} (${pct.toFixed(2)}%) today.\n• NVDA is up 0.5% today.\n• **Your 100 shares added about $90.`;
  }
  return Response.json({ choices: [{ message: { content: judge ? '{"flag": []}' : JSON.stringify({ answer, followups: ["Why is NVDA up today?"] }) }, finish_reason: "stop" }] });
});
// MARA stand-in for the outage replay: the answer lane works, the judge gets a 502 whose body never ends
Deno.serve({ port: MARA_PORT, onListen: () => {} }, async (req) => {
  const b = await req.json();
  const judge = /Return ONLY \{"flag"/.test(String(b.messages?.[1]?.content ?? ""));
  if (judge) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"error":')); } }), { status: 502 });
  return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "• NVDA is up 0.5% today.", followups: [] }) }, finish_reason: "stop" }] });
});

Deno.env.set("SUPABASE_URL", `http://localhost:${PORT}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
Deno.env.set("MARA_API_KEY", "x");
Deno.env.set("MARA_BASE_URL", "http://127.0.0.1:9");   // MARA down: a refused connection
Deno.env.set("SAMBANOVA_BASE_URL", `http://localhost:${SN_PORT}`);
Deno.env.set("SAMBANOVA_API_KEY", "sn-test");
let handler: ((r: Request) => Promise<Response>) | null = null;
const origServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) => { handler = typeof a === "function" ? a : b; return { finished: Promise.resolve(), shutdown: async () => {} }; };
await import("./index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = origServe;

const ask = async (question: string) => {
  const t0 = performance.now();
  const r = await handler!(new Request("http://x/", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ question }) }));
  return { ms: performance.now() - t0, status: r.status, body: await r.json() };
};

Deno.test({ name: "MARA down: Ask answers through SambaNova, fast and judged", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const before = snCalls;
  const r = await ask("What's moving my portfolio today?");
  assert(r.status === 200 && r.body.ok === true && !r.body.degraded, JSON.stringify(r.body).slice(0, 200));
  assert(/NVDA/.test(r.body.answer), r.body.answer);
  assert(r.body.meta?.judge === "ok", JSON.stringify(r.body.meta));
  assert(snCalls - before >= 2, `SambaNova calls ${snCalls - before}`);   // the answer and the judge
  assert(r.ms < 5000, `${Math.round(r.ms)}ms`);
} });

Deno.test({ name: "10/1 outage replay: a judge 502 whose body never ends does not hang Ask", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  Deno.env.set("MARA_BASE_URL", `http://localhost:${MARA_PORT}`);
  try {
    const r = await ask("What's moving my portfolio today?");
    assert(r.status === 200 && r.body.ok === true && !r.body.degraded, JSON.stringify(r.body).slice(0, 200));
    assert(r.body.meta?.judge === "ok", JSON.stringify(r.body.meta));   // SambaNova judged it (hedged in at 1.5s)
    assert(r.ms < 8000, `${Math.round(r.ms)}ms`);
  } finally { Deno.env.set("MARA_BASE_URL", "http://127.0.0.1:9"); }
} });

Deno.test({ name: "10/1 outage replay without any fallback: still no hard deadline, the timer bounds the stalled body", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  Deno.env.set("MARA_BASE_URL", `http://localhost:${MARA_PORT}`);
  Deno.env.delete("SAMBANOVA_BASE_URL");   // a fixture override without a SambaNova base: MARA alone
  try {
    const r = await ask("What's moving my portfolio today?");
    assert(r.status === 200 && r.body.ok === true && !r.body.degraded, JSON.stringify(r.body).slice(0, 200));
    assert(r.ms < 27000, `${Math.round(r.ms)}ms`);
  } finally { Deno.env.set("MARA_BASE_URL", "http://127.0.0.1:9"); Deno.env.set("SAMBANOVA_BASE_URL", `http://localhost:${SN_PORT}`); }
} });

// round 2 (10/1): "US stocks today: … US stocks today: …". The model restated the book's day line (rounded) and the code
// lead went on top of it. One copy of the lead, no echo of its dollar figure, the holdings line kept.
Deno.test({ name: "the code lead is not repeated by the model's own copy of it", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  snMode = "echo";
  try {
    const r = await ask("What's moving my portfolio today?");
    assert(r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 200));
    const a: string = r.body.answer;
    const usd = /\$[\d,]+/.exec(a.split("\n")[0])?.[0] ?? "";
    assert(usd, a);
    assert(a.split(usd).length - 1 === 1, `the day figure appears once:\n${a}`);
    assert((a.match(/US stocks|US \+ crypto/g) ?? []).length === 1, `one lead:\n${a}`);
    assert(!/Portfolio up/.test(a), a);
    assert(/NVDA/.test(a), a);
    // round 2: the subjectless follow-on gets its holding (NVDA is the 100-share holding), and the stray bold goes
    assert(/Your 100 (?:NVIDIA|NVDA) shares added about \$90\./.test(a) && !/\*\*/.test(a), a);
  } finally { snMode = "ok"; }
} });

// round 2 (10/1): MARA down and SambaNova out of queue (429) on both models: the code-built answer, fast, never the apology
Deno.test({ name: "MARA down + SambaNova 429 everywhere: the code-built answer, inside a few seconds", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  snMode = "429";
  try {
    const r = await ask("What's moving my portfolio today?");
    assert(r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 200));
    assert(!/couldn't finish|unavailable/i.test(r.body.answer), r.body.answer);
    assert(/\$[\d,]+/.test(r.body.answer), r.body.answer);
    assert(r.ms < 4000, `${Math.round(r.ms)}ms`);
  } finally { snMode = "ok"; }
} });
