// r13 intelligence M1: code answers that answer the question, and a weekend-aware "Today" line.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fixBookDayClaims, fixCurrentPriceClaims, fixGroupSharePctFirst, intentAnswer, type IntentRow, sessionDayLine, TECH_GROUP_LABEL, dualClassFacts } from "./intel.ts";

Deno.test("r31 r14 A+B: risk intent, share classes, tech-and-chip share figure-first", () => {
  const rs: IntentRow[] = [
    { name: "SOXL", symbol: "SOXL", kind: "etf", usd: 6045, weight: 23.4, qty: 40, currency: "USD", price: 151.45, avgCost: 35, costUsd: 1400, glUsd: 4645, dayPct: 3.5, dayUsd: 204, leveraged: true, tech: true },
    { name: "AAPL", symbol: "AAPL", kind: "stock", usd: 3410, weight: 13.2, qty: 10, currency: "USD", price: 341, avgCost: 180, costUsd: 1800, glUsd: 1610, dayPct: 0.1, dayUsd: 3, tech: true },
    { name: "TSLA", symbol: "TSLA", kind: "stock", usd: 2971, weight: 11.5, qty: 8, currency: "USD", price: 371, avgCost: 250, costUsd: 2000, glUsd: 971, dayPct: -1.5, dayUsd: -45, tech: false },
  ];
  const r = intentAnswer("What's my biggest risk right now?", rs, [], { totalUsd: 25837, sessionLabel: "in Friday's session", athTracked: false, cashPct: 11.6 })!;
  assert(r.includes("Largest holding: SOXL, 23.4%") && r.includes("Tech and chip holdings: 36.6%") && r.includes("SOXL is a leveraged fund") && r.includes("Cash: 11.6%"), r);
  assert(dualClassFacts("What's the difference between BRK.B and BRK.A?").length > 0);
  const g = [{ label: TECH_GROUP_LABEL, value: 48.1 }];
  assertEquals(fixGroupSharePctFirst("About 70% of your money sits in tech and chip stocks.", g), "About 48.1% of your money sits in tech and chip stocks.");
  assertEquals(fixGroupSharePctFirst("About 49% of your money sits in tech stocks.", g), "About 49% of your money sits in tech stocks.");
});

Deno.test("r31 M2: the whole-book day figure is Home's; a current price is the latest price", () => {
  const hs = [{ names: ["AMZN"] }, { names: ["NVDA"] }];
  assertEquals(fixBookDayClaims("Portfolio gained ≈ $11,155 on Friday, about 0.32%.", { usd: 9447, pct: 0.27 }, hs), "Portfolio gained $9,447 on Friday, about 0.27%.");
  assertEquals(fixBookDayClaims("Your portfolio was +$9,450 (+0.27%) in Friday's session.", { usd: 9447, pct: 0.27 }, hs), "Your portfolio was +$9,450 (+0.27%) in Friday's session.");
  assertEquals(fixBookDayClaims("AMZN added $377 to the portfolio on Friday.", { usd: 9447, pct: 0.27 }, hs), "AMZN added $377 to the portfolio on Friday.");
  assertEquals(fixBookDayClaims("The portfolio is up $410,000 this year.", { usd: 9447, pct: 0.27 }, hs), "The portfolio is up $410,000 this year.");
  const f = [{ names: ["NVDA"], price: 225.07, prevClose: 224.58 }];
  assertEquals(fixCurrentPriceClaims("NVDA's current price: previous session close $224.58, up 0.2%.", f), "NVDA's current price: latest close $225.07, up 0.2%.");
  assertEquals(fixCurrentPriceClaims("NVDA closed Thursday at $224.58.", f), "NVDA closed Thursday at $224.58.");
});

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
