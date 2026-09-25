// App-shell behaviour that belongs to no screen: the on-screen keyboard and the iOS text size.
// Installed once from main.tsx. Everything here also runs in the browser (PWA, mobile Safari, desktop),
// where the native half is simply absent.
import { Keyboard } from "@capacitor/keyboard";
import { isNative, onTextScale } from "./native";

const KB_CLASS = "kb-open";

/** Editable text: the controls that raise the software keyboard. */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(el.type);
}

const setKeyboard = (open: boolean, inset = 0) => {
  const root = document.documentElement;
  root.classList.toggle(KB_CLASS, open);
  root.style.setProperty("--as-kb-inset", `${open ? Math.max(0, Math.round(inset)) : 0}px`);
};

export const keyboardOpen = () => document.documentElement.classList.contains(KB_CLASS);

/**
 * While the keyboard is up the tab bar (and the mini player docked on it) steps aside, and bottom-docked
 * inputs such as the Ask composer sit directly on the keyboard. Before this the whole tab bar rode up on
 * the keyboard in the app, and the composer hid behind it in mobile Safari.
 *
 *  - App: the Keyboard plugin resizes the web view to the space above the keyboard ("native" mode in
 *    capacitor.config), so the composer's bottom is simply 0. Its will-show / will-hide events drive the
 *    class, and the WebKit ^ v Done bar above the keyboard is switched off.
 *  - Browser: no resize happens; focus on a text field is the signal (touch devices only, a desktop has no
 *    software keyboard), and the visual viewport says how much of the layout the keyboard covers.
 *
 * A drag that starts outside the field dismisses the keyboard, the way a native list does (iOS
 * keyboardDismissMode .onDrag); tapping outside already did.
 */
export function installKeyboard(): () => void {
  const offs: (() => void)[] = [];
  if (isNative()) {
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboard(false));
    offs.push(() => { void show.then((h) => h.remove()).catch(() => {}); void hide.then((h) => h.remove()).catch(() => {}); });
  } else if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) {
    const vv = window.visualViewport;
    const covered = () => (vv ? window.innerHeight - vv.height - vv.offsetTop : 0);
    const sync = () => { if (isTextEntry(document.activeElement)) setKeyboard(true, covered()); else setKeyboard(false); };
    const onFocusIn = (e: FocusEvent) => { if (isTextEntry(e.target as Element)) setKeyboard(true, covered()); };
    // focus moving field to field fires focusout then focusin: settle on the next frame, not in between
    const onFocusOut = () => { requestAnimationFrame(sync); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    offs.push(() => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    });
  }

  // drag-to-dismiss
  let startY: number | null = null;
  const onStart = (e: TouchEvent) => {
    const active = document.activeElement;
    startY = keyboardOpen() && isTextEntry(active) && !active.contains(e.target as Node) ? e.touches[0]?.clientY ?? null : null;
  };
  const onMove = (e: TouchEvent) => {
    if (startY === null) return;
    const y = e.touches[0]?.clientY;
    if (y === undefined || Math.abs(y - startY) < 12) return;
    startY = null;
    const active = document.activeElement;
    if (isTextEntry(active)) active.blur();
  };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  offs.push(() => { document.removeEventListener("touchstart", onStart); document.removeEventListener("touchmove", onMove); });

  return () => { offs.forEach((f) => f()); setKeyboard(false); };
}

// Dynamic Type. WKWebView ignores the iOS text size, so the app renders identically at the largest
// accessibility size. The native plugin reports the user's body size as a multiple of the default, and
// the page scales its text by it. Clamped: text-size-adjust grows text but not the boxes around it,
// and past ~1.4x the fixed-height rows start to clip. The tab bar and mini player opt out in theme.css,
// as iOS's own bars do, so the chrome keeps its measured height.
export const TEXT_SCALE_MIN = 0.9;
export const TEXT_SCALE_MAX = 1.4;
export const clampTextScale = (s: number) => (Number.isFinite(s) ? Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, s)) : 1);

export function installTextSize(): () => void {
  return onTextScale((s) => {
    const pct = `${Math.round(clampTextScale(s) * 100)}%`;
    const style = document.documentElement.style as CSSStyleDeclaration & { webkitTextSizeAdjust?: string };
    style.webkitTextSizeAdjust = pct;
    style.setProperty("text-size-adjust", pct);
  });
}

export function installShell(): () => void {
  const a = installKeyboard();
  const b = installTextSize();
  return () => { a(); b(); };
}
