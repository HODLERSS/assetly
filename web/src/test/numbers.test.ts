import { describe, it, expect } from "vitest";
import { entryPreview, formatQty, parseAmount, readAmount } from "../lib/numbers";

describe("parseAmount", () => {
  it("reads thousands commas, spaces and a leading currency mark", () => {
    expect(parseAmount("1,000")).toEqual({ ok: true, value: 1000 });
    expect(parseAmount("1,250.50")).toEqual({ ok: true, value: 1250.5 });
    expect(parseAmount("1,000,000")).toEqual({ ok: true, value: 1_000_000 });
    expect(parseAmount(" 1 500 ")).toEqual({ ok: true, value: 1500 });
    expect(parseAmount("1 500")).toEqual({ ok: true, value: 1500 });
    expect(parseAmount("$120")).toEqual({ ok: true, value: 120 });
    expect(parseAmount("$ 1,500")).toEqual({ ok: true, value: 1500 });
    expect(parseAmount("US$99.5")).toEqual({ ok: true, value: 99.5 });
    expect(parseAmount("₩1,500,000")).toEqual({ ok: true, value: 1_500_000 });
    expect(parseAmount("USD 40")).toEqual({ ok: true, value: 40 });
    expect(parseAmount(".5")).toEqual({ ok: true, value: 0.5 });
    expect(parseAmount("5.")).toEqual({ ok: true, value: 5 });
    expect(parseAmount("0.0123")).toEqual({ ok: true, value: 0.0123 });
    expect(parseAmount("0")).toEqual({ ok: true, value: 0 });
  });
  it("rejects junk instead of guessing", () => {
    for (const s of ["1.2.3", "abc", "12abc", "1e3", "1,2", "1000,50", "1,00,000", "$", "--5", "1 . 5.5", "0x10", "Infinity", "NaN"]) {
      expect(parseAmount(s), s).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("empty and negative are their own reasons", () => {
    expect(parseAmount("")).toEqual({ ok: false, reason: "empty" });
    expect(parseAmount("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseAmount("-5")).toEqual({ ok: false, reason: "negative" });
    expect(parseAmount("−5")).toEqual({ ok: false, reason: "negative" });
    expect(parseAmount("-$5")).toEqual({ ok: false, reason: "negative" });
    expect(parseAmount("$-5")).toEqual({ ok: false, reason: "negative" });
  });
});

describe("readAmount", () => {
  it("quantities must be above zero, with field-specific wording", () => {
    expect(readAmount("1,000", "shares")).toEqual({ value: 1000, error: null });
    expect(readAmount("", "shares").error).toBe("Enter how many shares you own.");
    expect(readAmount("0", "shares").error).toBe("Shares must be more than zero.");
    expect(readAmount("-3", "shares").error).toBe("Shares must be more than zero.");
    expect(readAmount("1.2.3", "shares").error).toMatch(/^Shares must be a number/);
    expect(readAmount("", "units").error).toBe("Enter how much you own.");
    expect(readAmount("", "cash").error).toBe("Enter the amount.");
    expect(readAmount("0", "debt").error).toBe("Amount owed must be more than zero.");
  });
  it("cost is required, may be zero, never negative — and says so plainly", () => {
    expect(readAmount("", "cost").error).toBe("Enter what you paid per share.");
    expect(readAmount("0", "cost")).toEqual({ value: 0, error: null });
    expect(readAmount("-1", "cost").error).toBe("Cost can't be negative.");
    expect(readAmount("$1,250.50", "cost")).toEqual({ value: 1250.5, error: null });
  });
});

describe("entryPreview", () => {
  it("echoes shares × cost = total before saving", () => {
    expect(entryPreview({ kind: "equity", qty: "10", cost: "400", currency: "USD" })).toBe("10 shares × $400.00 = $4,000.00");
    expect(entryPreview({ kind: "equity", qty: "1,000", cost: "400", currency: "USD" })).toBe("1,000 shares × $400.00 = $400,000.00");
    expect(entryPreview({ kind: "equity", qty: "1", cost: "12.5", currency: "USD" })).toBe("1 share × $12.50 = $12.50");
    expect(entryPreview({ kind: "equity", qty: "3", cost: "71,000", currency: "KRW" })).toBe("3 shares × ₩71,000 = ₩213,000");
    expect(entryPreview({ kind: "crypto", qty: "0.5", cost: "60,000", currency: "USD", unit: "BTC" })).toBe("0.5 BTC × $60,000.00 = $30,000.00");
  });
  it("cash and debt echo the amount; nothing until the quantity parses", () => {
    expect(entryPreview({ kind: "cash", qty: "1,500", currency: "USD" })).toBe("Amount: $1,500.00");
    expect(entryPreview({ kind: "debt", qty: "₩2,000,000", currency: "KRW" })).toBe("Amount owed: ₩2,000,000");
    expect(entryPreview({ kind: "equity", qty: "", cost: "5", currency: "USD" })).toBeNull();
    expect(entryPreview({ kind: "equity", qty: "abc", cost: "5", currency: "USD" })).toBeNull();
    expect(entryPreview({ kind: "equity", qty: "10", cost: "", currency: "USD" })).toBe("10 shares");
  });
  it("quantities print without float noise", () => {
    expect(formatQty(0.1 + 0.2)).toBe("0.3");
    expect(formatQty(3000)).toBe("3,000");
  });
});
