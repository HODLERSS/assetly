// r10 native, data loss: deleting a lot could remove the whole position. A delete of a stale or ghost lot, with the
// screen's lot count reading 1, turned "Delete lot" into "Remove position" and wiped a 1,000-share VOO. The holding
// now goes only when the SERVER says, at confirm time, that the lot being deleted is its one lot.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import type { Lot } from "../lib/api";
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

const voo = row({ holding_id: "hv", symbol: "VOO", name: "Vanguard S&P 500 ETF", qty: 1000.001, price: 600, value: 600_000.6, cost_basis: 500_000, avg_cost: 500 });
const big: Lot = { id: "l-big", holding_id: "hv", qty: 1000, cost_per_share: 500, acquired_on: "2024-01-02", note: null };
const tiny: Lot = { id: "l-tiny", holding_id: "hv", qty: 0.001, cost_per_share: 500, acquired_on: "2026-09-25", note: null };

async function openVoo(api: ReturnType<typeof stubApi>) {
  render(<App api={api} />);
  await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Vanguard|VOO/ }));
  await screen.findByRole("heading", { name: /^lots$/i });
}
const deleteLotRow = async (qty: string) => {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^Edit lot ${qty.replace(".", "\\.")} shares$`) }));
  await userEvent.click(screen.getByRole("button", { name: /^Delete (this lot|lot and position)$/ }));
  await waitFor(() => expect(screen.getByTestId("confirm-delete-lot").hasAttribute("disabled")).toBe(false));
  await userEvent.click(within(screen.getByRole("dialog", { name: "Confirm delete" })).getByRole("button", { name: /^(Delete lot|Remove position)$/ }));
};

describe("deleting a lot never removes a position that still holds another lot", () => {
  it("two lots, delete one, a stale read shows the deleted lot alone, delete it again: the holding remains", async () => {
    // the server's truth over time: both lots, then only the 1,000-share lot
    let server: Lot[] = [big, tiny];
    // the first lot read after the delete is STALE: it shows the deleted 0.001 lot alone (a ghost); every other
    // read is the truth
    let staleNext = false;
    const getLots = vi.fn().mockImplementation(async () => {
      if (staleNext) { staleNext = false; return [tiny]; }
      return server;
    });
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([voo]),
      getLots,
      deleteLot: vi.fn().mockImplementation(async (id: string) => { server = server.filter((l) => l.id !== id); staleNext = true; }),
      removeHolding: vi.fn().mockResolvedValue(undefined),
    });
    await openVoo(api);
    await deleteLotRow("0.001");
    await waitFor(() => expect(api.deleteLot).toHaveBeenCalledWith("l-tiny"));
    // the stale read left the ghost 0.001 lot on screen, alone: it reads as "the last lot"
    await screen.findByRole("button", { name: /^Edit lot 0\.001 shares$/ });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });   // past the tap guard
    await deleteLotRow("0.001");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(api.removeHolding).not.toHaveBeenCalled();
    expect(server.map((l) => l.id)).toEqual(["l-big"]);   // the 1,000 shares are still there
  });
  it("the real last lot (the server agrees) still removes the position, as its confirm said", async () => {
    const api = stubApi({
      getPortfolio: vi.fn().mockResolvedValue([voo]),
      getLots: vi.fn().mockResolvedValue([big]),
      removeHolding: vi.fn().mockResolvedValue(undefined),
    });
    await openVoo(api);
    await deleteLotRow("1000");
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalledWith("hv"));
    expect(api.deleteLot).not.toHaveBeenCalled();
  });
  it("a lot read that lands while the confirm is open does not change what it deletes", async () => {
    let answer!: (v: Lot[]) => void;
    const getLots = vi.fn()
      .mockImplementationOnce(async () => [big, tiny])
      .mockImplementationOnce(() => new Promise<Lot[]>((r) => { answer = r; }))   // the confirm-time check, held
      .mockImplementation(async () => [big]);
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([voo]), getLots, removeHolding: vi.fn(), deleteLot: vi.fn().mockResolvedValue(undefined) });
    await openVoo(api);
    await deleteLotRow("0.001");
    // the deleted lot left the list at once: no ghost row to tap again
    expect(screen.queryByRole("button", { name: /^Edit lot 0\.001 shares$/ })).toBeNull();
    await act(async () => { answer([big, tiny]); });
    await waitFor(() => expect(api.deleteLot).toHaveBeenCalledWith("l-tiny"));
    expect(api.removeHolding).not.toHaveBeenCalled();
  });
  it("for 400ms after a lot sheet closes, the page's Remove position takes no tap", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([voo]), getLots: vi.fn().mockResolvedValue([big, tiny]), deleteLot: vi.fn().mockResolvedValue(undefined) });
    await openVoo(api);
    await deleteLotRow("0.001");
    await waitFor(() => expect(screen.queryByTestId("confirm-delete-lot")).toBeNull());
    const remove = screen.getByTestId("remove-position") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect((screen.getByTestId("remove-position") as HTMLButtonElement).disabled).toBe(false);
  });
});
