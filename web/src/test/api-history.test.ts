// api.getHistory: PostgREST caps a response at 1000 rows, so a range with more prints than that must page
// newest-first and come back in time order, ending at the NEWEST print (the r3 audit: every chart range
// ended days early because ascending + limit returned the oldest 1000).
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";

function stub(total: number) {
  // rows ts ascending: minute i
  const all = Array.from({ length: total }, (_, i) => ({ ts: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(), price: i }));
  const ranges: [number, number][] = [];
  const q = {
    select: () => q, eq: () => q, gte: () => q,
    order: (_c: string, o: { ascending: boolean }) => { expect(o.ascending).toBe(false); return q; },
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      const desc = [...all].reverse();
      return { data: desc.slice(from, Math.min(to + 1, 1000 + from)), error: null };   // server cap
    },
  };
  const sb = { from: () => q } as unknown as SupabaseClient;
  return { sb, ranges, all };
}

describe("api.getHistory", () => {
  it("pages past the 1000-row cap and returns every point, oldest first, ending at the newest", async () => {
    const { sb, ranges, all } = stub(2371);
    const pts = await makeApi(sb).getHistory("NVDA", 24 * 31);
    expect(pts).toHaveLength(2371);
    expect(pts[0].price).toBe(0);
    expect(pts.at(-1)!.ts).toBe(all.at(-1)!.ts);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("a short range is a single request", async () => {
    const { sb, ranges } = stub(40);
    const pts = await makeApi(sb).getHistory("NVDA", 24);
    expect(pts).toHaveLength(40);
    expect(ranges).toHaveLength(1);
  });
});
