// End-to-end import test for brokerages we have no account at: drives the DEPLOYED snaptrade-sync in fixture mode
// with payloads shaped like each brokerage family, then asserts what landed in the fixture user's book.
//   node snaptrade-fixture-e2e.mjs            (all scenarios)   KICK=1 also verifies the late-holdings assessment kick
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8");
const ITOK = env.match(/INTERNAL_TOKEN=(.+)/)[1].trim();
const BASE = "https://hhdpthrfmsdmxdrfckxq.supabase.co", PK = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const c = createClient(BASE, PK, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
const { data: u } = await c.auth.getUser(); const uid = u.user.id;
const { data: sess } = await c.auth.getSession(); const jwt = sess.session.access_token;

const clear = async () => { const { data: cur } = await c.from("portfolio").select("holding_id"); for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id); };
const sync = async (fixture, no_kick = true) => {
  const r = await fetch(`${BASE}/functions/v1/snaptrade-sync`, { method: "POST", headers: { "Content-Type": "application/json", apikey: PK, Authorization: `Bearer ${jwt}`, "x-internal-token": ITOK }, body: JSON.stringify({ user_id: uid, fixture, no_kick }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const book = async () => { const { data } = await c.from("portfolio").select("symbol,name,currency,kind,qty,avg_cost,price,value,account_label,source").eq("user_id", uid).order("symbol"); return data ?? []; };
const U = (kind, symbol, units, price, cost_basis, o = {}) => ({ instrument: { kind, symbol, raw_symbol: o.raw ?? symbol.replace(/\.[A-Z]+$/, ""), description: o.desc ?? symbol, currency: o.ccy ?? "USD", exchange: o.exch ?? "XNAS" }, units: String(units), price: price === null ? null : String(price), cost_basis: cost_basis === null ? null : String(cost_basis), currency: o.ccy ?? "USD", ...(o.extra ?? {}) });
const acct = (id, inst, number) => ({ id, institution_name: inst, number, name: `${inst} account` });
const bal = (code, cash) => ({ currency: { code }, cash });
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL", name, detail); } };
const row = (rows, sym) => rows.find((r) => r.symbol === sym);
const near = (a, b, tol = 0.01) => a !== null && a !== undefined && Math.abs(Number(a) - b) <= tol;

const scenarios = [
  { name: "Questrade (CAD + USD in one account)", fixture: {
      accounts: [acct("q1", "Questrade", "51234567")],
      positions: { q1: { results: [U("etf", "VAB.TO", 40, 113.15, 108.33, { raw: "VAB", ccy: "CAD", exch: "XTSE", desc: "VANGUARD CDN AGGREGATE BOND INDEX ETF" }), U("stock", "SHOP.TO", 10, 95.5, 80, { raw: "SHOP", ccy: "CAD", exch: "XTSE", desc: "SHOPIFY INC" }), U("stock", "AAPL", 5, 230, 190, { desc: "APPLE INC" })] } },
      balances: { q1: [bal("CAD", 500), bal("USD", 1000)] } },
    expect: (rows, res) => {
      check("VAB.TO in CAD", row(rows, "VAB.TO")?.currency === "CAD" && near(row(rows, "VAB.TO")?.qty, 40) && near(row(rows, "VAB.TO")?.avg_cost, 108.33) && row(rows, "VAB.TO")?.kind === "etf", JSON.stringify(row(rows, "VAB.TO")));
      check("SHOP.TO in CAD priced", row(rows, "SHOP.TO")?.currency === "CAD" && Number(row(rows, "SHOP.TO")?.price) > 0, JSON.stringify(row(rows, "SHOP.TO")));   // price-sync may re-price from Yahoo between runs
      check("AAPL stays USD", row(rows, "AAPL")?.currency === "USD");
      check("CAD cash row", near(row(rows, "$CASH.CAD")?.qty, 500) && row(rows, "$CASH.CAD")?.currency === "CAD", JSON.stringify(row(rows, "$CASH.CAD")));
      check("USD cash row", near(row(rows, "$CASH")?.qty, 1000));
      check("account label", row(rows, "AAPL")?.account_label === "Questrade …4567", row(rows, "AAPL")?.account_label);
    } },
  { name: "Kraken (XBT/XETH aliases, fiat-as-asset)", fixture: {
      accounts: [acct("k1", "Kraken", null)],
      positions: { k1: { results: [U("crypto", "XXBT", 0.5, 60000, 45000, { ccy: "USD", exch: null, desc: "Bitcoin" }), U("crypto", "XETH", 4, 2500, 2000, { ccy: "USD", exch: null, desc: "Ethereum" }), U("crypto", "ZUSD", 1500, 1, 1, { ccy: "USD", exch: null, desc: "US Dollar" })] } },
      balances: { k1: [bal("USD", 1500)] } },
    expect: (rows, res) => {
      check("XXBT -> BTC", near(row(rows, "BTC")?.qty, 0.5) && row(rows, "BTC")?.kind === "crypto", JSON.stringify(row(rows, "BTC")));
      check("XETH -> ETH", near(row(rows, "ETH")?.qty, 4));
      check("ZUSD not a position", !row(rows, "ZUSD") && !row(rows, "USD"));
      check("skipped reported", (res?.results?.[0]?.skipped?.cash ?? 0) >= 1, JSON.stringify(res?.results?.[0]?.skipped));
      check("USD cash 1500", near(row(rows, "$CASH")?.qty, 1500));
    } },
  { name: "Trading212 (LSE pence + XETRA EUR + GBP cash)", fixture: {
      accounts: [acct("t1", "Trading212", "T212-889912")],
      positions: { t1: { results: [U("stock", "VOD.L", 100, 7250, 6800, { raw: "VOD", ccy: "GBX", exch: "XLON", desc: "VODAFONE GROUP PLC" }), U("stock", "SAP.DE", 3, 180, 150, { raw: "SAP", ccy: "EUR", exch: "XETR", desc: "SAP SE" }), U("etf", "VUSA.L", 12, 8200, 7000, { raw: "VUSA", ccy: "GBX", exch: "XLON", desc: "VANGUARD S&P 500 UCITS ETF" })] } },
      balances: { t1: [bal("GBP", 12.5), bal("EUR", 40)] } },
    expect: (rows) => {
      check("VOD.L in pounds, not pence", row(rows, "VOD.L")?.currency === "GBP" && Number(row(rows, "VOD.L")?.price) > 0 && Number(row(rows, "VOD.L")?.price) < 500 && near(row(rows, "VOD.L")?.avg_cost, 68), JSON.stringify(row(rows, "VOD.L")));
      check("SAP.DE in EUR", row(rows, "SAP.DE")?.currency === "EUR" && Number(row(rows, "SAP.DE")?.price) > 0, JSON.stringify(row(rows, "SAP.DE")));
      check("VUSA.L etf kind, pounds not pence", row(rows, "VUSA.L")?.kind === "etf" && Number(row(rows, "VUSA.L")?.price) < 500, JSON.stringify(row(rows, "VUSA.L")));
      check("GBP cash", near(row(rows, "$CASH.GBP")?.qty, 12.5));
      check("EUR cash", near(row(rows, "$CASH.EUR")?.qty, 40));
    } },
  { name: "Robinhood (fractional, no cost basis, crypto, option, short)", fixture: {
      accounts: [acct("r1", "Robinhood", "5RH12345")],
      positions: { r1: { results: [U("stock", "AMZN", 0.3271, 185, null, { desc: "Amazon.com Inc" }), U("crypto", "BTC", 0.02, 60000, null, { ccy: "USD", exch: null, desc: "Bitcoin" }), U("option", "AAPL  261218C00240000", 1, 12, 10), U("stock", "TSLA", -5, 250, 240, { desc: "Tesla Inc" }), U("stock", "NVDA", 3, 120, 90, { desc: "NVIDIA Corp" })] } },
      balances: { r1: [bal("USD", 42.17)] } },
    expect: (rows, res) => {
      check("fractional AMZN", near(row(rows, "AMZN")?.qty, 0.3271, 0.0001) && row(rows, "AMZN")?.avg_cost === null || near(row(rows, "AMZN")?.avg_cost, 0), JSON.stringify(row(rows, "AMZN")));
      check("BTC crypto", near(row(rows, "BTC")?.qty, 0.02, 0.0001));
      check("option skipped", !rows.some((r) => /AAPL {2}/.test(r.symbol)) && (res?.results?.[0]?.skipped?.option ?? 0) === 1, JSON.stringify(res?.results?.[0]?.skipped));
      check("short skipped", !row(rows, "TSLA") && (res?.results?.[0]?.skipped?.short ?? 0) === 1);
      check("NVDA", near(row(rows, "NVDA")?.qty, 3) && near(row(rows, "NVDA")?.avg_cost, 90));
    } },
  { name: "Interactive Brokers (book-value cost basis, multi-currency cash, bond CUSIP)", fixture: {
      accounts: [acct("i1", "Interactive Brokers", "U7654321")],
      positions: { i1: { results: [U("stock", "MSFT", 20, 400, 7000, { desc: "MICROSOFT CORP" }), U("other", "912828ZT0", 10000, 98.5, 97, { desc: "US TREASURY NOTE 2.5% 2030", exch: null }), U("stock", "BRKB", 2, 440, 380, { raw: "BRKB", desc: "BERKSHIRE HATHAWAY INC CLASS B" }), U("mutualfund", "SPAXX", 5000, 1, 1, { desc: "FIDELITY GOVERNMENT MONEY MARKET", extra: { cash_equivalent: true } })] } },
      balances: { i1: [bal("USD", 2500), bal("EUR", -300)] } },
    expect: (rows, res) => {
      check("book value divided by units", near(row(rows, "MSFT")?.avg_cost, 350), JSON.stringify(row(rows, "MSFT")));
      check("bond unsupported", !row(rows, "912828ZT0") && (res?.results?.[0]?.skipped?.unsupported ?? 0) === 1, JSON.stringify(res?.results?.[0]?.skipped));
      check("BRKB -> BRK.B", near(row(rows, "BRK.B")?.qty, 2), JSON.stringify(rows.map((r) => r.symbol)));
      check("money market skipped", !row(rows, "SPAXX"));
      check("EUR margin debt", near(row(rows, "$DEBT.EUR")?.qty, 300) && row(rows, "$DEBT.EUR")?.kind === "debt", JSON.stringify(row(rows, "$DEBT.EUR")));
      check("USD cash", near(row(rows, "$CASH")?.qty, 2500));
    } },
  { name: "Fidelity (mutual funds, FCASH sweep, two accounts under one connection)", fixture: {
      accounts: [acct("f1", "Fidelity", "Z12-345998"), acct("f2", "Fidelity", "X99-887766")],
      positions: { f1: { results: [U("mutualfund", "FXAIX", 100, 220, 180, { desc: "FIDELITY 500 INDEX FUND" }), U("other", "FCASH", 800, 1, 1, { desc: "FDIC INSURED DEPOSIT" }), U("stock", "MARA", 500, 15, 12, { desc: "MARA HOLDINGS INC" })] }, f2: { results: [U("stock", "MARA", 100, 15, 20, { desc: "MARA HOLDINGS INC" })] } },
      balances: { f1: [bal("USD", 800)], f2: [bal("USD", 0)] } },
    expect: (rows, res) => {
      check("FXAIX fund", row(rows, "FXAIX")?.kind === "fund" && near(row(rows, "FXAIX")?.qty, 100));
      check("FCASH sweep not a position", !row(rows, "FCASH"));
      const maras = rows.filter((r) => r.symbol === "MARA");
      check("same symbol in two accounts = two rows", maras.length === 2 && maras.some((r) => r.account_label === "Fidelity …5998") && maras.some((r) => r.account_label === "Fidelity …7766"), JSON.stringify(maras.map((r) => [r.qty, r.account_label])));
      check("one USD cash row for the funded account", rows.filter((r) => r.symbol === "$CASH").length === 1);
    } },
];

for (const sc of scenarios) {
  await clear();
  const res = await sync(sc.fixture, true);
  console.log(`\n== ${sc.name}: HTTP ${res.status} ${JSON.stringify(res.body?.results?.[0] ?? res.body).slice(0, 220)}`);
  if (res.status !== 200) { fail++; continue; }
  const rows = await book();
  sc.expect(rows, res.body);
}

// FX rates for the non-USD books: run the price pipeline once and verify the USDxxx rows exist
const ps = await c.functions.invoke("price-sync", { body: {} });
const { data: fx } = await c.from("prices").select("symbol,price").like("symbol", "USD___");
const fxMap = Object.fromEntries((fx ?? []).map((r) => [r.symbol.slice(3), Number(r.price)]));
console.log(`\nFX rows after price-sync (${ps.error ? "invoke error: " + ps.error.message : "ok"}):`, Object.entries(fxMap).map(([k, v]) => `${k}=${v}`).join(" "));
for (const ccy of ["KRW", "CAD", "GBP", "EUR", "JPY", "AUD", "HKD", "INR"]) check(`fx ${ccy} present and sane`, fxMap[ccy] > 0 && fxMap[ccy] < 100000, String(fxMap[ccy]));
check("CAD ~ 1.2-1.6 per USD", fxMap.CAD > 1.2 && fxMap.CAD < 1.6, String(fxMap.CAD));
check("GBP ~ 0.6-0.95 per USD", fxMap.GBP > 0.6 && fxMap.GBP < 0.95, String(fxMap.GBP));

if (process.env.KICK) {
  // late-holdings kick: a sync that adds positions outside the orchestrator must produce a Portfolio Assessment
  await clear();
  const t0 = new Date().toISOString();
  const res = await sync(scenarios[0].fixture, false);
  console.log(`\nkick scenario: HTTP ${res.status}`);
  let landed = null;
  for (let i = 0; i < 60 && !landed; i++) { await new Promise((r) => setTimeout(r, 5000)); const { data } = await c.from("daily_briefs").select("generated_at,edition").eq("user_id", uid).eq("edition", "assessment").gt("generated_at", t0).limit(1); if (data?.length) landed = data[0]; }
  check("assessment produced by the late-holdings kick", !!landed, landed ? landed.generated_at : "none within 300s");
}

await clear();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
