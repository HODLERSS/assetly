// e2e p06: the honest text is only ever the whole answer; a crypto-share intent; "the only positive coin".
import { assert, assertEquals } from "jsr:@std/assert@1";
import { intentAnswer, type IntentRow, rankPositionClaims, stripHonestBlock } from "./intel.ts";

Deno.test("r33 p06 F1: the honest block goes whenever other content stands beside it", () => {
  const honest = "I couldn't put a complete answer together just now. Here's what I can tell you:\n• Your holdings: BTC (crypto) 25.2%, NVDA (stock) 19.2%.\n• Cash: 3.4% of assets.\n• Try asking again, or rephrase the question.";
  const body = "• Crypto: 32.4% of assets ($8,370): BTC 25.2% ($6,500), ETH 4.8% ($1,240), SOL 2.4% ($630).";
  assertEquals(stripHonestBlock(`${honest}\n${body}`), body);
  assertEquals(stripHonestBlock(`${body}\n${honest}`), body);
  assertEquals(stripHonestBlock(honest), honest);
  assertEquals(stripHonestBlock(body), body);
});

Deno.test("r33 p06: a crypto-share question is answered in code", () => {
  const rs: IntentRow[] = [
    { name: "BTC", symbol: "BTC", kind: "crypto", usd: 6500, weight: 25.2, qty: 0.06, currency: "USD", price: 108000, avgCost: null, costUsd: null, glUsd: null, dayPct: 1.1, dayUsd: 70 },
    { name: "ETH", symbol: "ETH", kind: "crypto", usd: 1240, weight: 4.8, qty: 0.46, currency: "USD", price: 2687, avgCost: null, costUsd: null, glUsd: null, dayPct: -0.4, dayUsd: -5 },
    { name: "NVDA", symbol: "NVDA", kind: "stock", usd: 4950, weight: 19.2, qty: 22, currency: "USD", price: 225, avgCost: null, costUsd: null, glUsd: null, dayPct: 0.2, dayUsd: 10, tech: true },
  ];
  const ctx = { totalUsd: 25800, sessionLabel: "today", athTracked: false, cashPct: 3.4 };
  assertEquals(intentAnswer("What's my crypto share?", rs, [], ctx), "• Crypto: 30.0% of assets ($7,740): BTC 25.2% ($6,500), ETH 4.8% ($1,240).");
  assertEquals(intentAnswer("How much of my money is in cash?", rs, [], ctx), "• Cash: 3.4% of assets.");
  assert(intentAnswer("What's my tech exposure?", rs, [], ctx)!.startsWith("• Tech and chip holdings: 19.2% of assets"));
});

Deno.test("r33 p06: 'the only positive coin' is held to the day signs", () => {
  const facts = [{ names: ["AVAX"], pct: { 0: 2.1, 7: 5.0 } }, { names: ["BTC"], pct: { 0: 1.1, 7: -2.0 } }, { names: ["ETH"], pct: { 0: -0.4, 7: -3.0 } }];
  // the audit's shape: the "only" claim in one sentence, the contradicting coin in the next
  assertEquals(rankPositionClaims("AVAX is the only positive coin today. BTC is also up 1.1%.", facts, null), ["AVAX is the only positive coin today."]);
  assertEquals(rankPositionClaims("AVAX is the only positive coin this week.", facts, null), []);
  assertEquals(rankPositionClaims("ETH is the only coin down.", facts, null), []);
});
