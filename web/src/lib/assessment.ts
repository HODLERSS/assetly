// The wait for a Portfolio Assessment after onboarding, a brokerage connect or a run of manual adds.
// It used to be a 7-second toast ("on the way") and a brief card that stopped looking after 4 minutes;
// a newcomer saw a plain price tracker and nothing saying the AI was working (launch audit, 2026-09-25).
// Now the run is remembered (it survives reloads and tab switches) and Home shows it until the
// assessment lands, the chain fails, or it has taken long enough to say so and offer a retry.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "./api";

export type AssessPhase = "idle" | "pending" | "ready" | "slow" | "error";
export type AssessState = {
  phase: AssessPhase;
  startedAt: string | null;
  /** false when a previous assessment exists: the copy says "updating", not "building your first". */
  first: boolean;
  /** the portfolio intelligence (written before the assessment) has landed for this run */
  intelligenceReady: boolean;
  readyAt: string | null;
  error: string | null;
};

const KEY = (uid: string) => `assetly-assess:${uid}`;
/** Past this, the card stops polling and says it is taking longer than usual (with Retry). */
export const ASSESS_TIMEOUT_MS = 20 * 60_000;
/** A remembered run older than this is dropped silently on the next open. */
const STALE_MS = 24 * 3600_000;

/** Poll gently: quick while it usually lands (2-4 min), then back off to 20s and 30s. */
export function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 2 * 60_000) return 10_000;
  if (elapsedMs < 6 * 60_000) return 20_000;
  return 30_000;
}

type Stored = { startedAt: string; first: boolean; error?: string | null };
function read(uid: string): Stored | null {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (!v?.startedAt || Date.now() - +new Date(v.startedAt) > STALE_MS) { localStorage.removeItem(KEY(uid)); return null; }
    return v;
  } catch { return null; }
}
function write(uid: string, v: Stored | null) {
  try { if (v) localStorage.setItem(KEY(uid), JSON.stringify(v)); else localStorage.removeItem(KEY(uid)); } catch { /* private mode */ }
}

const IDLE: AssessState = { phase: "idle", startedAt: null, first: true, intelligenceReady: false, readyAt: null, error: null };

export function useAssessmentWatch(api: Api, uid: string | null) {
  const [state, setState] = useState<AssessState>(IDLE);
  const [run, setRun] = useState(0);   // bumps restart the poll loop
  const stateRef = useRef(state);
  stateRef.current = state;
  const hasBriefsRef = useRef(false);   // the reader has brief rows: never "Your first assessment"

  // resume a run that was in flight when the app was closed or reloaded
  useEffect(() => {
    if (!uid) { setState(IDLE); return; }
    const s = read(uid);
    if (s) setState({ ...IDLE, phase: s.error ? "error" : "pending", startedAt: s.startedAt, first: s.first, error: s.error ?? null });
    else setState(IDLE);
  }, [uid]);

  useEffect(() => {
    if (!uid || state.phase !== "pending" || !state.startedAt) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const since = state.startedAt;
    const tick = async () => {
      if (!live) return;
      const elapsed = Date.now() - +new Date(since);
      try {
        const st = await api.getAssessmentStatus(since);
        if (!live) return;
        if (st.status === "ready") {
          write(uid, null);
          setState((p) => ({ ...p, phase: "ready", intelligenceReady: true, readyAt: st.generatedAt ?? new Date().toISOString() }));
          return;
        }
        if (st.status === "failed") {
          write(uid, { startedAt: since, first: stateRef.current.first, error: "The assessment didn't finish." });
          setState((p) => ({ ...p, phase: "error", error: "The assessment didn't finish." }));
          return;
        }
        const intel = !!st.intelligenceAt, first = !st.hadEarlier && !hasBriefsRef.current;
        setState((p) => (p.intelligenceReady === intel && p.first === first ? p : { ...p, intelligenceReady: intel, first }));
      } catch { /* offline for a moment: keep waiting */ }
      if (Date.now() - +new Date(since) >= ASSESS_TIMEOUT_MS) { if (live) setState((p) => ({ ...p, phase: "slow" })); return; }
      timer = setTimeout(tick, pollDelay(elapsed));
    };
    void tick();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [api, uid, state.phase, state.startedAt, run]);

  /** A run just started (the book changed and the chain was kicked). */
  // `noBriefs`: whether this reader has no brief rows yet (true), has some (false), or it isn't known (null). The
  // card says "Your first assessment" only for a reader with none: an established user saw it flash after an add
  // or remove (r11 designer). With rows known, no poll turns it back to "first"; unknown, the poll settles it.
  const start = useCallback((noBriefs: boolean | null = null) => {
    const startedAt = new Date().toISOString();
    const first = noBriefs === true;
    hasBriefsRef.current = noBriefs === false;
    if (uid) write(uid, { startedAt, first });
    setState({ ...IDLE, phase: "pending", startedAt, first });
    setRun((n) => n + 1);
  }, [uid]);
  /** The chain could not be started. */
  const fail = useCallback((message: string) => {
    const s = stateRef.current;
    if (uid && s.startedAt) write(uid, { startedAt: s.startedAt, first: s.first, error: message });
    setState((p) => ({ ...p, phase: "error", error: message }));
  }, [uid]);
  /** Put the card away (after "ready" has been seen, or the user closes the slow/error state). */
  const dismiss = useCallback(() => { if (uid) write(uid, null); setState(IDLE); }, [uid]);

  return { state, start, fail, dismiss };
}
