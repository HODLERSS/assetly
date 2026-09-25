// Book-level shaping shared by every screen: which rows count as held, and the order they list in.
import type { Lot, PortfolioRow } from "./api";
import { convertCcy, dayChangeAmount, type FxRates } from "./format";
import { marketOf, moveSession, priceSession } from "./markets";

/** A row's day move in its own currency: what withSameDayLots worked out, else the price move on the whole row. */
export const rowDayChange = (r: Pick<PortfolioRow, "value" | "change_pct" | "day_change">): number | null =>
  r.day_change !== undefined ? r.day_change : dayChangeAmount(r.value, r.change_pct);

/** Lots bought in the session the row's move belongs to move from their cost, not from the prior close. NVDA and
 *  QQQ bought at the close with "Use today's price" showed "+$20 today" beside "$0 all time" (r6 newcomer m5).
 *  The session date is the market's own (priceSession), which is how "Use today's price" dates a lot. Rows with
 *  no such lot come back as they are. `lots` is the book's recently dated lots (api.getRecentLots). */
export function withSameDayLots(rows: PortfolioRow[], lots: Pick<Lot, "holding_id" | "qty" | "cost_per_share" | "acquired_on">[],
  now: Date = new Date()): PortfolioRow[] {
  if (!lots.length) return rows;
  return rows.map((r) => {
    if (marketOf(r) === null || r.value === null || r.change_pct === null || r.price === null || !r.qty) return r;
    const f = 1 + r.change_pct / 100;
    if (f <= 0) return r;
    const day = priceSession(r, now).ymd;
    // on or after that day: a lot dated Saturday was bought after Friday's move, at Friday's close
    const fresh = lots.filter((l) => l.holding_id === r.holding_id && !!l.acquired_on && l.acquired_on >= day);
    if (!fresh.length) return r;
    const qNew = fresh.reduce((s, l) => s + l.qty, 0);
    const held = Math.max(0, r.qty - qNew) / r.qty;   // the part held from before the session moves from the prior close
    const price = r.price;
    return { ...r, day_change: (r.value - r.value / f) * held + fresh.reduce((s, l) => s + l.qty * (price - l.cost_per_share), 0) };
  });
}

export type DayGroup = { label: string; today: boolean; markets: string[]; day: number; basis: number };
const MKT_NAME = { US: "US", KR: "Korea", CRYPTO: "Crypto" } as const;

/** The book's day move, split by the session each part came from. A Friday-afternoon "today" used to
 *  add Korea's last KRX session (a holiday-shifted Wednesday) to the US tape and call the sum today
 *  (launch audit, 2026-09-25). Moves from the same session combine; each other session is its own
 *  group, named by market and labelled by its close. Today's group comes first. Cash and debt carry
 *  no move and sit in no group. */
export function dayGroups(rows: PortfolioRow[], base: string, fx: FxRates | null, now: Date = new Date()): DayGroup[] {
  const by = new Map<string, DayGroup & { latest: number }>();
  for (const r of rows) {
    const m = marketOf(r);
    if (m === null || r.change_pct === null || r.value === null) continue;
    const d = rowDayChange(r);
    const day = d === null ? null : convertCcy(d, r.currency, base, fx);
    const val = convertCcy(r.value, r.currency, base, fx);
    if (day === null || val === null) continue;
    const s = moveSession(r, now);
    const g = by.get(s.label) ?? { label: s.label, today: s.today, markets: [], day: 0, basis: 0, latest: 0 };
    if (!g.markets.includes(MKT_NAME[m])) g.markets.push(MKT_NAME[m]);
    g.day += day; g.basis += val - day;
    g.latest = Math.max(g.latest, r.as_of ? +new Date(r.as_of) : 0);
    by.set(s.label, g);
  }
  // markets in one fixed order: listed by which row was biggest, "Crypto + US" became "US + Crypto" the day a
  // stock outgrew BTC (r5 power-user)
  const order = Object.values(MKT_NAME) as string[];
  return [...by.values()]
    .sort((a, b) => Number(b.today) - Number(a.today) || b.latest - a.latest)
    .map(({ latest: _l, ...g }) => ({ ...g, markets: [...g.markets].sort((x, y) => order.indexOf(x) - order.indexOf(y)) }));
}

/** A row is a position only while it has something in it. A holding whose lots are all gone (or not
 *  yet written) is not "0 shares of X": it never lists, never moves, never gets news. */
export function isHeld(r: Pick<PortfolioRow, "qty">): boolean {
  return r.qty !== null && Number.isFinite(r.qty) && r.qty > 0;
}

/** Largest first, compared in ONE currency. The server orders by raw native value, where
 *  ₩9,310,000 (~$6.9k) outranks $29k of BTC. Rows that can't be converted yet keep their
 *  relative order after the rest, so nothing jumps around while FX is loading. */
export function sortByBaseValue(rows: PortfolioRow[], base: string, fx: FxRates | null): PortfolioRow[] {
  const keyed = rows.map((r, i) => ({ r, i, v: r.value === null ? null : convertCcy(r.value, r.currency, base, fx) }));
  keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    return b.v - a.v || a.i - b.i;
  });
  return keyed.map((k) => k.r);
}
