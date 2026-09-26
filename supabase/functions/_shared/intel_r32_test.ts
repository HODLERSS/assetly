// e2e p07 / p04 batch: the drivers lead, KRX dollar targets, the forecast lexicon, account-aware tax remarks, bond-fund
// wording, cut and duplicate headlines.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bondValueClaims, driversLead, headlineOk, isDriversQuestion, isPerformanceQuestion, isTaxAdvantaged, krxDollarTargets, looseTitleKey, midWordCut, softVerdicts, taxRemarkClaims, YTD } from "./intel.ts";

Deno.test("r32 P07-5: 'What drove my week?' has a code lead with the top contributors and headlines", () => {
  const rows = [
    { label: "NVDA", usd: 675210, pct: { 7: 3.1, 30: 5.6, [YTD]: 38.1 } as Record<number, number | null>, dayUsd: 1200, dayPct: 0.2 },
    { label: "META", usd: 450996, pct: { 7: -4.0, 30: 31.9, [YTD]: 12.0 } as Record<number, number | null>, dayUsd: -15390, dayPct: -3.3 },
    { label: "AAPL", usd: 478000, pct: { 7: 1.2, 30: 10.1, [YTD]: 22.0 } as Record<number, number | null>, dayUsd: 500, dayPct: 0.1 },
    { label: "BND", usd: 60000, pct: { 7: null, 30: 0.4, [YTD]: 1.1 } as Record<number, number | null>, dayUsd: 10, dayPct: 0.0 },
  ];
  const heads = new Map([["NVDA", [{ title: "Nvidia unveils Rubin", source: "Reuters" }]], ["META", [{ title: "Meta loses jury verdict", source: "Reuters" }, { title: "Meta AI spend rises", source: "WSJ" }]]]);
  assert(isDriversQuestion("What drove my week?") && isDriversQuestion("Biggest contributors this month?") && !isDriversQuestion("How did I do this week?"));
  assert(isPerformanceQuestion("What drove my week?"));
  const wk = driversLead("What drove my week?", rows, heads, "in Friday's session")!;
  // value × window return on today's size: NVDA 675,210 − 675,210 / 1.031 = 20,302; the three sum to 7,179
  assert(wk.startsWith("• Your holdings moved +$7,179 over 1 week. Biggest contributors: NVDA +$20,302 (+3.1%), META −$18,792 (−4.0%), AAPL +$5,668 (+1.2%)."), wk);
  assert(wk.includes('On NVDA: "Nvidia unveils Rubin" (Reuters).'), wk);
  const day = driversLead("What moved my portfolio today?", rows, heads, "in Friday's session")!;
  assert(day.includes("in Friday's session") && day.includes("META −$15,390 (−3.3%)") && day.includes("Meta loses jury verdict"), day);
  assertEquals(driversLead("What is an ETF?", rows, heads, "today"), null);
});

Deno.test("r32 P07-6/7: KRX dollar targets go; the forecast lexicon", () => {
  const kr = [["SK hynix", "000660", "hynix"], ["Samsung Electronics", "005930", "Samsung"]];
  assertEquals(krxDollarTargets("Analysts put a $250 target on SK hynix.", kr).length, 1);
  assertEquals(krxDollarTargets("SK hynix's US-listed ADR carries a $250 target.", kr), []);
  assertEquals(krxDollarTargets("NVDA has a $250 target.", kr), []);
  for (const s of ["It adds growth upside as capacity expands.", "That adds short-term downside risk.", "A $600k cycle top, suggesting price pressure.", "Short-term momentum favours the chip names."]) assertEquals(softVerdicts(s).length, 1, s);
  assertEquals(softVerdicts("Its dividend yield is 3.9%."), []);
});

Deno.test("r32 P04-5: tax remarks in a retirement account; bond-fund wording", () => {
  assert(isTaxAdvantaged("IRA") && isTaxAdvantaged("Roth 401k") && isTaxAdvantaged("retirement") && !isTaxAdvantaged("brokerage"));
  assertEquals(taxRemarkClaims("The risk: state-tax drag reduces the yield. Duration is about six years."), ["The risk: state-tax drag reduces the yield."]);
  assertEquals(bondValueClaims("Value: trades at a low price compared with its income. Duration is about six years."), ["Value: trades at a low price compared with its income."]);
});

Deno.test("r32 P04-11: titles cut mid-word and one story under two spellings", () => {
  assert(midWordCut("Rob Gehring: Dividend Stocks To Buy For Income Across North America Pr"));
  assert(midWordCut("Why SCHD Beats Most Other Dividend Fun"));
  assert(!midWordCut("Tesla Cuts Prices in China"));
  assert(!midWordCut("Fed Holds Rates Steady in Sep"));
  assert(!headlineOk("Rob Gehring: Dividend Stocks To Buy For Income Across North America Pr"));
  assert(headlineOk("Scotiabank downgrades Realty Income to sector perform"));
  assertEquals(looseTitleKey("Scotiabank Downgrades Realty Income To Sector Perform - Seeking Alpha"), looseTitleKey("Scotiabank downgrades Realty Income to Sector Perform: here's why"));
});

Deno.test("r32 p01 F1: a just-starting reader's assessment in everyday words; the body total rounded like the header", async () => {
  const { plainForBeginner, roundBookTotal, aboutUsd } = await import("./intel.ts");
  assertEquals(plainForBeginner("Sector concentration is high."), "How much sits in one place is high.");
  assertEquals(plainForBeginner("ETH is a layer 1 blockchain with custody complexity and regulatory uncertainty."), "ETH is a base blockchain network with the difficulty of holding the coins safely and unclear rules from regulators.");
  assertEquals(plainForBeginner("Watch quarterly net staked ETH growth."), "Watch quarterly growth in ETH locked up to earn rewards.");
  assertEquals(plainForBeginner("Gross margin rose 3 points YoY. EBITDA margins expanded too."), "Profit on each sale rose 3 points from a year earlier.");
  assertEquals(plainForBeginner("VOO is 40% of assets."), "VOO is 40% of assets.");
  assertEquals(aboutUsd(13807), "about $13,800");
  assertEquals(aboutUsd(3519234), "about $3.52M");
  assertEquals(roundBookTotal("Total assets $13,807, cash $1,200.", 13807), "Total assets about $13,800, cash $1,200.");
  assertEquals(roundBookTotal("Total assets about $13,807.", 13807), "Total assets about $13,800.");
});
