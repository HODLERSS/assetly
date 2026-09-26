// Assetly data layer. Every screen goes through these; integration tests run them
// against the real local Supabase stack, UI tests stub this module.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { canonicalSymbol, cleanListingName, mergeListings, rankSymbols, searchQuery } from "./search";
import { cleanNews } from "./news";
import { FAIL_FAST_MS, failFast, OfflineError, offlineNow } from "./net";

export type SymbolRow = {
  symbol: string; name: string; exchange: string; currency: string; kind: string;
  yahoo?: string | null;
  remote?: boolean;      // came from the universal search; must be ensured before first use
};
export type Lot = { id: string; holding_id: string; qty: number; cost_per_share: number; acquired_on: string | null; note: string | null };
export type Account = "brokerage" | "bank" | "401k" | "ira" | "crypto";
export type PortfolioRow = {
  holding_id: string; symbol: string; account: Account; nickname: string; name: string; name_kr?: string | null; currency: string; kind: string;
  qty: number | null; cost_basis: number | null; avg_cost: number | null;
  price: number | null; change_pct: number | null; as_of: string | null;
  value: number | null; total_gl: number | null;
  source?: string | null;
  account_label?: string | null;
  /** client-side: the day's move in the row's currency when a lot was bought in the session (withSameDayLots) */
  day_change?: number;
};
export type HistoryPoint = { ts: string; price: number };
export type Quote = { price: number; asOf: string | null };
export type Insight = {
  bullets: string[]; windows: Record<string, string> | null; news5?: string[] | null; model: string; generated_at: string;
  /** portfolio card only (migration 38; absent on older rows): the holdings each bullet is about, and the book it was written for */
  bullet_symbols?: string[][] | null; news5_symbols?: string[][] | null; held_symbols?: string[] | null;
  /** the outlet each news5 line quotes, when the server attributes it (null where it doesn't) */
  news5_sources?: (string | null)[] | null;
};

// Where an edition sits in the session it belongs to: the later in the day, the higher. A row's generated_at is
// NOT its place: a Morning regenerated at 7:28 PM ET outranked the 4:05 PM Close by time and pushed it off Home,
// so the chips read [Assessment, Morning] and the Close was unreachable (r9 native, MAJOR).
const EDITION_RANK: Record<string, number> = { close: 6, midday: 5, morning: 4, weekend: 3, kr_close: 2, kr_open: 1 };
const ASSESSMENT_FRESH_MS = 14 * 86400000;

/**
 * The briefs Home shows: every edition of the latest brief date (one row per edition, its newest), in session
 * order (morning, midday, close), plus the Portfolio Assessment when it is recent, first. The card opens on the
 * last one, the edition furthest into its session; the rest are chips. Two at most hid the Midday when three
 * editions existed (r10 native m3). Only a first assessment, with no edition yet, stands alone.
 */
export function pickHomeBriefs(daily: DailyBrief[], assessment: DailyBrief | null, now: number = Date.now()): DailyBrief[] {
  const day = daily.reduce<string | null>((m, b) => (m === null || b.brief_date > m ? b.brief_date : m), null);
  const byEdition = new Map<string, DailyBrief>();
  for (const b of daily) {
    if (b.brief_date !== day) continue;
    const had = byEdition.get(b.edition);
    if (!had || b.generated_at > had.generated_at) byEdition.set(b.edition, b);
  }
  const ranked = [...byEdition.values()].sort((x, y) => (EDITION_RANK[y.edition] ?? 0) - (EDITION_RANK[x.edition] ?? 0) || (y.generated_at > x.generated_at ? 1 : -1));
  const top = ranked[0];
  const fresh = assessment && now - Date.parse(assessment.generated_at) < ASSESSMENT_FRESH_MS ? assessment : null;
  if (!top) return fresh ? [fresh] : [];
  // the edition leads (the card opens on the last one); the assessment is a chip beside it. Ordering by write
  // time opened Home on an evening re-run assessment (after an add or remove) until the next Morning (r10
  // power-user). Only the FIRST assessment, with no edition yet, is the card on its own (the branch above).
  const editions = [...ranked].reverse();   // ascending: the top-ranked edition last
  return fresh ? [fresh, ...editions] : editions;
}

/** A headline line with its trailing "…" / "..." cut: a clipped title reads as a sentence that stops. */
export const cleanHeadline = (s: string): string => s.replace(/\s*(?:…|\.{3})\s*$/u, "").trim();

/**
 * news5 as the client shows it. The server is moving to attributed headlines (r9 designer M-1); until its field
 * names are settled this takes either shape: a plain string, or an object with the line under
 * text/title/headline/line and the outlet under source/publisher/outlet. Anything else is dropped.
 */
export function newsLines(raw: unknown): { news5: string[] | null; news5_sources: (string | null)[] | null } {
  if (!Array.isArray(raw)) return { news5: null, news5_sources: null };
  const news5: string[] = [], src: (string | null)[] = [];
  for (const it of raw) {
    let text: unknown = it, source: unknown = null;
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      text = o.text ?? o.title ?? o.headline ?? o.line;
      source = o.source ?? o.publisher ?? o.outlet ?? null;
    }
    if (typeof text !== "string" || !cleanHeadline(text)) continue;
    news5.push(cleanHeadline(text));
    src.push(typeof source === "string" && source.trim() ? source.trim() : null);
  }
  return { news5, news5_sources: src.some(Boolean) ? src : null };
}
/** One earlier Ask exchange: the question and the answer the user saw. */
export type AskTurn = { q: string; a: string };
export type NewsItem ={ id: string; symbol: string; title: string; url: string; source: string; published_at: string | null; summary?: string | null };
export type BriefSections = {
  lede: string; overnight: string;
  positions: { name: string; note: string; watch: string }[];
  desk_view: string; calendar: string[];
  horizon?: string; ideas?: string[];   // assessment only: "Next 3 months: ... Next 3 years: ..." + gaps worth researching
  // What the brief was written against (daily-brief, 2026-09-25; absent on older rows). The client never
  // presents a brief as current when the book has since moved the other way.
  as_of?: string;                       // when the prices were read
  day_sign?: -1 | 0 | 1;                // the book's day move at write time (0 under 0.05%)
  day_pct?: number;
  held?: string[];                      // the holdings the brief was written for
};
export type BriefEdition = "morning" | "midday" | "close" | "assessment" | "weekend" | "kr_open" | "kr_close";
export type DailyBrief = { brief_date: string; edition: BriefEdition; sections: BriefSections; generated_at: string; audio_path?: string | null; script?: string | null };
/** Five tap-only answers from sign-up (or Settings). null/missing = the defaults below. */
export type Investor = { styles: string[]; purpose: string[]; horizon: string[]; target: string[]; risk: string[]; level: string[];
  /** the questions the reader never answered (skipped): their values are defaults, and the server never
   *  presents them as the reader's own ("its 8-12% annual return goal" for someone who skipped; r2 newcomer) */
  defaulted?: string[] };
export const INVESTOR_DEFAULT: Investor = { styles: ["value"], purpose: ["watch"], horizon: ["3-10y"], target: ["8-12%"], risk: ["hold"], level: ["novice"] };
export type Profile = { id: string; display_name: string | null; base_currency: "USD" | "KRW"; display_us: "USD" | "KRW"; display_kr: "USD" | "KRW"; markets: string[]; onboarded_at: string | null; investor?: Investor | null };

const ASK_TIMEOUT_MS = 60_000;
const nm = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const warmupFired = new Set<string>();

/** Settle with `fallback` rather than hang forever. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

/** The signed-in user's id, without a network round trip when we can avoid one.
 *  `auth.getUser()` calls /auth/v1/user, and after the app has been backgrounded — a brokerage OAuth
 *  in the system browser can take minutes — the access token is often expired, so that call waits on a
 *  token refresh that can deadlock in the GoTrue client. Every write path opened with it, so one stuck
 *  refresh froze the UI with no way out: App Review hit exactly that on the setup screen (Guideline
 *  2.1(a), 2026-09-21). The cached session answers instantly, and the timeouts mean the worst case is
 *  an error the user can retry rather than a frozen screen. */
async function currentUserId(sb: SupabaseClient): Promise<string | null> {
  const local = await withTimeout(sb.auth.getSession(), 4000, null);
  const fromSession = local?.data?.session?.user?.id ?? null;
  if (fromSession) return fromSession;
  const remote = await withTimeout(sb.auth.getUser(), 8000, null);
  return remote?.data?.user?.id ?? null;
}

/** Aborts when any of the signals does (AbortSignal.any is Safari 17.4+). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (live.length <= 1) return live[0];
  const c = new AbortController();
  for (const s of live) {
    if (s.aborted) { c.abort(s.reason); break; }
    s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}
/** A read tuned to what the app knows about the connection (lib/net). After a failed price refresh it is sent
 *  once, without postgrest-js's three retries (1s, 2s, 4s: "Loading lots…" held ~7s; r5 designer m-3), and a
 *  request that hangs gives up after FAIL_FAST_MS. `limit` says when the time limit applies: "fast" only while
 *  the connection is known to be bad, "always" for a chart page (an online but hung RPC left ETH 2Y a skeleton
 *  for 25s+ with no Retry; r6 power-user m2), "never" for the book's own load, which has its own time limit.
 *  `signal` cancels it: a chart range the reader has already left. A builder without these knobs (a test
 *  double) passes through unchanged. */
function tuned<Q>(q: Q, signal?: AbortSignal, limit: "fast" | "always" | "never" = "fast"): Q {
  const b = q as unknown as { retry?: (on: boolean) => unknown; abortSignal?: (s: AbortSignal) => unknown };
  const fast = failFast();
  if (fast && typeof b.retry === "function") b.retry(false);
  if (typeof b.abortSignal === "function") {
    let timer: AbortSignal | undefined;
    if (limit === "always" || (fast && limit === "fast")) {
      const c = new AbortController(); setTimeout(() => c.abort(new Error("timed out")), FAIL_FAST_MS); timer = c.signal;
    }
    const s = anySignal([signal, timer]);
    if (s) b.abortSignal(s);
  }
  return q;
}
/** Offline, a read is refused before it is sent: the screen says so at once, with what it kept. */
function online() { if (offlineNow()) throw new OfflineError(); }

type HistoryPage = PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>;
const HISTORY_PAGE = 1000;
const HISTORY_RAW_PAGES = 8, HISTORY_RAW_DAILY_PAGES = 16, HISTORY_RPC_PAGES = 6;
/** Page a newest-first query until a short page, then return the points oldest first. Reaching the cap is
 *  said out loud (console) instead of silently drawing a shorter range. After the first page, `wave` pages go
 *  out together: a coin's hourly week is ~10 pages, and ten round trips one after another took seconds. */
async function pageNewestFirst(page: (from: number, to: number) => HistoryPage, maxPages: number, symbol: string, wave = 1): Promise<HistoryPoint[]> {
  const rows: Record<string, unknown>[] = [];
  const done = () => rows.reverse().map((r) => ({ ts: String(r.ts), price: Number(r.price) }));
  for (let p = 0; p < maxPages;) {
    const n = p === 0 ? 1 : Math.max(1, Math.min(wave, maxPages - p));
    const got = await Promise.all(Array.from({ length: n }, (_, k) => page((p + k) * HISTORY_PAGE, (p + k) * HISTORY_PAGE + HISTORY_PAGE - 1)));
    for (const { error } of got) if (error) throw error;
    for (const { data } of got) {
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < HISTORY_PAGE) return done();   // a short page is the end; any after it are empty
    }
    p += n;
  }
  console.warn(`price history for ${symbol} hit the ${maxPages}-page cap; its oldest points are missing`);
  return done();
}
/** PostgREST's "no such function" (PGRST202) or Postgres' undefined_function (42883). */
export const rpcMissing = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "PGRST202" || code === "42883";
};

export function makeApi(sb: SupabaseClient = supabase) {
  let seriesRpcMissing = false;
  return {
    async getProfile(): Promise<Profile | null> {
      const uid = await currentUserId(sb);
      if (!uid) return null;
      const { data, error } = await sb.from("profiles").select("*").eq("id", uid).single();
      if (error) throw error;
      return data as Profile;
    },
    async completeOnboarding(markets: string[], base_currency: "USD" | "KRW", investor?: Investor | null) {
      const uid = await currentUserId(sb);
      if (!uid) throw new Error("Could not confirm your session. Check your connection and try again.");
      const { error } = await sb.from("profiles")
        .update({ markets, base_currency, onboarded_at: new Date().toISOString(), ...(investor !== undefined ? { investor } : {}) })
        .eq("id", uid);
      if (error) throw error;
    },
    /** Investor profile (the 5 quiz answers): editable any time from Settings. */
    async updateInvestor(investor: Investor) {
      const uid = await currentUserId(sb);
      if (!uid) throw new Error("Could not confirm your session. Check your connection and try again.");
      const { error } = await sb.from("profiles").update({ investor }).eq("id", uid);
      if (error) throw error;
    },
    async searchSymbols(raw: string, preferCcy = "USD"): Promise<SymbolRow[]> {
      const q = searchQuery(raw);   // "nvidea" -> "nvidia"
      // Instant hits from the local catalog... (PostgREST's or() is comma- and paren-delimited: keep them out)
      const like = q.replace(/[,()*%\\]/g, " ").trim();
      const { data, error } = await sb.from("symbols")
        .select("symbol,name,exchange,currency,kind,yahoo")
        .or(`symbol.ilike.%${like}%,name.ilike.%${like}%`)
        .eq("active", true).limit(24);
      if (error) throw error;
      const local = (data ?? []) as SymbolRow[];
      // ...merged with the universal search (every US + Korean listing, via Yahoo Finance).
      let remote: SymbolRow[] = [];
      try {
        const { data: fx, error: fErr } = await sb.functions.invoke("symbol-search", { body: { q } });
        if (!fErr && fx?.ok) {
          remote = (fx.results as SymbolRow[]).map((r) => ({ ...r, remote: true }));
        }
      } catch { /* search still works from the catalog when the function is unreachable */ }
      // one row per listing, class-share aliases folded into the dotted symbol (lib/search mergeListings); rank
      // the merged list BEFORE the cut, so an exact ticker from the remote search is never sliced off
      return rankSymbols(raw, mergeListings(local, remote), preferCcy).slice(0, 12);
    },
    /** Verifies and registers a listing; returns the symbol it is registered under (the canonical one: a pick of
     *  "BRKB" is held as BRK.B, r10 newcomer M3). */
    async ensureSymbol(row: SymbolRow): Promise<string> {
      // Always ensure — also for catalog hits: it verifies the ticker, refreshes the price,
      // and guarantees the 5Y daily-close backfill exists before the user lands on the chart.
      const canon = canonicalSymbol(row.symbol, row.yahoo);
      const { data, error } = await sb.functions.invoke("symbol-search", {
        body: { ensure: { symbol: canon, name: cleanListingName(row.name), exchange: row.exchange,
                          currency: row.currency, kind: row.kind, yahoo: row.yahoo ?? row.symbol } },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error ?? `Could not add ${row.symbol} right now. Try again.`);
      }
      const back = (data.symbol as { symbol?: unknown } | undefined)?.symbol;
      return typeof back === "string" && back ? back : canon;
    },
    async getPortfolio(): Promise<PortfolioRow[]> {
      online();   // offline, a pull to refresh says so at once instead of spinning out the load's time limit
      const { data, error } = await tuned(sb.from("portfolio").select("*").order("value", { ascending: false, nullsFirst: false }), undefined, "never");
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        qty: nm(r.qty), cost_basis: nm(r.cost_basis), avg_cost: nm(r.avg_cost),
        price: nm(r.price), change_pct: nm(r.change_pct), value: nm(r.value), total_gl: nm(r.total_gl),
      })) as PortfolioRow[];
    },
    async addPosition(symbol: string, qty: number, cost_per_share: number, acquired_on?: string, account: Account = "brokerage", nickname = "", note = "") {
      const uid = await currentUserId(sb);
      if (!uid) throw new Error("Could not confirm your session. Check your connection and try again.");
      const { data: h, error: hErr } = await sb.from("holdings")
        .upsert({ user_id: uid, symbol, account, nickname }, { onConflict: "user_id,symbol,account,nickname" })
        .select("id").single();
      if (hErr) throw hErr;
      const { data: l, error: lErr } = await sb.from("lots")
        .insert({ holding_id: h.id, qty, cost_per_share, acquired_on: acquired_on ?? null, note: note || null })
        .select("id").single();
      if (lErr) {
        // never leave an empty holding behind when the lot is rejected (qty<=0, cost<0)
        const { count } = await sb.from("lots").select("id", { count: "exact", head: true }).eq("holding_id", h.id);
        if (!count) await sb.from("holdings").delete().eq("id", h.id);
        throw lErr;
      }
      // the lot as written, so the position screen can show it without a round trip (lib/lotsCache seedLots)
      const lot: Lot = { id: String((l as { id?: unknown } | null)?.id ?? ""), holding_id: h.id as string, qty, cost_per_share, acquired_on: acquired_on ?? null, note: note || null };
      return { holdingId: h.id as string, lot: lot.id ? lot : null };
    },
    async getLots(holding_id: string): Promise<Lot[]> {
      online();
      const { data, error } = await tuned(sb.from("lots").select("*")
        .eq("holding_id", holding_id).order("acquired_on", { ascending: true, nullsFirst: true })
        // undated lots (and lots bought the same day) tie on acquired_on: entry order keeps them from swapping
        // places on every reload (r4 native m2)
        .order("created_at", { ascending: true }).order("id", { ascending: true }));
      if (error) throw error;
      return (data ?? []).map((l: Record<string, unknown>) => ({ ...l, qty: Number(l.qty), cost_per_share: Number(l.cost_per_share) })) as Lot[];
    },
    /** The book's lots dated in the last ten days (a KRX holiday run is up to a week), across holdings: a lot
     *  bought in the session moves from its cost, not the prior close (withSameDayLots in lib/portfolio). One
     *  small read beside the book's. */
    async getRecentLots(): Promise<Pick<Lot, "holding_id" | "qty" | "cost_per_share" | "acquired_on">[]> {
      online();
      const since = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
      const { data, error } = await tuned(sb.from("lots").select("holding_id,qty,cost_per_share,acquired_on").gte("acquired_on", since).limit(500));
      if (error) throw error;
      return (data ?? []).map((l: Record<string, unknown>) => ({
        holding_id: String(l.holding_id), qty: Number(l.qty), cost_per_share: Number(l.cost_per_share), acquired_on: l.acquired_on ? String(l.acquired_on) : null,
      }));
    },
    async addLot(holding_id: string, qty: number, cost_per_share: number, acquired_on?: string, note = "") {
      const { error } = await sb.from("lots").insert({ holding_id, qty, cost_per_share, acquired_on: acquired_on ?? null, note: note || null });
      if (error) throw error;
    },
    async updateLot(id: string, patch: Partial<Pick<Lot, "qty" | "cost_per_share" | "acquired_on" | "note">>) {
      const { error } = await sb.from("lots").update(patch).eq("id", id);
      if (error) throw error;
    },
    async deleteLot(id: string) {
      const { error } = await sb.from("lots").delete().eq("id", id);
      if (error) throw error;
    },
    /** Move a position to another account. When that account already holds the same symbol (and label),
     *  the two are one position: this one's lots fold into it and its id is returned instead. That case is
     *  looked up first: the plain move used to go out regardless, 409 on the unique key, and only then fold
     *  (r5 power-user). The unique key still catches a position added there in between. */
    async setHoldingAccount(holding_id: string, account: Account): Promise<string> {
      const { data: cur, error: e1 } = await sb.from("holdings").select("user_id,symbol,nickname").eq("id", holding_id).single();
      if (e1) throw e1;
      const findTarget = () => sb.from("holdings").select("id,source")
        .eq("user_id", cur.user_id).eq("symbol", cur.symbol).eq("account", account).eq("nickname", cur.nickname).maybeSingle();
      let { data: target, error: e2 } = await findTarget();
      if (e2) throw e2;
      if (!target) {
        const { error } = await sb.from("holdings").update({ account }).eq("id", holding_id);
        if (!error) return holding_id;
        if (error.code !== "23505") throw error;   // anything but the (user, symbol, account, nickname) unique key
        ({ data: target, error: e2 } = await findTarget());
        if (e2) throw e2;
        if (!target) throw error;
      }
      // a synced holding's lots are rewritten by every sync: manual lots folded into it would vanish
      if (target.source === "snaptrade") throw new Error(`${cur.symbol} is already synced from your brokerage in that account.`);
      const { error: e3 } = await sb.from("lots").update({ holding_id: target.id }).eq("holding_id", holding_id);
      if (e3) throw e3;
      const { error: e4 } = await sb.from("holdings").delete().eq("id", holding_id);
      if (e4) throw e4;
      return String(target.id);
    },
    async removeHolding(holding_id: string) {
      const { error } = await sb.from("holdings").delete().eq("id", holding_id);
      if (error) throw error;
    },
    /** A symbol's price history from `sinceHours` ago, oldest first, ending at the newest print.
     *  `daily`: the long ranges (1W and up). The server folds everything older than `recentHours` into one
     *  close per trading day in `tz` (price_history_series, migration 41); without it, raw prints are paged.
     *  `maxPages`/`wave` let a deep recent window (a coin's hourly week) page further, several pages at a time.
     *  `signal` cancels the read (the reader switched range). */
    async getHistory(symbol: string, sinceHours: number, daily?: { tz: string; recentHours?: number; maxPages?: number; wave?: number },
      opts: { signal?: AbortSignal } = {}): Promise<HistoryPoint[]> {
      online();
      const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
      if (daily && !seriesRpcMissing) {
        const dailyBefore = new Date(Date.now() - (daily.recentHours ?? 48) * 3600 * 1000).toISOString();
        try {
          return await pageNewestFirst((from, to) => tuned(sb.rpc("price_history_series", { p_symbol: symbol, p_since: since, p_daily_before: dailyBefore, p_tz: daily.tz })
            .order("ts", { ascending: false }).range(from, to), opts.signal, "always"), daily.maxPages ?? HISTORY_RPC_PAGES, symbol, daily.wave);
        } catch (e) {
          if (!rpcMissing(e)) throw e;
          seriesRpcMissing = true;   // not applied on this backend yet: page raw prints for the rest of the session
        }
      }
      // PostgREST caps a response at 1000 rows. Ascending + a bigger limit silently returned the OLDEST 1000, so
      // every range ended days early (r3). Newest-first pages always end at the latest print. A coin keeps ~10k
      // minute prints for its last 7 days (the prune keeps one row a day only past that), so a long range needs
      // a higher cap than 1D: the 8-page cap cut BTC's 1Y to its last 5 days (r4 power-user M1).
      return pageNewestFirst((from, to) => tuned(sb.from("price_history")
        .select("ts,price").eq("symbol", symbol).gte("ts", since)
        .order("ts", { ascending: false }).range(from, to), opts.signal, "always"), daily ? HISTORY_RAW_DAILY_PAGES : HISTORY_RAW_PAGES, symbol, daily?.wave);
    },
    async updateBaseCurrency(base_currency: "USD" | "KRW") {
      const uid = await currentUserId(sb);
      if (!uid) throw new Error("Could not confirm your session. Check your connection and try again.");
      const { error } = await sb.from("profiles").update({ base_currency }).eq("id", uid);
      if (error) throw error;
    },
    /** Per-market display currency (US assets / KR assets), each USD or KRW. */
    async updateDisplayCcy(patch: Partial<{ display_us: "USD" | "KRW"; display_kr: "USD" | "KRW" }>) {
      const uid = await currentUserId(sb);
      if (!uid) throw new Error("Could not confirm your session. Check your connection and try again.");
      const { error } = await sb.from("profiles").update(patch).eq("id", uid);
      if (error) throw error;
    },
    /** Pre-open pulse: US index futures tracked by the 1-min price pipeline. */
    async getPulse(): Promise<{ symbol: string; name: string; price: number; change_pct: number | null }[]> {
      const names: Record<string, string> = { "ES=F": "S&P 500 futures", "NQ=F": "Nasdaq 100 futures" };
      const { data } = await sb.from("prices").select("symbol,price,change_pct").in("symbol", ["ES=F", "NQ=F"]);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        symbol: String(r.symbol), name: names[String(r.symbol)] ?? String(r.symbol),
        price: Number(r.price), change_pct: r.change_pct === null ? null : Number(r.change_pct),
      })).sort((a, b) => a.symbol.localeCompare(b.symbol));
    },
    /** The latest tracked price of one symbol and when it printed (a closed market's is its last close), or null
     *  when the pipeline has none yet (a symbol not yet tracked). */
    async getQuote(symbol: string): Promise<Quote | null> {
      const { data } = await sb.from("prices").select("price,as_of").eq("symbol", symbol).maybeSingle();
      const v = data ? Number(data.price) : NaN;
      return Number.isFinite(v) && v > 0 ? { price: v, asOf: data?.as_of ? String(data.as_of) : null } : null;
    },
    /** Rate + freshness for the Settings surface. */
    async getFxInfo(): Promise<{ rate: number; asOf: string } | null> {
      const { data } = await sb.from("prices").select("price,updated_at").eq("symbol", "USDKRW").maybeSingle();
      const rate = data ? Number(data.price) : NaN;
      return Number.isFinite(rate) && rate > 0 ? { rate, asOf: String(data!.updated_at) } : null;
    },
    /** Every FX rate the price pipeline maintains (USDxxx rows): units of currency per USD, USD itself = 1. */
    async getFxRates(): Promise<Record<string, number>> {
      const { data } = await sb.from("prices").select("symbol,price").like("symbol", "USD___");
      const out: Record<string, number> = { USD: 1 };
      for (const r of data ?? []) { const v = Number(r.price); if (v > 0) out[String(r.symbol).slice(3)] = v; }
      return out;
    },
    /** Won-per-dollar rate maintained by the price pipeline (symbol USDKRW). */
    async getFxRate(): Promise<number | null> {
      const { data } = await sb.from("prices").select("price").eq("symbol", "USDKRW").maybeSingle();
      const v = data ? Number(data.price) : NaN;
      return Number.isFinite(v) && v > 0 ? v : null;
    },
    /** Instant news pull for just-added symbols; fire-and-forget from the UI. */
    async refreshNews(symbols: string[]): Promise<boolean> {
      if (!symbols.length) return false;
      try {
        const { data, error } = await sb.functions.invoke("news-sync", { body: { symbols } });
        return !error && !!data?.ok;
      } catch { return false; }
    },
    /** Latest AI insight for a symbol (append-only history; newest wins). */
    async getInsights(symbol: string): Promise<Insight | null> {
      const { data } = await sb.from("insights").select("bullets,windows,model,generated_at")
        .eq("symbol", symbol).order("generated_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return null;
      return { bullets: (data.bullets as string[]) ?? [], windows: data.windows as Record<string, string> | null,
               model: data.model, generated_at: String(data.generated_at) };
    },
    /** Latest portfolio-level insight for the signed-in user. */
    async getPortfolioInsights(): Promise<Insight | null> {
      const base = "bullets,news5,model,generated_at";
      const q = (cols: string) => sb.from("portfolio_insights").select(cols)
        .order("generated_at", { ascending: false }).limit(1).maybeSingle();
      // the per-bullet symbols arrive with migration 38; before it, that select errors and the plain one answers
      let { data, error } = await q(`${base},bullet_symbols,news5_symbols,held_symbols`);
      if (error) ({ data } = await q(base));
      const r = data as Record<string, unknown> | null;
      if (!r) return null;
      const tags = (v: unknown) => Array.isArray(v) && v.every(Array.isArray) ? (v as string[][]) : null;
      return { bullets: (r.bullets as string[]) ?? [], windows: null,
               ...newsLines(r.news5),
               model: String(r.model), generated_at: String(r.generated_at),
               bullet_symbols: tags(r.bullet_symbols), news5_symbols: tags(r.news5_symbols),
               held_symbols: Array.isArray(r.held_symbols) ? (r.held_symbols as string[]) : null };
    },
    async getNews(scope?: string | string[]): Promise<NewsItem[]> {
      if (Array.isArray(scope) && scope.length === 0) return [];
      // Rows stored before the server's ingest gate still hold option chains and stories about other companies,
      // so the same gate runs again here (lib/news.ts cleanNews). Over-fetch so a page of 50 survives it.
      const page = (cols: string) => {
        let q = sb.from("news").select(cols).order("published_at", { ascending: false, nullsFirst: false }).limit(150);
        if (typeof scope === "string") q = q.eq("symbol", scope);
        else if (Array.isArray(scope)) q = q.in("symbol", scope);
        return q;
      };
      let { data, error } = await page("id,symbol,title,url,source,summary,published_at");
      if (error) ({ data, error } = await page("id,symbol,title,url,source,published_at"));   // a schema without summary
      if (error) throw error;
      const rows = (data ?? []) as unknown as NewsItem[];
      const syms = [...new Set(rows.map((r) => r.symbol))];
      const { data: cat } = syms.length ? await sb.from("symbols").select("symbol,name,name_kr").in("symbol", syms) : { data: [] };
      const names: Record<string, { name?: string | null; name_kr?: string | null }> = {};
      for (const c of (cat ?? []) as { symbol: string; name: string | null; name_kr: string | null }[]) names[c.symbol] = c;
      return cleanNews(rows, names).slice(0, 50);
    },
    /** First-look intelligence for a just-added symbol; fire-and-forget from the UI.
     *  Deduped per session so the pick-time head start and the post-add call don't double-spend. */
    async warmup(symbol: string): Promise<void> {
      if (warmupFired.has(symbol)) return;
      warmupFired.add(symbol);
      try {
        const { data, error } = await sb.functions.invoke("warmup", { body: { symbol } });
        if (error || !data?.ok) warmupFired.delete(symbol);   // transient model hiccup: the post-add call retries
      } catch { warmupFired.delete(symbol); }
    },
    /** The most recent brief day's editions (morning, midday pulse, closing note) plus the latest
     *  Portfolio Assessment from the last 14 days, oldest first by generation time. */
    async getDailyBriefs(): Promise<DailyBrief[]> {
      type R = { brief_date: string; edition: string | null; sections: unknown; generated_at: string; audio_path: string | null; script: string | null };
      online();   // offline, the saved copy shows at once instead of after the retries (r5 native m4)
      const [{ data: d1, error: e1 }, { data: d2, error: e2 }] = await Promise.all([
        tuned(sb.from("daily_briefs").select("brief_date,edition,sections,generated_at,audio_path,script").neq("edition", "assessment")
          .order("brief_date", { ascending: false }).order("generated_at", { ascending: true }).limit(6)),
        tuned(sb.from("daily_briefs").select("brief_date,edition,sections,generated_at,audio_path,script").eq("edition", "assessment")
          .order("generated_at", { ascending: false }).limit(1)),
      ]);
      // a network failure comes back as { error }, not a rejection: throw it, or the caller saves [] over
      // the copy kept on this device and the offline brief vanishes (r4 designer)
      if (e1 || e2) throw e1 ?? e2;
      const toBrief = (r: R): DailyBrief => ({ brief_date: String(r.brief_date), edition: (r.edition ?? "morning") as BriefEdition,
        sections: r.sections as BriefSections, generated_at: String(r.generated_at),
        audio_path: (r.audio_path as string | null) ?? null, script: (r.script as string | null) ?? null });
      const a = ((d2 ?? []) as R[])[0];
      return pickHomeBriefs(((d1 ?? []) as R[]).map(toBrief), a ? toBrief(a) : null);
    },
    /** Short-lived playback URL for a brief's narration. */
    async getBriefAudioUrl(path: string): Promise<string | null> {
      const { data } = await sb.storage.from("briefs-audio").createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
    /** First brief: fires once after onboarding so read+listen is ready within minutes. */
    async firstBrief(): Promise<void> {
      await sb.functions.invoke("first-brief", { body: {} }).catch(() => null);
    },
    /** Remember this device so a finished brief can be pushed to it. Upsert: iOS reissues tokens. */
    async savePushToken(token: string, platform = "ios"): Promise<void> {
      const uid = await currentUserId(sb);
      if (!uid || !token) return;
      await sb.from("push_tokens").upsert(
        { user_id: uid, token, platform, last_seen_at: new Date().toISOString() },
        { onConflict: "user_id,token" },
      );
    },
    /** The reader turned notifications off: forget every token for this account. */
    async removePushToken(): Promise<void> {
      const uid = await currentUserId(sb);
      if (!uid) return;
      await sb.from("push_tokens").delete().eq("user_id", uid);
    },
    /** Portfolio intelligence: refresh now (force regen for this user), then return the fresh row. */
    async refreshPortfolioInsights(): Promise<Insight | null> {
      const uid = await currentUserId(sb);
      if (!uid) return null;
      // Same pipeline as the hourly lap: pull fresh headlines for every held symbol FIRST, then assess.
      const { data: held } = await sb.from("portfolio").select("symbol, kind").eq("user_id", uid);
      const syms = (held ?? []).map((r) => String(r.symbol)).filter((sy) => !sy.startsWith("$"));
      if (syms.length) await sb.functions.invoke("news-sync", { body: { symbols: syms } }).catch(() => null);
      await sb.functions.invoke("insights-sync", { body: { force: true, user_id: uid } }).catch(() => null);
      return this.getPortfolioInsights();
    },
    /** Per-stock intelligence refresh: fresh news for that symbol FIRST, then its assessment (hourly pipeline, targeted). */
    async refreshSymbolInsights(symbol: string): Promise<Insight | null> {
      await sb.functions.invoke("news-sync", { body: { symbols: [symbol] } }).catch(() => null);
      await sb.functions.invoke("insights-sync", { body: { symbols: [symbol] } }).catch(() => null);
      return this.getInsights(symbol);
    },
    /** SnapTrade: connection status / start connect / disconnect. */
    async snaptrade(action: "status" | "connect" | "disconnect" | "connections" | "remove_connection" | "exclusions" | "restore", extra?: Record<string, unknown>): Promise<{ ok: boolean; connected?: boolean; url?: string; last_sync_at?: string | null; institutions?: string[]; connections?: { id: string; institution: string; disabled: boolean }[]; exclusions?: string[] }> {
      const { data, error } = await sb.functions.invoke("snaptrade-connect", { body: { action, ...(extra ?? {}) } });
      if (error && !data) throw new Error("Brokerage link is unavailable right now.");
      if (data?.full === true) throw new ImportFullError();
      if (!data?.ok && action !== "remove_connection") throw new Error(data?.error ?? "Brokerage link is unavailable right now.");
      return data ?? { ok: false };
    },
    /** Unseen brokerage sync events (positions auto-added later on), oldest first. */
    async snaptradeEvents(): Promise<{ id: number; detail: { added?: string[]; collisions?: string[]; institution?: string; by_institution?: { institution: string; symbols: string[] }[] } }[]> {
      const { data } = await sb.from("snaptrade_events").select("id,detail").eq("seen", false).order("created_at", { ascending: true }).limit(5);
      return (data ?? []) as { id: number; detail: { added?: string[]; collisions?: string[]; institution?: string } }[];
    },
    async snaptradeEventsSeen(ids: number[]): Promise<void> {
      if (ids.length) await sb.from("snaptrade_events").update({ seen: true }).in("id", ids);
    },
    /** Keep a symbol out of future brokerage imports (used when removing an imported position). */
    async excludeImport(symbol: string): Promise<void> {
      const uid = await currentUserId(sb);
      if (uid) await sb.from("snaptrade_exclusions").upsert({ user_id: uid, symbol });
    },
    /** SnapTrade: import holdings now for the signed-in user. */
    async snaptradeSync(): Promise<void> {
      await sb.functions.invoke("snaptrade-sync", { body: {} });
    },
    /** The book-changed moment (brokerage connect, or a run of manual adds): sync -> news -> all intelligence -> Portfolio Assessment. */
    async brokerageConnected(): Promise<void> {
      // It used to swallow every failure while the UI said "on the way": manual-add runs hit a 401 here
      // (a stale access token after the app sat in the background) and the assessment never came. One
      // retry on a freshly refreshed session; if that fails too, the caller shows it and offers Retry.
      const call = async () => {
        const { data, error } = await sb.functions.invoke("brokerage-connected", { body: {} });
        if (error) throw error;
        if (data && typeof data === "object" && "ok" in data && !data.ok) throw new Error(String(data.error ?? "brokerage-connected failed"));
      };
      try { await call(); }
      catch {
        await withTimeout(sb.auth.refreshSession(), 8000, null).catch(() => null);
        try { await call(); }
        catch { throw new Error("We couldn't start your assessment."); }
      }
    },
    /** The book just changed and a run is coming (the client debounces a run of adds): the server marks the
     *  assessment queued now, so an older run can't report "ready" over it. Best effort; nothing waits on it. */
    async markAssessmentPending(): Promise<void> {
      await sb.functions.invoke("brokerage-connected", { body: { pending: true } }).catch(() => null);
    },
    /** Where the Portfolio Assessment stands for a run that started at `since` (ISO).
     *  Today readiness is read off the rows themselves: an assessment edition in daily_briefs newer than
     *  `since`, and the portfolio intelligence that the chain writes first. A server-side status (queued /
     *  failed) plugs in here without the UI changing: map it onto `status`. */
    async getAssessmentStatus(since: string): Promise<{ status: "pending" | "ready" | "failed"; generatedAt: string | null; intelligenceAt: string | null; hadEarlier: boolean }> {
      const [{ data: a }, { data: pi }, { data: st }] = await Promise.all([
        sb.from("daily_briefs").select("generated_at").eq("edition", "assessment").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("portfolio_insights").select("generated_at").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
        // the server's own run record (queued -> running -> ready | failed); absent before migration 34,
        // in which case the rows above are the whole story
        sb.from("assessment_status").select("state,started_at,updated_at").maybeSingle().then((r) => r, () => ({ data: null })),
      ]);
      const at = a?.generated_at ? String(a.generated_at) : null;
      const pit = pi?.generated_at ? String(pi.generated_at) : null;
      const run = st as { state?: string; started_at?: string | null; updated_at?: string } | null;
      // started_at is the server's run id: when a newer run is queued (more adds, a removal, another
      // device), only an assessment written for THAT run counts as ready, never the one before it
      const active = run?.state === "queued" || run?.state === "running";
      const from = active && run?.started_at && +new Date(run.started_at) > +new Date(since) ? run.started_at : since;
      const fresh = (t: string | null) => !!t && +new Date(t) > +new Date(from);
      // a run the server marked failed, or one that stopped reporting 15 min ago, is not coming
      const dead = !!run && fresh(run.updated_at ?? null) && (run.state === "failed"
        || ((run.state === "queued" || run.state === "running") && Date.now() - +new Date(run.updated_at!) > 15 * 60_000));
      return { status: fresh(at) ? "ready" : dead ? "failed" : "pending", generatedAt: fresh(at) ? at : null,
               intelligenceAt: fresh(pit) ? pit : null, hadEarlier: !!at && !fresh(at) };
    },
    /** ASK: grounded portfolio Q&A. Returns the analyst answer plus 2-3 follow-up questions.
     *  `history` = the conversation so far, oldest first (question + the answer shown); only the last three
     *  turns are sent, trimmed, so "why did that happen?" is answered about the previous answer. Optional:
     *  a call without it is a fresh conversation, exactly as before. */
    async ask(question: string, history?: AskTurn[]): Promise<{ answer: string; followups: string[] }> {
      const turns = (history ?? []).filter((t) => t && String(t.q ?? "").trim()).slice(-3)
        .map((t) => ({ q: String(t.q).slice(0, 300), a: String(t.a ?? "").slice(0, 700) }));
      // the function's own budget is ~40s; past 60s the request is lost (a dropped connection can hang
      // without failing), and the screen offers Retry instead of thinking forever
      const { data, error } = await Promise.race([
        sb.functions.invoke("ask", { body: turns.length ? { question, history: turns } : { question } }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Ask timed out.")), ASK_TIMEOUT_MS)),
      ]);
      if (error || !data?.ok) throw new Error(data?.error ?? "Ask is unavailable right now.");
      return { answer: String(data.answer), followups: Array.isArray(data.followups) ? data.followups.map(String).slice(0, 3) : [] };
    },
    /** Apple 5.1.1(v): the account and every row it owns go away from inside the app. */
    async deleteAccount(): Promise<void> {
      const { data, error } = await sb.functions.invoke("delete-account", { body: {} });
      if (error || !data?.ok) throw new Error(data?.error ?? "Could not delete the account. Try again.");
      await sb.auth.signOut().catch(() => {});
    },
    async signOut() { await sb.auth.signOut(); },
  };
}

export type Api = ReturnType<typeof makeApi>;
export const api = makeApi();

/** Early access: brokerage import is at capacity (snaptrade-connect answers {full:true}). An expected product
 *  state, not a failure: callers show it as a neutral note, never the red error (r7 design n-1). */
export const IMPORT_FULL_MSG = "Brokerage import is at capacity during early access. Add your holdings by hand for now: it takes about a minute, and you can connect later.";
export class ImportFullError extends Error {
  readonly full = true;
  constructor() { super(IMPORT_FULL_MSG); this.name = "ImportFullError"; }
}
export function isImportFull(e: unknown): boolean {
  return e instanceof ImportFullError || (typeof e === "object" && e !== null && (e as { full?: unknown }).full === true);
}
