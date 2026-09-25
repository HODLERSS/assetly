// Round-2 launch fixes (1.0.1): what a new user meets in the first five minutes. Sign-in layout, scroll
// on navigation, one write per tap, an assessment that never claims to be current while a newer one is
// being written, intelligence about holdings you no longer own, and briefs dated against the live book.
// Same harness as client.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
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
import { AuthScreen } from "../screens/Auth";
import { profile, row, stubApi } from "./fixtures";
import type { DailyBrief, Insight, PortfolioRow } from "../lib/api";
import { briefFreshness } from "../components/BriefCard";
import { heldOnly, mentions, noteRemoval, readRemovals } from "../lib/heldIntel";
import { cashName, displayName, formatDate, labelParts, signedMoney, signedPct } from "../lib/format";
import { formatAmountInput, readAmount } from "../lib/numbers";
import { rankSymbols } from "../lib/search";
import { latestSession } from "../components/PriceChart";
import pkg from "../../package.json";

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  (window.scrollTo as ReturnType<typeof vi.fn>).mockClear?.();
});

/** A promise the test settles by hand: the write is "in flight" until then. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const two = (): PortfolioRow[] => [row({}), row({ holding_id: "h2", symbol: "NVDA", name: "NVIDIA", value: 3000, change_pct: -1.2 })];
async function openRddt(api: ReturnType<typeof stubApi>) {
  render(<App api={api} />);
  await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
  await screen.findByRole("heading", { name: /^lots$/i });
}

describe("F1 sign-in sits in the safe area", () => {
  it("is not a .screen (no tab-bar padding) and centres between the insets; legal is the last line", () => {
    render(<AuthScreen />);
    const main = screen.getByRole("main");
    expect(main.className).toBe("auth-screen");
    expect(main.getAttribute("style")).toBeNull();   // the layout lives in CSS with env(safe-area-inset-*)
    const kids = [...main.children];
    expect(kids.at(-1)!.getAttribute("data-testid")).toBe("auth-legal");
    expect(kids.indexOf(screen.getByTestId("auth-github"))).toBeLessThan(kids.indexOf(screen.getByTestId("auth-legal")));
  });
  it("the stylesheet pads .auth-screen by both safe-area insets", async () => {
    const css = (await import("node:fs")).readFileSync(`${process.cwd()}/src/client.css`, "utf8");
    const rule = css.slice(css.indexOf(".auth-screen {"), css.indexOf("}", css.indexOf(".auth-screen {")));
    expect(rule).toMatch(/safe-area-inset-top/);
    expect(rule).toMatch(/safe-area-inset-bottom/);
  });
});

describe("F2 scroll position on navigation", () => {
  it("opening a position starts at the top; Back to Home restores where the list was", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(two()) });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    await userEvent.click(within(card).getByRole("button", { name: /Reddit/i }));
    await screen.findByRole("heading", { name: /^lots$/i });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await userEvent.click(screen.getByRole("button", { name: /← home/i }));
    await screen.findByTestId("net-worth");
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 640, left: 0 });
  });
  it("a tab switch starts the new tab at the top", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /news/i }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
  });
});

describe("F3 one write per tap", () => {
  it("Add lot: a double tap saves ONE lot, and the button says Saving… while it is out", async () => {
    const d = deferred();
    const api = stubApi({ addLot: vi.fn().mockReturnValue(d.promise) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: "+ Lot" }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "50");
    await userEvent.dblClick(screen.getByRole("button", { name: /^add lot$/i }));
    const saving = screen.getByRole("button", { name: /saving/i });
    expect(saving.hasAttribute("disabled")).toBe(true);
    fireEvent.click(saving);   // even a click that reaches a disabled-looking button in the same frame
    expect(api.addLot).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /add lot/i })).toBeNull());
    expect(api.addLot).toHaveBeenCalledTimes(1);
  });
  it("Edit lot: Save changes twice in a row updates once", async () => {
    const d = deferred();
    const api = stubApi({ updateLot: vi.fn().mockReturnValue(d.promise) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /edit lot 10 shares/i }));
    await userEvent.dblClick(screen.getByRole("button", { name: /save changes/i }));
    expect(api.updateLot).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(); });
  });
  it("Delete lot: the confirm button deletes once", async () => {
    const d = deferred();
    const api = stubApi({ deleteLot: vi.fn().mockReturnValue(d.promise), getLots: vi.fn().mockResolvedValue([
      { id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: "2024-06-14", note: null },
      { id: "l2", holding_id: "h1", qty: 14, cost_per_share: 168, acquired_on: null, note: null },
    ]) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /edit lot 10 shares/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete this lot/i }));
    await userEvent.dblClick(screen.getByRole("button", { name: /^delete lot$/i }));
    expect(api.deleteLot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /deleting/i }).hasAttribute("disabled")).toBe(true);
    await act(async () => { d.resolve(); });
  });
  it("Remove position: a double tap removes once, shows Removing…, and Keep it is disabled meanwhile", async () => {
    const d = deferred();
    const api = stubApi({ removeHolding: vi.fn().mockReturnValue(d.promise), getPortfolio: vi.fn().mockResolvedValue(two()) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /^remove position$/i }));
    const dlg = screen.getByRole("dialog", { name: /confirm removal/i });
    await userEvent.dblClick(within(dlg).getByRole("button", { name: /^remove position$/i }));
    expect(api.removeHolding).toHaveBeenCalledTimes(1);
    expect(within(dlg).getByRole("button", { name: /removing/i })).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: /keep it/i }).hasAttribute("disabled")).toBe(true);
    await act(async () => { d.resolve(); });
    await screen.findByTestId("net-worth");
  });
  it("Change account: a double tap on an account moves once", async () => {
    const d = deferred<string>();
    const api = stubApi({ setHoldingAccount: vi.fn().mockReturnValue(d.promise) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /^change$/i }));
    await userEvent.dblClick(within(screen.getByRole("group", { name: /move to account/i })).getByRole("button", { name: "IRA" }));
    expect(api.setHoldingAccount).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve("h1"); });
  });
  it("Add position: a double tap adds once", async () => {
    const d = deferred();
    const api = stubApi({ addPosition: vi.fn().mockReturnValue(d.promise) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    const btn = screen.getByRole("button", { name: /^add position$/i });
    fireEvent.click(btn); fireEvent.click(btn);   // same frame: no render between the two taps
    expect(api.addPosition).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(); });
  });
});

const assessment = (over: Partial<DailyBrief> = {}): DailyBrief => ({
  brief_date: "2026-09-25", edition: "assessment", generated_at: new Date(Date.now() - 60_000).toISOString(),
  sections: { lede: "Your book is a pure AI-chip bet, with every dollar tied to Nvidia.", overnight: "", positions: [], desk_view: "", calendar: [] },
  ...over,
});

describe("F4 a stale assessment never reads as current while a newer one is written", () => {
  it("a pending run labels the older lede and hides the 'is ready' banner", async () => {
    // the newcomer's sequence: first assessment (NVDA only) exists, a later run of adds is still pending
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date().toISOString(), first: false }));
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(two()), getDailyBriefs: vi.fn().mockResolvedValue([assessment()]),
      getAssessmentStatus: vi.fn().mockResolvedValue({ status: "pending", generatedAt: null, intelligenceAt: null, hadEarlier: true }) });
    render(<App api={api} />);
    const card = await screen.findByTestId("brief-card");
    expect(card.getAttribute("data-stale")).toBe("true");
    expect(within(card).getByTestId("brief-asof").textContent).toMatch(/your last assessment, before today's changes/i);
    expect(screen.getByTestId("assessment-card").textContent).toMatch(/Updating your assessment/);
    expect(screen.queryByTestId("brief-banner")).toBeNull();
  });
  it("removing a position is a book change: the server is told at once and the run starts on the way out", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(two()) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /^remove position$/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: /confirm removal/i })).getByRole("button", { name: /^remove position$/i }));
    await screen.findByTestId("net-worth");
    expect(api.markAssessmentPending).toHaveBeenCalled();
    await waitFor(() => expect(api.brokerageConnected).toHaveBeenCalledTimes(1));
    expect(readRemovals("u-test").map((r) => r.symbol)).toEqual(["RDDT"]);
  });
  it("removing the LAST holding does not start an assessment of an empty book", async () => {
    const api = stubApi();
    await openRddt(api);
    await userEvent.click(screen.getByRole("button", { name: /^remove position$/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: /confirm removal/i })).getByRole("button", { name: /^remove position$/i }));
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalled());
    expect(api.brokerageConnected).not.toHaveBeenCalled();
  });
  it("the first add of a run marks the server's assessment pending once, not per add", async () => {
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    for (let i = 0; i < 2; i++) {
      await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
      await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
      await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
      await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
      await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
      await screen.findByTestId("added-strip");
    }
    expect(api.markAssessmentPending).toHaveBeenCalledTimes(1);
  });
});

describe("F5 intelligence only about what you hold", () => {
  const ins = (over: Partial<Insight> = {}): Insight => ({
    bullets: ["Pepsi near yearly lows as snack volumes slip.", "RDDT up 5% on ad revenue."],
    news5: ["Ford halted F-150 production.", "Reddit adds AI search."], windows: null, model: "m", generated_at: new Date().toISOString(), ...over,
  });
  const book = [row({})];
  it("per-bullet symbols (server): a bullet naming a holding no longer held is dropped", () => {
    const v = heldOnly(ins({ bullet_symbols: [["PEP"], ["RDDT"]], news5_symbols: [["F"], ["RDDT"]] }), book);
    expect(v.bullets).toEqual(["RDDT up 5% on ad revenue."]);
    expect(v.news5).toEqual(["Reddit adds AI search."]);
    expect(v.hidden).toBe(2);
  });
  it("held_symbols only: the removed ones are found by ticker or company name in the text", () => {
    const v = heldOnly(ins({ held_symbols: ["RDDT", "PEP", "F"] }), book, [{ symbol: "PEP", name: "PepsiCo, Inc.", at: new Date().toISOString() }, { symbol: "F", name: "Ford Motor Company", at: new Date().toISOString() }]);
    expect(v.bullets).toEqual(["RDDT up 5% on ad revenue."]);
    expect(v.news5).toEqual(["Reddit adds AI search."]);
  });
  it("older rows: this device's removals are the fallback", () => {
    noteRemoval("u-x", { symbol: "PEP", name: "PepsiCo, Inc." });
    const v = heldOnly(ins(), book, readRemovals("u-x"));
    expect(v.bullets).toEqual(["RDDT up 5% on ad revenue."]);
    expect(v.news5.length).toBe(2);   // Ford was never removed on this device: nothing to hide
  });
  it("a one-letter ticker only matches as $F or (F), never the letter", () => {
    expect(mentions("F-150 recall hits Ford", "F", null)).toBe(false);
    expect(mentions("Shares of (F) fell", "F", null)).toBe(true);
    expect(mentions("Ford halted F-150 production.", "F", "Ford Motor Company")).toBe(true);
    expect(mentions("Samsung (005930) and SK hynix", "000660.KS", "SK hynix Inc.")).toBe(false);   // "SK" < 4 letters
  });
  it("News: removed-holding bullets are hidden and the card says it is catching up", async () => {
    noteRemoval("u-test", { symbol: "PEP", name: "PepsiCo, Inc." });
    const api = stubApi({ getPortfolioInsights: vi.fn().mockResolvedValue(ins()) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /news/i }));
    const card = await screen.findByTestId("news-top5-card");
    expect(card.textContent).not.toMatch(/Pepsi/);
    expect(card.textContent).toMatch(/RDDT up 5%/);
    expect(within(card).getByTestId("intel-updating").textContent).toMatch(/updating for your latest changes/i);
  });
});

describe("F6 a brief is dated against the live book", () => {
  const now = new Date("2026-09-25T18:00:00Z");
  const midday = (sections: Partial<DailyBrief["sections"]>, at = "2026-09-25T16:31:00Z"): DailyBrief => ({
    brief_date: "2026-09-25", edition: "midday", generated_at: at,
    sections: { lede: "Microsoft's jump limits today's loss.", overnight: "", positions: [], desk_view: "", calendar: [], ...sections },
  });
  it("the day flipped from red to green since it was written: stale, with its time", () => {
    const f = briefFreshness(midday({ as_of: "2026-09-25T16:31:00Z", day_sign: -1, day_pct: -0.4 }), { now, liveDayPct: 0.17 });
    expect(f.stale).toBe(true);
    expect(f.note).toMatch(/^Written at \d{1,2}:31 [AP]M, before the latest moves\.$/);
  });
  it("same direction: current, still dated", () => {
    const f = briefFreshness(midday({ as_of: "2026-09-25T16:31:00Z", day_sign: 1 }), { now, liveDayPct: 0.6 });
    expect(f).toEqual({ stale: false, note: expect.stringMatching(/^Written at /) });
  });
  it("a flat day that became a clear move counts; noise under 0.1% never does", () => {
    expect(briefFreshness(midday({ day_sign: 0 }), { now, liveDayPct: 0.3 }).stale).toBe(false);
    expect(briefFreshness(midday({ day_sign: 0 }), { now, liveDayPct: -0.8 }).stale).toBe(true);
    expect(briefFreshness(midday({ day_sign: 1 }), { now, liveDayPct: -0.05 }).stale).toBe(false);
  });
  it("older rows without day_sign: an intraday edition over 2 hours old is dated as stale", () => {
    expect(briefFreshness(midday({}, "2026-09-25T15:31:00Z"), { now }).stale).toBe(true);
    expect(briefFreshness(midday({}, "2026-09-25T17:10:00Z"), { now }).stale).toBe(false);
  });
  it("an intraday edition from an earlier day is stale; a closing note is not second-guessed", () => {
    expect(briefFreshness(midday({ day_sign: 1 }, "2026-09-24T16:31:00Z"), { now, liveDayPct: 1 }).stale).toBe(true);
    expect(briefFreshness({ ...midday({}), edition: "close" }, { now }).note).toBeNull();
  });
  it("an assessment written for other holdings says which", () => {
    const a = assessment({ sections: { ...assessment().sections, held: ["NVDA"] } });
    expect(briefFreshness(a, { held: ["NVDA", "VOO", "TSLA"] })).toEqual({ stale: true, note: "Written before your latest changes.", bookChanged: true });
    expect(briefFreshness(a, { held: ["NVDA"] }).stale).toBe(false);
  });
  it("Home: a stale midday is labelled and de-emphasised, and the lede opens the full read", async () => {
    const at = new Date(Date.now() - 3 * 3600_000).toISOString();
    const api = stubApi({ getDailyBriefs: vi.fn().mockResolvedValue([midday({ as_of: at, day_sign: -1 }, at)]) });
    render(<App api={api} />);
    const card = await screen.findByTestId("brief-card");
    expect(card.getAttribute("data-stale")).toBe("true");   // the fixture book is +5.26% today
    expect(within(card).getByTestId("brief-asof").textContent).toMatch(/before the latest moves/);
    await userEvent.click(within(card).getByTestId("brief-lede"));
    expect(within(card).getByTestId("brief-body")).toBeTruthy();
  });
});

describe("F7 names, numbers and dates people read", () => {
  it("cash and debt never show their internal symbols", () => {
    expect(cashName("$CASH")).toBe("Cash");
    expect(cashName("$CASH.KRW")).toBe("Cash (KRW)");
    expect(cashName("$DEBT")).toBe("Debt");
    expect(cashName("NVDA")).toBeNull();
    expect(labelParts({ symbol: "$CASH.KRW", name: "Cash (KRW)", nickname: "토스 통장" })).toEqual({ main: "Cash (KRW)", sub: "토스 통장" });
    expect(displayName({ symbol: "$DEBT", nickname: "Car loan" })).toBe("Debt · Car loan");
    expect(labelParts({ symbol: "AVGO", name: "AVGO" })).toEqual({ main: "AVGO", sub: "" });   // never "AVGO AVGO"
  });
  it("removal copy for a debt names it, not $DEBT", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}),
      row({ holding_id: "d1", symbol: "$DEBT", name: "Debt (USD)", nickname: "Car loan", kind: "debt", account: "bank", qty: 12500, price: 1, value: 12500, cost_basis: 12500, total_gl: 0, change_pct: 0 })]) });
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Car loan/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^remove debt$/i }));
    const dlg = screen.getByRole("dialog", { name: /confirm removal/i });
    expect(dlg.textContent).toMatch(/Remove Debt · Car loan\?/);
    expect(dlg.textContent).not.toMatch(/\$DEBT/);
  });
  it("true minus signs; lot dates as people write them; an edit prefill with separators", () => {
    expect(signedMoney(-1250)).toBe("−$1,250");
    expect(signedPct(-1.2)).toBe("−1.20%");
    expect(formatDate("2024-06-14")).toBe("Jun 14, 2024");
    expect(formatAmountInput(3000)).toBe("3,000");
    expect(formatAmountInput(0.0123)).toBe("0.0123");
  });
  it("a won amount typed for a dollar stock is refused, not saved as dollars", () => {
    expect(readAmount("₩1,000", "cost", "USD").error).toMatch(/₩ amount, but this is priced in USD/);
    expect(readAmount("$1,000", "cost", "USD").value).toBe(1000);
    expect(readAmount("$1,000", "cost", "KRW").error).toMatch(/priced in KRW/);
    expect(readAmount("₩1,000", "cost", "KRW").value).toBe(1000);
    expect(readAmount("1,000", "cost", "USD").value).toBe(1000);
  });
  it("the Edit lot sheet shows the saved lot formatted, with its live total", async () => {
    const api = stubApi({ getLots: vi.fn().mockResolvedValue([{ id: "l1", holding_id: "h1", qty: 3000, cost_per_share: 12.5, acquired_on: "2024-06-14", note: null }]) });
    await openRddt(api);
    expect(screen.getByTestId("lot-date").textContent).toBe("Jun 14, 2024");
    await userEvent.click(screen.getByRole("button", { name: /edit lot 3000 shares/i }));
    expect((screen.getByLabelText(/^shares$/i) as HTMLInputElement).value).toBe("3,000");
    expect(screen.getByTestId("entry-preview").textContent).toBe("3,000 shares × $12.50 = $37,500.00");
    expect(screen.getByRole("button", { name: "Delete lot and position" })).toBeTruthy();
  });
});

describe("F8 search ranks the listing people mean", () => {
  const r = (symbol: string, name: string) => ({ symbol, name, exchange: "NYSE", currency: "USD", kind: "equity" });
  it("coca-cola -> KO first; vanguard s&p -> VOO above the London line", () => {
    expect(rankSymbols("coca-cola", [r("COKE", "Coca-Cola Consolidated"), r("KOF", "Coca-Cola FEMSA"), r("CCEP", "Coca-Cola Europacific"), r("KO", "Coca-Cola Company")])[0].symbol).toBe("KO");
    expect(rankSymbols("vanguard s&p", [r("VUSA.L", "Vanguard S&P 500 UCITS ETF"), r("VOO", "Vanguard S&P 500 ETF")])[0].symbol).toBe("VOO");
  });
  it("a search in flight says so instead of an empty card", async () => {
    const d = deferred<never[]>();
    render(<App api={stubApi({ searchSymbols: vi.fn().mockReturnValue(d.promise) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(screen.getByRole("button", { name: /add position/i }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "vang");
    expect(await screen.findByTestId("searching")).toBeTruthy();
    await act(async () => { d.resolve([]); });
  });
});

describe("F9 chart", () => {
  const p = (iso: string, price: number) => ({ ts: iso, price });
  it("1D keeps only the latest session: no line across the overnight gap", () => {
    const s = latestSession([p("2026-09-24T19:50:00Z", 100), p("2026-09-24T20:00:00Z", 101), p("2026-09-25T13:30:00Z", 102), p("2026-09-25T14:00:00Z", 103)]);
    expect(s.map((x) => x.price)).toEqual([102, 103]);
  });
  it("a quote repeated overnight is a gap too; the session starts at its last print", () => {
    const flat = Array.from({ length: 20 }, (_, i) => p(new Date(Date.parse("2026-09-24T20:00:00Z") + i * 30 * 60_000).toISOString(), 101));
    const s = latestSession([p("2026-09-24T19:30:00Z", 100), ...flat, p("2026-09-25T06:00:00Z", 104), p("2026-09-25T06:30:00Z", 105)]);
    expect(s.map((x) => x.price)).toEqual([101, 104, 105]);
  });
  it("a coin with no gap shows its last 24 hours", () => {
    const pts = Array.from({ length: 60 }, (_, i) => p(new Date(Date.parse("2026-09-23T00:00:00Z") + i * 3600_000).toISOString(), 80000 + i));
    const s = latestSession(pts);
    expect(Date.parse(s.at(-1)!.ts) - Date.parse(s[0].ts)).toBeLessThanOrEqual(24 * 3600_000);
  });
  it("1D header is the page's day move; high and low come from every point, not the thinned line", async () => {
    const t0 = Date.now() - 300 * 60_000;
    const pts = Array.from({ length: 300 }, (_, i) => p(new Date(t0 + i * 60_000).toISOString(), i === 137 ? 260.01 : 200 + (i % 7)));
    const api = stubApi({ getHistory: vi.fn().mockResolvedValue(pts) });
    await openRddt(api);
    await userEvent.click(screen.getByRole("tab", { name: "1D" }));
    await waitFor(() => expect(screen.getByTestId("range-change").textContent).toBe("+5.26%"));   // row.change_pct
    expect(screen.getByTestId("range-high").textContent).toBe("H $260.01");
  });
  it("touching the line shows the price and time under the finger", async () => {
    const api = stubApi();
    await openRddt(api);
    const svg = await screen.findByTestId("price-chart");
    svg.getBoundingClientRect = () => ({ left: 0, width: 320, top: 0, height: 96, right: 320, bottom: 96, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerDown(svg, { clientX: 2, pointerId: 1 });
    expect(screen.getByTestId("scrub-readout").textContent).toMatch(/\$190\.00/);
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(screen.queryByTestId("scrub-readout")).toBeNull();
  });
  it("a full stock week is not 'partial'", async () => {
    // 1W on Fri Sep 25 starts Fri Sep 18: its close is the base (r4 power-user M2)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T20:30:00Z"));
    try {
      const days = ["2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((d, i) => p(`${d}T20:00:00Z`, 100 + i));
      const api = stubApi({ getHistory: vi.fn().mockResolvedValue(days), getPortfolio: vi.fn().mockResolvedValue([row({ as_of: "2026-09-25T20:00:00Z", price: 105 })]) });
      await openRddt(api);
      await userEvent.click(screen.getByRole("tab", { name: "1W" }));
      await screen.findByTestId("price-chart");
      expect(screen.queryByTestId("partial-note")).toBeNull();
      expect(screen.getByTestId("range-change").textContent).toBe("+5.00%");
    } finally { vi.useRealTimers(); }
  });
});

describe("F10 Home, Settings, Ask, sign-out", () => {
  it("Movers only appears with two or more holdings", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("positions-card");
    expect(screen.queryByTestId("movers-card")).toBeNull();
  });
  it("Movers uses the Positions grammar: coloured ±% (±$)", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(two()) })} />);
    const movers = await screen.findByTestId("movers-card");
    expect(movers.textContent).toMatch(/\+5\.26% \(\+\$240\)/);
    expect(movers.textContent).toMatch(/−1\.20% \(−\$36\)/);
  });
  it("offline: the cached book paints, nothing pulses as live, and the prices say when they are from", async () => {
    const asOf = new Date(Date.now() - 20 * 60_000).toISOString();
    localStorage.setItem("assetly-book:u-test", JSON.stringify({ v: 2, profile, rows: two().map((r) => ({ ...r, as_of: asOf })), fx: { USD: 1, KRW: 1380 } }));
    const api = stubApi({ getPortfolio: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<App api={api} />);
    await screen.findByRole("alert");
    expect(document.querySelectorAll(".live-dot").length).toBe(0);
    expect(screen.getByTestId("prices-as-of").textContent).toBe(`Prices as of ${new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
  });
  it("Settings shows the build's version, the account email, and the markets actually held", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}),
      row({ holding_id: "k", symbol: "005930.KS", name: "Samsung", currency: "KRW", value: 1_000_000, price: 60000 })]) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /settings/i }));
    expect(screen.getByTestId("signed-in-as").textContent).toBe("first.run@example.com");
    expect(screen.getByTestId("markets-row").textContent).toBe("US · Korea");
    expect(document.body.textContent).toContain(`Version${pkg.version}`);
    expect(pkg.version).toBe("1.0.1");
  });
  it("sign-out sweeps this user's hints and pending state from the device", async () => {
    localStorage.setItem("assetly-next-steps", "armed");
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date().toISOString(), first: true }));
    noteRemoval("u-test", { symbol: "PEP", name: "PepsiCo" });
    const { supabase } = await import("../lib/supabase");
    let onChange: ((e: string, s: null) => void) | undefined;
    (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockImplementationOnce((cb: typeof onChange) => { onChange = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await act(async () => { onChange!("SIGNED_OUT", null); });
    expect(localStorage.getItem("assetly-next-steps")).toBeNull();
    expect(localStorage.getItem("assetly-assess:u-test")).toBeNull();
    expect(readRemovals("u-test")).toEqual([]);
  });
  it("Ask: sending puts the keyboard away, and New chat starts over", async () => {
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /^ask$/i }));
    const input = screen.getByLabelText(/ask about your portfolio/i);
    await userEvent.type(input, "how am I doing?{Enter}");
    expect(document.activeElement).not.toBe(input);
    await screen.findByTestId("ask-answer");
    await userEvent.click(screen.getByTestId("ask-new-chat"));
    expect(screen.queryByTestId("ask-answer")).toBeNull();
    expect(screen.getByRole("button", { name: /what should i watch this week/i })).toBeTruthy();
  });
});

describe("F11 assessment card copy", () => {
  it("fits one line, and a failed run says it didn't finish, never 'Building'", async () => {
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date().toISOString(), first: true, error: "The assessment didn't finish." }));
    render(<App api={stubApi()} />);
    const card = await screen.findByTestId("assessment-card");
    expect(card.textContent).toMatch(/^Assessment didn't finish/);
    expect(card.textContent).toMatch(/only the write-up is missing\./);
    expect(card.textContent).not.toMatch(/missing\. Try again\./);   // the chip is the "try again" (r5 designer m-f)
    expect(card.textContent).not.toMatch(/paused/);
    expect(card.textContent).not.toMatch(/Building/);
  });
  it("steps read as progress: a spinner on the active step, a hollow circle on the next", async () => {
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date().toISOString(), first: true }));
    render(<App api={stubApi()} />);
    const card = await screen.findByTestId("assessment-card");
    const steps = card.querySelectorAll("li");
    expect(steps[0].getAttribute("data-step")).toBe("active");
    expect(steps[1].getAttribute("data-step")).toBe("next");
    expect(within(card).getByLabelText("In progress")).toBeTruthy();
  });
});

describe("F12 onboarding Back", () => {
  it("picking a different ticker after Back starts with empty shares and cost", async () => {
    const api = stubApi({
      getProfile: vi.fn().mockResolvedValue({ ...profile, onboarded_at: null }),
      searchSymbols: vi.fn().mockResolvedValue([
        { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", currency: "USD", kind: "equity" },
        { symbol: "TSLA", name: "Tesla", exchange: "NASDAQ", currency: "USD", kind: "equity" }]),
    });
    render(<App api={api} />);
    await userEvent.click(await screen.findByTestId("quiz-skip"));
    await userEvent.type(screen.getByLabelText(/find your first position/i), "n");
    await userEvent.click(await screen.findByRole("button", { name: /NVIDIA/ }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "12.5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "120.50");
    await userEvent.click(screen.getByRole("button", { name: /← back/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Tesla/ }));
    expect((screen.getByLabelText(/^shares$/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/cost per share/i) as HTMLInputElement).value).toBe("");
  });
});

describe("F13 skipped quiz answers are marked as defaults", () => {
  it("Skip at Q3 records which answers are defaults, so no brief calls them the reader's goal", async () => {
    const api = stubApi({ getProfile: vi.fn().mockResolvedValue({ ...profile, onboarded_at: null }) });
    render(<App api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "Growth" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await userEvent.click(await screen.findByTestId("ob-skip"));
    await waitFor(() => expect(api.completeOnboarding).toHaveBeenCalledWith(["US"], "USD",
      expect.objectContaining({ styles: ["growth"], defaulted: ["purpose", "horizon", "target", "risk", "level"] })));
  });
});
