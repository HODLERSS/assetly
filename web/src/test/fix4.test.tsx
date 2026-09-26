// Round-4 launch fixes (1.0.1), client side: a failed lots read is an error with Retry (never "No lots yet."),
// a brief about a different set of holdings is not shown, plus the power-user / newcomer / native minors.
// Charts are in chartRange.test.tsx and api-history-long.test.ts. Same harness as fix3.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
vi.mock("../lib/markets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/markets")>();
  return { ...real, isMarketOpen: (m: string) => m === "US" || m === "CRYPTO",
           sessionLabel: () => "US open", moverMode: () => ({ kind: "open" }),
           moverEligible: (r: { symbol: string; kind: string }) => { const m = real.marketOf(r); return m === "US" || m === "CRYPTO"; } };
});

import { App } from "../App";
import { AskScreen } from "../screens/Ask";
import { InvestorQuiz } from "../components/InvestorQuiz";
import { row, stubApi } from "./fixtures";
import type { DailyBrief, Lot, PortfolioRow } from "../lib/api";
import { FOREIGN_BRIEF_NOTE } from "../components/BriefCard";
import { briefOverlap, foreignBrief } from "../lib/briefBasis";
import { writeError } from "../screens/Position";
import { handOffPortalReturn, onOAuthReturn, openConnectPortal, PORTAL_CLOSED } from "../lib/native";
import { setTextScale } from "../lib/shell";

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const lots: Lot[] = [
  { id: "l1", holding_id: "h1", qty: 25, cost_per_share: 172.4, acquired_on: "2024-03-12", note: null },
  { id: "l2", holding_id: "h1", qty: 10, cost_per_share: 221.1, acquired_on: "2025-08-01", note: null },
];
const openRddt = async () => {
  await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
  await screen.findByRole("heading", { name: /^lots$/i });
};

describe("H1 a failed lots read is not an empty list (r4 power-user M4)", () => {
  it("offline: 'Couldn't load your lots.' with Retry, never 'No lots yet.'; Retry lists them", async () => {
    const getLots = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(lots);
    render(<App api={stubApi({ getLots })} />);
    await openRddt();
    const err = await screen.findByTestId("lots-error");
    expect(err.textContent).toMatch(/Couldn't load your lots\./);
    expect(screen.queryByText(/No lots yet/)).toBeNull();
    await userEvent.click(within(err).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/25 sh @ \$172\.40/)).toBeTruthy();
    expect(screen.queryByTestId("lots-error")).toBeNull();
  });
  it("reconnecting reads the lots again by itself", async () => {
    const getLots = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(lots);
    render(<App api={stubApi({ getLots })} />);
    await openRddt();
    await screen.findByTestId("lots-error");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByText(/10 sh @ \$221\.10/)).toBeTruthy();
  });
  it("a truly empty position still says 'No lots yet.'", async () => {
    render(<App api={stubApi({ getLots: vi.fn().mockResolvedValue([]) })} />);
    await openRddt();
    expect(await screen.findByText("No lots yet.")).toBeTruthy();
  });
  it("lots read before stay on screen when a later read fails", async () => {
    const getLots = vi.fn().mockResolvedValueOnce(lots).mockRejectedValue(new TypeError("Load failed"));
    render(<App api={stubApi({ getLots })} />);
    await openRddt();
    await screen.findByText(/25 sh @ \$172\.40/);
    await userEvent.click(screen.getByRole("button", { name: /← Home/ }));
    await openRddt();
    expect(screen.getByText(/25 sh @ \$172\.40/)).toBeTruthy();
    await waitFor(() => expect(getLots).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("lots-error")).toBeNull();
  });
  it("a write that dies on a dropped connection says so (a PostgrestError is not an Error)", () => {
    expect(writeError({ message: "TypeError: The network connection was lost.", code: "" }, "Could not change the account."))
      .toBe("Could not change the account: the connection dropped. Check it and try again.");
    expect(writeError(new Error("KO is already synced from your brokerage in that account."), "x")).toMatch(/already synced/);
    expect(writeError({ message: "duplicate key" }, "Could not save lot.")).toBe("Could not save lot.");
  });
});

describe("H2 a brief about a different set of holdings is not shown (r4 newcomer)", () => {
  const at = new Date(Date.now() - 20 * 60_000).toISOString();
  const brief = (edition: DailyBrief["edition"], over: Partial<DailyBrief["sections"]>): DailyBrief =>
    ({ brief_date: at.slice(0, 10), edition, generated_at: at, sections: { lede: "", overnight: "", positions: [], desk_view: "", calendar: [], as_of: at, day_sign: 1, ...over } });
  const incomeBook: PortfolioRow[] = [
    row({ holding_id: "m", symbol: "MSFT", name: "Microsoft Corporation" }), row({ holding_id: "v", symbol: "VTI", name: "Vanguard Total Stock Market ETF" }),
    row({ holding_id: "s", symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF" }),
  ];
  const tslaMidday = brief("midday", { lede: "Your TSLA stake is doing most of today's damage.", held: ["VOO", "TSLA", "BTC-USD", "NVDA"] });

  it("r5: exactly half still held is foreign", () => {
    const book: PortfolioRow[] = [row({ holding_id: "v", symbol: "VOO", name: "Vanguard S&P 500 ETF" }), row({ holding_id: "b", symbol: "BTC", name: "Bitcoin", kind: "crypto" })];
    const midday = brief("midday", { positions: [{ name: "TSLA", note: "", watch: "" }, { name: "VOO", note: "", watch: "" }, { name: "BTC", note: "", watch: "" }, { name: "NVDA", note: "", watch: "" }] });
    expect(briefOverlap(midday, book)).toBe(0.5);
    expect(foreignBrief(midday, book)).toBe(true);
    const leadsHeld = brief("close", { positions: [{ name: "VOO", note: "", watch: "" }, { name: "BTC", note: "", watch: "" }, { name: "TSLA", note: "", watch: "" }] });
    expect(foreignBrief(leadsHeld, book)).toBe(false);   // 2 of 3 still held
  });
  it("overlap: the share of what it covers that is still held", () => {
    expect(briefOverlap(tslaMidday, incomeBook)).toBe(0);
    expect(foreignBrief(tslaMidday, incomeBook)).toBe(true);
    expect(foreignBrief(brief("close", { held: ["MSFT", "VTI", "AMZN"] }), incomeBook)).toBe(false);    // 2 of 3: a smaller change
    expect(foreignBrief(brief("close", { held: ["MSFT", "TSLA", "NVDA"] }), incomeBook)).toBe(true);    // 1 of 3
    // older rows: the holdings its position lines name; generic lines don't count either way
    const old = brief("morning", { positions: [{ name: "TSLA", note: "", watch: "" }, { name: "NVDA", note: "", watch: "" }, { name: "Your cash", note: "", watch: "" }] });
    expect(briefOverlap(old, incomeBook)).toBe(0);
    expect(foreignBrief(old, null)).toBe(false);   // no book yet: nothing to judge by
  });
  it("Home shows one line instead of its body, and never its lede", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(incomeBook), getDailyBriefs: vi.fn().mockResolvedValue([tslaMidday]) })} />);
    const card = await screen.findByTestId("brief-foreign");
    expect(card.textContent).toContain(FOREIGN_BRIEF_NOTE);
    expect(document.body.textContent).not.toMatch(/TSLA stake/);
    expect(screen.queryByTestId("brief-card")).toBeNull();
  });
  it("an edition for this book leads, and the foreign one has no chip", async () => {
    const close = brief("close", { lede: "Microsoft led a quiet close.", held: ["MSFT", "VTI", "SCHD"] });
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(incomeBook), getDailyBriefs: vi.fn().mockResolvedValue([close, tslaMidday]) })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Microsoft led a quiet close.");
    expect(within(card).queryByRole("button", { name: "Midday" })).toBeNull();
  });
  it("its arrival is never announced as 'Your brief is ready'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getDailyBriefs = vi.fn().mockResolvedValue([]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(incomeBook), getDailyBriefs })} />);
    await screen.findByTestId("net-worth");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    getDailyBriefs.mockResolvedValue([tslaMidday]);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(getDailyBriefs.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("brief-banner")).toBeNull();
    // the same poll does announce a brief written for this book
    getDailyBriefs.mockResolvedValue([tslaMidday, brief("close", { lede: "For you.", held: ["MSFT", "VTI", "SCHD"] })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(await screen.findByTestId("brief-banner")).toBeTruthy();
  });
});

describe("H3 minors", () => {
  it("offline shows on Home at once, not at the next price poll; back online refreshes", async () => {
    const getPortfolio = vi.fn().mockResolvedValue([row({})]);
    render(<App api={stubApi({ getPortfolio })} />);
    await screen.findByTestId("net-worth");
    expect(screen.queryByTestId("prices-error")).toBeNull();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect((await screen.findByTestId("prices-error")).textContent).toMatch(/Couldn't refresh prices/);
    const n = getPortfolio.mock.calls.length;
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(getPortfolio.mock.calls.length).toBeGreaterThan(n));
    await waitFor(() => expect(screen.queryByTestId("prices-error")).toBeNull());
  });

  it("single-choice quiz answers are radios with aria-checked; multi-choice stay toggle buttons", async () => {
    render(<InvestorQuiz onDone={vi.fn()} />);
    const first = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed"));
    expect(first).toBeTruthy();   // question 1 (styles) is multi-select
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const group = screen.getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    await userEvent.click(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
    expect(radios[1].hasAttribute("aria-pressed")).toBe(false);
  });

  it("Add position offers today's price as the cost", async () => {
    const api = stubApi({ getQuote: vi.fn().mockResolvedValue({ price: 516.43, asOf: null }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    const use = await screen.findByTestId("use-quote");
    expect(use.textContent).toBe("Use today's price ($516.43)");
    expect(api.getQuote).toHaveBeenCalledWith("MARA");
    await userEvent.click(use);
    expect((screen.getByLabelText(/cost per share/i) as HTMLInputElement).value).toBe("516.43");
  });

  it("the lot sheet carries a Done that drops the keypad", async () => {
    render(<App api={stubApi()} />);
    await openRddt();
    await userEvent.click(screen.getByRole("button", { name: "+ Lot" }));
    const field = screen.getByLabelText(/^shares$/i);
    field.focus();
    expect(document.activeElement).toBe(field);
    await userEvent.click(screen.getByTestId("sheet-kb-done"));
    expect(document.activeElement).not.toBe(field);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("the Ask placeholder gets shorter at accessibility text sizes", () => {
    const { unmount } = render(<AskScreen api={stubApi()} />);
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Ask about your portfolio…");
    act(() => setTextScale(3.1));
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Ask a question…");
    act(() => setTextScale(1));
    unmount();
  });

  it("KR rows carry their session in the dot's name (the text tag is gone; owner, home-calm)", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({ holding_id: "k", symbol: "005930.KS", name: "Samsung Electronics", currency: "KRW", price: 285500, qty: 30, value: 8565000 })]) })} />);
    const card = await screen.findByTestId("positions-card");
    await waitFor(() => expect(card.querySelector(".right .session-dot")).not.toBeNull());
    expect(card.querySelector(".right .session-dot")!.getAttribute("aria-label")).toMatch(/^(Live|Closed, .+)$/);
    expect(card.querySelector(".row-session")).toBeNull();
  });
});

describe("H4 the web brokerage portal opens in its own window (r4 newcomer M3: Back -> Unexpected Error)", () => {
  it("opens a window instead of navigating the app away; a close without connecting reports PORTAL_CLOSED", async () => {
    vi.useFakeTimers();
    const win = { closed: false } as Window;
    const open = vi.fn().mockReturnValue(win);
    vi.stubGlobal("open", open);
    const got: string[] = [];
    const off = onOAuthReturn((s) => got.push(s));
    await openConnectPortal("https://connect.snaptrade.test/portal");
    expect(open).toHaveBeenCalledWith("https://connect.snaptrade.test/portal", "assetly-connect", expect.stringContaining("popup"));
    (win as { closed: boolean }).closed = true;
    await vi.advanceTimersByTimeAsync(1200);
    expect(got).toEqual([PORTAL_CLOSED]);
    off();
  });
  it("the callback's status arrives by message, and the close after it is not a cancel", async () => {
    vi.useFakeTimers();
    const win = { closed: false } as Window;
    vi.stubGlobal("open", vi.fn().mockReturnValue(win));
    const got: string[] = [];
    const off = onOAuthReturn((s) => got.push(s));
    await openConnectPortal("https://connect.snaptrade.test/portal");
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "assetly-snaptrade", status: "connected" } }));
    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.test", data: { type: "assetly-snaptrade", status: "denied" } }));
    (win as { closed: boolean }).closed = true;
    await vi.advanceTimersByTimeAsync(1200);
    expect(got).toEqual(["connected"]);
    off();
  });
  it("a blocked popup falls back to navigating this tab", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    const assign = vi.fn();
    const loc = window.location;
    vi.stubGlobal("location", { ...loc, assign, origin: loc.origin });
    await openConnectPortal("https://connect.snaptrade.test/portal");
    expect(assign).toHaveBeenCalledWith("https://connect.snaptrade.test/portal");
  });
  it("the portal window hands the status to its opener and closes", () => {
    const post = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("opener", { postMessage: post });
    vi.stubGlobal("close", close);
    window.history.replaceState({}, "", "/?snaptrade=connected");
    try {
      expect(handOffPortalReturn()).toBe(true);
      expect(post).toHaveBeenCalledWith({ type: "assetly-snaptrade", status: "connected" }, window.location.origin);
      expect(close).toHaveBeenCalled();
    } finally { window.history.replaceState({}, "", "/"); }
  });
  it("no opener (a same-tab return): the app boots and reads the query string as before", () => {
    vi.stubGlobal("opener", null);
    window.history.replaceState({}, "", "/?snaptrade=connected");
    try { expect(handOffPortalReturn()).toBe(false); } finally { window.history.replaceState({}, "", "/"); }
  });
});

