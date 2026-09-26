// r11 server asks: feed titles cleaned as the server cleans them (parity with _shared/intel.ts cleanHeadline and
// sourceName), deduped by the cleaned title; and the client's polling cut down (lib/poll: hidden pages don't
// poll, errors back off, nothing faster than 60s unless something is expected).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { App } from "../App";
import { InsightsCard } from "../components/InsightsCard";
import type { Api, DailyBrief, NewsItem } from "../lib/api";
import { cleanFeedTitle, dedupeNews, sourceName } from "../lib/news";
import { MIN_BACKGROUND_MS, startPoll } from "../lib/poll";
import { setPricesDown } from "../lib/net";
import { stubApi } from "./fixtures";

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

let hidden = false;
beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  setPricesDown(false);
  hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
});
afterEach(() => { vi.useRealTimers(); setPricesDown(false); hidden = false; });

describe("7 feed titles as the server cleans them", () => {
  it("feed labels, ticker parentheticals and publisher suffixes go; dashes and a trailing '…' too", () => {
    expect(cleanFeedTitle("Stock Market Today: Apple ships the M5 Mac Studio (AAPL) | Closing Bell")).toBe("Apple ships the M5 Mac Studio");
    expect(cleanFeedTitle("Nvidia rallies on data-center demand - Yahoo Finance")).toBe("Nvidia rallies on data-center demand");
    expect(cleanFeedTitle("Microsoft lifts its dividend (NASDAQ:MSFT) By Investing.com")).toBe("Microsoft lifts its dividend");
    expect(cleanFeedTitle("Meta slides — the week’s worst…")).toBe("Meta slides: the week's worst");
    expect(cleanFeedTitle("AT&amp;T beats")).toBe("AT&T beats");
  });
  it("outlet domains read as names", () => {
    expect(sourceName("foxbusiness.com")).toBe("Fox Business");
    expect(sourceName("qz.com")).toBe("Quartz");
    expect(sourceName("some-outlet.com")).toBe("Some Outlet");
    expect(sourceName("Reuters")).toBe("Reuters");
  });
  it("two copies that differ only by a label or suffix are one story", () => {
    const a: NewsItem = { id: "1", symbol: "AAPL", title: "Stock Market Today: Apple ships the M5 Mac Studio", url: "https://a.test/1", source: "Yahoo Finance", published_at: null };
    const b: NewsItem = { id: "2", symbol: "AAPL", title: "Apple ships the M5 Mac Studio | Closing Bell", url: "https://b.test/2", source: "Yahoo Finance", published_at: null };
    const out = dedupeNews([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Apple ships the M5 Mac Studio");
  });
});

describe("8 polling: hidden pages don't poll, errors back off, idle periods are at least 60s", () => {
  it("startPoll skips while hidden, resumes at once when visible, and doubles its wait after a failure", async () => {
    vi.useFakeTimers();
    let ok = true;
    const tick = vi.fn(async () => ok);
    const stop = startPoll(tick, () => 1_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(tick).toHaveBeenCalledTimes(1);
    hidden = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(tick).toHaveBeenCalledTimes(1);   // the due tick found the page hidden and waited
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(tick).toHaveBeenCalledTimes(2);
    ok = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });   // fails
    expect(tick).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });   // backing off: not yet
    expect(tick).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(tick).toHaveBeenCalledTimes(4);
    stop();
  });
  it("an established reader with nothing expected: the brief watcher reads once a minute, not every 20s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = new Date(Date.now() - 3600_000).toISOString();
    const close: DailyBrief = { brief_date: at.slice(0, 10), edition: "close", generated_at: at, audio_path: "u/close.mp3", script: "s",
      sections: { lede: "Close.", overnight: "", positions: [], desk_view: "", calendar: [], as_of: at, day_sign: 1, held: ["RDDT"] } };
    const getDailyBriefs = vi.fn().mockResolvedValue([close]);
    const getPortfolioInsights = vi.fn().mockResolvedValue(null);
    render(<App api={stubApi({ getDailyBriefs, getPortfolioInsights })} />);
    await screen.findByTestId("brief-card");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const b0 = getDailyBriefs.mock.calls.length, i0 = getPortfolioInsights.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(MIN_BACKGROUND_MS - 5_000); });
    expect(getDailyBriefs.mock.calls.length - b0).toBe(0);
    expect(getPortfolioInsights.mock.calls.length - i0).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getDailyBriefs.mock.calls.length - b0).toBe(1);
    // hidden: nothing at all for several minutes
    hidden = true;
    const b1 = getDailyBriefs.mock.calls.length, i1 = getPortfolioInsights.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(getDailyBriefs.mock.calls.length).toBe(b1);
    expect(getPortfolioInsights.mock.calls.length).toBe(i1);
  });
  it("a card with no insights yet backs off (2s, 4s, 8s, 16s…) instead of every 2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getInsights = vi.fn().mockResolvedValue(null);
    render(<InsightsCard api={{ getInsights } as unknown as Api} symbol="ZZZZ" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    // 0, 2, 6, 14, 30s: five looks in 31s (every 2s would have been 15)
    expect(getInsights.mock.calls.length).toBeLessThanOrEqual(5);
    expect(getInsights.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
