// The lots each holding was last read (or written) with, per api, for the session: the position screen paints
// them at once on revisit, and a just-added position shows its lot from the add itself instead of "Loading
// lots…" for the round trip (e2e p02 F11).
import type { Api, Lot } from "./api";

const lotsMemo = new WeakMap<Api, Map<string, Lot[]>>();
export const lotsFor = (api: Api): Map<string, Lot[]> => {
  let m = lotsMemo.get(api);
  if (!m) { m = new Map(); lotsMemo.set(api, m); }
  return m;
};
/** What an add just wrote: the new holding's lot list is that lot (a new holding), or the list it had plus it. */
export function seedLots(api: Api, added: { holdingId: string; lot: Lot | null } | null | undefined): void {
  if (!added?.holdingId || !added.lot) return;
  const lot = added.lot;
  const m = lotsFor(api);
  const had = m.get(added.holdingId) ?? [];
  if (had.some((l) => l.id === lot.id)) return;
  m.set(added.holdingId, [...had, lot]);
}
