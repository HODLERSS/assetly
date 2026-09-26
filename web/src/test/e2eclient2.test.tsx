// e2e p10 (settings and connect), client side: a move the same-day rule zeroed says so ("since your buy (Fri)"),
// the link-sent screen has a way back, the Ask fallback offers to ask again, and an investor-profile save says it
// saved.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { AuthScreen } from "../screens/Auth";
import { isHonestFallback } from "../screens/Ask";
import { sinceBuyLabel } from "../lib/portfolio";
import { setPricesDown } from "../lib/net";
import { row, stubApi } from "./fixtures";

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
afterEach(() => { vi.useRealTimers(); setPricesDown(false); });

const tabs = () => within(screen.getByRole("navigation", { name: "Tabs" }));

describe("1 a move the same-day rule zeroed is labelled, not left as 0.00%", () => {
  const SAT = new Date("2026-09-26T15:00:00Z");   // Saturday 11 AM ET: Friday is the last US session
  const aapl = row({ symbol: "AAPL", name: "Apple", qty: 10, price: 200, value: 2000, cost_basis: 2000, avg_cost: 200, total_gl: 0, change_pct: 1.53, as_of: "2026-09-25T20:00:00Z" });
  it("the helper: zeroed by a same-day lot -> 'since your buy (Fri)'; a real move -> nothing", () => {
    expect(sinceBuyLabel({ ...aapl, day_change: 0 }, SAT)).toBe("since your buy (Fri)");
    expect(sinceBuyLabel({ ...aapl, day_change: 30 }, SAT)).toBeNull();
    expect(sinceBuyLabel(aapl, SAT)).toBeNull();   // no same-day lot: the price move stands
  });
  it("Home row and the position headline both say it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SAT);
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([aapl]),
      getRecentLots: vi.fn().mockResolvedValue([{ holding_id: "h1", qty: 10, cost_per_share: 200, acquired_on: "2026-09-25" }]),
    });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    // the row keeps to the figure and its dot (owner, home-calm); the words are on the position screen
    const aaplRow = await within(card).findByRole("button", { name: /Apple/ });
    await waitFor(() => expect(aaplRow.textContent).toMatch(/0\.00% \(\$0\)/));
    expect(aaplRow.textContent).not.toMatch(/since your buy/);
    expect(aaplRow.querySelector(".session-dot")!.getAttribute("aria-label")).toBe("Closed, Fri close");
    await userEvent.click(aaplRow);
    const head = await screen.findByTestId("position-headline");
    expect(head.nextElementSibling!.textContent).toMatch(/^0\.00% · since your buy \(Fri\) · closed 4:00 PM ET$/);
  });
});

describe("2 the link-sent screen has a way back", () => {
  it("'Use a different email or a password' returns to the form, no reload", async () => {
    render(<AuthScreen />);
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    const sent = await screen.findByTestId("link-sent");
    expect(sent.textContent).toContain("Link sent to me@example.com");
    await userEvent.click(within(sent).getByRole("button", { name: "Use a different email or a password" }));
    expect(screen.getByTestId("email-form")).toBeTruthy();
    expect(screen.queryByTestId("link-sent")).toBeNull();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("me@example.com");   // kept for a quick edit
    expect(screen.getByTestId("toggle-password")).toBeTruthy();
  });
});

describe("3 the Ask fallback offers to ask again", () => {
  const stub = "I couldn't put a complete answer together just now. Here's what I can tell you:\n• Your holdings: RDDT (stock) 100%.\n• Try asking again, or rephrase the question.";
  it("recognises the server's honest fallback, in both languages", () => {
    expect(isHonestFallback(stub)).toBe(true);
    expect(isHonestFallback("지금은 완전한 답변을 드리지 못했습니다. …")).toBe(true);
    expect(isHonestFallback("Your book is 100% Reddit.")).toBe(false);
  });
  it("'Try again' under the stub re-asks the same question", async () => {
    const ask = vi.fn().mockResolvedValueOnce({ answer: stub, followups: [] }).mockResolvedValue({ answer: "Concentrated: one stock is the whole book.", followups: [] });
    render(<App api={stubApi({ ask })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /ask/i }));
    await userEvent.click(await screen.findByRole("button", { name: "How healthy is my portfolio?" }));
    const again = await screen.findByTestId("ask-try-again");
    expect(screen.queryByTestId("ask-error")).toBeNull();   // it is a stub answer, not an error
    await userEvent.click(again);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[1][0]).toBe("How healthy is my portfolio?");
    await screen.findByText("Concentrated: one stock is the whole book.");
    expect(screen.queryByTestId("ask-try-again")).toBeNull();
  });
});

describe("4 saving the investor profile says so", () => {
  it("a 'Saved' line after Save", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    const card = await screen.findByTestId("investor-card");
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateInvestor).toHaveBeenCalled());
    expect((await screen.findByTestId("investor-saved")).textContent).toMatch(/^Saved\./);
  });
});
