// Native shell helpers. The web build imports these too: every function degrades to the
// browser behaviour, so there is ONE code path and no `if (ios)` scattered through screens.
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

export const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

// The app's own native plugin (ios/App/App/AssetlyNativePlugin.swift). Only ever called when native.
interface AssetlyNativePlugin {
  activateAudio(): Promise<{ active: boolean }>;
  deactivateAudio(): Promise<void>;
  setAppearance(options: { style: "system" | "light" | "dark" }): Promise<void>;
  getTextScale(): Promise<{ value: number }>;
  addListener(event: "textScaleChange", cb: (data: { value: number }) => void): Promise<PluginListenerHandle>;
}
const AssetlyNative = registerPlugin<AssetlyNativePlugin>("AssetlyNative");

/**
 * Claim the narration audio session: .playback, so the brief keeps talking on the lock screen. Called
 * when a brief starts, never at launch, because a playback session going active stops whatever else
 * the user was listening to. Resolves once iOS has answered; a no-op in the browser.
 */
export async function activateAudioSession(): Promise<void> {
  if (!isNative()) return;
  try { await AssetlyNative.activateAudio(); } catch { /* not fatal: the brief still plays in the foreground */ }
}

/** Hand the audio session back, so the podcast or playlist the brief interrupted can resume. */
export async function deactivateAudioSession(): Promise<void> {
  if (!isNative()) return;
  try { await AssetlyNative.deactivateAudio(); } catch { /* the next stop retries */ }
}

/** Mirror the in-app appearance choice onto the native window (status bar, keyboard, ground). */
export function setNativeAppearance(style: "system" | "light" | "dark"): void {
  if (!isNative()) return;
  void AssetlyNative.setAppearance({ style }).catch(() => {});
}

/** A light tap of the Taptic Engine, for gestures that commit (pull to refresh). Silent on the web. */
export function hapticTap(): void {
  if (!isNative()) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/**
 * Dynamic Type: the iOS text size as a multiple of the default (1.0), now and whenever it changes.
 * Returns an unsubscribe function; never calls back in the browser, where the page zoom does this job.
 */
export function onTextScale(cb: (scale: number) => void): () => void {
  if (!isNative()) return () => {};
  let handle: PluginListenerHandle | undefined;
  let live = true;
  AssetlyNative.getTextScale().then((r) => { if (live) cb(r.value); }).catch(() => {});
  AssetlyNative.addListener("textScaleChange", (d) => cb(d.value))
    .then((h) => { if (live) handle = h; else void h.remove(); }).catch(() => {});
  return () => { live = false; void handle?.remove(); };
}

/** The app came back to the foreground (Capacitor resume, or the page becoming visible on the web). */
export function onForeground(cb: () => void): () => void {
  const vis = () => { if (document.visibilityState === "visible") cb(); };
  document.addEventListener("visibilitychange", vis);
  let handle: PluginListenerHandle | undefined;
  let live = true;
  if (isNative()) {
    CapApp.addListener("resume", cb).then((h) => { if (live) handle = h; else void h.remove(); }).catch(() => {});
  }
  return () => { live = false; document.removeEventListener("visibilitychange", vis); void handle?.remove(); };
}

/** The platform tag the edge function stores on the OAuth state row. */
export const platformTag = (): "ios" | "web" => (isNative() ? "ios" : "web");

/** The message a web portal window sends its opener when the callback lands in it. */
const PORTAL_MSG = "assetly-snaptrade";
/** Status reported when the web portal window closes without the callback (the user gave up): refresh, no toast. */
export const PORTAL_CLOSED = "closed";
const portalWatchers = new Set<(status: string) => void>();

/**
 * Open the brokerage connect portal.
 * In the app we must NOT navigate the app's own webview away, or the user ends up
 * browsing the website inside the shell: open a system browser sheet instead, and let
 * the callback reopen the app through its registered scheme.
 * On the web the portal opens in its own window. Navigating the app's tab away to it meant Back from the
 * portal landed on SnapTrade's "Unexpected Error" page (r1-r4 newcomer M3). The callback lands in that window,
 * which hands the status to this tab (handOffPortalReturn) and closes; a window closed without it is polled.
 * A blocked popup falls back to navigating this tab, as before.
 */
export async function openConnectPortal(url: string): Promise<void> {
  if (!isNative()) {
    const w = window.open(url, "assetly-connect", "popup=yes,width=520,height=780");
    if (!w) { window.location.assign(url); return; }
    const poll = window.setInterval(() => {
      if (!w.closed) return;
      window.clearInterval(poll);
      // the callback's status message, if any, arrived before the close; a close without it is a cancel
      window.setTimeout(() => portalWatchers.forEach((cb) => cb(PORTAL_CLOSED)), 300);
    }, 800);
    return;
  }
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

/**
 * In the web portal window: the callback redirected here with ?snaptrade=. Hand the status to the tab that
 * opened the portal and close. Returns true when it did (the caller skips booting the app in this window).
 */
export function handOffPortalReturn(): boolean {
  if (isNative() || typeof window === "undefined") return false;
  const status = new URLSearchParams(window.location.search).get("snaptrade");
  const opener = window.opener as Window | null;
  if (!status || !opener || opener === window) return false;
  try {
    opener.postMessage({ type: PORTAL_MSG, status }, window.location.origin);
    window.close();
    return true;
  } catch { return false; }   // a cross-origin or gone opener: boot here instead, the query string still works
}

/**
 * Fires when the OAuth callback hands back: through assetly://oauth/?snaptrade=... in the app, or from the
 * portal window on the web (its status, or PORTAL_CLOSED when it was closed without one).
 * Returns an unsubscribe function. On the web a same-tab return is still read from the query string.
 */
export function onOAuthReturn(cb: (status: string) => void): () => void {
  if (!isNative()) {
    let got = false;   // once the callback's status arrived, the window's close is not a cancel
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: unknown; status?: unknown } | null;
      if (d?.type === PORTAL_MSG && typeof d.status === "string") { got = true; cb(d.status); }
    };
    const onClosed = (s: string) => { if (!got) cb(s); got = false; };
    window.addEventListener("message", onMsg);
    portalWatchers.add(onClosed);
    return () => { window.removeEventListener("message", onMsg); portalWatchers.delete(onClosed); };
  }
  let remove: (() => void) | undefined;
  CapApp.addListener("appUrlOpen", (event: { url: string }) => {
    let status: string | null = null;
    try { status = new URL(event.url).searchParams.get("snaptrade"); }
    catch { status = /snaptrade=([a-z]+)/i.exec(event.url)?.[1] ?? null; }   // custom schemes can defeat URL()
    if (!status) return;
    void Browser.close().catch(() => {});   // dismiss the portal sheet before the app resumes
    cb(status);
  }).then((h) => { remove = () => h.remove(); }).catch(() => {});
  return () => { try { remove?.(); } catch { /* already gone */ } };
}

/** Open a link outside the app: a system browser sheet on iOS, a new tab on the web. */
export async function openExternal(url: string): Promise<void> {
  if (!isNative()) { window.open(url, "_blank", "noopener"); return; }
  await Browser.open({ url, presentationStyle: "popover" });
}

/**
 * Fires when Supabase auth hands back through assetly://auth-callback (OAuth in the system browser).
 * The URL carries ?code= (PKCE). Returns an unsubscribe function; no-op on the web.
 */
export function onAuthReturn(cb: (url: string) => void): () => void {
  if (!isNative()) return () => {};
  let remove: (() => void) | undefined;
  CapApp.addListener("appUrlOpen", (event: { url: string }) => {
    if (!/^assetly:\/\/auth-callback/i.test(event.url)) return;
    void Browser.close().catch(() => {});
    cb(event.url);
  }).then((h) => { remove = () => h.remove(); }).catch(() => {});
  return () => { try { remove?.(); } catch { /* already gone */ } };
}
