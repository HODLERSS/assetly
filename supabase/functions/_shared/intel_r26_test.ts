// r10 newcomer M1/M2 and intelligence urgent 2: theme shares, notes, watches, ideas, week superlatives.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { cleanIdea, cleanNote, codeRisk, dropYieldPurpose, fixNoteOpener, fixThemeShares, illogicalConcentration, plainCompanyName, returnForecasts, smallMoveCauses, superlativeClaims, wordWatch, YTD } from "./intel.ts";

const themes = [{ name: "AI semiconductors", pct: 33.2 }, { name: "broad US index", pct: 18.5 }, { name: "international index", pct: 15.8 }, { name: "crypto", pct: 15.3 }];

Deno.test("r26 M1: a theme figure is the theme's share, whatever the verb", () => {
  assertEquals(fixThemeShares("A focused AI-semiconductor theme consumes 58.2% of assets, anchoring the portfolio.", themes), "A focused AI-semiconductor theme consumes 33.2% of assets, anchoring the portfolio.");
  assertEquals(fixThemeShares("AI-semiconductor exposure consumes 33.2% of assets.", themes), "AI-semiconductor exposure consumes 33.2% of assets.");
  assertEquals(fixThemeShares("Chip stocks rose 3.1% on the week.", themes), "Chip stocks rose 3.1% on the week.");
  assertEquals(dropYieldPurpose("The remainder diversifies into US equity, global funds and crypto for modest yield.", 0.8), "The remainder diversifies into US equity, global funds and crypto.");
  assertEquals(dropYieldPurpose("Held for income.", 3.4), "Held for income.");
});

Deno.test("r26 M2: notes, risks, watches", () => {
  assertFalse(cleanNote("VXUS is broad. The risk: highly diversified with no concentration risk.").note.includes("The risk"));
  assertFalse(cleanNote("VTI is broad. The risk: expense ratio could exceed 0.05%.").note.includes("The risk"));
  assert(cleanNote("SK hynix leads HBM. The risk: market share could fall below 45%.").note.includes("The risk"));
  assertEquals(fixNoteOpener("Your bet holds SK hynix, a DRAM and NAND leader."), "SK hynix is a DRAM and NAND leader.");
  assertEquals(fixNoteOpener("Your core is TSMC, the world's largest contract chipmaker."), "TSMC is the world's largest contract chipmaker.");
  assertEquals(wordWatch("HBM share <45% alert signal"), "HBM share falls below 45%");
  assertEquals(wordWatch("Price < $70,000 weekly alert"), "Price falls below $70,000");
  assertEquals(wordWatch("expense ratio >0.05% trigger"), "expense ratio rises above 0.05%");
  assert(codeRisk("crypto", "crypto").includes("50%"));
  assert(codeRisk("etf", "international index").includes("currency"));
  assertEquals(plainCompanyName("SK hynix Inc."), "SK hynix");
});

Deno.test("r26 minors: ideas, soft forecasts, illogical concentration, small-move causes", () => {
  assertEquals(cleanIdea("High-yield US dividend gap: look at a large-cap dividend aristocrat ETF."), null);
  assertEquals(cleanIdea("Commodity hedge gap: broad commodities ETF to add inflation protection."), "Commodity hedge gap: broad commodities ETF.");
  assertEquals(cleanIdea("Bond gap: consider short-duration Treasury funds."), "Bond gap: short-duration Treasury funds.");
  assertEquals(returnForecasts("Durable demand must persist for the portfolio to achieve its long-run significant return potential.").length, 1);
  assertEquals(illogicalConcentration("If HBM market share drops below 45%, the concentration risk rises sharply.").length, 1);
  const f = [{ names: ["BRKB", "Berkshire"], pct: 0.1, fund: false }, { names: ["VTI"], pct: 0.4, fund: true }, { names: ["TSM"], pct: 2.1, fund: false }];
  assertEquals(smallMoveCauses("BRKB gained 0.1% as Berkshire's increased Lennar stake was reported.", f).length, 1);
  assertEquals(smallMoveCauses("VTI rose 0.4% after its quarterly distribution announcement.", f).length, 1);
  assertEquals(smallMoveCauses("TSM rose 2.1% after a record September sales report.", f), []);
});

Deno.test("r26 urgent: 'the week's biggest loser' against the week's returns", () => {
  const w: { names: string[]; windows: Record<number, number | null> }[] = [{ names: ["META"], windows: { 7: 12.9, 30: 20, [YTD]: 14 } }, { names: ["AVGO"], windows: { 7: -3.1 } }, { names: ["MSFT"], windows: { 7: 4 } }];
  assertEquals(superlativeClaims("META was the week's biggest loser.", w).length, 1);
  assertEquals(superlativeClaims("AVGO was the week's biggest loser.", w), []);
});
