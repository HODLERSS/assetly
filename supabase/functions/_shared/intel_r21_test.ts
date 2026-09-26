// Round 9 intelligence C/D (+ newcomer 6): data answers from computed data; no-news claims against the headlines.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { computedDataLead, misattributedCauses, type PerfRow, questionWindows, statesLead, windowDollarMismatches, YTD } from "./intel.ts";

const rows: PerfRow[] = [
  { symbol: "MSFT", label: "MSFT", names: ["MSFT", "Microsoft"], usd: 464600, pct: { 7: 4.1, 30: 12.0, 90: 46.3, 365: 20.0, [YTD]: 6.7 } },
  { symbol: "NVDA", label: "NVDA", names: ["NVDA", "Nvidia"], usd: 675200, pct: { 7: 1.0, 30: 5.6, 90: 10.0, 365: 40.0, [YTD]: 20.7 } },
  { symbol: "AVGO", label: "AVGO", names: ["AVGO", "Broadcom"], usd: 200000, pct: { 7: -2.0, 30: -4.4, 90: -6.9, 365: 30.0, [YTD]: 1.9 } },
  { symbol: "TSLA", label: "TSLA", names: ["TSLA", "Tesla"], usd: 262000, pct: { 7: -1.5, 30: 6.2, 90: -0.8, 365: -12.1, [YTD]: -17.3 } },
  { symbol: "GOOGL", label: "GOOGL", names: ["GOOGL", "Alphabet"], usd: 368000, pct: { 7: 0.4, 30: -0.9, 90: 8.0, 365: 25.0, [YTD]: 9.9 } },
  { symbol: "KO", label: "KO", names: ["KO", "Coca-Cola"], usd: 50000, pct: { 7: 1, 30: 2, 90: 5, 365: 20, [YTD]: 25.6 } },
];

Deno.test("r21: windows in the question", () => {
  assertEquals(questionWindows("Compare NVDA and AVGO over 1 month and 1 year"), [30, 365]);
  assertEquals(questionWindows("Which of my holdings has the best 3-month return?"), [90]);
  assertEquals(questionWindows("Is Coca-Cola up this year?"), [YTD]);
  assertEquals(questionWindows("내 포트폴리오 올해 수익률은?"), [YTD]);
});

Deno.test("r21: computed leads", () => {
  assertEquals(computedDataLead("Which of my holdings has the best 3-month return?", rows, [], false),
    "• 3 months returns, best to worst: MSFT +46.3%, NVDA +10.0%, GOOGL +8.0%, KO +5.0%, TSLA −0.8%, AVGO −6.9%.");
  assertEquals(computedDataLead("Compare NVDA and AVGO over 1 month and 1 year", rows, ["NVDA", "AVGO"], false),
    "• NVDA: 1 month +5.6%, 1 year +40.0%.\n• AVGO: 1 month −4.4%, 1 year +30.0%.");
  assertEquals(computedDataLead("Is Coca-Cola up this year?", rows, ["KO"], false), "• KO is up 25.6% this year.");
  const pl = computedDataLead("How much did I make this month in dollars?", rows, [], false)!;
  assert(pl.includes("Biggest gain: MSFT") && pl.includes("biggest loss: AVGO"), pl);
  assert(pl.includes("TSLA") === false);
  assertEquals(computedDataLead("What's the best stock in the S&P 500 this year?", rows, [], false), null);
  assertEquals(computedDataLead("Why did META drop today?", rows, [], false), null);
});

Deno.test("r21: stated leads and wrong window dollars", () => {
  assert(statesLead("NVDA is up 5.6% over a month and 40.0% over a year.", "• NVDA: 1 month +5.6%, 1 year +40.0%."));
  assertFalse(statesLead("Demand is still extreme.", "• NVDA: 1 month +5.6%."));
  // TSLA's 1M is about +$15.3K; −$35,896 is not it. GOOGL's 1M is about −$3,344, not +$3,344.
  assertEquals(windowDollarMismatches("Biggest 1M losers: TSLA −$35,896.", rows).length, 1);
  assertEquals(windowDollarMismatches("Over 1 month GOOGL +$3,344.", rows).length, 1);
  assertEquals(windowDollarMismatches("Over 1 month GOOGL −$3,344.", rows), []);
  assertEquals(windowDollarMismatches("TSLA added $15,300 over 1 month.", rows), []);
});

Deno.test("r21 D: a no-news claim for a holding with headlines goes", () => {
  const facts = [{ names: ["META", "Meta"], headlines: "Mark Zuckerberg Loses $9 Billion In A Day Amid AI Overspending Fears \n Meta Platforms Loses New Mexico Jury Trial" }, { names: ["NVDA"], headlines: "" }];
  assertEquals(misattributedCauses("No META headline explains today's 3.3% drop.", facts).length, 1);
  assertEquals(misattributedCauses("META: none in file.", facts).length, 1);
  assertEquals(misattributedCauses("No fresh headlines available for NVDA.", facts), []);
});
