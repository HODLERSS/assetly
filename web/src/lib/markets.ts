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
  const mode = moverMode(now);
  if (mode.kind === "afterglow") return mode.market === "US" ? "US just closed" : "KRX just closed";
  if (mode.kind === "pulse") return `US opens in ~${Math.max(1, Math.round(mode.opensInMin / 60))}h`;
  return "markets closed";
}

const SESS = {
  US: { tz: "America/New_York", open: 570, close: 960, hol: US_HOLIDAYS },
  KR: { tz: "Asia/Seoul", open: 540, close: 930, hol: KR_HOLIDAYS },
} as const;

/** Minutes until today's open (pre-open on a trading day), else null. */
export function minutesToOpen(market: "US" | "KR", now: Date = new Date()): number | null {
  const s = SESS[market]; const z = zoned(now, s.tz);
  if (z.dow < 1 || z.dow > 5 || s.hol.has(z.ymd)) return null;
  return z.minutes < s.open ? s.open - z.minutes : null;
}

/** Minutes since today's close (post-close on a trading day), else null. */
export function minutesSinceClose(market: "US" | "KR", now: Date = new Date()): number | null {
  const s = SESS[market]; const z = zoned(now, s.tz);
  if (z.dow < 1 || z.dow > 5 || s.hol.has(z.ymd)) return null;
  return z.minutes >= s.close ? z.minutes - s.close : null;
}

export type MoverMode =
  | { kind: "open" }
  | { kind: "afterglow"; market: "US" | "KR" }
  | { kind: "pulse"; opensInMin: number }
  | { kind: "quiet" };

/** What the Home movers section should show right now.
 *  open      -> movers of the open market(s)
 *  afterglow -> a market closed within the last 3h: its session still headlines
 *  pulse     -> US open is <=5h away and nothing closed recently: index futures
 *  quiet     -> overnight/weekend: all holdings' last-session moves */
export function moverMode(now: Date = new Date()): MoverMode {
  if (isMarketOpen("US", now) || isMarketOpen("KR", now)) return { kind: "open" };
  const usC = minutesSinceClose("US", now), krC = minutesSinceClose("KR", now);
  if (usC !== null && usC <= 180) return { kind: "afterglow", market: "US" };
  if (krC !== null && krC <= 180) return { kind: "afterglow", market: "KR" };
  const usO = minutesToOpen("US", now);
  if (usO !== null && usO <= 300) return { kind: "pulse", opensInMin: usO };
  return { kind: "quiet" };
}

/** Movers should reflect what is actually trading right now. Crypto always qualifies. */
export function moverEligible(row: Pick<PortfolioRow, "symbol" | "kind">, now: Date = new Date()): boolean {
  const m = marketOf(row);
  if (m === null) return false;
  if (m === "CRYPTO") return true;
  const mode = moverMode(now);
  if (mode.kind === "open") return isMarketOpen(m, now);
  if (mode.kind === "afterglow") return m === mode.market;
  if (mode.kind === "pulse") return false;             // the futures card takes the slot
  return true;
}
