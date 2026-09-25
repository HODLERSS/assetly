// api.ask payload: conversation memory is optional and bounded, and an old-style call is byte-identical.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";

function stub() {
  const calls: { fn: string; body: unknown }[] = [];
  const sb = {
    functions: {
      invoke: async (fn: string, opts: { body: unknown }) => {
        calls.push({ fn, body: opts.body });
        return { data: { ok: true, answer: "A", followups: ["Why?", "What next?", "How big?", "extra?"] }, error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

describe("api.ask", () => {
  it("without history sends only the question (1.0 contract)", async () => {
    const { sb, calls } = stub();
    const r = await makeApi(sb).ask("why did NVDA drop?");
    expect(calls).toEqual([{ fn: "ask", body: { question: "why did NVDA drop?" } }]);
    expect(r).toEqual({ answer: "A", followups: ["Why?", "What next?", "How big?"] });
  });

  it("sends the last three turns, trimmed, oldest first", async () => {
    const { sb, calls } = stub();
    const long = "x".repeat(900);
    await makeApi(sb).ask("why did that happen?", [
      { q: "t1", a: "a1" }, { q: "t2", a: "a2" }, { q: "t3", a: long }, { q: "t4", a: "a4" },
    ]);
    const body = calls[0].body as { question: string; history: { q: string; a: string }[] };
    expect(body.question).toBe("why did that happen?");
    expect(body.history.map((t) => t.q)).toEqual(["t2", "t3", "t4"]);
    expect(body.history[1].a.length).toBe(700);
  });

  it("drops empty turns and omits an empty history", async () => {
    const { sb, calls } = stub();
    await makeApi(sb).ask("hello", [{ q: "  ", a: "x" }]);
    expect(calls[0].body).toEqual({ question: "hello" });
  });
});
