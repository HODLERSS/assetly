// r12 A/B/C/E/F.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { askedCount, isDecisionFrame, portfolioSummaryLead, softVerdicts } from "./intel.ts";

Deno.test("r29 A: routing and lexicon", () => {
  for (const q of ["I plan to rebalance next week, thoughts?", "Diamond hands or bail on TSLA?", "Hold or fold NVDA?", "Is AI a bubble for my book?", "Should I buy puts to hedge?", "Time to back up the truck on NVDA?", "Is MSFT a no-brainer here?", "NVDA 지금 buy 해도 돼?"]) assert(isDecisionFrame(q), q);
  for (const s of ["A clean beat rerates the whole portfolio.", "This is a retracement, not reversal.", "It's small enough to ride out a drawdown.", "The chart says otherwise.", "Shift some cash toward AAPL and MSFT.", "Cash is a light reserve.", "NVDA is not the engine.", "Concentration is your edge."]) assertEquals(softVerdicts(s).length, 1, s);
});

Deno.test("r29 E: '-heavy' keeps its article and capital; leveraged semis are tech", async () => {
  const { fixThemeHeavy, themeOf, TECH_THEMES } = await import("./intel.ts");
  assert(TECH_THEMES.has(themeOf("SOXL", "etf")));
  const themes = [{ name: "broad US index", pct: 30 }, { name: "leveraged semiconductors", pct: 20 }, { name: "AI semiconductors", pct: 20 }, { name: "mega-cap platforms", pct: 15 }];
  assertEquals(fixThemeHeavy("A tech-heavy book with one index core.", themes), "A tech-heavy book with one index core.");
  const t2 = [{ name: "financials", pct: 28.5 }, { name: "healthcare", pct: 19.4 }];
  assertEquals(fixThemeHeavy("A healthcare-heavy dividend book.", t2), "A financials-heavy dividend book.");
});

Deno.test("r29 C: member lists, targets, non-session dates, smallest sleeve", async () => {
  const { fixGroupShares, targetMismatchClaims, nonSessionDatedMoves, metricSuperlativeClaims } = await import("./intel.ts");
  const members = [{ names: ["NVDA"] }, { names: ["AMD"] }, { names: ["SOXL"] }];
  assertEquals(fixGroupShares("Tech names NVDA, AMD and SOXL make up 48% together.", [{ label: /\btech(?: names)?/i, value: 13.2 }], 5, members), "Tech names NVDA, AMD and SOXL make up 48% together.");
  assertEquals(targetMismatchClaims("Up 9% over 3 months, inside your 12-20% target.").length, 1);
  assertEquals(targetMismatchClaims("Cash at 3% sits below your 12-20% target.").length, 1);
  assertEquals(targetMismatchClaims("Up 14% over 1 year, inside your 12-20% target."), []);
  const sat = (ymd: string) => !["2026-09-26", "2026-09-27"].includes(ymd);
  assertEquals(nonSessionDatedMoves("MSFT 9/26 +4%.", sat, 2026).length, 1);
  assertEquals(nonSessionDatedMoves("MSFT 9/25 +3.7%.", sat, 2026), []);
  assertEquals(metricSuperlativeClaims("Smallest sleeve: cash.", [{ names: ["cash"], weight: 3.4 }, { names: ["AVGO"], weight: 1.2 }, { names: ["NVDA"], weight: 19 }]).length, 1);
});

Deno.test("r29 D: house-voice forecast and low-yield income claims in a brief", async () => {
  const { holdingIncomeClaims, lowYieldIncomeClaims } = await import("./intel.ts");
  assertEquals(softVerdicts("Microsoft reports Oct 28. A clean beat rerates the whole portfolio.").length, 1);
  const facts = [{ names: ["MSFT", "Microsoft"], yieldPct: 0.7 }, { names: ["KO", "Coca-Cola"], yieldPct: 2.9 }, { names: ["AAPL"], yieldPct: null }];
  assertEquals(holdingIncomeClaims("MSFT's yield adds meaningful income. The book rose 0.3%.", facts), ["MSFT's yield adds meaningful income."]);
  assertEquals(holdingIncomeClaims("Coca-Cola adds steady income.", facts), []);
  assertEquals(holdingIncomeClaims("AAPL adds some income.", facts), []);   // yield did not load: unknown, not low
  assertEquals(lowYieldIncomeClaims("Its yield adds meaningful income.", 0.7).length, 1);
});

Deno.test("r29 B: asked counts and the code summary", () => {
  assertEquals(askedCount("Summarize my portfolio in 3 bullet points"), 3);
  assertEquals(askedCount("How is NVDA doing?"), null);
  const t = portfolioSummaryLead({ total: 3519234, dayUsd: 9447, dayPct: 0.27, dayLabel: "in Friday's session", top: [{ label: "NVDA", weight: 19.2 }, { label: "AAPL", weight: 13.6 }, { label: "MSFT", weight: 13.2 }], ytd: "+$410,000 (+13.2%)" }, false);
  assertEquals(t.split("\n").length, 3);
  assert(t.includes("in Friday's session +$9,447 (+0.27%)") && t.includes("NVDA 19.2%") && t.includes("This year"), t);
});
