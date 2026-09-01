// Native shell helpers. The web build imports these too: every function degrades to the
// browser behaviour, so there is ONE code path and no `if (ios)` scattered through screens.
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

export const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

/** The platform tag the edge function stores on the OAuth state row. */
export const platformTag = (): "ios" | "web" => (isNative() ? "ios" : "web");

/**
 * Open the brokerage connect portal.
 * On the web this navigates away and the callback redirects back to the site.
 * In the app we must NOT navigate the app's own webview away, or the user ends up
 * browsing the website inside the shell: open a system browser sheet instead, and let
 * the callback reopen the app through its registered scheme.
 */
export async function openConnectPortal(url: string): Promise<void> {
  if (!isNative()) { window.location.assign(url); return; }
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

/**
 * Fires when the OAuth callback hands back through assetly://oauth/?snaptrade=...
 * Returns an unsubscribe function. No-op on the web, where the query string does this job.
 */
export function onOAuthReturn(cb: (status: string) => void): () => void {
  if (!isNative()) return () => {};
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
