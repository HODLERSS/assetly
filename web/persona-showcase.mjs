// Five investor profiles x the REAL pipeline on the REAL minjae book: assessment (+narration), a daily brief,
// portfolio intelligence. Captures every artifact to /tmp/showcase/, restores the owner's real profile at the
// end and regenerates their live artifacts. Run: node persona-showcase.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const env = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8");
const ITOK = env.match(/INTERNAL_TOKEN=(.+)/)[1].trim();
const BASE = "https://hhdpthrfmsdmxdrfckxq.supabase.co", PK = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
import { createClient } from "@supabase/supabase-js";
const c = createClient(BASE, PK, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });   // gate JWT only
const { data: sess } = await c.auth.getSession();
const H = { "Content-Type": "application/json", apikey: PK, Authorization: `Bearer ${sess.session.access_token}`, "x-internal-token": ITOK };
const call = (fn, body) => fetch(`${BASE}/functions/v1/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.json().catch(() => null)).catch(() => null);
const USER = "f7e11154-eacd-4053-bf87-62243fa2ae3f";   // minjae.m.lee@gmail.com
const ORIGINAL = { risk: "buy_more", level: "advanced", styles: ["growth", "ai_tech"], target: "12-25%", horizon: "3-10y", purpose: "watch" };
const PROFILES = [
  ["novice_value",       "Novice · Value · stay on top · 3-10y · 8-12%",              { styles: ["value"], purpose: "watch", horizon: "3-10y", target: "8-12%", risk: "hold", level: "novice" }],
  ["novice_income_lt",   "Novice · Dividends & income · learn · 10y+ · 4-8%",         { styles: ["income"], purpose: "learn", horizon: "10y+", target: "4-8%", risk: "hold", level: "novice" }],
  ["intermediate_growth","Intermediate · Growth + AI · find next investment · 1-3y",  { styles: ["growth", "ai_tech"], purpose: "ideas", horizon: "1-3y", target: "12-25%", risk: "buy_more", level: "intermediate" }],
  ["advanced_trader",    "Advanced · Trader + Crypto · news first · under 1y · 25%+", { styles: ["trader", "crypto"], purpose: "news", horizon: "<1y", target: "25%+", risk: "trim", level: "advanced" }],
  ["pro_value_growth",   "Professional · Value + Growth · stay on top · 3-10y",       { styles: ["value", "growth"], purpose: "watch", horizon: "3-10y", target: "12-25%", risk: "trim", level: "pro" }],
];
mkdirSync("/tmp/showcase", { recursive: true });
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function generateFor(tag, investor) {
  console.log(`\n=== ${tag}`);
  console.log("set_investor:", JSON.stringify(await call("narrate", { set_investor: { user_id: USER, investor } })));
  const rec = { investor };
  // 1. assessment WITH narration
  let t0 = new Date().toISOString();
  await call("daily-brief", { force: true, user_id: USER, edition: "assessment" });
  for (let i = 0; i < 40; i++) { await sleep(6000); const r = await call("narrate", { fetch_brief: { user_id: USER, edition: "assessment" } }); if (r?.row && r.row.generated_at > t0) { rec.assessment = r.row; break; } }
  console.log("assessment:", rec.assessment ? "ok" : "MISS");
  if (rec.assessment && !rec.assessment.audio_path) {
    await call("narrate", { user_id: USER, edition: "assessment" });
    for (let i = 0; i < 30; i++) { await sleep(6000); const r = await call("narrate", { fetch_brief: { user_id: USER, edition: "assessment" } }); if (r?.row?.audio_path) { rec.assessment = r.row; break; } }
  }
  if (rec.assessment?.audio_path) {
    const s = await call("narrate", { sign_path: rec.assessment.audio_path });
    if (s?.url) { const buf = Buffer.from(await (await fetch(s.url)).arrayBuffer()); writeFileSync(`/tmp/showcase/${tag}.mp3`, buf); rec.audioFile = `${tag}.mp3`; rec.audioBytes = buf.length; console.log(`audio: ${Math.round(buf.length / 1024)} KB`); }
  } else console.log("audio: MISS");
  // 2. the daily brief for the current clock edition
  t0 = new Date().toISOString();
  const utcMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const ed = utcMin >= 20 * 60 + 5 ? "close" : utcMin >= 15 * 60 ? "midday" : "morning";
  await call("daily-brief", { force: true, user_id: USER, edition: ed, noAudio: true });
  for (let i = 0; i < 40; i++) { await sleep(6000); const r = await call("narrate", { fetch_brief: { user_id: USER, edition: ed } }); if (r?.row && r.row.generated_at > t0) { rec.daily = r.row; break; } }
  console.log(`daily (${ed}):`, rec.daily ? "ok" : "MISS");
  // 3. portfolio intelligence (news summary)
  t0 = new Date().toISOString();
  await call("insights-sync", { force: true, user_id: USER });
  for (let i = 0; i < 20; i++) { await sleep(5000); const r = await call("narrate", { fetch_insight: { user_id: USER } }); if (r?.row && r.row.generated_at > t0) { rec.insight = r.row; break; } }
  if (!rec.insight) { await call("insights-sync", { force: true, user_id: USER }); for (let i = 0; i < 20; i++) { await sleep(5000); const r = await call("narrate", { fetch_insight: { user_id: USER } }); if (r?.row && r.row.generated_at > t0) { rec.insight = r.row; break; } } }
  console.log("intelligence:", rec.insight ? "ok" : "MISS");
  return rec;
}
for (const [tag, label, investor] of PROFILES) { out[tag] = { label, ...(await generateFor(tag, investor)) }; writeFileSync("/tmp/showcase/data.json", JSON.stringify(out, null, 1)); }
// restore the owner's real profile and regenerate their live artifacts with it
console.log("\n=== restore owner profile");
console.log("restore:", JSON.stringify(await call("narrate", { set_investor: { user_id: USER, investor: ORIGINAL } })));
await call("daily-brief", { force: true, user_id: USER, edition: "assessment" });
await call("insights-sync", { force: true, user_id: USER });
console.log("owner regen kicked (assessment + intelligence; narration follows via the cron)");
writeFileSync("/tmp/showcase/data.json", JSON.stringify(out, null, 1));
console.log("\nDONE -> /tmp/showcase/data.json");
