import { useEffect, useRef, useState, type ReactNode } from "react";
import { hapticTap } from "../lib/native";
import { keyboardOpen } from "../lib/shell";

// Pull to refresh for a screen that scrolls the document (Home, News). Touch only: a mouse never sees it.
//
// The pull is ours, not WebKit's: at the top of the page a downward drag is taken over (preventDefault,
// which also stops the native rubber band), the content follows the finger with a rubber-band curve,
// and a spinner in the gap turns as the pull arms. Past the threshold there is one light haptic tick;
// letting go there holds the spinner in place until the screen's refresh settles, then springs back.

export const PTR_THRESHOLD = 64;     // px of visible pull that arms a refresh
const PTR_HOLD = 52;                 // where the content rests while the refresh runs
const PTR_MAX = 200;                 // the rubber band's asymptote
const MIN_SPIN_MS = 450;             // a refresh that answers instantly still reads as a refresh

/** Finger travel to visible pull: 1:1-ish at first, stiffening toward PTR_MAX (UIScrollView's feel). */
export const rubberBand = (dy: number) => (dy <= 0 ? 0 : PTR_MAX * (1 - 1 / ((dy * 0.55) / PTR_MAX + 1)));

const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY ?? 0) <= 0;

export function PullToRefresh({ onRefresh, children, disabled = false }: {
  onRefresh: () => Promise<unknown> | unknown; children: ReactNode; disabled?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);                 // visible pull in px, drives the spinner
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let armed = false;
    let dist = 0;

    const place = (px: number, animate: boolean) => {
      const el = body.current;
      if (!el) return;
      el.style.transition = animate ? "transform 260ms cubic-bezier(.2,.8,.2,1)" : "none";
      // no transform at rest: a transformed ancestor would become the containing block of fixed children
      el.style.transform = px > 0 ? `translate3d(0, ${px}px, 0)` : "";
      setPull(px);
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || !atTop() || keyboardOpen()) { start = null; return; }
      // a sheet or dialog open over the screen owns its own touches
      if ((e.target as Element | null)?.closest?.("[role='dialog']")) { start = null; return; }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pulling = false; armed = false; dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) > Math.abs(dy) || dy <= 0 || !atTop()) { if (Math.abs(dx) > 8 || dy < -8) start = null; return; }
        if (dy < 6) return;
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();          // the page does not scroll or bounce under our pull
      dist = rubberBand(dy);
      if (!armed && dist >= PTR_THRESHOLD) { armed = true; hapticTap(); }
      else if (armed && dist < PTR_THRESHOLD) armed = false;
      place(dist, false);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      if (!pulling) return;
      pulling = false;
      if (!armed) { place(0, true); return; }
      busyRef.current = true; setBusy(true);
      place(PTR_HOLD, true);
      const began = Date.now();
      Promise.resolve()
        .then(() => refreshRef.current())
        .catch(() => { /* the screen shows its own error */ })
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - began)))))
        .then(() => { busyRef.current = false; setBusy(false); place(0, true); });
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      const el = body.current;
      if (el) { el.style.transform = ""; el.style.transition = ""; }
    };
  }, [disabled]);

  const progress = Math.min(1, pull / PTR_THRESHOLD);
  return (
    <div className="ptr" data-testid="ptr">
      <div ref={body} className="ptr-body">
        <div className={"ptr-spinner" + (busy ? " busy" : "")} aria-hidden="true"
             style={{ opacity: busy ? 1 : progress, transform: `rotate(${busy ? 0 : Math.round(progress * 270)}deg)` }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
        </div>
        {children}
      </div>
      <span className="sr-only" aria-live="polite">{busy ? "Refreshing" : ""}</span>
    </div>
  );
}
