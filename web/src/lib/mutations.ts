// Book writes vs. reads in flight. A read that started before a write can answer after it, with the book as it
// was: on a slow backend a deleted lot and a removed position came back for a moment (r8 power-user). Every
// book write bumps one counter as it starts; a read notes the counter when it starts and drops its answer if a
// write started since. The write's own follow-up read starts after the bump, so it is the one that paints.
import type { Api } from "./api";

let seq = 0;
/** The counter now: take it when a read starts. */
export const mutationMark = (): number => seq;
/** A book write started after `mark`: the read that took it is stale. */
export const mutatedSince = (mark: number): boolean => seq !== mark;
export const bumpMutation = (): number => ++seq;

const WRITES = new Set<keyof Api>(["addPosition", "addLot", "updateLot", "deleteLot", "removeHolding", "setHoldingAccount", "excludeImport"]);
const guarded = new WeakMap<Api, Api>();

/** The same api, with every book write bumping the counter before it goes out. One wrapper per api. */
export function guardWrites(api: Api): Api {
  const hit = guarded.get(api);
  if (hit) return hit;
  const proxy = new Proxy(api, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof v !== "function" || !WRITES.has(key as keyof Api)) return v;
      return (...args: unknown[]) => { bumpMutation(); return (v as (...a: unknown[]) => unknown).apply(receiver, args); };
    },
  });
  guarded.set(api, proxy);
  return proxy;
}
