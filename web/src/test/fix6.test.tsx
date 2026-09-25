// Round-6 polish (1.0.1), client side: a chart read that hangs gives up with Retry, a coin's week reads its hours
// in the reader's zone and keeps closing highs and lows, legacy weekly rows are dated at the close they carry,
// "Use today's price" names a closed market's last close and dates the lot on it, stock-code crypto tokens stay
// out of search, a lot bought in the session moves from its cost, a slow book refresh is not a failure, and the
// book-changed calls outlive the page. Same harness as fix5.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SupabaseClient } from "@supabase/supabase-js";

const authState = vi.hoisted(() => ({ session: { user: { id: "u-test", email: "first.run@example.com" } } as { user: { id: string; email?: string } } | null }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockImplementation(async () => ({ data: { session: authState.session } })),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-test" } } }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
  signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signInWithEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
  signInWithApple: vi.fn().mockResolvedValue({ error: null }),
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  completeNativeAuth: vi.fn().mockResolvedValue({ error: null }),
}));

import { App } from "../App";
import { PriceChart, scrubLabel } from "../components/PriceChart";
import { makeApi, type Api, type HistoryPoint, type SymbolRow } from "../lib/api";
import { FAIL_FAST_MS, keepaliveInit, setPricesDown } from "../lib/net";
import { anchorRange, dailyCloses, weeklyAtClose, ymdIn } from "../lib/chartRange";
import { quoteChoice } from "../lib/numbers";
import { rankSymbols } from "../lib/search";
import { dayGroups, rowDayChange, withSameDayLots } from "../lib/portfolio";
import { row, stubApi } from "./fixtures";

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  setPricesDown(false);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPricesDown(false); });

// A price_history_series RPC whose pages never answer until their signal aborts (an online but hung backend).
function hungRpc() {
  const seen = { signals: [] as AbortSignal[], pages: 0 };
  const sb = {
    rpc: () => {
      const q: Record<string, unknown> = {};
      q.order = () => q;
      q.range = () => {
        seen.pages++;
        let signal: AbortSignal | null = null;
        const page = {
          abortSignal: (s: AbortSignal) => { signal = s; seen.signals.push(s); return page; },
          then: (res: (v: unknown) => void) => {
            signal?.addEventListener("abort", () => res({ data: null, error: { message: "AbortError: timed out" } }));
          },
        };
        return page;
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, seen };
}

describe("L1 a chart read that hangs gives up (r6 power-user m2: ETH 2Y a skeleton for 25s+, no Retry)", () => {
  it("a chart page carries a time limit on a healthy connection, and fails at FAIL_FAST_MS", async () => {
    vi.useFakeTimers();
    const { sb, seen } = hungRpc();
    let settled = false;
    const read = makeApi(sb).getHistory("ETH-USD", 24 * 800, { tz: "UTC", recentHours: 0 });
    read.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(FAIL_FAST_MS - 1000);
    expect(seen.signals).toHaveLength(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(read).rejects.toMatchObject({ message: expect.stringMatching(/timed out/) });
  });
  it("the chart then says so with Retry, and Retry draws it", async () => {
    const pts = [{ ts: new Date(Date.now() - 3 * 86400e3).toISOString(), price: 100 }, { ts: new Date(Date.now() - 2 * 86400e3).toISOString(), price: 110 }];
    const getHistory = vi.fn().mockRejectedValueOnce(new Error("timed out")).mockResolvedValue(pts);
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="ETH-USD" currency="USD" livePrice={120} liveAsOf={new Date().toISOString()} crypto />);
    const err = await screen.findByTestId("chart-error");
    expect(err.textContent).toMatch(/Couldn't load the chart\./);
    await userEvent.click(within(err).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("price-chart")).toBeTruthy();
  });
});

// A coin's last nine days by the hour, gently rising, with one intraday spike that is not a close.
function coinWeek(): { pts: HistoryPoint[]; live: number; liveAt: string } {
  const now = Date.now();
  const pts: HistoryPoint[] = [];
  for (let h = 9 * 24; h >= 1; h--) pts.push({ ts: new Date(now - h * 3600e3).toISOString(), price: 80_000 + (9 * 24 - h) * 0.5 });
  pts[pts.length - 60] = { ...pts[pts.length - 60], price: 90_000 };   // an hourly print, never a day's last
  return { pts, live: 80_500, liveAt: new Date(now).toISOString() };
}

describe("L2 a coin's week (r6 power-user m1, designer m-2)", () => {
  it("hours read in the reader's own zone, not UTC with no zone", async () => {
    // jsdom has no PointerEvent, and without one a pointer's clientX never arrives (every touch hit the first point)
    class PointerEvt extends MouseEvent { pointerId: number; constructor(t: string, init: PointerEventInit = {}) { super(t, init); this.pointerId = init.pointerId ?? 1; } }
    vi.stubGlobal("PointerEvent", PointerEvt);
    const { pts, live, liveAt } = coinWeek();
    render(<PriceChart api={{ getHistory: vi.fn().mockResolvedValue(pts) } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={live} liveAsOf={liveAt} crypto />);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    const svg = await screen.findByTestId("price-chart");
    // the hourly line has landed (the daily one draws first)
    await waitFor(() => expect(svg.querySelector("path")!.getAttribute("d")!.split("L").length).toBeGreaterThan(50));
    svg.getBoundingClientRect = () => ({ left: 0, width: 320, top: 0, height: 96, right: 320, bottom: 96, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerDown(svg, { clientX: 319, pointerId: 1 });
    const text = screen.getByTestId("scrub-readout").textContent ?? "";
    expect(text).toContain(scrubLabel(liveAt, "1W", undefined, true));
    const utc = scrubLabel(liveAt, "1W", "UTC", true);
    if (utc !== scrubLabel(liveAt, "1W", undefined, true)) expect(text).not.toContain(utc);
  });
  it("its high and low are closing ones, the basis of every other range: no spike, never above the 1M high", async () => {
    const { pts, live, liveAt } = coinWeek();
    render(<PriceChart api={{ getHistory: vi.fn().mockResolvedValue(pts) } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={live} liveAsOf={liveAt} crypto />);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    await screen.findByTestId("price-chart");
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $80,500.00"));
    const low1w = screen.getByTestId("range-low").textContent;
    await userEvent.click(screen.getByRole("tab", { name: "1M" }));
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $80,500.00"));
    expect(Number(low1w!.replace(/[^\d.]/g, ""))).toBeGreaterThanOrEqual(Number(screen.getByTestId("range-low").textContent!.replace(/[^\d.]/g, "")));
  });
});

describe("L3 legacy weekly rows are dated at the close they carry (r6 power-user m4)", () => {
  it("a Monday-midnight row moves to its Friday; any other row stays", () => {
    expect(weeklyAtClose({ ts: "2021-09-20T04:00:00Z", price: 22.08 }, "America/New_York").ts.slice(0, 10)).toBe("2021-09-24");
    expect(ymdIn(weeklyAtClose({ ts: "2024-09-29T15:00:00+00:00", price: 1 }, "Asia/Seoul").ts, "Asia/Seoul")).toBe("2024-10-04");   // Mon 00:00 KST
    expect(weeklyAtClose({ ts: "2024-09-23T00:00:00Z", price: 1 }, "UTC").ts.slice(0, 10)).toBe("2024-09-29");               // a coin's week ends Sunday
    const daily = { ts: "2021-09-27T20:00:00+00:00", price: 21.9 };
    expect(weeklyAtClose(daily, "America/New_York")).toBe(daily);                                                         // a Monday close
    const tue = { ts: "2021-09-21T04:00:00Z", price: 1 };
    expect(weeklyAtClose(tue, "America/New_York")).toBe(tue);
  });
  it("NVDA's 5Y base reads Sep 24 with the Sep 24 close, and a real close wins over a legacy row of its day", () => {
    const pts = [
      { ts: "2021-09-13T04:00:00Z", price: 21.9 },            // legacy: the Sep 17 close
      { ts: "2021-09-20T04:00:00Z", price: 22.08 },           // legacy: the Sep 24 close
      { ts: "2021-09-27T04:00:00Z", price: 20.742 },          // legacy inside the backfill span: the Oct 1 close
      { ts: "2021-09-27T20:00:00+00:00", price: 21.93 },
      { ts: "2021-09-28T20:00:00+00:00", price: 20.8 },
      { ts: "2021-10-01T20:00:00+00:00", price: 20.74 },
    ];
    const closes = dailyCloses(pts, "America/New_York", null, null);
    expect(closes.map((p) => ymdIn(p.ts, "America/New_York"))).toEqual(["2021-09-17", "2021-09-24", "2021-09-27", "2021-09-28", "2021-10-01"]);
    expect(closes.find((p) => ymdIn(p.ts, "America/New_York") === "2021-10-01")!.price).toBe(20.74);
    const r = anchorRange(closes, "2021-09-25", "America/New_York");
    expect(r.partial).toBe(false);
    expect(ymdIn(r.pts[0].ts, "America/New_York")).toBe("2021-09-24");
    expect(r.pts[0].price).toBe(22.08);
  });
});

describe("L4 Use today's price names a closed market's last close (r6 power-user m3)", () => {
  const samsung = { symbol: "005930.KS", kind: "equity", currency: "KRW" };
  it("KRX closed: Wednesday's close, dated Wednesday in Seoul", () => {
    const c = quoteChoice({ price: 285_500, asOf: "2026-09-23T06:30:00Z" }, samsung, new Date("2026-09-25T21:43:00Z"));
    expect(c).toEqual({ label: "Use last close (₩285,500, Wed)", ymd: "2026-09-23" });
  });
  it("a US stock on a weekend: Friday's close, dated Friday", () => {
    const c = quoteChoice({ price: 225.07, asOf: "2026-09-25T20:00:00Z" }, { symbol: "NVDA", kind: "equity", currency: "USD" }, new Date("2026-09-26T18:00:00Z"));
    expect(c).toEqual({ label: "Use last close ($225.07, Fri)", ymd: "2026-09-25" });
  });
  it("open, or printed today in its market: today's price, dated on the market's day", () => {
    expect(quoteChoice({ price: 225.07, asOf: "2026-09-24T15:00:00Z" }, { symbol: "NVDA", kind: "equity", currency: "USD" }, new Date("2026-09-24T15:01:00Z")))
      .toEqual({ label: "Use today's price ($225.07)", ymd: "2026-09-24" });
    expect(quoteChoice({ price: 225.07, asOf: "2026-09-24T20:00:00Z" }, { symbol: "NVDA", kind: "equity", currency: "USD" }, new Date("2026-09-25T03:00:00Z")))
      .toEqual({ label: "Use today's price ($225.07)", ymd: "2026-09-24" });   // 11 PM in New York, same session
    expect(quoteChoice({ price: 2681, asOf: "2026-09-19T03:00:00Z" }, { symbol: "ETH-USD", kind: "crypto", currency: "USD" }).label).toBe("Use today's price ($2,681.00)");
  });
  it("on Add position, a weekend quote says so and dates the lot on its Friday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-19T18:00:00Z"));   // a Saturday
    const api = stubApi({ getQuote: vi.fn().mockResolvedValue({ price: 15, asOf: "2026-09-18T20:00:00Z" }) } as Partial<Api>);
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    const use = await screen.findByTestId("use-quote");
    expect(use.textContent).toBe("Use last close ($15.00, Fri)");
    await userEvent.click(use);
    expect((screen.getByLabelText(/purchase date/i) as HTMLInputElement).value).toBe("2026-09-18");
    await userEvent.type(screen.getByLabelText(/^shares$/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 10, 15, "2026-09-18", "brokerage", "", ""));
  });
});

describe("L5 search keeps stock-code crypto tokens out (r6 power-user m5)", () => {
  const rows: SymbolRow[] = [
    { symbol: "005930.KS", name: "Samsung Electronics Co., Ltd.", exchange: "KSC", currency: "KRW", kind: "equity" },
    { symbol: "005930-USD", name: "005930 Samsung Electronics Co Ltd (Derivatives)", exchange: "CCC", currency: "USD", kind: "crypto", remote: true },
    { symbol: "005935.KS", name: "Samsung Electronics Co., Ltd. Pfd", exchange: "KSC", currency: "KRW", kind: "equity" },
  ];
  it("'005930' lists Samsung and its preferred line, not the token", () => {
    expect(rankSymbols("005930", rows).map((r) => r.symbol)).toEqual(["005930.KS", "005935.KS"]);
  });
  it("a token named for a stock code is out even without '(Derivatives)'; a real coin stays", () => {
    const more: SymbolRow[] = [...rows, { symbol: "000660", name: "SK hynix", exchange: "CCC", currency: "USD", kind: "crypto" },
      { symbol: "ETH-USD", name: "Ethereum USD", exchange: "CCC", currency: "USD", kind: "crypto" }];
    expect(rankSymbols("000660", more).map((r) => r.symbol)).not.toContain("000660");
    expect(rankSymbols("eth", more).map((r) => r.symbol)).toContain("ETH-USD");
  });
  it("asked for as crypto, it lists", () => {
    expect(rankSymbols("005930 crypto", rows).map((r) => r.symbol)).toContain("005930-USD");
    expect(rankSymbols("005930-usd", rows).map((r) => r.symbol)).toContain("005930-USD");
  });
});

describe("L6 a lot bought in the session moves from its cost (r6 newcomer m5: '+$20 today' beside '$0 all time')", () => {
  const now = new Date();
  const nyToday = ymdIn(now, "America/New_York");
  const nvda = row({ holding_id: "hn", symbol: "NVDA", name: "NVIDIA", qty: 40, price: 225.07, change_pct: 0.22, value: 9002.8, cost_basis: 9002.8, total_gl: 0, as_of: now.toISOString() });
  it("all of it bought today at today's price: no day move", () => {
    const [r] = withSameDayLots([nvda], [{ holding_id: "hn", qty: 40, cost_per_share: 225.07, acquired_on: nyToday }], now);
    expect(rowDayChange(r)).toBeCloseTo(0, 6);
    expect(dayGroups([r], "USD", { USD: 1 }, now)[0].day).toBeCloseTo(0, 6);
  });
  it("part of it: the older shares move from the prior close, the new ones from their cost", () => {
    const r50 = { ...nvda, qty: 50, value: 50 * 225.07 };
    const [r] = withSameDayLots([r50], [{ holding_id: "hn", qty: 10, cost_per_share: 224, acquired_on: nyToday }], now);
    const prior = 225.07 / 1.0022;
    expect(rowDayChange(r)).toBeCloseTo(40 * (225.07 - prior) + 10 * (225.07 - 224), 6);
  });
  it("a KRX lot bought at Wednesday's close, seen on Friday's holiday: no move for Wednesday", () => {
    const sam = row({ holding_id: "hs", symbol: "005930.KS", currency: "KRW", qty: 10, price: 285_500, change_pct: 1.5, value: 2_855_000, as_of: "2026-09-23T06:30:00Z" });
    const [r] = withSameDayLots([sam], [{ holding_id: "hs", qty: 10, cost_per_share: 285_500, acquired_on: "2026-09-23" }], new Date("2026-09-25T21:43:00Z"));
    expect(rowDayChange(r)).toBe(0);
  });
  it("older lots and other holdings leave the row as it is", () => {
    const rows = [nvda];
    expect(withSameDayLots(rows, [{ holding_id: "hn", qty: 5, cost_per_share: 100, acquired_on: "2020-01-02" }], now)[0]).toBe(nvda);
    expect(withSameDayLots(rows, [{ holding_id: "other", qty: 5, cost_per_share: 100, acquired_on: nyToday }], now)[0]).toBe(nvda);
  });
  it("Home shows no '+$20 today' for a position bought today at today's price", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([nvda]),
      getRecentLots: vi.fn().mockResolvedValue([{ holding_id: "hn", qty: 40, cost_per_share: 225.07, acquired_on: nyToday }]) } as Partial<Api>);
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    await waitFor(() => expect(api.getRecentLots).toHaveBeenCalled());
    await waitFor(() => expect(card.textContent).not.toMatch(/\+\$20/));
  });
});

describe("L7 a slow book refresh is not a failure (r6 designer m-1)", () => {
  // a PostgREST double that records whether reads went out on the fail-fast path
  function builderSb() {
    const seen = { retry: [] as boolean[] };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "neq", "limit"]) q[m] = () => q;
    q.retry = (on: boolean) => { seen.retry.push(on); return q; };
    q.abortSignal = () => q;
    q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return { sb: { from: () => q } as unknown as SupabaseClient, seen };
  }
  it("a reply at 9s paints, with 'Updating prices…' before it and no red banner, and reads keep their retries", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const late = row({ value: 5000, price: 208.33 });
    const getPortfolio = vi.fn()
      .mockImplementationOnce(() => new Promise((res) => setTimeout(() => res([late]), 9000)))
      .mockResolvedValue([late]);
    render(<App api={stubApi({ getPortfolio })} />);
    await waitFor(() => expect(getPortfolio).toHaveBeenCalled());   // the refresh has started: its clock runs from here
    await act(async () => { await vi.advanceTimersByTimeAsync(8_500); });
    expect(screen.queryByTestId("prices-error")).toBeNull();
    expect(screen.getByTestId("prices-slow").textContent).toBe("Updating prices…");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByTestId("net-worth").textContent).toBe("$5,000");
    expect(screen.queryByTestId("prices-slow")).toBeNull();
    expect(screen.queryByTestId("prices-error")).toBeNull();
    const { sb, seen } = builderSb();
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([]);
  });
  it("no answer at all counts as failed at 30s, without putting the reads on the fail-fast path", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getPortfolio = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockReturnValue(new Promise(() => {}));
    render(<App api={stubApi({ getPortfolio })} />);
    await waitFor(() => expect(getPortfolio).toHaveBeenCalled());   // the refresh has started: its clock runs from here
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(screen.queryByTestId("prices-error")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(screen.getByTestId("prices-error")).toBeTruthy();
    const { sb, seen } = builderSb();
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([]);
  });
});

describe("L8 the book-changed calls outlive the page (r6 power-user m7)", () => {
  it("brokerage-connected POSTs go out with keepalive; nothing else changes", () => {
    const fn = "https://x.supabase.co/functions/v1/brokerage-connected";
    expect(keepaliveInit(fn, { method: "POST", body: "{}" })).toMatchObject({ keepalive: true, body: "{}" });
    expect(keepaliveInit(new URL(fn), { method: "post" })).toMatchObject({ keepalive: true });
    const ask = { method: "POST", body: "{}" };
    expect(keepaliveInit("https://x.supabase.co/functions/v1/ask", ask)).toBe(ask);
    expect(keepaliveInit(fn, undefined)).toBeUndefined();
  });
});
