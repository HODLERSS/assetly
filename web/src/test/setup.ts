import { vi } from "vitest";
import { configure } from "@testing-library/react";

// The suite runs ~400 App-level renders in parallel workers; under that load a findBy's default 1s wait
// occasionally expired before an async effect settled (a different test flaked each full run). 4s keeps every
// assertion real while removing the load-dependent flake.
configure({ asyncUtilTimeout: 4000 });

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

// jsdom has no scrolling: App resets the scroll on every view change (window.scrollTo), which jsdom
// reports as "Not implemented". A spy stands in so tests can assert where the page was sent.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
}
