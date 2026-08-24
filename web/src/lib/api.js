import { supabase } from "./supabase";
const nm = (v) => (v === null || v === undefined ? null : Number(v));
export function makeApi(sb = supabase) {
    return {
        async getProfile() {
            const { data: u } = await sb.auth.getUser();
            if (!u.user)
                return null;
            const { data, error } = await sb.from("profiles").select("*").eq("id", u.user.id).single();
            if (error)
                throw error;
            return data;
        },
        async completeOnboarding(markets, base_currency) {
            const { data: u } = await sb.auth.getUser();
            if (!u.user)
                throw new Error("not signed in");
            const { error } = await sb.from("profiles")
                .update({ markets, base_currency, onboarded_at: new Date().toISOString() })
                .eq("id", u.user.id);
            if (error)
                throw error;
        },
        async searchSymbols(q) {
            const { data, error } = await sb.from("symbols")
                .select("symbol,name,exchange,currency,kind")
                .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
                .eq("active", true).limit(12);
            if (error)
                throw error;
            return (data ?? []);
        },
        async getPortfolio() {
            const { data, error } = await sb.from("portfolio").select("*").order("value", { ascending: false, nullsFirst: false });
            if (error)
                throw error;
            return (data ?? []).map((r) => ({
                ...r,
                qty: nm(r.qty), cost_basis: nm(r.cost_basis), avg_cost: nm(r.avg_cost),
                price: nm(r.price), change_pct: nm(r.change_pct), value: nm(r.value), total_gl: nm(r.total_gl),
            }));
        },
        async addPosition(symbol, qty, cost_per_share, acquired_on) {
            const { data: u } = await sb.auth.getUser();
            if (!u.user)
                throw new Error("not signed in");
            const { data: h, error: hErr } = await sb.from("holdings")
                .upsert({ user_id: u.user.id, symbol }, { onConflict: "user_id,symbol" })
                .select("id").single();
            if (hErr)
                throw hErr;
            const { error: lErr } = await sb.from("lots")
                .insert({ holding_id: h.id, qty, cost_per_share, acquired_on: acquired_on ?? null });
            if (lErr)
                throw lErr;
            return h.id;
        },
        async getLots(holding_id) {
            const { data, error } = await sb.from("lots").select("*")
                .eq("holding_id", holding_id).order("acquired_on", { ascending: true, nullsFirst: true });
            if (error)
                throw error;
            return (data ?? []).map((l) => ({ ...l, qty: Number(l.qty), cost_per_share: Number(l.cost_per_share) }));
        },
        async addLot(holding_id, qty, cost_per_share, acquired_on) {
            const { error } = await sb.from("lots").insert({ holding_id, qty, cost_per_share, acquired_on: acquired_on ?? null });
            if (error)
                throw error;
        },
        async updateLot(id, patch) {
            const { error } = await sb.from("lots").update(patch).eq("id", id);
            if (error)
                throw error;
        },
        async deleteLot(id) {
            const { error } = await sb.from("lots").delete().eq("id", id);
            if (error)
                throw error;
        },
        async removeHolding(holding_id) {
            const { error } = await sb.from("holdings").delete().eq("id", holding_id);
            if (error)
                throw error;
        },
        async getNews(symbol) {
            let q = sb.from("news").select("id,symbol,title,url,source,published_at")
                .order("published_at", { ascending: false, nullsFirst: false }).limit(50);
            if (symbol)
                q = q.eq("symbol", symbol);
            const { data, error } = await q;
            if (error)
                throw error;
            return (data ?? []);
        },
        async signOut() { await sb.auth.signOut(); },
    };
}
export const api = makeApi();
