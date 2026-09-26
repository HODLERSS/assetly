// Round 9 (poweruser + designer): each edition is written only inside its ET / KST window.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { clockEdition, editionWindow } from "./calendar.ts";

const at = (iso: string) => new Date(iso);

Deno.test("r9 editions: the two stray rows of Sep 25 fall outside their windows", () => {
  // Midday written at 21:32 UTC = 5:32 PM EDT
  assertFalse(editionWindow("midday", at("2026-09-25T21:32:00Z")).ok);
  // Morning written at 00:02 UTC Sep 26 = 8:02 PM EDT Sep 25
  assertFalse(editionWindow("morning", at("2026-09-26T00:02:00Z")).ok);
  // and the clock at those moments says close / nothing
  assertEquals(clockEdition(at("2026-09-25T21:32:00Z")), "close");
  assertEquals(clockEdition(at("2026-09-26T00:02:00Z")), "close");   // 8:02 PM ET: a missing close may still be backfilled
});

Deno.test("r9 editions: windows in ET", () => {
  assert(editionWindow("morning", at("2026-09-25T12:35:00Z")).ok);          // 8:35 AM EDT
  assertFalse(editionWindow("morning", at("2026-09-25T13:31:00Z")).ok);     // 9:31, after the open
  assertFalse(editionWindow("morning", at("2026-09-25T11:30:00Z")).ok);     // 7:30, too early
  assert(editionWindow("midday", at("2026-09-25T16:00:00Z")).ok);           // noon
  assertFalse(editionWindow("midday", at("2026-09-25T20:00:00Z")).ok);      // 4:00 PM, the close
  assertFalse(editionWindow("close", at("2026-09-25T19:59:00Z")).ok);       // 3:59 PM
  assert(editionWindow("close", at("2026-09-25T20:05:00Z")).ok);
  assertFalse(editionWindow("close", at("2026-09-26T04:30:00Z")).ok);       // Saturday 12:30 AM ET: no session that ET day
  assert(editionWindow("weekend", at("2026-09-26T14:05:00Z")).ok);
  assertFalse(editionWindow("weekend", at("2026-09-25T14:05:00Z")).ok);
  assertFalse(editionWindow("morning", at("2026-09-07T12:35:00Z")).ok);     // Labor Day
  assert(editionWindow("assessment", at("2026-09-26T00:02:00Z")).ok);
});

Deno.test("r9 editions: the clock follows ET through the daylight-time change", () => {
  // Nov 16 2026 (EST): 20:05 UTC is 3:05 PM ET, not the close
  assertEquals(clockEdition(at("2026-11-16T20:05:00Z")), "midday");
  assertEquals(clockEdition(at("2026-11-16T21:05:00Z")), "close");
  assertEquals(clockEdition(at("2026-11-16T13:00:00Z")), "morning");      // 8:00 AM EST
  assertEquals(clockEdition(at("2026-11-16T12:35:00Z")), null);           // 7:35 AM EST
  assertEquals(clockEdition(at("2026-09-25T14:00:00Z")), null);           // 10:00 AM EDT, between morning and midday
});

Deno.test("r9 editions: Korea windows in KST", () => {
  assert(editionWindow("kr_open", at("2026-09-23T00:20:00Z")).ok);          // 9:20 KST
  assertFalse(editionWindow("kr_open", at("2026-09-24T00:20:00Z")).ok);     // Chuseok
  assert(editionWindow("kr_close", at("2026-09-23T06:40:00Z")).ok);         // 15:40 KST
  assertFalse(editionWindow("kr_close", at("2026-09-23T05:00:00Z")).ok);    // 14:00 KST, still trading
});
