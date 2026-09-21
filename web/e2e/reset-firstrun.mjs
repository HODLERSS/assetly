// Puts the first-run fixture account back to "never onboarded" so the setup flow can be walked again.
// Deliberately no account creation: a signUp costs a Supabase confirmation email and the free tier
// allows 2/hour, which makes an iterate-until-green loop impossible. Resetting is free and idempotent.
//   node e2e/reset-firstrun.mjs
import fs from "node:fs";

const cred = Object.fromEntries(
  fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-firstrun.txt`, "utf8")
    .split("\n").filter(Boolean).map((l) => l.split("=")));
const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: cred.email, password: cred.password }) });
const session = await r.json();
if (!session.access_token) { console.error("first-run fixture cannot sign in:", session.error_description || session.msg); process.exit(1); }
const uid = session.user.id;
const h = { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };

await fetch(`${URL_}/rest/v1/holdings?user_id=eq.${uid}`, { method: "DELETE", headers: h });   // lots cascade
const p = await fetch(`${URL_}/rest/v1/profiles?id=eq.${uid}`, { method: "PATCH", headers: { ...h, Prefer: "return=representation" },
  body: JSON.stringify({ onboarded_at: null, markets: ["US"], investor: null }) });
const [row] = await p.json();
const left = await (await fetch(`${URL_}/rest/v1/portfolio?select=symbol&user_id=eq.${uid}`, { headers: h })).json();
if (row?.onboarded_at !== null || left.length) { console.error("reset failed:", { onboarded_at: row?.onboarded_at, holdings: left.length }); process.exit(1); }
console.log(`first-run fixture reset: onboarded_at=null, ${left.length} holdings`);
