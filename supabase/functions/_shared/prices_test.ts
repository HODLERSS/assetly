import { assertEquals } from "jsr:@std/assert@1";
import { fixQuotedPrices } from "./prices.ts";

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
