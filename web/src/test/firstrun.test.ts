import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";
import { pollDelay } from "../lib/assessment";

function sbWith(invoke: ReturnType<typeof vi.fn>, refreshSession = vi.fn().mockResolvedValue({ data: {}, error: null })) {
  return { sb: { functions: { invoke }, auth: { refreshSession } } as unknown as SupabaseClient, refreshSession };
}

describe("brokerageConnected surfaces failure", () => {
  it("resolves when the chain is queued", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, queued: true }, error: null });
    const { sb, refreshSession } = sbWith(invoke);
    await expect(makeApi(sb).brokerageConnected()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });
  it("a 401 (stale token) refreshes the session and retries once", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: null, error: new Error("401 not signed in") })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { sb, refreshSession } = sbWith(invoke);
    await expect(makeApi(sb).brokerageConnected()).resolves.toBeUndefined();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("still failing after the retry throws a plain message (it used to be swallowed)", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: false, error: "not signed in" }, error: null });
    const { sb } = sbWith(invoke);
    await expect(makeApi(sb).brokerageConnected()).rejects.toThrow("We couldn't start your assessment.");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("getAssessmentStatus", () => {
  const sbRows = (assessmentAt: string | null, insightAt: string | null) => {
    const q = (at: string | null) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve({ data: at ? { generated_at: at } : null, error: null });
      return c;
    };
    return { from: (t: string) => q(t === "daily_briefs" ? assessmentAt : insightAt) } as unknown as SupabaseClient;
  };
  const since = "2026-09-25T15:00:00Z";
  it("pending until an assessment newer than the run exists", async () => {
    expect(await makeApi(sbRows(null, null)).getAssessmentStatus(since)).toEqual({ status: "pending", generatedAt: null, intelligenceAt: null, hadEarlier: false });
    expect(await makeApi(sbRows("2026-09-20T10:00:00Z", "2026-09-25T15:01:00Z")).getAssessmentStatus(since))
      .toEqual({ status: "pending", generatedAt: null, intelligenceAt: "2026-09-25T15:01:00Z", hadEarlier: true });
  });
  it("ready once a fresh one lands", async () => {
    expect((await makeApi(sbRows("2026-09-25T15:03:00Z", "2026-09-25T15:01:00Z")).getAssessmentStatus(since)).status).toBe("ready");
  });
});

describe("poll cadence", () => {
  it("quick while it usually lands, then backs off to 20s and 30s", () => {
    expect(pollDelay(30_000)).toBe(10_000);
    expect(pollDelay(3 * 60_000)).toBe(20_000);
    expect(pollDelay(15 * 60_000)).toBe(30_000);
  });
});
