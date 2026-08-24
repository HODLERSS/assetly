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

import { App } from "../App";
import { AuthScreen } from "../screens/Auth";
import type { Api, PortfolioRow, Profile } from "../lib/api";

const profile: Profile = { id: "u-test", display_name: "Minjae", base_currency: "USD", markets: ["US", "KR"], onboarded_at: "2026-08-23T00:00:00Z" };
const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  holding_id: "h1", symbol: "RDDT", name: "Reddit", currency: "USD", kind: "equity",
  qty: 24, cost_basis: 4021.0, avg_cost: 167.54, price: 200, change_pct: 5.26,
  as_of: new Date().toISOString(), value: 4800, total_gl: 779, ...over,
});

function stubApi(over: Partial<Api> = {}): Api {
  return {
    getProfile: vi.fn().mockResolvedValue(profile),
    completeOnboarding: vi.fn().mockResolvedValue(undefined),
    searchSymbols: vi.fn().mockResolvedValue([{ symbol: "MARA", name: "MARA Holdings", exchange: "NASDAQ", currency: "USD", kind: "equity" }]),
    getPortfolio: vi.fn().mockResolvedValue([row({})]),
    addPosition: vi.fn().mockResolvedValue("h-new"),
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
    await userEvent.click(screen.getByRole("button", { name: /korea/i }));
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
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
    expect(gl.className).toContain("gain");
    expect(screen.getAllByText("+5.26%").length).toBeGreaterThan(0);
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
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 5, 15.5, undefined));
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
