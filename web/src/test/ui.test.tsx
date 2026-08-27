// UI flow battery — jsdom + Testing Library with a stubbed data layer and mocked auth.
// Covers the end-to-end user experience surface: auth, onboarding, add/edit/remove,
// prices, news filter, errors, empty states, settings.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const oauthSpy = vi.fn().mockResolvedValue({ data: {}, error: null });
const emailSpy = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("../lib/supabase", () => {
  const session = { user: { id: "u-test" } };
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getUser: vi.fn().mockResolvedValue({ data: { user: session.user } }),
        signOut: vi.fn().mockResolvedValue({}),
      },
    },
    signInWithOAuth: (p: string) => oauthSpy(p),
    signInWithEmail: (e: string) => emailSpy(e),
  };
});

// Market sessions are wall-clock dependent; pin them for deterministic UI tests.
// (The real session/holiday logic is covered by markets.test.ts with fixed instants.)
const marketsState = vi.hoisted(() => ({ mode: { kind: "open" } as { kind: string; market?: string; opensInMin?: number } }));
vi.mock("../lib/markets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/markets")>();
  return { ...real, isMarketOpen: (m: string) => m === "US" || m === "CRYPTO",
           sessionLabel: () => (marketsState.mode.kind === "pulse" ? "US opens in ~2h" : "US open"),
           moverMode: () => marketsState.mode,
           moverEligible: (row: { symbol: string; kind: string }) => {
             if (marketsState.mode.kind === "pulse") return false;
             const m = real.marketOf(row); return m === "US" || m === "CRYPTO";
           } };
});

import { App } from "../App";
import { AuthScreen } from "../screens/Auth";
import type { Api, PortfolioRow, Profile } from "../lib/api";

const profile: Profile = { id: "u-test", display_name: "Minjae", base_currency: "USD", display_us: "USD", display_kr: "KRW", markets: ["US", "KR"], onboarded_at: "2026-08-23T00:00:00Z" };
const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  holding_id: "h1", symbol: "RDDT", account: "brokerage", nickname: "", name: "Reddit", currency: "USD", kind: "equity",
  qty: 24, cost_basis: 4021.0, avg_cost: 167.54, price: 200, change_pct: 5.26,
  as_of: new Date().toISOString(), value: 4800, total_gl: 779, ...over,
});

function stubApi(over: Partial<Api> = {}): Api {
  return {
    getProfile: vi.fn().mockResolvedValue(profile),
    completeOnboarding: vi.fn().mockResolvedValue(undefined),
    searchSymbols: vi.fn().mockResolvedValue([{ symbol: "MARA", name: "MARA Holdings", exchange: "NASDAQ", currency: "USD", kind: "equity" }]),
    ensureSymbol: vi.fn().mockResolvedValue(undefined),
    refreshNews: vi.fn().mockResolvedValue(true),
    getFxRate: vi.fn().mockResolvedValue(1380),
    getFxInfo: vi.fn().mockResolvedValue({ rate: 1381, asOf: new Date(Date.now() - 60000).toISOString() }),
    updateBaseCurrency: vi.fn().mockResolvedValue(undefined),
    updateDisplayCcy: vi.fn().mockResolvedValue(undefined),
    getPulse: vi.fn().mockResolvedValue([]),
    warmup: vi.fn().mockResolvedValue(undefined),
    getInsights: vi.fn().mockResolvedValue(null),
    getPortfolioInsights: vi.fn().mockResolvedValue(null),
    ask: vi.fn().mockResolvedValue({ answer: "1W movement: +$824 (+14.2%). MARA led.", followups: ["What drove MARA this week?", "How is my 1M trend?"] }),
    getHistory: vi.fn().mockResolvedValue([
      { ts: "2026-08-20T20:00:00Z", price: 190 }, { ts: "2026-08-21T14:00:00Z", price: 188 },
      { ts: "2026-08-21T20:00:00Z", price: 195 }, { ts: "2026-08-22T20:00:00Z", price: 197 },
    ]),
    getPortfolio: vi.fn().mockResolvedValue([row({})]),
    addPosition: vi.fn().mockResolvedValue(undefined),   // no id -> legacy back-to-holdings flow
    getLots: vi.fn().mockResolvedValue([{ id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: "2026-07-22", note: null }]),
    addLot: vi.fn().mockResolvedValue(undefined),
    updateLot: vi.fn().mockResolvedValue(undefined),
    deleteLot: vi.fn().mockResolvedValue(undefined),
    removeHolding: vi.fn().mockResolvedValue(undefined),
    getNews: vi.fn().mockResolvedValue([
      { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() },
    ]),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as Api;
}

beforeEach(() => oauthSpy.mockClear());

describe("U1 auth", () => {
  it("shows both OAuth paths and wires them (no password field anywhere)", async () => {
    render(<AuthScreen />);
    await userEvent.click(screen.getByRole("button", { name: /continue with github/i }));
    expect(oauthSpy).toHaveBeenCalledWith("github");
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(oauthSpy).toHaveBeenCalledWith("google");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it("email link path validates, sends, and confirms — still no password", async () => {
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/valid email/i);
    expect(emailSpy).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/email/i));
    await userEvent.type(screen.getByLabelText(/email/i), "minjae@example.com");
    await userEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(emailSpy).toHaveBeenCalledWith("minjae@example.com"));
    expect((await screen.findByRole("status")).textContent).toMatch(/link sent/i);
  });
});

describe("U2 onboarding", () => {
  it("markets → search → shares+cost → position added and onboarding completed", async () => {
    const api = stubApi({ getProfile: vi.fn()
      .mockResolvedValueOnce({ ...profile, onboarded_at: null })
      .mockResolvedValue(profile) });
    render(<App api={api} />);
    await screen.findByText(/set up assetly/i);
    await userEvent.type(screen.getByRole("textbox", { name: /find your first position/i }), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "100");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.67");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 100, 15.67));
    expect(api.completeOnboarding).toHaveBeenCalled();
  });
});

describe("U6 home + prices", () => {
  it("net worth, sign+color G/L, and movers render from priced rows", async () => {
    render(<App api={stubApi()} />);
    const net = await screen.findByTestId("net-worth");
    expect(net.textContent).toBe("$4,800");
    const gl = screen.getByTestId("total-gl");
    expect(gl.textContent).toContain("+$779");
    expect(net.textContent).not.toMatch(/\.\d\d$/);        // values are whole dollars
    expect(gl.className).toContain("gain");
    expect((document.body.textContent ?? "").match(/\+5\.26%/g)!.length).toBeGreaterThan(0);
  });
  it("KRW rows format in won", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({ symbol: "005935.KS", name: "삼성전자우", currency: "KRW", price: 207000, value: 69138000, total_gl: 38517900, change_pct: 8.26 })]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    expect((await screen.findAllByText(/₩69,138,000/)).length).toBeGreaterThan(0);
  });
});

describe("U3 add position", () => {
  it("adds from the holdings tab", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 5, 15.5, undefined, "brokerage", "", ""));
  });
  it("rejects invalid shares with a visible error", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "-3");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/positive/i);
    expect(api.addPosition).not.toHaveBeenCalled();
  });
});

describe("U36 compact day dollars", () => {
  it("Holdings rows show the day move as compact $ next to the percent", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText("RDDT");
    // value 4800 at +5.26% -> day move ~= $240
    expect(document.body.textContent).toMatch(/\+5\.26% \(\+\$240\) today/);
  });
});

describe("U35 live-session dot", () => {
  it("open-market rows get the pulse dot; closed-market rows do not", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),                                            // US row: mock says US is open
      row({ holding_id: "hk", symbol: "000660.KS", name: "SK hynix Inc.", name_kr: "SK하이닉스",
        currency: "KRW", price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 1.1 }),
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText("RDDT");
    const rowsEls = [...document.querySelectorAll(".card .row")];
    const usRow = rowsEls.find((e) => e.textContent!.includes("RDDT"))!;
    const krRow = rowsEls.find((e) => e.textContent!.includes("000660.KS"))!;
    expect(usRow.querySelector(".live-dot")).toBeTruthy();
    expect(krRow.querySelector(".live-dot")).toBeNull();
  });
});

describe("U38 add lands on the position", () => {
  it("a stock add navigates to that position's page where the card will arrive", async () => {
    const api = stubApi({ addPosition: vi.fn().mockResolvedValue("h1") });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    // holding h1 = the stub RDDT row: we land on its position page
    await screen.findByText(/derived from lots/i);
    expect(screen.getByRole("button", { name: /remove position/i })).toBeTruthy();
  });
});

describe("U37 warmup first look", () => {
  it("adding a stock fires warmup; cash does not", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.warmup).toHaveBeenCalledWith("MARA"));
    // cash path
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    await userEvent.type(screen.getByLabelText(/amount/i), "5000");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$CASH", 5000, 1, undefined, "bank", "", ""));
    expect(vi.mocked(api.warmup).mock.calls.length).toBe(1);
  });
  it("the pending line reads as active work and flips to the card when warmup lands", async () => {
    let calls = 0;
    const api = stubApi({ getInsights: vi.fn().mockImplementation(async () =>
      ++calls < 3 ? null : { bullets: ["Q2 call Aug 6: revenue miss, AI pivot forward", "Settlement headline lifted the overhang"],
        windows: { trend: "Two-year grind, recent AI re-rating." }, model: "m", generated_at: new Date().toISOString() }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    const pending = await screen.findByTestId("insights-pending");
    expect(pending.textContent).toMatch(/Reading RDDT/);
    const card = await screen.findByTestId("insights-card", {}, { timeout: 9000 });
    expect(card.textContent).toContain("AI pivot");
    expect(card.textContent).toContain("Two-year grind");
  }, 15000);
});

describe("U34 KR names over codes", () => {
  const krRows = () => [
    row({}),
    row({ holding_id: "hk", symbol: "000660.KS", name: "SK hynix Inc.", name_kr: "SK하이닉스",
      currency: "KRW", price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 0 }),
  ];
  it("KRW view: the Korean name leads; the code drops to the sub line", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(krRows()) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    const sym = await screen.findByText("SK하이닉스");
    expect(sym.className).toContain("sym");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    expect(await screen.findByRole("button", { name: "SK하이닉스" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "000660.KS" })).toBeNull();
  });
  it("KR assets toggled to USD: the English name leads instead", async () => {
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue(krRows()),
      getProfile: vi.fn().mockResolvedValue({ ...profile, display_kr: "USD" as const }),
    });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    expect(await screen.findByText("SK hynix")).toBeTruthy();
    expect(screen.queryByText("SK하이닉스")).toBeNull();
  });
});

describe("U33 news top-5 intelligence", () => {
  it("All holdings shows the ranked top-5 card; a ticker chip swaps to the symbol card", async () => {
    const api = stubApi({ getPortfolioInsights: vi.fn().mockResolvedValue({
      bullets: ["a", "b", "c"],
      news5: ["MARA Q2 miss overshadowed by AI pivot momentum", "RDDT ad growth beats, insiders selling", "Samsung payout fails to lift shares", "INTC dilution overhang from 424B5", "BTC $80K driving miner correlation"],
      windows: null, model: "MiniMax-M2.7", generated_at: new Date().toISOString() }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    const card = await screen.findByTestId("news-top5-card");
    expect(card.textContent).toContain("Assetly Intelligence");
    expect(card.querySelectorAll("li").length).toBe(5);
    expect(card.textContent).toContain("Not financial advice");
    await userEvent.click(screen.getByRole("button", { name: "RDDT" }));
    await waitFor(() => expect(screen.queryByTestId("news-top5-card")).toBeNull());
  });
});

describe("U30 news chips", () => {
  it("cash and debt never get news chips", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),
      row({ holding_id: "hc", symbol: "$CASH.KRW", name: "Cash (KRW)", kind: "cash", currency: "KRW", account: "bank", price: 1, change_pct: 0, value: 235000000 }),
      row({ holding_id: "hd", symbol: "$DEBT.KRW", name: "Debt (KRW)", kind: "debt", currency: "KRW", account: "bank", price: 1, change_pct: 0, value: 165000000 }),
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    await screen.findByRole("button", { name: /all holdings/i });
    expect(screen.getByRole("button", { name: "RDDT" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "$CASH.KRW" })).toBeNull();
    expect(screen.queryByRole("button", { name: "$DEBT.KRW" })).toBeNull();
  });
});

describe("U26 currency matrix", () => {
  const krwRow = () => row({ holding_id: "hk", symbol: "005930.KS", name: "Samsung Electronics",
    currency: "KRW", price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 0 });
  it("US assets flip to KRW via updateDisplayCcy", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), krwRow()]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /US assets in ₩ KRW/i }));
    await waitFor(() => expect(api.updateDisplayCcy).toHaveBeenCalledWith({ display_us: "KRW" }));
  });
  it("KR assets default to KRW and flip to USD", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), krwRow()]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    const krUsd = await screen.findByRole("button", { name: /KR assets in \$ USD/i });
    const krKrw = screen.getByRole("button", { name: /KR assets in ₩ KRW/i });
    expect(krKrw.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(krUsd);
    await waitFor(() => expect(api.updateDisplayCcy).toHaveBeenCalledWith({ display_kr: "USD" }));
  });
  it("US rows render in won when display_us is KRW", async () => {
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([row({}), krwRow()]),
      getProfile: vi.fn().mockResolvedValue({ ...profile, display_us: "KRW" as const }),
    });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    // RDDT $4,800 * 1380 = ₩6,624,000
    await waitFor(() => expect(document.body.textContent).toContain("₩6,624,000"));
  });
});

describe("U27 holdings filters", () => {
  const three = () => [
    row({}),
    row({ holding_id: "h2", symbol: "QQQM", name: "Invesco NASDAQ 100", account: "401k" }),
    row({ holding_id: "hk", symbol: "005930.KS", name: "Samsung Electronics",
      currency: "KRW", price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 0 }),
  ];
  it("USD crypto files under the US filter", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      ...three(),
      row({ holding_id: "hb", symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", account: "crypto", price: 80000, value: 160000, cost_basis: 100000, total_gl: 60000, change_pct: 1.2 }),
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText("BTC-USD");
    await userEvent.click(screen.getByRole("button", { name: /^US$/ }));
    await waitFor(() => expect(screen.queryByText("005930.KS")).toBeNull());
    expect(screen.getByText("BTC-USD")).toBeTruthy();
  });
  it("chips are All, KR, US, Ret only and single-select", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(three()) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText("QQQM");
    expect(screen.queryByRole("button", { name: /^Equity$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cash$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^ETF$/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^US$/ }));
    await waitFor(() => expect(screen.queryByText("005930.KS")).toBeNull());
    expect(screen.getByText("QQQM")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Ret$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Ret$/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("button", { name: /^US$/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("QQQM")).toBeTruthy();
    expect(screen.queryByText("RDDT")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^All$/ }));
    await waitFor(() => expect(screen.getByText("005930.KS")).toBeTruthy());
  });
});

describe("U28 pre-open pulse", () => {
  it("shows index futures when the US open is a couple hours out", async () => {
    marketsState.mode = { kind: "pulse", opensInMin: 120 };
    try {
      const api = stubApi({ getPulse: vi.fn().mockResolvedValue([
        { symbol: "ES=F", name: "S&P 500 futures", price: 6612.5, change_pct: 0.45 },
        { symbol: "NQ=F", name: "Nasdaq 100 futures", price: 24380.75, change_pct: -0.3 },
      ]) });
      render(<App api={api} />);
      await screen.findByTestId("net-worth");
      await screen.findByText("S&P 500 futures");
      expect(screen.getByTestId("pulse-card").textContent).toContain("Nasdaq 100 futures");
      expect(document.body.textContent).toContain("+0.45%");
      expect(document.body.textContent).toContain("US opens in ~2h");
    } finally { marketsState.mode = { kind: "open" }; }
  });
});

describe("U32 edit from the position view", () => {
  it("single-lot position: Edit button opens the sheet, saving updates the lot and refreshes", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue([
      { id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: null, note: null }]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    const calls = vi.mocked(api.getPortfolio).mock.calls.length;
    await userEvent.click(await screen.findByRole("button", { name: /^edit position$/i }));
    const shares = screen.getByLabelText(/^shares$/i);
    await userEvent.clear(shares);
    await userEvent.type(shares, "12");
    const noteInput = screen.getByLabelText(/note \(optional\)/i);
    await userEvent.type(noteInput, "trimmed on strength");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateLot).toHaveBeenCalledWith("l1",
      { qty: 12, cost_per_share: 166.55, acquired_on: null, note: "trimmed on strength" }));
    await waitFor(() => expect(vi.mocked(api.getPortfolio).mock.calls.length).toBeGreaterThan(calls));
  });
  it("cash position: Edit amount is a single field, cost stays pinned at 1", async () => {
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([
        row({ holding_id: "hc", symbol: "$CASH", name: "Cash", kind: "cash", account: "bank", price: 1, change_pct: 0, value: 5000, cost_basis: 5000, total_gl: 0, qty: 5000 })]),
      getLots: vi.fn().mockResolvedValue([
        { id: "lc", holding_id: "hc", qty: 5000, cost_per_share: 1, acquired_on: null, note: null }]),
    });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Cash/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^edit amount$/i }));
    expect(screen.queryByLabelText(/cost per share/i)).toBeNull();
    expect(screen.queryByLabelText(/acquired/i)).toBeNull();
    const amt = screen.getByLabelText(/^amount/i);
    await userEvent.clear(amt);
    await userEvent.type(amt, "6000");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateLot).toHaveBeenCalledWith("lc",
      { qty: 6000, cost_per_share: 1, acquired_on: null, note: null }));
  });
});

describe("U25 notes", () => {
  it("a note travels from the add form into addPosition", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.type(screen.getByLabelText(/note \(optional\)/i), "Earnings dip buy");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 5, 15.5, undefined, "brokerage", "", "Earnings dip buy"));
  });
  it("lot notes render and are editable in the sheet", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue([
      { id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: "2026-07-22", note: "DCA week 1" }]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    await screen.findByText("DCA week 1");
    await userEvent.click(screen.getByRole("button", { name: /edit lot 10 shares/i }));
    const noteInput = screen.getByLabelText(/note \(optional\)/i);
    expect((noteInput as HTMLInputElement).value).toBe("DCA week 1");
    await userEvent.clear(noteInput);
    await userEvent.type(noteInput, "trimmed");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateLot).toHaveBeenCalledWith("l1", { qty: 10, cost_per_share: 166.55, acquired_on: "2026-07-22", note: "trimmed" }));
  });
});

describe("U29 ASK chat", () => {
  it("renders markdown bold and bullets inside a chat bubble", async () => {
    const api = stubApi({ ask: vi.fn().mockResolvedValue({ answer: "**Bottom line**: solid week.\n\u2022 MARA led with **+5.8%**\n- Watch concentration", followups: ["How concentrated am I?", "What moved MARA?"] }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    await userEvent.type(screen.getByLabelText(/ask about your portfolio/i), "How was my week?");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    const bubble = await screen.findByTestId("ask-answer");
    const strongs = [...bubble.querySelectorAll("strong")].map((el) => el.textContent);
    expect(strongs).toContain("Bottom line");
    expect(strongs).toContain("+5.8%");
    expect(bubble.textContent).not.toContain("**");
    expect(bubble.querySelectorAll(".md-li").length).toBe(2);
    expect(bubble.textContent).toContain("Not financial advice");
    // the user's message shows as its own bubble
    expect(document.querySelector(".bubble.user")?.textContent).toBe("How was my week?");
  });
});

describe("U24 ASK", () => {
  it("asks a question and renders the grounded answer with the advice line", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    await userEvent.type(screen.getByLabelText(/ask about your portfolio/i), "my 1W move?");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    const card = await screen.findByTestId("ask-answer");
    expect(card.textContent).toContain("+$824");
    expect(card.textContent).toContain("Not financial advice");
    expect(api.ask).toHaveBeenCalledWith("my 1W move?");
  });
  it("the first suggestion is the portfolio assessment", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    const chips = screen.getAllByRole("button", { name: /assess my portfolio|1W movement|watch this week|concentrated/i });
    expect(chips[0].textContent).toBe("Assess my portfolio and provide insights");
    await userEvent.click(chips[0]);
    await screen.findByTestId("ask-answer");
    expect(api.ask).toHaveBeenCalledWith("Assess my portfolio and provide insights");
  });
  it("suggestion chips fire a question directly", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    await userEvent.click(screen.getByRole("button", { name: /1W movement/i }));
    await screen.findByTestId("ask-answer");
    expect(api.ask).toHaveBeenCalledWith("What was my 1W movement in $ and %?");
  });
});

describe("U31 ASK follow-ups", () => {
  it("renders 2-3 follow-up chips under the latest answer and they fire the next question", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    await userEvent.type(screen.getByLabelText(/ask about your portfolio/i), "my week?");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await screen.findByTestId("ask-answer");
    const fu = await screen.findByRole("button", { name: "What drove MARA this week?" });
    expect(screen.getByRole("button", { name: "How is my 1M trend?" })).toBeTruthy();
    await userEvent.click(fu);
    await waitFor(() => expect(api.ask).toHaveBeenLastCalledWith("What drove MARA this week?"));
    // chips belong to the LATEST turn only; after the follow-up answered, new chips render
    const chips = screen.getAllByRole("button", { name: "What drove MARA this week?" });
    expect(chips.length).toBe(1);
  });
});

describe("U22 portfolio insights on Holdings", () => {
  it("renders the quiet 'Your portfolio' card above the list", async () => {
    const api = stubApi({ getPortfolioInsights: vi.fn().mockResolvedValue({
      bullets: ["MARA is 39% of assets — one earnings call moves your month", "Korea book carried today (+1.2%) while US slept", "Cash buffer under 2 months of burn"],
      windows: null, model: "MiniMax-M2.7", generated_at: new Date().toISOString() }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    const card = await screen.findByTestId("portfolio-insights-card");
    expect(card.textContent).toContain("Your portfolio");
    expect(card.textContent).toContain("39% of assets");
    expect(card.textContent).toContain("Not financial advice");
  });
  it("absent quietly when there is none yet", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText(/Reddit/);
    expect(screen.queryByTestId("portfolio-insights-card")).toBeNull();
  });
});

describe("U20 Assetly Intelligence", () => {
  const insight = { bullets: ["Take one about margins", "Take two about the balance sheet", "Take three on valuation"],
    windows: { trend: "Hot week against a long slog of a year." }, model: "MiniMax-M2.7", generated_at: new Date(Date.now() - 300000).toISOString() };
  it("position shows the branded card with bullets and horizons, separate from news", async () => {
    const api = stubApi({ getInsights: vi.fn().mockResolvedValue(insight) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    const card = await screen.findByTestId("insights-card");
    expect(card.textContent).toContain("Assetly Intelligence");
    expect(card.textContent).toContain("Take one about margins");
    expect(card.textContent).toContain("Not financial advice");
    expect(card.textContent).not.toMatch(/MiniMax|MARA Cloud|AI-generated/);
    expect((await screen.findByTestId("insights-trend")).textContent).toContain("Hot week");
  });
  it("no insight yet: card takes no space at all", async () => {
    const api = stubApi();   // getInsights -> null
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    await screen.findByRole("heading", { name: /^lots$/i });
    expect(screen.queryByTestId("insights-card")).toBeNull();
  });
  it("news tab: card appears only when a symbol chip is selected", async () => {
    const api = stubApi({ getInsights: vi.fn().mockResolvedValue(insight) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    await screen.findByRole("button", { name: /all holdings/i });
    expect(screen.queryByTestId("insights-card")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^RDDT$/ }));
    await screen.findByTestId("insights-card");
  });
});

describe("U19 no-KRW hygiene", () => {
  it("USD-only book: no FX caption anywhere, no rate row, no toggle", async () => {
    const api = stubApi();   // default book is USD-only
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    expect(screen.queryByTestId("fx-note")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    await screen.findByText(/signed in as/i);
    expect(screen.queryByTestId("fx-rate-row")).toBeNull();
    expect(screen.queryByRole("button", { name: /₩ KRW/ })).toBeNull();
    expect(screen.queryByText(/KRW converted/)).toBeNull();
  });
});

describe("U18 labels + bank accounts", () => {
  it("named cash reaches addPosition with the label and Bank preselected", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    expect(screen.getByRole("button", { name: "Bank" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(screen.getByLabelText(/amount \(\$\)/i), "2500");
    await userEvent.type(screen.getByLabelText(/label \(optional\)/i), "Cash (Yeonhwa)");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$CASH", 2500, 1, undefined, "bank", "Cash (Yeonhwa)", ""));
  });
  it("rows show the label instead of the generic name, with a Bank tag", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({ holding_id: "c1", symbol: "$CASH", name: "Cash (USD)", nickname: "Cash (Yeonhwa)", kind: "cash", account: "bank", qty: 2500, price: 1, value: 2500, cost_basis: 2500, total_gl: 0, change_pct: 0 }),
      row({ holding_id: "c2", symbol: "$CASH", name: "Cash (USD)", nickname: "Cash (Minjae)", kind: "cash", account: "bank", qty: 4000, price: 1, value: 4000, cost_basis: 4000, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText("Cash (Yeonhwa)");
    await screen.findByText("Cash (Minjae)");
    expect(screen.getAllByText(/cash balance · Bank/).length).toBe(2);
  });
});

describe("U17 KRW cash and debt", () => {
  it("cash in won: currency chip flips the symbol to $CASH.KRW", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    await userEvent.click(screen.getByRole("button", { name: /₩ KRW/ }));
    await userEvent.type(screen.getByLabelText(/amount \(₩\)/i), "3000000");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$CASH.KRW", 3000000, 1, undefined, "bank", "", ""));
  });
  it("debt in won reaches the totals at the FX rate", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),
      row({ holding_id: "hd", symbol: "$DEBT.KRW", name: "Debt (KRW)", kind: "debt", currency: "KRW",
            qty: 1380000, price: 1, value: 1380000, cost_basis: 1380000, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    const net = await screen.findByTestId("net-worth");
    await waitFor(() => expect(net.textContent).toBe("$3,800"));   // 4,800 - 1,380,000/1,380
  });
});

describe("U16 currency view toggle", () => {
  const krwRow = () => row({ holding_id: "hk", symbol: "005930.KS", name: "Samsung Electronics",
    currency: "KRW", price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 0 });
  it("with KRW holdings: toggle + live rate with freshness appear in Settings", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), krwRow()]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByRole("button", { name: /view totals in ₩ KRW/i })).toBeTruthy();
    expect((await screen.findByTestId("fx-rate-row")).textContent).toMatch(/₩1,381\/\$/);
  });
  it("switching to KRW persists and re-renders the whole app in won", async () => {
    let base: "USD" | "KRW" = "USD";
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([row({}), krwRow()]),
      getProfile: vi.fn().mockImplementation(async () => ({ ...profile, base_currency: base })),
      updateBaseCurrency: vi.fn().mockImplementation(async (c: "USD" | "KRW") => { base = c; }),
    });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /view totals in ₩ KRW/i }));
    await waitFor(() => expect(api.updateBaseCurrency).toHaveBeenCalledWith("KRW"));
    await userEvent.click(screen.getByRole("button", { name: /^home$/i }));
    // $4,800 * 1380 + ₩13,800,000 = ₩20,424,000
    await waitFor(() => expect(screen.getByTestId("net-worth").textContent).toBe("₩20,424,000"));
  });
  it("without KRW anywhere the toggle stays hidden", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    await screen.findByText(/signed in as/i);
    expect(screen.queryByRole("button", { name: /₩ KRW/ })).toBeNull();
  });
});

describe("U15 debt", () => {
  it("debt subtracts from net worth and reads as a negative balance", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),                                                        // $4,800 asset
      row({ holding_id: "h9", symbol: "$DEBT", name: "Debt (USD)", kind: "debt", qty: 1800, price: 1, value: 1800, cost_basis: 1800, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    const net = await screen.findByTestId("net-worth");
    await waitFor(() => expect(net.textContent).toBe("$3,000"));      // 4,800 - 1,800
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText(/debt balance/);
    expect(screen.getByText("-$1,800")).toBeTruthy();
  });
  it("debt quick add: amount-owed field, cost pinned at 1", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add a loan or debt/i }));
    await userEvent.type(screen.getByLabelText(/amount owed/i), "1800");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$DEBT", 1800, 1, undefined, "bank", "", ""));
  });
});

describe("U14 accounts + cash", () => {
  it("account chips appear after pick; 401k selection reaches addPosition", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.click(screen.getByRole("button", { name: "401k" }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 5, 15.5, undefined, "401k", "", ""));
  });
  it("cash fast path: one amount field, no cost/date, cost pinned at 1", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    expect(screen.queryByLabelText(/cost per share/i)).toBeNull();
    expect(screen.queryByLabelText(/purchase date/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/amount/i), "5000");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$CASH", 5000, 1, undefined, "bank", "", ""));
  });
  it("non-brokerage rows carry a quiet account tag; brokerage stays untagged; cash rows read as cash", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),
      row({ holding_id: "h2", symbol: "QQQM", name: "Invesco Nasdaq 100", kind: "etf", account: "401k", qty: 40 }),
      row({ holding_id: "h3", symbol: "$CASH", name: "Cash (USD)", kind: "cash", qty: 5000, price: 1, value: 5000, cost_basis: 5000, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await screen.findByText(/Invesco Nasdaq 100/);
    const subs = Array.from(document.querySelectorAll("span.sub")).map((e) => (e.textContent ?? "").trim());
    expect(subs.some((t) => t.startsWith("24 sh · avg"))).toBe(true);     // brokerage row untagged
    expect(subs.some((t) => /24 sh · (401k|IRA)/.test(t))).toBe(false);
    expect(subs.some((t) => /40 sh · 401k/.test(t))).toBe(true);          // 401k row tagged
    expect(subs).toContain("cash balance");                               // no noisy avg on cash
  });
});

describe("U13 persona-fleet fixes", () => {
  it("mixed USD+KRW book: header converts KRW at the FX rate with a visible caption", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),                                                                   // $4,800 USD
      row({ holding_id: "h2", symbol: "005930.KS", name: "Samsung Electronics", currency: "KRW",
            price: 250000, value: 13800000, cost_basis: 13800000, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    const net = await screen.findByTestId("net-worth");
    // 13,800,000 KRW / 1380 = $10,000  ->  $4,800 + $10,000 = $14,800
    await waitFor(() => expect(net.textContent).toBe("$14,800"));
    expect(screen.queryByTestId("fx-note")).toBeNull();          // rate lives in Settings, not Home
  });
  it("home shows today's move in dollars and per-row day %", async () => {
    render(<App api={stubApi()} />);
    const day = await screen.findByTestId("total-day");
    expect(day.textContent).toMatch(/\+\$240 \(\+5\.26%\) today/);        // 4800 - 4800/1.0526
    expect(day.className).toContain("gain");
    expect((document.body.textContent ?? "").match(/\+5\.26%/g)!.length).toBeGreaterThan(0);
    expect((document.body.textContent ?? "").match(/\+\$240/g)!.length).toBeGreaterThan(1);   // header + mover $
  });
  it("crypto positions show units, not shares — on Home AND the Holdings list", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({ symbol: "BTC", name: "Bitcoin", kind: "crypto", qty: 0.5 })]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    expect(screen.getByText(/0\.5 BTC/)).toBeTruthy();
    expect(screen.queryByText(/0\.5 sh/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    expect((await screen.findAllByText(/0\.5 BTC/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.5 sh/)).toBeNull();
  });
  it("chart draws the avg-cost dashed line when it is inside the window", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({ avg_cost: 195 })]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    await screen.findByTestId("price-chart");
    expect(await screen.findByTestId("avg-cost-line")).toBeTruthy();
    expect(screen.getByText(/avg \$195\.00/)).toBeTruthy();
  });
  it("short history under a long range gets a partial-data caption", async () => {
    const api = stubApi();   // stub history spans ~2 days; default range = 1M
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    await screen.findByTestId("price-chart");
    expect((await screen.findByTestId("partial-note")).textContent).toMatch(/showing \d+d of data/);
  });
});

describe("U12 instant news", () => {
  it("empty scope pulls immediately, then shows what landed", async () => {
    const stories = [{ id: "n9", symbol: "RDDT", title: "Fresh story", url: "https://ex.test/9", source: "Yahoo Finance", published_at: new Date().toISOString() }];
    const getNews = vi.fn().mockResolvedValueOnce([]).mockResolvedValue(stories);
    const api = stubApi({ getNews, refreshNews: vi.fn().mockResolvedValue(true) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    await screen.findByText(/fresh story/i);
    expect(api.refreshNews).toHaveBeenCalledWith(["RDDT"]);
    expect(screen.queryByText(/news lap runs/i)).toBeNull();
  });
  it("adding a position fires an instant news pull for that symbol", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15.5");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.refreshNews).toHaveBeenCalledWith(["MARA"]));
  });
});

describe("U11 price chart on position", () => {
  const openPosition = async () => {
    render(<App api={apiRef} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^holdings$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Reddit/i }));
    await screen.findByRole("heading", { name: /^lots$/i });
  };
  let apiRef: Api;
  it("daily closes only: one point per day, live price is today's point", async () => {
    apiRef = stubApi();
    await openPosition();
    const svg = await screen.findByTestId("price-chart");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toMatch(/^M/);
    // 3 calendar days in history (intraday print collapsed) + live today = 4 points
    expect(d.split("L").length).toBe(4);
    expect((await screen.findByTestId("range-change")).textContent).toMatch(/[+-]\d/);
    expect(screen.getByText(/L \$190\.00/)).toBeTruthy();   // 8/21 close 195, not the 188 intraday
    expect(screen.getByText(/H \$200\.00/)).toBeTruthy();   // live price today (row.price = 200)
  });
  it("Apple-style ranges: full chip set, 1D intraday hours, YTD dynamic; default 1M", async () => {
    apiRef = stubApi();
    await openPosition();
    await screen.findByTestId("price-chart");
    expect(apiRef.getHistory).toHaveBeenCalledWith("RDDT", 24 * 31);
    for (const k of ["1D", "1W", "3M", "6M", "YTD", "1Y", "2Y", "5Y"]) {
      expect(screen.getByRole("tab", { name: k })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole("tab", { name: "1D" }));
    await waitFor(() => expect(apiRef.getHistory).toHaveBeenCalledWith("RDDT", 24));
    await userEvent.click(screen.getByRole("tab", { name: "YTD" }));
    await waitFor(() => {
      const hours = (apiRef.getHistory as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as number;
      expect(hours).toBeGreaterThan(48);
      expect(hours).toBeLessThanOrEqual(24 * 366);
    });
    await userEvent.click(screen.getByRole("tab", { name: "2Y" }));
    await waitFor(() => expect(apiRef.getHistory).toHaveBeenCalledWith("RDDT", 24 * 366 * 2));
  });
  it("1D draws the intraday prints, not one collapsed daily point", async () => {
    apiRef = stubApi({ getHistory: vi.fn().mockResolvedValue([
      { ts: "2026-08-24T14:00:00Z", price: 190 }, { ts: "2026-08-24T15:00:00Z", price: 195 },
      { ts: "2026-08-24T16:00:00Z", price: 193 },
    ]) });
    await openPosition();
    await screen.findByTestId("price-chart");
    await userEvent.click(screen.getByRole("tab", { name: "1D" }));
    await waitFor(() => {
      const d = screen.getByTestId("price-chart").querySelector("path")?.getAttribute("d") ?? "";
      expect(d.split("L").length).toBe(4);               // 3 prints + live tick, not collapsed
    });
  });
  it("shows the building-history empty state, not a broken chart", async () => {
    apiRef = stubApi({ getHistory: vi.fn().mockResolvedValue([]) });
    await openPosition();
    await screen.findByText(/not enough history yet/i);
    expect(screen.queryByTestId("price-chart")).toBeNull();
  });
});

describe("U4 edit lots", () => {
  it("opens a lot, saves new qty, derived note visible", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click((await screen.findAllByRole("button", { name: /RDDT/ }))[0]);
    await screen.findByRole("heading", { name: /^lots$/i });
    await userEvent.click(screen.getByRole("button", { name: /edit lot 10 shares/i }));
    const qty = screen.getByLabelText(/^shares$/i);
    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateLot).toHaveBeenCalledWith("l1", expect.objectContaining({ qty: 12 })));
    expect(screen.getByText(/derived from lots/i)).toBeTruthy();
  });
});

describe("U4b lots loading", () => {
  it("never shows 'No lots yet' before the lots query resolves", async () => {
    let resolve!: (v: unknown) => void;
    const api = stubApi({ getLots: vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click((await screen.findAllByRole("button", { name: /RDDT/ }))[0]);
    await screen.findByRole("heading", { name: /^lots$/i });
    expect(screen.queryByText(/no lots yet/i)).toBeNull();
    resolve([]);
    await screen.findByText(/no lots yet/i);
  });
});

describe("U5 remove with confirmation", () => {
  it("cancel keeps the position; confirm removes it", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click((await screen.findAllByRole("button", { name: /RDDT/ }))[0]);
    await userEvent.click(await screen.findByRole("button", { name: /remove position/i }));
    const dialog = await screen.findByRole("dialog", { name: /confirm removal/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /keep it/i }));
    expect(api.removeHolding).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /remove position/i }));
    const dialog2 = await screen.findByRole("dialog", { name: /confirm removal/i });
    await userEvent.click(within(dialog2).getByRole("button", { name: /remove position/i }));
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalledWith("h1"));
  });
});

describe("U7 news", () => {
  it("scopes All holdings to held symbols and dedupes by url", async () => {
    const api = stubApi({ getNews: vi.fn().mockResolvedValue([
      { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() },
      { id: "n2", symbol: "NVDA", title: "Nvidia story for a symbol not held", url: "https://ex.test/2", source: "Yahoo Finance", published_at: new Date().toISOString() },
      { id: "n3", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Google News", published_at: new Date().toISOString() },
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    await screen.findByText(/reddit posts strong quarter/i);
    expect(api.getNews).toHaveBeenCalledWith(["RDDT"]);          // scoped in the query, not after
    expect(screen.getAllByText(/reddit posts strong quarter/i).length).toBe(1);
  });
  it("lists stories and filters by holding chip", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    await screen.findByText(/reddit posts strong quarter/i);
    await userEvent.click(screen.getByRole("group", { name: /filter news/i }).querySelectorAll("button")[1] as HTMLElement);
    await waitFor(() => expect(api.getNews).toHaveBeenLastCalledWith("RDDT"));
  });
});

describe("U8 error + retry", () => {
  it("failed load shows the Relay-voice error with a working retry", async () => {
    const api = stubApi();
    (api.getPortfolio as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("The feed missed a handoff. Pull to retry."))
      .mockResolvedValue([row({})]);
    render(<App api={api} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/missed a handoff/i);
    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    await screen.findByTestId("net-worth");
  });
});

describe("U9 empty state", () => {
  it("no positions → Relay-voice CTA", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([]) });
    render(<App api={api} />);
    await screen.findByText(/no runners on the track/i);
    expect(screen.getByRole("button", { name: /add your first position/i })).toBeTruthy();
  });
});

describe("U10 settings", () => {
  it("shows account facts and signs out", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(screen.getByText("Minjae")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());
  });
});
