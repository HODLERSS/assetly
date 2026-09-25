import { useEffect, useRef, type RefObject } from "react";
import { isNative } from "./native";
import { keyboardOpen } from "./shell";

// Edge swipe back for pushed screens (Add position, Position detail), the gesture every iOS user makes
// without thinking. Only a touch that STARTS within EDGE px of the left edge is considered, so the
// price chart's horizontal scrub on Position detail keeps every other horizontal drag. Once the drag is
// clearly horizontal it is ours: the screen follows the finger, and letting go past half the width
// (or with a flick) completes the pop; otherwise it springs back.
//
// App and home-screen PWA only. In a Safari tab the browser's own edge swipe is history navigation, and
// ours would fight it (and could take the user off the site).

export const EDGE = 20;
const COMMIT_FRACTION = 0.5;       // UINavigationController pops past half the width, or on a flick
const FLICK_PX_PER_MS = 0.45;

const standalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
};

export const swipeBackAvailable = () => isNative() || standalone();

export function useEdgeSwipeBack(target: RefObject<HTMLElement>, active: boolean, onBack: () => void) {
  const back = useRef(onBack);
  back.current = onBack;

  useEffect(() => {
    if (!active || !swipeBackAvailable()) return;
    let start: { x: number; y: number; t: number } | null = null;
    let engaged = false;
    let dx = 0;

    const place = (px: number, ms: number) => {
      const el = target.current;
      if (!el) return;
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1), box-shadow ${ms}ms` : "none";
      el.style.transform = px > 0 ? `translate3d(${px}px, 0, 0)` : "";
      el.style.boxShadow = px > 0 ? "-10px 0 24px -12px rgba(0, 0, 0, .35)" : "";
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t.clientX <= EDGE && !keyboardOpen() ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
      engaged = false; dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const mx = t.clientX - start.x, my = t.clientY - start.y;
      if (!engaged) {
        if (Math.abs(my) > 10 && Math.abs(my) > mx) { start = null; return; }   // a vertical scroll that began at the edge
        if (mx < 10) return;
        engaged = true;
      }
      // ours now: nothing underneath (the chart scrub, the page scroll) sees this drag
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      dx = Math.max(0, mx);
      place(dx, 0);
    };
    const onEnd = () => {
      if (!start) return;
      const s = start;
      start = null;
      if (!engaged) return;
      engaged = false;
      const width = window.innerWidth || 375;
      const velocity = dx / Math.max(1, Date.now() - s.t);
      if (dx > width * COMMIT_FRACTION || (velocity > FLICK_PX_PER_MS && dx > 40)) {
        place(width, 180);
        // pop while the screen is still off to the right, and bring the container home only after the
        // screen underneath has rendered into it, so the old one never flashes back for a frame
        window.setTimeout(() => {
          back.current();
          requestAnimationFrame(() => requestAnimationFrame(() => place(0, 0)));
        }, 180);
      } else {
        place(0, 220);
      }
    };

    // capture phase: decided before the chart (or anything else) handles the same touch
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("touchend", onEnd, { capture: true });
    document.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      document.removeEventListener("touchstart", onStart, { capture: true });
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
      document.removeEventListener("touchcancel", onEnd, { capture: true });
      place(0, 0);
    };
  }, [active, target]);
}
