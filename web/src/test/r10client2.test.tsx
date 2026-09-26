// r10 native, second batch: every edition of the day is reachable, the brief card follows the narration that is
// playing, the brief date never clips at AX5, and attributed news lines ({text, source}) show their outlet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "../App";
import { makeApi, pickHomeBriefs, type DailyBrief } from "../lib/api";
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
// the player's state, set per test: what is loaded and whether it is playing
const playerState = vi.hoisted(() => ({ value: { track: null as null | { id: string; title: string; subtitle: string }, playing: false } }));
vi.mock("../lib/player", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/player")>();
  // one stable snapshot per state (useSyncExternalStore loops on a fresh object every call)
  let last: unknown = null, lastKey = "";
  return { ...real, getSnapshot: () => {
    const key = JSON.stringify(playerState.value);
    if (key !== lastKey) { lastKey = key; last = { ...real.getSnapshot(), ...playerState.value }; }
    return last as ReturnType<typeof real.getSnapshot>;
  } };
});

beforeEach(() => {
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  playerState.value = { track: null, playing: false };
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom */ }
  setPricesDown(false);
});
afterEach(() => { setPricesDown(false); });

const b = (edition: DailyBrief["edition"], brief_date: string, generated_at: string, lede: string): DailyBrief =>
  ({ brief_date, edition, generated_at, audio_path: `u/${edition}.mp3`, script: null,
     sections: { lede, overnight: "", positions: [], desk_view: "", calendar: [], as_of: generated_at, day_sign: 1, held: ["RDDT"] } });
const now = Date.parse("2026-09-26T01:00:00Z");
const morning = b("morning", "2026-09-25", "2026-09-25T12:10:00Z", "Morning lede.");
const midday = b("midday", "2026-09-25", "2026-09-25T17:00:00Z", "Midday lede.");
const close = b("close", "2026-09-25", "2026-09-25T20:05:00Z", "Close lede.");
const assessment = b("assessment", "2026-09-25", "2026-09-26T00:30:00Z", "Assessment lede.");

describe("every edition of the day is a chip; the card opens on the latest", () => {
  it("three editions and an assessment: all reachable, Close open", async () => {
    const briefs = pickHomeBriefs([close, morning, midday], assessment, now);
    expect(briefs.map((x) => x.edition)).toEqual(["assessment", "morning", "midday", "close"]);
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(briefs) })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Close lede.");
    await userEvent.click(within(card).getByRole("button", { name: "Midday" }));
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Midday lede.");
  });
});

describe("the card follows the narration that is playing", () => {
  it("back on Home while the Morning plays, the card shows the Morning, not the default", async () => {
    playerState.value = { track: { id: "2026-09-25:morning", title: "Morning Brief", subtitle: "Sep 25" }, playing: true };
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(pickHomeBriefs([morning, close], assessment, now)) })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Morning lede.");
    // a pick still wins
    await userEvent.click(within(card).getByRole("button", { name: "Assessment" }));
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Assessment lede.");
  });
  it("paused, the card opens on the latest edition as usual", async () => {
    playerState.value = { track: { id: "2026-09-25:morning", title: "Morning Brief", subtitle: "Sep 25" }, playing: false };
    render(<App api={stubApi({ getDailyBriefs: vi.fn().mockResolvedValue(pickHomeBriefs([morning, close], null, now)) })} />);
    expect(within(await screen.findByTestId("brief-card")).getByTestId("brief-lede").textContent).toBe("Close lede.");
  });
});

describe("AX5: the brief date never clips", () => {
  it("under large text nothing around the title clips, and the date moves as one unit", () => {
    const css = readFileSync(`${process.cwd()}/src/client.css`, "utf8");
    expect(css).toMatch(/\.text-large \.insights-head \.brief-title \{[^}]*overflow: visible;[^}]*text-overflow: clip;/);
    expect(css).toMatch(/\.text-large \.brief-title \.brief-title-name \{[^}]*overflow: visible;/);
    expect(css).toMatch(/\.text-large \.brief-title \.brief-title-date \{ display: inline-block; \}/);
  });
});

describe("news5 as the server writes it now ({text, source}) shows its outlet on the News card", () => {
  it("through the api and onto News", async () => {
    const row0 = { bullets: [], model: "m", generated_at: new Date().toISOString(), held_symbols: ["RDDT"],
      news5: [{ text: "Reddit adds AI search", source: "MarketBeat" }, "An older plain line"] };
    const q: Record<string, unknown> = {};
    for (const k of ["select", "order", "limit"]) q[k] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: row0, error: null });
    const ins = await makeApi({ from: () => q } as unknown as SupabaseClient).getPortfolioInsights();
    expect(ins!.news5).toEqual(["Reddit adds AI search", "An older plain line"]);
    expect(ins!.news5_sources).toEqual(["MarketBeat", null]);
    render(<App api={stubApi({ getPortfolio: vi.fn().mockResolvedValue([row({})]), getPortfolioInsights: vi.fn().mockResolvedValue(ins) })} />);
    await screen.findByTestId("net-worth");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /news/i }));
    const list = await screen.findByTestId("news-top5-list");
    expect(list.textContent).toBe("Reddit adds AI search · MarketBeatAn older plain line");
  });
});
