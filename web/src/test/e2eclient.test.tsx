// The 10-persona end-to-end pass, client side: the Breakdown and the header agree, a flat move is grey and the
// bigger move leads, lot sheets name their position, a new position shows its lot at once, a quote's arrival is
// said, a cost far from the quote is flagged, the chrome's two strings follow a Korean locale, the boot state
// paints before the bundle, and the CSS for the date ghost, info rows, player targets and range chips.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { App } from "../App";
import type { Lot, PortfolioRow } from "../lib/api";
import { dayGroups, marketBreakdown } from "../lib/portfolio";
import { farFromQuote } from "../lib/numbers";
import { askPlaceholder, notAdvice } from "../lib/i18n";
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
// (no restoreAllMocks here: it would blank the module mocks above for every later test)
afterEach(() => { vi.useRealTimers(); langSpy?.mockRestore(); langSpy = null; setPricesDown(false); });
let langSpy: { mockRestore: () => void } | null = null;
const speak = (langs: string[]) => { langSpy = vi.spyOn(navigator, "languages", "get").mockReturnValue(langs); };

const tabs = () => within(screen.getByRole("navigation", { name: "Tabs" }));
const client = () => readFileSync(`${process.cwd()}/src/client.css`, "utf8");
const theme = () => readFileSync(`${process.cwd()}/src/theme.css`, "utf8");

describe("1 (p07) the Breakdown uses the header's buckets, names and math", () => {
  const FRI = new Date("2026-09-25T15:00:00Z");   // Fri 11:00 ET; KRX shut for Chuseok, its last print Wednesday
  const us = row({ value: 1011, change_pct: 1.0891, cost_basis: 900, total_gl: 111, as_of: "2026-09-25T14:59:00Z" });
  const kr = row({ holding_id: "k1", symbol: "005930.KS", name: "Samsung Electronics", currency: "KRW", price: 250000, qty: 55.2,
    value: 13_800_000, cost_basis: 10_000_000, total_gl: 3_800_000, change_pct: 3.0, as_of: "2026-09-23T06:30:00Z" });
  const cash = row({ holding_id: "c", symbol: "$CASH", name: "Cash (USD)", kind: "cash", qty: 5000, price: 1, value: 5000, cost_basis: 5000, total_gl: 0, change_pct: null });
  const btc = row({ holding_id: "b", symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", qty: 0.01, price: 80_000, value: 800, cost_basis: 700, total_gl: 100, change_pct: -0.25, as_of: "2026-09-25T14:59:30Z" });
  const fx = { USD: 1, KRW: 1380 };

  it("per market, a Breakdown line is the header's own figure: same day $, same basis, cash in neither", () => {
    const h = dayGroups([us, cash], "USD", fx, FRI)[0];
    const b = marketBreakdown([us, cash], "USD", fx).find((m) => m.market === "US")!;
    expect(b.day).toBeCloseTo(h.day, 6);
    expect(b.basis).toBeCloseTo(h.basis, 6);
    // a dollar coin is its own line, never folded into US
    const withCoin = marketBreakdown([us, cash, btc], "USD", fx);
    expect(withCoin.map((m) => m.label)).toEqual(["US", "Crypto"]);
    expect(withCoin[0].day).toBeCloseTo(h.day, 6);
    expect(withCoin[0].basis).toBeCloseTo(h.basis, 6);
    // all time on invested cost
    expect(withCoin[0].gl).toBe(111); expect(withCoin[0].cost).toBe(900);
  });
  it("on Home the two agree to the printed figure, and Korea is 'Korea', not 'KRX'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(FRI);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([us, kr, cash]) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(await screen.findByTestId("nw-detail-toggle"));
    const bd = (await screen.findByTestId("market-breakdown-day")).textContent!;
    const header = [screen.getByTestId("total-day"), ...screen.queryAllByTestId("total-day-other")]
      .map((el) => el.textContent!.replace(/ (?:today|· .+)$/, ""));   // "Korea +$291 (+3.00%)"
    expect(header).toHaveLength(2);
    for (const line of header) expect(bd).toContain(line);
    expect(bd).not.toMatch(/KRX/);
    expect(bd).toMatch(/^latest sessions: /);
  });
});

describe("2 (p02 F7) a move rounding to 0.00% is grey; the bigger move leads", () => {
  it("grey for |move| under 0.005%; the aggregate first, then by size", async () => {
    const FRI = new Date("2026-09-26T15:00:00Z");   // Saturday: US and Korea are earlier sessions, a coin is today
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(FRI);
    const rows: PortfolioRow[] = [
      row({ value: 40_000, change_pct: 1.05, as_of: "2026-09-25T20:00:00Z" }),
      row({ holding_id: "b", symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", qty: 0.5, price: 80_000, value: 40_000, cost_basis: 30_000, total_gl: 10_000, change_pct: -0.002, as_of: "2026-09-26T14:59:00Z" }),
    ];
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows) })} />);
    await screen.findByTestId("net-worth");
    const first = screen.getByTestId("total-day");
    expect(first.textContent).toMatch(/^US \+\$41[56] \(\+1\.05%\) · Fri close$/);
    const coin = screen.getByTestId("total-day-other");
    expect(coin.textContent).toMatch(/^Crypto −\$1 \(0\.00%\) today$/);
    expect(coin.className).toMatch(/\bmutedc\b/);
    expect(coin.className).not.toMatch(/\bloss\b/);
  });
});

describe("3 / 6 / 7 / 8 CSS: the date ghost, info rows, player targets, range chips", () => {
  it("WebKit's date field pseudo-elements are transparent while empty", () => {
    expect(client()).toMatch(/input::-webkit-datetime-edit-month-field[^{]*\{ color: transparent; -webkit-text-fill-color: transparent; \}/);
  });
  it("a plain div row has no press tint and no pointer", () => {
    expect(theme()).toMatch(/div\.row \{ cursor: default; \}\s*div\.row:active \{ background: none; \}/);
  });
  it("every mini player control is at least 44 wide", () => {
    expect(theme()).toMatch(/\.mp-btn \{ min-width: 44px; min-height: 44px;/);
    expect(theme()).toMatch(/\.mp-close \{[^}]*min-width: 44px; \}/);
    expect(theme()).not.toMatch(/min-width: 42px|min-width: 38px/);
  });
  it("the chart's range chips wrap under large text and carry a scroll fade otherwise", async () => {
    expect(client()).toMatch(/\.text-large \.chips\.ranges \{ flex-wrap: wrap; overflow-x: visible;/);
    expect(client()).toMatch(/\.chips\.ranges \{[^}]*mask-image/);
    render(<App api={stubApi()} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
    expect((await screen.findByRole("tablist", { name: "Chart range" })).className).toMatch(/\branges\b/);
  });
});

describe("4 (p02 F9) lot sheets name the position", () => {
  it("'Add RDDT lot' and 'Edit RDDT lot · 10 sh'", async () => {
    render(<App api={stubApi()} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
    await screen.findByRole("heading", { name: /^lots$/i });
    await userEvent.click(screen.getByRole("button", { name: "+ Lot" }));
    expect(screen.getByRole("dialog", { name: "Add RDDT lot" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add RDDT lot" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Edit lot 10 shares$/ }));
    expect(screen.getByRole("dialog", { name: "Edit RDDT lot · 10 sh" })).toBeTruthy();
  });
});

describe("5 (p02 F11) a new position shows its lot from the add itself", () => {
  it("no 'Loading lots…' round trip: the lot and its note are there at once", async () => {
    const lot: Lot = { id: "l-new", holding_id: "h-new", qty: 3, cost_per_share: 300, acquired_on: null, note: "dip buy" };
    const mara = row({ holding_id: "h-new", symbol: "MARA", name: "MARA Holdings", qty: 3, price: 310, value: 930, cost_basis: 900, avg_cost: 300, total_gl: 30, change_pct: 1 });
    const getPortfolio = vi.fn().mockResolvedValue([row({})]);
    const api = stubApi({
      getPortfolio,
      addPosition: vi.fn().mockImplementation(async () => { getPortfolio.mockResolvedValue([row({}), mara]); return { holdingId: "h-new", lot }; }),
      getLots: vi.fn().mockImplementation((id: string) => (id === "h-new" ? new Promise(() => {}) : Promise.resolve([]))),   // the read never answers
    });
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(await screen.findByLabelText(/^shares$/i), "3");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "300");
    await userEvent.type(screen.getByLabelText(/note/i), "dip buy");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await screen.findByTestId("added-strip");
    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /MARA/ }));
    await screen.findByRole("heading", { name: /^lots$/i });
    expect(screen.queryByLabelText("Loading lots")).toBeNull();
    expect(screen.getByRole("button", { name: /^Edit lot 3 shares$/ }).textContent).toMatch(/dip buy/);
  });
});

describe("10 (p03 F2) the quote's arrival is said", () => {
  it("'Fetching price…' until the quote lands, then the chip", async () => {
    let give!: (v: { price: number; asOf: string | null }) => void;
    const api = stubApi({ getQuote: vi.fn().mockReturnValue(new Promise((r) => { give = r; })) });
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    expect((await screen.findByTestId("quote-wait")).textContent).toBe("Fetching price…");
    expect(screen.queryByTestId("use-quote")).toBeNull();
    await act(async () => { give({ price: 15, asOf: null }); });
    await screen.findByTestId("use-quote");
    expect(screen.queryByTestId("quote-wait")).toBeNull();
  });
});

describe("12 (p01 F3) a cost far from the quote is flagged, never blocked", () => {
  it("the rule: over 4x or under a quarter of the price", () => {
    expect(farFromQuote("100", 2687)).toBe(true);
    expect(farFromQuote("12,000", 2687)).toBe(true);
    expect(farFromQuote("2000", 2687)).toBe(false);
    expect(farFromQuote("", 2687)).toBe(false);
    expect(farFromQuote("100", null)).toBe(false);
  });
  it("the note names today's price and its one tap fills it; saving still goes through", async () => {
    const api = stubApi({ getQuote: vi.fn().mockResolvedValue({ price: 2687, asOf: null }) });
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await screen.findByTestId("use-quote");
    await userEvent.type(await screen.findByLabelText(/^shares$/i), "1");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "100");
    const note = await screen.findByTestId("cost-far");
    expect(note.textContent).toContain("That's far from today's price of $2,687.00. Double-check it, or use today's price.");
    expect(note.getAttribute("role")).toBe("status");
    expect((screen.getByRole("button", { name: /^add position$/i }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(within(note).getByRole("button", { name: "Use today's price" }));
    expect((screen.getByLabelText(/cost per share/i) as HTMLInputElement).value).toBe("2,687.00");
    expect(screen.queryByTestId("cost-far")).toBeNull();
  });
});

describe("11 (p03 F4) under a Korean locale the two chrome strings follow", () => {
  it("the disclaimer and the Ask prompt are Korean; the rest stays English", async () => {
    speak(["ko-KR", "en-US"]);
    expect(notAdvice()).toBe("투자 조언이 아닙니다");
    expect(askPlaceholder("long")).toBe("내 포트폴리오에 대해 물어보세요…");
    render(<App api={stubApi()} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /ask/i }));
    expect((await screen.findByLabelText("Ask about your portfolio")).getAttribute("placeholder")).toBe("내 포트폴리오에 대해 물어보세요…");
    expect(tabs().getByRole("button", { name: /news/i })).toBeTruthy();   // the shell is still English
  });
  it("English otherwise", () => {
    speak(["en-US"]);
    expect(notAdvice()).toBe("Not financial advice");
    expect(askPlaceholder("short")).toBe("Ask a question…");
  });
});

describe("15 (p06) the Movers header knows what is in the list", () => {
  it("a Saturday list of live coins and a closed stock reads 'crypto live · US Fri close'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));   // Sat 11 AM ET
    const rows: PortfolioRow[] = [
      row({ value: 4000, change_pct: 1.2, as_of: "2026-09-25T20:00:00Z" }),
      row({ holding_id: "b", symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", qty: 0.05, price: 80_000, value: 4000, change_pct: 2.5, as_of: "2026-09-26T14:59:00Z" }),
      row({ holding_id: "e", symbol: "ETH-USD", name: "Ethereum", kind: "crypto", qty: 1, price: 2700, value: 2700, change_pct: -1.8, as_of: "2026-09-26T14:59:00Z" }),
    ];
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows) })} />);
    await screen.findByTestId("movers-card");
    expect(screen.getByTestId("session-label").textContent).toBe("· crypto live · US Fri close");
  });
});

describe("13 (p09-1) a boot state paints before the bundle", () => {
  it("index.html carries an inline wordmark and spinner inside #root, under 2KB, themed for dark", () => {
    const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
    const boot = html.slice(html.indexOf("<style>\n    #boot"), html.indexOf("</div></div>", html.indexOf('id="boot"')) + 12);
    expect(boot.length).toBeLessThan(2048);
    expect(html).toMatch(/<div id="root"><div id="boot" role="status" aria-label="Loading Assetly">/);
    expect(boot).toMatch(/prefers-color-scheme:dark/);
    expect(boot).not.toMatch(/<script|src=|url\(/);
  });
  it("React replaces it on mount", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<div id="boot" role="status" aria-label="Loading Assetly">Assetly</div>';
    document.body.appendChild(container);
    expect(container.querySelector("#boot")).not.toBeNull();
    render(<App api={stubApi()} />, { container });
    await screen.findByTestId("net-worth");
    expect(container.querySelector("#boot")).toBeNull();
  });
});
