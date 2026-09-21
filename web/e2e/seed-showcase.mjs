// The marketing demo account: a US mega-cap tech book worth about $3.5M, used only for the LinkedIn
// clip. Separate from the App Review demo account, which must never be touched.
//   node e2e/seed-showcase.mjs            # idempotent; re-run to top the book back up
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const cred = Object.fromEntries(
  fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-showcase.txt`, "utf8")
    .split("\n").filter(Boolean).map((l) => l.split("=")));
const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

// qty and cost chosen so the book reads like a long-held tech position: real gains, not a lottery win
const BOOK = [
  { symbol: "NVDA",  qty: 3000, cost: 118.40, account: "brokerage" },
  { symbol: "MSFT",  qty: 900,  cost: 371.20, account: "brokerage" },
  { symbol: "AAPL",  qty: 1400, cost: 214.60, account: "brokerage" },
  { symbol: "META",  qty: 600,  cost: 486.10, account: "brokerage" },
  { symbol: "AVGO",  qty: 260,  cost: 168.90, account: "brokerage" },
  { symbol: "GOOGL", qty: 1100, cost: 172.40, account: "brokerage" },
  { symbol: "AMZN",  qty: 1300, cost: 183.25, account: "brokerage" },
  { symbol: "TSLA",  qty: 700,  cost: 248.70, account: "brokerage" },
  { symbol: "QQQM",  qty: 900,  cost: 196.80, account: "401k" },
  { symbol: "$CASH", qty: 120000, cost: 1,   account: "bank" },
];

const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password });
if (authErr) { console.error("showcase sign-in failed:", authErr.message); process.exit(1); }
const uid = auth.user.id;
const h = { apikey: ANON, Authorization: `Bearer ${auth.session.access_token}`, "Content-Type": "application/json" };

// AVGO is not in the seeded catalog; the app's own universal search registers it with price history
for (const { symbol } of BOOK) {
  if (symbol.startsWith("$")) continue;
  const { data: found } = await sb.from("symbols").select("symbol").eq("symbol", symbol).maybeSingle();
  if (found) continue;
  const { data, error } = await sb.functions.invoke("symbol-search", {
    body: { ensure: { symbol, name: symbol, exchange: "NASDAQ", currency: "USD", kind: "equity", yahoo: symbol } } });
  console.log(`ensure ${symbol}:`, error ? error.message : data?.ok ? "registered" : JSON.stringify(data).slice(0, 80));
}

await sb.from("profiles").update({
  display_name: "Demo", base_currency: "USD", display_us: "USD", display_kr: "KRW",
  markets: ["US"], onboarded_at: new Date().toISOString(),
  investor: { styles: ["growth"], purpose: ["build"], horizon: ["3-10y"], target: ["12-20%"], risk: ["hold"], level: ["confident"] },
}).eq("id", uid);

const existing = await (await fetch(`${URL_}/rest/v1/holdings?select=id,symbol&user_id=eq.${uid}`, { headers: h })).json();
for (const row of BOOK) {
  if (existing.some((e) => e.symbol === row.symbol)) continue;
  const res = await fetch(`${URL_}/rest/v1/holdings`, { method: "POST", headers: { ...h, Prefer: "return=representation" },
    body: JSON.stringify({ user_id: uid, symbol: row.symbol, account: row.account, nickname: "", source: "manual" }) });
  const [created] = await res.json();
  if (!created) { console.error("could not add", row.symbol, await res.text?.()); continue; }
  await fetch(`${URL_}/rest/v1/lots`, { method: "POST", headers: h,
    body: JSON.stringify({ holding_id: created.id, qty: row.qty, cost_per_share: row.cost, acquired_on: "2024-06-14" }) });
}

const book = await (await fetch(`${URL_}/rest/v1/portfolio?select=symbol,value,total_gl&user_id=eq.${uid}`, { headers: h })).json();
const total = book.reduce((s, r) => s + Number(r.value ?? 0), 0);
const gl = book.reduce((s, r) => s + Number(r.total_gl ?? 0), 0);
console.log(book.map((b) => `${b.symbol} $${Math.round(Number(b.value ?? 0)).toLocaleString()}`).join(" | "));
console.log(`TOTAL $${Math.round(total).toLocaleString()}  |  unrealised $${Math.round(gl).toLocaleString()}  |  ${book.length} positions`);
