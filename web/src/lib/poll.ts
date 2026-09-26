// Background polling, one policy for every watcher (r11 server: pg_stat_statements showed ~4.4k per-symbol
// insights reads and ~23k news reads that look like client polling):
//   - nothing runs while the page is hidden (a background tab, the app in the background); the first tick after it
//     comes back runs at once;
//   - a failed tick backs off (doubling, up to 5 minutes) instead of hammering a struggling backend;
//   - the period is chosen per tick, so a watcher can be quick only while something is actually expected.
export const MIN_BACKGROUND_MS = 60_000;   // the floor for any poll that is not waiting on a specific event
const MAX_BACKOFF_MS = 5 * 60_000;

export const pageHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Run `tick` now and then every `periodMs()` ms. `tick` resolves true on success, false (or throws) on failure.
 * Returns a stop function.
 */
export function startPoll(tick: () => Promise<boolean | void>, periodMs: () => number): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, failures = 0, waitingForVisible = false;
  const schedule = () => {
    if (stopped) return;
    const base = periodMs();
    const wait = failures ? Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 5)) : base;
    timer = setTimeout(run, wait);
  };
  const onVisible = () => {
    if (!waitingForVisible || pageHidden()) return;
    waitingForVisible = false;
    if (timer) clearTimeout(timer);
    void run();
  };
  const run = async () => {
    if (stopped) return;
    if (pageHidden()) { waitingForVisible = true; return; }   // resumes on visibilitychange
    try { failures = (await tick()) === false ? failures + 1 : 0; }
    catch { failures++; }
    schedule();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
