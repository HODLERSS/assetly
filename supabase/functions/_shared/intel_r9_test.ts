// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 6 newcomer (growth book NVDA/VOO/QQQ/PLTR/SOFI/ETH/cash), 2026-09-25. Every case below was traced to the
// transform (or model pass) that produced it with the BRIEF_TRACE harness; see impl2-server.md, Round 6c.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  brokenSentences, buildHusk, capNoteKeepRisk, capSentenceStarts, circularCauses, dayMoveMismatches, digitsForWritten, diversifiedClaims,
  dividendContradictions, dropInstructionEcho, fixWeights, mergeChecked, noteDividendClaims, noviceGloss, parseDividends, promoClaims,
  spelledNumbers, verblessList, withNoCallLine,
} from "./intel.ts";
import { dividendLine } from "./history.ts";

Deno.test("r9 digits: written copy keeps figures as digits (the fact-checker spelled them out)", () => {
  assertEquals(digitsForWritten("Growth could slow if revenue drops below forty percent year over year."), "Growth could slow if revenue drops below 40% year over year.");
  assertEquals(digitsForWritten("It rose one point five percent."), "It rose 1.5%.");
  assertEquals(digitsForWritten("It is twenty-five percent of assets."), "It is 25% of assets.");
  assertEquals(digitsForWritten("It rose 1.5% today."), "It rose 1.5% today.");
  assert(spelledNumbers("It holds the five hundred US companies.").length === 1);
  assert(spelledNumbers("expense over zero point three percent").length >= 1);
  assertEquals(spelledNumbers("It holds 500 companies, a third of them tech."), []);
});

Deno.test("r9 fact-checker merge: spelled figures, new figures, invented dividend claims and unmeasurable watches are refused", () => {
  const draft = {
    lede: "A growth bet with 21.1% in software.", overnight: "Total $53,827.", desk_view: "21.1% sits in one theme.", horizon: "Next year: x. Next decade: y.", ideas: ["No international exposure: ex-US index funds"],
    positions: [
      { name: "NVDA", note: "Nvidia makes AI chips. The risk: data-center growth below 30%.", watch: "data-center growth <30% next quarter" },
      { name: "QQQ", note: "QQQ holds the Nasdaq-100. The risk: a 20% drop from the high.", watch: "Nasdaq-100 drawdown >20%" },
    ],
  };
  const checked = {
    ...draft,
    lede: "A growth bet with 21.1% in software, tightened.",
    positions: [
      { name: "NVDA", note: "Nvidia makes AI chips. It does not pay a dividend. Growth risk appears below thirty percent.", watch: "data center growth below thirty percent" },
      { name: "QQQ", note: "QQQ holds the Nasdaq-100 at 99.9% tech.", watch: "Top-heavy in mega-cap tech and AI leaders" },
    ],
  };
  const out = mergeChecked(draft, checked, "NVDA: $9003 (16.7% of assets)");
  assertEquals(out.lede, "A growth bet with 21.1% in software, tightened.");   // a clean correction is kept
  assertEquals(out.positions[0].note, draft.positions[0].note);                 // spelled figure + dividend claim: refused
  assertEquals(out.positions[0].watch, draft.positions[0].watch);
  assertEquals(out.positions[1].note, draft.positions[1].note);                 // 99.9% is in neither draft nor data
  assertEquals(out.positions[1].watch, draft.positions[1].watch);               // a measurable watch stays measurable
});

Deno.test("r9 note caps shed the middle sentence, never the risk", () => {
  const note = "This holding, at 21.1% of assets, adds concentrated AI software exposure. Palantir sells data platforms to government and big firms with a real edge. The risk: commercial growth below 40% a year.";
  const out = capNoteKeepRisk(note, 26);
  assertStringIncludes(out, "The risk: commercial growth below 40% a year.");
  assertFalse(out.includes("Palantir sells"));
  assertEquals(capNoteKeepRisk("Short. The risk: x.", 40), "Short. The risk: x.");
});

Deno.test("r9 dividends: a note's dividend sentence must match the holding's record", () => {
  assertEquals(noteDividendClaims("Nvidia makes AI chips. It does not pay a dividend.", true), ["It does not pay a dividend."]);
  assertEquals(noteDividendClaims("Palantir sells software. It pays no dividend.", false), []);
  assertEquals(noteDividendClaims("PLTR sells software. It pays a modest dividend.", false), ["It pays a modest dividend."]);
  assertEquals(noteDividendClaims("VOO provides a modest dividend.", true), []);
  assertEquals(dividendContradictions("NVDA and QQQ pay no dividend.", [{ names: ["NVDA", "Nvidia"] }]).length, 1);
  assertEquals(dividendContradictions("QQQ does not pay a dividend.", [{ names: ["QQQ"] }]).length, 1);
});

Deno.test("r9 dividend income at the current rate after a raise; ex-dates strictly after today", () => {
  const nv = dividendLine("NVDA", { symbol: "NVDA", div_as_of: "2026-09-25T00:00:00Z", div_last: 0.25, div_last_ex: "2026-09-10", div_ttm: 0.52, div_freq_days: 97, div_next_ex: "2026-12-16", div_yield: 0.02 }, 40);
  assert(Math.abs(nv.annual - 40) < 0.01, String(nv.annual));
  assertStringIncludes(nv.line, "at the current rate");
  assertStringIncludes(nv.line, "the last 12 months paid $20.80");
  // an estimate for today (or earlier) is not "next"
  const vo = dividendLine("VOO", { symbol: "VOO", div_as_of: "2026-09-25T00:00:00Z", div_last: 1.962, div_last_ex: "2026-06-26", div_ttm: 7.345, div_freq_days: 91, div_next_ex: "2000-01-01", div_yield: 1.03 }, 15);
  assertFalse(vo.line.includes("next ex-date"));
  // parseDividends: last 06-26 + 91 days lands on today (09-25): the estimate moves past today
  const ts = (ymd: string) => Date.parse(ymd + "T13:30:00Z") / 1000;
  const body = { chart: { result: [{ events: { dividends: Object.fromEntries(["2025-12-22", "2026-03-27", "2026-06-26"].map((d, i) => [String(i), { amount: 1.9, date: ts(d) }])) } }] } };
  const info = parseDividends(body, 700, "2026-09-25")!;
  assert(info.nextEx! > "2026-09-25", info.nextEx!);
});

Deno.test("r9 fixWeights leaves a weight inside a fund alone", () => {
  const hs = [{ names: ["VOO"], weight: 21.1 }, { names: ["NVDA"], weight: 16.7 }];
  assertEquals(fixWeights("VOO's tech weight at 38% creates a hidden sector concentration.", hs), "VOO's tech weight at 38% creates a hidden sector concentration.");
  assertEquals(fixWeights("VOO's technology weighting at 38% is high.", hs), "VOO's technology weighting at 38% is high.");
  assertEquals(fixWeights("VOO has exposure to tech at 38% weight.", hs), "VOO has exposure to tech at 38% weight.");
  // a bare holding weight is still corrected
  assertEquals(fixWeights("VOO is a 30% weight in your portfolio.", hs), "VOO is a 21.1% weight in your portfolio.");
});

Deno.test("r9 diversification claims only for funds; circular causes; instruction echoes", () => {
  const hs = [{ names: ["QQQ"], fund: true }, { names: ["VOO"], fund: true }, { names: ["NVDA", "엔비디아"], fund: false }];
  assertEquals(diversifiedClaims("QQQ·VOO·NVDA는 여러 종목을 담고 있어 상대적으로 안정적입니다.", hs).length, 1);
  assertEquals(diversifiedClaims("QQQ and VOO hold many stocks, so they swing less.", hs), []);
  assertEquals(diversifiedClaims("NVDA is diversified across gaming and data centers.", hs).length, 1);
  assertEquals(circularCauses("SoFi fell 1.3% after a MarketBeat article noted its drop.").length, 1);
  assertEquals(circularCauses("SoFi fell 1.3% after it cut its loan growth forecast.").length, 0);
  assertEquals(dropInstructionEcho("The Goldman Sachs talk from Sep 10 is two weeks old, so it is context, not news. Nvidia rose 1%."), "The Goldman Sachs talk from Sep 10 is two weeks old. Nvidia rose 1%.");
  assertEquals(dropInstructionEcho("Per the data block, VOO pays $110 a year. VOO is 21.1% of the portfolio."), "VOO is 21.1% of the portfolio.");
});

Deno.test("r9 approximations are held to the figure; 'each' covers every holding named", () => {
  const facts = [{ names: ["QQQ"], pct: 0.46 }, { names: ["Nvidia", "NVDA"], pct: 0.22 }, { names: ["VOO"], pct: 0.54 }];
  assertEquals(dayMoveMismatches("QQQ, Nvidia and VOO each rose about half a percent today.", facts, 0.15).length, 1);
  assertEquals(dayMoveMismatches("QQQ and VOO each rose about half a percent today.", facts, 0.15), []);
  assertEquals(dayMoveMismatches("Nvidia rose 0.2% today.", facts, 0.15), []);
});

Deno.test("r9 transforms that garbled: gloss modifiers, capitals after abbreviations, broken shapes, promo, thousands", () => {
  // noviceGloss treated a verb after "drawdown" as the noun it modified
  assertFalse(noviceGloss("The risk: Nasdaq-100 drawdown exceeds 20%.").includes("of the drop"));
  assertEquals(noviceGloss("The risk: Nasdaq-100 drawdown exceeding 20%."), "The risk: Nasdaq-100 drop from the top exceeding 20%.");
  assertEquals(noviceGloss("Drawdown risk is real."), "Risk of the drop from the top is real.");
  // "print" after a figure is a price, not a report
  assertStringIncludes(noviceGloss("Wolfe's $250 ADR target frames upside versus the ₩1,862,000 print."), "₩1,862,000 price");
  assertStringIncludes(noviceGloss("The next print is in November."), "next report");
  // capitalisation never fires after an abbreviation
  assertEquals(capSentenceStarts("The price tag is extreme vs. peers. it holds."), "The price tag is extreme vs. peers. It holds.");
  assertEquals(capSentenceStarts("It holds U.S. stocks."), "It holds U.S. stocks.");
  for (const s of ["QQQ lags S&P 500 by than ten percent over six months.", "Concentration at 16.7% is the main portfolio.", "Vanguard S&P 500 fund holds the 500 US companies, weighted.", "It must sustain growth to meet goals and keep health.", "Palantir sells software, has sheet, but is pricey."]) {
    assertEquals(brokenSentences(s).length, 1, s);
  }
  assertEquals(promoClaims("It gives the portfolio exposure to AI data growth while keeping costs low.").length, 1);
  assertEquals(verblessList("Watch the ₩1,862,000 price closely."), []);
});

Deno.test("r9 husk opener fits the question; 'your' time horizon; today is not upcoming", () => {
  assert(withNoCallLine("• x", "What should I buy with my cash?").startsWith("I can't tell you what to buy"));
  assert(withNoCallLine("• x", "What's your top pick in my portfolio?").startsWith("I can't pick a holding for you"));
  assert(withNoCallLine("• x", "should I sell NVDA?").startsWith("I can't tell you whether to trade it"));
  assert(withNoCallLine("• 현금 비중은 15%입니다.", "현금으로 뭘 사야 할까?").startsWith("무엇을 살지는"));
  const h = buildHusk({ holdings: [{ name: "VOO", symbol: "VOO", kind: "etf", usd: 10000 }], cashUsd: 1000, assetsUsd: 11000, today: "2026-09-25", reports: [], dividends: [{ name: "VOO", annualUsd: 110, nextEx: "2026-09-25" }] }, false);
  assertStringIncludes(h, "none has an ex-date expected in the next 45 days");
  assertStringIncludes(h, "and your time horizon and taxes");
});
