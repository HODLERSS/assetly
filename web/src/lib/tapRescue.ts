// A fast double tap in the iOS WKWebView acted on NEITHER tap: no position opened from a Home row, and
// "Add lot" neither saved nor said "Saving…" (r3 native audit M1, iPhone 17 Pro sim, iOS 26). With page
// zoom off (touch-action: manipulation), WebKit still claims two quick taps as its double-tap gesture and
// never sends the clicks. Native buttons act on the first tap, so a tap here that ended on a control and
// produced no click within a moment gets that click, once. A second synthetic click for the same pair is
// never sent (a toggle would undo itself), and a second REAL click is left to the control: every write
// already sits behind a synchronous in-flight guard (lib/inflight.ts).
const ACTIONABLE = "button, a[href], [role='button'], [role='tab'], summary, label";
const SLOP_PX = 10;          // a touch that travelled further was a scroll or a swipe, not a tap
const LONG_MS = 600;         // held longer: a long press, not a tap
export const RESCUE_MS = 450;   // a real click lands within a frame or two of touchend; this is well past it
const ONCE_MS = 600;         // one rescued click per control per double tap

type Pending = { el: Element; timer: ReturnType<typeof setTimeout> };

export function installTapRescue(doc: Document = document): () => void {
  let start: { x: number; y: number; t: number; el: Element | null } | null = null;
  let pending: Pending | null = null;
  let lastActed: { el: Element; t: number } | null = null;   // the last click that reached a control, real or rescued
  let rescuing = false;

  const target = (n: EventTarget | null): Element | null => {
    const el = (n as Element | null)?.closest?.(ACTIONABLE) ?? null;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
    return el;
  };
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) { start = null; return; }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, t: Date.now(), el: target(e.target) };
  };
  const onEnd = (e: TouchEvent) => {
    const s = start; start = null;
    if (!s?.el || e.defaultPrevented) return;          // a pull to refresh or a swipe owned this touch
    const t = e.changedTouches[0];
    if (!t || Math.hypot(t.clientX - s.x, t.clientY - s.y) > SLOP_PX || Date.now() - s.t > LONG_MS) return;
    if (pending?.el === s.el) return;                  // the second tap of a pair: one rescue is enough
    const el = s.el;
    // this control already acted for this pair (WebKit delivered the first tap and ate the second)
    if (lastActed && lastActed.el === el && Date.now() - lastActed.t < ONCE_MS) return;
    if (pending) clearTimeout(pending.timer);
    pending = { el, timer: setTimeout(() => {
      pending = null;
      if (!el.isConnected || target(el) !== el) return;   // gone or disabled since: nothing to press
      rescuing = true;
      try { (el as HTMLElement).click(); } finally { rescuing = false; }
    }, RESCUE_MS) };
  };
  // a delivered click means WebKit handled the tap: nothing to rescue
  const onClick = (e: MouseEvent) => {
    const el = target(e.target);
    if (el) lastActed = { el, t: Date.now() };
    if (rescuing || !pending) return;
    clearTimeout(pending.timer); pending = null;
  };

  doc.addEventListener("touchstart", onStart, { passive: true, capture: true });
  doc.addEventListener("touchend", onEnd, { passive: true });   // bubble: after a pull or swipe has claimed it
  doc.addEventListener("click", onClick, true);
  return () => {
    if (pending) clearTimeout(pending.timer);
    doc.removeEventListener("touchstart", onStart, true);
    doc.removeEventListener("touchend", onEnd);
    doc.removeEventListener("click", onClick, true);
  };
}
