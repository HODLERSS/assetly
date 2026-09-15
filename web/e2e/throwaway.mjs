// (Re)creates the throwaway account the App Review demo recording deletes on camera, and seeds it with
// a small book so the deletion looks like a real account. Credentials come from
// ~/.private_keys/assetly-demo-throwaway.txt and are never printed.
//   node e2e/throwaway.mjs
// GoTrue has email confirmation on, so a fresh signUp lands unconfirmed; this prints the one SQL line
// to run in the dashboard when that happens.
import fs from "node:fs";
const cred = Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-demo-throwaway.txt`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const QTY = { AAPL: 12, QQQM: 30, BTC: 0.15, $CASH: 4200 };
const COST = { AAPL: 198.4, QQQM: 212.1, BTC: 61250, $CASH: 1 };

const token = async () => {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cred.email, password: cred.password }) });
  return r.ok ? await r.json() : null;
};

let session = await token();
if (!session) {
  const r = await fetch(`${URL_}/auth/v1/signup`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cred.email, password: cred.password, data: { full_name: "Demo" } }) });
  console.log("signup:", r.status);
  session = await token();
  if (!session) {
    console.log("created but unconfirmed. Run this once in the SQL editor, then re-run this script:\n");
    console.log(`update auth.users set email_confirmed_at = now(), updated_at = now()\n  where email = '${cred.email}' and email_confirmed_at is null;`);
    process.exit(2);
  }
}

const uid = session.user.id;
const h = { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" };
await fetch(`${URL_}/rest/v1/profiles?id=eq.${uid}`, { method: "PATCH", headers: h,
  body: JSON.stringify({ display_name: "Demo", markets: ["US", "CRYPTO"], onboarded_at: new Date().toISOString() }) });

const have = await (await fetch(`${URL_}/rest/v1/holdings?select=id,symbol&user_id=eq.${uid}`, { headers: h })).json();
for (const [symbol, account] of [["AAPL", "brokerage"], ["QQQM", "brokerage"], ["BTC", "crypto"], ["$CASH", "bank"]]) {
  if (have.some((x) => x.symbol === symbol)) continue;
  const res = await fetch(`${URL_}/rest/v1/holdings`, { method: "POST", headers: h,
    body: JSON.stringify({ user_id: uid, symbol, account, nickname: "", source: "manual" }) });
  const [row] = await res.json();
  await fetch(`${URL_}/rest/v1/lots`, { method: "POST", headers: h,
    body: JSON.stringify({ holding_id: row.id, qty: QTY[symbol], cost_per_share: COST[symbol], acquired_on: "2026-03-02" }) });
}
const book = await (await fetch(`${URL_}/rest/v1/portfolio?select=symbol,value&user_id=eq.${uid}`, { headers: h })).json();
console.log("throwaway ready:", book.map((b) => `${b.symbol} $${Math.round(b.value)}`).join(" | "));
