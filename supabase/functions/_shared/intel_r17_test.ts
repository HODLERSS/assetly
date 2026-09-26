// Round 9 intelligence (urgent): the showcase opened on an evening compact "Morning" with wrong book figures.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { fixBookMove, fixWeights, fixWhatItMeans } from "./intel.ts";
import { strandedEdition } from "./calendar.ts";

Deno.test("r17: an edition written after its window and after the close (or after a later edition) is stranded", () => {
  const day = [{ edition: "close", generated_at: "2026-09-26T00:31:00Z" }, { edition: "morning", generated_at: "2026-09-26T00:32:28Z" }];
  assert(strandedEdition("morning", "2026-09-25", "2026-09-26T00:32:28Z", day));        // 8:32 PM ET "Morning"
  assert(strandedEdition("midday", "2026-09-25", "2026-09-25T21:31:12Z", []));           // 5:31 PM ET "Midday"
  assertFalse(strandedEdition("close", "2026-09-25", "2026-09-26T00:31:00Z", day));
  assertFalse(strandedEdition("morning", "2026-09-25", "2026-09-25T12:36:00Z", day));    // 8:36 AM: in window
  // a late opening read at 10:01 ET, before the midday was written: kept
  assertFalse(strandedEdition("morning", "2026-09-25", "2026-09-25T14:01:00Z", [{ edition: "midday", generated_at: "2026-09-25T16:01:00Z" }]));
  // ...but not when written after the midday already existed
  assert(strandedEdition("morning", "2026-09-25", "2026-09-25T17:00:00Z", [{ edition: "midday", generated_at: "2026-09-25T16:01:00Z" }]));
  assertFalse(strandedEdition("assessment", "2026-09-25", "2026-09-26T00:10:00Z", day));
  assertFalse(strandedEdition("weekend", "2026-09-26", "2026-09-26T23:00:00Z", []));
  // Korea: a kr_open written after the KRX close
  assert(strandedEdition("kr_open", "2026-09-23", "2026-09-23T07:00:00Z", []));
  assertFalse(strandedEdition("kr_open", "2026-09-23", "2026-09-23T00:20:00Z", []));
});

Deno.test("r17: '96.6% in NVDA' is a weight claim and is held to the computed weight", () => {
  const h = [{ names: ["NVDA", "Nvidia"], weight: 19.2 }, { names: ["AAPL", "Apple"], weight: 13.6 }];
  assertEquals(fixWeights("Portfolio is 96.6% US equities, 96.6% in NVDA, and two smaller slices.", h, [{ label: /\bUS equit/i, value: 96.6 }]),
    "Portfolio is 96.6% US equities, 19.2% in NVDA, and two smaller slices.");
  assertEquals(fixWeights("About 19.2% in Nvidia.", h), "About 19.2% in Nvidia.");
  // a move is not a weight
  assertEquals(fixWeights("NVDA rose 3.1% in Nvidia's biggest day.", h), "NVDA rose 3.1% in Nvidia's biggest day.");
});

Deno.test("r17: the book's own day move is the computed one", () => {
  assertEquals(fixBookMove("US equity futures rally. Portfolio up 0.5% on strong tech.", 0.27), "US equity futures rally. Portfolio up 0.3% on strong tech.");
  assertEquals(fixBookMove("Your portfolio rose 0.3% today.", 0.27), "Your portfolio rose 0.3% today.");
  // the wrong direction removes the sentence
  assertEquals(fixBookMove("Futures rally. The portfolio fell 0.4% on tech.", 0.27), "Futures rally.");
  // a multi-week figure is not the day move
  assertEquals(fixBookMove("The portfolio is up this month 4.2%.", 0.27), "The portfolio is up this month 4.2%.");
  assertEquals(fixBookMove("Portfolio up 0.5%.", null), "Portfolio up 0.5%.");
});

Deno.test("r17: the 'What it means' opener run into a sentence goes", () => {
  assertEquals(fixWhatItMeans("What it means the AI chip rally adds $320k unrealized profit. It also pushes exposure."), "The AI chip rally adds $320k unrealized profit. It also pushes exposure.");
  assertEquals(fixWhatItMeans("It holds. What it means: dividend momentum adds income."), "It holds. Dividend momentum adds income.");
});
