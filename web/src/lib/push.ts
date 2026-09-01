// Push registration. Web is a no-op: iOS Safari cannot receive these, which is exactly why
// push is one of the reasons the native shell exists.
import { PushNotifications } from "@capacitor/push-notifications";
import { isNative } from "./native";

export type TokenSink = (token: string) => Promise<void> | void;

/**
 * Ask once, register, and hand the device token to the sink.
 * Returns an unsubscribe function. Never throws: a declined permission is a normal outcome,
 * not an error, and the app must keep working without it.
 */
export async function registerPush(save: TokenSink): Promise<() => void> {
  if (!isNative()) return () => {};
  const handles: { remove: () => void }[] = [];
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return () => {};   // declined: the in-app poll still covers it

    handles.push(await PushNotifications.addListener("registration", (t) => { void save(t.value); }));
    handles.push(await PushNotifications.addListener("registrationError", (e) => {
      console.warn("push: registration failed", e);   // no APNs key yet is the usual cause
    }));
    await PushNotifications.register();
  } catch (e) {
    console.warn("push: unavailable", e);
  }
  return () => { for (const h of handles) { try { h.remove(); } catch { /* already gone */ } } };
}

/** Clear the badge when the user opens the app, so a read brief stops nagging. */
export async function clearBadge(): Promise<void> {
  if (!isNative()) return;
  try { await PushNotifications.removeAllDeliveredNotifications(); } catch { /* nothing delivered */ }
}
