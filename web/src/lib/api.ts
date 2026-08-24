// Assetly data layer. Every screen goes through these; integration tests run them
// against the real local Supabase stack, UI tests stub this module.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SymbolRow = { symbol: string; name: string; exchange: string; currency: "USD" | "KRW"; kind: string };
export type Lot = { id: string; holding_id: string; qty: number; cost_per_share: number; acquired_on: string | null; note: string | null };
export type PortfolioRow = {
  holding_id: string; symbol: string; name: string; currency: "USD" | "KRW"; kind: string;
  qty: number | null; cost_basis: number | null; avg_cost: number | null;
  price: number | null; change_pct: number | null; as_of: string | null;
  value: number | null; total_gl: number | null;
};
export type NewsItem = { id: string; symbol: string; title: string; url: string; source: string; published_at: string | null };
export type Profile = { id: string; display_name: string | null; base_currency: "USD" | "KRW"; markets: string[]; onboarded_at: string | null };

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
      const { data, error } = await sb.from("symbols")
        .select("symbol,name,exchange,currency,kind")
        .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
        .eq("active", true).limit(12);
      if (error) throw error;
      return (data ?? []) as SymbolRow[];
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
    async addPosition(symbol: string, qty: number, cost_per_share: number, acquired_on?: string) {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { data: h, error: hErr } = await sb.from("holdings")
        .upsert({ user_id: u.user.id, symbol }, { onConflict: "user_id,symbol" })
        .select("id").single();
      if (hErr) throw hErr;
      const { error: lErr } = await sb.from("lots")
        .insert({ holding_id: h.id, qty, cost_per_share, acquired_on: acquired_on ?? null });
      if (lErr) throw lErr;
      return h.id as string;
    },
    async getLots(holding_id: string): Promise<Lot[]> {
      const { data, error } = await sb.from("lots").select("*")
        .eq("holding_id", holding_id).order("acquired_on", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []).map((l: Record<string, unknown>) => ({ ...l, qty: Number(l.qty), cost_per_share: Number(l.cost_per_share) })) as Lot[];
    },
    async addLot(holding_id: string, qty: number, cost_per_share: number, acquired_on?: string) {
      const { error } = await sb.from("lots").insert({ holding_id, qty, cost_per_share, acquired_on: acquired_on ?? null });
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
    async getNews(symbol?: string): Promise<NewsItem[]> {
      let q = sb.from("news").select("id,symbol,title,url,source,published_at")
        .order("published_at", { ascending: false, nullsFirst: false }).limit(50);
      if (symbol) q = q.eq("symbol", symbol);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NewsItem[];
    },
    async signOut() { await sb.auth.signOut(); },
  };
}

export type Api = ReturnType<typeof makeApi>;
export const api = makeApi();
