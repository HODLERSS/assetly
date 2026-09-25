import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { convertCcy, dayChangeAmount, type FxRates } from "./lib/format";
import { isHeld, sortByBaseValue } from "./lib/portfolio";
import { useAssessmentWatch } from "./lib/assessment";
import { noteRemoval } from "./lib/heldIntel";
import { foreignBrief } from "./lib/briefBasis";
import { clearUserLocalState } from "./lib/localState";
import { setPricesDown } from "./lib/net";
import type { Session } from "@supabase/supabase-js";
import { completeNativeAuth, supabase } from "./lib/supabase";
import { api as defaultApi, type Api, type BriefEdition, type Insight, type PortfolioRow, type Profile } from "./lib/api";
import { AuthScreen } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";
import { Home, NEXT_KEY } from "./screens/Home";
import { TabIcon } from "./components/TabIcon";
import { MiniPlayer } from "./components/MiniPlayer";
import { applyTheme, getTheme, watchSystemTheme } from "./lib/theme";
import { onAuthReturn, onForeground, onOAuthReturn, PORTAL_CLOSED } from "./lib/native";
import { snapshotUnder, useEdgeSwipeBack, type Underlay } from "./lib/swipeBack";
import { PullToRefresh } from "./components/PullToRefresh";
import { clearBadge, pushEnabled, registerPush } from "./lib/push";
import { PositionScreen } from "./screens/Position";
import { AddPosition } from "./screens/AddPosition";
import { NewsScreen } from "./screens/News";
import { SettingsScreen } from "./screens/Settings";
import { ASK_FIRST_QUESTION, AskScreen } from "./screens/Ask";
import { Icon } from "./components/Icon";

export type Tab = "home" | "news" | "ask" | "settings";
export type View =
  | { kind: "tab"; tab: Tab }
  | { kind: "add" }
  | { kind: "position"; holdingId: string };

const REFRESH_MS = 60_000;
const STALE_ON_RETURN_MS = 30_000;
const LOAD_TIMEOUT_MS = 8_000;
export const PRICES_FAILED = "Couldn't refresh prices.";   // back from the background with a book older than this: refresh now

// Last-known book per user, so a cold open paints holdings instead of a blank or an empty-state
// flash. Only an onboarded profile is cached: a null onboarded_at would route a returning user
// through setup for a frame.
// v2 carries the FX rates the book was last valued at. Without them the cached rows painted before
// getFxRates() answered, every KRW holding dropped out of the total, and net worth opened ~$13k low
// before jumping back (launch audit, 2026-09-25). A v1 entry still paints; its rates arrive with load().
const BOOK_KEY = (uid: string) => `assetly-book:${uid}`;
type BookCache = { profile: Profile; rows: PortfolioRow[]; fx: FxRates | null };
function readBookCache(uid: string): BookCache | null {
  try {
    const raw = localStorage.getItem(BOOK_KEY(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as { v: number; profile: Profile; rows: PortfolioRow[]; fx?: FxRates | null };
    if ((v.v !== 1 && v.v !== 2) || !v.profile?.onboarded_at || !Array.isArray(v.rows)) return null;
    const fx = v.v === 2 && v.fx && typeof v.fx === "object" && Number(v.fx.USD) === 1 ? v.fx : null;
    return { profile: v.profile, rows: v.rows, fx };
  } catch { return null; }
}
function writeBookCache(uid: string, profile: Profile, rows: PortfolioRow[], fx: FxRates | null) {
  try {
    if (!profile.onboarded_at) { localStorage.removeItem(BOOK_KEY(uid)); return; }
    localStorage.setItem(BOOK_KEY(uid), JSON.stringify({ v: 2, profile, rows, fx }));
  } catch { /* private mode or quota: the server copy still loads */ }
}
function clearBookCache(uid: string) { try { localStorage.removeItem(BOOK_KEY(uid)); } catch { /* ignore */ } }

export function App({ api = defaultApi }: { api?: Api }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rawRows, setRows] = useState<PortfolioRow[]>([]);   // as the server sent them; `rows` below is the shaped book
  // The book starts empty and Home reads an empty book as "connect your brokerage". Until the first
  // load (server or the cached copy below) has answered, Home shows a skeleton instead of that prompt.
  const [booted, setBooted] = useState(false);
  const uidRef = useRef<string | null>(null);   // whose cached book to clear at sign-out
  const [fx, setFx] = useState<FxRates | null>(null);   // units per USD, every currency the price pipeline tracks
  const fxRef = useRef<FxRates | null>(null);
  fxRef.current = fx;
  const [view, setView] = useState<View>({ kind: "tab", tab: "home" });
  const [error, setError] = useState<string | null>(null);
  const [askAlert, setAskAlert] = useState(false);
  const [newsAlert, setNewsAlert] = useState(false);
  const [homeAlert, setHomeAlert] = useState(false);
  const [briefBanner, setBriefBanner] = useState<{ audio: boolean; edition: BriefEdition } | null>(null);   // first-arrival banner on Home
  const [autoAsk, setAutoAsk] = useState<{ question: string; key: string } | null>(null);
  // the Portfolio Assessment a connect / onboarding / run of adds is waiting on: Home shows it until it lands
  const assess = useAssessmentWatch(api, session?.user.id ?? null);
  const connectPendingRef = useRef<string | null>(null);   // set at the connect moment; consumed when fresh intelligence lands
  const seenBriefRef = useRef<string | null>(null);   // latest brief generated_at the user has seen
  // the book the brief watcher judges against (null until the first load): a brief about other holdings is
  // never announced as "Your brief is ready" (r4 newcomer)
  const briefBookRef = useRef<PortfolioRow[] | null>(null);
  // brief watcher: a new brief (first brief, or the next edition) lights Home when the user is elsewhere
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try {
        const book = briefBookRef.current;
        if (!book) return;   // judged against the book: the first look waits for it (the effect reruns at boot)
        const bs = (await api.getDailyBriefs()).filter((b) => !foreignBrief(b, book));
        if (!live) return;
        // baseline on the very first look: "no brief yet" is itself a state, so a fresh account's
        // first brief counts as NEW when it lands instead of being swallowed as the baseline
        if (!bs.length) { if (seenBriefRef.current === null) seenBriefRef.current = "none"; return; }
        const latest = bs[bs.length - 1];
        const key = `${latest.brief_date}:${latest.edition}:${latest.generated_at}`;
        if (seenBriefRef.current === null) { seenBriefRef.current = key; return; }
        if (key !== seenBriefRef.current) {
          const onHome = viewRef.current.kind === "tab" && viewRef.current.tab === "home";
          if (onHome) seenBriefRef.current = key;
          setBriefBanner({ audio: !!latest.audio_path, edition: latest.edition });
          if (!onHome) setHomeAlert(true);
        }
      } catch { /* quiet */ }
    };
    tick();
    const t = setInterval(tick, 20000);   // a fresh account's first brief lands in 1-3 min; catch it promptly
    return () => { live = false; clearInterval(t); };
  }, [session, api, booted]);
  const seenInsightRef = useRef<string | null>(null);   // generated_at the user has already seen
  const [pinsRefreshing, setPinsRefreshing] = useState(false);
  // per-stock refreshes: keyed by symbol so several can run and each survives tab changes
  const [symRefreshing, setSymRefreshing] = useState<Record<string, boolean>>({});
  const [symFresh, setSymFresh] = useState<Record<string, Insight>>({});
  const refreshSymbol = useCallback(async (symbol: string) => {
    if (symRefreshing[symbol]) return;
    setSymRefreshing((m) => ({ ...m, [symbol]: true }));
    try {
      const v = await api.refreshSymbolInsights(symbol);
      if (v) {
        setSymFresh((m) => ({ ...m, [symbol]: v }));
        const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
        if (cur !== "news") setNewsAlert(true);
      }
    } finally { setSymRefreshing((m) => ({ ...m, [symbol]: false })); }
  }, [api, symRefreshing]);
  const [pinsFresh, setPinsFresh] = useState<Insight | null>(null);   // result of the last app-level refresh
  // Refresh lives here, not in a screen: it keeps running across tabs and lights the tab when done.
  const refreshInsights = useCallback(async () => {
    if (pinsRefreshing) return;
    setPinsRefreshing(true);
    try {
      const v = await api.refreshPortfolioInsights();
      if (v) {
        setPinsFresh(v);
        const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
        if (cur === "news") seenInsightRef.current = v.generated_at;
        if (cur !== "news") setNewsAlert(true);
        if (cur !== "news") setNewsAlert(true);
      }
    } finally { setPinsRefreshing(false); }
  }, [api, pinsRefreshing]);
  // background watch: a newer portfolio assessment (cron/refresh) lights the News tab, where it now lives
  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = async () => {
      try {
        const v = await api.getPortfolioInsights();
        if (!live || !v) return;
        // a connect moment survives the callback's full page load via sessionStorage
        let connectAt: string | null = null;
        try { connectAt = sessionStorage.getItem("assetly-connect-at"); } catch { /* none */ }
        const freshSinceConnect = !!connectAt && v.generated_at > connectAt;
        if (seenInsightRef.current === null && !freshSinceConnect) { seenInsightRef.current = v.generated_at; return; }
        if (v.generated_at !== seenInsightRef.current) {
          const cur = viewRef.current.kind === "tab" ? viewRef.current.tab : null;
          if (cur === "news") seenInsightRef.current = v.generated_at;
          if (cur !== "news") setNewsAlert(true);
          if (cur !== "news") setNewsAlert(true);
          // connect moment: a fresh assessment means news + intelligence are in -> ask the first question now
          if (connectPendingRef.current || freshSinceConnect) {
            setAutoAsk({ question: ASK_FIRST_QUESTION, key: connectPendingRef.current ?? connectAt ?? String(Date.now()) });
            connectPendingRef.current = null;
            try { sessionStorage.removeItem("assetly-connect-at"); } catch { /* none */ }
          }
        }
      } catch { /* quiet */ }
    };
    const t = setInterval(tick, 15000);   // 15s: a connect-moment assessment is noticed within seconds
    return () => { live = false; clearInterval(t); };
  }, [session, api]);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => { applyTheme(getTheme()); return watchSystemTheme(); }, []);
  // Push needs a signed-in user to attach the device token to. Registering is best-effort:
  // a declined prompt is a normal outcome and the in-app poll still lights the tab.
  // Notifications are opt-in (Settings > Brief notifications): the permission sheet never fires unasked.
  useEffect(() => {
    if (!session || !pushEnabled()) return;
    let off: (() => void) | undefined;
    void registerPush((token) => api.savePushToken(token)).then((f) => { off = f; });
    void clearBadge();
    return () => off?.();
  }, [session, api]);
  // iOS: Supabase OAuth comes back through assetly://auth-callback
  useEffect(() => onAuthReturn((u) => { void completeNativeAuth(u).then((r) => { if (r.error) setError(r.error); }); }), []);
  useEffect(() => {
    // stale-bundle guard: the PWA can cache an old build; check the served index once per open
    (async () => {
      try {
        if (sessionStorage.getItem("assetly-updated")) return;
        const html = await (await fetch(window.location.pathname || "./", { cache: "no-store" })).text();
        const served = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0];
        const running = [...document.querySelectorAll("script[src]")].map((el) => el.getAttribute("src") ?? "").find((src) => src.includes("index-"))?.match(/index-[A-Za-z0-9_-]+\.js/)?.[0];
        if (served && running && served !== running) {
          sessionStorage.setItem("assetly-updated", "1");
          window.location.reload();
        }
      } catch { /* offline or blocked: run what we have */ }
    })();
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const lastLoadRef = useRef(0);
  const load = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      // rates travel with the book: rows valued in one currency never paint without the other's rate
      // Offline, a request can hang instead of failing, and a pull to refresh spun for 4.5s+ with no word
      // (r3 power-user). Past the limit it is a failed refresh, said the same way as any other.
      const [p, r, rates] = await Promise.race([
        Promise.all([api.getProfile(), api.getPortfolio(), api.getFxRates().catch(() => null)]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS)),
      ]);
      const fxNow = rates && Object.keys(rates).length > 1 ? rates : fxRef.current;   // a failed FX read keeps the last good rates
      setProfile(p);
      setRows(r);
      if (fxNow) setFx(fxNow);
      setError(null);
      setPricesDown(false);
      if (uidRef.current && p) writeBookCache(uidRef.current, p, r, fxNow);
    } catch {
      setError(PRICES_FAILED);
      setPricesDown(true);   // the reads behind it (lots, charts, the brief) stop waiting out retries (lib/net)
    } finally {
      setBooted(true);
    }
  }, [api]);

  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"busy" | "ok" | "warn">("ok");
  const [obSnap, setObSnap] = useState<string | null>(null);
  const [snapReturn, setSnapReturn] = useState<string | null>(null);
  // a web portal window closed without connecting: nothing to announce, but pick up anything that did land
  useEffect(() => onOAuthReturn((status) => { if (status === PORTAL_CLOSED) void load(); else setSnapReturn(status); }), [load]);
  useEffect(() => {
    if (!session) return;
    const q = new URLSearchParams(window.location.search);
    const stp = q.get("snaptrade") ?? snapReturn;
    if (!stp) return;
    setSnapReturn(null);
    setObSnap(stp);
    q.delete("snaptrade");
    window.history.replaceState({}, "", window.location.pathname + (q.toString() ? "?" + q.toString() : "") + window.location.hash);
    if (stp === "connected") {
      setNoticeKind("busy"); setNotice("Connected · importing your positions");
      // the callback already queued the full chain server-side; here we wait for the import to land, then
      // kick the chain again as a belt-and-braces (idempotent: the per-user lock makes a duplicate sync yield)
      connectPendingRef.current = String(Date.now());
      try { sessionStorage.setItem("assetly-connect-at", new Date().toISOString()); } catch { /* storage unavailable */ }
      assess.start();
      // Imported rows land over several seconds (callback sync + webhook syncs). Poll the book quickly
      // until it stops growing so Home shows the new stocks immediately, not on the next 60s tick.
      let lastCount = -1, stable = 0, ticks = 0;
      const settle = async () => {
        if (ticks++ > 30) return;                       // ~60s ceiling
        try {
          const r = await api.getPortfolio();
          setRows(r);
          if (r.length === lastCount) stable++; else { stable = 0; lastCount = r.length; }
        } catch { /* keep polling */ }
        if (stable < 3) setTimeout(settle, 2000);        // three quiet ticks = import has landed
      };
      void settle();
      api.snaptradeSync().then(async () => {
        await load();
        // the callback queued the chain already, so a failed belt-and-braces kick is not an error to show
        void api.brokerageConnected().catch(() => {});
        setNoticeKind("ok"); setNotice("Import complete"); setTimeout(() => setNotice(null), 8000);
      }).catch(() => { setNoticeKind("ok"); setNotice("Connected · import finishing in the background"); setTimeout(() => setNotice(null), 8000); });
    } else {
      setNoticeKind("warn");
      setNotice(stp === "denied" ? "Brokerage link was declined." : "Brokerage link didn't complete. Try again from Settings.");
      setTimeout(() => setNotice(null), 8000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, snapReturn]);

  useEffect(() => {
    if (!session) {
      // signed out: nothing this user left on the device (hints, a pending run, removals) greets the next one
      if (uidRef.current) { clearBookCache(uidRef.current); clearUserLocalState(uidRef.current); uidRef.current = null; }
      setPricesDown(false);
      setProfile(null); setRows([]); setBooted(false); return;
    }
    uidRef.current = session.user.id;
    // Last known book first (stale-while-revalidate): a returning user sees their holdings on the
    // first frame, and the server copy replaces it a moment later.
    const cached = readBookCache(session.user.id);
    if (cached) { setProfile(cached.profile); setRows(cached.rows); if (cached.fx) setFx(cached.fx); setBooted(true); }
    load();
    // brokerage auto-sync deltas: greet returning users with what arrived while they were away
    api.snaptradeEvents().then(async (evs) => {
      if (!evs.length) return;
      const coll = [...new Set(evs.flatMap((e) => e.detail.collisions ?? []))];
      const groups = new Map<string, Set<string>>();
      for (const e of evs) {
        const by = e.detail.by_institution?.length ? e.detail.by_institution : (e.detail.added?.length ? [{ institution: e.detail.institution ?? "your brokerage", symbols: e.detail.added }] : []);
        for (const g of by) { const set = groups.get(g.institution) ?? new Set<string>(); g.symbols.forEach((x) => set.add(x)); groups.set(g.institution, set); }
      }
      if (groups.size) {
        const parts = [...groups.entries()].slice(0, 3).map(([inst, syms]) => {
          const list = [...syms];
          return `${inst}: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` +${list.length - 4} more` : ""}`;
        });
        setNotice(`Added from ${parts.join(" · ")}${coll.length ? ` · ${coll.join(", ")} also exists manually` : ""}`);
        setTimeout(() => setNotice(null), 12000);
      }
      await api.snaptradeEventsSeen(evs.map((e) => e.id));
    }).catch(() => {});
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [session, load, api]);
  // The 60s timer does not run while the app is in the background, so a return after lunch showed a
  // total up to a minute stale with no cue. Coming back to the foreground refreshes right away.
  useEffect(() => {
    if (!session) return;
    return onForeground(() => { if (Date.now() - lastLoadRef.current > STALE_ON_RETURN_MS) void load(); });
  }, [session, load]);
  // Losing the connection says so at once: Home kept its live dots for up to a minute, until the next price
  // poll failed (r4 power-user). Coming back refreshes right away instead of waiting for that poll.
  useEffect(() => {
    if (!session) return;
    const down = () => { setError(PRICES_FAILED); setPricesDown(true); };
    const up = () => { void load(); };
    if (typeof navigator !== "undefined" && navigator.onLine === false) down();
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); };
  }, [session, load]);

  // Edge swipe back on the pushed screens (Add position, Position detail): the same exit as their back button.
  const mainRef = useRef<HTMLElement>(null);
  const homeSnapRef = useRef<Underlay | null>(null);   // Home as it was left: drawn under a swipe back
  useEdgeSwipeBack(mainRef, view.kind !== "tab", () => { setHomeAlert(false); setView({ kind: "tab", tab: "home" }); }, () => homeSnapRef.current);

  // Book-changed pipeline for MANUAL adds: a run of adds (one after another) is coalesced into ONE
  // orchestrator call, the same chain a brokerage connect runs (sync -> news -> intelligence -> assessment).
  // Trailing 25s debounce; flushed early when the user leaves the Add screen or backgrounds the app.
  const bookChangeRef = useRef<{ timer: number | null; pending: boolean }>({ timer: null, pending: false });
  const runBookPipeline = useCallback(() => {
    const b = bookChangeRef.current;
    if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    if (!b.pending) return;
    b.pending = false;
    connectPendingRef.current = String(Date.now());
    try { sessionStorage.setItem("assetly-connect-at", new Date().toISOString()); } catch { /* storage unavailable */ }
    // Home's assessment card carries the wait (and a failure, with Retry), not a 7-second toast
    try { if (!localStorage.getItem(NEXT_KEY)) localStorage.setItem(NEXT_KEY, "armed"); } catch { /* private mode */ }   // first adds: arm the next-step hint
    assess.start();
    api.brokerageConnected().catch((e) => assess.fail(e instanceof Error ? e.message : "We couldn't start your assessment."));
  }, [api, assess.start, assess.fail]);
  const retryAssessment = useCallback(() => { bookChangeRef.current.pending = true; runBookPipeline(); }, [runBookPipeline]);
  // a brand-new book (nothing held before this add) starts its first assessment almost at once: the
  // first minutes decide whether a new user stays, and there is no earlier run to coalesce with
  const heldCountRef = useRef(0);
  const scheduleBookChange = useCallback(() => {
    const b = bookChangeRef.current;
    const firstBook = heldCountRef.current === 0 && !b.pending;
    // the first change of a run tells the server a run is coming, so the assessment it holds reads as
    // superseded from now on, not only once the debounce fires (fix2-server: brokerage-connected {pending})
    if (!b.pending) void api.markAssessmentPending();
    b.pending = true;
    if (b.timer) clearTimeout(b.timer);
    b.timer = window.setTimeout(runBookPipeline, firstBook ? 5000 : 25000);
  }, [api, runBookPipeline]);
  useEffect(() => { if (view.kind !== "add") runBookPipeline(); }, [view.kind, runBookPipeline]);   // leaving Add = the run is over
  useEffect(() => {
    const h = () => { if (document.visibilityState === "hidden") runBookPipeline(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [runBookPipeline]);

  // A view change starts at the top of the new screen. Opening a holding from a scrolled Home landed
  // mid-page with the ticker, price and Back pill scrolled away (r2 native audit M2). Coming back to Home
  // from a pushed screen puts the list where it was.
  const homeScrollRef = useRef(0);
  const prevViewRef = useRef<View>(view);
  const viewKey = view.kind === "tab" ? `tab:${view.tab}` : view.kind === "position" ? "position" : "add";
  useLayoutEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (prev === view) return;
    const backHome = view.kind === "tab" && view.tab === "home" && prev.kind !== "tab";
    try { window.scrollTo({ top: backHome ? homeScrollRef.current : 0, left: 0 }); } catch { /* not a browser */ }
    // Home's cards finish their height a frame or two after this runs, and the first restore landed ~66pt
    // off (r3 native m2): hold the saved position for a moment, until the reader touches the screen
    if (backHome && typeof requestAnimationFrame === "function") {
      const y = homeScrollRef.current, until = Date.now() + 600;
      let done = false;
      const stop = () => { done = true; window.removeEventListener("touchstart", stop); window.removeEventListener("wheel", stop); };
      window.addEventListener("touchstart", stop, { passive: true });
      window.addEventListener("wheel", stop, { passive: true });
      const hold = () => {
        if (done) return;
        if (Math.abs(window.scrollY - y) > 1) { try { window.scrollTo({ top: y, left: 0 }); } catch { /* not a browser */ } }
        if (Date.now() < until) requestAnimationFrame(hold); else stop();
      };
      requestAnimationFrame(hold);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const base = profile?.base_currency ?? "USD";
  // The book every screen sees: only rows that hold something, biggest first in the base currency.
  const rows = useMemo(() => sortByBaseValue(rawRows.filter(isHeld), base, fx), [rawRows, base, fx]);
  briefBookRef.current = booted ? rows : null;
  heldCountRef.current = rows.length;
  const totals = useMemo(() => {
    let assets = 0, debt = 0, cost = 0, day = 0, unconverted = 0, mixed = false;
    for (const r of rows) {
      if (r.currency !== base) mixed = true;
      const v = convertCcy(r.value ?? 0, r.currency, base, fx);
      if (v === null) { unconverted += 1; continue; }   // no FX rate yet: exclude, never mislabel
      if (r.kind === "debt") { debt += v; continue; }   // debt reduces net worth only; it has no cost basis, G/L, or day move
      const c = convertCcy(r.cost_basis ?? 0, r.currency, base, fx) ?? 0;
      const d = convertCcy(dayChangeAmount(r.value, r.change_pct) ?? 0, r.currency, base, fx) ?? 0;
      assets += v; cost += c; day += d;
    }
    const value = assets - debt;
    return { value, assets, debt, gl: assets - cost, cost, day, mixed, fx, unconverted };
  }, [rows, fx, base]);

  if (!authReady) return <div className="screen" aria-busy="true" />;
  if (!session) return <AuthScreen />;
  if (profile && !profile.onboarded_at) {
    return <Onboarding api={api} onDone={load} snaptrade={obSnap} onBookChanged={() => { bookChangeRef.current.pending = true; runBookPipeline(); }} />;
  }

  const go = (v: View) => {
    const cur = viewRef.current;
    if (cur.kind === "tab" && cur.tab === "home") { homeScrollRef.current = window.scrollY; if (v.kind !== "tab") homeSnapRef.current = snapshotUnder(mainRef.current); }
    // a failed price refresh stays said on every screen until a refresh succeeds: clearing it on navigation
    // put the live dots back on prices that were not live
    if (v.kind === "tab" && v.tab === "ask") setAskAlert(false); if (v.kind === "tab" && v.tab === "news") setNewsAlert(false); if (v.kind === "tab" && v.tab === "home") setHomeAlert(false); setView(v); };
  const tab = view.kind === "tab" ? view.tab : null;

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <svg width="26" height="12" viewBox="0 0 32 12" aria-hidden="true">
            <rect x="0" y="3" width="14" height="6" rx="3" fill="currentColor" />
            <rect x="17" y="3" width="14" height="6" rx="3" fill="currentColor" opacity="0.45" />
          </svg>
          Assetly
        </span>
      </header>

      {notice && (noticeKind === "warn"
        ? <div className="error-note" role="status">{notice}</div>
        : <div className={"status-note" + (noticeKind === "ok" ? " ok" : "")} role="status" data-testid="brokerage-notice">
            <span className="lead">{noticeKind === "busy" ? <span className="progress-dot" aria-hidden="true" /> : <Icon name="check" />}{notice}</span>
          </div>)}
      <main className="screen" ref={mainRef}>
        <h1 className="sr-only">Assetly</h1>
        {/* inset in the gutter like every other card, one message and its one action (r3 design m2) */}
        {error && (
          <div className="error-note inline-note" role="alert" data-testid="prices-error" style={{ marginTop: 0 }}>
            <span>{error}</span> <button className="chip" onClick={() => void load()}>Retry</button>
          </div>
        )}
        {view.kind === "add" && (
          <AddPosition api={api} onRefresh={load} onAdded={scheduleBookChange} baseCurrency={profile?.base_currency ?? "USD"}
            onDone={() => go({ kind: "tab", tab: "home" })}
            onCancel={() => go({ kind: "tab", tab: "home" })} />
        )}
        {view.kind === "position" && (
          <PositionScreen api={api} dispKr={profile?.display_kr ?? "KRW"} row={rows.find((r) => r.holding_id === view.holdingId) ?? null}
            others={(() => { const me = rows.find((r) => r.holding_id === view.holdingId); return me ? rows.filter((r) => r.symbol === me.symbol && r.holding_id !== me.holding_id) : []; })()}
            onChanged={load} onRemoved={async () => {
              // a removal changes the book as much as an add: the assessment and the intelligence are rerun
              // (leaving this screen flushes the run), and the removed name is remembered so the cards
              // stop talking about it until the rerun lands (r2 power-user N2)
              const gone = rows.find((r) => r.holding_id === view.holdingId);
              if (gone) noteRemoval(session.user.id, gone);
              if (gone && rows.length > 1) { bookChangeRef.current.pending = true; void api.markAssessmentPending(); }
              await load(); go({ kind: "tab", tab: "home" });
            }}
            onMoved={async (id) => { await load(); setView({ kind: "position", holdingId: id }); }}
            onBack={() => go({ kind: "tab", tab: "home" })} />
        )}
        {view.kind === "tab" && view.tab === "home" && (
          <PullToRefresh onRefresh={load}>
          <Home api={api} rows={rows} totals={totals} baseCurrency={profile?.base_currency ?? "USD"} loading={!booted}
            dispUs={profile?.display_us ?? "USD"} dispKr={profile?.display_kr ?? "KRW"}
            onOpen={(id) => go({ kind: "position", holdingId: id })} onAdd={() => go({ kind: "add" })}
            briefBanner={briefBanner} onBriefBannerDone={() => setBriefBanner(null)}
            assessment={assess.state} onAssessRetry={retryAssessment} onAssessDismiss={assess.dismiss}
            onOpenNews={() => go({ kind: "tab", tab: "news" })}
            // always the prices' own time, the newest print on screen: the fetch time moved the label 37 minutes
            // between two looks at the same prices (r5 designer m-7)
            pricesAsOf={error ? rows.reduce<string | null>((m, r) => (r.as_of && (!m || r.as_of > m) ? r.as_of : m), null) : null} />
          </PullToRefresh>
        )}
        {view.kind === "tab" && view.tab === "news" && (
          <NewsScreen api={api} rows={rows} dispKr={profile?.display_kr ?? "KRW"} uid={session.user.id} pricesDown={!!error}
            intelPending={assess.state.phase === "pending" || assess.state.phase === "slow"}
            onRefreshInsights={refreshInsights} insightsRefreshing={pinsRefreshing} freshInsights={pinsFresh}
            onInsightsSeen={(g) => { seenInsightRef.current = g; setNewsAlert(false); }}
            onRefreshSymbol={refreshSymbol} symbolRefreshing={symRefreshing} symbolFresh={symFresh} />
        )}
        {/* Ask stays mounted so an in-flight answer keeps generating across tabs */}
        <div style={view.kind === "tab" && view.tab === "ask" ? undefined : { display: "none" }}>
          <AskScreen api={api} autoAsk={autoAsk} onAnswered={() => {
            const v = viewRef.current;
            if (!(v.kind === "tab" && v.tab === "ask")) setAskAlert(true);
          }} />
        </div>
        {view.kind === "tab" && view.tab === "settings" && (
          <SettingsScreen api={api} profile={profile} rows={rows} email={session.user.email ?? null} onChanged={load} onSignedOut={() => setView({ kind: "tab", tab: "home" })} />
        )}
      </main>

      <MiniPlayer />

      <nav className="tabbar" aria-label="Tabs">
        {(["home", "news", "ask", "settings"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go({ kind: "tab", tab: t })}>
            <TabIcon tab={t} active={tab === t} />
            {t === "home" ? "Home" : t === "news" ? "News" : t === "ask" ? "Ask" : "Settings"}
            {t === "ask" && askAlert && <span className="tab-alert" aria-label="New answer ready" />}
            {t === "news" && newsAlert && <span className="tab-alert" aria-label="New Assetly Intelligence" />}
            {t === "home" && homeAlert && <span className="tab-alert" aria-label="Your brief is ready" />}
          </button>
        ))}
      </nav>
    </>
  );
}
