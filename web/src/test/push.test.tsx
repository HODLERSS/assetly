// 1.0.3 brief notifications, client side: the on/off preference and its migration, provisional (no prompt) vs full
// authorization, the soft ask and its "Not now", the Settings switch (Off deletes this device's token, a denied
// permission points to iOS Settings), and a notification tap opening its brief. (The admin tool is a separate app: app/admin.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- the native shell, scripted ----
const shell = vi.hoisted(() => ({
  native: false,
  os: "notDetermined" as string,
  env: "sandbox" as "production" | "sandbox",
  // what the one-time system prompt answers when the full kind is asked for
  prompt: "authorized" as string,
  requests: [] as boolean[],
  settingsOpened: 0,
  badge: [] as number[],
}));
vi.mock("../lib/native", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/native")>();
  return {
    ...real,
    isNative: () => shell.native,
    pushAuthStatus: async () => (shell.native ? shell.os : "unavailable"),
    requestPushAuth: async (provisional: boolean) => {
      shell.requests.push(provisional);
      if (provisional) { if (shell.os === "notDetermined") shell.os = "provisional"; }
      else if (shell.os === "provisional" || shell.os === "notDetermined") shell.os = shell.prompt;
      return shell.os;
    },
    apnsEnvironment: async () => shell.env,
    openAppSettings: async () => { shell.settingsOpened++; },
    setAppBadge: async (n: number) => { shell.badge.push(n); },
  };
});
const plugin = vi.hoisted(() => ({
  listeners: new Map<string, ((e: unknown) => void)[]>(),
  registers: 0,
  token: "a1b2c3d4".repeat(8),
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener: async (ev: string, cb: (e: unknown) => void) => {
      plugin.listeners.set(ev, [...(plugin.listeners.get(ev) ?? []), cb]);
      return { remove: () => plugin.listeners.set(ev, (plugin.listeners.get(ev) ?? []).filter((x) => x !== cb)) };
    },
    register: async () => {
      plugin.registers++;
      // APNs answers a moment later, as the AppDelegate forwards it
      setTimeout(() => (plugin.listeners.get("registration") ?? []).forEach((cb) => cb({ value: plugin.token })), 0);
    },
    removeAllDeliveredNotifications: async () => {},
  },
}));
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
import { SettingsScreen } from "../screens/Settings";
import { PushAsk } from "../components/PushAsk";
import type { DailyBrief } from "../lib/api";
import {
  __resetPushForTests, briefLaunches, briefOpens, deviceToken, noteBriefOpened, noteLaunchWithBrief, parsePushLink, pushPref,
  registerPush, setPushEnabled, softAskAnswered, softAskDue, upgradePush,
} from "../lib/push";
import { profile, stubApi } from "./fixtures";

const tap = (data: Record<string, unknown>) =>
  (plugin.listeners.get("pushNotificationActionPerformed") ?? []).forEach((cb) => cb({ actionId: "tap", notification: { data } }));

beforeEach(() => {
  Object.assign(shell, { native: true, os: "notDetermined", env: "sandbox", prompt: "authorized", requests: [], settingsOpened: 0, badge: [] });
  plugin.listeners.clear(); plugin.registers = 0;
  authState.session = { user: { id: "u-test", email: "first.run@example.com" } };
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
  __resetPushForTests();
});
afterEach(() => { vi.useRealTimers(); });

describe("P1 the on/off preference", () => {
  it("unset is ON in the app (and is written down), OFF on the web", () => {
    expect(pushPref(true)).toBe("on");
    expect(localStorage.getItem("assetly-push")).toBe("on");
    localStorage.clear();
    expect(pushPref(false)).toBe("off");
    expect(localStorage.getItem("assetly-push")).toBeNull();   // the web never writes a choice it didn't get
  });
  it("an explicit Off (a 1.0.2 reader who turned it off) is never overridden; an explicit On stays", () => {
    setPushEnabled(false);
    expect(pushPref(true)).toBe("off");
    setPushEnabled(true);
    expect(pushPref(true)).toBe("on");
    expect(pushPref(false)).toBe("on");
  });
});

describe("P2 registration: provisional first, never a prompt unasked", () => {
  it("never asked: requests PROVISIONAL only, registers, saves the token with its APNs environment and remembers it", async () => {
    const save = vi.fn();
    const r = await registerPush(save);
    expect(shell.requests).toEqual([true]);
    expect(r.status).toBe("provisional");
    await waitFor(() => expect(save).toHaveBeenCalledWith(plugin.token, "sandbox"));
    expect(deviceToken()).toBe(plugin.token);
  });
  it("already authorized or provisional: no request at all, just register", async () => {
    for (const os of ["authorized", "provisional"]) {
      shell.os = os; shell.requests = [];
      const save = vi.fn();
      await registerPush(save);
      expect(shell.requests).toEqual([]);
      await waitFor(() => expect(save).toHaveBeenCalled());
    }
  });
  it("denied: nothing registered, nothing saved", async () => {
    shell.os = "denied";
    const save = vi.fn();
    const r = await registerPush(save);
    expect(r.status).toBe("denied");
    expect(plugin.registers).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
  it("on the web: a no-op", async () => {
    shell.native = false;
    const save = vi.fn();
    expect((await registerPush(save)).status).toBe("unavailable");
    expect(plugin.registers).toBe(0);
  });
  it("upgrade asks for the FULL kind once (provisional -> authorized) and marks the ask answered", async () => {
    shell.os = "provisional";
    const save = vi.fn();
    const r = await upgradePush(save);
    expect(shell.requests).toEqual([false]);
    expect(r.status).toBe("authorized");
    expect(softAskAnswered()).toBe(true);
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
  it("upgrade declined at the system prompt: denied, nothing registered", async () => {
    shell.os = "provisional"; shell.prompt = "denied";
    const r = await upgradePush(vi.fn());
    expect(r.status).toBe("denied");
    expect(plugin.registers).toBe(0);
  });
});

describe("P3 when the soft ask is due", () => {
  const base = { native: true, pref: "on" as const, os: "provisional" as const, answered: false, opens: 2, launches: 0 };
  it("after two briefs opened, or a third launch with a brief", () => {
    expect(softAskDue(base)).toBe(true);
    expect(softAskDue({ ...base, opens: 1 })).toBe(false);
    expect(softAskDue({ ...base, opens: 0, launches: 3 })).toBe(true);
    expect(softAskDue({ ...base, opens: 1, launches: 2 })).toBe(false);
  });
  it("never on the web, never once answered, never when off, never unless notifications are still quiet", () => {
    expect(softAskDue({ ...base, native: false })).toBe(false);
    expect(softAskDue({ ...base, answered: true })).toBe(false);
    expect(softAskDue({ ...base, pref: "off" })).toBe(false);
    for (const os of ["authorized", "denied", "notDetermined", "ephemeral", "unavailable"] as const) expect(softAskDue({ ...base, os })).toBe(false);
  });
  it("counts distinct briefs, and one launch per launch", () => {
    noteBriefOpened("2026-09-30:morning"); noteBriefOpened("2026-09-30:morning"); noteBriefOpened("2026-09-30:close");
    expect(briefOpens()).toBe(2);
    noteLaunchWithBrief(); noteLaunchWithBrief();
    expect(briefLaunches()).toBe(1);
    __resetPushForTests(); noteLaunchWithBrief();
    expect(briefLaunches()).toBe(2);
  });
});

describe("P4 the soft-ask card", () => {
  const due = () => { shell.os = "provisional"; noteBriefOpened("a"); noteBriefOpened("b"); };
  it("shows when due; Turn on alerts shows the system prompt and saves the token", async () => {
    due();
    const api = stubApi();
    render(<PushAsk api={api} />);
    await screen.findByText("Get a buzz when your brief is ready?");
    await userEvent.click(screen.getByTestId("push-ask-yes"));
    expect(shell.requests).toEqual([false]);
    await screen.findByText(/Alerts on/);
    await waitFor(() => expect(api.savePushToken).toHaveBeenCalledWith(plugin.token, "ios", "sandbox"));
    expect(screen.queryByTestId("push-ask")).toBeNull();
  });
  it("Not now is remembered: the card never comes back", async () => {
    due();
    const { unmount } = render(<PushAsk api={stubApi()} />);
    await userEvent.click(await screen.findByTestId("push-ask-no"));
    expect(screen.queryByTestId("push-ask")).toBeNull();
    expect(shell.requests).toEqual([]);   // no system prompt
    unmount();
    render(<PushAsk api={stubApi()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("push-ask")).toBeNull();
  });
  it("not shown before the reader has used the brief, nor once alerts are on, nor on the web", async () => {
    shell.os = "provisional"; noteBriefOpened("a");
    const one = render(<PushAsk api={stubApi()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("push-ask")).toBeNull();
    one.unmount();
    noteBriefOpened("b"); shell.os = "authorized";
    const two = render(<PushAsk api={stubApi()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("push-ask")).toBeNull();
    two.unmount();
    shell.os = "provisional"; shell.native = false;
    render(<PushAsk api={stubApi()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("push-ask")).toBeNull();
  });
});

describe("P5 the Settings switch", () => {
  const settings = (api = stubApi()) => render(<SettingsScreen api={api} profile={profile} rows={[]} onChanged={() => {}} onSignedOut={() => {}} />);
  it("defaults to On in the app for a reader who never chose", async () => {
    settings();
    expect(screen.getByTestId("push-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("push-toggle").textContent).toBe("On");
  });
  it("Off deletes THIS device's token server side and is remembered; On registers again", async () => {
    localStorage.setItem("assetly-push-token", plugin.token);
    shell.os = "provisional";
    const api = stubApi();
    settings(api);
    await userEvent.click(screen.getByTestId("push-toggle"));
    expect(api.removePushToken).toHaveBeenCalledWith(plugin.token);
    expect(localStorage.getItem("assetly-push")).toBe("off");
    expect(screen.getByTestId("push-toggle").textContent).toBe("Off");
    await userEvent.click(screen.getByTestId("push-toggle"));
    expect(localStorage.getItem("assetly-push")).toBe("on");
    await waitFor(() => expect(api.savePushToken).toHaveBeenCalledWith(plugin.token, "ios", "sandbox"));
  });
  it("denied in iOS: says so and opens the app's page in iOS Settings", async () => {
    shell.os = "denied";
    settings();
    await screen.findByTestId("push-denied");
    await userEvent.click(screen.getByTestId("push-open-settings"));
    expect(shell.settingsOpened).toBe(1);
  });
  it("quiet (provisional): offers Turn on alerts", async () => {
    shell.os = "provisional";
    settings();
    await userEvent.click(await screen.findByTestId("push-turn-on-alerts"));
    expect(shell.requests).toEqual([false]);
    await waitFor(() => expect(screen.queryByTestId("push-quiet")).toBeNull());
  });
  it("the web has no notification switch", async () => {
    shell.native = false;
    settings();
    expect(screen.queryByTestId("notify-card")).toBeNull();
  });
  it("the consumer app carries no admin tool: nothing admin in Settings", async () => {
    settings();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("admin-card")).toBeNull();
    expect(document.body.textContent).not.toMatch(/internal tools|send a push/i);
  });
});

describe("P6 a notification tap opens its brief", () => {
  const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  const brief = (edition: DailyBrief["edition"], lede: string, genAt: string): DailyBrief =>
    ({ brief_date: genAt.slice(0, 10), edition, generated_at: genAt,
       sections: { lede, overnight: "Overnight text.", positions: [], desk_view: "Desk text.", calendar: [], as_of: genAt, day_sign: 1, held: ["RDDT"] } });
  it("links parse to in-app routes only", () => {
    expect(parsePushLink("/brief/2026-09-30/close")).toEqual({ kind: "brief", date: "2026-09-30", edition: "close" });
    expect(parsePushLink("/brief/latest")).toEqual({ kind: "brief", date: null, edition: null });
    expect(parsePushLink("/news")).toEqual({ kind: "tab", tab: "news" });
    for (const bad of ["https://x.test", "/brief/2026-09-30/nope", "/admin", null, 3]) expect(parsePushLink(bad)).toBeNull();
  });
  it("tapping the morning push while the close is newest opens the MORNING, read in full, on Home", async () => {
    const m = at(300), c = at(10);
    const getDailyBriefs = vi.fn().mockResolvedValue([brief("morning", "Morning lede.", m), brief("close", "Close lede.", c)]);
    render(<App api={stubApi({ getDailyBriefs })} />);
    const card = await screen.findByTestId("brief-card");
    expect(within(card).getByTestId("brief-lede").textContent).toBe("Close lede.");
    // go elsewhere first: the tap must bring the reader back to Home
    await userEvent.click(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /Settings/ }));
    await act(async () => { tap({ link: `/brief/${m.slice(0, 10)}/morning`, edition: "morning", brief_date: m.slice(0, 10) }); });
    const again = await screen.findByTestId("brief-card");
    await waitFor(() => expect(within(again).getByTestId("brief-lede").textContent).toBe("Morning lede."));
    expect(within(again).getByTestId("brief-body")).toBeTruthy();
  });
  it("a tab link opens that tab; the app registers once signed in and clears the badge", async () => {
    render(<App api={stubApi()} />);
    await screen.findByRole("navigation", { name: "Tabs" });
    await act(async () => { tap({ link: "/news" }); });
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: /News/ }).getAttribute("aria-current")).toBe("page"));
    expect(shell.requests).toEqual([true]);   // provisional, no prompt
    expect(shell.badge).toContain(0);
  });
  it("a reader who turned notifications off is never registered", async () => {
    setPushEnabled(false);
    render(<App api={stubApi()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(shell.requests).toEqual([]);
    expect(plugin.registers).toBe(0);
  });
});
