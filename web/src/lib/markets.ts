// Market sessions + full-closure holidays, mirroring assets.html's model.
// Lunar KR holidays (Seollal, Buddha, Chuseok) are not encoded — weekday + hours govern.
import type { PortfolioRow } from "./api";

export type Market = "US" | "KR" | "CRYPTO";

const US_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25", "2027-01-01",
]);
const KR_HOLIDAYS = new Set([
  "2026-01-01", "2026-03-02", "2026-05-01", "2026-05-05", "2026-06-03",
  "2026-06-06", "2026-08-17", "2026-10-05", "2026-10-09", "2026-12-25",
  "2026-12-31", "2027-01-01",
]);

/** Which market a position trades on; null for cash/debt (no session). */
export function marketOf(row: Pick<PortfolioRow, "symbol" | "kind">): Market | null {
  if (row.kind === "cash" || row.kind === "debt") return null;
  if (row.kind === "crypto") return "CRYPTO";
  if (row.symbol.endsWith(".KS") || row.symbol.endsWith(".KQ")) return "KR";
  return "US";
}

function zoned(now: Date, tz: string): { dow: number; minutes: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get("hour")) % 24;
  return {
    dow: dowMap[get("weekday")] ?? 0,
    minutes: hour * 60 + Number(get("minute")),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function isMarketOpen(market: Market, now: Date = new Date()): boolean {
  if (market === "CRYPTO") return true;
  if (market === "US") {
    const z = zoned(now, "America/New_York");
    return z.dow >= 1 && z.dow <= 5 && !US_HOLIDAYS.has(z.ymd) && z.minutes >= 570 && z.minutes < 960;
  }
  const z = zoned(now, "Asia/Seoul");
  return z.dow >= 1 && z.dow <= 5 && !KR_HOLIDAYS.has(z.ymd) && z.minutes >= 540 && z.minutes < 930;
}

/** Session badge for the Home movers header. */
export function sessionLabel(now: Date = new Date()): string {
  const us = isMarketOpen("US", now), kr = isMarketOpen("KR", now);
  if (us && kr) return "US + KRX open";
  if (us) return "US open";
  if (kr) return "KRX open";
  return "markets closed";
}

/** Movers should reflect what is actually trading right now. Crypto always qualifies;
 *  when no equity market is open, everything qualifies (last sessions' moves). */
export function moverEligible(row: Pick<PortfolioRow, "symbol" | "kind">, now: Date = new Date()): boolean {
  const m = marketOf(row);
  if (m === null) return false;
  if (m === "CRYPTO") return true;
  const anyOpen = isMarketOpen("US", now) || isMarketOpen("KR", now);
  if (!anyOpen) return true;
  return isMarketOpen(m, now);
}
