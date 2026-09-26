// r11 P2: all windows of all holdings in one round trip (window_bases), with the same rule as windowReturns.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { windowReturnsBatch } from "./history.ts";

Deno.test("r11: windowReturnsBatch reads every window in one call and judges it like windowReturns", async () => {
  let calls = 0;
  const now = Date.parse("2026-09-25T20:00:00Z");
  const admin = {
    rpc: (fn: string, args: { p_symbols: string[]; p_ks: number[]; p_cuts: string[] }) => {
      calls++;
      assertEquals(fn, "window_bases");
      assertEquals(args.p_symbols.length, 2 * 2);   // 2 symbols x 2 windows, one call
      const rows = [
        { symbol: "NVDA", k: 0, ts: "2026-09-25T20:00:00Z", price: 110 },
        { symbol: "NVDA", k: 1, ts: "2026-09-18T20:00:00Z", price: 100 },     // 1W base on its date
        { symbol: "NVDA", k: 2, ts: "2025-09-25T20:00:00Z", price: 50 },      // 1Y base
        { symbol: "AAPL", k: 0, ts: "2026-09-25T20:00:00Z", price: 200 },
        { symbol: "AAPL", k: 1, ts: "2026-09-18T20:00:00Z", price: 250 },
      ];
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const out = await windowReturnsBatch(admin, [{ symbol: "NVDA", mkt: "US" }, { symbol: "AAPL", mkt: "US" }], [7, 365], now);
  assertEquals(calls, 1);
  assertEquals(out!.get("NVDA")!.pct[7]!.toFixed(1), "10.0");
  assertEquals(out!.get("NVDA")!.pct[365]!.toFixed(1), "120.0");
  assertEquals(out!.get("AAPL")!.pct[7]!.toFixed(1), "-20.0");
  assertEquals(out!.get("AAPL")!.pct[365], null);   // no base: no figure
});

Deno.test("r11: without the SQL function the batch says so (the caller falls back)", async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { message: "function window_bases does not exist" } }) };
  assert(await windowReturnsBatch(admin, [{ symbol: "NVDA", mkt: "US" }], [7]) === null);
});
