// Round-11 polish (1.0.1), client side: News never keeps a read made before the holdings were known, Settings
// shows nothing unknown as a fact, "Your first assessment" only for a reader with no briefs, a lot delete says
// what it did, the brief card remembers the edition being read across a remount, and verify.html's invalid state.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { App } from "../App";
import { NewsScreen } from "../screens/News";
import { BriefCard } from "../components/BriefCard";
import type { DailyBrief, Lot, NewsItem } from "../lib/api";
import { setPricesDown } from "../lib/net";
import { __resetPlayer, getSnapshot } from "../lib/player";
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
  __resetPlayer();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPricesDown(false); });

const tabs = () => within(screen.getByRole("navigation", { name: "Tabs" }));
const story: NewsItem = { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() };

describe("1 News: no read before the holdings are known, and the list is kept per holdings set", () => {
  it("a slow book: nothing is read or kept while it loads; once it lands the stories show, never 'Nothing fresh'", async () => {
    const getNews = vi.fn().mockResolvedValue([story]);
    const api = stubApi({ getNews });
    const { rerender } = render(<NewsScreen api={api} rows={[]} uid="u-news-1" bookUnknown />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getNews).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing fresh/)).toBeNull();
    rerender(<NewsScreen api={api} rows={[row({})]} uid="u-news-1" />);
    expect(await screen.findByText("Reddit posts strong quarter")).toBeTruthy();
    expect(getNews).toHaveBeenCalledWith(["RDDT"]);
    expect(screen.queryByText(/Nothing fresh/)).toBeNull();
  });
  it("an empty list read for one holdings set never shows for another", async () => {
    const getNews = vi.fn().mockImplementation(async (scope: string[]) => (scope.includes("NVDA") ? [{ ...story, id: "n2", symbol: "NVDA", title: "Nvidia news" }] : []));
    const api = stubApi({ getNews, refreshNews: vi.fn().mockResolvedValue(true) });
    const { rerender } = render(<NewsScreen api={api} rows={[row({})]} uid="u-news-2" />);
    await screen.findByText(/Nothing fresh/);
    rerender(<NewsScreen api={api} rows={[row({}), row({ holding_id: "h2", symbol: "NVDA", name: "NVIDIA" })]} uid="u-news-2" />);
    expect(await screen.findByText("Nvidia news")).toBeTruthy();
    expect(screen.queryByText(/Nothing fresh/)).toBeNull();
  });
});

describe("2 Settings: nothing unknown shown as a fact", () => {
  it("disabled chips look disabled", () => {
    const css = readFileSync(`${process.cwd()}/src/theme.css`, "utf8");
    expect(css).toMatch(/\.chip:disabled \{ opacity: \.45;/);
  });
  it("after a failed first load: currency and brokerage read 'Not loaded yet', no Connect button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App api={stubApi({ getProfile: vi.fn().mockResolvedValue(null), getPortfolio: vi.fn().mockResolvedValue([]),
      snaptrade: vi.fn().mockRejectedValue(new Error("down")) })} />);
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await screen.findByTestId("prices-error");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    expect((await screen.findByTestId("base-currency")).textContent).toBe("Not loaded yet");
    await waitFor(() => expect(screen.getByTestId("brokerage-status").textContent).toBe("Not loaded yet"));
    expect(screen.queryByRole("button", { name: "Connect brokerage" })).toBeNull();
  });
  it("while the brokerage status is being read: 'Checking…', no Connect yet", async () => {
    render(<App api={stubApi({ snaptrade: vi.fn().mockReturnValue(new Promise(() => {})) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(tabs().getByRole("button", { name: /settings/i }));
    expect((await screen.findByTestId("brokerage-status")).textContent).toBe("Checking…");
    expect(screen.queryByRole("button", { name: "Connect brokerage" })).toBeNull();
  });
});

describe("3 'Your first assessment' only for a reader with no briefs", () => {
  it("an established reader adding a position sees 'Updating your assessment', even before the first poll", async () => {
    const at = new Date(Date.now() - 3600_000).toISOString();
    const close: DailyBrief = { brief_date: at.slice(0, 10), edition: "close", generated_at: at, audio_path: null, script: null,
      sections: { lede: "Close.", overnight: "", positions: [], desk_view: "", calendar: [], as_of: at, day_sign: 1, held: ["RDDT"] } };
    // the poll says "no earlier assessment": still not "first", this reader has briefs
    const api = stubApi({ getDailyBriefs: vi.fn().mockResolvedValue([close]),
      getAssessmentStatus: vi.fn().mockResolvedValue({ status: "pending", generatedAt: null, intelligenceAt: null, hadEarlier: false }) });
    render(<App api={api} />);
    await screen.findByTestId("brief-card");
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });   // the brief watcher's first look
    await userEvent.click(screen.getByRole("button", { name: "Add position" }));
    await userEvent.type(screen.getByLabelText(/ticker or name/i), "MARA");
    await userEvent.click(await screen.findByRole("button", { name: /MARA Holdings/i }));
    await userEvent.type(screen.getByLabelText(/^shares$/i), "5");
    await userEvent.type(screen.getByLabelText(/cost per share/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /^add position$/i }));
    await screen.findByTestId("added-strip");
    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    const card = await screen.findByTestId("assessment-card");
    expect(card.textContent).toMatch(/Updating your assessment/);
    await waitFor(() => expect(api.getAssessmentStatus).toHaveBeenCalled());
    expect(screen.getByTestId("assessment-card").textContent).not.toMatch(/Your first assessment/);
  });
});

describe("4 a lot delete says what it did", () => {
  const voo = row({ holding_id: "hv", symbol: "VOO", name: "Vanguard S&P 500 ETF", qty: 1000.001, value: 600_000 });
  const big: Lot = { id: "l-big", holding_id: "hv", qty: 1000, cost_per_share: 500, acquired_on: "2024-01-02", note: null };
  const tiny: Lot = { id: "l-tiny", holding_id: "hv", qty: 0.001, cost_per_share: 500, acquired_on: "2026-09-25", note: null };
  const del = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /^Edit lot 0\.001 shares$/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Delete (this lot|lot and position)$/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Confirm delete" })).getByRole("button", { name: /^(Delete lot|Remove position)$/ }));
  };
  const open = async (api: ReturnType<typeof stubApi>) => {
    render(<App api={api} />);
    await userEvent.click(await within(await screen.findByTestId("positions-card")).findByRole("button", { name: /Vanguard|VOO/ }));
  };
  it("'Lot deleted' when the lot went", async () => {
    await open(stubApi({ getPortfolio: vi.fn().mockResolvedValue([voo]), getLots: vi.fn().mockResolvedValue([big, tiny]) }));
    await del();
    expect((await screen.findByText("Lot deleted"))).toBeTruthy();
  });
  it("when the server had already dropped it: says so, and that the position is unchanged", async () => {
    const getLots = vi.fn().mockResolvedValueOnce([big, tiny]).mockResolvedValue([big]);
    const api = stubApi({ getPortfolio: vi.fn().mockResolvedValue([voo]), getLots });
    await open(api);
    await del();
    expect(await screen.findByText(/That lot was already gone\. VOO is unchanged\./)).toBeTruthy();
    expect(api.deleteLot).not.toHaveBeenCalled();
    expect(api.removeHolding).not.toHaveBeenCalled();
  });
});

describe("m3 (native): the card keeps the edition being read across a remount", () => {
  const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const b = (edition: DailyBrief["edition"], g: string, lede: string, script: string | null = null): DailyBrief =>
    ({ brief_date: g.slice(0, 10), edition, generated_at: g, audio_path: null, script,
       sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: g, day_sign: 1, held: ["RDDT"] } });
  it("pick Assessment, play it, leave and come back: the card shows the Assessment", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: () => [{ lang: "en-US", name: "Samantha", default: true }], speaking: false, paused: false });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; onstart?: () => void; onend?: () => void; onerror?: () => void; rate = 1; voice = null; lang = "en-US"; constructor(t: string) { this.text = t; } });
    const briefs = [b("assessment", at(2), "Assessment lede.", "The assessment script."), b("close", at(1), "Close lede.", "The close script.")];
    const api = stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(briefs) });
    const first = render(<BriefCard api={api} held={["RDDT"]} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Close lede.");
    await userEvent.click(within(card).getByRole("button", { name: "Assessment" }));
    const listen = within(card).queryByTestId("brief-listen");
    if (listen) await userEvent.click(listen);
    first.unmount();   // a tab switch: Home and the card are gone
    render(<BriefCard api={api} held={["RDDT"]} />);
    expect(within(await screen.findByTestId("brief-card")).getByTestId("brief-lede").textContent).toBe("Assessment lede.");
    void getSnapshot;
  });
  it("once a newer edition lands, an old pick that is not playing lapses", async () => {
    const api = stubApi({ getDailyBriefs: vi.fn().mockResolvedValue([b("morning", at(8), "Morning lede."), b("close", at(1), "Close lede.")]) });
    const first = render(<BriefCard api={api} held={["RDDT"]} />);
    const card = await screen.findByTestId("brief-card");
    await userEvent.click(within(card).getByRole("button", { name: "Morning" }));
    first.unmount();
    (api.getDailyBriefs as ReturnType<typeof vi.fn>).mockResolvedValue([b("morning", at(8), "Morning lede."), b("midday", at(4), "Midday lede."), b("close", at(1), "Close lede.")]);
    render(<BriefCard api={api} held={["RDDT"]} />);
    await waitFor(() => expect(within(screen.getByTestId("brief-card")).getByTestId("brief-lede").textContent).toBe("Close lede."));
  });
});

describe("6 verify.html's invalid state", () => {
  it("titles the tab, says 'request a new link', and Continue opens the app", () => {
    const html = readFileSync(`${process.cwd()}/public/verify.html`, "utf8");
    expect(html).toMatch(/document\.title = "Link not valid · Assetly";/);
    expect(html).toMatch(/"Open Assetly and request a new link\."/);
    expect(html).toMatch(/<a class="btn" id="go" href="\.\/" hidden>Continue<\/a>/);
    expect(html).toMatch(/getElementById\("go"\)\.href = "\.\/";/);
  });
});

describe("5 narrow widths", () => {
  it("lot rows move the date under the amount at 320; the header status wraps under large text", () => {
    const css = readFileSync(`${process.cwd()}/src/client.css`, "utf8");
    expect(css).toMatch(/@media \(max-width: 340px\) \{\s*\.lot-row \.lot-date-wide \{ display: none; \}/);
    expect(css).toMatch(/\.text-large \.topbar-status \{ white-space: normal;/);
  });
  it("Ask at 320 with large text: 'Ask…'", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(max-width: 359px)", media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const { setTextScale } = await import("../lib/shell");
    setTextScale(1.6);
    try {
      render(<App api={stubApi()} />);
      await screen.findByTestId("net-worth");
      await userEvent.click(tabs().getByRole("button", { name: /ask/i }));
      expect((await screen.findByLabelText("Ask about your portfolio")).getAttribute("placeholder")).toBe("Ask…");
    } finally { setTextScale(1); }
  });
  void profile;
});
