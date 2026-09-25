// r4 power-user M1: a coin keeps ~10k minute prints for its last 7 days, so the long ranges must not page raw
// prints under the 1D cap (BTC's 1Y was its last 5 days). They go through price_history_series (migration 41);
// until that is applied, the raw fallback pages deep enough to reach the base close.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";

const HOUR = 3600e3;
const now = Date.parse("2026-09-25T19:00:00Z");
// a year of one-a-day closes, then 7 days of minute prints: ~10.4k rows, what BTC holds after the nightly prune
const btc = (() => {
  const rows: { ts: string; price: number }[] = [];
  for (let t = now - 366 * 24 * HOUR; t < now - 7 * 24 * HOUR; t += 24 * HOUR) rows.push({ ts: new Date(t).toISOString(), price: 100_000 - rows.length * 50 });
  for (let t = now - 7 * 24 * HOUR; t <= now; t += 60_000) rows.push({ ts: new Date(t).toISOString(), price: 84_000 });
  return rows;
})();
const desc = <T,>(rows: T[]) => [...rows].reverse();
const cap = <T,>(rows: T[], from: number, to: number) => rows.slice(from, Math.min(to + 1, from + 1000));   // PostgREST max-rows

function stubSb(rpc: "ok" | "missing" | "broken") {
  const calls = { rpc: [] as [string, Record<string, unknown>][], rawPages: 0 };
  let since = "";
  const raw = {
    select: () => raw, eq: () => raw,
    gte: (_c: string, s: string) => { since = s; return raw; },
    order: (_c: string, o: { ascending: boolean }) => { expect(o.ascending).toBe(false); return raw; },
    range: async (from: number, to: number) => { calls.rawPages++; return { data: cap(desc(btc.filter((r) => r.ts >= since)), from, to), error: null }; },
  };
  const sb = {
    from: () => raw,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args]);
      const q = {
        order: (_c: string, o: { ascending: boolean }) => { expect(o.ascending).toBe(false); return q; },
        range: async (from: number, to: number) => {
          if (rpc === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.price_history_series" } };
          if (rpc === "broken") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
          // what the SQL function returns: one close per UTC day before p_daily_before, every row from it on
          const s = new Date(String(args.p_since)).toISOString(), before = new Date(String(args.p_daily_before)).toISOString();
          const byDay = new Map<string, { ts: string; price: number }>();
          for (const r of btc) if (r.ts >= s && r.ts < before) byDay.set(r.ts.slice(0, 10), r);
          const rows = [...byDay.values(), ...btc.filter((r) => r.ts >= before && r.ts >= s)];
          return { data: cap(desc(rows), from, to), error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

describe("api.getHistory, long ranges", () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); };

  it("asks the server for daily closes plus the recent window, and pages the result", async () => {
    at();
    const { sb, calls } = stubSb("ok");
    const pts = await makeApi(sb).getHistory("BTC-USD", 24 * 380, { tz: "UTC" });
    // one builder per 1000-row page, every page the same call
    expect(calls.rpc).toHaveLength(4);
    expect(new Set(calls.rpc.map((c) => JSON.stringify(c))).size).toBe(1);
    const [name, args] = calls.rpc[0];
    expect(name).toBe("price_history_series");
    expect(args).toMatchObject({ p_symbol: "BTC-USD", p_tz: "UTC" });
    expect(Date.parse(String(args.p_daily_before))).toBe(now - 48 * HOUR);
    expect(calls.rawPages).toBe(0);
    // a year back, oldest first, ending at the newest print, in ~360 closes + 2 days of minutes instead of 10k prints
    expect(pts[0].ts).toBe(btc[0].ts);
    expect(pts.at(-1)!.ts).toBe(btc.at(-1)!.ts);
    expect(pts.length).toBeLessThan(4000);
    expect(pts.every((p, i) => i === 0 || p.ts > pts[i - 1].ts)).toBe(true);
  });

  it("falls back to paging raw prints, deep enough for a coin's year, when the function is not deployed; asks once", async () => {
    at();
    const { sb, calls } = stubSb("missing");
    const api = makeApi(sb);
    const pts = await api.getHistory("BTC-USD", 24 * 380, { tz: "UTC" });
    expect(pts).toHaveLength(btc.length);             // the whole year: 11 pages, past the 1D cap of 8
    expect(pts[0].ts).toBe(btc[0].ts);
    expect(pts.at(-1)!.ts).toBe(btc.at(-1)!.ts);
    expect(calls.rawPages).toBe(11);
    // the next range goes straight to the fallback: no failing call per chip tap
    await api.getHistory("BTC-USD", 24 * 40, { tz: "UTC" });
    expect(calls.rpc).toHaveLength(1);
  });

  it("any other RPC error is a failed load, not a silent fallback", async () => {
    at();
    const { sb, calls } = stubSb("broken");
    await expect(makeApi(sb).getHistory("BTC-USD", 24 * 380, { tz: "UTC" })).rejects.toMatchObject({ code: "57014" });
    expect(calls.rawPages).toBe(0);
  });

  it("1D keeps the direct query", async () => {
    at();
    const { sb, calls } = stubSb("ok");
    const pts = await makeApi(sb).getHistory("BTC-USD", 96);
    expect(calls.rpc).toHaveLength(0);
    expect(pts.at(-1)!.ts).toBe(btc.at(-1)!.ts);
    expect(Date.parse(pts[0].ts)).toBeGreaterThanOrEqual(now - 96 * HOUR);
  });
});
