// Money and percent formatting. Sign always travels with color (never color alone).
export function money(v: number | null | undefined, currency: "USD" | "KRW" = "USD", compactKrw = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (currency === "KRW") {
    const n = Math.round(v);
    if (compactKrw && Math.abs(n) >= 1e8) return `₩${(n / 1e8).toFixed(1)}억`;
    return `₩${n.toLocaleString("en-US")}`;
  }
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Per-share amounts (price, avg cost, lot cost): always 2 decimals in USD, whole won in KRW. */
export function moneyExact(v: number | null | undefined, currency: "USD" | "KRW" = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (currency === "KRW") return `₩${Math.round(v).toLocaleString("en-US")}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedMoney(v: number | null | undefined, currency: "USD" | "KRW" = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return sign + money(Math.abs(v), currency);
}

export function signedPct(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(dp)}%`;
}

export function glClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "mutedc";
  return v > 0 ? "gain" : "loss";
}

export function priceAsOf(iso: string | null): string {
  if (!iso) return "no print yet";
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return "live";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 6 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} close`;   // market closed since
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
