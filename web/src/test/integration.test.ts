// Integration battery — runs against the REAL local Supabase stack (db + auth + edge runtime).
// Covers: onboarding trigger, add/edit/remove, RLS isolation, portfolio math, constraints,
// price + news pipelines (fixture mode = deterministic; live smoke separately).
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeApi } from "../lib/api";

const URL_ = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function newUser(tag: string): Promise<SupabaseClient> {
  const email = `e2e-${tag}-${Date.now()}@assetly.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "e2e-password-123", email_confirm: true });
  if (error) throw error;
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await c.auth.signInWithPassword({ email, password: "e2e-password-123" });
  if (sErr) throw sErr;
  expect(data.user).toBeTruthy();
  return c;
}

let alice: SupabaseClient, bob: SupabaseClient;

beforeAll(async () => {
  alice = await newUser("alice");
  bob = await newUser("bob");
}, 30000);

describe("T2 onboarding — auth trigger + profile", () => {
  it("creates a profile row automatically and records onboarding", async () => {
    const a = makeApi(alice);
    const p = await a.getProfile();
    expect(p).toBeTruthy();
    expect(p!.onboarded_at).toBeNull();
    await a.completeOnboarding(["US", "KR"], "USD");
    const p2 = await a.getProfile();
    expect(p2!.onboarded_at).not.toBeNull();
    expect(p2!.markets).toEqual(["US", "KR"]);
  });
});

describe("T4/T5/T9 add + edit + portfolio math", () => {
  it("add position, derived qty/avg/cost are exact", async () => {
    const a = makeApi(alice);
    const hid = await a.addPosition("RDDT", 10, 166.55, "2026-07-22");
    await a.addLot(hid, 14, 168.25, "2026-07-24");
    const rows = await a.getPortfolio();
    const r = rows.find((x) => x.symbol === "RDDT")!;
    expect(r.qty).toBeCloseTo(24, 8);
    expect(r.cost_basis).toBeCloseTo(10 * 166.55 + 14 * 168.25, 6);
    expect(r.avg_cost).toBeCloseTo((10 * 166.55 + 14 * 168.25) / 24, 6);
  });
  it("edit a lot updates the derived numbers", async () => {
    const a = makeApi(alice);
    const rows = await a.getPortfolio();
    const r = rows.find((x) => x.symbol === "RDDT")!;
    const lots = await a.getLots(r.holding_id);
    await a.updateLot(lots[0].id, { qty: 12 });
    const after = (await a.getPortfolio()).find((x) => x.symbol === "RDDT")!;
    expect(after.qty).toBeCloseTo(26, 8);
  });
  it("value and G/L derive from the priced quote", async () => {
    await admin.from("prices").upsert({
      symbol: "RDDT", price: 200, prev_close: 190, change_pct: 5.26,
      currency: "USD", market_state: "open", as_of: new Date().toISOString(), source: "test",
    });
    const a = makeApi(alice);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "RDDT")!;
    expect(r.price).toBe(200);
    expect(r.value).toBeCloseTo(26 * 200, 6);
    expect(r.total_gl).toBeCloseTo(26 * 200 - r.cost_basis!, 6);
  });
});

describe("T3 RLS isolation", () => {
  it("bob cannot see alice's holdings; alice cannot touch bob's", async () => {
    const b = makeApi(bob);
    expect((await b.getPortfolio()).length).toBe(0);
    await b.addPosition("MARA", 5, 15.67);
    const bobRows = await b.getPortfolio();
    expect(bobRows.length).toBe(1);
    // alice tries to delete bob's holding: RLS makes it a no-op
    const a = makeApi(alice);
    await a.removeHolding(bobRows[0].holding_id);
    expect((await makeApi(bob).getPortfolio()).length).toBe(1);
  });
  it("anon (signed-out) reads nothing", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data, error } = await anon.from("holdings").select("*");
    expect(error ?? { message: "" }).toBeTruthy();
    expect(data ?? []).toEqual([]);
  });
});

describe("T6 remove", () => {
  it("removing a holding cascades its lots and empties the portfolio row", async () => {
    const a = makeApi(alice);
    const hid = await a.addPosition("INTC", 220, 20.37);
    const before = await a.getLots(hid);
    expect(before.length).toBe(1);
    await a.removeHolding(hid);
    const rows = await a.getPortfolio();
    expect(rows.find((x) => x.symbol === "INTC")).toBeUndefined();
    const { data: orphans } = await admin.from("lots").select("id").eq("holding_id", hid);
    expect(orphans ?? []).toEqual([]);
  });
});

describe("T10 constraints", () => {
  it("rejects non-positive qty and duplicate holdings resolve to one", async () => {
    const a = makeApi(alice);
    await expect(a.addPosition("AMD", -5, 100)).rejects.toBeTruthy();
    expect((await a.getPortfolio()).find((x) => x.symbol === "AMD")).toBeUndefined();   // no orphan holding
    const h1 = await a.addPosition("AMD", 1, 100);
    const h2 = await a.addPosition("AMD", 2, 110);   // upsert on (user,symbol) → same holding
    expect(h1).toBe(h2);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "AMD")!;
    expect(r.qty).toBeCloseTo(3, 8);
  });
});

describe("T7/T8 pipelines (fixture mode, deterministic)", () => {
  it("price-sync upserts quotes + history; authenticated can read, cannot write", async () => {
    const fx = {
      quotes: [{ symbol: "META", price: 589.85, prev_close: 594.97, change_pct: -0.86,
                 currency: "USD", market_state: "closed", as_of: "2026-08-21T20:00:00Z", source: "fixture" }],
    };
    const r = await fetch(`${URL_}/functions/v1/price-sync?fixture=1&symbols=META`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify(fx),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.wrote).toBe(1);
    const { data } = await alice.from("prices").select("*").eq("symbol", "META").single();
    expect(Number(data!.price)).toBe(589.85);
    const { error: wErr } = await alice.from("prices")
      .update({ price: 1 }).eq("symbol", "META");
    const { data: after } = await alice.from("prices").select("price").eq("symbol", "META").single();
    expect(Number(after!.price)).toBe(589.85);          // write was rejected or a no-op
    expect(wErr === null || wErr).toBeTruthy();
    const { data: hist } = await alice.from("price_history").select("*").eq("symbol", "META");
    expect((hist ?? []).length).toBeGreaterThan(0);
  });
  it("news-sync parses RSS, dedupes on (symbol,url), stays readable", async () => {
    const xml = `<rss><channel>
      <item><title>MARA story one</title><link>https://x.test/a</link><pubDate>Fri, 21 Aug 2026 12:00:00 GMT</pubDate></item>
      <item><title>MARA story one again</title><link>https://x.test/a</link><pubDate>Fri, 21 Aug 2026 12:05:00 GMT</pubDate></item>
      <item><title>MARA story two</title><link>https://x.test/b</link><pubDate>Fri, 21 Aug 2026 13:00:00 GMT</pubDate></item>
      </channel></rss>`;
    const r = await fetch(`${URL_}/functions/v1/news-sync?fixture=1`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ feeds: [{ symbol: "MARA", source: "fixture", xml }] }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    const { data } = await alice.from("news").select("*").eq("symbol", "MARA").like("url", "%x.test%");
    expect((data ?? []).length).toBe(2);               // url dedupe collapsed the repeat
  });
});

describe("Live smoke (network) — real Yahoo quote through the pipeline", () => {
  it("price-sync writes a fresh AAPL quote", async () => {
    const r = await fetch(`${URL_}/functions/v1/price-sync?symbols=AAPL`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE}` },
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.wrote).toBe(1);
    const { data } = await alice.from("prices").select("price,source").eq("symbol", "AAPL").single();
    expect(Number(data!.price)).toBeGreaterThan(0);
  }, 45000);
});

describe("Universal symbol search + on-demand tracking", () => {
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
  it("search maps venues and filters to US + KR + crypto", async () => {
    const r = await fetch(`${URL_}/functions/v1/symbol-search?fixture=1`, {
      method: "POST", headers: H,
      body: JSON.stringify({ q: "fig", results: [
        { symbol: "FIG", quoteType: "EQUITY", exchange: "NYQ", exchDisp: "NYSE", longname: "Figma, Inc." },
        { symbol: "FIG.F", quoteType: "EQUITY", exchange: "FRA", exchDisp: "Frankfurt", longname: "Finlay Minerals Ltd." },
        { symbol: "005930.KS", quoteType: "EQUITY", exchange: "KSC", longname: "Samsung Electronics Co., Ltd." },
        { symbol: "BRK-B", quoteType: "EQUITY", exchange: "NYQ", longname: "Berkshire Hathaway Inc." },
        { symbol: "FIGHT-USD", quoteType: "CRYPTOCURRENCY", exchange: "CCC", longname: "Crypto Fight Club USD" },
      ] }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    const by = Object.fromEntries(body.results.map((x: { symbol: string }) => [x.symbol, x]));
    expect(by["FIG"].exchange).toBe("NYSE");
    expect(by["FIG.F"]).toBeUndefined();                       // non-US/KR venue filtered out
    expect(by["005930.KS"].currency).toBe("KRW");
    expect(by["BRK.B"].yahoo).toBe("BRK-B");                   // class-share dash normalized
    expect(by["FIGHT"].kind).toBe("crypto");
  });
  it("ensure registers symbol + price + history, readable through RLS", async () => {
    await admin.from("price_history").delete().eq("symbol", "TESTX");   // isolate reruns
    await admin.from("prices").delete().eq("symbol", "TESTX");
    const r = await fetch(`${URL_}/functions/v1/symbol-search?fixture=1`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        ensure: { symbol: "TESTX", name: "Test Fixture Inc", exchange: "NYSE", currency: "USD", kind: "equity", yahoo: "TESTX" },
        chart: { price: 12.34, prev_close: 12, currency: "USD", market_state: "closed",
                 as_of: "2026-08-21T20:00:00Z",
                 history: [{ ts: "2026-08-19T20:00:00Z", price: 11.9 }, { ts: "2026-08-20T20:00:00Z", price: 12.1 }] },
      }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    const a = makeApi(alice);
    const hits = await a.searchSymbols("Test Fixture");
    expect(hits.map((h) => h.symbol)).toContain("TESTX");      // instantly in the local catalog
    const { data: p } = await alice.from("prices").select("price").eq("symbol", "TESTX").single();
    expect(Number(p!.price)).toBe(12.34);
    const { data: h } = await alice.from("price_history").select("ts").eq("symbol", "TESTX");
    expect((h ?? []).length).toBe(3);                          // 2 daily closes + the live tick
  });
  it("live smoke: a real KR listing verifies KRW end to end", async () => {
    const r = await fetch(`${URL_}/functions/v1/symbol-search`, {
      method: "POST", headers: H,
      body: JSON.stringify({ ensure: { symbol: "005930.KS", name: "Samsung Electronics", exchange: "KRX", currency: "KRW", kind: "equity", yahoo: "005930.KS" } }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    const { data } = await alice.from("prices").select("price,currency").eq("symbol", "005930.KS").single();
    expect(Number(data!.price)).toBeGreaterThan(1000);         // won-denominated
    expect(data!.currency).toBe("KRW");
  }, 45000);
});

describe("Price history API (chart backend)", () => {
  it("getHistory returns range-filtered ascending points incl. backfill", async () => {
    const a = makeApi(alice);
    // TESTX was ensured above with 2 daily closes + live tick (fixture)
    const all = await a.getHistory("TESTX", 24 * 30);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < all.length; i++) expect(all[i].ts >= all[i - 1].ts).toBe(true);
    const day = await a.getHistory("TESTX", 24);
    expect(day.length).toBeLessThan(all.length);          // window actually filters
    expect(all.every((p) => p.price > 0)).toBe(true);
  });
  it("5Y backfill: a live-ensured symbol has years of weekly closes", async () => {
    const r = await fetch(`${URL_}/functions/v1/symbol-search`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ ensure: { symbol: "MARA", name: "MARA Holdings", exchange: "NASDAQ", currency: "USD", kind: "equity", yahoo: "MARA" } }),
    });
    expect((await r.json()).ok).toBe(true);
    const fiveY = await makeApi(alice).getHistory("MARA", 24 * 366 * 5);
    expect(fiveY.length).toBeGreaterThan(200);            // weekly spine + daily year + intraday
    const spanDays = (+new Date(fiveY[fiveY.length - 1].ts) - +new Date(fiveY[0].ts)) / 86400000;
    expect(spanDays).toBeGreaterThan(365 * 3);            // genuinely multi-year
  }, 60000);

  it("intraday backfill: a live-ensured symbol has 1W-density points", async () => {
    const r = await fetch(`${URL_}/functions/v1/symbol-search`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ ensure: { symbol: "005930.KS", name: "Samsung Electronics", exchange: "KRX", currency: "KRW", kind: "equity", yahoo: "005930.KS" } }),
    });
    expect((await r.json()).ok).toBe(true);
    const wk = await makeApi(alice).getHistory("005930.KS", 24 * 7);
    expect(wk.length).toBeGreaterThan(20);                // 15m bars, not just daily closes
  }, 45000);
});

describe("Instant news pull (on-demand symbols)", () => {
  it("news-sync accepts body symbols and fetches just those, live", async () => {
    const r = await fetch(`${URL_}/functions/v1/news-sync`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ symbols: ["AAPL"] }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.symbols).toBe(1);                        // scoped to the one requested symbol
    const { data } = await alice.from("news").select("symbol").eq("symbol", "AAPL").limit(5);
    expect((data ?? []).length).toBeGreaterThan(0);
  }, 45000);
});

describe("Previous-close derivation (the META -26% bug)", () => {
  it("session rollover: yesterday's stored price becomes prev_close; garbage Yahoo prev ignored", async () => {
    const H = { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
    await admin.from("prices").delete().eq("symbol", "TESTX");   // clean first-insert state
    // day 1: implausible Yahoo prev (900 vs 100) must be dropped on first insert
    let r = await fetch(`${URL_}/functions/v1/price-sync?fixture=1&symbols=TESTX`, {
      method: "POST", headers: H,
      body: JSON.stringify({ quotes: [{ symbol: "TESTX", price: 100, prev_close: 900, change_pct: -88,
        currency: "USD", market_state: "closed", as_of: "2026-08-24T20:00:00Z", source: "fixture" }] }),
    });
    expect((await r.json()).ok).toBe(true);
    let { data } = await alice.from("prices").select("prev_close,change_pct").eq("symbol", "TESTX").single();
    expect(data!.prev_close).toBeNull();
    expect(data!.change_pct).toBeNull();
    // day 2: UTC date rolled -> our stored 100 IS the previous close, whatever Yahoo says
    r = await fetch(`${URL_}/functions/v1/price-sync?fixture=1&symbols=TESTX`, {
      method: "POST", headers: H,
      body: JSON.stringify({ quotes: [{ symbol: "TESTX", price: 105, prev_close: 753.3, change_pct: -86,
        currency: "USD", market_state: "regular", as_of: "2026-08-25T14:00:00Z", source: "fixture" }] }),
    });
    expect((await r.json()).ok).toBe(true);
    ({ data } = await alice.from("prices").select("prev_close,change_pct").eq("symbol", "TESTX").single());
    expect(Number(data!.prev_close)).toBe(100);
    expect(Number(data!.change_pct)).toBeCloseTo(5, 4);
  });
  it("ensure derives prev from its own daily series, not the range-start close", async () => {
    const H = { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
    const r = await fetch(`${URL_}/functions/v1/symbol-search`, {
      method: "POST", headers: H,
      body: JSON.stringify({ ensure: { symbol: "META", name: "Meta Platforms", exchange: "NASDAQ", currency: "USD", kind: "equity", yahoo: "META" } }),
    });
    expect((await r.json()).ok).toBe(true);
    const { data } = await alice.from("prices").select("price,prev_close,change_pct").eq("symbol", "META").single();
    // sane single-day move, not the year-ago-close artifact (-26%)
    expect(Math.abs(Number(data!.change_pct))).toBeLessThan(15);
    expect(Number(data!.prev_close)).toBeGreaterThan(Number(data!.price) * 0.85);
  }, 60000);
});

describe("Accounts + cash positions", () => {
  it("same ticker in brokerage and 401k are separate positions", async () => {
    const a = makeApi(alice);
    const h1 = await a.addPosition("QQQM", 10, 220);
    const h2 = await a.addPosition("QQQM", 40, 205, undefined, "401k");
    expect(h1).not.toBe(h2);
    const rows = (await a.getPortfolio()).filter((r) => r.symbol === "QQQM");
    expect(rows.length).toBe(2);
    const b = rows.find((r) => r.account === "brokerage")!;
    const k = rows.find((r) => r.account === "401k")!;
    expect(b.qty).toBe(10);
    expect(k.qty).toBe(40);
    for (const r of rows) await a.removeHolding(r.holding_id);
  });
  it("cash: $1-pinned position, value = amount, pipeline leaves it alone", async () => {
    const a = makeApi(alice);
    await a.addPosition("$CASH", 5000, 1);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "$CASH")!;
    expect(Number(r.price)).toBe(1);
    expect(r.value).toBe(5000);
    expect(r.total_gl).toBe(0);
    const sync = await fetch(`${URL_}/functions/v1/price-sync`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE}` } });
    expect((await sync.json()).ok).toBe(true);
    const { data } = await alice.from("prices").select("price,source").eq("symbol", "$CASH").single();
    expect(Number(data!.price)).toBe(1);
    expect(data!.source).toBe("pinned");                 // untouched by the market pipeline
    await a.removeHolding(r.holding_id);
  }, 60000);
  it("debt: pinned position the pipeline skips; client subtracts it", async () => {
    const a = makeApi(alice);
    await a.addPosition("$DEBT", 1800, 1);
    const r = (await a.getPortfolio()).find((x) => x.symbol === "$DEBT")!;
    expect(r.kind).toBe("debt");
    expect(Number(r.price)).toBe(1);
    expect(r.value).toBe(1800);
    await a.removeHolding(r.holding_id);
  });

  it("retirement index funds (FXAIX-style NAV) resolve and price", async () => {
    const hits = await makeApi(alice).searchSymbols("FFLDX");
    expect(hits.map((h) => h.symbol)).toContain("FFLDX");
    const H = { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
    const r = await fetch(`${URL_}/functions/v1/symbol-search`, {
      method: "POST", headers: H,
      body: JSON.stringify({ ensure: { symbol: "FFLDX", name: "Fidelity Freedom 2050", exchange: "NASDAQ", currency: "USD", kind: "fund", yahoo: "FFLDX" } }),
    });
    expect((await r.json()).ok).toBe(true);
    const { data } = await alice.from("prices").select("price").eq("symbol", "FFLDX").single();
    expect(Number(data!.price)).toBeGreaterThan(0);
  }, 60000);
});
