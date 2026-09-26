// Previous close, the base of every day move. Round 9 newcomer (top priority): price-sync took "the stored price" as the
// previous close whenever the UTC date rolled, even when that stored row was TWO or more sessions old (a symbol added
// mid-week, a price row that missed a day). JNJ showed +0.76% (real +0.20%) and SCHD −0.21% (real +0.33%) against
// the Sep 23 close, and those figures reached News, Ask and the cards.
//
// The previous close is now the close of the LAST COMPLETED SESSION before the quote's session, in this order:
//   1. that session's close from our own history (the daily bar stamped at the close, or the last tick at the close);
//   2. the stored row, only when it was written in that very session at (or after) its close;
//   3. the provider's previousClose, when plausible;
//   4. within the same session, the previous close already stored for it.
// price-sync recomputes this on EVERY run, so a wrong stored base heals on the next run.
// A stale stored row (older than the previous session) is never the base.
import { CLOSE_MIN, type Mkt, prevTradingDay, isTradingDay, TZ, zonedEpoch, zonedParts, ymdShift } from "./calendar.ts";

export type PrevInput = {
  price: number;
  asOf: string;                                        // the quote's time (provider regularMarketTime)
  providerPrev: number | null;                         // provider previousClose (already plausibility-checked)
  stored: { price: number; prev_close: number | null; as_of: string | null } | null;
  historyClose: number | null;                         // our close for the previous session (see prevSessionWindow)
  mkt: Mkt | null;                                     // null = crypto (UTC days)
};

/** The quote's session date and the previous completed session, in the market's own calendar. */
export function sessionsOf(asOf: string, mkt: Mkt | null): { session: string; prev: string } {
  if (mkt === null) {
    const d = new Date(asOf).toISOString().slice(0, 10);
    return { session: d, prev: ymdShift(d, -1) };
  }
  const z = zonedParts(new Date(asOf), TZ[mkt]);
  // a print stamped on a weekend or holiday (or before the open) belongs to the last trading session
  const session = isTradingDay(mkt, z.ymd) ? z.ymd : prevTradingDay(mkt, z.ymd);
  return { session, prev: prevTradingDay(mkt, session) };
}

/** The epoch window in which a stored price counts as the previous session's CLOSE. */
export function prevSessionWindow(asOf: string, mkt: Mkt | null): { from: number; to: number } {
  const { prev } = sessionsOf(asOf, mkt);
  if (mkt === null) {
    const end = Date.parse(prev + "T23:59:59Z");
    return { from: end - 45 * 60000, to: end + 60000 };
  }
  const close = zonedEpoch(prev, CLOSE_MIN[mkt], TZ[mkt]);
  return { from: close - 30 * 60000, to: close + 6 * 3600000 };   // the last tick near the close, or the daily bar stamped at it
}

const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
/** A base more than 50% from the price is bad data (Yahoo has shipped BTC prev 110k at 80k). */
const plausible = (price: number, prev: number | null) => ok(prev) && Math.abs(price / prev - 1) <= 0.5 ? prev : null;

export function resolvePrevClose(i: PrevInput): number | null {
  const { session } = sessionsOf(i.asOf, i.mkt);
  // 1. our own close of the previous session
  const h = plausible(i.price, i.historyClose);
  if (h !== null) return h;
  if (i.stored?.as_of) {
    const w = prevSessionWindow(i.asOf, i.mkt);
    const t = Date.parse(String(i.stored.as_of));
    // 2. the stored row IS the previous session's close
    if (t >= w.from && t <= w.to) { const s = plausible(i.price, i.stored.price); if (s !== null) return s; }
  }
  // 3. the provider's previous close (v7 regularMarketPreviousClose / v8 range=1d chartPreviousClose)
  const p = plausible(i.price, i.providerPrev);
  if (p !== null) return p;
  // 4. same session: the previous close already stored for it. Last, because a writer can have stored a wrong one
  //    (round 9: symbol-search wrote the close of two sessions back after hours).
  if (i.stored?.as_of && sessionsOf(String(i.stored.as_of), i.mkt).session === session) return plausible(i.price, i.stored.prev_close);
  return null;
}

/** The previous session's close from a series of closes stamped at each session's close (parseYahooDaily output).
 *  Round 9 root cause: symbol-search took "the last bar of a different date than the last bar" as the previous close.
 *  After hours Yahoo's daily bar for TODAY still has a null close, so the last bar was yesterday's and the "previous"
 *  one was two sessions back (AAPL +1.20% instead of +1.53%). The bar is matched to the previous SESSION instead. */
export function prevCloseFromBars(bars: { ts: string; price: number }[], asOf: string, mkt: Mkt | null): number | null {
  const w = prevSessionWindow(asOf, mkt);
  const cut = mkt === null ? w.to : w.from + 31 * 60000;
  let out: number | null = null;
  for (const b of bars) { const t = Date.parse(b.ts); if (t >= w.from && t <= cut && b.price > 0) out = b.price; }
  return out;
}
