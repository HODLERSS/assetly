// r12 A/B/C/E/F.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { askedCount, isDecisionFrame, portfolioSummaryLead, softVerdicts } from "./intel.ts";

Deno.test("r29 A: routing and lexicon", () => {
  for (const q of ["I plan to rebalance next week, thoughts?", "Diamond hands or bail on TSLA?", "Hold or fold NVDA?", "Is AI a bubble for my book?", "Should I buy puts to hedge?", "Time to back up the truck on NVDA?", "Is MSFT a no-brainer here?", "NVDA 지금 buy 해도 돼?"]) assert(isDecisionFrame(q), q);
  for (const s of ["A clean beat rerates the whole portfolio.", "This is a retracement, not reversal.", "It's small enough to ride out a drawdown.", "The chart says otherwise.", "Shift some cash toward AAPL and MSFT.", "Cash is a light reserve.", "NVDA is not the engine.", "Concentration is your edge."]) assertEquals(softVerdicts(s).length, 1, s);
});

Deno.test("r29 B: asked counts and the code summary", () => {
  assertEquals(askedCount("Summarize my portfolio in 3 bullet points"), 3);
  assertEquals(askedCount("How is NVDA doing?"), null);
  const t = portfolioSummaryLead({ total: 3519234, dayUsd: 9447, dayPct: 0.27, dayLabel: "in Friday's session", top: [{ label: "NVDA", weight: 19.2 }, { label: "AAPL", weight: 13.6 }, { label: "MSFT", weight: 13.2 }], ytd: "+$410,000 (+13.2%)" }, false);
  assertEquals(t.split("\n").length, 3);
  assert(t.includes("in Friday's session +$9,447 (+0.27%)") && t.includes("NVDA 19.2%") && t.includes("This year"), t);
});
