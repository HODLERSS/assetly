// Assetly data layer. Every screen goes through these; integration tests run them
// against the real local Supabase stack, UI tests stub this module.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SymbolRow = {
  symbol: string; name: string; exchange: string; currency: "USD" | "KRW"; kind: string;
  yahoo?: string | null;
  remote?: boolean;      // came from the universal search; must be ensured before first use
};
export type Lot = { id: string; holding_id: string; qty: number; cost_per_share: number; acquired_on: string | null; note: string | null };
export type Account = "brokerage" | "bank" | "401k" | "ira" | "crypto";
export type PortfolioRow = {
  holding_id: string; symbol: string; account: Account; nickname: string; name: string; currency: "USD" | "KRW"; kind: string;
  qty: number | null; cost_basis: number | null; avg_cost: number | null;
  price: number | null; change_pct: number | null; as_of: string | null;
  value: number | null; total_gl: number | null;
};
export type HistoryPoint = { ts: string; price: number };
export type Insight = {
  bullets: string[]; windows: Record<string, string> | null; model: string; generated_at: string;
};
export type NewsItem = { id: string; symbol: string; title: string; url: string; source: string; published_at: string | null };
export type Profile = { id: string; display_name: string | null; base_currency: "USD" | "KRW"; display_us: "USD" | "KRW"; display_kr: "USD" | "KRW"; markets: string[]; onboarded_at: string | null };

const nm = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function makeApi(sb: SupabaseClient = supabase) {
  return {
    async getProfile(): Promise<Profile | null> {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await sb.from("profiles").select("*").eq("id", u.user.id).single();
      if (error) throw error;
      return data as Profile;
    },
    async completeOnboarding(markets: string[], base_currency: "USD" | "KRW") {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { error } = await sb.from("profiles")
        .update({ markets, base_currency, onboarded_at: new Date().toISOString() })
        .eq("id", u.user.id);
      if (error) throw error;
    },
    async searchSymbols(q: string): Promise<SymbolRow[]> {
      // Instant hits from the local catalog...
      const { data, error } = await sb.from("symbols")
        .select("symbol,name,exchange,currency,kind,yahoo")
        .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
        .eq("active", true).limit(12);
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
      const seen = new Set(local.map((r) => r.symbol));
      return [...local, ...remote.filter((r) => !seen.has(r.symbol))].slice(0, 12);
    },
    async ensureSymbol(row: SymbolRow): Promise<void> {
      // Always ensure — also for catalog hits: it verifies the ticker, refreshes the price,
      // and guarantees the 5Y daily-close backfill exists before the user lands on the chart.
      const { data, error } = await sb.functions.invoke("symbol-search", {
        body: { ensure: { symbol: row.symbol, name: row.name, exchange: row.exchange,
                          currency: row.currency, kind: row.kind, yahoo: row.yahoo ?? row.symbol } },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error ?? `Could not add ${row.symbol} right now. Try again.`);
      }
    },
    async getPortfolio(): Promise<PortfolioRow[]> {
      const { data, error } = await sb.from("portfolio").select("*").order("value", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        qty: nm(r.qty), cost_basis: nm(r.cost_basis), avg_cost: nm(r.avg_cost),
        price: nm(r.price), change_pct: nm(r.change_pct), value: nm(r.value), total_gl: nm(r.total_gl),
      })) as PortfolioRow[];
    },
    async addPosition(symbol: string, qty: number, cost_per_share: number, acquired_on?: string, account: Account = "brokerage", nickname = "", note = "") {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { data: h, error: hErr } = await sb.from("holdings")
        .upsert({ user_id: u.user.id, symbol, account, nickname }, { onConflict: "user_id,symbol,account,nickname" })
        .select("id").single();
      if (hErr) throw hErr;
      const { error: lErr } = await sb.from("lots")
        .insert({ holding_id: h.id, qty, cost_per_share, acquired_on: acquired_on ?? null, note: note || null });
      if (lErr) {
        // never leave an empty holding behind when the lot is rejected (qty<=0, cost<0)
        const { count } = await sb.from("lots").select("id", { count: "exact", head: true }).eq("holding_id", h.id);
        if (!count) await sb.from("holdings").delete().eq("id", h.id);
        throw lErr;
      }
      return h.id as string;
    },
    async getLots(holding_id: string): Promise<Lot[]> {
      const { data, error } = await sb.from("lots").select("*")
        .eq("holding_id", holding_id).order("acquired_on", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []).map((l: Record<string, unknown>) => ({ ...l, qty: Number(l.qty), cost_per_share: Number(l.cost_per_share) })) as Lot[];
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
    async removeHolding(holding_id: string) {
      const { error } = await sb.from("holdings").delete().eq("id", holding_id);
      if (error) throw error;
    },
    async getHistory(symbol: string, sinceHours: number): Promise<HistoryPoint[]> {
      const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
      const { data, error } = await sb.from("price_history")
        .select("ts,price").eq("symbol", symbol).gte("ts", since)
        .order("ts", { ascending: true }).limit(2000);
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({ ts: String(r.ts), price: Number(r.price) }));
    },
    async updateBaseCurrency(base_currency: "USD" | "KRW") {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { error } = await sb.from("profiles").update({ base_currency }).eq("id", u.user.id);
      if (error) throw error;
    },
    /** Per-market display currency (US assets / KR assets), each USD or KRW. */
    async updateDisplayCcy(patch: Partial<{ display_us: "USD" | "KRW"; display_kr: "USD" | "KRW" }>) {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { error } = await sb.from("profiles").update(patch).eq("id", u.user.id);
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
    /** Rate + freshness for the Settings surface. */
    async getFxInfo(): Promise<{ rate: number; asOf: string } | null> {
      const { data } = await sb.from("prices").select("price,updated_at").eq("symbol", "USDKRW").maybeSingle();
      const rate = data ? Number(data.price) : NaN;
      return Number.isFinite(rate) && rate > 0 ? { rate, asOf: String(data!.updated_at) } : null;
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
      const { data } = await sb.from("portfolio_insights").select("bullets,model,generated_at")
        .order("generated_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return null;
      return { bullets: (data.bullets as string[]) ?? [], windows: null, model: data.model, generated_at: String(data.generated_at) };
    },
    async getNews(scope?: string | string[]): Promise<NewsItem[]> {
      let q = sb.from("news").select("id,symbol,title,url,source,published_at")
        .order("published_at", { ascending: false, nullsFirst: false }).limit(50);
      if (typeof scope === "string") q = q.eq("symbol", scope);
      else if (Array.isArray(scope)) { if (scope.length === 0) return []; q = q.in("symbol", scope); }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NewsItem[];
    },
    /** ASK: grounded portfolio Q&A. Returns the analyst answer text. */
    async ask(question: string): Promise<string> {
      const { data, error } = await sb.functions.invoke("ask", { body: { question } });
      if (error || !data?.ok) throw new Error(data?.error ?? "Ask is unavailable right now.");
      return String(data.answer);
    },
    async signOut() { await sb.auth.signOut(); },
  };
}

export type Api = ReturnType<typeof makeApi>;
export const api = makeApi();
