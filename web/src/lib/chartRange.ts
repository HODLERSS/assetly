// Chart ranges, anchored the way a broker (and the server's Ask windows, windowTargetYmd in _shared/intel.ts)
// anchors them: a range starts on a calendar date in the market's own zone, and its base is the LAST CLOSE ON OR
// BEFORE that date. The chart used to count hours back (1W = 8 days, YTD = Jan 1 00:00 UTC) and take the first
// point after, so NVDA's 1W read +2.10% against Yahoo's +0.76% and Samsung's YTD +122% against +138% (r4
// power-user M2).
import type { HistoryPoint } from "./api";
import { calMktOfZone, isTradingDay, prevTradingDay } from "./calendar";

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "5Y";
export const RANGE_KEYS: RangeKey[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y"];

/** The zone a symbol's trading days are dated in: KRX in Seoul, a coin by the UTC day (as Yahoo and Coinbase
 *  date them), everything else on New York's calendar. */
export function seriesZone(symbol: string, crypto: boolean): string {
  if (crypto) return "UTC";
  return /\.(KS|KQ)$/i.test(symbol) ? "Asia/Seoul" : "America/New_York";
}

export const ymdIn = (d: Date | string, timeZone: string): string =>
  new Date(d).toLocaleDateString("en-CA", { timeZone });

const MONTHS: Partial<Record<RangeKey, number>> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60 };

// When a market's day begins: before its open, "today" in its zone is still the previous trading day's date.
const OPEN_MIN: Record<string, number> = { "Asia/Seoul": 9 * 60, "America/New_York": 9 * 60 + 30 };

/** The market's current day, as the server's calendar has it (_shared/calendar.ts marketState.lastSessionDate):
 *  its zone's date once that day's session has opened, else the last trading session, skipping weekends and
 *  exchange holidays. The old rule ("the calendar day before, until the open") ignored both: passing Seoul's
 *  9 AM on a Saturday (00:00 UTC) moved every KRX range a day with no trade in between, Samsung 1Y +231.59% to
 *  +242.74% (r9 power-user). Now the whole weekend and the Chuseok closure hold the Sep 23 session. */
export function marketToday(now: Date, timeZone: string): string {
  const ymd = ymdIn(now, timeZone);
  const open = OPEN_MIN[timeZone];
  const mkt = calMktOfZone(timeZone);
  if (open === undefined || !mkt) return ymd;   // a coin's UTC day
  const [h, mi] = now.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  const opened = isTradingDay(mkt, ymd) && (h % 24) * 60 + mi >= open;
  return opened ? ymd : prevTradingDay(mkt, ymd);
}

/** The calendar date a range starts on, in `timeZone`, counted from the market's current day. 1W is seven days
 *  back; 1M..5Y the same date N months back (a date that does not exist, Mar 31 minus a month, falls to the
 *  month's end); YTD is Dec 31 of the prior year, so its base is the prior year's last close. */
export function rangeStartYmd(range: Exclude<RangeKey, "1D">, now: Date, timeZone: string): string {
  const [y, m, d] = marketToday(now, timeZone).split("-").map(Number);
  if (range === "YTD") return `${y - 1}-12-31`;
  if (range === "1W") return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
  const months = MONTHS[range]!;
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** How far back to fetch for a range: the start date plus a margin that always holds the base close (a KRX
 *  Chuseok week plus a weekend is 9 days without a session). */
const BASE_MARGIN_DAYS = 12;
export function fetchHours(range: Exclude<RangeKey, "1D">, now: Date, timeZone: string): number {
  const start = Date.parse(`${rangeStartYmd(range, now, timeZone)}T00:00:00Z`);
  return Math.ceil((now.getTime() - start) / 3600e3) + 24 * BASE_MARGIN_DAYS;
}

const weekParts = new Map<string, Intl.DateTimeFormat>();
/** A legacy weekly row, re-dated to the close it carries. Register-time history stored Yahoo's weekly bars at
 *  the week's start (Monday 00:00 in the market's zone) holding the week's LAST close (Friday's; a coin's
 *  Sunday's). A symbol the server's daily backfill has not healed yet, and rows just before the backfill's span,
 *  still have them: NVDA's 5Y base read "Sep 20, 2021" over the Sep 24 close (r6 power-user m4). Dated at its
 *  Friday, the row says what it holds, the same stamp the server now writes (parseYahooWeekly). Any other
 *  point comes back as it is. */
export function weeklyAtClose(p: HistoryPoint, timeZone: string): HistoryPoint {
  const t = Date.parse(p.ts);
  if (Number.isNaN(t)) return p;
  let f = weekParts.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    weekParts.set(timeZone, f);
  }
  const part: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) part[x.type] = x.value;
  if (part.weekday !== "Mon" || Number(part.hour) % 24 !== 0 || part.minute !== "00" || part.second !== "00" || t % 1000) return p;
  return { ts: new Date(t + (timeZone === "UTC" ? 6 : 4) * 86400e3).toISOString(), price: p.price };
}

/** One point per trading day (dated in `timeZone`): the last stored print of each day is its close, and today's
 *  point is the LIVE price. Input ascending. A legacy weekly row counts on the day of the close it carries, and
 *  a real close of that day (later in the input) wins over it. */
export function dailyCloses(pts: HistoryPoint[], timeZone: string, livePrice: number | null, liveAsOf: string | null): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const raw of pts) {
    const p = weeklyAtClose(raw, timeZone);
    const day = ymdIn(p.ts, timeZone);
    if (p !== raw && byDay.has(day)) continue;
    byDay.set(day, p);                                              // ascending input: last print wins
  }
  if (livePrice !== null && liveAsOf) {
    byDay.set(ymdIn(liveAsOf, timeZone), { ts: liveAsOf, price: livePrice });
  }
  return [...byDay.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** A coin's week is drawn by the hour, not by the day: eight daily points of a market that never closes read
 *  as a step chart next to a detailed 1D (r5 native m3). Stocks keep daily points on 1W: the time axis would
 *  spend two thirds of their week on flat nights and a weekend. */
export const hourlyRange = (range: RangeKey, crypto: boolean): boolean => crypto && range === "1W";

/** The hourly week's raw window starts the day after the base day: the base close itself (the last print of the
 *  start date) comes folded, exactly as the daily line has it, so refining the line never moves its figure. */
export function hourlyRecentHours(now: Date, timeZone: string): number {
  const from = Date.parse(`${rangeStartYmd("1W", now, timeZone)}T00:00:00Z`) + 86400e3;
  return Math.max(1, (now.getTime() - from) / 3600e3);
}

/** One point per clock hour (the last print in it), the live price as the newest. Input ascending. Points already
 *  a day apart (the folded base close) pass through as they are. */
export function hourlyCloses(pts: HistoryPoint[], livePrice: number | null, liveAsOf: string | null): HistoryPoint[] {
  const byHour = new Map<string, HistoryPoint>();
  const hourOf = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? ts : new Date(t).toISOString().slice(0, 13); };
  for (const p of pts) byHour.set(hourOf(p.ts), p);                 // ascending input: last print wins
  if (livePrice !== null && liveAsOf) byHour.set(hourOf(liveAsOf), { ts: liveAsOf, price: livePrice });
  return [...byHour.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** A base more than this many days before the start date is a gap in the history, not a base. */
const BASE_TOLERANCE_DAYS = 10;
/** The range's points from its base: the last close on or before the start date. When the stored history
 *  has no such close (it starts later, or has a gap there), the line starts at the first point after the
 *  start date and `partial` says the range is not fully covered. */
export function anchorRange(closes: HistoryPoint[], startYmd: string, timeZone: string): { pts: HistoryPoint[]; partial: boolean } {
  let base = -1;
  for (let i = 0; i < closes.length; i++) { if (ymdIn(closes[i].ts, timeZone) <= startYmd) base = i; else break; }
  if (base >= 0) {
    const gapDays = (Date.parse(`${startYmd}T00:00:00Z`) - Date.parse(`${ymdIn(closes[base].ts, timeZone)}T00:00:00Z`)) / 86400e3;
    if (gapDays <= BASE_TOLERANCE_DAYS) return { pts: closes.slice(base), partial: false };
  }
  return { pts: closes.slice(base + 1), partial: true };
}
