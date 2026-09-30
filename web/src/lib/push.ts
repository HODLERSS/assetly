// Brief notifications. Web is a no-op: iOS Safari cannot receive these, which is exactly why push is one of the
// reasons the native shell exists.
//
// 1.0.3: on by default, without a prompt. iOS "provisional" authorization delivers quietly to Notification Center
// (no banner, no sound) and never asks; the reader keeps or turns them off from the notification itself. After the
// reader has shown they use the brief (two briefs opened, or a third launch with one waiting), Home offers a soft
// ask, "Get a buzz when your brief is ready?", whose yes shows the one-time system prompt that upgrades quiet
// delivery to alerts. "Not now" is remembered and never asked again.
//
// The device's choice (Settings > Brief notifications) is the "assetly-push" key: "on" | "off". Unset means "never
// chose": ON in the app (the 1.0.3 default; 1.0.2 treated unset as off and nobody ever registered), OFF on the web.
// An explicit "off" is never overridden. Off deletes this device's token server side, which is what stops sends.
import { PushNotifications } from "@capacitor/push-notifications";
import { apnsEnvironment, type ApnsEnvironment, isNative, pushAuthStatus, requestPushAuth, setAppBadge, type PushAuthStatus } from "./native";

export type TokenSink = (token: string, environment: ApnsEnvironment) => Promise<void> | void;

const PUSH_KEY = "assetly-push";            // "on" | "off": this device's choice
const TOKEN_KEY = "assetly-push-token";     // this device's APNs token, so Off and sign-out remove only this device
const ASK_KEY = "assetly-push-ask";         // "no" (Not now) | "yes" (asked): the soft ask is shown at most once
const OPENS_KEY = "assetly-brief-opens";    // briefs opened or played on this device (distinct, capped)
const LAUNCHES_KEY = "assetly-brief-launches";   // launches that found a brief waiting

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** This device's choice, migrating "never chose" to ON in the app (and remembering it) and OFF on the web. */
export function pushPref(native: boolean = isNative()): "on" | "off" {
  const v = read(PUSH_KEY);
  if (v === "on" || v === "off") return v;
  if (!native) return "off";
  write(PUSH_KEY, "on");
  return "on";
}
export const pushEnabled = (): boolean => pushPref() === "on";
export const setPushEnabled = (on: boolean): void => write(PUSH_KEY, on ? "on" : "off");

/** The token this device registered, if any. */
export const deviceToken = (): string | null => read(TOKEN_KEY);
export const forgetDeviceToken = (): void => write(TOKEN_KEY, null);

/** Notifications reach the reader in some form (quietly or as alerts). */
export const delivers = (s: PushAuthStatus) => s === "authorized" || s === "provisional" || s === "ephemeral";

/**
 * Make sure this device is registered: first time, ask for PROVISIONAL authorization (no prompt), then register
 * with APNs and hand the token to the sink. Resolves with the authorization status and an unsubscribe for the
 * token listeners. Never throws: a denied permission is a normal outcome and the in-app poll still covers briefs.
 */
export async function registerPush(save: TokenSink): Promise<{ status: PushAuthStatus; off: () => void }> {
  const handles: { remove: () => void }[] = [];
  const off = () => { for (const h of handles) { try { h.remove(); } catch { /* already gone */ } } };
  if (!isNative()) return { status: "unavailable", off };
  let status = await pushAuthStatus();
  try {
    if (status === "notDetermined") status = await requestPushAuth(true);
    if (!delivers(status)) return { status, off };
    const env = await apnsEnvironment();
    handles.push(await PushNotifications.addListener("registration", (t) => {
      write(TOKEN_KEY, t.value);
      void Promise.resolve(save(t.value, env)).catch(() => {});
    }));
    handles.push(await PushNotifications.addListener("registrationError", (e) => {
      console.warn("push: registration failed", e);
    }));
    await PushNotifications.register();
  } catch (e) {
    console.warn("push: unavailable", e);
  }
  return { status, off };
}

/** "Turn on alerts": the one-time system prompt (provisional -> authorized), then register again. */
export async function upgradePush(save: TokenSink): Promise<{ status: PushAuthStatus; off: () => void }> {
  if (!isNative()) return { status: "unavailable", off: () => {} };
  const asked = await requestPushAuth(false);
  write(ASK_KEY, "yes");
  if (!delivers(asked)) return { status: asked, off: () => {} };
  return registerPush(save);
}

// ---------- the soft ask ----------

export type AskInputs = { native: boolean; pref: "on" | "off"; os: PushAuthStatus; answered: boolean; opens: number; launches: number };
/**
 * Show "Get a buzz when your brief is ready?" only in the app, only when notifications are on here but still quiet
 * (provisional), only once (either answer ends it), and only after the reader has used the brief: two briefs opened
 * or listened to, or a third launch with a brief waiting. Never on the web; never once alerts are allowed or denied.
 */
export const softAskDue = (x: AskInputs): boolean =>
  x.native && x.pref === "on" && x.os === "provisional" && !x.answered && (x.opens >= 2 || x.launches >= 3);

const count = (k: string) => { const n = Number(read(k)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
export const briefOpens = (): number => { try { const v = JSON.parse(read(OPENS_KEY) ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
export const briefLaunches = (): number => count(LAUNCHES_KEY);
export const softAskAnswered = (): boolean => read(ASK_KEY) === "no" || read(ASK_KEY) === "yes";
export const softAskNotNow = (): void => write(ASK_KEY, "no");

/** A brief was opened or played (by its date:edition key). Distinct briefs only; a re-read is not a new use. */
export function noteBriefOpened(key: string): void {
  let list: string[] = [];
  try { const v = JSON.parse(read(OPENS_KEY) ?? "[]"); if (Array.isArray(v)) list = v.map(String); } catch { list = []; }
  if (list.includes(key)) return;
  write(OPENS_KEY, JSON.stringify([...list, key].slice(-10)));
}
let launchNoted = false;
/** The app opened and found a brief waiting: counted once per launch. */
export function noteLaunchWithBrief(): void {
  if (launchNoted) return;
  launchNoted = true;
  write(LAUNCHES_KEY, String(Math.min(count(LAUNCHES_KEY) + 1, 99)));
}
export const __resetPushForTests = () => { launchNoted = false; };

export async function softAskDueNow(): Promise<boolean> {
  if (!isNative()) return false;
  return softAskDue({ native: true, pref: pushPref(), os: await pushAuthStatus(), answered: softAskAnswered(), opens: briefOpens(), launches: briefLaunches() });
}

// ---------- taps ----------

export type PushRoute = { kind: "tab"; tab: "home" | "news" | "ask" | "settings" } | { kind: "brief"; date: string | null; edition: string | null };
const EDITION = /^(morning|midday|close|assessment|weekend|kr_open|kr_close)$/;
/** The in-app route a push's `link` names; anything else is ignored (a push never navigates outside the app). */
export function parsePushLink(link: unknown): PushRoute | null {
  if (typeof link !== "string") return null;
  const tab = /^\/(home|news|ask|settings)$/.exec(link);
  if (tab) return { kind: "tab", tab: tab[1] as "home" | "news" | "ask" | "settings" };
  if (link === "/brief/latest") return { kind: "brief", date: null, edition: null };
  const b = /^\/brief\/(\d{4}-\d{2}-\d{2})\/([a-z_]+)$/.exec(link);
  if (b && EDITION.test(b[2])) return { kind: "brief", date: b[1], edition: b[2] };
  return null;
}

/**
 * A tap on a notification (including the one that cold-launched the app: the plugin keeps that event until a
 * listener is attached). Returns an unsubscribe function; no-op on the web.
 */
export function onPushOpen(cb: (route: PushRoute) => void): () => void {
  if (!isNative()) return () => {};
  let handle: { remove: () => void } | undefined;
  let live = true;
  PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
    if (a.actionId === "dismiss") return;
    const data = (a.notification?.data ?? {}) as Record<string, unknown>;
    const route = parsePushLink(data.link) ?? (typeof data.edition === "string" ? parsePushLink(`/brief/${data.brief_date}/${data.edition}`) : null);
    cb(route ?? { kind: "tab", tab: "home" });
  }).then((h) => { if (live) handle = h; else void h.remove(); }).catch(() => {});
  return () => { live = false; try { handle?.remove(); } catch { /* already gone */ } };
}

/** Clear the badge and the delivered briefs when the reader opens the app, so a read brief stops nagging. */
export async function clearBadge(): Promise<void> {
  if (!isNative()) return;
  // the native setBadge(0) also empties Notification Center: the plugin's own call refuses until the token arrives
  await setAppBadge(0);
}
