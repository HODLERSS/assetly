// "Open this brief": a notification tap names a brief (date + edition, or the latest); Home's brief card picks it,
// opens the full read and scrolls to it. Kept outside React because the tap can arrive before Home has mounted
// (a cold launch from the notification) and must survive until the card is there to take it.
export type BriefRequest = { date: string | null; edition: string | null; at: number };

let pending: BriefRequest | null = null;
const listeners = new Set<() => void>();

export function requestBrief(date: string | null, edition: string | null): void {
  pending = { date, edition, at: Date.now() };
  listeners.forEach((l) => l());
}
export const pendingBrief = (): BriefRequest | null => pending;
/** The card took it (or gave up on it): it is not replayed on the next mount. */
export function consumeBrief(req: BriefRequest): void {
  if (pending === req) { pending = null; listeners.forEach((l) => l()); }
}
export const subscribeBrief = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
