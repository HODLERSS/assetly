// r13 intelligence M1: code answers that answer the question, and a weekend-aware "Today" line.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { intentAnswer, type IntentRow, sessionDayLine } from "./intel.ts";

const row = (o: Partial<IntentRow> & { name: string; usd: number }): IntentRow => ({ symbol: o.name, kind: "stock", weight: 0, qty: 10, currency: "USD", price: 100, avgCost: null, costUsd: null, glUsd: null,
  dayPct: 0, dayUsd: 0, heads: [], ...o });
const TOTAL = 3519234;
const rows = [
  row({ name: "NVDA", usd: 675210, weight: 19.2, costUsd: 300000, glUsd: 375210, avgCost: 100, qty: 3000 }),
  row({ name: "META", usd: 450996, weight: 12.8, dayPct: -3.3, dayUsd: -15390, heads: [{ title: "Meta loses jury verdict", source: "Reuters", date: "09/25" }] }),
  row({ name: "TSLA", usd: 260477, weight: 7.4, costUsd: 174090, glUsd: 86387, avgCost: 217.61, qty: 800, price: 325.6, maxClose: 479.86 }),
  row({ name: "AAPL", usd: 478000, weight: 13.6, costUsd: 200000, glUsd: 278000, price: 341.07, maxClose: 341.07 }),
  row({ name: "AVGO", usd: 91731, weight: 2.6 }),
  row({ name: "SOXL", usd: 100000, weight: 2.8, kind: "etf", leveraged: true }),
];
const ctx = { totalUsd: TOTAL, sessionLabel: "in Friday's session", athTracked: true };

Deno.test("r31 M1(b): the Today line on a closed day names the session and Home's figure", () => {
  assertEquals(sessionDayLine({ open: false, usd: 9447, pct: 0.27, weekday: "Friday" }), "• Markets are closed; in Friday's session your portfolio was +$9,447 (+0.27%).");
  assertEquals(sessionDayLine({ open: true, usd: -120, pct: -0.01, weekday: "Friday" }), "• Today your portfolio is −0.01% (−$120).");
});

Deno.test("r31 M1(a): smallest holding, cost basis, why, stress, tax, ATH", () => {
  const small = intentAnswer("What's my smallest holding?", rows, [], ctx)!;
  assert(small.startsWith("• Your smallest holdings: AVGO 2.6%"), small);
  const basis = intentAnswer("What's my cost basis in TSLA?", rows, [rows[2]], ctx)!;
  assert(basis.includes("TSLA: cost basis $174,090 (800 shares at $217.61)") && basis.includes("+$86,387"), basis);
  const tot = intentAnswer("What's my total cost basis?", rows, [], ctx)!;
  assert(tot.includes("Total cost basis $674,090"), tot);
  const why = intentAnswer("Why did META drop today?", rows, [rows[1]], ctx)!;
  assert(why.includes("META fell 3.3% in Friday's session") && why.includes("Meta loses jury verdict") && why.includes("Reuters"), why);
  const nas = intentAnswer("What happens if the Nasdaq drops 20%?", rows, [], ctx)!;
  assert(/If every stock and fund you hold fell 20%/.test(nas) && /SOXL is a leveraged fund/.test(nas), nas);
  const one = intentAnswer("What if TSLA falls 20%?", rows, [rows[2]], ctx)!;
  assert(one.includes("If TSLA fell 20%: −$52,095"), one);
  const tax = intentAnswer("How much tax would I owe if I sold all my AAPL today?", rows, [rows[3]], ctx)!;
  assert(tax.includes("doesn't give tax advice") && tax.includes("AAPL: unrealized gain +$278,000"), tax);
  const ath = intentAnswer("Which of my stocks hit an all-time high today?", rows, [], ctx)!;
  assert(ath.includes("AAPL ($341.07)") && ath.includes("TSLA 32.1% below"), ath);
  assertEquals(intentAnswer("Which of my stocks hit an all-time high today?", rows, [], { ...ctx, athTracked: false }), "• Record highs aren't tracked yet.");
  assertEquals(intentAnswer("What's my most profitable holding?", rows, [], ctx), null);
});
