// Trading calendar shared by every edge function that talks about a "day" move (mirror of
// web/src/lib/markets.ts; lunar KR holidays are listed explicitly). Every prompt that mentions a day
// move carries these lines, so the model knows WHICH session a figure belongs to and how long ago that
// session ended. Caught 2026-09-11: a Friday 3:30 PM CT note said the Korean names "fell 1.5% today"
// about a Korean session that had closed 14 hours earlier.
// Extracted verbatim from daily-brief and insights-sync on 2026-09-25 so ask labels its numbers the same
// way; one copy means the three can no longer drift apart.
export type Mkt = "US" | "KR";
export const HOL: Record<Mkt, Set<string>> = {
  US: new Set(["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]),
  KR: new Set(["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-02","2026-05-01","2026-05-05","2026-05-25","2026-06-03","2026-06-06","2026-08-17","2026-09-24","2026-09-25","2026-10-05","2026-10-09","2026-12-25","2026-12-31","2027-01-01","2027-02-08","2027-02-09","2027-02-10","2027-03-01","2027-05-05","2027-05-13","2027-06-07","2027-08-16","2027-09-14","2027-09-15","2027-09-16","2027-10-04","2027-10-11","2027-12-31"]),
};
export const TZ: Record<Mkt, string> = { US: "America/New_York", KR: "Asia/Seoul" };
export const OPEN_MIN: Record<Mkt, number> = { US: 570, KR: 540 };    // 9:30 ET, 9:00 KST
export const CLOSE_MIN: Record<Mkt, number> = { US: 960, KR: 930 };   // 4:00 PM ET, 3:30 PM KST
export function zonedParts(now: Date, tz: string): { ymd: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[get("weekday")] ?? 0;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, dow, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}
export const ymdShift = (ymd: string, days: number): string => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const dowOf = (ymd: string): number => new Date(ymd + "T12:00:00Z").getUTCDay();
export const isTradingDay = (mkt: Mkt, ymd: string): boolean => { const d = dowOf(ymd); return d >= 1 && d <= 5 && !HOL[mkt].has(ymd); };
export const prevTradingDay = (mkt: Mkt, ymd: string): string => { let x = ymd; do x = ymdShift(x, -1); while (!isTradingDay(mkt, x)); return x; };
export const nextTradingDay = (mkt: Mkt, ymd: string): string => { let x = ymd; do x = ymdShift(x, 1); while (!isTradingDay(mkt, x)); return x; };
export function tzOffsetMin(epoch: number, tz: string): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(epoch)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = s.match(/([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
/** Epoch ms of a wall-clock minute on a date in a zone (DST-safe: the offset is read at that instant). */
export function zonedEpoch(ymd: string, minutes: number, tz: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, 0, minutes);
  return naive - tzOffsetMin(naive, tz) * 60000;
}
export type MarketState = { mkt: Mkt; ymd: string; dow: number; tradingToday: boolean; holidayToday: boolean; phase: "pre" | "open" | "post" | "closed"; minutesIn: number; lastSessionDate: string; lastCloseEpoch: number; hoursSinceClose: number; nextSessionDate: string; hoursToNextOpen: number; upcomingHolidays: string[] };
export function marketState(mkt: Mkt, now = new Date()): MarketState {
  const z = zonedParts(now, TZ[mkt]);
  const tradingToday = isTradingDay(mkt, z.ymd);
  const phase: MarketState["phase"] = !tradingToday ? "closed" : z.minutes < OPEN_MIN[mkt] ? "pre" : z.minutes < CLOSE_MIN[mkt] ? "open" : "post";
  const lastSessionDate = phase === "open" || phase === "post" ? z.ymd : prevTradingDay(mkt, z.ymd);
  const lastCloseEpoch = zonedEpoch(lastSessionDate, CLOSE_MIN[mkt], TZ[mkt]);
  const nextSessionDate = phase === "pre" ? z.ymd : nextTradingDay(mkt, z.ymd);
  const nextOpenEpoch = zonedEpoch(nextSessionDate, OPEN_MIN[mkt], TZ[mkt]);
  const horizon = ymdShift(z.ymd, 10);
  return { mkt, ymd: z.ymd, dow: z.dow, tradingToday, holidayToday: HOL[mkt].has(z.ymd), phase, minutesIn: phase === "open" ? z.minutes - OPEN_MIN[mkt] : 0,
    lastSessionDate, lastCloseEpoch, hoursSinceClose: phase === "open" ? 0 : Math.max(0, (now.getTime() - lastCloseEpoch) / 3600000),
    nextSessionDate, hoursToNextOpen: Math.max(0, (nextOpenEpoch - now.getTime()) / 3600000),
    upcomingHolidays: [...HOL[mkt]].filter((h) => h > z.ymd && h <= horizon).sort() };
}
export const dayName = (ymd: string): string => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
export const weekdayOf = (ymd: string): string => dayName(ymd).split(",")[0];
export const spanText = (h: number): string => h < 1.5 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
/** Is a day figure from this market "today's tape"? Open now, or closed under 3 hours ago. */
export const isLiveTape = (s: MarketState): boolean => s.phase === "open" || (s.phase === "post" && s.hoursSinceClose < 3);
/** One deterministic sentence per market for the prompts: what session the day figures belong to, how stale it is, what comes next. */
export function sessionLine(mkt: Mkt, now = new Date()): string {
  const s = marketState(mkt, now);
  const name = mkt === "US" ? "US market" : "Korean market (KRX)";
  const hol = s.upcomingHolidays.length ? `; ${mkt} market holiday${s.upcomingHolidays.length > 1 ? "s" : ""} ahead: ${s.upcomingHolidays.map(dayName).join(", ")}` : "";
  const next = `Next ${mkt} session: ${dayName(s.nextSessionDate)}, opens in ${spanText(s.hoursToNextOpen)}${hol}.`;
  if (s.phase === "open") return `${name}: OPEN now, ${s.minutesIn} minutes into the ${dayName(s.ymd)} session. ${mkt} day changes are today's live tape. ${next}`;
  const closedWhy = s.phase === "closed" ? (s.holidayToday ? " Closed today for a market holiday." : " Closed today (weekend).") : s.phase === "pre" ? " Not open yet today." : "";
  const ago = s.phase === "post" && s.hoursSinceClose < 3 ? "just closed" : `closed ${spanText(s.hoursSinceClose)} ago`;
  const which = s.phase === "post" ? `today's ${dayName(s.ymd)} session` : `its last session, ${dayName(s.lastSessionDate)}`;
  const law = isLiveTape(s) ? `${mkt} day changes are today's final moves.`
    : s.phase === "post" ? `${mkt} day changes are from today's session, which ended ${spanText(s.hoursSinceClose)} ago: past tense ("in today's session"), never "now", "this morning" or "live".`
    : `${mkt} day changes are from that ${weekdayOf(s.lastSessionDate)} session, NOT today's tape: write "in ${weekdayOf(s.lastSessionDate)}'s session", never "today", "now" or "this morning".`;
  return `${name}: ${ago} (${which}).${closedWhy} ${law} ${next}`;
}

/** Which market's session a holding's "day" figure belongs to (null = crypto, which trades around the clock). */
export const marketOf = (symbol: string, kind?: string | null, currency?: string | null): Mkt | null =>
  kind === "crypto" || symbol.endsWith("-USD") ? null
  : symbol.endsWith(".KS") || symbol.endsWith(".KQ") || (currency === "KRW" && !symbol.startsWith("$")) ? "KR" : "US";

/** A short, deterministic label for a day figure, stamped next to EVERY day number fed to a model, so a
 *  live move can never be written up as "yesterday" and a closed session never as "today". Caught
 *  2026-09-25: a morning brief generated 31 minutes after the open called Microsoft's live +3.7% "yesterday". */
export function dayTag(mkt: Mkt | null, now = new Date()): string {
  if (!mkt) return "rolling 24h, crypto trades around the clock";
  const s = marketState(mkt, now);
  const who = mkt === "US" ? "US" : "Korean";
  if (s.phase === "open") return `today's ${weekdayOf(s.ymd)} ${who} session, LIVE, ${s.minutesIn} min in`;
  if (s.phase === "post") return `today's ${weekdayOf(s.ymd)} ${who} session, final`;
  return `${dayName(s.lastSessionDate)} ${who} session, past (not today)`;
}
