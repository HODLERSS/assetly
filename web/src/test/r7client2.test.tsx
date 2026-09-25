// Round-7 second batch (1.0.1), client side: narration that lands after its brief shows ▶ on the open Home, a
// reload keeps the chosen edition and the open reader, the brief date never truncates, AX5 rows wrap, and
// Add position's "Change" starts from an empty search. Same harness as r7client.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { App } from "../App";
import type { DailyBrief } from "../lib/api";
import { setPricesDown } from "../lib/net";
import { stubApi } from "./fixtures";

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

const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const brief = (edition: DailyBrief["edition"], lede: string, genAt: string, over: Partial<DailyBrief> = {}): DailyBrief =>
  ({ brief_date: genAt.slice(0, 10), edition, generated_at: genAt,
     sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: genAt, day_sign: 1, held: ["RDDT"] }, ...over });

describe("m1 narration that lands after its brief", () => {
  it("▶ appears on the open Home once the audio is attached, with no navigation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const genAt = at(5);
    const getDailyBriefs = vi.fn().mockResolvedValue([brief("close", "Reddit closed higher.", genAt)]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    const card = await screen.findByTestId("brief-card");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(within(card).queryByTestId("brief-listen")).toBeNull();
    getDailyBriefs.mockResolvedValue([brief("close", "Reddit closed higher.", genAt, { audio_path: "u-test/close.mp3" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    await waitFor(() => expect(within(screen.getByTestId("brief-card")).getByTestId("brief-listen")).toBeTruthy());
    // the same brief with its narration is not a new arrival: no "ready" banner for it
    expect(screen.queryByTestId("brief-banner")).toBeNull();
  });
});

describe("m2 a reload keeps the reader where the user left it", () => {
  it("the chosen older edition and the open reader survive `online`", async () => {
    const getDailyBriefs = vi.fn().mockResolvedValue([
      brief("close", "Yesterday's close.", at(18 * 60)),
      brief("assessment", "A US large-cap book.", at(10)),
    ]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    const card = await screen.findByTestId("brief-card");
    await userEvent.click(within(card).getByRole("button", { name: "Close" }));
    await userEvent.click(within(card).getByTestId("brief-lede"));
    expect(within(card).getByTestId("brief-lede").getAttribute("aria-expanded")).toBe("true");
    const calls = getDailyBriefs.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(getDailyBriefs.mock.calls.length).toBeGreaterThan(calls));
    const after = screen.getByTestId("brief-card");
    expect(after).toBe(card);   // not remounted
    expect(within(after).getByRole("button", { name: "Close" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(after).getByTestId("brief-lede").textContent).toBe("Yesterday's close.");
    expect(within(after).getByTestId("brief-lede").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("m3 / m5 layout at narrow widths and AX5", () => {
  const css = readFileSync(`${process.cwd()}/src/client.css`, "utf8");
  it("the brief date is its own non-shrinking part of the title", async () => {
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue([brief("assessment", "A US large-cap book.", at(10))]) })} />);
    const title = await screen.findByTestId("brief-title");
    const date = within(title).getByTestId("brief-date");
    expect(title.textContent).toMatch(/^Portfolio Assessment · /);
    expect(date.className).toBe("brief-title-date");
    expect(css).toMatch(/\.brief-title \.brief-title-date \{[^}]*flex: none;[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.brief-title \.brief-title-name \{[^}]*text-overflow: ellipsis/);
  });
  it("AX5: the investor row wraps its Edit under the label, and '14m ago' never splits", () => {
    expect(css).toMatch(/\.text-large \.investor-row \{ flex-wrap: wrap; \}/);
    expect(css).toMatch(/\.insights-head > \.sub, \.insights-head > \.insights-toggle \{ flex: none; white-space: nowrap; \}/);
  });
});

describe("m6 Add position: Change starts from an empty search", () => {
  it("the old query is gone after Change", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    const box = screen.getByLabelText("Ticker or name") as HTMLInputElement;
    await userEvent.type(box, "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    expect((screen.getByLabelText("Ticker or name") as HTMLInputElement).value).toBe("");
  });
});
