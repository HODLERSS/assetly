// Round 9 poweruser: KRX windows slid a day at 00:00 UTC on a Saturday or holiday with no trading.
import { assertEquals } from "jsr:@std/assert@1";
import { marketToday, pctOver, windowTargetYmd } from "./intel.ts";

// Samsung's real closes (prod price_history) around the 1Y base, and its Sep 23, 2026 close (Chuseok Sep 24-25)
const h = [
  { ts: "2025-09-22T06:30:00Z", price: 83500 }, { ts: "2025-09-23T06:30:00Z", price: 84700 }, { ts: "2025-09-24T06:30:00Z", price: 85400 },
  { ts: "2025-09-25T06:30:00Z", price: 86100 }, { ts: "2025-09-26T06:30:00Z", price: 83300 }, { ts: "2026-09-23T06:30:00Z", price: 285500 },
];

Deno.test("r9 windows: KRX 'today' is the last session through Chuseok and the weekend", () => {
  for (const iso of ["2026-09-24T03:00:00Z", "2026-09-25T03:00:00Z", "2026-09-25T23:59:00Z", "2026-09-26T00:00:00Z", "2026-09-26T00:30:00Z", "2026-09-27T12:00:00Z", "2026-09-27T23:59:00Z"]) {
    assertEquals(marketToday("KR", Date.parse(iso)), "2026-09-23", iso);
    assertEquals(windowTargetYmd(365, Date.parse(iso), "KR"), "2025-09-23", iso);
    // one number all weekend: 285,500 / 84,700
    assertEquals(pctOver(h, 365, Date.parse(iso), "KR")?.toFixed(2), "237.07", iso);
  }
  // Monday Sep 28 after the open: the window moves with the session
  assertEquals(marketToday("KR", Date.parse("2026-09-28T00:30:00Z")), "2026-09-28");
});

Deno.test("r9 windows: US weekends and holidays hold the last session", () => {
  assertEquals(marketToday("US", Date.parse("2026-09-26T15:00:00Z")), "2026-09-25");   // Saturday
  assertEquals(marketToday("US", Date.parse("2026-09-28T12:00:00Z")), "2026-09-25");   // Monday pre-open
  assertEquals(marketToday("US", Date.parse("2026-09-07T15:00:00Z")), "2026-09-04");   // Labor Day
  assertEquals(marketToday("US", Date.parse("2026-09-25T14:00:00Z")), "2026-09-25");   // in session
});
