// 10/1: when the hard deadline hits, Ask ships the code-built answer it already has, never the apology. Models hang
// (MARA and no fallback), the deadline is pulled in to 4s. Run: deno test -A supabase/functions/ask/deadline_test.ts
import { assert } from "jsr:@std/assert@1";

const PORT = 54551, MARA_PORT = 54553;
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

Deno.serve({ port: MARA_PORT, onListen: () => {} }, async (req) => {
  await req.text();
  await new Promise((r) => setTimeout(r, 60000));   // every model call hangs
  return Response.json({});
});
Deno.env.set("SUPABASE_URL", `http://localhost:${PORT}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
Deno.env.set("MARA_API_KEY", "x");
Deno.env.set("MARA_BASE_URL", `http://localhost:${MARA_PORT}`);
Deno.env.delete("SAMBANOVA_BASE_URL");
Deno.env.set("ASK_HARD_DEADLINE_MS", "4000");
let handler: ((r: Request) => Promise<Response>) | null = null;
const origServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) => { handler = typeof a === "function" ? a : b; return { finished: Promise.resolve(), shutdown: async () => {} }; };
await import("./index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = origServe;

Deno.test({ name: "hard deadline: the code-built answer ships, never the apology", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const t0 = performance.now();
  const r = await handler!(new Request("http://x/", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ question: "What's moving my portfolio today?" }) }));
  const b = await r.json();
  assert(r.status === 200 && b.ok === true && !b.degraded, JSON.stringify(b).slice(0, 200));
  assert(!/couldn't finish/i.test(b.answer) && /NVDA|AMZN|portfolio/i.test(b.answer), b.answer);
  assert(b.meta?.code === "deadline", JSON.stringify(b.meta));
  assert(performance.now() - t0 < 5000, `${Math.round(performance.now() - t0)}ms`);
} });
