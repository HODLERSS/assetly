// r11 P4: wrong facts held to computed data.
import { assertEquals } from "jsr:@std/assert@1";
import { companySizeClaims, countClaims, directionCauseClaims, groupShareFirstClaims, pointContributionClaims, productVersionClaims, rankPositionClaims, relativeGapClaims } from "./intel.ts";

Deno.test("r28 P4: date gaps, company size, group shares, points, product generations, cause direction, counts, the drag", () => {
  const tsla = [{ names: ["TSLA", "Tesla"], dates: { earnings: "2026-10-21", deliveries: "2026-10-02", exdate: null } }];
  assertEquals(relativeGapClaims("TSLA Q3 deliveries ~Oct 2, one week before earnings.", tsla).length, 1);
  assertEquals(relativeGapClaims("TSLA Q3 deliveries ~Oct 2, about three weeks before earnings.", tsla), []);
  const caps = [{ names: ["NVDA"], mcap: 4.4e12 }, { names: ["AAPL"], mcap: 3.6e12 }];
  assertEquals(companySizeClaims("AAPL is the biggest company by far.", caps).length, 1);
  assertEquals(companySizeClaims("NVDA is the largest company you own.", caps), []);
  assertEquals(groupShareFirstClaims("About ~83% mega-cap tech (5 names).", [{ label: /(?:mega[- ]?cap )?tech/, value: 69.5 }]).length, 1);
  assertEquals(groupShareFirstClaims("About 70% mega-cap tech.", [{ label: /(?:mega[- ]?cap )?tech/, value: 69.5 }]), []);
  assertEquals(pointContributionClaims("TSLA는 약 15%p를 끌어내렸습니다.", [{ names: ["TSLA"], weight: 10, pct: { 30: -17 } }]).length, 1);
  assertEquals(pointContributionClaims("TSLA took about 1.7 points off.", [{ names: ["TSLA"], weight: 10, pct: { 30: -17 } }]), []);
  assertEquals(productVersionClaims("Apple's iPhone 17 cycle drove the gain.", "Apple iPhone 18 pre-orders beat estimates").length, 1);
  assertEquals(productVersionClaims("Apple's iPhone 18 cycle drove the gain.", "Apple iPhone 18 pre-orders beat estimates"), []);
  assertEquals(directionCauseClaims("META fell 3.3% after JPMorgan's bullish call.").length, 1);
  assertEquals(directionCauseClaims("META fell 3.3% after a jury verdict.").length, 0);
  const facts = [{ names: ["NVDA"] }, { names: ["TSLA"] }];
  assertEquals(countClaims("Your book holds nine single stocks.", facts, { stocks: 8, funds: 1, holdings: 9 }).length, 1);
  assertEquals(countClaims("Your book holds eight single stocks.", facts, { stocks: 8, funds: 1, holdings: 9 }), []);
  const f = [{ names: ["TSLA"], pct: { 30: -2 }, weight: 10 }, { names: ["AVGO"], pct: { 30: -4.4 }, weight: 10 }, { names: ["MSFT"], pct: { 30: 5 }, weight: 10 }];
  assertEquals(rankPositionClaims("TSLA was the drag this month.", f).length, 1);
  assertEquals(rankPositionClaims("AVGO was the drag this month.", f), []);
});

Deno.test("r28 P5/P6: routing, lexicon, income is not a projection", async () => {
  const { isDecisionFrame, isForecastQuestion, softVerdicts } = await import("./intel.ts");
  for (const q of ["Where is support for TSLA?", "Has NVDA bottomed out?", "테슬라 바닥은 어디야?", "Should I sell covered calls on AAPL?", "Is buying on margin a good idea?", "Does TSLA deserve its premium?", "Is NVDA overvalued?", "Is AAPL cheap here?", "Roast my portfolio", "Be brutal: how bad is my book?"])
    if (!isDecisionFrame(q)) throw new Error(q);
  for (const q of ["What's my cost basis?", "How much cash do I have?", "When does NVDA report?"]) if (isDecisionFrame(q)) throw new Error(q);
  for (const s of ["That's priced in.", "The dip adds a floor under the stock.", "NVDA is in a recovery phase.", "Compounding is intact.", "Momentum has stalled.", "The story is still intact.", "The opportunity cost is real.", "The risk is meaningful but not extreme."]) assertEquals(softVerdicts(s).length, 1, s);
  assertEquals(isForecastQuestion("How much will I get in dividends each year?"), false);
  assertEquals(isForecastQuestion("How much will my portfolio be worth in 5 years?"), true);
});

Deno.test("r28 P7: escaped breaks and share-class facts", async () => {
  const { unescapeBreaks, dualClassFacts, dualClassClaims } = await import("./intel.ts");
  assertEquals(unescapeBreaks("• BRK.B is 12%.\\n• BRK.A is 0%."), "• BRK.B is 12%.\n• BRK.A is 0%.");
  assertEquals(dualClassFacts("BRK.B vs BRK.A").length, 1);
  assertEquals(dualClassClaims("One BRK.A share equals 1,000 Class B shares.").length, 1);
  assertEquals(dualClassClaims("One BRK.A share equals 1,500 Class B shares.").length, 0);
  assertEquals(dualClassClaims("A BRK.B share has 1/200 of the vote of an A share.").length, 1);
});

Deno.test("r28 P5: information about a held leveraged ETF is answered; a leverage decision is not", async () => {
  const { isDecisionFrame, isTradeQuestion, isPickQuestion } = await import("./intel.ts");
  const decision = (q: string) => isDecisionFrame(q) || isTradeQuestion(q) || isPickQuestion(q);
  for (const q of ["What is SOXL and why does it move so much?", "How does SOXL's daily reset work?", "What did SOXL do this week?", "What is a covered call?"]) if (decision(q)) throw new Error("routed: " + q);
  for (const q of ["Should I buy a 3x fund?", "Is leverage a good idea for me?", "Should I sell covered calls on AAPL?", "Is buying on margin a good idea?", "Should I use options to hedge?"]) if (!decision(q)) throw new Error("not routed: " + q);
});

Deno.test("r28 P8: quality-read wording", async () => {
  const { cleanNote, codeRisk, wordWatch, plainLeverage, lowYieldIncomeClaims, fixFragments } = await import("./intel.ts");
  if (!cleanNote("Ether is the base asset of Ethereum, with self-custody risk in passing.").needsRisk) throw new Error("ETH needs a risk line");
  if (!/credit|insurance/.test(codeRisk("equity", "financials"))) throw new Error("financials fallback");
  assertEquals(wordWatch("Price drop >20%"), "Price falls more than 20%");
  assertEquals(wordWatch("Outflows >$1B weekly"), "Outflows rise above $1B weekly");
  assertEquals(cleanNote("SOXL tracks chips, giving an edge. The risk: a drop.").note, "The risk: a drop.");
  if (/decay/.test(plainLeverage("The risk: daily reset decay risk."))) throw new Error("gloss");
  assertEquals(lowYieldIncomeClaims("It pays income. It holds 500 stocks.", 0.42).length, 1);
  assertEquals(lowYieldIncomeClaims("It pays income.", 3.4), []);
  assertEquals(fixFragments("Demand must persist across market cycles for the portfolio."), "Demand must persist across market cycles.");
});
