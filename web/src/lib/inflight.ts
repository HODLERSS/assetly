// One write at a time per control. A double tap on "Add lot" sent two POSTs in the same millisecond and
// saved the lot twice (r2 power-user audit, 2026-09-25): the sheet had no busy state, and even a
// `disabled` from React state is one render too late for a second tap in the same frame. The ref is the
// guard (it flips synchronously, before the first await); the state is only what the button shows.
import { useCallback, useEffect, useRef, useState } from "react";

export function useInFlight(): [busy: boolean, run: <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const flying = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;   // re-entry while the first write is still out: ignored
    flying.current = true;
    setBusy(true);
    try { return await fn(); }
    finally {
      flying.current = false;
      if (mounted.current) setBusy(false);   // a save that closes its own sheet has unmounted by now
    }
  }, []);
  return [busy, run];
}
