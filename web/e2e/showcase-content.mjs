// Fills the marketing demo account with the things the clip needs on screen: headlines, per-position
// intelligence, and one brief. Safe to re-run.
//   node e2e/showcase-content.mjs [edition]     # default morning
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const edition = process.argv[2] ?? "morning";
const cred = Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-showcase.txt`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const env = fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password });
if (error) { console.error("sign-in failed:", error.message); process.exit(1); }
const uid = auth.user.id;
const syms = (await sb.from("holdings").select("symbol").eq("user_id", uid)).data.map((r) => r.symbol).filter((s) => !s.startsWith("$"));

const step = async (name, body) => {
  const t0 = Date.now();
  const { data, error } = await sb.functions.invoke(name, { body });
  console.log(`${name} ${Math.round((Date.now() - t0) / 1000)}s`, error ? "ERROR " + error.message : JSON.stringify(data).slice(0, 120));
};

await step("price-sync", { symbols: syms });
await step("news-sync", { symbols: syms });
await step("insights-sync", { symbols: syms });
await step("daily-brief", { user_id: uid, edition, force: true });

const { data: b } = await sb.from("daily_briefs").select("edition,brief_date,sections,script").eq("user_id", uid).order("generated_at", { ascending: false }).limit(1);
console.log("brief:", b?.[0]?.edition, b?.[0]?.brief_date, "| lede:", String(b?.[0]?.sections?.lede ?? "").slice(0, 140));
const { count } = await sb.from("news").select("*", { count: "exact", head: true }).in("symbol", syms);
console.log("headlines for the book:", count);
