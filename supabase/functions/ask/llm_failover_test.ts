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

// SambaNova stand-in: answers, and counts the calls
let snCalls = 0;
Deno.serve({ port: SN_PORT, onListen: () => {} }, async (req) => {
  snCalls++;
  const b = await req.json();
  const judge = /Return ONLY \{"flag"/.test(String(b.messages?.[1]?.content ?? ""));
  return Response.json({ choices: [{ message: { content: judge ? '{"flag": []}' : JSON.stringify({ answer: "• NVDA is up 0.5% today.", followups: ["Why is NVDA up today?"] }) }, finish_reason: "stop" }] });
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
