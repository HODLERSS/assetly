// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 8 intelligence audit (showcase book: NVDA 19.2%, AAPL 13.6%, MSFT 13.2%, META 12.8%, … , cash 3.4%).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildHusk, circularCauses, costBasisClaims, dayMoveMismatches, diversifiedClaims, fixGroupShares, holdingRankClaims, isPickQuestion, labelEstimatedDates,
  misattributedCauses, misplacedScriptFigures, paymentLagClaims, periodReturnMismatches, promoCharacterisations, readerLevel, scriptProblems, spanOfMonthKo,
  stripVerdictTails, suggestionHits, superlativeClaims, targetBandClaims, targetPaceClaims, unicodeMinus, valuationHits, withNoCallLine, YTD,
} from "./intel.ts";

const N = (a: string[]) => a;
const book = [
  { sym: "NVDA", names: N(["NVDA", "Nvidia"]), weight: 19.2, pct: 0.22, ytd: 20.7, y1: 26.7, gain: 50.2 },
  { sym: "AAPL", names: N(["AAPL", "Apple"]), weight: 13.6, pct: 1.53, ytd: 25.5, y1: 32.8, gain: 40.0 },
  { sym: "MSFT", names: N(["MSFT", "Microsoft"]), weight: 13.2, pct: 3.66, ytd: 18.0, y1: 1.8, gain: 25.0 },
  { sym: "QQQM", names: N(["QQQM", "Nasdaq-100"]), weight: 7.8, pct: 0.46, ytd: 21.2, y1: 20.0, gain: 30.0 },
  { sym: "TSLA", names: N(["TSLA", "Tesla"]), weight: 7.4, pct: -1.5, ytd: -8.0, y1: -12.1, gain: 49.6 },
];
const rank = book.map((b) => ({ names: b.names, weight: b.weight }));
const move = book.map((b) => ({ names: b.names, pct: b.pct }));
const per = book.map((b) => ({ names: b.names, windows: { [YTD]: b.ytd, 365: b.y1 } as Record<number, number | null> }));
const cost = book.map((b) => ({ names: b.names, gainPct: b.gain }));
const heads = [{ names: ["META", "Meta"], headlines: "Meta shares fall as investors weigh AI capex; New Mexico jury verdict" }, { names: ["AVGO", "Broadcom"], headlines: "Broadcom director sale filing: Form 4 shows director sold shares" },
  { names: ["MSFT", "Microsoft"], headlines: "Microsoft relaunches Copilot with new AI agents" }];

Deno.test("r15 MAJOR 1 invariant: a TRUE lead sentence survives every drop guard", () => {
  const leads = [
    "NVDA makes up 19.2% of your portfolio, your biggest holding.",
    "NVDA is 19.2% of your portfolio, worth $675,210.",
    "Nvidia is your biggest holding, at 19.2% of assets.",
    "Apple is your best performer this year, up 25.5% year to date.",
    "Microsoft rose 3.7% today after relaunching Copilot.",
    "Your portfolio is up 11.5% this year, below your 12-20% target.",
  ];
  for (const s of leads) {
    const hits = [...dayMoveMismatches(s, move, 0.15), ...periodReturnMismatches(s, per), ...holdingRankClaims(s, rank), ...superlativeClaims(s, per), ...costBasisClaims(s, cost),
      ...targetBandClaims(s), ...misattributedCauses(s, heads), ...suggestionHits(s, book), ...promoCharacterisations(s), ...targetPaceClaims(s), ...paymentLagClaims(s),
      ...diversifiedClaims(s, book.map((b) => ({ names: b.names, fund: b.sym === "QQQM" }))), ...circularCauses(s)];
    assertEquals(hits, [], s);
  }
});

Deno.test("r15 MAJOR 2: superlatives, cost basis, target band, tech share, misattributed causes", () => {
  assertEquals(superlativeClaims("NVDA is up 20.7% year to date, the strongest gain in your portfolio.", per).length, 1);
  assertEquals(superlativeClaims("Tesla is your weakest holding over the past year at -12.1%.", per), []);
  assertEquals(costBasisClaims("Furthest below your buy price over 1 year: TSLA -12.1%.", cost).length, 1);
  assertEquals(targetBandClaims("You are up 11.5% YTD and 15.0% over a year. Both sit inside your 12-20% yearly target.").length, 1);
  assertEquals(targetBandClaims("Your 1-year return of 15.0% sits inside your 12-20% yearly target."), []);
  assertEquals(fixGroupShares("Tech makes up about 57% of assets; more cash there raises concentration.", [{ label: /\b(?:tech|technology)/i, value: 96.6 }]), "Tech makes up about 96.6% of assets; more cash there raises concentration.");
  assertEquals(fixGroupShares("Tech is 95% of the portfolio.", [{ label: /\btech/i, value: 96.6 }]), "Tech is 95% of the portfolio.");
  assertEquals(misattributedCauses("META fell 3.3% after a director sale filing.", heads).length, 1);
  assertEquals(misattributedCauses("MSFT jumped 3.7% today on no clear news.", heads).length, 1);
  assertEquals(misattributedCauses("Meta fell 3.3% as investors weigh its AI capex.", heads), []);
});

Deno.test("r15 MAJOR 3/4: pick questions never focus; rank lists every holding", () => {
  assert(isPickQuestion("Give me the 3 best stocks to buy right now"));
  assert(isPickQuestion("What are the best stocks to buy?"));
  const hs = ["NVDA", "AAPL", "MSFT", "META", "GOOGL", "AVGO", "QQQM", "TSLA", "AMZN"].map((s, i) => ({ name: s, symbol: s, kind: "stock", usd: 1000 - i * 50 }));
  const r = buildHusk({ holdings: hs, cashUsd: 100, assetsUsd: 8300, today: "2026-09-25", reports: [], dividends: [], mode: "rank", returns1m: Object.fromEntries(hs.map((h, i) => [h.symbol, h.symbol === "AMZN" ? -4.4 : 5 - i])) }, false);
  assertStringIncludes(r, "AMZN −4.4%".replace("−", "-"));
  assertEquals((r.match(/By weight: [^\n]*/)![0].match(/,/g) ?? []).length, 8);
  assert(withNoCallLine(r, "Rank my holdings from strongest to weakest").startsWith("I can't tell you which to keep, but here's how your holdings rank"));
});

Deno.test("r15 MAJOR 5: verdict synonyms and reader levels", () => {
  for (const s of ["It makes Google Cloud a credible second growth engine.", "Waymo is a real optionality story.", "Alphabet consolidates atop a powerful longer-term uptrend.", "Staying weighted to these leaders remains significantly beneficial for growth."]) {
    assertEquals(valuationHits(s).length, 1, s);
  }
  assertEquals(readerLevel(["confident"]), "intermediate");
  assertEquals(readerLevel([]), "novice");
  assertEquals(readerLevel(["novice", "pro"]), "pro");
  assertEquals(readerLevel(["intermediate", "confident"]), "intermediate");
});

Deno.test("r15 MAJOR 6: the Listen script is held to the advice guard and to each figure's subject", () => {
  const sections = JSON.stringify({ lede: "The S&P 500 rose 0.5% as the VIX fell 5.1%.", overnight: "Oracle said it will keep investing in data centers.", positions: [{ name: "MSFT", note: "Microsoft rose 3.7% on Copilot.", watch: "x" }] });
  const script = "Microsoft jumped three point seven percent on Copilot. Oracle may cut data center spending by more than five point one percent. Staying weighted to these leaders remains significantly beneficial for growth. The VIX fell five percent.";
  const bad = scriptProblems(script, sections, "2026-09-25");
  assert(bad.some((b) => b.startsWith("Oracle")));
  assert(bad.some((b) => b.startsWith("Staying weighted")));
  assertFalse(bad.some((b) => b.startsWith("Microsoft")));
  assertFalse(bad.some((b) => b.startsWith("The VIX")));
  assertEquals(misplacedScriptFigures("Oracle may cut spending by five point one percent.", sections).length, 1);
});

Deno.test("r15 minors: verdict tails, minus signs, Korean spans and estimate labels", () => {
  assertEquals(stripVerdictTails("A $211 gain lifts today's book to $116,500, keeping the portfolio on track."), "A $211 gain lifts today's book to $116,500.");
  assertEquals(unicodeMinus("META -3.3% and -$1,200 today; a 12-20% target"), "META −3.3% and −$1,200 today; a 12-20% target");
  assertEquals(spanOfMonthKo(["2026-10-21", "2026-10-28"]), "10월 하순");
  assertEquals(spanOfMonthKo(["2026-11-18", "2026-11-25"]), "11월 중순~하순");
  assertEquals(labelEstimatedDates("META 10월 28일경, AAPL 10월 29일", ["2026-10-28", "2026-10-29"], true), "META 10월 28일경, AAPL 10월 29일 (추정)");
});
