// r10 intelligence: forecasts, soft verdicts, only/#N/lagging claims, sign-filtered lists, opinion framings.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { computedDataLead, isDecisionFrame, isForecastQuestion, type PerfRow, rankPositionClaims, softVerdicts, YTD } from "./intel.ts";

const rows: PerfRow[] = [
  { symbol: "TSLA", label: "TSLA", names: ["TSLA", "Tesla"], usd: 262000, pct: { 7: -1.5, 30: 6.2, 90: -0.8, 365: -12.1, [YTD]: -17.3 } },
  { symbol: "AVGO", label: "AVGO", names: ["AVGO", "Broadcom"], usd: 200000, pct: { 7: -2.0, 30: -4.4, 90: -6.9, 365: 30.0, [YTD]: 1.9 } },
  { symbol: "MSFT", label: "MSFT", names: ["MSFT", "Microsoft"], usd: 464600, pct: { 7: 4.1, 30: 12.0, 90: 46.3, 365: 5.0, [YTD]: 6.7 } },
  { symbol: "AAPL", label: "AAPL", names: ["AAPL", "Apple"], usd: 477500, pct: { 7: 2, 30: 10, 90: 20, 365: 25, [YTD]: 25.5 } },
  { symbol: "META", label: "META", names: ["META", "Meta"], usd: 450000, pct: { 7: 12.9, 30: 31, 90: 30, 365: 2, [YTD]: 13.9 } },
];

Deno.test("r27: forecast questions", () => {
  for (const q of ["How much will my portfolio be worth in 5 years?", "Where will NVDA be next year?", "Will AAPL hit $400?", "What's TSLA's price target?", "10년 후에 내 포트폴리오는 얼마가 될까?"]) assert(isForecastQuestion(q), q);
  for (const q of ["How much is my portfolio worth?", "What's my 1-year return?", "When does NVDA report?"]) assertFalse(isForecastQuestion(q), q);
});

Deno.test("r27: soft verdicts and opinion framings", () => {
  for (const s of ["The setup has real weight.", "Structural drivers for a multi-year hold.", "YTD is still far below the target.", "$350 is the line to watch.", "Setup is mixed: momentum strong."]) assertEquals(softVerdicts(s).length, 1, s);
  assert(isDecisionFrame("just your opinion, AAPL 사 말아?"));
  assert(isDecisionFrame("In your opinion should I sell TSLA?"));
});

Deno.test("r27: only / #N / lagging claims against computed data", () => {
  const f = rows.map((r) => ({ names: r.names, pct: r.pct, weight: r.usd / 2e6 * 100 }));
  assertEquals(rankPositionClaims("TSLA was the only drag over 3 months.", f).length, 1);
  assertEquals(rankPositionClaims("META is #2 by weight.", f).length, 1);
  assertEquals(rankPositionClaims("MSFT is #2 by weight.", f), []);
  assertEquals(rankPositionClaims("AAPL is #1 by weight.", f), []);
  assertEquals(rankPositionClaims("MSFT is lagging the rest over the past year.", f).length, 1);
  assertEquals(rankPositionClaims("TSLA is lagging the rest over the past year.", f), []);
});

Deno.test("r27: a sign-filtered list is built in code", () => {
  assertEquals(computedDataLead("Which holdings have a negative 3-month return?", rows, [], false), "• 2 of your holdings are negative over 3 months: AVGO −6.9%, TSLA −0.8%.");
});

Deno.test("r27 native: fragments, seams, futures after the close", async () => {
  const { fixFragments, dropFuturesAfterClose } = await import("./intel.ts");
  assertEquals(fixFragments("Bitcoin is 15.3% of assets. Your crypto holding adds."), "Bitcoin is 15.3% of assets.");
  assertEquals(fixFragments("ETF exposure is minimal The risk: a drawdown."), "ETF exposure is minimal. The risk: a drawdown.");
  assertEquals(fixFragments("TSLA costs 0.2% of assets."), "TSLA is 0.2% of assets.");
  assertEquals(fixFragments("The S&P500 closed higher."), "The S&P 500 closed higher.");
  assertEquals(dropFuturesAfterClose("The S&P 500 closed at 7,743.41 (+0.5%), Nasdaq futures at 30,921.75."), "The S&P 500 closed at 7,743.41 (+0.5%).");
  assertEquals(dropFuturesAfterClose("Nasdaq futures rose."), "");
});

Deno.test("r27 r11: two parentheticals in a row read as one", async () => {
  const { mergeParens } = await import("./intel.ts");
  assertEquals(mergeParens("A $9,447 (as of the 4:00 PM ET close) (+0.3%) gain."), "A $9,447 (+0.3%, as of the 4:00 PM ET close) gain.");
  assertEquals(mergeParens("A $9,447 (+0.3%) (as of 4:05 PM ET) gain."), "A $9,447 (+0.3%, as of 4:05 PM ET) gain.");
});
