// r10 poweruser/designer minors: headline gaps, feed labels, wrong-holding prefixes, outlet names, day-vs-target,
// scope labels, judge parsing.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { anchorNewsItem, cleanHeadline, dayTargetClaims, fixScopeLabels, headlineOk, sourceName } from "./intel.ts";
import { parseJudge } from "./judge.ts";

Deno.test("r25: headline gaps", () => {
  for (const t of ["Why now might be a good time to invest in Alphabet", "Meta Price Targets Raised as Muse AI Gains Momentum", "Tesla (and 3 Other Stocks to Watch)"]) assertFalse(headlineOk(t), t);
  assertEquals(cleanHeadline("Market Chatter: Meta Platforms Loses New Mexico Jury Trial"), "Meta Platforms Loses New Mexico Jury Trial");
  assertEquals(cleanHeadline("The 8:30: Stocks edge higher on jobs data"), "Stocks edge higher on jobs data");
  assertEquals(cleanHeadline("Apple ships the M5 Mac Studio | Closing Bell"), "Apple ships the M5 Mac Studio");
});

Deno.test("r25: a '<name>:' prefix whose rest is about another company is not that holding's headline", () => {
  const heads = [{ symbol: "AMZN", names: ["AMZN", "Amazon"], title: "Amazon: Meta's Muse Just Handed Investors A $65 Billion Gift", source: "Seeking Alpha" }];
  assertEquals(anchorNewsItem("Amazon: Meta's Muse handed investors a $65 billion gift", heads), null);
});

Deno.test("r25: outlet names", () => {
  assertEquals(sourceName("foxbusiness.com"), "Fox Business");
  assertEquals(sourceName("qz.com"), "Quartz");
  assertEquals(sourceName("shattered.io"), "Shattered");
  assertEquals(sourceName("Yahoo Finance"), "Yahoo Finance");
});

Deno.test("r25: a day move is not a step toward the yearly target; scope labels follow composition", () => {
  assertEquals(dayTargetClaims("A +0.27% day nudges the portfolio toward its 12-20% target.").length, 1);
  assertEquals(dayTargetClaims("The portfolio rose 0.3% today."), []);
  assertEquals(fixScopeLabels("Today added $621 across US and Korean stocks.", true), "Today added $621 across the portfolio.");
  assertEquals(fixScopeLabels("Today added $621 across US and Korean stocks.", false), "Today added $621 across US and Korean stocks.");
});

Deno.test("r25: judge output parsing (content or reasoning, last object wins)", () => {
  assertEquals(parseJudge('thinking... {"flag": [9]} final: {"flag": [1, 3]}', 3), new Set([0, 2]));
  assertEquals(parseJudge('{"flag": []}', 3), new Set());
  assertEquals(parseJudge("no json here", 3), null);
  assert(parseJudge('{"flag":[2]}', 2)!.has(1));
});
