import { describe, it, expect } from "vitest";
import { moveSession } from "../lib/markets";
import { dayGroups } from "../lib/portfolio";
import type { PortfolioRow } from "../lib/api";

// The audit's scene: Friday 2026-09-25 11:00 ET, US open. Korea is shut for Chuseok (Sep 24-25), so
// Samsung's last print is Wednesday's 15:30 KST close — Tuesday evening on a Pacific clock.
const FRI_US_OPEN = new Date("2026-09-25T15:00:00Z");
const KR_WED_CLOSE = "2026-09-23T06:30:00Z";
const r = (over: Partial<PortfolioRow>): PortfolioRow => ({
  holding_id: "h", symbol: "AAPL", account: "brokerage", nickname: "", name: "Apple", currency: "USD", kind: "equity",
  qty: 1, cost_basis: 0, avg_cost: 0, price: 0, change_pct: 0, as_of: "2026-09-25T14:59:00Z", value: 0, total_gl: 0, ...over,
});

describe("moveSession", () => {
  it("a US print during the US session is today", () => {
    expect(moveSession(r({}), FRI_US_OPEN)).toEqual({ today: true, label: "today" });
  });
  it("a KRX print from an earlier session is labelled by its date IN SEOUL", () => {
    expect(moveSession(r({ symbol: "005930.KS", currency: "KRW", as_of: KR_WED_CLOSE }), FRI_US_OPEN)).toEqual({ today: false, label: "Wed close" });
  });
  it("Korea's own same-day close still counts as today there (Fri 23:00 KST)", () => {
    expect(moveSession(r({ symbol: "005930.KS", currency: "KRW", as_of: "2026-09-18T06:30:00Z" }), new Date("2026-09-18T14:00:00Z")))
      .toEqual({ today: true, label: "today" });
  });
  it("on Saturday the US move is Friday's close", () => {
    expect(moveSession(r({ as_of: "2026-09-25T20:00:00Z" }), new Date("2026-09-26T16:00:00Z"))).toEqual({ today: false, label: "Fri close" });
  });
  it("crypto and cash always count as today", () => {
    expect(moveSession(r({ symbol: "BTC", kind: "crypto", as_of: KR_WED_CLOSE }), FRI_US_OPEN).today).toBe(true);
    expect(moveSession(r({ symbol: "$CASH", kind: "cash", as_of: KR_WED_CLOSE }), FRI_US_OPEN).today).toBe(true);
  });
});

describe("dayGroups", () => {
  const book = [
    r({ value: 1011, change_pct: 1.0891 }),                                                                         // ≈ +$10.89 today
    r({ symbol: "005930.KS", currency: "KRW", value: 13_800_000, change_pct: 3.0, as_of: KR_WED_CLOSE }),           // ≈ +₩401,942 ≈ +$291
    r({ symbol: "$CASH", kind: "cash", value: 5000 }),
  ];
  it("never sums sessions: US today and Korea's Wednesday close are separate groups, today first", () => {
    const g = dayGroups(book, "USD", { USD: 1, KRW: 1380 }, FRI_US_OPEN);
    expect(g.map((x) => [x.markets.join("+"), x.label])).toEqual([["US", "today"], ["Korea", "Wed close"]]);
    expect(g[0].day).toBeCloseTo(10.89, 1);
    expect(g[1].day).toBeCloseTo(291.26, 1);
    expect((g[1].day / g[1].basis) * 100).toBeCloseTo(3.0, 5);
  });
  it("one session, one group (cash adds nothing)", () => {
    const g = dayGroups([book[0], book[2]], "USD", { USD: 1, KRW: 1380 }, FRI_US_OPEN);
    expect(g).toHaveLength(1);
    expect(g[0].today).toBe(true);
  });
});
