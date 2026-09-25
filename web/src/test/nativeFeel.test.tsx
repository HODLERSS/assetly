// Native-feel behaviour that lives in the web layer, so it works the same in the iOS app and the PWA:
// pull to refresh, edge swipe back, refresh on return to the foreground, news in the in-app browser,
// the keyboard shell, and the Dynamic Type clamp.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/supabase", () => {
  const session = { user: { id: "u-feel" } };
  return {
    supabase: { auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    } },
    completeNativeAuth: vi.fn().mockResolvedValue({ error: null }),
  };
});
const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../lib/native", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/native")>()), openExternal }));

import { App } from "../App";
import type { Api, PortfolioRow, Profile } from "../lib/api";
import { PullToRefresh, PTR_THRESHOLD, rubberBand } from "../components/PullToRefresh";
import { clampTextScale, installKeyboard, keyboardOpen } from "../lib/shell";

const profile: Profile = { id: "u-feel", display_name: "Demo", base_currency: "USD", display_us: "USD", display_kr: "KRW", markets: ["US"], onboarded_at: "2026-08-23T00:00:00Z" };
const rowA: PortfolioRow = {
  holding_id: "h1", symbol: "RDDT", account: "brokerage", nickname: "", name: "Reddit", currency: "USD", kind: "equity",
  qty: 24, cost_basis: 4021, avg_cost: 167.54, price: 200, change_pct: 5.26, as_of: new Date().toISOString(), value: 4800, total_gl: 779,
} as PortfolioRow;

// Every Api method resolves to something harmless unless named here.
function stubApi(over: Record<string, unknown> = {}): Api {
  const known: Record<string, unknown> = {
    getProfile: profile, getPortfolio: [rowA], getFxRates: { USD: 1 }, getDailyBriefs: [], getNews: [
      { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() },
    ], snaptradeEvents: [], getLots: [], getHistory: [], getPulse: [], ...over,
  };
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy({}, { get: (_t, k: string | symbol) => {
    if (typeof k !== "string" || k === "then") return undefined;   // not a thenable
    if (!fns.has(k)) fns.set(k, vi.fn().mockResolvedValue(k in known ? known[k] : null));
    return fns.get(k);
  } }) as Api;
}

type Pt = { x: number; y: number };
const touch = (type: string, p: Pt | null, target: EventTarget = document.body) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = p ? [{ clientX: p.x, clientY: p.y, identifier: 1, target }] : [];
  Object.defineProperty(e, "touches", { value: list });
  target.dispatchEvent(e);
  return e;
};
const drag = (from: Pt, to: Pt, steps = 6, target: EventTarget = document.body) => {
  touch("touchstart", from, target);
  let last: Event | null = null;
  for (let i = 1; i <= steps; i++) {
    last = touch("touchmove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, target);
  }
  touch("touchend", null, target);
  return last!;
};

let matchMediaImpl: (q: string) => boolean = () => false;
beforeEach(() => {
  matchMediaImpl = () => false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: matchMediaImpl(q), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  openExternal.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.className = ""; });

describe("pull to refresh", () => {
  it("rubber-bands: follows the finger at first, then stiffens and never passes its limit", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(40)).toBeGreaterThan(18);
    expect(rubberBand(400) - rubberBand(300)).toBeLessThan(rubberBand(100) - rubberBand(0));
    expect(rubberBand(10_000)).toBeLessThan(200);
  });

  it("a pull past the threshold refreshes once; a short pull, a sideways drag or an upward one does not", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    drag({ x: 100, y: 200 }, { x: 100, y: 240 });                       // visible pull < threshold
    drag({ x: 100, y: 200 }, { x: 300, y: 260 });                       // mostly sideways
    drag({ x: 100, y: 400 }, { x: 100, y: 100 });                       // scrolling up
    expect(onRefresh).not.toHaveBeenCalled();
    let dist = 0; while (rubberBand(dist) < PTR_THRESHOLD + 4) dist += 10;
    const move = drag({ x: 100, y: 200 }, { x: 100, y: 200 + dist });
    expect(move.defaultPrevented).toBe(true);                            // the page neither scrolls nor bounces under it
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("does nothing once the page is scrolled", () => {
    const onRefresh = vi.fn();
    Object.defineProperty(document.documentElement, "scrollTop", { value: 300, configurable: true });
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    drag({ x: 100, y: 200 }, { x: 100, y: 700 });
    expect(onRefresh).not.toHaveBeenCalled();
    Object.defineProperty(document.documentElement, "scrollTop", { value: 0, configurable: true });
  });

  it("Home: pulling reloads the book", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await waitFor(() => expect(api.getPortfolio).toHaveBeenCalledTimes(1));
    drag({ x: 150, y: 200 }, { x: 150, y: 600 });
    await waitFor(() => expect(api.getPortfolio).toHaveBeenCalledTimes(2));
  });
});

describe("returning to the foreground", () => {
  it("reloads a book older than 30s, and leaves a fresh one alone", async () => {
    const api = stubApi();
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await waitFor(() => expect(api.getPortfolio).toHaveBeenCalledTimes(1));
    const visible = () => document.dispatchEvent(new Event("visibilitychange"));
    now += 10_000; visible();
    expect(api.getPortfolio).toHaveBeenCalledTimes(1);
    now += 25_000; visible();
    await waitFor(() => expect(api.getPortfolio).toHaveBeenCalledTimes(2));
    clock.mockRestore();
  });
});

describe("edge swipe back", () => {
  const openPosition = async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getAllByRole("button", { name: /Reddit/ })[0]);
    await waitFor(() => expect(screen.queryByTestId("net-worth")).toBeNull());   // Position detail is up
    return api;
  };

  it("in the app, a drag from the left edge pops a pushed screen", async () => {
    matchMediaImpl = (q) => q.includes("standalone");                    // installed PWA (the iOS app is the same path)
    await openPosition();
    expect(screen.queryByTestId("net-worth")).toBeNull();
    drag({ x: 6, y: 400 }, { x: 260, y: 410 });
    await screen.findByTestId("net-worth");
  });

  it("ignores drags that start away from the edge (the chart scrub keeps them) and short ones", async () => {
    matchMediaImpl = (q) => q.includes("standalone");
    await openPosition();
    drag({ x: 60, y: 400 }, { x: 330, y: 400 });
    drag({ x: 6, y: 400 }, { x: 40, y: 400 }, 2);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(screen.queryByTestId("net-worth")).toBeNull();
  });

  it("stays off in a browser tab, where Safari's own edge swipe is history navigation", async () => {
    await openPosition();
    drag({ x: 6, y: 400 }, { x: 300, y: 400 });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(screen.queryByTestId("net-worth")).toBeNull();
  });
});

describe("news", () => {
  it("a headline opens in the in-app browser, never by navigating the app away", async () => {
    const api = stubApi();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: "News" }));
    await userEvent.click(await screen.findByText("Reddit posts strong quarter"));
    expect(openExternal).toHaveBeenCalledWith("https://ex.test/1");
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("keyboard shell (browser, touch device)", () => {
  it("marks the keyboard open while a text field has focus, and a drag elsewhere dismisses it", async () => {
    matchMediaImpl = (q) => q.includes("coarse");
    const off = installKeyboard();
    const input = document.createElement("input");
    const list = document.createElement("div");
    document.body.append(input, list);
    input.focus();
    expect(keyboardOpen()).toBe(true);
    drag({ x: 100, y: 300 }, { x: 100, y: 260 }, 3, list);
    expect(document.activeElement).not.toBe(input);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(keyboardOpen()).toBe(false);
    off(); input.remove(); list.remove();
  });

  it("clears when the focused field is removed (sign-in giving way to Home fires no focusout)", async () => {
    matchMediaImpl = (q) => q.includes("coarse");
    const off = installKeyboard();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(keyboardOpen()).toBe(true);
    input.remove();
    await waitFor(() => expect(keyboardOpen()).toBe(false), { timeout: 1500 });
    off();
  });

  it("a desktop pointer never marks it", () => {
    const off = installKeyboard();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(keyboardOpen()).toBe(false);
    off(); input.remove();
  });
});

describe("Dynamic Type clamp", () => {
  it("follows the iOS text size within the range the layout holds", () => {
    expect(clampTextScale(1)).toBe(1);
    expect(clampTextScale(1.24)).toBe(1.24);
    expect(clampTextScale(3.1)).toBe(1.4);                               // largest accessibility size
    expect(clampTextScale(0.82)).toBe(0.9);                              // extra small
    expect(clampTextScale(Number.NaN)).toBe(1);
  });
});
