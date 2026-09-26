// r11 P3: the repair pass patches TODAY's live-edition row in place (the Sep 25 close kept "the week's biggest loser",
// "Nasdaq futures sit at…" and "(as of …) (+0.3%)" all night) and never writes a "No confirmed date yet" watch.
// Runs the real handler against a local stand-in for Supabase. Run: deno test -A supabase/functions/daily-brief/repair_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";

const PORT = 54521;
const UID = "11111111-2222-3333-4444-555555555555";
const etToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const T: Record<string, unknown[]> = {
  portfolio: [
    { user_id: UID, symbol: "TSLA", name: "Tesla, Inc.", kind: "stock", account: "brokerage", currency: "USD", qty: 10, price: 380, value: 3800, change_pct: -2.1, avg_cost: 250, total_gl: 1300, as_of: day(0) },
    { user_id: UID, symbol: "VOO", name: "Vanguard S&P 500 ETF", kind: "etf", account: "brokerage", currency: "USD", qty: 10, price: 700, value: 7000, change_pct: 0.5, avg_cost: 500, total_gl: 2000, as_of: day(0) },
  ],
  profiles: [{ id: UID, investor: null }],
  prices: [{ symbol: "USDKRW", price: 1357 }],
  price_history: [
    // a base on each of the 7-11 days back: on a weekend or a Monday the 7-day cutoff is an earlier session's close, and a
    // single base stamped exactly now-7d fell after it (every window read null on Saturday 2026-09-26)
    ...[7, 8, 9, 10, 11].flatMap((n) => [{ symbol: "TSLA", ts: day(n), price: 360 }, { symbol: "VOO", ts: day(n), price: 690 }]),
    // r13 M1: a 1-year base (365-369 days back) and a year-end base, so TSLA is +280% over 1Y and +90% YTD
    ...[365, 366, 367, 368, 369].map((n) => ({ symbol: "TSLA", ts: day(n), price: 100 })),
    { symbol: "TSLA", ts: "2025-12-30T21:00:00.000Z", price: 200 }, { symbol: "TSLA", ts: "2025-12-31T21:00:00.000Z", price: 200 },
    { symbol: "TSLA", ts: day(0), price: 380 }, { symbol: "VOO", ts: day(0), price: 700 },
  ],
  daily_briefs: [{ id: 1, user_id: UID, edition: "close", brief_date: etToday, gen_version: 11, generated_at: day(0.05),
    sections: { lede: "A $9,447 (as of the 4:00 PM ET close) (+0.3%) gain. TSLA was the week's biggest loser.",
      overnight: "The S&P 500 closed at 7,743.41 (+0.5%), Nasdaq futures sit at 30,921.75.", desk_view: "Concentration stays high. A clean beat rerates the whole portfolio. Tesla leads the book. It rose 280% this year.",
      positions: [{ name: "Tesla", note: "Tesla fell 2.1%.", watch: "No confirmed date yet" }], calendar: [] } }],
};
const patches: Record<string, unknown>[] = [];
const eqOf = (u: URL, col: string) => { const v = u.searchParams.get(col); return v && v.startsWith("eq.") ? decodeURIComponent(v.slice(3)) : null; };
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname.startsWith("/rest/v1/rpc/")) return Response.json(null);
  if (u.pathname.startsWith("/rest/v1/")) {
    const t = u.pathname.split("/").pop()!;
    if (req.method === "PATCH") { patches.push({ table: t, body: await req.json() }); return Response.json([]); }
    if (req.method !== "GET" && req.method !== "HEAD") { await req.text(); return Response.json([], { status: 201 }); }
    let rows = (T[t] ?? []) as Record<string, unknown>[];
    for (const col of ["user_id", "symbol", "edition", "brief_date", "id"]) { const v = eqOf(u, col); if (v !== null) rows = rows.filter((r) => String(r[col]) === v); }
    for (const v of u.searchParams.getAll("ts")) {
      const [op, arg] = [v.slice(0, v.indexOf(".")), decodeURIComponent(v.slice(v.indexOf(".") + 1))];
      rows = rows.filter((r) => op === "lte" ? String(r.ts) <= arg : op === "gte" ? String(r.ts) >= arg : op === "lt" ? String(r.ts) < arg : true);
    }
    const ord = u.searchParams.get("order");
    if (ord) { const [c, dir] = ord.split(","); const [col, d] = c.split("."); rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (d === "desc" || dir === "desc" ? -1 : 1)); }
    const lim = u.searchParams.get("limit"); if (lim) rows = rows.slice(0, Number(lim));
    if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) return rows.length ? Response.json(rows[0]) : Response.json({ code: "PGRST116" }, { status: 406 });
    return Response.json(rows);
  }
  if (u.pathname.startsWith("/auth/v1/admin/users")) return Response.json({ users: [], aud: "authenticated" });
  if (u.pathname.startsWith("/functions/v1/")) { await req.text(); return Response.json({ ok: true }); }
  return new Response("not mocked", { status: 404 });
});
Deno.env.set("SUPABASE_URL", `http://localhost:${PORT}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
Deno.env.set("INTERNAL_TOKEN", "itok");
Deno.env.set("MARA_API_KEY", "x");
let handler: ((r: Request) => Promise<Response>) | null = null;
const origServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) => { handler = typeof a === "function" ? a : b; return { finished: Promise.resolve(), shutdown: async () => {} }; };
await import("./index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = origServe;

Deno.test({ name: "repair: today's live row is patched in place; no placeholder watch", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = await handler!(new Request("http://x/?fixture=1", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": "itok" }, body: JSON.stringify({ noAudio: true, fanout: false }) }));
  assertEquals(r.status, 200);
  await r.text();
  const p = patches.find((x) => x.table === "daily_briefs" && (x.body as { sections?: unknown }).sections) as { body: { sections: { lede: string; overnight: string; positions: { watch: string }[] } } } | undefined;
  assert(p, "the live row was patched");
  const sec = p!.body.sections;
  assert(!/biggest loser/.test(sec.lede), sec.lede);
  assert(!/futures/.test(sec.overnight), sec.overnight);
  assert(!/rerates/.test((sec as { desk_view?: string }).desk_view ?? ""), (sec as { desk_view?: string }).desk_view);   // r12 D
  assert(/280% over the past year/.test((sec as { desk_view?: string }).desk_view ?? ""), (sec as { desk_view?: string }).desk_view);   // r13 M1
  assert(!/\) \(/.test(sec.lede), sec.lede);
  assert(sec.positions.every((x) => !/no confirmed date yet/i.test(x.watch)), JSON.stringify(sec.positions));
  await server.shutdown();
} });
