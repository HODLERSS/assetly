// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 6e: a fraction word is a figure, checked against the share it names (r6 replay: "one-third of the book tied
// to a single theme" when the top theme was 21.1%; "over a third").
import { assertEquals } from "jsr:@std/assert@1";
import { fixFractions } from "./intel.ts";

const hold = [{ names: ["PLTR", "Palantir"], weight: 21.1 }, { names: ["VOO"], weight: 19.8 }, { names: ["NVDA", "Nvidia"], weight: 16.7 }];
const groups = [{ label: /\b(?:single|one|top) theme\b/i, value: 21.1 }, { label: /\btop (?:three|3)\b/i, value: 57.7 }, { label: /\bcash\b/i, value: 14.9 }, { label: /\bcrypto\b/i, value: 7.5 }];

Deno.test("r11 fractions: a wrong fraction becomes the exact share", () => {
  assertEquals(fixFractions("A concentrated growth bet, with one-third of the book tied to a single theme.", hold, groups),
    "A concentrated growth bet, with 21.1% of the book tied to a single theme.");
  assertEquals(fixFractions("PLTR alone is over a third of the portfolio.", hold, groups), "PLTR alone is 21.1% of the portfolio.");
  assertEquals(fixFractions("Nvidia is a quarter of your assets.", hold, groups), "Nvidia is 16.7% of your assets.");
  assertEquals(fixFractions("Cash is half of the portfolio.", hold, groups), "Cash is 14.9% of the portfolio.");
  assertEquals(fixFractions("The top three are two-thirds of the book.", hold, groups), "The top three are 57.7% of the book.");
});

Deno.test("r11 fractions: a fair fraction stays, and one with nothing named is left alone", () => {
  assertEquals(fixFractions("The top three make up over half of the portfolio.", hold, groups), "The top three make up over half of the portfolio.");
  assertEquals(fixFractions("PLTR is about a fifth of the portfolio.", hold, groups), "PLTR is about a fifth of the portfolio.");
  assertEquals(fixFractions("VOO is nearly a fifth of your assets.", hold, groups), "VOO is nearly a fifth of your assets.");
  assertEquals(fixFractions("Half of the book moves together.", hold, groups), "Half of the book moves together.");
  // not a share of the portfolio: untouched
  assertEquals(fixFractions("Nvidia's growth slowed to half the pace.", hold, groups), "Nvidia's growth slowed to half the pace.");
  assertEquals(fixFractions("Palantir cut its losses in half.", hold, groups), "Palantir cut its losses in half.");
});
