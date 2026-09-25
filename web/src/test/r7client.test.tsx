// Round-7 polish (1.0.1), client side: the early-access "import is at capacity" answer reads as a calm note, the
// slow-refresh line never moves the total, the brief card reloads in place and the brief watcher announces a
// brief once, a same-day lot's row % matches its $, and a sign-in whose first reads miss the user holds the
// skeleton instead of painting an empty Home. Same harness as fix6.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "../App";
import { IMPORT_FULL_MSG, ImportFullError, makeApi, type Api, type DailyBrief } from "../lib/api";
import { rowDayPct } from "../lib/portfolio";
import { setPricesDown } from "../lib/net";
import { profile, row, stubApi } from "./fixtures";

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

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  setPricesDown(false);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPricesDown(false); });

const tabs = () => within(screen.getByRole("navigation", { name: "Tabs" }));
const fullApi = (over: Partial<Api> = {}) => stubApi({
  snaptrade: vi.fn().mockImplementation(async (action: string) => {
    if (action === "connect") throw new ImportFullError();
    return { ok: true, connected: false };
  }),
  ...over,
});
const expectCalmNote = (el: HTMLElement) => {
  expect(el.textContent).toBe(IMPORT_FULL_MSG);
  expect(el.className).toBe("info-note");
  expect(el.getAttribute("role")).toBe("status");
  expect(screen.queryByRole("alert")).toBeNull();
};

describe("n-1 early access: brokerage import at capacity", () => {
  it("the api turns the server's {full:true} into ImportFullError with the client's own words", async () => {
    const sb = { functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: false, full: true, error: "Brokerage import is full during early access." }, error: null }) } };
    const err = await makeApi(sb as unknown as SupabaseClient).snaptrade("connect").catch((e) => e);
    expect(err).toBeInstanceOf(ImportFullError);
    expect(err.message).toBe(IMPORT_FULL_MSG);
    expect(IMPORT_FULL_MSG).not.toMatch(/is full|—/);
  });
  it("Settings: a neutral note, not the red error", async () => {
    render(<App api={fullApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Connect brokerage" }));
    expectCalmNote(await screen.findByTestId("settings-connect-error"));
  });
  it("Add: the note sits under the Import card with its gutter, not flush inside it", async () => {
    render(<App api={fullApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByTestId("snaptrade-import"));
    const note = await screen.findByTestId("add-connect-note");
    expectCalmNote(note);
    expect(note.closest(".card")).toBeNull();
  });
  it("Home Import chip: a neutral note", async () => {
    render(<App api={fullApi()} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Import from brokerage" }));
    expectCalmNote(await screen.findByTestId("connect-error"));
  });
  it("Onboarding: a neutral note right under Connect", async () => {
    render(<App api={fullApi({ getProfile: vi.fn().mockResolvedValue({ ...profile, onboarded_at: null }), getPortfolio: vi.fn().mockResolvedValue([]) })} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await userEvent.click(await screen.findByTestId("ob-connect"));
    expectCalmNote(await screen.findByTestId("ob-connect-note"));
  });
  it("a real failure keeps the error style", async () => {
    render(<App api={stubApi({ snaptrade: vi.fn().mockImplementation(async (a: string) => { if (a === "connect") throw new Error("Brokerage link is unavailable right now."); return { ok: true, connected: false }; }) })} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Import from brokerage" }));
    const note = await screen.findByTestId("connect-error");
    expect(note.className).toBe("error-note");
    expect(note.getAttribute("role")).toBe("alert");
  });
});

describe("n-2 the slow-refresh line never moves the total", () => {
  it("shows in the header row, not in the page above the hero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getPortfolio = vi.fn()
      .mockResolvedValueOnce([row({})])
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue([row({})]);
    render(<App api={stubApi({ getPortfolio })} />);
    await screen.findByTestId("net-worth");
    window.dispatchEvent(new Event("online"));   // a refresh that hangs
    await act(async () => { await vi.advanceTimersByTimeAsync(8_500); });
    const slow = screen.getByTestId("prices-slow");
    expect(slow.textContent).toBe("Updating prices…");
    expect(slow.closest(".topbar")).not.toBeNull();
    expect(slow.closest("main")).toBeNull();
  });
});

describe("n-3 / n-4 the brief card and its watcher", () => {
  const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  const brief = (edition: DailyBrief["edition"], lede: string, genAt: string): DailyBrief =>
    ({ brief_date: genAt.slice(0, 10), edition, generated_at: genAt, sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: genAt, day_sign: 1, held: ["RDDT"] } });

  it("reconnecting reloads the card in place: the same card stays up (no remount, no fade)", async () => {
    const getDailyBriefs = vi.fn().mockResolvedValue([brief("morning", "Reddit led the open.", at(30))]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    const card = await screen.findByTestId("brief-card");
    const calls = getDailyBriefs.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(getDailyBriefs.mock.calls.length).toBeGreaterThan(calls));
    expect(screen.getByTestId("brief-card")).toBe(card);
  });

  it("a brief that lands off Home is announced once; a dismissed banner stays dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = brief("morning", "Reddit led the open.", at(60));
    const getDailyBriefs = vi.fn().mockResolvedValue([first]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    await screen.findByTestId("brief-card");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await userEvent.click(tabs().getByRole("button", { name: /news/i }));
    getDailyBriefs.mockResolvedValue([first, brief("midday", "Midday: Reddit held.", at(1))]);
    // several watcher ticks while the user is elsewhere
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    await userEvent.click(tabs().getByRole("button", { name: /home/i }));
    await userEvent.click(within(await screen.findByTestId("brief-banner")).getByRole("button", { name: "Dismiss" }));
    const reads = getDailyBriefs.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(screen.queryByTestId("brief-banner")).toBeNull();
    // only the watcher's own polls read again: the card was not reloaded tick after tick
    expect(getDailyBriefs.mock.calls.length - reads).toBeLessThanOrEqual(3);
  });
});

describe("power-user m2: a row's % and $ agree when a lot was bought today", () => {
  it("the % is the $ over what the position was worth coming into the day", () => {
    // NVDA: 40 held from before at a 224.58 prior close, 10 bought today at $200, now 225.07 (value 11,253.50)
    const day = 40 * (225.07 - 224.58) + 10 * (225.07 - 200);
    const pct = rowDayPct({ value: 50 * 225.07, change_pct: 0.218, day_change: day })!;
    expect(day).toBeCloseTo(270.3, 1);
    expect(pct).toBeCloseTo((day / (50 * 225.07 - day)) * 100, 6);
    expect(pct).toBeGreaterThan(2.4);
  });
  it("a lot bought entirely today at the current price is 0, so it renders neutral", () => {
    expect(rowDayPct({ value: 878.1, change_pct: -0.33, day_change: 0 })).toBe(0);
  });
  it("no same-day lot: the price move, unchanged", () => {
    expect(rowDayPct({ value: 4800, change_pct: 5.26 })).toBe(5.26);
  });
  it("Home paints the matching pair, and $0 without the red", async () => {
    const nvda = row({ holding_id: "n", symbol: "NVDA", name: "NVIDIA", qty: 50, price: 225.07, value: 50 * 225.07, change_pct: 0.218 });
    const ko = row({ holding_id: "k", symbol: "KO", name: "Coca-Cola", qty: 10, price: 87.81, value: 878.1, change_pct: -0.33 });
    const getRecentLots = vi.fn().mockResolvedValue([
      { holding_id: "n", qty: 10, cost_per_share: 200, acquired_on: "2999-01-01" },
      { holding_id: "k", qty: 10, cost_per_share: 87.81, acquired_on: "2999-01-01" },
    ]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([nvda, ko]), getRecentLots })} />);
    const card = await screen.findByTestId("positions-card");
    await waitFor(() => expect(card.textContent).toMatch(/\+2\.\d\d% \(\+\$27\d\)/));
    const koLine = [...card.querySelectorAll("span.num.sub")].find((el) => /\(\$0\)/.test(el.textContent ?? ""));
    expect(koLine).toBeTruthy();
    expect(koLine!.className).not.toMatch(/\bloss\b/);
    expect(koLine!.textContent).not.toMatch(/−/);
  });
});

describe("power-user m5: a sign-in whose first reads miss the user never paints an empty Home", () => {
  it("holds the skeleton, reads again, then paints the book", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getProfile = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(profile);
    const getPortfolio = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([row({})]);
    render(<App api={stubApi({ getProfile, getPortfolio })} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(document.body.textContent).not.toMatch(/Nothing here yet/);
    expect(screen.getByTestId("home-loading")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(await screen.findByTestId("net-worth")).toBeTruthy();
    expect(getProfile.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("still no profile after a few tries: says the refresh failed instead of spinning forever", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getProfile = vi.fn().mockResolvedValue(null);
    render(<App api={stubApi({ getProfile, getPortfolio: vi.fn().mockResolvedValue([]) })} />);
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(await screen.findByTestId("prices-error")).toBeTruthy();
  });
});
