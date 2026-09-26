// Round-9 polish (1.0.1), client side: a coin's H/L are final the first time they show, a failed first load says
// nothing about an empty book on News or Settings, market times read in ET (or KST) with their label, the Home
// skeleton's brief card has the real card's inset, and news lines drop a clipped "…" and carry their source.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { PriceChart } from "../components/PriceChart";
import { cleanHeadline, makeApi, newsLines, pickHomeBriefs, type Api, type DailyBrief, type HistoryPoint } from "../lib/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { marketClock } from "../lib/format";
import { heldOnly } from "../lib/heldIntel";
import { setPricesDown } from "../lib/net";
import { profile, row, stubApi } from "./fixtures";

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

describe("1 / 8 a coin's 1M H/L are final the first time they show", () => {
  it("1M (the default) shows at once, widens once the hourly week is in to at least 1W's H, and never changes after", async () => {
    const now = Date.now();
    const pts: HistoryPoint[] = [];
    for (let h = 40 * 24; h >= 1; h--) pts.push({ ts: new Date(now - h * 3600e3).toISOString(), price: 80_000 + (40 * 24 - h) * 0.5 });
    pts[pts.length - 60] = { ...pts[pts.length - 60], price: 90_000 };   // an hourly spike, never a day's last
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const getHistory = vi.fn((_s: string, _h: number, o?: { maxPages?: number }) => (o?.maxPages ? gate.then(() => pts) : Promise.resolve(pts)));
    render(<PriceChart api={{ getHistory } as unknown as Api} symbol="BTC-USD" currency="USD" livePrice={80_600} liveAsOf={new Date(now).toISOString()} crypto />);
    await screen.findByTestId("price-chart");
    // the week was asked for at once, alongside 1M; 1M's H/L show the drawn closes meanwhile (r10), then widen
    expect(getHistory.mock.calls.some((c) => c[2]?.maxPages)).toBe(true);
    expect(screen.getByTestId("range-high").textContent).not.toBe("H $90,000.00");
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $90,000.00"));
    const first = screen.getByTestId("range-high").textContent;
    expect(first).toBe("H $90,000.00");
    await userEvent.click(screen.getByRole("tab", { name: "1W" }));
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe("H $90,000.00"));
    await userEvent.click(screen.getByRole("tab", { name: "1M" }));
    await waitFor(() => expect(screen.getByTestId("range-high").textContent).toBe(first));
    expect(getHistory.mock.calls.filter((c) => c[2]?.maxPages)).toHaveLength(1);   // one week read, shared
  });
});

describe("2 a failed first load never reads as an empty book elsewhere", () => {
  it("News and Settings stay neutral", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App api={stubApi({ getProfile: vi.fn().mockResolvedValue(null), getPortfolio: vi.fn().mockResolvedValue([]), getNews: vi.fn().mockResolvedValue([]) })} />);
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await screen.findByTestId("prices-error");
    await userEvent.click(tabs().getByRole("button", { name: /news/i }));

    expect((await screen.findByTestId("news-empty")).textContent).toBe("Your news shows here once your portfolio loads.");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    expect((await screen.findByTestId("markets-row")).textContent).toBe("Not loaded yet");
    expect(document.body.textContent).not.toMatch(/Add a position and its news follows/);
  });
  it("a loaded empty book still says so, without a dash placeholder", async () => {
    render(<App api={stubApi({ getProfile: vi.fn().mockResolvedValue({ ...profile, markets: [] }), getPortfolio: vi.fn().mockResolvedValue([]) })} />);
    await screen.findByText(/Nothing here yet/);
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    expect((await screen.findByTestId("markets-row")).textContent).toBe("None yet");
  });
});

describe("3 / 7 market times in the market's zone, with the label", () => {
  it("ET for US (and the app's reference clock), KST for KRX", () => {
    expect(marketClock("2026-09-23T20:00:00Z")).toBe("4:00 PM ET");
    expect(marketClock("2026-09-23T06:30:00Z", "KR")).toBe("3:30 PM KST");
    expect(marketClock(Date.parse("2026-09-24T00:12:00Z"), "US")).toBe("8:12 PM ET");
  });
  it("Position after the close: 'closed 4:00 PM ET', not '4h ago'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T23:00:00Z"));   // Wed 7 PM ET: the US session closed at 4
    const r = row({ symbol: "RDDT", as_of: "2026-09-23T20:00:00Z", change_pct: 1.2 });
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([r]) })} />);
    const card = await screen.findByTestId("positions-card");
    await userEvent.click(within(card).getByText("RDDT").closest("button")!);
    const head = await screen.findByTestId("position-headline");
    const line = head.nextElementSibling!.textContent!;
    expect(line).toMatch(/today · closed 4:00 PM ET/);
    expect(line).not.toMatch(/ago/);
  });
});

describe("4 the Home skeleton's brief card has the real card's inset", () => {
  it("uses the brief card's own class", async () => {
    render(<App api={stubApi({ getPortfolio: vi.fn().mockReturnValue(new Promise(() => {})) })} />);
    const sk = await screen.findByTestId("home-skeleton-brief");
    expect(sk.className).toMatch(/\bcard\b/);
    expect(sk.className).toMatch(/\binsights\b/);
  });
});

describe("6 news lines: no clipped '…', the source when the server sends one", () => {
  it("takes strings or attributed objects, whatever the field names", () => {
    expect(cleanHeadline("Qualcomm stock jumps 6% after Apple deal renewa...")).toBe("Qualcomm stock jumps 6% after Apple deal renewa");
    expect(cleanHeadline("Meta slides 4%…")).toBe("Meta slides 4%");
    const { news5, news5_sources } = newsLines([
      "Plain line…",
      { title: "Nvidia CEO pushes back", source: "MarketBeat" },
      { headline: "Microsoft lifts dividend", publisher: "Reuters" },
      { text: "" }, 42,
    ]);
    expect(news5).toEqual(["Plain line", "Nvidia CEO pushes back", "Microsoft lifts dividend"]);
    expect(news5_sources).toEqual([null, "MarketBeat", "Reuters"]);
    expect(newsLines(["a", "b"]).news5_sources).toBeNull();
    expect(newsLines(null)).toEqual({ news5: null, news5_sources: null });
  });
  it("the News card shows the source after the line", async () => {
    const ins = { bullets: [], windows: null, model: "m", generated_at: new Date().toISOString(),
      news5: ["Reddit adds AI search"], news5_sources: ["MarketBeat"], held_symbols: ["RDDT"] };
    expect(heldOnly(ins, [row({})]).news5).toEqual([{ text: "Reddit adds AI search", source: "MarketBeat" }]);
    render(<App api={stubApi({ getPortfolioInsights: vi.fn().mockResolvedValue(ins) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /news/i }));
    const list = await screen.findByTestId("news-top5-list");
    expect(list.textContent).toBe("Reddit adds AI search · MarketBeat");
  });
});

describe("10 Home's briefs are chosen by edition and session, not by write time (r9 native MAJOR)", () => {
  const b = (edition: DailyBrief["edition"], brief_date: string, generated_at: string, lede: string = edition): DailyBrief =>
    ({ brief_date, edition, generated_at, audio_path: null, script: null,
       sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: generated_at, day_sign: 1, held: ["RDDT"] } });
  const now = Date.parse("2026-09-26T01:00:00Z");
  // Sep 25: Close written at 4:05 PM ET; a Morning regenerated at 7:28 PM ET; the assessment from Sep 24
  const close = b("close", "2026-09-25", "2026-09-25T20:05:00Z", "Close lede.");
  const lateMorning = b("morning", "2026-09-25", "2026-09-25T23:28:00Z", "Morning lede.");
  const assessment = b("assessment", "2026-09-24", "2026-09-24T22:00:00Z", "Assessment lede.");

  it("a Morning written after 4 PM ET never outranks the Close of the same date: the Close wins", () => {
    const picked = pickHomeBriefs([lateMorning, close], assessment, now);
    expect(picked.map((x) => x.edition)).toEqual(["assessment", "close"]);
    // without an assessment the next edition fills the second slot, and the Close still opens
    expect(pickHomeBriefs([close, lateMorning], null, now).map((x) => x.edition)).toEqual(["morning", "close"]);
  });
  it("close > midday > morning; one row per edition (its newest); only the latest date; the edition goes last even when the assessment was written after it (r10)", () => {
    const midday = b("midday", "2026-09-25", "2026-09-25T17:00:00Z");
    const olderClose = b("close", "2026-09-24", "2026-09-24T20:05:00Z");
    const regenClose = b("close", "2026-09-25", "2026-09-25T21:00:00Z", "Regenerated close.");
    const lateAssessment = b("assessment", "2026-09-25", "2026-09-26T00:30:00Z");
    const picked = pickHomeBriefs([olderClose, midday, close, regenClose, lateMorning], lateAssessment, now);
    expect(picked.map((x) => x.edition)).toEqual(["assessment", "close"]);
    expect(picked[1].sections.lede).toBe("Regenerated close.");
    expect(pickHomeBriefs([midday, lateMorning], null, now).map((x) => x.edition)).toEqual(["morning", "midday"]);
    // a stale assessment (over 14 days) is not offered
    expect(pickHomeBriefs([close], b("assessment", "2026-09-01", "2026-09-01T12:00:00Z"), now).map((x) => x.edition)).toEqual(["close"]);
  });
  it("through the api and onto Home: the Close chip is there and the card opens on it", async () => {
    const q = (rows: unknown[]) => {
      const o: Record<string, unknown> = {};
      for (const k of ["select", "neq", "eq", "order", "limit"]) o[k] = () => o;
      o.then = (res: (v: unknown) => void) => res({ data: rows, error: null });
      return o;
    };
    const sb = { from: vi.fn().mockReturnValueOnce(q([lateMorning, close])).mockReturnValueOnce(q([assessment])) };
    const briefs = await makeApi(sb as unknown as SupabaseClient).getDailyBriefs();
    expect(briefs.map((x) => x.edition)).toEqual(["assessment", "close"]);
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(briefs) })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByRole("button", { name: "Close" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(card).queryByRole("button", { name: "Morning" })).toBeNull();
  });
});
