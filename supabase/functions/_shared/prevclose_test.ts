// Round 9 newcomer (top priority): the previous close is the last COMPLETED session's close, never a stale stored row.
import { assertEquals } from "jsr:@std/assert@1";
import { prevSessionWindow, resolvePrevClose, sessionsOf } from "./prevclose.ts";

const FRI = "2026-09-25T18:00:00Z";                      // Fri Sep 25, 2:00 PM ET
const base = { price: 506.0, asOf: FRI, providerPrev: 505.18, stored: null, historyClose: null, mkt: "US" as const };

Deno.test("r9 prev: sessions follow the market calendar", () => {
  assertEquals(sessionsOf(FRI, "US"), { session: "2026-09-25", prev: "2026-09-24" });
  // a print stamped on Saturday belongs to Friday's session
  assertEquals(sessionsOf("2026-09-26T15:00:00Z", "US"), { session: "2026-09-25", prev: "2026-09-24" });
  // a Monday pre-market print moves against Friday's close
  assertEquals(sessionsOf("2026-09-28T12:00:00Z", "US"), { session: "2026-09-28", prev: "2026-09-25" });
  // the Tuesday after Labor Day (Mon 2026-09-07) looks back to Friday Sep 4
  assertEquals(sessionsOf("2026-09-08T17:00:00Z", "US"), { session: "2026-09-08", prev: "2026-09-04" });
  // Korea: Chuseok Sep 24-25 closed, so Monday Sep 28's previous session is Wed Sep 23
  assertEquals(sessionsOf("2026-09-28T03:00:00Z", "KR"), { session: "2026-09-28", prev: "2026-09-23" });
  // crypto: UTC days, weekends included
  assertEquals(sessionsOf("2026-09-26T10:00:00Z", null), { session: "2026-09-26", prev: "2026-09-25" });
});

Deno.test("r9 prev: a new symbol takes the history close, else the provider's", () => {
  assertEquals(resolvePrevClose({ ...base, historyClose: 505.18, providerPrev: 507.17 }), 505.18);
  assertEquals(resolvePrevClose(base), 505.18);
});

Deno.test("r9 prev: a stored row two sessions old is never the base (the Sep 23 bug)", () => {
  const stale = { price: 507.17, prev_close: 509.0, as_of: "2026-09-23T20:00:00Z" };   // Wed close
  assertEquals(resolvePrevClose({ ...base, stored: stale }), 505.18);                  // provider prev (Thu close)
  assertEquals(resolvePrevClose({ ...base, stored: stale, historyClose: 505.2 }), 505.2);
  // no history, no plausible provider prev: no base at all rather than a wrong one
  assertEquals(resolvePrevClose({ ...base, stored: stale, providerPrev: null }), null);
});

Deno.test("r9 prev: the stored row IS the base when it was the previous session's close", () => {
  const thuClose = { price: 505.18, prev_close: 507.17, as_of: "2026-09-24T20:00:00Z" };
  assertEquals(resolvePrevClose({ ...base, stored: thuClose, providerPrev: 999 }), 505.18);
  // same session: the base already set at the session's first tick is kept
  const earlierToday = { price: 505.9, prev_close: 505.18, as_of: "2026-09-25T14:00:00Z" };
  assertEquals(resolvePrevClose({ ...base, stored: earlierToday, providerPrev: null }), 505.18);
});

Deno.test("r9 prev: weekends and holidays", () => {
  // Saturday refresh: base is Thursday's close, not Friday's (Friday is the quote's own session)
  const sat = { ...base, asOf: "2026-09-26T15:00:00Z", price: 507 };
  const friClose = { price: 507, prev_close: 505.18, as_of: "2026-09-25T20:00:00Z" };
  assertEquals(resolvePrevClose({ ...sat, stored: friClose, providerPrev: null }), 505.18);
  // Tuesday after Labor Day: Friday Sep 4's close is the base (the window spans the holiday)
  const tue = { ...base, asOf: "2026-09-08T17:00:00Z", price: 100.5, providerPrev: 97 };
  const fri4 = { price: 100, prev_close: 99, as_of: "2026-09-04T20:00:00Z" };
  assertEquals(resolvePrevClose({ ...tue, stored: fri4 }), 100);
  const w = prevSessionWindow("2026-09-08T17:00:00Z", "US");
  assertEquals(new Date(w.from + 30 * 60000).toISOString(), "2026-09-04T20:00:00.000Z");
  // Korea after Chuseok: Wed Sep 23 15:30 KST close is the base on Mon Sep 28
  const kr = { price: 71000, asOf: "2026-09-28T03:00:00Z", providerPrev: 70000, historyClose: null, mkt: "KR" as const };
  assertEquals(resolvePrevClose({ ...kr, stored: { price: 70500, prev_close: 70000, as_of: "2026-09-23T06:30:00Z" } }), 70500);
});

Deno.test("r9 prev: implausible bases are rejected", () => {
  assertEquals(resolvePrevClose({ ...base, historyClose: 5.05, providerPrev: 505.18 }), 505.18);
  assertEquals(resolvePrevClose({ ...base, providerPrev: 1200 }), null);
});
