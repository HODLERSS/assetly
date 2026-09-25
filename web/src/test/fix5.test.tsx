// Round-5 polish (1.0.1), client side: reads fail fast when the connection is known to be down, News keeps its
// list and says its part quietly under the app's banner, "Use today's price" fills what it shows (and dates the
// lot), a coin's week is drawn by the hour, the keypad has a Done everywhere, plus the copy and Import minors.
// Same harness as fix4.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SupabaseClient } from "@supabase/supabase-js";

// the app shell (Capacitor) or a browser: the keypad Done is app-only (r7 newcomer m8)
const nativeFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../lib/native", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/native")>();
  return { ...real, isNative: () => nativeFlag.on || real.isNative() };
});
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

import { App } from "../App";
import { AskScreen } from "../screens/Ask";
import { NewsScreen } from "../screens/News";
import { BriefCard } from "../components/BriefCard";
import { PriceChart } from "../components/PriceChart";
import { AmountField, DateField } from "../components/AmountField";
import { makeApi, type Api, type DailyBrief, type HistoryPoint, type NewsItem } from "../lib/api";
import { OfflineError, setPricesDown } from "../lib/net";
import { quoteInput } from "../lib/numbers";
import { companyName, moneyExact } from "../lib/format";
import { dayGroups } from "../lib/portfolio";
import { hourlyCloses, hourlyRecentHours, ymdIn } from "../lib/chartRange";
const nyToday = () => ymdIn(new Date(), "America/New_York");   // a US stock's session is dated in New York
import { startConnect } from "../lib/native";
import { clearUserLocalState } from "../lib/localState";
import { profile, row, stubApi } from "./fixtures";

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  setPricesDown(false);
});
let onlineSpy: { mockRestore: () => void } | null = null;
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); onlineSpy?.mockRestore(); onlineSpy = null;
  setPricesDown(false); document.documentElement.classList.remove("kb-open");
});

const goOffline = () => { onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); };
const tab = (name: RegExp) => userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name }));

// A PostgREST builder double that records the fail-fast knobs.
function builderSb() {
  const seen = { retry: [] as boolean[], signals: 0, from: 0 };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "neq", "limit"]) q[m] = () => q;
  q.retry = (on: boolean) => { seen.retry.push(on); return q; };
  q.abortSignal = () => { seen.signals++; return q; };
  q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
  const sb = { from: () => { seen.from++; return q; } } as unknown as SupabaseClient;
  return { sb, seen };
}

describe("K1 reads fail fast when the connection is known to be down (r5 designer m-3, power-user, native m4)", () => {
  it("offline, lots, history and the brief are refused before anything is sent", async () => {
    const { sb, seen } = builderSb();
    goOffline();
    const api = makeApi(sb);
    await expect(api.getLots("h1")).rejects.toBeInstanceOf(OfflineError);
    await expect(api.getHistory("BTC-USD", 26)).rejects.toBeInstanceOf(OfflineError);
    await expect(api.getDailyBriefs()).rejects.toBeInstanceOf(OfflineError);
    await expect(api.getPortfolio()).rejects.toBeInstanceOf(OfflineError);
    expect(seen.from).toBe(0);
  });
  it("after a failed price refresh a read goes out once, with no retries, and a hang has a time limit", async () => {
    const { sb, seen } = builderSb();
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([]);                  // a healthy connection keeps postgrest-js's retries
    setPricesDown(true);
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([false]);
    expect(seen.signals).toBe(1);
  });
  it("the App marks the connection down when the price refresh fails, and up again when it lands", async () => {
    const { sb, seen } = builderSb();
    const getPortfolio = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue([row({})]);
    render(<App api={stubApi({ getPortfolio })} />);
    await screen.findByTestId("prices-error");
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([false]);
    await userEvent.click(within(screen.getByTestId("prices-error")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByTestId("prices-error")).toBeNull());
    await makeApi(sb).getLots("h1");
    expect(seen.retry).toEqual([false]);             // no second false: retries are back
  });
  it("a position opened offline says 'Couldn't load your lots.' at once, not after ~7s", async () => {
    const real = makeApi(builderSb().sb);
    const api = stubApi({ getLots: real.getLots });
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    goOffline();
    act(() => { window.dispatchEvent(new Event("offline")); });
    await userEvent.click(within(screen.getByTestId("positions-card")).getByRole("button", { name: /Reddit/i }));
    expect(await screen.findByTestId("lots-error", {}, { timeout: 500 })).toBeTruthy();
  });
});

describe("K2 wave paging (a coin's hourly week)", () => {
  it("pages after the first go out four at a time and still end at the first short page", async () => {
    let inFlight = 0, maxInFlight = 0, calls = 0;
    const total = 10_400;
    const sb = {
      rpc: () => {
        const q = {
          order: () => q,
          range: async (from: number, to: number) => {
            calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            const n = Math.max(0, Math.min(to + 1, total) - from);
            return { data: Array.from({ length: Math.min(n, 1000) }, (_, i) => ({ ts: new Date(1e12 - (from + i) * 60_000).toISOString(), price: 1 })), error: null };
          },
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const pts = await makeApi(sb).getHistory("BTC-USD", 200, { tz: "UTC", recentHours: 190, maxPages: 14, wave: 4 });
    expect(pts).toHaveLength(total);
    expect(maxInFlight).toBe(4);
    expect(calls).toBe(13);                           // 1 + 4 + 4 + 4: the 11th page is short, two empty ones rode along
    expect(pts.every((p, i) => i === 0 || p.ts > pts[i - 1].ts)).toBe(true);
  });
});

describe("K3 News offline keeps its list and says so quietly (r5 designer m-1, m-h)", () => {
  const news: NewsItem[] = [{ id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() }];
  it("the list survives leaving the screen; offline under the app's banner it is one muted line, no second red box", async () => {
    const getNews = vi.fn().mockResolvedValueOnce(news).mockRejectedValue(new TypeError("Load failed"));
    const getPortfolio = vi.fn().mockResolvedValueOnce([row({})]).mockRejectedValue(new TypeError("Load failed"));
    render(<App api={stubApi({ getNews, getPortfolio })} />);
    await screen.findByTestId("positions-card");
    await tab(/news/i);
    await screen.findByText("Reddit posts strong quarter");
    await tab(/home/i);
    goOffline();
    act(() => { window.dispatchEvent(new Event("offline")); });
    await screen.findByTestId("prices-error");
    await tab(/news/i);
    const kept = await screen.findByTestId("news-kept");
    expect(kept.textContent).toMatch(/^Showing news from \d{1,2}:\d{2} [AP]M\.$/);
    expect(screen.queryByTestId("news-error")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);        // the app's banner only
    expect(screen.getByText("Reddit posts strong quarter")).toBeTruthy();
  });
  it("a cold start offline paints the list kept on this device, per user; sign-out clears it", async () => {
    localStorage.setItem("assetly-news:u-test", JSON.stringify({ items: news, at: Date.now() - 3600_000 }));
    goOffline();
    render(<NewsScreen api={stubApi()} rows={[row({})]} uid="u-test" pricesDown />);
    expect(screen.getByText("Reddit posts strong quarter")).toBeTruthy();
    expect((await screen.findByTestId("news-kept")).textContent).toMatch(/^Showing news from/);
    clearUserLocalState("u-test");
    expect(localStorage.getItem("assetly-news:u-test")).toBeNull();
  });
  it("another user's kept list never shows", () => {
    localStorage.setItem("assetly-news:someone-else", JSON.stringify({ items: news, at: Date.now() }));
    goOffline();
    render(<NewsScreen api={stubApi()} rows={[row({})]} uid="u-test" pricesDown />);
    expect(screen.queryByText("Reddit posts strong quarter")).toBeNull();
  });
  it("without the app's banner the News error keeps its own Retry", async () => {
    render(<NewsScreen api={stubApi({ getNews: vi.fn().mockRejectedValue(new Error("boom")) })} rows={[row({})]} uid="u-test" />);
    const err = await screen.findByTestId("news-error");
    expect(within(err).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("K4 Use today's price (r5 designer m-2, power-user, newcomer m7)", () => {
  it("fills exactly the figure it shows, rounded to the currency's minor unit", () => {
    expect(quoteInput(922.765000001, "USD")).toBe("922.77");
    expect(`$${quoteInput(922.765000001, "USD")}`).toBe(moneyExact(922.765000001, "USD"));
    expect(quoteInput(1250.5, "USD")).toBe("1,250.50");
    expect(quoteInput(285_499.6, "KRW")).toBe("285,500");
  });
  it("on Add position it fills the shown price and dates the lot today", async () => {
    const api = stubApi({ getQuote: vi.fn().mockResolvedValue({ price: 922.765000001, asOf: null }) } as Partial<Api>);
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    const use = await screen.findByTestId("use-quote");
    expect(use.textContent).toBe("Use today's price ($922.77)");
    expect(screen.getByText("No date")).toBeTruthy();                      // empty, not a grey date that looks filled
    await userEvent.click(use);
    expect((screen.getByLabelText(/cost per share/i) as HTMLInputElement).value).toBe("922.77");
    expect((screen.getByLabelText(/purchase date/i) as HTMLInputElement).value).toBe(nyToday());
    expect(screen.queryByText("No date")).toBeNull();
    await userEvent.type(screen.getByLabelText(/^shares$/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 10, 922.77, nyToday(), "brokerage", "", ""));
  });
  it("keeps a date already chosen", async () => {
    const api = stubApi({ getQuote: vi.fn().mockResolvedValue({ price: 15, asOf: null }) } as Partial<Api>);
    render(<App api={api} />);
    await screen.findByTestId("positions-card");
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    fireEvent.change(screen.getByLabelText(/purchase date/i), { target: { value: "2024-03-12" } });
    await userEvent.click(await screen.findByTestId("use-quote"));
    expect((screen.getByLabelText(/purchase date/i) as HTMLInputElement).value).toBe("2024-03-12");
  });
  it("onboarding's first add has the button too; saved unchanged, the lot is dated today", async () => {
    const api = stubApi({ getProfile: vi.fn().mockResolvedValueOnce({ ...profile, onboarded_at: null }).mockResolvedValue(profile),
      getQuote: vi.fn().mockResolvedValue({ price: 15.004, asOf: null }) } as Partial<Api>);
    render(<App api={api} />);
    await screen.findByTestId("investor-quiz");
    await userEvent.click(screen.getByTestId("quiz-skip"));
    await userEvent.type(await screen.findByLabelText(/find your first position/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "1,200");
    const use = await screen.findByTestId("use-quote");
    expect(use.textContent).toBe("Use today's price ($15.00)");
    await userEvent.click(use);
    expect((screen.getByLabelText(/cost per share/i) as HTMLInputElement).value).toBe("15.00");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await waitFor(() => expect(api.addPosition).toHaveBeenCalledWith("MARA", 1200, 15, nyToday()));
  });
});

describe("K5 the keypad has a Done on every number field (r5 native m1)", () => {
  it("in the app, while the keyboard is up, a focused amount field carries Done, and Done closes the keypad", async () => {
    nativeFlag.on = true;
    try {
      render(<AmountField id="q" label="Shares" value="" onChange={() => {}} />);
      const input = screen.getByLabelText("Shares");
      document.documentElement.classList.add("kb-open");
      act(() => { input.focus(); });
      const done = screen.getByTestId("kb-done");
      fireEvent.click(done);
      expect(document.activeElement).not.toBe(input);
      expect(screen.queryByTestId("kb-done")).toBeNull();
    } finally { nativeFlag.on = false; document.documentElement.classList.remove("kb-open"); }
  });
  it("on the web there is no extra Done: the browser's keyboard has its own (r7 newcomer m8)", () => {
    render(<AmountField id="q" label="Shares" value="" onChange={() => {}} />);
    document.documentElement.classList.add("kb-open");
    act(() => { screen.getByLabelText("Shares").focus(); });
    expect(screen.queryByTestId("kb-done")).toBeNull();
    document.documentElement.classList.remove("kb-open");
  });
  it("inside a sheet the sheet's own Done is the one (no second bar)", () => {
    render(<div className="sheet"><AmountField id="q" label="Shares" value="" onChange={() => {}} /></div>);
    act(() => { screen.getByLabelText("Shares").focus(); });
    expect(screen.queryByTestId("kb-done")).toBeNull();
  });
  it("an empty optional date says 'No date'", () => {
    const { rerender } = render(<DateField id="d" label="Purchase date (optional)" value="" onChange={() => {}} />);
    expect(screen.getByText("No date")).toBeTruthy();
    rerender(<DateField id="d" label="Purchase date (optional)" value="2026-09-25" onChange={() => {}} />);
    expect(screen.queryByText("No date")).toBeNull();
  });
});

describe("K6 a coin's week is drawn by the hour (r5 native m3); the daily ranges fold every day (r5 power-user)", () => {
  const now = Date.parse("2026-09-25T19:00:00Z");
  // BTC: daily closes to Sep 18 (the 1W base day), then an hourly-ish week of 10-minute prints
  const daily: HistoryPoint[] = [], fine: HistoryPoint[] = [];
  for (let d = 30; d >= 1; d--) daily.push({ ts: new Date(now - d * 86400e3).toISOString().slice(0, 10) + "T23:59:00.000Z", price: 80_000 + d });
  const base = daily.filter((p) => p.ts.slice(0, 10) <= "2026-09-18");
  for (let t = Date.parse("2026-09-19T00:00:00Z"); t <= now; t += 10 * 60_000) fine.push({ ts: new Date(t).toISOString(), price: 81_000 + (t % 7) });
  it("draws the daily line first, then the hourly week, with the same figure; the second call pages the raw week", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    let finish!: (v: HistoryPoint[]) => void;
    const getHistory = vi.fn((_s: string, _h: number, d?: { recentHours?: number; maxPages?: number }) =>
      d?.maxPages ? new Promise<HistoryPoint[]>((r) => { finish = r; }) : Promise.resolve(daily));
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={84_000} liveAsOf="2026-09-25T19:00:00Z" crypto />);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    await waitFor(() => expect(screen.getByTestId("range-change").textContent).toBe(`+${((84_000 / (80_000 + 7) - 1) * 100).toFixed(2)}%`));
    const coarse = screen.getByTestId("price-chart").querySelector("path")!.getAttribute("d")!.split("L").length;
    const calls = getHistory.mock.calls.slice(-2);   // the 1W pair (1M, the default, came first)
    expect(calls.map((c) => c[2]!.recentHours)).toEqual([0, hourlyRecentHours(new Date(now), "UTC")]);
    expect(calls[1][2]).toMatchObject({ maxPages: 14, wave: 4 });
    await act(async () => { finish([...base, ...fine]); });
    await waitFor(() => expect(screen.getByTestId("price-chart").querySelector("path")!.getAttribute("d")!.split("L").length).toBeGreaterThan(100));
    expect(coarse).toBeLessThan(12);
    expect(screen.getByTestId("range-change").textContent).toBe(`+${((84_000 / (80_000 + 7) - 1) * 100).toFixed(2)}%`);
  });
  it("hourly points: the last print of each hour, the live price newest, the folded base close kept", () => {
    const pts = hourlyCloses([{ ts: "2026-09-18T23:59:00Z", price: 1 }, { ts: "2026-09-19T00:05:00Z", price: 2 }, { ts: "2026-09-19T00:55:00Z", price: 3 }, { ts: "2026-09-19T01:10:00+00:00", price: 4 }], 5, "2026-09-19T01:30:00Z");
    expect(pts.map((p) => p.price)).toEqual([1, 3, 5]);
    expect(hourlyRecentHours(new Date(now), "UTC")).toBeCloseTo((now - Date.parse("2026-09-19T00:00:00Z")) / 3600e3);
  });
  it("stocks keep daily points on 1W; a range switch cancels the one it left", async () => {
    const signals: AbortSignal[] = [];
    const getHistory = vi.fn((_s: string, _h: number, _d?: unknown, o?: { signal?: AbortSignal }) => { if (o?.signal) signals.push(o.signal); return new Promise<HistoryPoint[]>(() => {}); });
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="NVDA" currency="USD" livePrice={1} liveAsOf={new Date().toISOString()} />);
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    expect(getHistory.mock.calls.at(-1)![2]).toEqual({ tz: "America/New_York", recentHours: 0 });
    await userEvent.click(screen.getByRole("tab", { name: "1Y" }));
    expect(signals.slice(0, -1).every((s) => s.aborted)).toBe(true);
    expect(signals.at(-1)!.aborted).toBe(false);
  });
  it("a coin's 1D asks for a day, not four", async () => {
    const getHistory = vi.fn().mockResolvedValue([]);
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={1} liveAsOf={new Date().toISOString()} crypto />);
    await userEvent.click(screen.getByRole("tab", { name: "1D" }));
    expect(getHistory.mock.calls.at(-1)![1]).toBe(26);
  });
});

describe("K7 saved copy, Ask, copy (r5 designer m-6, m-f, m-g, m-7)", () => {
  const b: DailyBrief = { brief_date: "2026-09-25", edition: "close", generated_at: new Date().toISOString(), audio_path: "u/2026-09-25/close.mp3", script: null,
    sections: { lede: "NVDA closed up.", overnight: "", positions: [], desk_view: "", calendar: [], held: ["RDDT"] } };
  it("the saved copy does not offer Listen: the narration needs the connection too", async () => {
    localStorage.setItem("assetly-briefs", JSON.stringify([b]));
    render(<BriefCard api={stubApi({ getDailyBriefs: vi.fn().mockRejectedValue(new OfflineError()) })} held={["RDDT"]} />);
    const saved = await screen.findByTestId("brief-saved");
    expect(saved.textContent).toBe("Saved copy. Couldn't refresh your brief. Listening needs a connection.");
    expect(screen.queryByTestId("brief-listen")).toBeNull();
  });
  it("online, the same brief offers Listen", async () => {
    render(<BriefCard api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue([b]) })} held={["RDDT"]} />);
    expect(await screen.findByTestId("brief-listen")).toBeTruthy();
  });
  it("Send keeps its label (for its width) while waiting, with a spinner inside", async () => {
    let settle!: (v: { answer: string; followups: string[] }) => void;
    const ask = vi.fn(() => new Promise<{ answer: string; followups: string[] }>((r) => { settle = r; }));
    render(<AskScreen api={stubApi({ ask })} />);
    await userEvent.type(screen.getByLabelText("Ask about your portfolio"), "How am I doing?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const send = screen.getByRole("button", { name: "Waiting for the answer" });
    expect(send.textContent).toBe("Send");
    expect(send.querySelector(".step-mark.active")).toBeTruthy();
    await act(async () => { settle({ answer: "Fine.", followups: [] }); });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
  it("offline, 'Prices as of' is the prices' own time, not when they were fetched", async () => {
    const asOf = new Date(Date.now() - 37 * 60_000).toISOString();
    const getPortfolio = vi.fn().mockResolvedValueOnce([row({ as_of: asOf })]).mockRejectedValue(new TypeError("Load failed"));
    render(<App api={stubApi({ getPortfolio })} />);
    await screen.findByTestId("positions-card");
    goOffline();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect((await screen.findByTestId("prices-as-of")).textContent)
      .toBe(`Prices as of ${new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
  });
  it("names and labels: 'Coca-Cola', markets in one order, 'Cash balance'", async () => {
    expect(companyName("The Coca-Cola Company")).toBe("Coca-Cola");
    expect(companyName("The Trade Desk, Inc.")).toBe("Trade Desk");
    expect(companyName("The Beatles")).toBe("The Beatles");      // nothing stripped, nothing changed
    const ko = row({ holding_id: "ko", symbol: "KO", kind: "equity", value: 30_734, change_pct: 0.5 });
    const btc = row({ holding_id: "btc", symbol: "BTC-USD", kind: "crypto", value: 29_416, change_pct: -0.4 });
    expect(dayGroups([ko, btc], "USD", { USD: 1 })[0].markets).toEqual(["US", "Crypto"]);
    expect(dayGroups([btc, ko], "USD", { USD: 1 })[0].markets).toEqual(["US", "Crypto"]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({}), row({ holding_id: "c", symbol: "$CASH", kind: "cash", account: "bank", value: 5000, change_pct: null })]) })} />);
    expect((await screen.findByTestId("positions-card")).textContent).toMatch(/Cash balance · Bank/);
  });
});

describe("K8 Import: busy, one call per tap, errors said, the web window opened inside the tap (r5 power-user)", () => {
  it("startConnect opens the window before the link comes back, then points it at the portal", async () => {
    const win = { closed: false, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.fn().mockReturnValue(win);
    vi.stubGlobal("open", open);
    let give!: (u: string) => void;
    const p = startConnect(() => new Promise<string>((r) => { give = r; }));
    expect(open).toHaveBeenCalledWith("about:blank", "assetly-connect", expect.any(String));   // synchronous, inside the tap
    give("https://connect.snaptrade.test/portal");
    await p;
    expect(win.location.href).toBe("https://connect.snaptrade.test/portal");
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("a failure closes the blank window and reaches the caller", async () => {
    const win = { closed: false, location: { href: "about:blank" }, close: vi.fn() };
    vi.stubGlobal("open", vi.fn().mockReturnValue(win));
    await expect(startConnect(async () => { throw new Error("Brokerage link is unavailable right now."); })).rejects.toThrow(/unavailable/);
    expect(win.close).toHaveBeenCalled();
  });
  it("Home's Import: a double tap is one call, the chip says it is working, and a failure is shown", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({ closed: false, location: { href: "" }, close: vi.fn() }));
    let fail!: (e: Error) => void;
    const snaptrade = vi.fn((action: string) => action === "connect" ? new Promise<never>((_, rej) => { fail = rej; }) : Promise.resolve({ ok: true, connected: false }));
    render(<App api={stubApi({ snaptrade } as Partial<Api>)} />);
    await screen.findByTestId("positions-card");
    const chip = screen.getByRole("button", { name: "Import from brokerage" });
    await userEvent.dblClick(chip);
    expect(snaptrade.mock.calls.filter((c) => c[0] === "connect")).toHaveLength(1);
    expect(chip.textContent).toMatch(/Opening…/);
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fail(new Error("Brokerage link is unavailable right now.")); });
    expect((await screen.findByTestId("connect-error")).textContent).toBe("Brokerage link is unavailable right now.");
    expect(chip.textContent).toMatch(/Import$/);
  });
});

describe("early access: brokerage import full", () => {
  it("Settings shows the server's message instead of swallowing a refused connect", async () => {
    const msg = "Brokerage import is full during early access. Add your holdings by hand for now: it takes about a minute, and you can connect later.";
    const api = stubApi({ snaptrade: vi.fn().mockImplementation(async (action: string) => {
      if (action === "connect") throw new Error(msg);
      return { ok: true, connected: false };
    }) });
    render(<App api={api} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /settings/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Connect brokerage" }));
    expect((await screen.findByTestId("settings-connect-error")).textContent).toBe(msg);
  });
});
