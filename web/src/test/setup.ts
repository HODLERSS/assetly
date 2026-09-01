import "@testing-library/react";

// This jsdom build ships no localStorage (Node prints "localStorage is not available"),
// so anything that remembers a preference — the appearance choice, the player's speed —
// silently took its catch branch and was never really exercised. A minimal in-memory
// shim makes those paths testable; app code still guards every access, because a real
// browser in private mode can throw on read.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}
