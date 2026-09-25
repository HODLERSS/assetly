// Book-level shaping shared by every screen: which rows count as held, and the order they list in.
import type { PortfolioRow } from "./api";
import { convertCcy, type FxRates } from "./format";

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
