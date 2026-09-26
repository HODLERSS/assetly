// Round-10 polish (1.0.1), client side: Home opens on the latest edition (an evening re-run assessment is a chip),
// a lot write reloads the lots and the book together, a coin's H/L show at once and only widen, a failed first
// load never shows default investor answers as the user's, News says it is loading, and Ask fits 320 and AX5.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { App } from "../App";
import { PriceChart } from "../components/PriceChart";
import { makeApi, pickHomeBriefs, type Api, type DailyBrief, type HistoryPoint, type PortfolioRow, type SymbolRow } from "../lib/api";
import { canonicalSymbol, cleanListingName, mergeListings } from "../lib/search";
import type { SupabaseClient } from "@supabase/supabase-js";
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPricesDown(false); });

const tabs = () => within(screen.getByRole("navigation", { name: "Tabs" }));
const b = (edition: DailyBrief["edition"], brief_date: string, generated_at: string, lede: string = edition): DailyBrief =>
  ({ brief_date, edition, generated_at, audio_path: null, script: null,
     sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: generated_at, day_sign: 1, held: ["RDDT"] } });

describe("1 Home opens on the latest edition; a re-run assessment is a chip", () => {
  const now = Date.parse("2026-09-26T01:00:00Z");
  const close = b("close", "2026-09-25", "2026-09-25T20:05:00Z", "Close lede.");
  const rerun = b("assessment", "2026-09-25", "2026-09-25T23:40:00Z", "Assessment lede.");
  it("an assessment written after the Close does not take the card", () => {
    expect(pickHomeBriefs([close], rerun, now).map((x) => x.edition)).toEqual(["assessment", "close"]);
  });
  it("only a first assessment, with no edition yet, stands alone", () => {
    expect(pickHomeBriefs([], rerun, now).map((x) => x.edition)).toEqual(["assessment"]);
  });
  it("on Home: the Close is open, the Assessment one tap away", async () => {
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(pickHomeBriefs([close], rerun, now)) })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Close lede.");
    await userEvent.click(within(card).getByRole("button", { name: "Assessment" }));
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Assessment lede.");
  });
});

describe("2 a lot write reads the lots and the book together", () => {
  it("both reads are out before either answers", async () => {
    let lotsOut = 0, bookOut = 0;
    const holdLots: ((v: unknown) => void)[] = [], holdBook: ((v: unknown) => void)[] = [];
    const base = row({});
    const api = stubApi({
      getLots: vi.fn().mockImplementation(() => { lotsOut++; return lotsOut === 1 ? Promise.resolve([]) : new Promise((r) => holdLots.push(r)); }),
      getPortfolio: vi.fn().mockImplementation(() => { bookOut++; return bookOut === 1 ? Promise.resolve([base]) : new Promise<PortfolioRow[]>((r) => holdBook.push(r as (v: unknown) => void)); }),
    });
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
    await screen.findByRole("heading", { name: /^lots$/i });
    await userEvent.click(screen.getByRole("button", { name: "+ Lot" }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "50");
    await userEvent.click(screen.getByRole("button", { name: /^add lot$/i }));
    await waitFor(() => expect(api.addLot).toHaveBeenCalled());
    // the reload has asked for both at once
    await waitFor(() => { expect(holdLots.length).toBe(1); expect(holdBook.length).toBeGreaterThanOrEqual(1); });
    await act(async () => { holdBook.forEach((r) => r([base])); holdLots.forEach((r) => r([])); });
  });
});

describe("4 a coin's L/H show at once and only widen", () => {
  it("1M: the drawn closes' H/L before the week, wider after, never narrower", async () => {
    const now = Date.now();
    const pts: HistoryPoint[] = [];
    for (let h = 40 * 24; h >= 1; h--) pts.push({ ts: new Date(now - h * 3600e3).toISOString(), price: 80_000 + (40 * 24 - h) * 0.5 });
    pts[pts.length - 60] = { ...pts[pts.length - 60], price: 90_000 };   // an hourly spike: only the week has it
    pts[pts.length - 90] = { ...pts[pts.length - 90], price: 70_000 };   // and an hourly dip
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const getHistory = vi.fn((_s: string, _h: number, o?: { maxPages?: number }) => (o?.maxPages ? gate.then(() => pts) : Promise.resolve(pts)));
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={80_600} liveAsOf={new Date(now).toISOString()} crypto />);
    await screen.findByTestId("price-chart");
    const num = (id: string) => Number((screen.getByTestId(id).textContent ?? "").replace(/[^\d.]/g, ""));
    // at once: visible, and the daily closes' extent
    expect(screen.getByTestId("range-high").style.visibility).toBe("");
    const h0 = num("range-high"), l0 = num("range-low");
    expect(h0).toBeLessThan(90_000);
    await act(async () => { release(); });
    await waitFor(() => expect(num("range-high")).toBe(90_000));
    expect(num("range-high")).toBeGreaterThanOrEqual(h0);
    expect(num("range-low")).toBeLessThanOrEqual(l0);
  });
});

describe("5 a failed first load never shows default investor answers as the user's", () => {
  it("Settings: 'Not loaded yet', Edit disabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App api={stubApi({ getProfile: vi.fn().mockResolvedValue(null), getPortfolio: vi.fn().mockResolvedValue([]) })} />);
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await screen.findByTestId("prices-error");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    const card = await screen.findByTestId("investor-card");
    expect(within(card).getByTestId("investor-label").textContent).toBe("Not loaded yet");
    expect((within(card).getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(card.textContent).not.toMatch(/Value/);
  });
});

describe("6 News says it is loading while the first read is out", () => {
  it("a loading line and the list's shape, not a blank", async () => {
    render(<App api={stubApi({ getNews: vi.fn().mockReturnValue(new Promise(() => {})) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /news/i }));
    const loading = await screen.findByTestId("news-loading");
    expect(loading.textContent).toMatch(/^Loading news…/);
    expect(loading.getAttribute("aria-busy")).toBe("true");
  });
});

describe("7 Ask at 320 and AX5", () => {
  it("under 360pt the placeholder is the short one", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(max-width: 359px)", media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /ask/i }));
    expect((await screen.findByLabelText("Ask about your portfolio")).getAttribute("placeholder")).toBe("Ask a question…");
  });
  it("two-line suggestion pills keep their text inside the pill", () => {
    const css = readFileSync(`${process.cwd()}/src/theme.css`, "utf8");
    expect(css).toMatch(/\.chips\.wrap \.chip \{[^}]*padding: 10px 16px;/);
    expect(css).toMatch(/\.chips\.wrap \.chip::before \{ border-radius: 18px; \}/);
  });
});

describe("M3 (newcomer) class shares: one listing, the canonical dotted symbol", () => {
  const alias: SymbolRow = { symbol: "BRKB", name: "Berkshire Hathaway Inc. -", exchange: "NYSE", currency: "USD", kind: "equity", yahoo: "BRK-B" };
  const canon: SymbolRow = { symbol: "BRK.B", name: "Berkshire Hathaway Inc.", exchange: "NYSE", currency: "USD", kind: "equity", yahoo: "BRK-B" };
  const classA: SymbolRow = { symbol: "BRK-A", name: "Berkshire Hathaway Inc. -", exchange: "NYSE", currency: "USD", kind: "equity", yahoo: "BRK-A" };
  it("canonicalSymbol mirrors the server: BRKB / BRK-B / BRK.B -> BRK.B; codes, coins and plain tickers untouched", () => {
    expect(canonicalSymbol("BRKB", "BRK-B")).toBe("BRK.B");
    expect(canonicalSymbol("BRK-B", "BRK-B")).toBe("BRK.B");
    expect(canonicalSymbol("brk.b", null)).toBe("BRK.B");
    expect(canonicalSymbol("BRK-B")).toBe("BRK.B");
    expect(canonicalSymbol("005930.KS", "005930.KS")).toBe("005930.KS");
    expect(canonicalSymbol("BTC-USD", "BTC-USD")).toBe("BTC-USD");
    expect(canonicalSymbol("NVDA", "NVDA")).toBe("NVDA");
    expect(cleanListingName("Berkshire Hathaway Inc. -")).toBe("Berkshire Hathaway Inc.");
    expect(cleanListingName("Coca-Cola")).toBe("Coca-Cola");
  });
  it("the catalog alias and the remote listing merge into one BRK.B row with a clean name", () => {
    const out = mergeListings([alias], [canon, classA]);
    expect(out.map((r) => r.symbol)).toEqual(["BRK.B", "BRK.A"]);
    expect(out.map((r) => r.name)).toEqual(["Berkshire Hathaway Inc.", "Berkshire Hathaway Inc."]);
    // a dotless alias with no Yahoo field still folds into its dotted listing
    expect(mergeListings([{ ...alias, yahoo: null }], [canon]).map((r) => r.symbol)).toEqual(["BRK.B"]);
  });
  it("api: 'berkshire' leads with BRK.B, never BRKB; ensure registers and returns the canonical symbol", async () => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "or", "eq", "limit"]) q[k] = () => q;
    q.then = (res: (v: unknown) => void) => res({ data: [alias], error: null });
    const invoke = vi.fn(async (_fn: string, o: { body: Record<string, unknown> }) =>
      o.body.ensure ? { data: { ok: true, symbol: { symbol: "BRK.B" } }, error: null } : { data: { ok: true, results: [canon, classA] }, error: null });
    const api = makeApi({ from: () => q, functions: { invoke } } as unknown as SupabaseClient);
    const res = await api.searchSymbols("berkshire");
    expect(res[0].symbol).toBe("BRK.B");
    expect(res.some((r) => r.symbol === "BRKB")).toBe(false);
    expect(res.every((r) => !/ -$/.test(r.name))).toBe(true);
    expect(await api.ensureSymbol(alias)).toBe("BRK.B");
    expect((invoke.mock.calls.at(-1)![1].body.ensure as { symbol: string; name: string })).toMatchObject({ symbol: "BRK.B", name: "Berkshire Hathaway Inc." });
  });
  it("Add position holds the pick under the symbol ensure returns", async () => {
    const api = stubApi({
      searchSymbols: vi.fn().mockResolvedValue([alias]),
      ensureSymbol: vi.fn().mockResolvedValue("BRK.B"),
    });
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "berkshire");
    await userEvent.click(await screen.findByRole("button", { name: /Berkshire/i }));
    await userEvent.type(await screen.findByLabelText(/^shares$/i), "3");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "480");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalled());
    expect((api.addPosition as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("BRK.B");
  });
});
