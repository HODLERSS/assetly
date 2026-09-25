// Behaviour battery for the 1.0.1 launch fixes (number entry, portfolio correctness, first run,
// search, sign-in). jsdom + Testing Library with a stubbed data layer, same harness as ui.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithApple: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    completeNativeAuth: vi.fn().mockResolvedValue({ error: null }),
  };
});

// Market sessions are wall-clock dependent; pin "US open" for the UI (session maths has its own tests).
vi.mock("../lib/markets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/markets")>();
  return { ...real, isMarketOpen: (m: string) => m === "US" || m === "CRYPTO",
           sessionLabel: () => "US open", moverMode: () => ({ kind: "open" }),
           moverEligible: (r: { symbol: string; kind: string }) => { const m = real.marketOf(r); return m === "US" || m === "CRYPTO"; } };
});

import { App } from "../App";
import { profile, row, stubApi } from "./fixtures";
import type { Api, PortfolioRow } from "../lib/api";

beforeEach(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ } });

async function openAdd(api: Api) {
  render(<App api={api} />);
  await screen.findByTestId("net-worth");
  await userEvent.click(screen.getByRole("button", { name: /add position/i }));
}
async function pickMara() {
  await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
  await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
}
async function openPosition(api: Api, name: RegExp) {
  render(<App api={api} />);
  await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name }));
}

describe("C1 number entry", () => {
  it("'1,000' shares at '$1,250.50' saves 1000 × 1250.5, with the total echoed before saving", async () => {
    const api = stubApi();
    await openAdd(api);
    await pickMara();
    await userEvent.type(screen.getByLabelText(/^shares$/i), "1,000");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "$1,250.50");
    expect(screen.getByTestId("entry-preview").textContent).toBe("1,000 shares × $1,250.50 = $1,250,500.00");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 1000, 1250.5, undefined, "brokerage", "", ""));
  });
  it("a blank cost says plainly what to enter, on the cost field, and nothing saves", async () => {
    const api = stubApi();
    await openAdd(api);
    await pickMara();
    await userEvent.type(screen.getByLabelText(/^shares$/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    const cost = screen.getByLabelText(/cost per share/i);
    expect(cost.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(cost.getAttribute("aria-describedby")!)!.textContent).toBe("Enter what you paid per share.");
    expect(screen.getByLabelText(/^shares$/i).getAttribute("aria-invalid")).toBeNull();
    expect(api.addPosition).not.toHaveBeenCalled();
  });
  it("junk like '1.2.3' is rejected with a number error instead of being truncated", async () => {
    const api = stubApi();
    await openAdd(api);
    await pickMara();
    await userEvent.type(screen.getByLabelText(/^shares$/i), "1.2.3");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/shares must be a number/i);
    expect(api.addPosition).not.toHaveBeenCalled();
  });
  it("cash '1,500' saves $1,500 (it used to save $1) and previews the amount", async () => {
    const api = stubApi();
    await openAdd(api);
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    await userEvent.type(screen.getByLabelText(/^amount/i), "1,500");
    expect(screen.getByTestId("entry-preview").textContent).toBe("Amount: $1,500.00");
    expect(screen.getByLabelText(/^amount/i).getAttribute("inputmode")).toBe("decimal");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("$CASH", 1500, 1, undefined, "bank", "", ""));
  });
  it("the cash label placeholder is neutral", async () => {
    await openAdd(stubApi());
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    expect(screen.getByLabelText(/label \(optional\)/i).getAttribute("placeholder")).toBe("e.g. Emergency fund");
  });
  it("onboarding's manual add reads '1,200' as 1200 and asks for the cost plainly", async () => {
    const api = stubApi({ getProfile: vi.fn().mockResolvedValueOnce({ ...profile, onboarded_at: null }).mockResolvedValue(profile) });
    render(<App api={api} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await userEvent.type(await screen.findByLabelText(/find your first position/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "1,200");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter what you paid per share.");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    expect(screen.getByTestId("entry-preview").textContent).toBe("1,200 shares × $15.00 = $18,000.00");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 1200, 15));
  });
  it("the lot sheet reads '1,200' too", async () => {
    const api = stubApi();
    await openPosition(api, /Reddit/i);
    await userEvent.click(await screen.findByRole("button", { name: /^\+ lot$/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "1,200");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "12.5");
    await userEvent.click(screen.getByRole("button", { name: /^add lot$/i }));
    await waitFor(() => expect(api.addLot).toHaveBeenCalledWith("h1", 1200, 12.5, undefined, ""));
  });
});

describe("C2 accounts", () => {
  it("the account never carries over: Cash (Bank) then a stock saves to Brokerage", async () => {
    const api = stubApi();
    await openAdd(api);
    await userEvent.click(await screen.findByRole("button", { name: /add a cash balance/i }));
    await userEvent.type(screen.getByLabelText(/^amount/i), "500");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await screen.findByTestId("added-strip");
    await pickMara();
    expect(screen.getByRole("button", { name: "Brokerage" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenLastCalledWith("MARA", 5, 15, undefined, "brokerage", "", ""));
  });
  it("an IRA pick does not stick to the next add either", async () => {
    const api = stubApi();
    await openAdd(api);
    await pickMara();
    await userEvent.click(screen.getByRole("button", { name: "IRA" }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await screen.findByTestId("added-strip");
    await pickMara();
    expect(screen.getByRole("button", { name: "Brokerage" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("crypto detail says Crypto account, never IRA", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({ symbol: "BTC", name: "Bitcoin", kind: "crypto", account: "crypto", qty: 0.5 })]) });
    await openPosition(api, /Bitcoin/i);
    expect((await screen.findByTestId("position-account")).textContent).toMatch(/^Crypto account/);
    expect(screen.queryByText(/IRA account/)).toBeNull();
  });
  it("Edit position can move the position to another account", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue([{ id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: null, note: null }]) });
    await openPosition(api, /Reddit/i);
    await userEvent.click(await screen.findByRole("button", { name: /^edit position$/i }));
    const group = screen.getByRole("group", { name: "Account" });
    await userEvent.click(within(group).getByRole("button", { name: "IRA" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.setHoldingAccount).toHaveBeenCalledWith("h1", "ira"));
  });
  it("moving into an account that already holds it follows the merged position", async () => {
    const rows = [row({}), row({ holding_id: "h9", account: "ira", qty: 5, value: 1000 })];
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows), setHoldingAccount: vi.fn().mockResolvedValue("h9") });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    await userEvent.click((await within(card).findAllByRole("button", { name: /Reddit/i }))[0]);
    await userEvent.click(await screen.findByRole("button", { name: /^change$/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /move to account/i })).getByRole("button", { name: "IRA" }));
    await waitFor(() => expect(api.setHoldingAccount).toHaveBeenCalledWith("h1", "ira"));
    await waitFor(() => expect(screen.getByTestId("position-account").textContent).toMatch(/^IRA account/));
  });
  it("synced positions don't offer an account change (the next sync would undo it)", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({ source: "snaptrade", account_label: "Fidelity …4998" })]) });
    await openPosition(api, /Reddit/i);
    expect((await screen.findByTestId("position-account")).textContent).toMatch(/Fidelity/);
    expect(screen.queryByRole("button", { name: /^change$/i })).toBeNull();
  });
});

describe("C3 lot deletion", () => {
  const twoLots = [
    { id: "l1", holding_id: "h1", qty: 10, cost_per_share: 150, acquired_on: "2026-01-02", note: null },
    { id: "l2", holding_id: "h1", qty: 14, cost_per_share: 180, acquired_on: "2026-03-02", note: null },
  ];
  it("deleting a lot asks first; Keep it cancels", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue(twoLots) });
    await openPosition(api, /Reddit/i);
    await userEvent.click(await screen.findByRole("button", { name: /edit lot 10 shares/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete this lot/i }));
    expect(screen.getByRole("dialog", { name: /confirm delete/i })).toBeTruthy();
    expect(api.deleteLot).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));
    expect(api.deleteLot).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /delete this lot/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete lot$/i }));
    await waitFor(() => expect(api.deleteLot).toHaveBeenCalledWith("l1"));
    expect(api.removeHolding).not.toHaveBeenCalled();
  });
  it("deleting the LAST lot removes the position instead of leaving 0 shares", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue([twoLots[0]]) });
    await openPosition(api, /Reddit/i);
    await userEvent.click(await screen.findByRole("button", { name: /edit lot 10 shares/i }));
    await userEvent.click(screen.getByRole("button", { name: /removes the position/i }));
    expect(screen.getByText(/deleting it removes RDDT from your portfolio/i)).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog", { name: /confirm delete/i })).getByRole("button", { name: /^remove position$/i }));
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalledWith("h1"));
    expect(api.deleteLot).not.toHaveBeenCalled();
    await screen.findByTestId("net-worth");   // back home
  });
  it("0-share rows (a holding with no lots) never list and never lead Movers", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),
      row({ holding_id: "hz", symbol: "MSFT", name: "Microsoft", qty: 0, value: null, cost_basis: null, avg_cost: null, total_gl: null, change_pct: 3.23 }),
      row({ holding_id: "hn", symbol: "AAPL", name: "Apple", qty: null, value: null, cost_basis: null, avg_cost: null, total_gl: null, change_pct: 9 }),
    ]) });
    render(<App api={api} />);
    await within(await screen.findByTestId("positions-card")).findByText(/RDDT/);
    expect(document.body.textContent).not.toMatch(/MSFT|Microsoft|AAPL|Apple/);
  });
});

describe("C4 ordering + FX", () => {
  const book = (): PortfolioRow[] => [
    row({ holding_id: "k1", symbol: "000660.KS", name: "SK hynix", currency: "KRW", price: 186000, value: 9_310_000, cost_basis: 5_000_000, total_gl: 4_310_000, qty: 50, change_pct: 0 }),
    row({ holding_id: "b1", symbol: "BTC", name: "Bitcoin", kind: "crypto", qty: 0.35, price: 83000, value: 29_050, cost_basis: 20_000, total_gl: 9_050, change_pct: 0 }),
    row({ holding_id: "c1", symbol: "$CASH", name: "Cash (USD)", kind: "cash", account: "bank", qty: 15000, price: 1, value: 15000, cost_basis: 15000, total_gl: 0, change_pct: 0 }),
  ];
  it("positions sort by value in the base currency, not raw native value", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(book()) })} />);
    const card = await screen.findByTestId("positions-card");
    await waitFor(() => {
      const order = within(card).getAllByRole("button").map((b) => b.textContent ?? "");
      expect(order[0]).toMatch(/BTC/);                 // $29,050
      expect(order[1]).toMatch(/CASH|Cash/);           // $15,000
      expect(order[2]).toMatch(/SK hynix|000660/);     // ₩9.31M ≈ $6,746
    });
  });
  it("cold open paints the cached total WITH the cached rates: no dip while FX loads", async () => {
    localStorage.setItem("assetly-book:u-test", JSON.stringify({ v: 2, profile, rows: book(), fx: { USD: 1, KRW: 1380 } }));
    const never = new Promise<never>(() => {});
    const api = stubApi({ getPortfolio: vi.fn().mockReturnValue(never), getFxRates: vi.fn().mockReturnValue(never), getProfile: vi.fn().mockReturnValue(never) });
    render(<App api={api} />);
    // 29,050 + 15,000 + 9,310,000/1380 (6,746) = $50,796, on the very first paint
    expect((await screen.findByTestId("net-worth")).textContent).toBe("$50,796");
    expect(screen.queryByText(/awaiting FX rate/i)).toBeNull();
  });
  it("a v1 cache (no rates) still paints, and the next write is v2 with the rates", async () => {
    localStorage.setItem("assetly-book:u-test", JSON.stringify({ v: 1, profile, rows: book() }));
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(book()) })} />);
    await screen.findByTestId("net-worth");
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("assetly-book:u-test")!);
      expect(saved.v).toBe(2);
      expect(saved.fx).toEqual({ USD: 1, KRW: 1380 });
    });
    expect(screen.getByTestId("net-worth").textContent).toBe("$50,796");
  });
  it("a failed FX read keeps the last good rates", async () => {
    localStorage.setItem("assetly-book:u-test", JSON.stringify({ v: 2, profile, rows: book(), fx: { USD: 1, KRW: 1380 } }));
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(book()), getFxRates: vi.fn().mockRejectedValue(new Error("down")) })} />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("assetly-book:u-test")!).fx).toEqual({ USD: 1, KRW: 1380 }));
    expect(screen.getByTestId("net-worth").textContent).toBe("$50,796");
  });
});

describe("C5 zero and cash", () => {
  it("a move that rounds to zero is a neutral $0, never a red -$0", async () => {
    // 0.5 sh × $224 moving -0.05% = -$0.06
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({ symbol: "NVDA", name: "NVIDIA", qty: 0.5, price: 224, value: 112, cost_basis: 110, total_gl: 2, change_pct: -0.05 })]) });
    render(<App api={api} />);
    const day = await screen.findByTestId("total-day");
    expect(day.textContent).not.toMatch(/-\$0/);
    expect(day.textContent).toMatch(/^\$0 /);
    expect(day.className).not.toMatch(/loss|gain/);
    expect(document.body.textContent).not.toMatch(/-\$0\b/);
  });
  it("cash rows carry no daily change", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([
      row({}),
      row({ holding_id: "c1", symbol: "$CASH", name: "Cash (USD)", kind: "cash", account: "bank", qty: 15000, price: 1, value: 15000, cost_basis: 15000, total_gl: 0, change_pct: 0 }),
    ]) });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    const cashRow = (await within(card).findAllByRole("button")).find((b) => /cash balance/.test(b.textContent ?? ""))!;
    expect(cashRow.textContent).not.toMatch(/today|0\.00%/);
  });
  it("the cash detail leads with the balance, not a $1.00 price and a 0.00% move", async () => {
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([row({ holding_id: "c1", symbol: "$CASH", name: "Cash (USD)", nickname: "HYSA", kind: "cash", account: "bank", qty: 15000, price: 1, value: 15000, cost_basis: 15000, total_gl: 0, change_pct: 0 })]),
      getLots: vi.fn().mockResolvedValue([{ id: "lc", holding_id: "c1", qty: 15000, cost_per_share: 1, acquired_on: null, note: null }]),
    });
    await openPosition(api, /cash balance/i);
    expect((await screen.findByTestId("position-headline")).textContent).toBe("$15,000");
    expect(document.body.textContent).not.toMatch(/since last close|Avg cost|Total G\/L/);
  });
});
