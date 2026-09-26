// r12 D: the spoken script speaks the card's figures and reads marks as words.
import { assertEquals } from "jsr:@std/assert@1";
import { earWords, roundPct } from "./ear.ts";

Deno.test("r12 D: card decimals under 10%, whole numbers above", () => {
  assertEquals(roundPct(3.7), "3.7");     // was "4": the card said +3.7%
  assertEquals(roundPct(4.0), "4");
  assertEquals(roundPct(0.27), "0.3");
  assertEquals(roundPct(12.9), "13");
});

Deno.test("r12 D: '~' and '(est)' in words, month names, s-possessive", () => {
  assertEquals(earWords("Earnings ~Oct 28 (est)."), "Earnings around October 28, estimated.");
  assertEquals(earWords("Next report ~$3.1B."), "Next report around $3.1B.");
  assertEquals(earWords("Meta Platforms's ad engine held up."), "Meta Platforms' ad engine held up.");
  assertEquals(earWords("Tesla's deliveries land Oct 2."), "Tesla's deliveries land October 2.");
  assertEquals(earWords("It's a quiet day."), "It's a quiet day.");
});
