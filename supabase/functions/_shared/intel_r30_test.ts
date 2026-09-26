// r13 newcomer: mislabelled figures (M1 period labels, M2 day tags / flat / mood causes).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fixDayTags, flatClaims, relabelPeriodClaims, stripUngroundedMoodCauses, YTD } from "./intel.ts";

const SOXL = { names: ["SOXL", "Direxion Daily Semiconductor Bull 3X Shares"], windows: { 7: 22.5, 30: 30.9, 90: -40.2, 365: 347.4, [YTD]: 260.3 } as Record<number, number | null> };
const VOO = { names: ["VOO", "Vanguard S&P 500 ETF"], windows: { 7: 1.28, 30: 3.1, 90: 7.9, 365: 16.2, [YTD]: 13.9 } as Record<number, number | null> };

Deno.test("r30 M1: SOXL's 1-year return labelled 'this year' is relabelled, through the pronoun", () => {
  const dv = "23.4% of assets sit in SOXL, a leveraged semiconductor fund that tracks a three-times index. It gained 30.9% in the last month and 347.4% this year, but daily reset can erode value if top chip makers miss revenue.";
  const out = relabelPeriodClaims(dv, [SOXL, VOO]);
  assert(out.includes("30.9% in the last month and 347.4% over the past year"), out);
  assertEquals(relabelPeriodClaims("SOXL is up 260.3% this year.", [SOXL]), "SOXL is up 260.3% this year.");
  assertEquals(relabelPeriodClaims("This year SOXL is up 347.4%.", [SOXL]), "Over the past year SOXL is up 347.4%.");
  assertEquals(relabelPeriodClaims("SOXL is up 500% this year. VOO is steady.", [SOXL, VOO]), "VOO is steady.");   // no window's figure: dropped
  const unknown = { names: ["SOXL"], windows: { 365: 347.4, [YTD]: null } as Record<number, number | null> };
  assertEquals(relabelPeriodClaims("SOXL is up 347.4% this year.", [unknown]), "SOXL is up 347.4% this year.");   // unknown YTD: untouched
});

Deno.test("r30 M2: a (Fri) tag stays only on the holding's own day change", () => {
  const f = [{ names: ["SOXL"], dayPct: 3.5 }, { names: ["TSLA", "Tesla"], dayPct: -1.54 }, { names: ["KO"], dayPct: -0.33 }];
  assertEquals(fixDayTags("SOXL was up 22.5% (Fri) and TSLA added 2.2% (Fri) gain.", f), "SOXL was up 22.5% and TSLA added 2.2% gain.");
  assertEquals(fixDayTags("KO slipped 0.5% (Fri).", f), "KO slipped 0.5%.");
  assertEquals(fixDayTags("SOXL already fell 40% (Fri) over three months.", f), "SOXL already fell 40% over three months.");
  assertEquals(fixDayTags("TSLA fell 1.5% (Fri close).", f), "TSLA fell 1.5% (Fri close).");
  assertEquals(fixDayTags("SOXL rose 3.5% (Friday).", f), "SOXL rose 3.5% (Friday).");
});

Deno.test("r30 M2: flat against the week, and the invented mood cause", () => {
  const f = [{ names: ["VOO"], day: 0.1, week: 1.28 }, { names: ["KO"], day: -0.33, week: -0.5 }];
  assertEquals(flatClaims("VOO stayed flat.", f, true).length, 1);
  assertEquals(flatClaims("VOO stayed flat.", f, false), []);
  assertEquals(flatClaims("KO was roughly flat this week.", f), []);
  const src = "Tesla deliveries beat estimates\nNvidia unveils new chip";
  assertEquals(stripUngroundedMoodCauses("SOXL jumped 22.5% after bullish semiconductor comeback story.", src, ["SOXL"]), "SOXL jumped 22.5%.");
  assertEquals(stripUngroundedMoodCauses("TSLA rose after deliveries beat estimates story.", src, ["TSLA"]), "TSLA rose after deliveries beat estimates story.");
});
