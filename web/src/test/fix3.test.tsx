// Round-3 launch fixes (1.0.1): briefs never presented as current for a book they weren't written for, a
// long Ask wait that says what it is doing, a double tap in the iOS web view that acts once, and the
// newcomer / power-user / designer / native minors. Same harness as fix2.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { AskScreen, ASK_SLOW_MS, ASK_SLOWER_MS } from "../screens/Ask";
import { profile, row, stubApi } from "./fixtures";
import type { DailyBrief, Lot, NewsItem, PortfolioRow } from "../lib/api";
import { briefFreshness, BOOK_CHANGED_NOTE } from "../components/BriefCard";
import { briefBasis, statedTotal } from "../lib/briefBasis";
import { companyName, labelParts, priceCompact, qtyUnit, signedMoneyCompact } from "../lib/format";
import { entryPreview } from "../lib/numbers";
import { accountHeading } from "../lib/accounts";
import { installTapRescue, RESCUE_MS } from "../lib/tapRescue";
import { scrubLabel, chartZone } from "../components/PriceChart";
import { forCoin } from "../components/InsightsCard";
import { groupByDay, newsDay, NEWS_PAGE } from "../screens/News";
import { investorLabel } from "../components/InvestorQuiz";
import { INVESTOR_DEFAULT } from "../lib/api";

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
});

const sections = (over: Partial<DailyBrief["sections"]> = {}): DailyBrief["sections"] =>
  ({ lede: "", overnight: "", positions: [], desk_view: "", calendar: [], ...over });
const brief = (edition: DailyBrief["edition"], over: Partial<DailyBrief["sections"]> = {}, at = new Date(Date.now() - 20 * 60_000).toISOString()): DailyBrief =>
  ({ brief_date: at.slice(0, 10), edition, generated_at: at, sections: sections({ as_of: at, day_sign: 1, ...over }) });
const nvdaOnly: PortfolioRow[] = [row({ holding_id: "n1", symbol: "NVDA", name: "NVIDIA Corporation", value: 3375, change_pct: 0.4 })];

describe("G1 every edition is checked against the book it was written for (r3 newcomer M1)", () => {
  it("a midday written for VOO, TSLA, BTC, NVDA is not current for an NVDA-only book", () => {
    const b = brief("midday", { lede: "Your TSLA stake is doing most of today's damage.", held: ["VOO", "TSLA", "BTC-USD", "NVDA"] });
    const f = briefFreshness(b, { book: nvdaOnly, liveDayPct: 0.4 });
    expect(f).toEqual({ stale: true, note: BOOK_CHANGED_NOTE, bookChanged: true });
    expect(briefFreshness(b, { book: [...nvdaOnly, row({ symbol: "VOO" }), row({ symbol: "TSLA" }), row({ symbol: "BTC-USD", kind: "crypto" })], liveDayPct: 0.4 }).bookChanged).toBeUndefined();
  });
  it("the same holding in two accounts, and cash, never count as a change", () => {
    const b = brief("close", { held: ["NVDA"] });
    const book = [...nvdaOnly, row({ holding_id: "n2", symbol: "NVDA", account: "ira" }), row({ holding_id: "c", symbol: "$CASH", kind: "cash" })];
    expect(briefBasis(b, book).stale).toBe(false);
  });
  it("older rows (no held): a position line naming a holding not in the book makes it stale", () => {
    const b = brief("morning", { positions: [{ name: "TSLA", note: "down 1.3%", watch: "" }, { name: "Nvidia", note: "up", watch: "" }] });
    expect(briefBasis(b, nvdaOnly)).toEqual({ stale: true, why: "names", unheld: ["TSLA"] });
    const ok = brief("morning", { positions: [{ name: "Nvidia", note: "", watch: "" }, { name: "Your cash", note: "", watch: "" }] });
    expect(briefBasis(ok, nvdaOnly).stale).toBe(false);   // a company name, and a line that is not a holding
  });
  it("Korean names and full company names match the book", () => {
    const kr = [row({ symbol: "005930.KS", name: "Samsung Electronics Co., Ltd.", name_kr: "삼성전자", currency: "KRW" }), row({ symbol: "000660.KS", name: "SK hynix Inc.", currency: "KRW" })];
    const b = brief("kr_close", { positions: [{ name: "삼성전자", note: "", watch: "" }, { name: "SK hynix", note: "", watch: "" }, { name: "Samsung Electronics", note: "", watch: "" }] });
    expect(briefBasis(b, kr).stale).toBe(false);
  });
  it("Home opens on the newest edition written for this book; the other is a tap away, labelled and dimmed", async () => {
    const close = brief("close", { lede: "NVDA closed up.", held: ["NVDA", "AAPL"] }, new Date(Date.now() - 3 * 3600_000).toISOString());
    // two of the three holdings it covers are still held: a smaller change, shown labelled (half or fewer: not
    // shown at all; fix4, r5)
    const book = [...nvdaOnly, row({ holding_id: "a", symbol: "AAPL", name: "Apple Inc." })];
    const midday = brief("midday", { lede: "Your TSLA stake is doing most of today's damage.", held: ["TSLA", "NVDA", "AAPL"] });
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(book), getDailyBriefs: vi.fn().mockResolvedValue([close, midday]) });
    render(<App api={api} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("NVDA closed up.");
    await userEvent.click(within(card).getByRole("button", { name: "Midday" }));
    expect(card.getAttribute("data-stale")).toBe("true");
    expect(card.className).toMatch(/brief-other-book/);
    expect(within(card).getByTestId("brief-asof").textContent).toBe("Written before your latest changes.");
  });
});

describe("G2 an old assessment about other holdings is never the hero (r3 power-user M3)", () => {
  // the 1.0.0 row: no `held`, about a Pepsi/Ford book, $274,900 total and $12,500 debt
  const pepsi = (): DailyBrief => ({ brief_date: "2026-09-20", edition: "assessment", generated_at: new Date(Date.now() - 86400_000).toISOString(),
    sections: sections({ lede: "Value-oriented, high-concentration book anchored by Pepsi, with 55.9% of assets in a single theme.",
      overnight: "Total assets $274,900; debt $12,500.", positions: [{ name: "PEP", note: "46.6% of assets", watch: "" }, { name: "F", note: "9.3%", watch: "" }] }) });
  it("names no longer held -> stale", () => {
    expect(briefBasis(pepsi(), nvdaOnly).why).toBe("names");
  });
  it("a stated total far from the live one -> stale, even when every name still matches", () => {
    const a: DailyBrief = { ...pepsi(), sections: sections({ lede: "A $26,600 book led by Nvidia.", positions: [{ name: "NVDA", note: "", watch: "" }] }) };
    expect(statedTotal(a)).toBe(26600);
    expect(briefBasis(a, nvdaOnly, 27000).stale).toBe(false);
    expect(briefBasis(a, nvdaOnly, 3375)).toEqual({ stale: true, why: "total", unheld: [] });
    expect(statedTotal({ ...a, sections: sections({ lede: "Total assets $274.9K" }) })).toBe(274900);
    expect(statedTotal({ ...a, sections: sections({ lede: "a $5 move in NVDA" }) })).toBeNull();
  });
  it("Home labels it and offers Refresh assessment once, which kicks the pipeline", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(nvdaOnly), getDailyBriefs: vi.fn().mockResolvedValue([pepsi()]) });
    render(<App api={api} />);
    // nothing it names is held: its body is not shown at all (fix4), and Refresh is still on offer
    const card = await screen.findByTestId("brief-foreign");
    expect(card.textContent).toMatch(/^Your brief\s*Your next brief will cover your current holdings\./);
    expect(card.textContent).not.toMatch(/Pepsi/);
    await userEvent.click(within(card).getByTestId("brief-refresh-assessment"));
    await waitFor(() => expect(api.brokerageConnected).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("brief-refresh-assessment")).toBeNull();   // the pending run takes over
    expect(await screen.findByTestId("assessment-card")).toBeTruthy();
  });
  it("no Refresh while a run is already pending", async () => {
    localStorage.setItem("assetly-assess:u-test", JSON.stringify({ startedAt: new Date().toISOString(), first: false }));
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(nvdaOnly), getDailyBriefs: vi.fn().mockResolvedValue([pepsi()]) });
    render(<App api={api} />);
    const card = await screen.findByTestId("brief-foreign");
    expect(within(card).queryByTestId("brief-refresh-assessment")).toBeNull();
  });
});

describe("G3 a long Ask wait says what it is doing, and a failure offers Retry", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("8s: Still thinking…; 20s: pulling fresh data…; then a plain error with Retry that asks again", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const ask = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }))
      .mockResolvedValueOnce({ answer: "Healthy enough.", followups: [] });
    const api = stubApi({ ask });
    render(<AskScreen api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "How healthy is my portfolio?" }));
    expect(screen.queryByTestId("ask-wait")).toBeNull();
    act(() => { vi.advanceTimersByTime(ASK_SLOW_MS); });
    expect(screen.getByTestId("ask-wait").textContent).toBe("Still thinking…");
    act(() => { vi.advanceTimersByTime(ASK_SLOWER_MS - ASK_SLOW_MS); });
    expect(screen.getByTestId("ask-wait").textContent).toBe("Taking longer than usual, pulling fresh data…");
    await act(async () => { fail(new Error("The analyst lost the thread mid-answer. Ask again.")); });
    const err = screen.getByTestId("ask-error");
    expect(err.textContent).toMatch(/^That didn't go through\. Try again\./);
    expect(err.textContent).not.toMatch(/analyst/);
    await act(async () => { fireEvent.click(within(err).getByRole("button", { name: "Retry" })); });
    await act(async () => { await Promise.resolve(); });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toBe("How healthy is my portfolio?");
    expect(screen.getByTestId("ask-answer").textContent).toMatch(/Healthy enough/);
    expect(screen.getAllByText("How healthy is my portfolio?").filter((n) => n.className.includes("bubble"))).toHaveLength(1);
  });
  it("offline: says so, not a generic failure", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const api = stubApi();
    render(<AskScreen api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "What should I watch this week?" }));
    expect((await screen.findByTestId("ask-error")).textContent).toMatch(/^You're offline\. Ask needs a connection\./);
    expect(api.ask).not.toHaveBeenCalled();
    online.mockRestore();
  });
});

describe("G4 a double tap in the web view acts once, never zero times (r3 native M1)", () => {
  afterEach(() => { vi.useRealTimers(); });
  const touch = (el: Element, type: "touchstart" | "touchend") => {
    const t = { clientX: 10, clientY: 10, identifier: 0, target: el } as unknown as Touch;
    el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), type === "touchstart" ? { touches: [t], changedTouches: [t] } : { touches: [], changedTouches: [t] }));
  };
  it("two taps 50ms apart that WebKit turned into no click: exactly one click lands", () => {
    vi.useFakeTimers();
    const off = installTapRescue(document);
    const btn = document.createElement("button"); const onClick = vi.fn();
    btn.addEventListener("click", onClick); btn.innerHTML = "<span>Add lot</span>";
    document.body.appendChild(btn);
    touch(btn.firstChild as Element, "touchstart"); touch(btn.firstChild as Element, "touchend");
    vi.advanceTimersByTime(50);
    touch(btn, "touchstart"); touch(btn, "touchend");
    vi.advanceTimersByTime(RESCUE_MS + 50);
    expect(onClick).toHaveBeenCalledTimes(1);
    off(); btn.remove();
  });
  it("a tap WebKit delivered is never doubled", () => {
    vi.useFakeTimers();
    const off = installTapRescue(document);
    const btn = document.createElement("button"); const onClick = vi.fn();
    btn.addEventListener("click", onClick); document.body.appendChild(btn);
    touch(btn, "touchstart"); touch(btn, "touchend"); btn.click();
    vi.advanceTimersByTime(RESCUE_MS + 50);
    expect(onClick).toHaveBeenCalledTimes(1);
    // the first tap delivered, the second eaten: still one
    touch(btn, "touchstart"); touch(btn, "touchend"); btn.click();
    vi.advanceTimersByTime(40);
    touch(btn, "touchstart"); touch(btn, "touchend");
    vi.advanceTimersByTime(RESCUE_MS + 50);
    expect(onClick).toHaveBeenCalledTimes(2);
    off(); btn.remove();
  });
  it("a disabled control is never pressed", () => {
    vi.useFakeTimers();
    const off = installTapRescue(document);
    const btn = document.createElement("button"); const onClick = vi.fn();
    btn.addEventListener("click", onClick); btn.disabled = true; document.body.appendChild(btn);
    touch(btn, "touchstart"); touch(btn, "touchend");
    vi.advanceTimersByTime(RESCUE_MS + 50);
    expect(onClick).not.toHaveBeenCalled();
    off(); btn.remove();
  });
  it("Add lot: two clicks 50ms apart write exactly one lot", async () => {
    let settle!: () => void;
    const addLot = vi.fn().mockImplementation(() => new Promise<void>((r) => { settle = r; }));
    const api = stubApi({ addLot });
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
    await userEvent.click(await screen.findByRole("button", { name: "+ Lot" }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "2");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "100");
    const save = screen.getByRole("button", { name: /^add lot$/i });
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(save);
    expect(addLot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy();
    await act(async () => { settle(); });
  });
});

describe("G5 holdings read right", () => {
  it("a coin's lots and rows use its own unit; a coin added by hand is in Crypto, not a brokerage", async () => {
    expect(qtyUnit({ symbol: "ETH-USD", kind: "crypto" })).toBe("ETH");
    expect(qtyUnit({ symbol: "BTC", kind: "crypto" })).toBe("BTC");
    expect(qtyUnit({ symbol: "WEIRD.COIN-XYZ", kind: "crypto" })).toBe("coins");
    expect(qtyUnit({ symbol: "NVDA", kind: "equity" })).toBe("sh");
    expect(accountHeading({ kind: "crypto", account: "brokerage" })).toBe("Crypto account");
    expect(accountHeading({ kind: "crypto", account: "ira" })).toBe("IRA account");
    expect(accountHeading({ kind: "equity", account: "brokerage" })).toBe("Brokerage account");
    const eth = row({ holding_id: "e1", symbol: "ETH-USD", name: "Ethereum", kind: "crypto", qty: 0.85, price: 2694.75, value: 2290, avg_cost: 2410 });
    const lots: Lot[] = [{ id: "l1", holding_id: "e1", qty: 0.85, cost_per_share: 2410, acquired_on: null, note: null }];
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), eth]), getLots: vi.fn().mockResolvedValue(lots) });
    render(<App api={api} />);
    const card = await screen.findByTestId("positions-card");
    expect(card.textContent).toMatch(/0\.85 ETH/);
    await userEvent.click(within(card).getByRole("button", { name: /Ethereum/ }));
    expect((await screen.findByTestId("position-account")).textContent).toMatch(/^Crypto account/);
    expect(await screen.findByText(/0\.85 ETH @ \$2,410\.00/)).toBeTruthy();
    expect(screen.queryByText(/ sh @ /)).toBeNull();
  });
  it("a cash balance says its amount once and has one Edit", async () => {
    const cash = row({ holding_id: "c1", symbol: "$CASH", name: "Cash (USD)", kind: "cash", account: "bank", qty: 2500, price: 1, value: 2500, cost_basis: 2500, total_gl: 0, change_pct: 0 });
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), cash]),
      getLots: vi.fn().mockResolvedValue([{ id: "l1", holding_id: "c1", qty: 2500, cost_per_share: 1, acquired_on: null, note: null }]) });
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /^Cash/ }));
    await screen.findByRole("button", { name: /^edit amount$/i });
    const main = document.querySelector("main")!;
    expect(main.textContent!.match(/\$2,500/g)).toHaveLength(1);
    expect(within(main).getAllByRole("button", { name: /edit/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^remove cash balance$/i })).toBeTruthy();
  });
  it("company names as people say them; never a repeat of the ticker", () => {
    expect(companyName("Microsoft Corporation")).toBe("Microsoft");
    expect(companyName("Tesla, Inc.")).toBe("Tesla");
    expect(companyName("Amazon.com Inc")).toBe("Amazon");
    expect(companyName("Alphabet Inc. Class A")).toBe("Alphabet");
    expect(companyName("Broadcom Inc.")).toBe("Broadcom");
    expect(companyName("Samsung Electronics Co., Ltd.")).toBe("Samsung Electronics");
    expect(companyName("Vanguard S&P 500 ETF")).toBe("Vanguard S&P 500 ETF");
    expect(labelParts({ symbol: "MSFT", name: "Microsoft Corporation" })).toEqual({ main: "MSFT", sub: "Microsoft" });
    expect(labelParts({ symbol: "MARA", name: "MARA Holdings, Inc." })).toEqual({ main: "MARA", sub: "" });
  });
  it("compact money has one precision rule per column; a won price fits a narrow row", () => {
    expect(signedMoneyCompact(-16000, "USD")).toBe("−$16.0K");
    expect(signedMoneyCompact(17900, "USD")).toBe("+$17.9K");
    expect(signedMoneyCompact(2000, "USD")).toBe("+$2.0K");
    expect(signedMoneyCompact(640, "USD")).toBe("+$640");
    expect(priceCompact(1_860_000, "KRW")).toBe("₩1.86M");
    expect(priceCompact(285_500, "KRW")).toBe("₩285.5K");
    expect(priceCompact(339.91, "USD")).toBe("$339.91");
  });
  it("a ₩ amount on a dollar stock never gets a $ echo", () => {
    expect(entryPreview({ kind: "equity", qty: "10", cost: "₩1,000", currency: "USD" })).toBeNull();
    expect(entryPreview({ kind: "equity", qty: "10", cost: "$1,000", currency: "USD" })).toBe("10 shares × $1,000.00 = $10,000.00");
    expect(entryPreview({ kind: "crypto", qty: "0.85", cost: "2,410", currency: "USD", unit: "ETH" })).toBe("0.85 ETH × $2,410.00 = $2,048.50");
  });
  it("company-only lines never reach a coin's card", () => {
    expect(forCoin(["ETH up 42.9% in 60 days.", "No earnings call on file; most recent SEC filing is 10-Q dated 2026-08-07.", "SEC approves ether staking ETFs."]))
      .toEqual(["ETH up 42.9% in 60 days.", "SEC approves ether staking ETFs."]);
  });
  it("a horizon never breaks inside itself", () => {
    expect(investorLabel(INVESTOR_DEFAULT)).toMatch(/3⁠–⁠10 years$/);
  });
});

describe("G6 charts: the scrub readout and the session day", () => {
  it("no year inside a year; the year from 1Y out; the hour on 1D", () => {
    const ts = "2026-09-25T18:30:00Z";
    expect(scrubLabel(ts, "1M", "America/New_York")).toBe("Fri, Sep 25");
    expect(scrubLabel(ts, "YTD", "America/New_York")).toBe("Fri, Sep 25");
    expect(scrubLabel(ts, "1Y", "America/New_York")).toBe("Sep 25, 2026");
    expect(scrubLabel(ts, "1D", "America/New_York")).toMatch(/^Fri 2:30\s?PM$/);
  });
  it("a KRX session is dated in Seoul: Wednesday's close is Wednesday", () => {
    expect(chartZone("005930.KS")).toBe("Asia/Seoul");
    expect(chartZone("NVDA")).toBeUndefined();
    // Wed 15:30 KST = Wed 06:30 UTC = Tue 11:30 PM Pacific
    expect(scrubLabel("2026-09-23T06:30:00Z", "1D", chartZone("005930.KS"))).toMatch(/^Wed 3:30\s?PM$/);
  });
});

describe("G7 News: a page at a time, by day, and offline says so", () => {
  const now = new Date(2026, 8, 25, 14, 0);
  const item = (i: number, daysAgo: number): NewsItem => ({ id: `n${i}`, symbol: "RDDT", title: `Story ${i}`, url: `https://x/${i}`, source: "Reuters",
    published_at: new Date(now.getTime() - daysAgo * 86400_000 - i * 60_000).toISOString() });
  it("Today, Yesterday, then the date", () => {
    expect(newsDay(item(0, 0).published_at, now)).toBe("Today");
    expect(newsDay(item(0, 1).published_at, now)).toBe("Yesterday");
    expect(newsDay(item(0, 2).published_at, now)).toBe("Wed, Sep 23");
    expect(newsDay(null, now)).toBe("Earlier");
    expect(groupByDay([item(1, 0), item(2, 0), item(3, 1)], now).map((g) => [g.day, g.items.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
  });
  it("the feed shows 40, then Show more", async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ ...item(i, Math.floor(i / 20)), published_at: new Date(Date.now() - i * 3600_000).toISOString() }));
    const api = stubApi({ getNews: vi.fn().mockResolvedValue(many) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /news/i }));
    await screen.findAllByTestId("news-day");
    expect(screen.getAllByText(/^Story \d+$/)).toHaveLength(NEWS_PAGE);
    await userEvent.click(screen.getByTestId("news-more"));
    expect(screen.getAllByText(/^Story \d+$/)).toHaveLength(55);
    expect(screen.queryByTestId("news-more")).toBeNull();
  });
  it("offline: the message shows at once, with Retry", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const api = stubApi();
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /news/i }));
    const err = await screen.findByTestId("news-error");
    expect(err.textContent).toMatch(/^You're offline\./);
    expect(within(err).getByRole("button", { name: "Retry" })).toBeTruthy();
    online.mockRestore();
  });
});

describe("G8 offline Home keeps its brief and says when prices are from", () => {
  it("the brief read last time stays as a saved copy; the banner is inset with one Retry; nothing says live", async () => {
    const b = brief("close", { lede: "NVDA closed up.", held: ["RDDT"] });
    localStorage.setItem("assetly-briefs", JSON.stringify([b]));
    const api = stubApi({ getDailyBriefs: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      getPortfolio: vi.fn().mockResolvedValueOnce([row({}), row({ holding_id: "h2", symbol: "NVDA", name: "NVIDIA", value: 3000, change_pct: -1.2 })]).mockRejectedValue(new TypeError("Failed to fetch")) });
    render(<App api={api} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-saved").textContent).toMatch(/Saved copy/);
    expect(within(card).getByTestId("brief-lede").textContent).toBe("NVDA closed up.");
  });
  it("a failed refresh: 'Couldn't refresh prices.' inside the screen, and the Movers pill says as of", async () => {
    const api = stubApi({ getPortfolio: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    localStorage.setItem("assetly-book:u-test", JSON.stringify({ v: 2, profile, rows: [row({}), row({ holding_id: "h2", symbol: "NVDA", name: "NVIDIA", value: 3000, change_pct: -1.2 })], fx: { USD: 1, KRW: 1380 } }));
    render(<App api={api} />);
    const banner = await screen.findByTestId("prices-error");
    expect(banner.closest("main")).not.toBeNull();
    expect(banner.textContent).toBe("Couldn't refresh prices. Retry");
    expect(screen.getByTestId("session-label").textContent).toMatch(/^· as of \d{1,2}:\d{2} [AP]M$/);
  });
});

describe("G9 moving into an account that already holds the symbol asks first", () => {
  it("Keep separate leaves both positions alone", async () => {
    const rows = [row({}), row({ holding_id: "h9", account: "ira", qty: 1200, value: 1000 })];
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue(rows), setHoldingAccount: vi.fn().mockResolvedValue("h9") });
    render(<App api={api} />);
    await userEvent.click((await within(await screen.findByTestId("positions-card")).findAllByRole("button", { name: /Reddit/i }))[0]);
    await userEvent.click(await screen.findByRole("button", { name: /^change$/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /move to account/i })).getByRole("button", { name: "IRA" }));
    const sheet = await screen.findByRole("dialog", { name: /confirm merge/i });
    expect(sheet.textContent).toMatch(/You already hold 1,200 sh of RDDT in IRA\. Moving these 24 combines them/);
    await userEvent.click(within(sheet).getByRole("button", { name: /keep separate/i }));
    expect(screen.queryByRole("dialog", { name: /confirm merge/i })).toBeNull();
    expect(api.setHoldingAccount).not.toHaveBeenCalled();
  });
  it("a move into an empty account needs no confirmation", async () => {
    const api = stubApi({ setHoldingAccount: vi.fn().mockResolvedValue("h1") });
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Reddit/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^change$/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /move to account/i })).getByRole("button", { name: "IRA" }));
    await waitFor(() => expect(api.setHoldingAccount).toHaveBeenCalledWith("h1", "ira"));
  });
});

