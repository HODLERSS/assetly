// Tab bar glyphs: one 24px outline icon per tab, drawn in currentColor so the
// active/inactive colour comes from the tab button itself.
export function TabIcon({ tab, active }: { tab: "home" | "news" | "ask" | "settings"; active: boolean }) {
  const common = {
    width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: active ? 2.1 : 1.7,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true as const, focusable: "false" as const,
  };
  if (tab === "home") return (
    <svg {...common}><path d="M3 10.2 12 3.5l9 6.7" /><path d="M5.4 9v10.5h13.2V9" />
      {active && <path d="M9.8 19.5v-5.2h4.4v5.2" />}</svg>
  );
  if (tab === "news") return (
    <svg {...common}><rect x="3" y="5" width="14.5" height="14.5" rx="2" /><path d="M17.5 9H21v8.2a2.3 2.3 0 0 1-3.5 2" />
      <path d="M6.3 9h8" /><path d="M6.3 12.4h8" /><path d="M6.3 15.8h5" /></svg>
  );
  if (tab === "ask") return (
    <svg {...common}><path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a9.8 9.8 0 0 1-2.7-.37L4.5 20.5l1.3-3.6A6.9 6.9 0 0 1 3.5 12.2C3.5 8.2 7.3 5 12 5s8.5 3.2 8.5 7.2Z" />
      <path d="M9.6 10.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.3" /><path d="M12 16.4h.01" /></svg>
  );
  return (
    <svg {...common}><path d="M5 7.5h14" /><path d="M5 16.5h14" />
      <circle cx="9.5" cy="7.5" r="2.3" /><circle cx="15" cy="16.5" r="2.3" /></svg>
  );
}
