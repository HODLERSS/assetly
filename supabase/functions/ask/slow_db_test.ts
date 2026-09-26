// r10 (v51 stall): with every database read taking 3s, routed (decision-shaped) questions must still answer in under
// 5s, and data questions well inside the budget. Runs the real handler against a local stand-in for Supabase and the
// model gateway. Run: deno test -A supabase/functions/ask/slow_db_test.ts
import { assert } from "jsr:@std/assert@1";

const PORT = 54511, READ_DELAY = 3000;
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
  if (u.pathname === "/v1/chat/completions") {
    await req.text();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "• NVDA is up 0.5% today.", followups: [], flag: [] }) }, finish_reason: "stop" }] });
  }
  return new Response("not mocked", { status: 404 });
});

Deno.env.set("SUPABASE_URL", `http://localhost:${PORT}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
Deno.env.set("MARA_API_KEY", "x");
Deno.env.set("MARA_BASE_URL", `http://localhost:${PORT}`);
// capture the handler instead of binding a port
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
  const body = await r.json();
  return { ms: performance.now() - t0, status: r.status, body };
};

Deno.test({ name: "slow database: routed questions answer under 5s", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const q of ["Should I rebalance?", "Which is safer, NVDA or AMZN?", "At what price should I sell META?", "How much will my portfolio be worth in 5 years?"]) {
    const r = await ask(q);
    assert(r.status === 200 && r.body.ok === true, `${q}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    assert(r.ms < 5000, `${q}: ${Math.round(r.ms)}ms`);
  }
} });

Deno.test({ name: "slow database: data questions answer inside the budget", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const q of ["What's NVDA's 1-year return?", "What was my return in 2024?"]) {
    const r = await ask(q);
    assert(r.status === 200 && r.body.ok === true, q);
    assert(r.ms < 12000, `${q}: ${Math.round(r.ms)}ms`);
  }
  await server.shutdown();
} });
