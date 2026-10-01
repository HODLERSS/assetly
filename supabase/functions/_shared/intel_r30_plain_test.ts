// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 30 plain words (2026-09-30; intel_r30_test.ts is the r13 newcomer file): desk words on the Home cards. The close brief said "...which means the AI buildout thesis
// held up despite a mixed tape." "tape", "thesis", the noun "print" and "catalyst" all go to plain words.
import { assertEquals } from "jsr:@std/assert@1";
import { CARD_PLAIN, plainScrub, PORTFOLIO_PLAIN, valuationHits } from "./intel.ts";

const scrub = (t: string) => plainScrub(t, PORTFOLIO_PLAIN);

Deno.test("r30: the owner's close-brief sentence", () => {
  assertEquals(scrub("Your portfolio rose 0.8%, which means the AI buildout thesis held up despite a mixed tape."),
    "Your portfolio rose 0.8%, which means the AI buildout case held up despite a mixed market.");
});

Deno.test("r30: tape -> market, adjective kept", () => {
  const cases: [string, string][] = [
    ["Stocks drifted in a mixed tape.", "Stocks drifted in a mixed market."],
    ["A calm tape let Microsoft climb.", "A calm market let Microsoft climb."],
    ["Nvidia led the live tape.", "Nvidia led the live market."],
    ["Utilities held up in a defensive tape.", "Utilities held up in a defensive market."],
    ["It was a risk-on tape all afternoon.", "It was an upbeat market all afternoon."],   // 10/1: risk-on is desk slang too
    ["Miners lagged a flat BTC tape.", "Miners lagged a flat BTC market."],
    ["A firm tape lifted chips.", "A firm market lifted chips."],
    ["Tape was quiet into the close.", "Market was quiet into the close."],
    ["Both tapes closed higher.", "Both markets closed higher."],
    ["A quiet tape left your tech names flat.", "A quiet market left your tech stocks flat."],
  ];
  for (const [a, b] of cases) assertEquals(scrub(a), b);
});

Deno.test("r30: thesis -> case", () => {
  const cases: [string, string][] = [
    ["The slide thesis failed.", "The slide case failed."],
    ["The HBM thesis is intact.", "The HBM case is intact."],
    ["There is no thesis damage yet.", "There is no case damage yet."],
    ["Thesis lives on MI355 ramp.", "Case lives on MI355 ramp."],
    ["Your investment thesis rests on Azure.", "Your investment case rests on Azure."],
    ["Both theses rest on AI spending.", "Both cases rest on AI spending."],
  ];
  for (const [a, b] of cases) assertEquals(scrub(a), b);
});

Deno.test("r30: the noun print -> report; the verb stays", () => {
  const cases: [string, string][] = [
    ["Watch Azure's next print.", "Watch Azure's next report."],
    ["Microsoft is flat ahead of the print.", "Microsoft is flat ahead of the report."],
    ["The Q3 print is due Oct 28.", "The Q3 report is due Oct 28."],
    ["Thursday's print sets the tone.", "Thursday's report sets the tone."],
    ["A hot CPI print would hurt growth stocks.", "A hot CPI report would hurt growth stocks."],
    ["The earnings print beat estimates.", "The earnings report beat estimates."],
    ["The last two prints beat estimates.", "The last two reports beat estimates."],
    ["Nvidia's prints keep beating.", "Nvidia's reports keep beating."],
  ];
  for (const [a, b] of cases) assertEquals(scrub(a), b);
  for (const v of ["NVDA printed a record quarter.", "Nvidia is expected to print a beat.", "CPI prints hot again.", "Read the fine print first.",
    "Samsung may print a record profit.", "The stock touched the ₩1,862,000 print."]) assertEquals(scrub(v), v);
});

Deno.test("r30: catalyst -> trigger", () => {
  assertEquals(scrub("The dip is not a catalyst."), "The dip is not a trigger.");
  assertEquals(scrub("Near-term catalysts are thin."), "Near-term triggers are thin.");
  assertEquals(scrub("Catalyst: the Oct 28 report."), "Trigger: the Oct 28 report.");
  // the shared card's own wording for a two-sided event survives PORTFOLIO_PLAIN running first
  assertEquals(plainScrub("The ruling is one double-edged catalyst.", [...PORTFOLIO_PLAIN, ...CARD_PLAIN]), "The ruling is one event that could cut either way.");
});

Deno.test("r30: look-alikes stay", () => {
  for (const v of ["Red tape slowed the permit.", "Cutting red tape helps banks.", "Bank book value rose 4%.", "The company's name changed in May.",
    "In that case the stock fell.", "A ticker tape parade."]) assertEquals(scrub(v), v);
});

Deno.test("r30: the card's 'tape bid' still reads as trading", () => {
  assertEquals(plainScrub("Tape bid 0.5% higher into the close.", [...PORTFOLIO_PLAIN, ...CARD_PLAIN]), "the stock is trading 0.5% higher into the close.");
});

Deno.test("r30: idempotent (twice = once)", () => {
  for (const s of ["Your portfolio rose 0.8%, which means the AI buildout thesis held up despite a mixed tape.",
    "Watch Azure's next print; the HBM thesis is intact and catalysts are thin in a calm tape.", "Both theses and both tapes and the last two prints.",
    "Bank book value rose 4% despite red tape."]) {
    const once = scrub(s);
    assertEquals(scrub(once), once);
  }
});

Deno.test("r30: verdict detectors still catch the scrubbed wording", () => {
  assertEquals(valuationHits(scrub("The HBM thesis is intact.")).length, 1);
  assertEquals(valuationHits(scrub("A cooldown after a 31.9% surge, not a thesis break.")).length, 1);
  assertEquals(valuationHits(scrub("The dividend hike gives KO a clear near-term catalyst.")).length, 1);
  assertEquals(valuationHits(scrub("Whether the thesis holds depends on the next delivery report.")), []);
});

Deno.test("r30b: an amount before 'book', capex and tripwire read plainly", () => {
  assertEquals(plainScrub("Wednesday's session added $529 to a $208,400 (as of the 4:00 PM ET close) book.", PORTFOLIO_PLAIN),
    "Wednesday's session added $529 to a $208,400 (as of the 4:00 PM ET close) portfolio.");
  assertEquals(plainScrub("Heavier capex guidance weighed. AI capex keeps rising.", PORTFOLIO_PLAIN), "Heavier spending guidance weighed. AI spending keeps rising.");
  assertEquals(plainScrub("The tripwire is a miss on data-center growth.", PORTFOLIO_PLAIN), "The warning sign is a miss on data-center growth.");
  assertEquals(plainScrub("Its book value rose to $40 book value.", PORTFOLIO_PLAIN), "Its book value rose to $40 book value.");
});
