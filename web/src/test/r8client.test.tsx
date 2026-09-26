// Round-8 polish (1.0.1), client side: a longer chart range's H/L never sit inside a shorter one's, Movers rank
// by the % they print, a failed first load never offers "Nothing here yet", market times carry ET, a stale read
// never paints over a write, and the font URLs match what the build serves. Same harness as r7client.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { App } from "../App";
import { PriceChart } from "../components/PriceChart";
import type { Api, HistoryPoint, Lot } from "../lib/api";
import { setPricesDown } from "../lib/net";
import { asOfClock } from "../screens/Home";
import { bumpMutation, guardWrites, mutatedSince, mutationMark } from "../lib/mutations";
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

const num = (s: string | null) => Number((s ?? "").replace(/[^\d.]/g, ""));

describe("1 a coin's longer range never has a narrower H/L than its week", () => {
  it("1M folds in the hourly week: its H is at least 1W's hourly H, its L at most 1W's L", async () => {
    const now = Date.now();
    const pts: HistoryPoint[] = [];
    for (let h = 40 * 24; h >= 1; h--) pts.push({ ts: new Date(now - h * 3600e3).toISOString(), price: 80_000 + (40 * 24 - h) * 0.5 });
    pts[pts.length - 60] = { ...pts[pts.length - 60], price: 90_000 };   // an hourly spike, never a day's last print
    pts[pts.length - 90] = { ...pts[pts.length - 90], price: 70_000 };   // and an hourly dip
    const live = 80_600, liveAt = new Date(now).toISOString();
    const api = { getHistory: vi.fn().mockResolvedValue(pts) } as unknown as Api;
    render(<PriceChart api={api} symbol="BTC-USD" currency="USD" livePrice={live} liveAsOf={liveAt} crypto />);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $90,000.00"));
    const wkLow = num(screen.getByTestId("range-low").textContent);
    expect(wkLow).toBe(70_000);
    await userEvent.click(screen.getByRole("tab", { name: "1M" }));
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $90,000.00"));
    expect(num(screen.getByTestId("range-low").textContent)).toBeLessThanOrEqual(wkLow);
  });
});

describe("2 Movers rank by the % they print", () => {
  it("a same-day lot's +2.46% outranks a -1.54% price move", async () => {
    const nvda = row({ holding_id: "n", symbol: "NVDA", name: "NVIDIA", qty: 50, price: 225.07, value: 50 * 225.07, change_pct: 0.218 });
    const rows = [
      nvda,
      row({ holding_id: "t", symbol: "TSLA", name: "Tesla", change_pct: -1.54, value: 5000 }),
      row({ holding_id: "a", symbol: "AAPL", name: "Apple", change_pct: 0.9, value: 5000 }),
      row({ holding_id: "m", symbol: "MSFT", name: "Microsoft", change_pct: -0.8, value: 5000 }),
    ];
    const getRecentLots = vi.fn().mockResolvedValue([{ holding_id: "n", qty: 10, cost_per_share: 200, acquired_on: "2999-01-01" }]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows), getRecentLots })} />);
    const movers = await screen.findByTestId("movers-card");
    await waitFor(() => expect(movers.textContent).toMatch(/NVDA/));
    const order = [...movers.querySelectorAll(".sym")].map((e) => e.textContent);
    expect(order[0]).toBe("NVDA");
  });
});

describe("3 a failed first load never shows the empty-book call to action", () => {
  it("auth misses that give up: the portfolio error with Retry, no 'Nothing here yet'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getProfile = vi.fn().mockResolvedValue(null);
    const api = stubApi({ getProfile, getPortfolio: vi.fn().mockResolvedValue([]) });
    render(<App api={api} />);
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const err = await screen.findByTestId("prices-error");
    expect(err.textContent).toMatch(/^Couldn't load your portfolio\. ?Retry$/);
    expect(document.body.textContent).not.toMatch(/Nothing here yet/);
    expect(screen.queryByRole("button", { name: /connect your brokerage/i })).toBeNull();
    expect(screen.getByTestId("home-load-failed")).toBeTruthy();
    // Retry recovers
    getProfile.mockResolvedValue(profile);
    (api.getPortfolio as ReturnType<typeof vi.fn>).mockResolvedValue([row({})]);
    await userEvent.click(within(err).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("net-worth")).toBeTruthy();
  });
});

describe("4 market times read in ET", () => {
  it("'as of' names the zone and uses New York time", () => {
    expect(asOfClock("2026-09-25T20:00:00Z")).toBe("4:00 PM ET");
    expect(asOfClock("2026-01-15T21:05:00Z")).toBe("4:05 PM ET");
  });
});

describe("5 / 6 narrow widths, large text, dark sign-in", () => {
  const client = readFileSync(`${process.cwd()}/src/client.css`, "utf8");
  const theme = readFileSync(`${process.cwd()}/src/theme.css`, "utf8");
  it("320: row names wrap; AX5: the hero sizes to the screen; the Positions header wraps its chips", () => {
    expect(client).toMatch(/@media \(max-width: 340px\) \{\s*\.row > span:first-child:has\(> \.sym\) \{ white-space: normal;/);
    expect(client).toMatch(/\.text-large \.net \{ font-size: min\(38px, 7vw\);/);
  });
  it("the Add Import subtitle is short enough for 320", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    expect((await screen.findByTestId("snaptrade-import")).textContent).toMatch(/Read-only brokerage link/);
  });
  it("dark: GitHub and email outline buttons take Google's fill", () => {
    expect(theme).toMatch(/:root\[data-theme="dark"\] \.auth-screen \.btn\.secondary \{ background: #131314; \}/);
    expect(theme).toMatch(/:root:not\(\[data-theme="light"\]\) \.auth-screen \.btn\.secondary \{ background: #131314; \}/);
  });
});

describe("7 font URLs match the files the build serves", () => {
  it("every @font-face and the preload point at a file in public/fonts, root-relative so Vite applies the base", () => {
    const theme = readFileSync(`${process.cwd()}/src/theme.css`, "utf8");
    const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
    const urls = [...theme.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    const preloads = [...html.matchAll(/rel="preload" href="([^"]+\.woff2)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(preloads.length).toBe(1);
    for (const u of [...urls, ...preloads]) {
      expect(u.startsWith("/fonts/")).toBe(true);
      expect(existsSync(`${process.cwd()}/public${u}`)).toBe(true);
    }
    expect(urls).toContain(preloads[0]);
  });
});

describe("8 a read that started before a write never paints over it", () => {
  it("the counter: writes through the guarded api mark earlier reads stale", async () => {
    const api = guardWrites(stubApi());
    const mark = mutationMark();
    expect(mutatedSince(mark)).toBe(false);
    await api.getPortfolio();
    expect(mutatedSince(mark)).toBe(false);   // reads don't count
    await api.deleteLot("l1");
    expect(mutatedSince(mark)).toBe(true);
    expect(guardWrites(api)).toBe(guardWrites(api));
  });
  it("Home: a slow poll that answers after a removal does not bring the position back", async () => {
    const kept = row({ holding_id: "h1", symbol: "RDDT" });
    const gone = row({ holding_id: "h2", symbol: "KO", name: "Coca-Cola", value: 900 });
    let answerStale!: (v: typeof kept[]) => void;
    const getPortfolio = vi.fn()
      .mockResolvedValueOnce([kept, gone])                                   // first paint
      .mockImplementationOnce(() => new Promise((r) => { answerStale = r; })) // a poll that hangs across the delete
      .mockResolvedValue([kept]);                                             // after the removal
    const api = stubApi({ getPortfolio });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    await within(card).findByText("KO");
    act(() => { window.dispatchEvent(new Event("online")); });   // starts the poll that will hang
    await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
    await userEvent.click(within(card).getByText("KO").closest("button")!);
    await userEvent.click(await screen.findByRole("button", { name: /remove/i }));
    const confirm = screen.queryAllByRole("button", { name: /remove/i }).at(-1);
    if (confirm) await userEvent.click(confirm);
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("KO")).toBeNull());
    await act(async () => { answerStale([kept, gone]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText("KO")).toBeNull();
  });
  it("Position: a lot read from before a delete does not bring the lot back", async () => {
    bumpMutation();
    const lotA: Lot = { id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: "2026-07-22", note: null };
    const lotB: Lot = { id: "l2", holding_id: "h1", qty: 14, cost_per_share: 168.2, acquired_on: "2026-08-02", note: null };
    let answerStale!: (v: Lot[]) => void;
    const getLots = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { answerStale = r; }))
      .mockResolvedValue([lotA]);
    const api = stubApi({ getLots });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    await userEvent.click(within(card).getByText("RDDT").closest("button")!);
    await waitFor(() => expect(getLots).toHaveBeenCalledTimes(1));
    // a delete goes out while the first read hangs; its reload answers with one lot
    await act(async () => { await guardWrites(api).deleteLot("l2"); });
    await act(async () => { answerStale([lotA, lotB]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.body.textContent).not.toMatch(/Aug 2, 2026/);
  });
});

describe("10 an older edition picked while its narration is on the way", () => {
  it("gets its ▶ in place, without leaving Home", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const mk = (edition: "morning" | "midday", lede: string, g: string, audio: string | null) =>
      ({ brief_date: g.slice(0, 10), edition, generated_at: g, audio_path: audio,
         sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: g, day_sign: 1, held: ["RDDT"] } });
    const mAt = at(20), dAt = at(5);
    const getDailyBriefs = vi.fn().mockResolvedValue([mk("morning", "Morning.", mAt, null), mk("midday", "Midday.", dAt, "u/midday.mp3")]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    const card = await screen.findByTestId("brief-card");
    await userEvent.click(within(card).getByRole("button", { name: "Morning" }));
    expect(within(card).queryByTestId("brief-listen")).toBeNull();
    getDailyBriefs.mockResolvedValue([mk("morning", "Morning.", mAt, "u/morning.mp3"), mk("midday", "Midday.", dAt, "u/midday.mp3")]);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await waitFor(() => expect(within(screen.getByTestId("brief-card")).getByTestId("brief-listen")).toBeTruthy());
    expect(within(screen.getByTestId("brief-card")).getByTestId("brief-lede").textContent).toBe("Morning.");
  });
});

describe("11 a position bought in full today is not a mover", () => {
  it("KO at 0.00% ($0) stays out of Movers", async () => {
    const rows = [
      row({ holding_id: "k", symbol: "KO", name: "Coca-Cola", qty: 10, price: 87.81, value: 878.1, change_pct: -3.3 }),
      row({ holding_id: "t", symbol: "TSLA", name: "Tesla", change_pct: -1.54, value: 5000 }),
      row({ holding_id: "a", symbol: "AAPL", name: "Apple", change_pct: 0.9, value: 5000 }),
    ];
    const getRecentLots = vi.fn().mockResolvedValue([{ holding_id: "k", qty: 10, cost_per_share: 87.81, acquired_on: "2999-01-01" }]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows), getRecentLots })} />);
    const movers = await screen.findByTestId("movers-card");
    await waitFor(() => expect(movers.textContent).toMatch(/TSLA/));
    expect(movers.textContent).not.toMatch(/KO/);
  });
});

describe("12 the all-time % is on invested cost, not cash", () => {
  it("cash is in the net worth but not in the all-time base", async () => {
    const rows = [
      row({}),   // RDDT: value 4,800, cost 4,021, +779
      row({ holding_id: "c", symbol: "$CASH", name: "Cash (USD)", kind: "cash", qty: 5000, price: 1, value: 5000, cost_basis: 5000, avg_cost: 1, total_gl: 0, change_pct: null }),
    ];
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows) })} />);
    expect((await screen.findByTestId("net-worth")).textContent).toBe("$9,800");
    expect(screen.getByTestId("total-gl").textContent).toBe("All time +$779 (+19.37%)");
  });
});
