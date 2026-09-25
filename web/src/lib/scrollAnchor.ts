import { useLayoutEffect, useRef, type RefObject } from "react";

/** The first card still on screen under the sticky header: what the reader is looking at. */
function pickAnchor(root: HTMLElement | null): { el: Element; top: number } | null {
  if (!root) return null;
  const header = document.querySelector(".topbar");
  const floor = header ? header.getBoundingClientRect().bottom : 0;
  for (const el of Array.from(root.querySelectorAll(".card"))) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > floor) return { el, top: r.top };
  }
  return null;
}

/**
 * Keep the reader's place when `value` flips something above them in or out (the offline banner and the
 * "Prices as of" line leaving on reconnect moved the page ~190pt under a reader at scrollY 103; r7 design n-3).
 * WebKit has no CSS scroll anchoring, so it is done by hand: the anchor card is measured while the old DOM is
 * still up (render phase, before the commit), then the page is scrolled by however far that card moved.
 * At the top of the page nothing is done: there the content should simply move.
 */
export function useKeepScrollAnchor(rootRef: RefObject<HTMLElement | null>, value: unknown): void {
  const prev = useRef(value);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  if (prev.current !== value) {
    prev.current = value;
    anchor.current = typeof window !== "undefined" && window.scrollY > 0 ? pickAnchor(rootRef.current) : null;
  }
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !a.el.isConnected) return;
    const moved = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(moved) > 1) window.scrollBy(0, moved);
  }, [value]);
}
