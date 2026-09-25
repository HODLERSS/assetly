// What the app already knows about the connection. postgrest-js retries a failed GET three times (1s, 2s, 4s),
// so with the connection gone the lots and the 1D chart sat on "Loading…" for ~7s while the price banner above
// them had said "Couldn't refresh prices." from the first second (r5 designer m-3, power-user, native m4).
// When the device reports itself offline, or the last price refresh already failed, a read fails at once.

let pricesDown = false;

/** The last price refresh failed (App.load) or the connection dropped; a good refresh clears it. */
export function setPricesDown(v: boolean) { pricesDown = v; }

/** The device says it has no connection. */
export const offlineNow = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/** Reads should not wait out retries: the device is offline, or the price refresh already failed. */
export const failFast = (): boolean => offlineNow() || pricesDown;

/** A read refused up front because the device is offline. Its message reads like the browser's own. */
export class OfflineError extends Error {
  constructor() { super("The Internet connection appears to be offline."); this.name = "OfflineError"; }
}

/** How long a read may take while the connection is known to be bad, before it counts as failed. Longer than the
 *  slowest single page a live backend was seen to take (~8.5s at a bad moment, r5 power-user), so it only
 *  catches a request that hangs, never a slow answer. */
export const FAIL_FAST_MS = 10_000;
