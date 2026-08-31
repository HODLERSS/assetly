// The narration player — ONE audio element for the whole app, owned by the module rather than by a
// screen. That is the whole point: a brief kept playing only while BriefCard was mounted, so switching
// to News killed it mid-sentence. Nothing here unmounts, so playback survives every tab change.
//
// iOS notes that shaped this file:
//  - Safari only unlocks audio inside a user gesture, and the unlock is per-ELEMENT. So the element is
//    created and play()-ed on the first tap and then REUSED forever; every later play() is allowed,
//    including the ones that happen after an await for the signed URL.
//  - MediaSession lives here, not in a component, so the lock screen and Control Center keep working
//    no matter which screen is on top (or none, when the app is backgrounded).
//  - setPositionState keeps the lock-screen scrubber honest, including at non-1x speeds.

export type Track = { id: string; title: string; subtitle: string; date?: string };

export type PlayerState = {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  rate: number;
  error: string | null;
};

export const SKIP_SECONDS = 15;                        // a brief runs ~90s; 30s (the podcast default) would skip a third of it
export const RATES = [1, 1.25, 1.5, 1.75, 2] as const;

const RATE_KEY = "assetly-listen-rate";
const readRate = (): number => {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return (RATES as readonly number[]).includes(v) ? v : 1;
  } catch { return 1; }                                 // private mode, or storage blocked entirely
};

let state: PlayerState = { track: null, playing: false, loading: false, position: 0, duration: 0, rate: readRate(), error: null };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const set = (patch: Partial<PlayerState>) => {
  const next = { ...state, ...patch };
  // useSyncExternalStore compares by reference, so only publish when something actually moved
  if ((Object.keys(patch) as (keyof PlayerState)[]).every((k) => Object.is(state[k], next[k]))) return;
  state = next;
  emit();
};

export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); } };
export const getSnapshot = () => state;

let el: HTMLAudioElement | null = null;
let resolveUrl: (() => Promise<string | null>) | null = null;   // re-signable: storage URLs expire
let retried = false;

const positionState = () => {
  if (!el || !("mediaSession" in navigator)) return;
  const d = el.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState?.({ duration: d, playbackRate: el.playbackRate, position: Math.min(el.currentTime, d) });
  } catch { /* Safari throws if position briefly exceeds duration */ }
};

const wireMediaSession = (track: Track) => {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: "Assetly", album: track.subtitle });
    const h = navigator.mediaSession.setActionHandler?.bind(navigator.mediaSession);
    h?.("play", () => void play());
    h?.("pause", () => pause());
    h?.("stop", () => stop());
    h?.("seekbackward", () => skip(-SKIP_SECONDS));
    h?.("seekforward", () => skip(SKIP_SECONDS));
    h?.("seekto", (d) => { if (typeof d.seekTime === "number") seek(d.seekTime); });
  } catch { /* older WebKit: metadata only, controls still work */ }
};

const ensureElement = (): HTMLAudioElement => {
  if (el) return el;
  const a = new Audio();
  a.preload = "metadata";
  a.setAttribute("playsinline", "");   // typed only on HTMLVideoElement; harmless and correct on the element itself
  a.playbackRate = state.rate;
  a.addEventListener("timeupdate", () => { set({ position: a.currentTime }); positionState(); });
  a.addEventListener("durationchange", () => { set({ duration: Number.isFinite(a.duration) ? a.duration : 0 }); positionState(); });
  a.addEventListener("loadedmetadata", () => set({ loading: false, duration: Number.isFinite(a.duration) ? a.duration : 0 }));
  a.addEventListener("play", () => set({ playing: true, error: null }));
  a.addEventListener("pause", () => set({ playing: false }));
  a.addEventListener("ended", () => { set({ playing: false, position: 0 }); a.currentTime = 0; });
  a.addEventListener("error", () => { void recover(); });
  el = a;
  return a;
};

// A signed storage URL expires. Rather than surfacing a dead player, re-sign once and resume where we were.
const recover = async () => {
  if (!el || !resolveUrl || retried) { set({ loading: false, playing: false, error: "That recording could not be played." }); return; }
  retried = true;
  const at = el.currentTime;
  const wasPlaying = state.playing;
  const url = await resolveUrl().catch(() => null);
  if (!url) { set({ loading: false, playing: false, error: "That recording could not be played." }); return; }
  el.src = url;
  el.load();
  const resume = () => { el!.currentTime = at; if (wasPlaying) void el!.play().catch(() => {}); };
  el.addEventListener("loadedmetadata", resume, { once: true });
};

/**
 * Start a track. MUST be called from a user gesture the first time in a session: the element is created
 * and unlocked synchronously here, before the await, so the later play() is permitted on iOS.
 */
export const load = async (track: Track, resolver: () => Promise<string | null>) => {
  const a = ensureElement();
  if (state.track?.id === track.id && a.src) { await play(); return; }   // same brief: resume, never restart
  // synchronous unlock inside the gesture; it rejects with no src and that is fine, the element is now blessed
  try { void a.play().catch(() => {}); a.pause(); } catch { /* not unlockable here */ }
  retried = false;
  resolveUrl = resolver;
  set({ track, loading: true, error: null, position: 0, duration: 0, playing: false });
  const url = await resolver().catch(() => null);
  if (!url) { set({ loading: false, error: "That recording is not available yet." }); return; }
  if (state.track?.id !== track.id) return;                              // user switched briefs while we signed
  a.src = url;
  a.playbackRate = state.rate;
  a.load();
  wireMediaSession(track);
  await play();
};

export const play = async () => {
  const a = el;
  if (!a || !a.src) return;
  try { await a.play(); set({ playing: true, loading: false, error: null }); }
  catch { set({ playing: false, loading: false, error: "Tap play to start the audio." }); }
};

export const pause = () => { el?.pause(); set({ playing: false }); };
export const toggle = () => { if (state.playing) pause(); else void play(); };

export const seek = (t: number) => {
  if (!el) return;
  const d = Number.isFinite(el.duration) ? el.duration : state.duration;
  const clamped = Math.max(0, Math.min(t, d || 0));
  el.currentTime = clamped;
  set({ position: clamped });
  positionState();
};

export const skip = (delta: number) => seek((el?.currentTime ?? state.position) + delta);

export const setRate = (r: number) => {
  if (el) el.playbackRate = r;
  set({ rate: r });
  try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* storage blocked: this session only */ }
  positionState();
};

export const cycleRate = () => setRate(RATES[(RATES.indexOf(state.rate as typeof RATES[number]) + 1) % RATES.length]);

export const stop = () => {
  el?.pause();
  if (el) { el.removeAttribute("src"); el.load(); }
  resolveUrl = null;
  retried = false;
  if ("mediaSession" in navigator) { try { navigator.mediaSession.metadata = null; } catch { /* ignore */ } }
  set({ track: null, playing: false, loading: false, position: 0, duration: 0, error: null });
};

/** mm:ss for the ear-time readouts; a brief is always under an hour. */
export const clock = (s: number) => {
  const n = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

/** Test seam: drop the singleton so each test starts from silence. */
export const __resetPlayer = () => {
  try { el?.pause(); } catch { /* jsdom */ }
  el = null; resolveUrl = null; retried = false;
  state = { track: null, playing: false, loading: false, position: 0, duration: 0, rate: 1, error: null };
  emit();
};
