// The iPhone audit signs in as the cloud fixture and walks every screen, so that account needs a book
// with breadth: US, Korea, crypto and cash, enough rows to scroll. The cloud battery adds and deletes
// positions on the same account, so it leaves the book empty and the audit then times out waiting for
// net worth. Re-run this after any cloud-battery run.
//   node e2e/reseed-audit-fixture.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const BOOK = [
  { symbol: "NVDA", qty: 40, cost: 118.4, account: "brokerage" },
  { symbol: "META", qty: 18, cost: 486.1, account: "brokerage" },
  { symbol: "AAPL", qty: 60, cost: 214.6, account: "brokerage" },
  { symbol: "QQQM", qty: 90, cost: 196.8, account: "401k" },
  { symbol: "000660.KS", qty: 200, cost: 138000, account: "brokerage" },
  { symbol: "BTC", qty: 0.4, cost: 41250, account: "crypto" },
  { symbol: "$CASH", qty: 10000, cost: 1, account: "bank" },
];

const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({
  email: "e2e-cloud@assetly.test",
  password: process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026" });
if (error) { console.error("fixture sign-in failed:", error.message); process.exit(1); }
const uid = auth.user.id;
const h = { apikey: ANON, Authorization: `Bearer ${auth.session.access_token}`, "Content-Type": "application/json" };

await sb.from("profiles").update({ onboarded_at: new Date().toISOString(), markets: ["US", "KR", "Crypto"] }).eq("id", uid);
const have = await (await fetch(`${URL_}/rest/v1/holdings?select=id,symbol&user_id=eq.${uid}`, { headers: h })).json();
for (const row of BOOK) {
  if (have.some((e) => e.symbol === row.symbol)) continue;
  const res = await fetch(`${URL_}/rest/v1/holdings`, { method: "POST", headers: { ...h, Prefer: "return=representation" },
    body: JSON.stringify({ user_id: uid, symbol: row.symbol, account: row.account, nickname: "", source: "manual" }) });
  const [created] = await res.json();
  if (!created) { console.error("skip", row.symbol); continue; }
  await fetch(`${URL_}/rest/v1/lots`, { method: "POST", headers: h,
    body: JSON.stringify({ holding_id: created.id, qty: row.qty, cost_per_share: row.cost, acquired_on: "2025-02-11" }) });
}
const book = await (await fetch(`${URL_}/rest/v1/portfolio?select=symbol,value&user_id=eq.${uid}`, { headers: h })).json();
console.log("audit fixture:", book.map((b) => `${b.symbol} $${Math.round(Number(b.value ?? 0)).toLocaleString()}`).join(" | "));
