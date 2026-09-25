// What one signed-in user leaves in this browser, and the sweep at sign-out. On a shared device the next
// user inherited the previous one's "add the rest of your portfolio" hint (r2 power-user audit), and could
// inherit a pending assessment card or a removal list. Appearance and the breakdown toggle are device
// preferences, not account data, and stay.
import { clearRemovals } from "./heldIntel";

export const USER_KEYS = ["assetly-next-steps", "assetly-connect-at", "assetly-onboarding", "assetly-briefs"];
export const userKeysFor = (uid: string) => [`assetly-assess:${uid}`, `assetly-book:${uid}`];

export function clearUserLocalState(uid: string) {
  for (const k of [...USER_KEYS, ...userKeysFor(uid)]) {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
    try { sessionStorage.removeItem(k); } catch { /* private mode */ }
  }
  clearRemovals(uid);
}
