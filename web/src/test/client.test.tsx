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
// moveSession runs for real, against a clock a test may pin (sessionNow.at).
const sessionNow = vi.hoisted(() => ({ at: undefined as Date | undefined }));
vi.mock("../lib/markets", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/markets")>();
  return { ...real, moveSession: (r: Parameters<typeof real.moveSession>[0], now?: Date) => real.moveSession(r, now ?? sessionNow.at ?? new Date()),
           isMarketOpen: (m: string) => m === "US" || m === "CRYPTO",
           sessionLabel: () => "US open", moverMode: () => ({ kind: "open" }),
           moverEligible: (r: { symbol: string; kind: string }) => { const m = real.marketOf(r); return m === "US" || m === "CRYPTO"; } };
});

import { App } from "../App";
import { profile, row, stubApi } from "./fixtures";
import type { Api, PortfolioRow } from "../lib/api";

beforeEach(() => { sessionNow.at = undefined; try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ } });

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
    // it asks before folding one position into another (r3 power-user)
    const sheet = await screen.findByRole("dialog", { name: /confirm merge/i });
    expect(sheet.textContent).toMatch(/Merge into your IRA RDDT position\?/);
    expect(api.setHoldingAccount).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: /^merge$/i }));
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
    await userEvent.click(screen.getByRole("button", { name: /delete lot and position/i }));
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

describe("C6 today never mixes sessions", () => {
  const FRI = new Date("2026-09-25T15:00:00Z");             // Fri 11:00 ET, KRX shut for Chuseok
  const mixed = () => [
    row({ value: 1011, change_pct: 1.0891, as_of: "2026-09-25T14:59:00Z" }),
    row({ holding_id: "k1", symbol: "005930.KS", name: "Samsung Electronics", currency: "KRW", price: 250000, qty: 55.2,
          value: 13_800_000, cost_basis: 10_000_000, total_gl: 3_800_000, change_pct: 3.0, as_of: "2026-09-23T06:30:00Z" }),
  ];
  it("Home labels each market's move by its own session instead of one blended 'today'", async () => {
    sessionNow.at = FRI;
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(mixed()) })} />);
    await waitFor(() => expect(screen.getByTestId("total-day").textContent).toBe("US +$11 (+1.09%) today"));
    expect(screen.getByTestId("total-day-other").textContent).toBe("Korea +$291 (+3.00%) · Wed close");
    expect(document.body.textContent).not.toMatch(/\+\$302/);   // the blended sum is gone
    const krRow = within(screen.getByTestId("positions-card")).getAllByRole("button").find((b) => /005930/.test(b.textContent ?? ""))!;
    expect(krRow.textContent).toMatch(/Wed close/);
    expect(krRow.textContent).not.toMatch(/today/);
  });
  it("the position detail dates a KRX close in Seoul time", async () => {
    sessionNow.at = FRI;
    await openPosition(stubApi({ getPortfolio: vi.fn().mockResolvedValue(mixed()) }), /005930/);
    expect(await screen.findByText(/since last close · Wed close/)).toBeTruthy();
  });
  it("a single-session book keeps the plain 'today' headline (C6)", async () => {
    render(<App api={stubApi()} />);
    expect((await screen.findByTestId("total-day")).textContent).toMatch(/\+\$240 \(\+5\.26%\) today$/);
    expect(screen.queryByTestId("total-day-other")).toBeNull();
  });
});

describe("C7 first run: the assessment wait is visible and honest", () => {
  async function addRun(api: Api) {
    await openAdd(api);
    await pickMara();
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await screen.findByTestId("added-strip");
    await userEvent.click(screen.getByRole("button", { name: /done/i }));
  }
  it("after a run of adds Home keeps a 'Your first assessment' card (no toast), polling for it", async () => {
    const api = stubApi();
    await addRun(api);
    const card = await screen.findByTestId("assessment-card");
    expect(card.textContent).toMatch(/Your first assessment/);
    expect(card.textContent).toMatch(/Usually takes 2 to 4 minutes/);
    await waitFor(() => expect(api.getAssessmentStatus).toHaveBeenCalled());
    expect(localStorage.getItem("assetly-assess:u-test")).toBeTruthy();   // survives a reload
  });
  it("the intelligence step ticks when it lands, and the card links to it", async () => {
    const api = stubApi({ getAssessmentStatus: vi.fn().mockResolvedValue({ status: "pending", generatedAt: null, intelligenceAt: new Date().toISOString(), hadEarlier: false }) });
    await addRun(api);
    const card = await screen.findByTestId("assessment-card");
    await within(card).findByRole("button", { name: /see today's news/i });
    expect(card.querySelector('li[data-done="true"]')).toBeTruthy();
  });
  it("an earlier assessment makes it an update, not a first", async () => {
    const api = stubApi({ getAssessmentStatus: vi.fn().mockResolvedValue({ status: "pending", generatedAt: null, intelligenceAt: null, hadEarlier: true }) });
    await addRun(api);
    await waitFor(() => expect(screen.getByTestId("assessment-card").textContent).toMatch(/Updating your assessment/));
  });
  it("when it lands the card goes and the stored run is cleared", async () => {
    const at = new Date(Date.now() + 1000).toISOString();
    const getDailyBriefs = vi.fn().mockResolvedValue([]);
    const api = stubApi({ getDailyBriefs, getAssessmentStatus: vi.fn().mockResolvedValue({ status: "ready", generatedAt: at, intelligenceAt: at, hadEarlier: false }) });
    await addRun(api);
    await waitFor(() => expect(screen.queryByTestId("assessment-card")).toBeNull());
    expect(localStorage.getItem("assetly-assess:u-test")).toBeNull();
  });
  it("a chain that could not start shows an error with Try again, which kicks it again", async () => {
    const brokerageConnected = vi.fn().mockRejectedValueOnce(new Error("We couldn't start your assessment.")).mockResolvedValue(undefined);
    const api = stubApi({ brokerageConnected });
    await addRun(api);
    const card = await screen.findByTestId("assessment-card");
    await within(card).findByText(/only the write-up is missing\. Try again\./i);   // the raw cause is never shown
    await userEvent.click(within(card).getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(brokerageConnected).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("assessment-card").textContent).toMatch(/Usually takes 2 to 4 minutes/));
  });
  it("a run in flight resumes after a reload; one past the long timeout says so and offers a retry", async () => {
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date(Date.now() - 90_000).toISOString(), first: true }));
    const { unmount } = render(<App api={stubApi()} />);
    expect((await screen.findByTestId("assessment-card")).textContent).toMatch(/started 1 min ago/);
    unmount();
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date(Date.now() - 25 * 60_000).toISOString(), first: true }));
    render(<App api={stubApi()} />);
    const card = await screen.findByTestId("assessment-card");
    await within(card).findByText(/taking longer than usual/i);
    expect(within(card).getByRole("button", { name: /try again/i })).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("assessment-card")).toBeNull();
    expect(localStorage.getItem("assetly-assess:u-test")).toBeNull();
  });
  it("the first run arms a next-step hint that leads to the obvious moves, and it can be put away", async () => {
    const api = stubApi();
    await addRun(api);
    const hint = await screen.findByTestId("next-steps");
    expect(within(hint).getByRole("button", { name: /add another/i })).toBeTruthy();
    await userEvent.click(within(hint).getByRole("button", { name: /dismiss next steps/i }));
    expect(screen.queryByTestId("next-steps")).toBeNull();
    expect(localStorage.getItem("assetly-next-steps")).toBe("done");
  });
  it("existing users never see the next-step hint unasked", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    expect(screen.queryByTestId("next-steps")).toBeNull();
  });
});

describe("C8 onboarding keeps what you gave it", () => {
  const fresh = () => stubApi({ getProfile: vi.fn().mockResolvedValue({ ...profile, onboarded_at: null }), getPortfolio: vi.fn().mockResolvedValue([]) });
  it("says Step 1 of 3 and 'about a minute' for the six questions", async () => {
    render(<App api={fresh()} />);
    await screen.findByTestId("investor-quiz");
    expect(screen.getByTestId("ob-step").textContent).toMatch(/^Step 1 of 3 · About a minute/);
    expect(screen.getByText(/Question 1 of 6/)).toBeTruthy();
  });
  it("Skip keeps the answers already given and defaults only the rest", async () => {
    const api = fresh();
    render(<App api={api} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByRole("button", { name: "AI & tech" }));
    await userEvent.click(screen.getByRole("button", { name: "Crypto" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stay on top of what I own" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await userEvent.click(await screen.findByTestId("ob-skip"));
    await waitFor(() => expect(api.completeOnboarding).toHaveBeenCalledWith(["US"], "USD",
      { styles: ["ai_tech", "crypto"], purpose: ["watch"], horizon: ["3-10y"], target: ["8-12%"], risk: ["hold"], level: ["novice"],
        defaulted: ["horizon", "target", "risk", "level"] }));
  });
  it("every step after the first has Back, and the quiz comes back where it was left", async () => {
    render(<App api={fresh()} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByRole("button", { name: "Growth" }));
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await screen.findByTestId("ob-connect");
    expect(screen.getByTestId("ob-step").textContent).toBe("Step 2 of 3");
    await userEvent.type(screen.getByLabelText(/find your first position/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    expect((await screen.findByTestId("ob-step")).textContent).toBe("Step 3 of 3");
    await userEvent.click(screen.getByRole("button", { name: /← back/i }));
    await screen.findByTestId("ob-connect");
    await userEvent.click(screen.getByRole("button", { name: /← back/i }));
    await screen.findByTestId("investor-quiz");
    expect(screen.getByRole("button", { name: "Growth" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("a reload (or the web round trip through the brokerage portal) resumes the quiz mid-way", async () => {
    const { unmount } = render(<App api={fresh()} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByRole("button", { name: "Growth" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Question 2 of 6/);
    unmount();
    render(<App api={fresh()} />);
    await screen.findByText(/Question 2 of 6/);
    await userEvent.click(screen.getByRole("button", { name: /← back/i }));
    expect(screen.getByRole("button", { name: "Growth" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("coming back from a declined connect lands on the holdings step with the answers kept", async () => {
    const { unmount } = render(<App api={fresh()} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByRole("button", { name: "Growth" }));
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await screen.findByTestId("ob-connect");
    unmount();
    window.history.replaceState({}, "", "/?snaptrade=denied");
    const api = fresh();
    render(<App api={api} />);
    await screen.findByTestId("ob-connect");
    expect(screen.queryByTestId("investor-quiz")).toBeNull();
    await userEvent.click(screen.getByTestId("ob-skip"));
    await waitFor(() => expect(vi.mocked(api.completeOnboarding).mock.calls[0][2]).toMatchObject({ styles: ["growth"] }));
    window.history.replaceState({}, "", "/");
  });
});

describe("C9 search and news", () => {
  it("typing is debounced, and an older, slower answer never replaces the newer one", async () => {
    const searchSymbols = vi.fn((q: string) => q.toLowerCase() === "tes"
      ? new Promise((res) => setTimeout(() => res([{ symbol: "AEHR", name: "Aehr Test Systems", exchange: "NASDAQ", currency: "USD", kind: "equity" }]), 400))
      : Promise.resolve([{ symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", currency: "USD", kind: "equity" }]));
    const api = stubApi({ searchSymbols: searchSymbols as unknown as Api["searchSymbols"] });
    await openAdd(api);
    const input = screen.getByLabelText(/ticker or name/i);
    await userEvent.type(input, "tes");
    await new Promise((r) => setTimeout(r, 250));      // "tes" fires (slow answer in flight)...
    await userEvent.type(input, "la");                 // ...then "tesla" answers first
    await screen.findByRole("button", { name: /TSLA Tesla/ });   // "Tesla, Inc." as people say it
    await new Promise((r) => setTimeout(r, 500));      // the "tes" answer arrives late
    expect(screen.queryByRole("button", { name: /Aehr/ })).toBeNull();
    expect(searchSymbols.mock.calls.map((c) => c[0])).toEqual(["tes", "tesla"]);   // one call per pause, not per key
  });
  it("no match says what to try, and only once the search has answered", async () => {
    const api = stubApi({ searchSymbols: vi.fn().mockResolvedValue([]) });
    await openAdd(api);
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "zzzq");
    expect(await screen.findByText(/No match for “zzzq”\. Try a ticker \(AAPL\) or a company name\./)).toBeTruthy();
  });
  it("News shows one copy of a story repeated across tickers, with entities decoded", async () => {
    const api = stubApi({ getNews: vi.fn().mockResolvedValue([
      { id: "a", symbol: "RDDT", title: "These are stocks getting lifted up by Meta&#39;s Muse", url: "https://x/1", source: "Yahoo", published_at: null },
      { id: "b", symbol: "RDDT", title: "These are stocks getting lifted up by Meta's Muse", url: "https://y/2", source: "Yahoo", published_at: null },
      { id: "c", symbol: "RDDT", title: "AT&amp;T and Reddit", url: "https://z/3", source: "Yahoo", published_at: null },
    ]) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    expect(await screen.findAllByText("These are stocks getting lifted up by Meta's Muse")).toHaveLength(1);
    expect(screen.getByText("AT&T and Reddit")).toBeTruthy();
  });
  it("a failed news load offers a Retry that works (no gesture promised)", async () => {
    const getNews = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue([
      { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: null }]);
    render(<App api={stubApi({ getNews })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /^news$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn't load news/);
    expect(alert.textContent).not.toMatch(/pull/i);
    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    await screen.findByText("Reddit posts strong quarter");
  });
});
