import { assertEquals } from "jsr:@std/assert@1";
import { fixGainAsDayMove, fixGrossAsNet, fixQuotedPrices } from "./prices.ts";

Deno.test("9/28: a won stock quoted at its USD equivalent is corrected to the won price", () => {
  assertEquals(fixQuotedPrices("SK hynix dropped 5.0% to ₩1,300.", 1761000, "KRW", 1294.9), "SK hynix dropped 5.0% to ₩1,761,000.");
});
Deno.test("a correct won or dollar price is left alone", () => {
  assertEquals(fixQuotedPrices("SK hynix fell to ₩1,761,000.", 1761000, "KRW", 1294.9), "SK hynix fell to ₩1,761,000.");
  assertEquals(fixQuotedPrices("MARA fell 3.5% to $12.11.", 12.11, "USD", 12.11), "MARA fell 3.5% to $12.11.");
  assertEquals(fixQuotedPrices("AMD slid 3.6% to $607.87, its low.", 607.87, "USD", 607.87), "AMD slid 3.6% to $607.87, its low.");
});
Deno.test("a quoted price that matches nothing loses the clause, never gains a new number", () => {
  assertEquals(fixQuotedPrices("AMD slid 3.6% to $580.", 607.87, "USD", 607.87), "AMD slid 3.6%.");
});
Deno.test("a won stock quoted in dollars is re-quoted in won", () => {
  assertEquals(fixQuotedPrices("SK hynix slipped 0.2% to $1,300.", 1761000, "KRW", 1294.9), "SK hynix slipped 0.2% to ₩1,761,000.");
});

Deno.test("10/1: since-purchase loss written as the day's move is replaced by the day's $", () => {
  const holds = [{ names: ["MARA"], dayUsd: -26995, totalGlUsd: -177515 }, { names: ["SK hynix"], dayUsd: 9077, totalGlUsd: 277700 }];
  assertEquals(fixGainAsDayMove("MARA's −5.5% slide reduces portfolio value by $177,500, raising concentration risk.", holds),
    "MARA's −5.5% slide reduces portfolio value by $27,000, raising concentration risk.");
  assertEquals(fixGainAsDayMove("SK hynix up 3.2% adds $277,700 profit.", holds), "SK hynix up 3.2% adds $9,077 profit.");
  // the lifetime figure said as a lifetime figure stays
  assertEquals(fixGainAsDayMove("MARA is down $177,500 since you bought it.", holds), "MARA is down $177,500 since you bought it.");
});

Deno.test("10/1: gross assets quoted as the portfolio's value becomes net worth", () => {
  assertEquals(fixGrossAsNet("Portfolio sits at $1.37 M, cash 12.6%.", 1375000, 1253500), "Portfolio sits at $1.25 M, cash 12.6%.");
  assertEquals(fixGrossAsNet("Your portfolio is worth $1,375,000.", 1375000, 1253500), "Your portfolio is worth $1,253,500.");
  assertEquals(fixGrossAsNet("Total assets $1.37 M before the loan.", 1375000, 1253500), "Total assets $1.37 M before the loan.");
  assertEquals(fixGrossAsNet("Portfolio sits at $1.37 M.", 1375000, 1370000), "Portfolio sits at $1.37 M.");   // no debt: unchanged
});
