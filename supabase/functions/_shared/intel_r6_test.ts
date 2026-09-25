// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round-5 newcomer (a balanced investor: AAPL, JNJ, KO, VOO, BND, Samsung, BTC, cash), 2026-09-25.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  brokenSentences, buildPortfolioParagraph, dividendContradictions, fixAgreement, fixExposure, offRiskIdea, parseDividends, plainDataWords, promoClaims,
  returnForecasts, splitSentences, unattributedDollars, verblessList, fixWeights, periodReturnMismatches, windowTargetYmd, YTD,
} from "./intel.ts";
import { staleRows } from "./history.ts";

// the book, at the weights assessment 1 was written against
const TOTAL = 292000;
const BOOK = [["VOO", 43.8], ["AAPL", 14.0], ["BND", 9.7], ["KO", 7.5], ["BTC", 7.2], ["JNJ", 5.6], ["Samsung Electronics", 3.6]].map(([name, w]) => ({ name: String(name), usd: TOTAL * Number(w) / 100 }));
const EXP = { usEquity: 70.9, krEquity: 3.6, crypto: 7.2, bonds: 9.7, cash: 8.6 };
Deno.test("YOUR PORTFOLIO names every holding of 2% or more, in code, and survives every later check", () => {
  const model = "VOO 43.8% and AAPL 14.0% are the two biggest holdings. Geography is 80.6% United States, 7.2% crypto, and one smaller position. The mix leans on steady payers.";
  const p = buildPortfolioParagraph(BOOK, TOTAL * 0.086, TOTAL, EXP, model);
  for (const h of BOOK) assertStringIncludes(p, h.name);
  assertStringIncludes(p, "cash $25,112 (8.6%)");
  assertStringIncludes(p, "9.7% bonds");
  assertFalse(/one smaller position|Geography|two biggest/.test(p), p);
  assertStringIncludes(p, "The mix leans on steady payers.");
  // the shares shown add up to the whole
  const shares = [...p.split("By type")[0].matchAll(/\((\d+(?:\.\d+)?)%\)/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert(Math.abs(shares - 100) <= 1, String(shares));
  assertEquals(brokenSentences(p), []);
  assertEquals(verblessList(p), []);
});

Deno.test("sentences: abbreviations do not end them; a pronoun-and-verb fragment is broken; singular tickers agree", () => {
  assertEquals(splitSentences("BND is a bond fund holding U.S. Treasury and corporate bonds. The risk: rates rise."),
    ["BND is a bond fund holding U.S. Treasury and corporate bonds.", "The risk: rates rise."]);
  assertEquals(splitSentences("Apple Inc. makes phones. It sells services."), ["Apple Inc. makes phones.", "It sells services."]);
  assertEquals(splitSentences("VOO charges 0.03%. It adds.").length, 2);
  assertEquals(brokenSentences("VOO charges a 0.03% expense ratio. It adds."), ["It adds."]);
  assertEquals(fixAgreement("This means VOO rise and fall on the same driver."), "This means VOO rises and falls on the same driver.");
  assertEquals(fixAgreement("VOO and AAPL rise and fall together."), "VOO and AAPL rise and fall together.");
});

Deno.test("exposure: a stated share of US stocks, bonds or crypto is the computed one", () => {
  assertEquals(fixExposure("The portfolio hinges on the 46.4% US equity exposure.", EXP), "The portfolio hinges on the 70.9% US equity exposure.");
  assertEquals(fixExposure("Bonds are 9.7% of assets and crypto 7.2%.", EXP), "Bonds are 9.7% of assets and crypto 7.2%.");
  assertEquals(fixExposure("US stocks at 60% dominate.", EXP), "US stocks at 70.9% dominate.");
});

Deno.test("claims: promotional lines, return forecasts, crypto adds for a stability reader", () => {
  assertEquals(promoClaims("The portfolio captures the full S&P 500 upside while avoiding individual stock fees.").length, 1);
  assertEquals(returnForecasts("Bond yields near 4% should sustain income and support a 4-8% annual return.").length, 1);
  assertEquals(returnForecasts("Your target is a 4-8% annual return."), []);
  assertEquals(returnForecasts("VOO returned 17% over the past year."), []);
  assert(offRiskIdea("Improve the modest Bitcoin position", ["income", "index"]));
  assertFalse(offRiskIdea("Crypto is 7.2% of assets: one volatile sleeve", ["income"]));
  assertFalse(offRiskIdea("Add Ethereum next to Bitcoin", ["crypto"]));
});

Deno.test("intelligence: an article's figure is not the reader's; a payer never 'pays no cash'", () => {
  const own = [TOTAL, 128000, 40880];
  assertEquals(unattributedDollars("VOO: $10,450 tax on reinvested dividends, no cash paid out.", own).length, 1);
  assertEquals(unattributedDollars("An article estimates $10,450 in tax on a $1M VOO stake.", own), []);
  assertEquals(unattributedDollars("VOO is $128,000 of your portfolio.", own), []);
  assertEquals(dividendContradictions("VOO: tax on reinvested dividends, no cash paid out.", [{ names: ["VOO"] }]).length, 1);
  assertEquals(dividendContradictions("BTC pays no dividend.", [{ names: ["VOO"] }]), []);
});

Deno.test("words: 'on file' is pipeline language", () => {
  assertEquals(plainDataWords("BTC: no dividend data on file."), "BTC: no dividend data available.");
  assertEquals(plainDataWords("Converted at the rate on file, not a live quote."), "Converted at the latest stored rate, not a live quote.");
});

Deno.test("dividends: the same quarter a year earlier dates the next ex-date (KO ~Dec 1, not Dec 18)", () => {
  const ev = (rows: [string, number][]) => ({ chart: { result: [{ events: { dividends: Object.fromEntries(rows.map(([d, a]) => [d, { amount: a, date: Date.parse(d + "T13:30:00Z") / 1000 }])) } }] } });
  const KO = ev([["2024-11-29", 0.485], ["2025-03-14", 0.51], ["2025-06-13", 0.51], ["2025-09-15", 0.51], ["2025-12-01", 0.51], ["2026-03-13", 0.53], ["2026-06-12", 0.53], ["2026-09-15", 0.53]]);
  const k = parseDividends(KO, 70.6, "2026-09-25")!;
  assertEquals(k.nextEx, "2026-11-30");
});

Deno.test("history: a daily backfill retires the Monday-stamped weekly rows and open-stamped dailies in its span", () => {
  const now = Date.parse("2026-09-25T20:00:00Z");
  const daily = [
    { ts: "2024-09-26T06:30:00.000Z", price: 170000 }, { ts: "2024-09-27T06:30:00.000Z", price: 172000 },
    { ts: "2026-09-10T06:30:00.000Z", price: 330000 }, { ts: "2026-09-24T06:30:00.000Z", price: 340000 },
  ];
  const existing = [
    "2024-09-26T06:30:00+00:00",          // the same close: kept
    "2024-09-29T15:00:00+00:00",          // a weekly bar stamped Monday 00:00 KST: retired
    "2025-06-02T00:00:00+00:00",          // a daily bar stamped at the 09:00 KST open: retired
    "2026-09-10T06:30:00+00:00",          // kept
    "2026-09-22T02:15:00+00:00",          // a minute tick in the last 8 days: left to the tick pruning
    "2024-01-08T15:00:00+00:00",          // before the backfill's span: untouched
  ];
  assertEquals(staleRows(existing, daily, now), ["2024-09-29T15:00:00+00:00", "2025-06-02T00:00:00+00:00"]);
  assertEquals(staleRows(existing, [], now), []);
});

Deno.test("windows: year to date starts at the prior year's last close; a 1Y figure called YTD fails", () => {
  assertEquals(windowTargetYmd(YTD, Date.parse("2026-09-25T20:00:00Z"), "KR"), "2025-12-31");
  const facts: { names: string[]; windows: Record<number, number | null> }[] = [{ names: ["Samsung", "005930.KS"], windows: { [YTD]: 138.1, 365: 231.6 } }];
  assertEquals(periodReturnMismatches("Samsung's 231.6% year to date run leads the book.", facts).length, 1);
  assertEquals(periodReturnMismatches("Samsung is up 138% this year.", facts), []);
  assertEquals(periodReturnMismatches("Samsung is up 231.6% over the past year.", facts), []);
});

Deno.test("weights: a holding's weight is its own; a group share is labelled as the group", () => {
  const holdings = [{ names: ["Bitcoin", "BTC"], weight: 25.2 }, { names: ["Ether", "ETH"], weight: 4.9 }, { names: ["NVDA", "Nvidia"], weight: 19.1 }];
  const groups = [{ label: /\bcrypto\b/i, value: 30.1 }];
  assertEquals(fixWeights("The 30.1% Bitcoin weight dominates the risk.", holdings, groups), "The 25.2% Bitcoin weight dominates the risk.");
  assertEquals(fixWeights("Crypto is 30.1% of assets, led by Bitcoin.", holdings, groups), "Crypto is 30.1% of assets, led by Bitcoin.");
  assertEquals(fixWeights("Nvidia rose 3.2% today.", holdings, groups), "Nvidia rose 3.2% today.");
  assertEquals(fixWeights("Nvidia is 19.1% of assets.", holdings, groups), "Nvidia is 19.1% of assets.");
});
