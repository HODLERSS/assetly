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

/** Convert v between USD and KRW using the won-per-dollar rate; null rate = no conversion possible. */
export function convertCcy(v: number, from_: "USD" | "KRW", base: "USD" | "KRW", krwPerUsd: number | null): number | null {
  if (from_ === base) return v;
  if (!krwPerUsd || krwPerUsd <= 0) return null;
  return from_ === "KRW" ? v / krwPerUsd : v * krwPerUsd;
}

/** Dollar (or won) change implied by today's percent move on the current value. */
export function dayChangeAmount(value: number | null, changePct: number | null): number | null {
  if (value === null || changePct === null) return null;
  const f = 1 + changePct / 100;
  if (f <= 0) return null;
  return value - value / f;
}

/** KR tickers are opaque numbers (000660.KS); people know the company name.
 *  main = what to show big, sub = the secondary line. US keeps ticker-first. */
export function labelParts(r: { symbol: string; name?: string | null; name_kr?: string | null; nickname?: string | null }, korean = false): { main: string; sub: string } {
  const kr = r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ");
  if (!kr) return { main: r.symbol, sub: r.nickname || r.name || "" };
  if (r.nickname) return { main: r.nickname, sub: r.symbol };
  if (korean && r.name_kr) return { main: r.name_kr, sub: r.symbol };
  const nm = (r.name || r.symbol)
    .replace(/\s*(Co\.?,?\s*Ltd\.?|Inc\.?|Corp(?:oration)?\.?|Company|Ltd\.?)\s*$/i, "").trim();
  return { main: nm || r.symbol, sub: r.symbol };
}
