// Creates (or tops up) the numbered demo account behind the daily market Short:
// minjae.m.lee+daily<NNN>@gmail.com, "Demo Portfolio <NNN>", an AI-heavy US book of the names people are
// talking about, then runs the real pipeline (prices, news, intelligence, the close brief). The email prefix
// is excluded from the owner's funnel stats. The password is written to ~/.private_keys/assetly-daily<NNN>.txt
// (chmod 600) and never printed.
//   SRK_FILE=<file holding the service key> node e2e/seed-daily-demo.mjs 1 [--brief close] [--no-content]
// The service key comes from `npx --no-install supabase projects api-keys --project-ref hhdpthrfmsdmxdrfckxq -o json`.
import fs from "node:fs";
import crypto from "node:crypto";

const n = Number(process.argv[2] ?? 1);
if (!Number.isInteger(n) || n < 1) { console.error("usage: seed-daily-demo.mjs <number> [--brief close]"); process.exit(1); }
const NNN = String(n).padStart(3, "0");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const edition = arg("--brief") ?? "close";
const SRK = fs.readFileSync(process.env.SRK_FILE ?? "/dev/null", "utf8").trim();
if (!SRK) { console.error("set SRK_FILE to a file holding the service-role key"); process.exit(1); }
const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

const EMAIL = `minjae.m.lee+daily${NNN}@gmail.com`;
const CRED = `${process.env.HOME}/.private_keys/assetly-daily${NNN}.txt`;

// ~$200k, AI-heavy, weights that a real long-term tech holder could plausibly have. Round share counts,
// cost bases well under today's prices (bought over the last year or two). Change the book here, not per run.
const BOOK = [
  { symbol: "NVDA",  qty: 220, cost: 142.50 },
  { symbol: "MSFT",  qty: 50,  cost: 415.00 },
  { symbol: "GOOGL", qty: 70,  cost: 188.00 },
  { symbol: "META",  qty: 30,  cost: 590.00 },
  { symbol: "AMZN",  qty: 80,  cost: 205.00 },
  { symbol: "AVGO",  qty: 50,  cost: 245.00 },
  { symbol: "TSM",   qty: 30,  cost: 255.00 },
  { symbol: "AMD",   qty: 20,  cost: 165.00 },
  { symbol: "MU",    qty: 10,  cost: 410.00 },
  { symbol: "PLTR",  qty: 50,  cost: 128.00 },
  { symbol: "$CASH", qty: 8000, cost: 1, account: "bank" },
];

const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const fn = async (name, body) => {
  const t0 = Date.now();
  const r = await fetch(`${URL_}/functions/v1/${name}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  console.log(`${name} ${Math.round((Date.now() - t0) / 1000)}s ${r.status} ${t.slice(0, 140)}`);
  return r.ok;
};

// ---- the user ----------------------------------------------------------------------------------
let uid;
const found = await (await fetch(`${URL_}/auth/v1/admin/users?per_page=1000`, { headers: H })).json();
const existing = (found.users ?? []).find((u) => u.email === EMAIL);
if (existing) {
  uid = existing.id; console.log(`demo ${NNN} exists`);
} else {
  const password = crypto.randomBytes(18).toString("base64url") + "!9a";
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: `Demo Portfolio ${NNN}` } }) });
  const u = await r.json();
  if (!r.ok) { console.error("create failed:", r.status, JSON.stringify(u).slice(0, 200)); process.exit(1); }
  uid = u.id;
  fs.writeFileSync(CRED, `email=${EMAIL}\npassword=${password}\n`, { mode: 0o600 });
  fs.chmodSync(CRED, 0o600);
  console.log(`demo ${NNN} created; credentials in ${CRED}`);
}

// the profile row is made by the auth trigger; wait for it, then answer setup so the app skips it
for (let i = 0; i < 10 && !(await rest(`profiles?select=id&id=eq.${uid}`)).length; i++) await new Promise((r) => setTimeout(r, 500));
await rest(`profiles?id=eq.${uid}`, { method: "PATCH", body: JSON.stringify({
  display_name: `Demo Portfolio ${NNN}`, base_currency: "USD", display_us: "USD", display_kr: "KRW",
  markets: ["US"], onboarded_at: new Date().toISOString(),
  investor: { styles: ["growth", "ai_tech"], purpose: ["build"], horizon: ["3-10y"], target: ["12-20%"], risk: ["hold"], level: ["intermediate"], defaulted: [] },
}) });

// ---- the book ----------------------------------------------------------------------------------
for (const { symbol } of BOOK) {
  if (symbol.startsWith("$")) continue;
  if ((await rest(`symbols?select=symbol&symbol=eq.${symbol}`)).length) continue;
  await fn("symbol-search", { ensure: { symbol, name: symbol, exchange: "NASDAQ", currency: "USD", kind: "equity", yahoo: symbol } });
}
const have = await rest(`holdings?select=id,symbol&user_id=eq.${uid}`);
for (const row of BOOK) {
  if (have.some((h) => h.symbol === row.symbol)) continue;
  const [created] = await rest("holdings", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: uid, symbol: row.symbol, account: row.account ?? "brokerage", nickname: "", source: "manual" }) });
  await rest("lots", { method: "POST", body: JSON.stringify({ holding_id: created.id, qty: row.qty, cost_per_share: row.cost, acquired_on: "2025-03-14" }) });
}

// ---- content: the real pipeline ------------------------------------------------------------------
const syms = BOOK.map((b) => b.symbol).filter((s) => !s.startsWith("$"));
if (!process.argv.includes("--no-content")) {
  await fn("price-sync", { symbols: syms });
  await fn("news-sync", { symbols: syms });
  await fn("insights-sync", { symbols: syms, user_id: uid });
  await fn("daily-brief", { user_id: uid, edition, force: true });
}

const book = await rest(`portfolio?select=symbol,qty,price,value,change_pct,total_gl&user_id=eq.${uid}`);
const total = book.reduce((s, r) => s + Number(r.value ?? 0), 0);
for (const b of book) console.log(`${b.symbol.padEnd(6)} ${String(b.price).padStart(9)} ${(Number(b.change_pct ?? 0)).toFixed(2).padStart(6)}%  $${Math.round(Number(b.value ?? 0)).toLocaleString()}`);
console.log(`TOTAL $${Math.round(total).toLocaleString()}  |  ${book.length} positions  |  uid ${uid}`);
