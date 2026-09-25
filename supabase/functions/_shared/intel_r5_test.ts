// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round-4 newcomer (income investor) and poweruser follow-ups (2026-09-25).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  brokenSentences, marketToday, NOVICE_PLAIN, noviceGloss, parseDividends, pctOver, windowTargetYmd, periodReturnMismatches, strengthAsRisk, tidyNumbers, valuationHits, weekendDated,
  wrongDividendAmounts,
} from "./intel.ts";

Deno.test("glosses: every beginner-map entry reads correctly in three contexts", () => {
  for (const g of NOVICE_PLAIN) {
    const contexts = [`Watch the ${g.sample} closely.`, `AI ${g.sample} scrutiny is the emerging risk.`, `A sustained ${g.sample} would hurt.`];
    for (const c of contexts) {
      const out = noviceGloss(c);
      assertFalse(new RegExp(g.re.source, g.re.flags.replace("g", "")).test(out.replace(g.plain, "")), `jargon left: ${c} -> ${out}`);
      assertEquals(brokenSentences(out), [], `broken: ${c} -> ${out}`);
      assertFalse(/\b(?:the|a|an)\s+(?:the|a|an|its|their)\b/i.test(out), `stacked article: ${c} -> ${out}`);
      // a gloss of three words or more never sits in front of the noun it replaced a modifier of
      if (g.plain.split(" ").length >= 3) assertFalse(new RegExp(`${g.plain.replace(/^(?:a|an|the)\s+/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} scrutiny`, "i").test(out), `gloss as modifier: ${c} -> ${out}`);
    }
  }
  assertEquals(noviceGloss("AI capex scrutiny is the emerging risk."), "AI scrutiny of the spending on equipment and buildout is the emerging risk.");
  assertEquals(noviceGloss("Watch QQQ on sustained multiple compression."), "Watch QQQ on sustained shrinking price tag relative to earnings.");
});

Deno.test("numbers: '86 %' and '+ 3.2%' are tidied; a strength is never the risk", () => {
  assertEquals(tidyNumbers("VTI is 86 % of assets, up + 3.2 % today, worth $ 398,600."), "VTI is 86% of assets, up +3.2% today, worth $398,600.");
  assert(strengthAsRisk("Cloud grows fast. The risk: net cash balance sheet."));
  assertFalse(strengthAsRisk("The risk: Azure growth below 30% next print."));
});

Deno.test("advice: 'buying chance', 'leaves little margin', 'stretched' are verdicts unless a named source says so", () => {
  for (const s of ["SCHD dip viewed as buying chance.", "The rally leaves little margin for error.", "Samsung's valuation looks stretched after the run.", "This is a chance to buy the dip."]) assertEquals(valuationHits(s).length, 1, s);
  assertEquals(valuationHits("Morningstar sees a buying opportunity after the dip."), []);
});

// SCHD and VTI dividends as Yahoo's chart events return them (ex-dates, amounts)
const ev = (rows: [string, number][]) => ({ chart: { result: [{ events: { dividends: Object.fromEntries(rows.map(([d, a]) => [String(Date.parse(d + "T13:30:00Z") / 1000), { amount: a, date: Date.parse(d + "T13:30:00Z") / 1000 }])) } }] } });
const SCHD = ev([["2025-12-10", 0.2782], ["2026-03-25", 0.2530], ["2026-06-24", 0.2621], ["2026-09-23", 0.2665]]);
const VTI = ev([["2025-12-22", 0.9489], ["2026-03-26", 0.8620], ["2026-06-26", 0.9311], ["2026-09-24", 0.9555]]);
Deno.test("dividends: last payment, 12-month total, rhythm, next ex-date and yield come from the holding's own events", () => {
  const s = parseDividends(SCHD, 33.1, "2026-09-25")!;
  assertEquals([s.last, s.lastEx, s.ttm], [0.2665, "2026-09-23", 1.0598]);
  assertEquals(s.yieldPct, 3.2);
  assertEquals(s.nextEx?.slice(0, 7), "2026-12");
  assertEquals(parseDividends(ev([]), 100, "2026-09-25"), null);
  // a figure that is VTI's attached to SCHD is caught; SCHD's own figures and the owner's income pass
  const facts = [
    { names: ["SCHD"], amounts: [0.2665, 1.0598, 0.2665 * 4, 1.0598 * 800] },
    { names: ["VTI"], amounts: [0.9555, 3.6975] },
  ];
  assertEquals(wrongDividendAmounts("SCHD is 6% of the portfolio; it paid $0.96 quarterly.", facts).length, 1);
  assertEquals(wrongDividendAmounts("SCHD paid $0.2665 on Sep 23; your 800 shares bring about $848 a year.", facts), []);
  assertEquals(wrongDividendAmounts("VTI paid $0.96 last quarter.", facts), []);
});

Deno.test("cards: a 'one-year' figure must be the trailing year, not the run from the low", () => {
  const facts: { names: string[]; windows: Record<number, number | null> }[] = [{ names: ["SK hynix", "000660.KS"], windows: { 365: 422.1, 60: 31.0 } }, { names: ["Samsung", "005930.KS"], windows: { 365: 231.6 } }];
  assertEquals(periodReturnMismatches("SK hynix is up 453% in a year on HBM demand.", facts).length, 1);
  assertEquals(periodReturnMismatches("Samsung's 242.7% one-year run keeps expectations high.", facts).length, 1);
  assertEquals(periodReturnMismatches("SK hynix is up 422% over the past year.", facts), []);
  assertEquals(periodReturnMismatches("SK hynix is up 453% from its 12-month low.", facts), []);
});

Deno.test("calendar: a dated event on a weekend is not an event", () => {
  assertEquals(weekendDated(["Copilot earnings preview Sep 27", "Microsoft earnings expected ~Oct 28 (est)", "Tesla deliveries expected in early October"], "2026-09-25"), ["Copilot earnings preview Sep 27"]);
});

Deno.test("windows: 'today' is the market's day, and the previous day until that market opens (the chart's rule)", () => {
  // Samsung at 20:00 UTC Sep 25 = 05:00 KST Sep 26, before KRX opens: still Sep 25, so 1Y starts Sep 25, 2025
  const sam = Date.parse("2026-09-25T20:00:00Z");
  assertEquals(marketToday("KR", sam), "2026-09-25");
  assertEquals(windowTargetYmd(365, sam, "KR"), "2025-09-25");
  // after KRX opens (00:30 UTC = 09:30 KST) it is Sep 26
  assertEquals(windowTargetYmd(365, Date.parse("2026-09-26T00:30:00Z"), "KR"), "2025-09-26");
  // NVDA at 14:00 UTC = 10:00 ET, after the open: Sep 25 (1M from Aug 25); at 13:00 UTC = 9:00 ET, before it: Sep 24
  assertEquals(windowTargetYmd(30, Date.parse("2026-09-25T14:00:00Z"), "US"), "2026-08-25");
  assertEquals(windowTargetYmd(30, Date.parse("2026-09-25T13:00:00Z"), "US"), "2026-08-24");
  // Samsung's 1Y base at 20:00 UTC is the Sep 25, 2025 close, never the Sep 26 one
  const h = [
    { ts: "2025-09-25T06:30:00Z", price: 100 }, { ts: "2025-09-26T06:30:00Z", price: 103.3 },
    { ts: "2026-09-25T06:30:00Z", price: 331.6 },
  ];
  assertEquals(pctOver(h, 365, sam, "KR")?.toFixed(1), "231.6");
});
