// Appearance: system (default), light, or dark.
// The choice lives on <html data-theme>, which the Relay tokens key off. A pre-paint
// script in index.html applies the stored choice before React mounts, so the page never
// flashes the wrong ground; this module keeps that in sync afterwards.
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "assetly-theme";
export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const GROUND = { light: "#F4F5F7", dark: "#0F1216" } as const;

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }   // private mode: system is the right default anyway
}

/** True when the given choice resolves to the dark ground right now. */
export function resolvesDark(choice: ThemeChoice): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  // tells the browser which scheme to paint form controls, scrollbars and the like in
  root.style.colorScheme = choice === "system" ? "light dark" : choice;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolvesDark(choice) ? GROUND.dark : GROUND.light);
}

export function setTheme(choice: ThemeChoice): void {
  try { localStorage.setItem(KEY, choice); } catch { /* choice lasts this session only */ }
  applyTheme(choice);
}

/** On "system", the OS can flip while the app is open: keep the status bar colour honest. */
export function watchSystemTheme(): () => void {
  let mq: MediaQueryList;
  try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return () => {}; }
  const onChange = () => { if (getTheme() === "system") applyTheme("system"); };
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
