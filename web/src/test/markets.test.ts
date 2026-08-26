import { describe, it, expect } from "vitest";
import { isMarketOpen, marketOf, moverEligible, sessionLabel } from "../lib/markets";

// Fixed instants (UTC) with known market states.
const KR_OPEN = new Date("2026-08-26T01:30:00Z");    // Wed 10:30 KST, Tue 21:30 ET
const US_OPEN = new Date("2026-08-26T15:00:00Z");    // Wed 11:00 ET, Thu 00:00 KST
const BOTH_CLOSED = new Date("2026-08-23T09:00:00Z"); // Sunday
const US_HOLIDAY = new Date("2026-11-26T15:00:00Z"); // Thanksgiving 10:00 ET (Thu)
const KR_HOLIDAY = new Date("2026-10-05T01:30:00Z"); // Chuseok-window holiday 10:30 KST (Mon)

describe("market sessions", () => {
  it("KRX open while US is overnight", () => {
    expect(isMarketOpen("KR", KR_OPEN)).toBe(true);
    expect(isMarketOpen("US", KR_OPEN)).toBe(false);
    expect(sessionLabel(KR_OPEN)).toBe("KRX open");
  });
  it("US regular session", () => {
    expect(isMarketOpen("US", US_OPEN)).toBe(true);
    expect(isMarketOpen("KR", US_OPEN)).toBe(false);
    expect(sessionLabel(US_OPEN)).toBe("US open");
  });
  it("weekend: both closed, crypto still open", () => {
    expect(isMarketOpen("US", BOTH_CLOSED)).toBe(false);
    expect(isMarketOpen("KR", BOTH_CLOSED)).toBe(false);
    expect(isMarketOpen("CRYPTO", BOTH_CLOSED)).toBe(true);
    expect(sessionLabel(BOTH_CLOSED)).toBe("markets closed");
  });
  it("full-closure holidays close the right market only", () => {
    expect(isMarketOpen("US", US_HOLIDAY)).toBe(false);          // Thanksgiving
    expect(isMarketOpen("KR", KR_HOLIDAY)).toBe(false);          // KR Oct 5
  });
});

describe("market assignment + mover eligibility", () => {
  const us = { symbol: "RDDT", kind: "equity" };
  const kr = { symbol: "005930.KS", kind: "equity" };
  const btc = { symbol: "BTC", kind: "crypto" };
  const cash = { symbol: "$CASH", kind: "cash" };
  it("every asset gets a market; cash/debt get none", () => {
    expect(marketOf(us)).toBe("US");
    expect(marketOf(kr)).toBe("KR");
    expect(marketOf({ symbol: "247540.KQ", kind: "equity" })).toBe("KR");
    expect(marketOf(btc)).toBe("CRYPTO");
    expect(marketOf(cash)).toBeNull();
  });
  it("movers follow the open session (the RDDT/MARA-at-3am bug)", () => {
    expect(moverEligible(kr, KR_OPEN)).toBe(true);
    expect(moverEligible(us, KR_OPEN)).toBe(false);              // US closed 4-5h: hidden
    expect(moverEligible(us, US_OPEN)).toBe(true);
    expect(moverEligible(kr, US_OPEN)).toBe(false);
    expect(moverEligible(btc, KR_OPEN)).toBe(true);              // crypto always
    expect(moverEligible(us, BOTH_CLOSED)).toBe(true);           // weekend: show last sessions
    expect(moverEligible(cash, US_OPEN)).toBe(false);
  });
});
