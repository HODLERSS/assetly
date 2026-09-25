// Market sessions + full-closure holidays, mirroring assets.html's model.
// Lunar KR holidays (Seollal, Buddha's Birthday, Chuseok) are listed explicitly through 2027; mirror of the edge functions' table.
import type { PortfolioRow } from "./api";

export type Market = "US" | "KR" | "CRYPTO";

const US_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const KR_HOLIDAYS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-06-06",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-02-10", "2027-03-01", "2027-05-05", "2027-05-13", "2027-06-07", "2027-08-16",
  "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-31",
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

/** Session badge for the Home movers header. `held` = the markets the book actually contains:
 *  a US-only book never sees "KRX open" (bit aiinsights 2026-08-31). */
export function sessionLabel(now: Date = new Date(), held: ("US" | "KR")[] = ["US", "KR"], hasCrypto = false): string {
  const us = held.includes("US") && isMarketOpen("US", now), kr = held.includes("KR") && isMarketOpen("KR", now);
  if (us && kr) return "US + KRX open";
  if (us) return "US open";
  if (kr) return "KRX open";
  const mode = moverMode(now, held);
  if (mode.kind === "afterglow") return mode.market === "US" ? "US just closed" : "KRX just closed";
  if (mode.kind === "pulse") return `US opens in ~${Math.max(1, Math.round(mode.opensInMin / 60))}h`;
  if (held.length === 0 && hasCrypto) return "crypto trades 24/7";
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
export function moverMode(now: Date = new Date(), held: ("US" | "KR")[] = ["US", "KR"]): MoverMode {
  const has = (m: "US" | "KR") => held.includes(m);
  if ((has("US") && isMarketOpen("US", now)) || (has("KR") && isMarketOpen("KR", now))) return { kind: "open" };
  const usC = has("US") ? minutesSinceClose("US", now) : null, krC = has("KR") ? minutesSinceClose("KR", now) : null;
  if (usC !== null && usC <= 180) return { kind: "afterglow", market: "US" };
  if (krC !== null && krC <= 180) return { kind: "afterglow", market: "KR" };
  const usO = has("US") ? minutesToOpen("US", now) : null;
  if (usO !== null && usO <= 300) return { kind: "pulse", opensInMin: usO };
  return { kind: "quiet" };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Which session a row's day move belongs to, judged in ITS market's time zone.
 *  today  -> the market is trading now, or its latest print carries today's date there
 *  else   -> label names the session it came from, e.g. "Wed close" for a KRX print dated Wednesday
 *            in Seoul, even when the viewer's own clock (Pacific) would call it Tuesday.
 *  Crypto trades around the clock and cash has no session: both always count as today. */
export function moveSession(row: Pick<PortfolioRow, "symbol" | "kind" | "as_of">, now: Date = new Date()): { today: boolean; label: string } {
  const s = priceSession(row, now);
  return s.today ? { today: true, label: "today" } : { today: false, label: `${s.weekday} close` };
}

/** The session a price belongs to, and its date (YYYY-MM-DD): a stock's in its market's zone (a KRX session is
 *  Friday in Seoul while it is still Thursday evening in Pacific), a coin's and cash's on the reader's own
 *  calendar. `today`: trading now, or printed today in its market; otherwise the price is an earlier close. */
export function priceSession(row: Pick<PortfolioRow, "symbol" | "kind" | "as_of">, now: Date = new Date()):
  { today: boolean; ymd: string; weekday: string } {
  const m = marketOf(row);
  const day = (ymd: string) => WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
  if (m === null || m === "CRYPTO") {
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { today: true, ymd, weekday: day(ymd) };
  }
  const tz = SESS[m].tz;
  const today = zoned(now, tz).ymd;
  if (!row.as_of || isMarketOpen(m, now)) return { today: true, ymd: today, weekday: day(today) };
  const printed = zoned(new Date(row.as_of), tz).ymd;
  return { today: printed === today, ymd: printed, weekday: day(printed) };
}

/** Movers should reflect what is actually trading right now. Crypto always qualifies. */
export function moverEligible(row: Pick<PortfolioRow, "symbol" | "kind">, now: Date = new Date(), held: ("US" | "KR")[] = ["US", "KR"]): boolean {
  const m = marketOf(row);
  if (m === null) return false;
  if (m === "CRYPTO") return true;
  const mode = moverMode(now, held);
  if (mode.kind === "open") return isMarketOpen(m, now);
  if (mode.kind === "afterglow") return m === mode.market;
  if (mode.kind === "pulse") return false;             // the futures card takes the slot
  return true;
}
