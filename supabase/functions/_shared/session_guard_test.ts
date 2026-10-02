// 10/2 owner report: the 9:21 AM KST Korea Open said "Korean stocks surged, adding about $11k" and listed SK hynix +3.2%,
// Samsung Pref +4.8%, IBK -0.2%, Korean Re -1.9%: the Oct 1 KRX session's moves, reused as Oct 2's. Yahoo's KRX feed runs
// ~20 minutes behind, so at 9:20 KST the prices rows still held Oct 1's close. A day move belongs to the session it was
// printed in (calendar.ts dayMoveCurrent / withholdStaleMoves), and a sentence moving a withheld name is dropped
// (brief_guards.ts dropAwaitingMoves).
// Run: deno test -A supabase/functions/_shared/session_guard_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { awaitingTag, ctxMarketOf, dayMoveCurrent, liveFigureLabel, quoteSession, withholdStaleMoves } from "./calendar.ts";
import { labelLiveFigures } from "./intel.ts";
import { dropAwaitingMoves } from "./brief_guards.ts";

const AT_0921_KST = new Date("2026-10-02T00:21:43Z");   // the stored kr_open's generated_at
const OCT1_CLOSE = "2026-10-01T06:30:00Z";              // 3:30 PM KST Oct 1, the rows' as_of at that moment

const ownerRows = () => [
  { symbol: "000660.KS", kind: "stock", currency: "KRW", change_pct: 3.21, as_of: OCT1_CLOSE },
  { symbol: "005935.KS", kind: "stock", currency: "KRW", change_pct: 4.76, as_of: OCT1_CLOSE },
  { symbol: "024110.KS", kind: "stock", currency: "KRW", change_pct: -0.25, as_of: OCT1_CLOSE },
  { symbol: "003690.KS", kind: "stock", currency: "KRW", change_pct: -1.85, as_of: OCT1_CLOSE },
  { symbol: "MARA", kind: "stock", currency: "USD", change_pct: -2.1, as_of: "2026-10-01T20:00:00Z" },   // Oct 1 US close (4 PM ET)
  { symbol: "$USD", kind: "cash", currency: "USD", change_pct: null, as_of: null },
];

Deno.test("regression 10/2: at 9:21 KST every Korean move from Oct 1 is withheld, the US close stands", () => {
  const rows = ownerRows();
  const w = withholdStaleMoves(rows, AT_0921_KST);
  assertEquals([...w].sort(), ["000660.KS", "003690.KS", "005935.KS", "024110.KS"]);
  for (const r of rows.filter((x) => x.symbol.endsWith(".KS"))) assertEquals(r.change_pct, null);
  // 8:21 PM ET: the US session that closed at 4 PM is still the last US session, so its move stands (labelled by dayTag)
  assertEquals(rows.find((r) => r.symbol === "MARA")!.change_pct, -2.1);
  // the day_by_symbol the brief stamps is built from the guarded rows: no Korean entry survives
  const dayBy = Object.fromEntries(rows.filter((r) => r.change_pct !== null && !r.symbol.startsWith("$")).map((r) => [r.symbol, r.change_pct]));
  assertEquals(dayBy, { MARA: -2.1 });
});

Deno.test("regression 10/2: once an Oct 2 print lands (as_of 00:16Z) the live move is today's", () => {
  const rows = [{ symbol: "000660.KS", kind: "stock", currency: "KRW", change_pct: 0.27, as_of: "2026-10-02T00:16:00Z" }];
  assertEquals(withholdStaleMoves(rows, new Date("2026-10-02T00:40:00Z")).size, 0);
  assertEquals(rows[0].change_pct, 0.27);
});

Deno.test("KOSPI and FX in the market context follow the same rule", () => {
  const ctx = [
    { symbol: "^KS11", change_pct: 1.9, as_of: OCT1_CLOSE },
    { symbol: "USDKRW", change_pct: 0.1, as_of: "2026-10-02T00:20:00Z" },
    { symbol: "^GSPC", change_pct: 0.4, as_of: "2026-10-01T20:00:00Z" },
  ];
  const w = withholdStaleMoves(ctx, AT_0921_KST, (r) => ctxMarketOf(r.symbol));
  assertEquals([...w], ["^KS11"]);
  assertEquals(ctxMarketOf("^KS11"), "KR");
  assertEquals(ctxMarketOf("USDKRW"), null);
  assertEquals(ctxMarketOf("ES=F"), null);
  assertEquals(ctxMarketOf("^VIX"), "US");
  // an FX print older than 3 hours is no day move
  assert(!dayMoveCurrent("2026-10-01T18:00:00Z", null, AT_0921_KST));
});

Deno.test("US editions: before the open the last session's move stands; after the bell a previous-session quote is withheld", () => {
  const sep30Close = "2026-09-30T20:00:00Z";
  assert(dayMoveCurrent(sep30Close, "US", new Date("2026-10-01T12:30:00Z")));        // 8:30 AM ET Thu: Wednesday's session, labelled past
  assert(!dayMoveCurrent(sep30Close, "US", new Date("2026-10-01T13:35:00Z")));       // 9:35 AM ET: no print yet today
  assert(dayMoveCurrent("2026-10-01T13:34:10Z", "US", new Date("2026-10-01T13:35:00Z")));
  // a quote two sessions old is never the last session's move
  assert(!dayMoveCurrent("2026-09-29T20:00:00Z", "US", new Date("2026-10-01T12:30:00Z")));
  // weekend: Friday's close is the last session
  assert(dayMoveCurrent("2026-10-02T20:00:00Z", "US", new Date("2026-10-03T15:00:00Z")));
});

Deno.test("quoteSession: a print before the open or on a holiday belongs to the session before", () => {
  assertEquals(quoteSession("2026-10-01T23:50:00Z", "KR"), "2026-10-01");   // 8:50 AM KST Oct 2, pre-open
  assertEquals(quoteSession("2026-10-02T00:00:00Z", "KR"), "2026-10-02");   // the 9:00 open print
  assertEquals(quoteSession("2026-10-05T02:00:00Z", "KR"), "2026-10-02");   // Oct 5 is a KRX holiday (Chuseok substitute)
  assertEquals(quoteSession("2026-10-01T20:00:00Z", "US"), "2026-10-01");
});

Deno.test("Korean holiday: a Korea book on a KRX holiday keeps the last session's move (labelled past by dayTag)", () => {
  assert(dayMoveCurrent("2026-10-02T06:30:00Z", "KR", new Date("2026-10-05T02:00:00Z")));
});

Deno.test("crypto rolls by the clock; missing timestamps are never current", () => {
  assert(dayMoveCurrent("2026-10-02T00:10:00Z", null, AT_0921_KST));
  assert(!dayMoveCurrent(null, "KR", AT_0921_KST));
  assert(!dayMoveCurrent("garbage", "US", AT_0921_KST));
});

Deno.test("the awaiting label tells the writer there is no day move", () => {
  const t = awaitingTag("KR", AT_0921_KST);
  assert(/21 min in/.test(t) && /awaiting the first trades/.test(t) && /NO day move/.test(t), t);
});

const AWAIT = [
  { names: ["SK hynix"] }, { names: ["Samsung Electronics (Pref)", "Samsung Electronics", "Samsung Pref", "Samsung"] },
  { names: ["Industrial Bank of Korea", "IBK"] }, { names: ["Korean Re"] },
];

Deno.test("regression 10/2: the stored lede and overnight lose every move claimed for an untraded name", () => {
  const lede = "Korean stocks surged, adding about $11k to your portfolio as SK hynix and Samsung Pref led the open.";
  assertEquals(dropAwaitingMoves(lede, AWAIT, true), "");
  const overnight = "KOSPI 6,971.35 (+1.9%) · USDKRW 1,402.1. Samsung Electronics (Pref) led Korean gains with +4.8%. Watch the 3:30 PM KST close.";
  assertEquals(dropAwaitingMoves(overnight, AWAIT, true), "Watch the 3:30 PM KST close.");
  const note = "SK hynix rose 3.2%, lifting your largest Korean holding.";
  assertEquals(dropAwaitingMoves(note, AWAIT, true), "");
});

Deno.test("dropAwaitingMoves keeps weights, awaiting statements, and names that did trade", () => {
  const s = "SK hynix is 21.4% of assets. SK hynix is awaiting its first trades this morning. MARA fell 2.1% in Thursday's session.";
  assertEquals(dropAwaitingMoves(s, AWAIT, true), s);
  // a Korean group claim stands while some Korean name has traded
  const g = "Korean stocks rose 0.4% in the first minutes.";
  assertEquals(dropAwaitingMoves(g, AWAIT.slice(0, 1), false), g);
  assertEquals(dropAwaitingMoves(g, [], true), g);
});

Deno.test("regression 10/2: a Korea Open's dollar figures are tagged in KST, never with the US close", () => {
  const at = new Date("2026-10-02T00:45:00Z");   // 9:45 AM KST = 8:45 PM ET, the US market past its close
  assertEquals(liveFigureLabel("kr_open", at), "as of 9:45 AM KST");
  const lede = "SK Hynix's 0.4% rise adds $1,100 to your portfolio.";
  const out = labelLiveFigures(lede, [1100], liveFigureLabel("kr_open", at));
  assertEquals(out, "SK Hynix's 0.4% rise adds $1,100 (as of 9:45 AM KST) to your portfolio.");
  assert(!/ET close/.test(out));
  assertEquals(liveFigureLabel("kr_close", new Date("2026-10-02T06:45:00Z")), "as of the 3:30 PM KST close");
});

Deno.test("US editions keep the ET rule", () => {
  assertEquals(liveFigureLabel("midday", new Date("2026-10-01T16:31:00Z")), "as of 12:31 PM ET");
  assertEquals(liveFigureLabel("close", new Date("2026-10-01T20:40:00Z")), "as of the 4:00 PM ET close");
  assertEquals(liveFigureLabel("morning", new Date("2026-10-01T12:30:00Z")), "as of 8:30 AM ET");
});
