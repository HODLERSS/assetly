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

/** What the screen underneath looked like when it was left: its markup and where its top sat on screen. */
export type Underlay = { html: string; top: number };

/** Take a picture of the screen being left (Home), to slide in under the next pop. */
export function snapshotUnder(el: HTMLElement | null): Underlay | null {
  if (!el) return null;
  return { html: el.innerHTML, top: el.getBoundingClientRect().top };
}

export function useEdgeSwipeBack(target: RefObject<HTMLElement>, active: boolean, onBack: () => void, underlay?: () => Underlay | null) {
  const back = useRef(onBack);
  back.current = onBack;
  const under = useRef(underlay);
  under.current = underlay;

  useEffect(() => {
    if (!active || !swipeBackAvailable()) return;
    let start: { x: number; y: number; t: number } | null = null;
    let engaged = false;
    let dx = 0;
    // The screen being popped back to, drawn under the sliding page (inert, a picture of Home as it was
    // left) with iOS's parallax. The page used to slide off over empty ground (r3 native m3).
    let ground: HTMLDivElement | null = null;
    const width = () => window.innerWidth || 375;
    const showGround = () => {
      const snap = under.current?.();
      if (ground || !snap) return;
      ground = document.createElement("div");
      ground.className = "swipe-under";
      ground.setAttribute("aria-hidden", "true");
      ground.setAttribute("inert", "");
      const page = document.createElement("div");
      page.className = "screen swipe-under-page";
      page.style.top = `${snap.top}px`;
      page.innerHTML = snap.html;
      ground.appendChild(page);
      document.body.appendChild(ground);
    };
    const dropGround = () => { ground?.remove(); ground = null; };

    const place = (px: number, ms: number) => {
      const el = target.current;
      if (!el) return;
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1), box-shadow ${ms}ms` : "none";
      el.style.transform = px > 0 ? `translate3d(${px}px, 0, 0)` : "";
      el.style.boxShadow = px > 0 ? "-10px 0 24px -12px rgba(0, 0, 0, .35)" : "";
      el.classList.toggle("swiping", px > 0);
      if (ground) {
        ground.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1), opacity ${ms}ms` : "none";
        const p = Math.min(1, px / width());
        ground.style.transform = `translate3d(${Math.round((p - 1) * width() * 0.3)}px, 0, 0)`;
        ground.style.opacity = String(0.6 + 0.4 * p);
      }
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // an open sheet (a lot being edited, a confirm) owns the screen: popping the page would discard it
      start = e.touches.length === 1 && t.clientX <= EDGE && !keyboardOpen() && !document.querySelector(".sheet-back") ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
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
        showGround();
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
      const w = width();
      const velocity = dx / Math.max(1, Date.now() - s.t);
      if (dx > w * COMMIT_FRACTION || (velocity > FLICK_PX_PER_MS && dx > 40)) {
        place(w, 180);
        // pop while the screen is still off to the right, and bring the container home only after the
        // screen underneath has rendered into it, so the old one never flashes back for a frame
        window.setTimeout(() => {
          back.current();
          requestAnimationFrame(() => requestAnimationFrame(() => { place(0, 0); dropGround(); }));
        }, 180);
      } else {
        place(0, 220);
        window.setTimeout(dropGround, 220);
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
      dropGround();
    };
  }, [active, target]);
}
