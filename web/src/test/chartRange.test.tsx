// r4 power-user M2: every range is anchored on the last close ON OR BEFORE its start date, in the market's own
// zone, the way Yahoo and the server's Ask windows (windowTargetYmd) do it. Closes below are Yahoo's
// (audit/r4/r4-poweruser/y_*.json), stored the way price_history holds them (a US close at 20:00 UTC, a KRX close
// at 06:30 UTC, a coin's day at 23:59 UTC).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { anchorRange, dailyCloses, fetchHours, rangeStartYmd, seriesZone } from "../lib/chartRange";
import { PriceChart } from "../components/PriceChart";
import type { Api, HistoryPoint } from "../lib/api";

const us = (ymd: string, price: number): HistoryPoint => ({ ts: `${ymd}T20:00:00+00:00`, price });
const kr = (ymd: string, price: number): HistoryPoint => ({ ts: `${ymd}T06:30:00+00:00`, price });
const pct = (a: number, b: number) => (a / b - 1) * 100;

// NVDA, Yahoo daily closes Sep 14-24 2026; live 223.98 on Fri Sep 25 (Yahoo 1W +0.76%, base Fri Sep 18)
const NVDA = [us("2026-09-14", 210.96), us("2026-09-15", 212.17), us("2026-09-16", 213.90), us("2026-09-17", 219.34),
  us("2026-09-18", 222.27), us("2026-09-21", 227.38), us("2026-09-22", 228.87), us("2026-09-23", 225.51), us("2026-09-24", 224.58)];
// Samsung (005930.KS), Yahoo closes around the year end and before Chuseok; live ₩285,500 = Wed Sep 23 close
// (Yahoo YTD +138.1% from the Dec 30 close ₩119,900; KRX was shut Dec 31 and Jan 1)
const SAMSUNG = [kr("2025-12-24", 111100), kr("2025-12-26", 117000), kr("2025-12-29", 119500), kr("2025-12-30", 119900),
  kr("2026-01-02", 128500), kr("2026-01-05", 138100), kr("2026-01-06", 138900),
  kr("2026-09-18", 261000), kr("2026-09-21", 274000), kr("2026-09-22", 276500), kr("2026-09-23", 285500)];

describe("range start dates", () => {
  const fri = new Date("2026-09-25T19:00:00Z");
  it("1W is seven calendar days back; months are the same date; YTD is the prior Dec 31", () => {
    const ny = "America/New_York";
    expect(rangeStartYmd("1W", fri, ny)).toBe("2026-09-18");
    expect(rangeStartYmd("1M", fri, ny)).toBe("2026-08-25");
    expect(rangeStartYmd("3M", fri, ny)).toBe("2026-06-25");
    expect(rangeStartYmd("6M", fri, ny)).toBe("2026-03-25");
    expect(rangeStartYmd("YTD", fri, ny)).toBe("2025-12-31");
    expect(rangeStartYmd("1Y", fri, ny)).toBe("2025-09-25");
    expect(rangeStartYmd("2Y", fri, ny)).toBe("2024-09-25");
    expect(rangeStartYmd("5Y", fri, ny)).toBe("2021-09-25");
    // a date the month lacks falls to its end (the server's rule)
    expect(rangeStartYmd("1M", new Date("2026-03-31T15:00:00Z"), ny)).toBe("2026-02-28");
  });
  it("dates follow the market's zone: Seoul is already Saturday when New York is Friday evening", () => {
    const friEveningNy = new Date("2026-09-26T00:30:00Z");
    expect(rangeStartYmd("1W", friEveningNy, "America/New_York")).toBe("2026-09-18");
    expect(rangeStartYmd("1W", friEveningNy, "Asia/Seoul")).toBe("2026-09-19");
    expect(seriesZone("005930.KS", false)).toBe("Asia/Seoul");
    expect(seriesZone("NVDA", false)).toBe("America/New_York");
    expect(seriesZone("BTC-USD", true)).toBe("UTC");
  });
  it("the fetch reaches past the start date far enough to hold the base close", () => {
    const hours = fetchHours("1W", fri, "America/New_York");
    expect(fri.getTime() - hours * 3600e3).toBeLessThan(Date.parse("2026-09-18T00:00:00Z") - 9 * 86400e3);
  });
});

describe("anchored returns match Yahoo", () => {
  it("NVDA 1W: base is the Fri Sep 18 close, +0.77% (Yahoo +0.76%), not +2.10% from Thu Sep 17", () => {
    const tz = "America/New_York";
    const { pts, partial } = anchorRange(dailyCloses(NVDA, tz, 223.98, "2026-09-25T19:00:00Z"), rangeStartYmd("1W", new Date("2026-09-25T19:00:00Z"), tz), tz);
    expect(partial).toBe(false);
    expect(pts[0].price).toBe(222.27);
    expect(pts).toHaveLength(6);                         // Fri base + Mon..Thu + today
    expect(pct(pts.at(-1)!.price, pts[0].price)).toBeCloseTo(0.77, 2);
  });
  it("Samsung YTD: base is the 2025 year-end close (Dec 30, ₩119,900), +138.1%, not +122% from Jan 2", () => {
    const tz = "Asia/Seoul";
    const now = new Date("2026-09-25T03:00:00Z");       // Chuseok: the live price is Wednesday's close
    const { pts, partial } = anchorRange(dailyCloses(SAMSUNG, tz, 285500, "2026-09-23T06:30:00Z"), rangeStartYmd("YTD", now, tz), tz);
    expect(partial).toBe(false);
    expect(pts[0].price).toBe(119900);
    expect(pct(pts.at(-1)!.price, pts[0].price)).toBeCloseTo(138.12, 1);
  });
  it("history that starts after the range's start is partial, and draws what it has", () => {
    const tz = "America/New_York";
    const { pts, partial } = anchorRange(NVDA.slice(5), "2026-09-18", tz);
    expect(partial).toBe(true);
    expect(pts[0].price).toBe(227.38);
  });
  it("a close long before the start (a gap in the history) is no base", () => {
    const { partial } = anchorRange([us("2026-08-01", 100), us("2026-09-21", 110)], "2026-09-18", "America/New_York");
    expect(partial).toBe(true);
  });
  it("a day is the market's day: a KRX close stamped 06:30 UTC and an evening print after it stay two days", () => {
    const pts = dailyCloses([kr("2026-09-22", 100), { ts: "2026-09-22T23:00:00+00:00", price: 101 }], "Asia/Seoul", null, null);
    expect(pts.map((p) => p.price)).toEqual([100, 101]);   // 23:00 UTC Sep 22 is Sep 23 in Seoul
  });
});

describe("PriceChart asks for and draws the anchored range", () => {
  afterEach(() => { vi.useRealTimers(); });
  const chart = (getHistory: Api["getHistory"], props: Partial<Parameters<typeof PriceChart>[0]> = {}) =>
    render(<PriceChart api={{ getHistory } as Api} symbol="NVDA" currency="USD" livePrice={223.98} liveAsOf="2026-09-25T19:00:00Z" {...props} />);

  it("NVDA 1W reads +0.77% from the daily series in New York", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T19:00:00Z"));
    const getHistory = vi.fn().mockResolvedValue(NVDA);
    chart(getHistory);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    await waitFor(() => expect(screen.getByTestId("range-change").textContent).toBe("+0.77%"));
    const [, hours, daily] = getHistory.mock.calls.at(-1)!;
    expect(daily).toEqual({ tz: "America/New_York" });
    expect(hours).toBeGreaterThanOrEqual(24 * 7);
    expect(screen.queryByTestId("partial-note")).toBeNull();
    expect(screen.getByTestId("range-low").textContent).toBe("L $222.27");
  });

  it("Samsung YTD reads +138.12% in Seoul", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T03:00:00Z"));
    const getHistory = vi.fn().mockResolvedValue(SAMSUNG);
    chart(getHistory, { symbol: "005930.KS", currency: "KRW", livePrice: 285500, liveAsOf: "2026-09-23T06:30:00Z" });
    await userEvent.click(screen.getByRole("tab", { name: "YTD" }));
    await waitFor(() => expect(screen.getByTestId("range-change").textContent).toBe("+138.12%"));
    expect(getHistory.mock.calls.at(-1)![2]).toEqual({ tz: "Asia/Seoul" });
  });

  it("a failed load says so with Retry instead of an endless skeleton, and Retry draws it", async () => {
    const getHistory = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(NVDA);
    chart(getHistory);
    expect((await screen.findByTestId("chart-error")).textContent).toMatch(/Couldn't load the chart/);
    expect(screen.queryByLabelText(/loading chart/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByTestId("price-chart");
  });

  it("coming back online refetches a failed chart", async () => {
    const getHistory = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(NVDA);
    chart(getHistory);
    await screen.findByTestId("chart-error");
    window.dispatchEvent(new Event("online"));
    await screen.findByTestId("price-chart");
  });

  it("a failed refetch keeps the chart it already drew", async () => {
    const api = { getHistory: vi.fn().mockResolvedValue(NVDA) } as unknown as Api;
    const { unmount } = render(<PriceChart api={api} symbol="NVDA" currency="USD" livePrice={223.98} liveAsOf="2026-09-25T19:00:00Z" />);
    await screen.findByTestId("price-chart");
    unmount();
    (api.getHistory as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Load failed"));
    render(<PriceChart api={api} symbol="NVDA" currency="USD" livePrice={223.98} liveAsOf="2026-09-25T19:00:00Z" />);
    expect(screen.getByTestId("price-chart")).toBeTruthy();   // the session copy, on the first frame
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("chart-error")).toBeNull();
    expect(screen.getByTestId("price-chart")).toBeTruthy();
  });
});
