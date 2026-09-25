import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { money, moneyClass, signedMoney, signedMoneyCompact, signedPct } from "../lib/format";
import { isHeld, sortByBaseValue } from "../lib/portfolio";
import { accountLabel, accountTag, defaultAccount } from "../lib/accounts";
import { makeApi, type PortfolioRow } from "../lib/api";

const r = (over: Partial<PortfolioRow>): PortfolioRow => ({
  holding_id: "h", symbol: "X", account: "brokerage", nickname: "", name: "X", currency: "USD", kind: "equity",
  qty: 1, cost_basis: 1, avg_cost: 1, price: 1, change_pct: 0, as_of: null, value: 1, total_gl: 0, ...over,
});

describe("zero never carries a sign", () => {
  it("amounts that round to zero print as a neutral $0", () => {
    expect(signedMoney(-0.06)).toBe("$0");
    expect(signedMoney(0.4)).toBe("$0");
    expect(signedMoney(-0.6)).toBe("-$1");
    expect(money(-0.3)).toBe("$0");
    expect(signedMoneyCompact(-0.06, "USD")).toBe("$0");
    expect(signedMoneyCompact(-0.2, "KRW")).toBe("₩0");
    expect(signedMoneyCompact(-1500, "USD")).toBe("-$1.5K");
    expect(signedPct(-0.001)).toBe("0.00%");
    expect(signedPct(-0.05)).toBe("-0.05%");
    expect(moneyClass(-0.06)).toBe("mutedc");
    expect(moneyClass(-3)).toBe("loss");
  });
});

describe("book shaping", () => {
  it("only rows with something in them are held", () => {
    expect(isHeld(r({ qty: 3 }))).toBe(true);
    expect(isHeld(r({ qty: 0 }))).toBe(false);
    expect(isHeld(r({ qty: null }))).toBe(false);
  });
  it("sorts by value converted to the base currency, unconvertible rows last in their original order", () => {
    const rows = [
      r({ holding_id: "krw", currency: "KRW", value: 9_310_000 }),
      r({ holding_id: "btc", value: 29_000 }),
      r({ holding_id: "eur", currency: "EUR", value: 5_000 }),   // no EUR rate
      r({ holding_id: "cash", value: 15_000 }),
      r({ holding_id: "gbp", currency: "GBP", value: 1 }),       // no GBP rate
    ];
    expect(sortByBaseValue(rows, "USD", { USD: 1, KRW: 1380 }).map((x) => x.holding_id)).toEqual(["btc", "cash", "krw", "eur", "gbp"]);
    // in a KRW base the same order holds (it is one currency either way)
    expect(sortByBaseValue(rows, "KRW", { USD: 1, KRW: 1380 }).map((x) => x.holding_id)).toEqual(["btc", "cash", "krw", "eur", "gbp"]);
  });
});

describe("account names", () => {
  it("one mapping, crypto included", () => {
    expect(accountLabel("crypto")).toBe("Crypto");
    expect(accountLabel("ira")).toBe("IRA");
    expect(accountLabel("401k")).toBe("401k");
    expect(accountTag("brokerage")).toBe("");
    expect(accountTag("bank")).toBe("Bank");
    expect(defaultAccount("cash")).toBe("bank");
    expect(defaultAccount("debt")).toBe("bank");
    expect(defaultAccount("equity")).toBe("brokerage");
    expect(defaultAccount("crypto")).toBe("brokerage");
  });
});

// A just-enough PostgREST query-builder fake: records every call, resolves with scripted results.
function fakeSb(script: Record<string, unknown[]>) {
  const calls: string[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    let op = "select";
    const log: string[] = [];
    for (const m of ["select", "update", "delete", "insert", "eq", "single"]) {
      chain[m] = (...args: unknown[]) => {
        if (["update", "delete", "insert"].includes(m)) op = m;
        log.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return chain;
      };
    }
    chain.then = (res: (v: unknown) => void) => {
      calls.push(`${table}.${log.join(".")}`);
      const q = script[`${table}.${op}`] ?? [];
      res(q.length ? q.shift() : { data: null, error: null });
    };
    return chain;
  };
  return { sb: { from: vi.fn(from) } as unknown as SupabaseClient, calls };
}

describe("setHoldingAccount", () => {
  it("a plain move updates the holding and keeps its id", async () => {
    const { sb, calls } = fakeSb({});
    expect(await makeApi(sb).setHoldingAccount("h1", "ira")).toBe("h1");
    expect(calls).toEqual(['holdings.update({"account":"ira"}).eq("id","h1")']);
  });
  it("into an account that already holds it: the lots fold into that position and this one goes", async () => {
    const { sb, calls } = fakeSb({
      "holdings.update": [{ data: null, error: { code: "23505", message: "duplicate key" } }],
      "holdings.select": [
        { data: { user_id: "u", symbol: "MSFT", nickname: "" }, error: null },
        { data: { id: "h9", source: "manual" }, error: null },
      ],
    });
    expect(await makeApi(sb).setHoldingAccount("h1", "ira")).toBe("h9");
    expect(calls[3]).toBe('lots.update({"holding_id":"h9"}).eq("holding_id","h1")');
    expect(calls[4]).toBe('holdings.delete().eq("id","h1")');
  });
  it("never folds manual lots into a brokerage-synced position", async () => {
    const { sb, calls } = fakeSb({
      "holdings.update": [{ data: null, error: { code: "23505", message: "duplicate key" } }],
      "holdings.select": [
        { data: { user_id: "u", symbol: "MSFT", nickname: "" }, error: null },
        { data: { id: "h9", source: "snaptrade" }, error: null },
      ],
    });
    await expect(makeApi(sb).setHoldingAccount("h1", "ira")).rejects.toThrow(/already synced/);
    expect(calls.some((c) => c.startsWith("lots.update"))).toBe(false);
  });
  it("other errors surface as they are", async () => {
    const { sb } = fakeSb({ "holdings.update": [{ data: null, error: { code: "42501", message: "denied" } }] });
    await expect(makeApi(sb).setHoldingAccount("h1", "ira")).rejects.toMatchObject({ code: "42501" });
  });
});
