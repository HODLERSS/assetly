// The exchange calendar, one copy for the web app: full-closure holidays for KRX and the US, and which dates
// trade. Mirror of supabase/functions/_shared/calendar.ts HOL (keep the two lists identical; lunar KR holidays
// such as Seollal, Buddha's Birthday and Chuseok are listed explicitly through 2027).
export type CalMkt = "US" | "KR";

export const HOL: Record<CalMkt, Set<string>> = {
  US: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ]),
  KR: new Set([
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-06-06",
    "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
    "2027-01-01", "2027-02-08", "2027-02-09", "2027-02-10", "2027-03-01", "2027-05-05", "2027-05-13", "2027-06-07", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-31",
  ]),
};

export const ymdShift = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const isTradingDay = (mkt: CalMkt, ymd: string): boolean => {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5 && !HOL[mkt].has(ymd);
};
/** The last trading date strictly before `ymd`. */
export const prevTradingDay = (mkt: CalMkt, ymd: string): string => {
  let x = ymd;
  do x = ymdShift(x, -1); while (!isTradingDay(mkt, x));
  return x;
};
/** The market a series zone dates its sessions in (null: a coin's UTC day, which trades every day). */
export const calMktOfZone = (timeZone: string): CalMkt | null =>
  timeZone === "Asia/Seoul" ? "KR" : timeZone === "America/New_York" ? "US" : null;
