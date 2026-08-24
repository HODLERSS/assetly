// CLOUD battery — runs against the production Supabase project with two auto-confirmed fixture
// users (created in the dashboard). No privileged key involved: publishable key + password grant.
// Skipped unless ASSETLY_CLOUD=1 so the default suite stays local/offline-safe.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";

const URL_ = process.env.ASSETLY_URL ?? "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const KEY = process.env.ASSETLY_KEY ?? "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const PW = process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026";
const run = process.env.ASSETLY_CLOUD === "1" ? describe : describe.skip;

async function login(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}

let alice: SupabaseClient, bob: SupabaseClient;

run("CLOUD e2e — production project", () => {
  beforeAll(async () => {
    alice = await login("e2e-cloud@assetly.test");
    bob = await login("e2e-cloud-bob@assetly.test");
    // clean slate for repeatable runs
    for (const c of [alice, bob]) {
      const rows = await makeApi(c).getPortfolio();
      for (const r of rows) await makeApi(c).removeHolding(r.holding_id);
    }
  }, 40000);

  it("C1 sign-in works and the profile trigger fired in the cloud", async () => {
    const p = await makeApi(alice).getProfile();
    expect(p?.id).toBeTruthy();
    expect(p?.base_currency).toBe("USD");
  });

  it("C2 onboarding completes", async () => {
    await makeApi(alice).completeOnboarding(["US", "KR", "Crypto"], "USD");
    const p = await makeApi(alice).getProfile();
    expect(p?.onboarded_at).not.toBeNull();
    expect(p?.markets).toEqual(["US", "KR", "Crypto"]);
  });

  it("C3 symbol search: catalog + English KR names + Korean query via universal search", async () => {
    const a = makeApi(alice);
    expect((await a.searchSymbols("MARA")).map((s) => s.symbol)).toContain("MARA");
    expect((await a.searchSymbols("Samsung")).map((s) => s.symbol)).toContain("005930.KS");
    expect((await a.searchSymbols("삼성")).map((s) => s.symbol)).toContain("005930.KS");
  }, 30000);

  it("C4 add position → live price from the 1-min pipeline → value math", async () => {
    const a = makeApi(alice);
    await a.addPosition("MARA", 100, 15.67, "2026-07-31");
    const r = (await a.getPortfolio()).find((x) => x.symbol === "MARA")!;
    expect(r.qty).toBe(100);
    expect(r.avg_cost).toBeCloseTo(15.67, 6);
    expect(r.price).toBeGreaterThan(0);                 // written by the cloud cron
    expect(r.value).toBeCloseTo(100 * r.price!, 4);
    expect(r.total_gl).toBeCloseTo(r.value! - 1567, 4);
  });

  it("C5 edit: add a second lot, edit its qty, delete it — average stays derived", async () => {
    const a = makeApi(alice);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "MARA")!;
    await a.addLot(r.holding_id, 50, 12.0);
    let lots = await a.getLots(r.holding_id);
    expect(lots.length).toBe(2);
    const second = lots.find((l) => l.qty === 50)!;
    await a.updateLot(second.id, { qty: 60 });
    let row = (await a.getPortfolio()).find((x) => x.symbol === "MARA")!;
    expect(row.qty).toBe(160);
    expect(row.avg_cost).toBeCloseTo((100 * 15.67 + 60 * 12) / 160, 6);
    await a.deleteLot(second.id);
    row = (await a.getPortfolio()).find((x) => x.symbol === "MARA")!;
    expect(row.qty).toBe(100);
  });

  it("C6 RLS: bob sees nothing of alice's and cannot delete it", async () => {
    const b = makeApi(bob);
    expect((await b.getPortfolio()).length).toBe(0);
    const aliceRow = (await makeApi(alice).getPortfolio())[0];
    await b.removeHolding(aliceRow.holding_id);                  // silently no-op under RLS
    expect((await makeApi(alice).getPortfolio()).length).toBe(1);
  });

  it("C7 news from the 15-min pipeline is readable and filterable", async () => {
    const news = await makeApi(alice).getNews("MARA");
    expect(news.length).toBeGreaterThan(0);
    expect(news.every((n) => n.symbol === "MARA")).toBe(true);
  });

  it("C8 constraints hold in the cloud", async () => {
    await expect(makeApi(alice).addPosition("AMD", -1, 10)).rejects.toBeTruthy();
    expect((await makeApi(alice).getPortfolio()).find((x) => x.symbol === "AMD")).toBeUndefined();
  });

  it("C9 remove position cascades", async () => {
    const a = makeApi(alice);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "MARA")!;
    await a.removeHolding(r.holding_id);
    expect((await a.getPortfolio()).length).toBe(0);
  });

  it("C11 universal search finds any US listing (FIG / Figma)", async () => {
    const res = await makeApi(alice).searchSymbols("Figma");
    const fig = res.find((r) => r.symbol === "FIG");
    expect(fig?.name).toMatch(/Figma/);
    expect(fig?.exchange).toBe("NYSE");
  }, 30000);

  it("C12 ensure registers a ticker with live price + history backfill", async () => {
    const a = makeApi(alice);
    await a.ensureSymbol({ symbol: "FIG", name: "Figma, Inc.", exchange: "NYSE",
                           currency: "USD", kind: "equity", yahoo: "FIG", remote: true });
    const { data: p } = await alice.from("prices").select("price,as_of").eq("symbol", "FIG").single();
    expect(Number(p!.price)).toBeGreaterThan(0);
    const { count } = await alice.from("price_history")
      .select("ts", { count: "exact", head: true }).eq("symbol", "FIG");
    expect(count!).toBeGreaterThan(20);                        // ~3 months of daily closes
  }, 45000);

  it("C13 a brand-new ticker is a first-class position immediately", async () => {
    const a = makeApi(alice);
    await a.addPosition("FIG", 5, 50);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "FIG")!;
    expect(r.price).toBeGreaterThan(0);                        // priced at add time, no cron wait
    expect(r.value).toBeCloseTo(5 * r.price!, 4);
    await a.removeHolding(r.holding_id);
  }, 30000);

  it("C10 signed-out client reads no user data", async () => {
    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    const { data } = await anon.from("holdings").select("*");
    expect(data ?? []).toEqual([]);
  });
});
