import { describe, it, expect } from "vitest";
import { money, moneyExact, signedMoney, signedPct, priceAsOf } from "../lib/format";
describe("format", () => {
  it("values are whole dollars; per-share figures keep cents", () => {
    expect(money(1126)).toBe("$1,126");
    expect(money(441)).toBe("$441");
    expect(signedMoney(-441)).toBe("-$441");
    expect(moneyExact(11.26)).toBe("$11.26");
    expect(moneyExact(14.4467)).toBe("$14.45");
    expect(money(69138000, "KRW")).toBe("₩69,138,000");
    expect(moneyExact(207000, "KRW")).toBe("₩207,000");
  });
  it("percent keeps sign", () => { expect(signedPct(5.26)).toBe("+5.26%"); expect(signedPct(-0.5)).toBe("-0.50%"); });
  it("as-of reads as a close when markets have been shut for hours", () => {
    expect(priceAsOf(new Date(Date.now() - 30_000).toISOString())).toBe("live");
    expect(priceAsOf(new Date(Date.now() - 2 * 86400_000).toISOString())).toMatch(/close$/);
    expect(priceAsOf(null)).toBe("no print yet");
  });
});
