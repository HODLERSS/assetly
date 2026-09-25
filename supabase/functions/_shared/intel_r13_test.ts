// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 7 newcomer (balanced Korean-American book: Samsung, SK hynix, AAPL, MSFT, SCHD, BTC, cash; Intermediate).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  brokenSentences, dividendShareClaims, fixProperCase, fixWeights, krxExDate, labelEstimatedDates, noviceGloss, parseDividends, paymentLagClaims,
  PORTFOLIO_PLAIN, periodReturnMismatches, plainScrub, promoCharacterisations, stripStrayEst, targetPaceClaims, YTD,
} from "./intel.ts";
import { dividendLine } from "./history.ts";

const hs = [{ names: ["AAPL", "Apple"], weight: 17.2 }, { names: ["MSFT", "Microsoft"], weight: 10.4 }, { names: ["SCHD"], weight: 11.8 }];
const themes = [{ label: /\bmega-cap platforms\b/i, value: 27.7 }];

Deno.test("r13 N1: a figure beside two holdings or a theme is their sum, never one member's weight", () => {
  assertEquals(fixWeights("A concentrated mega-cap platform bet, with 27.7% of assets in AAPL and MSFT.", hs, themes), "A concentrated mega-cap platform bet, with 27.7% of assets in AAPL and MSFT.");
  assertEquals(fixWeights("Mega-cap platforms (AAPL, MSFT) occupy 27.7% of assets, the single biggest theme.", hs, themes), "Mega-cap platforms (AAPL, MSFT) occupy 27.7% of assets, the single biggest theme.");
  // a wrong pair figure becomes the pair's sum, not one member's
  assertEquals(fixWeights("You hold 17.2% of assets in AAPL and MSFT.", hs), "You hold 27.6% of assets in AAPL and MSFT.");
  // one holding named: still its own weight
  assertEquals(fixWeights("AAPL is 20.0% of assets.", hs), "AAPL is 17.2% of assets.");
});

Deno.test("r13 N2: glosses keep grammar; (est) only beside a date; proper nouns and months capitalised; pronoun + figure is broken", () => {
  assertEquals(noviceGloss("ETF inflows turn negative for two months."), "ETF purchases turn negative for two months.");
  assertEquals(noviceGloss("Its ecosystem moat and services drive growth."), "Its ecosystem edge and services drive growth.");
  assertEquals(noviceGloss("It has a wide moat from lock-in."), "It has a wide edge from lock-in.");
  assertEquals(noviceGloss("It has a moat."), "It has a lasting edge over competitors.");
  assertEquals(noviceGloss("Earnings will set momentum and guide valuation."), "Earnings will set momentum and guide the price tag.");
  assertEquals(stripStrayEst("ETF inflows turn negative two months (est)"), "ETF inflows turn negative two months");
  assertEquals(stripStrayEst("CXMT DRAM shipments to hyperscaler (est)"), "CXMT DRAM shipments to hyperscaler");
  assertEquals(stripStrayEst("AAPL earnings expected ~Oct 29 (est)"), "AAPL earnings expected ~Oct 29 (est)");
  assertEquals(stripStrayEst("NVDA earnings expected mid to late November (est)"), "NVDA earnings expected mid to late November (est)");
  assertEquals(fixProperCase("The risk: december quarter gross margin below consensus after the siri settlement."), "The risk: December quarter gross margin below consensus after the Siri settlement.");
  assertEquals(fixProperCase("It may rise in may."), "It may rise in may.");
  assertEquals(brokenSentences("It 13.9% of assets and gives a 0.16% dividend $11 yearly.").length, 1);
  assertEquals(plainScrub("artificial-intelligence chips", PORTFOLIO_PLAIN), "AI chips");
});

Deno.test("r13 N3: promo characterisations and dividend-share claims", () => {
  for (const s of ["High-quality dividend tech drives most of its upside while cushioning volatility.", "BTC adds a crypto hedge.", "It is a speculative macro hedge.", "Bitcoin acts as a hedge against inflation."]) {
    assertEquals(promoCharacterisations(s).length, 1, s);
  }
  assertEquals(promoCharacterisations("Bitcoin is 25.5% of assets and swings more than the stocks."), []);
  const payers = [{ names: ["AAPL", "Apple"], share: 11.1 }, { names: ["MSFT", "Microsoft"], share: 15.3 }, { names: ["SCHD"], share: 53.2 }];
  assertEquals(dividendShareClaims("Mega-cap platforms (AAPL, MSFT) anchor the book, delivering most of its dividend yield.", payers).length, 1);
  assertEquals(dividendShareClaims("SCHD delivers most of the portfolio's dividend income.", payers), []);
});

Deno.test("r13 N4/N5: period claims are held to the holding's own window, in English and Korean", () => {
  const facts = [{ names: ["Samsung", "005930.KS", "삼성전자"], windows: { [YTD]: 138.1, 365: 231.6, 7: 9.4, 30: 11.1 } as Record<number, number | null> },
    { names: ["SCHD"], windows: { 7: -1.4, 30: -2.0, [YTD]: 4.0 } as Record<number, number | null> }];
  assertEquals(periodReturnMismatches("Samsung stock has run 339% this year, per analysis.", facts).length, 1);
  assertEquals(periodReturnMismatches("삼성전자는 올해 339% 올랐어요.", facts).length, 1);
  assertEquals(periodReturnMismatches("SCHD up 0.3% this week, dividend focus remains.", facts).length, 1);
  assertEquals(periodReturnMismatches("Samsung is up 138.1% this year.", facts), []);
  assertEquals(periodReturnMismatches("Simply Wall St says Samsung still has value after a 339% run.", facts), []);
});

Deno.test("r13 minors: no month-vs-annual-target pace; no payment lag; estimated dates keep their label; KRX ex-date", () => {
  assertEquals(targetPaceClaims("Your portfolio rose 7.2% this month, on pace with your 8-12% annual target.").length, 1);
  assertEquals(targetPaceClaims("Your portfolio rose 7.2% over the past month.").length, 0);
  assertEquals(paymentLagClaims("실제 입금은 보통 2–4주 뒤에 들어와요.").length, 1);
  assertEquals(paymentLagClaims("The cash is usually paid 2-4 weeks after the ex-date.").length, 1);
  assertEquals(labelEstimatedDates("• 삼성전자: 2026-09-29 (4일 뒤)", ["2026-09-29"], true), "• 삼성전자: 2026-09-29 (추정) (4일 뒤)");
  assertEquals(labelEstimatedDates("• AAPL ex-date expected around Nov 9.", ["2026-11-09"]), "• AAPL ex-date expected around Nov 9.");
  assertEquals(labelEstimatedDates("• AAPL's next ex-date is Nov 9.", ["2026-11-09"]), "• AAPL's next ex-date is Nov 9 (est).");
  // Samsung Q3 2026: record Wed Sep 30, ex-date Tue Sep 29 (not the year-ago + 364 = Sep 28)
  assertEquals(krxExDate("2026-09-28", "2026-09-25"), "2026-09-29");
  assertEquals(krxExDate("2026-12-27", "2026-10-05"), "2026-12-29");
  const ts = (ymd: string) => Date.parse(ymd + "T00:00:00Z") / 1000;
  const body = { chart: { result: [{ events: { dividends: Object.fromEntries(["2025-09-29", "2025-12-29", "2026-03-30", "2026-06-29"].map((d, i) => [String(i), { amount: 370, date: ts(d) }])) } }] } };
  assertEquals(parseDividends(body, 285500, "2026-09-25", "005930.KS")!.nextEx, "2026-09-29");
  const line = dividendLine("Samsung", { symbol: "005930.KS", div_as_of: "2026-09-25T00:00:00Z", div_last: 370, div_last_ex: "2026-06-29", div_ttm: 1682, div_freq_days: 91, div_next_ex: "2026-09-28", div_yield: 0.59 }, 30, "KRW", 1355);
  assertStringIncludes(line.line, "2026-09-29");
  assertFalse(line.line.includes("2026-09-28"));
});

Deno.test("r13: nothing here touches a fair sentence", () => {
  assert(!brokenSentences("It holds 13.9% of assets.").length);
  assertEquals(fixWeights("AAPL and MSFT rose 1.5% and 3.7% today.", hs, themes), "AAPL and MSFT rose 1.5% and 3.7% today.");
});
