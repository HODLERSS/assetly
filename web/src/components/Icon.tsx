// The app's small glyphs, drawn as 24-unit outline paths in currentColor. These used to be emoji
// (⚡ 📖 ▶ ✕ ✓ ↻), which render from whatever set the device ships: a yellow bolt on iOS, a different
// yellow bolt on Android, and a wrong-weight arrow in every browser. Paths look the same everywhere
// and take the button's colour, the way the tab bar icons already do.
export type IconName = "bolt" | "book" | "play" | "pause" | "close" | "check" | "refresh";

const PATHS: Record<IconName, JSX.Element> = {
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" /><path d="M8 7.5h8" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <><path d="M7.5 4.5v15" /><path d="M16.5 4.5v15" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  check: <path d="m4.5 12.5 4.8 4.8L19.5 7" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
};

// filled shapes read better at 10-14px than a hairline outline would
const FILLED: Partial<Record<IconName, true>> = { bolt: true, play: true };

export function Icon({ name, size = 14, className, strokeWidth = 2.4 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const filled = !!FILLED[name];
  return (
    <svg className={"icon" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 1 : strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
