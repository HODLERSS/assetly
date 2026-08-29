// Connect-moment reliability probe: run the full chain against the fixture user and assert every
// artifact lands within budget. Run N times to measure the real success rate (target >= 95%).
//   RUNS=5 node connect-reliability.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8");
const ITOK = env.match(/INTERNAL_TOKEN=(.+)/)[1].trim();
const PK = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", BASE = "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const c = createClient(BASE, PK, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
const { data: u } = await c.auth.getUser(); const uid = u.user.id;
const RUNS = Number(process.env.RUNS ?? 3);
const BUDGET = { insight: 90, symbols: 120, brief: 300 };   // brief-retry chains up to 4 attempts (~4-5 min worst case); fixture: no audio by design
const results = [];
for (let run = 1; run <= RUNS; run++) {
  const t0 = Date.now(); const secs = () => Math.round((Date.now() - t0) / 1000);
  const { data: held } = await c.from("holdings").select("symbol").eq("user_id", uid);
  const syms = (held ?? []).map((r) => r.symbol).filter((s) => !s.startsWith("$"));
  const startISO = new Date().toISOString();
  // fire through the CALLBACK path (what a real connect does): callback -> orchestrator via internal token.
  // A stale-env callback (deployed before INTERNAL_TOKEN) makes this hop 401 silently; this probe catches it.
  const state = "probe-" + run + "-" + Math.random().toString(36).slice(2, 10);
  const admin = createClient(BASE, PK, { auth: { persistSession: false } });
  await c.from("snaptrade_oauth_states").insert({ state, user_id: uid, verifier: "portal" });
  const kick = await fetch(`${BASE}/functions/v1/snaptrade-callback?u=${state}`, { redirect: "manual" });
  void admin;
  const got = { kick: kick.status, insight: null, symbols: null, brief: null };
  while (secs() < BUDGET.brief + 10) {
    await new Promise((r) => setTimeout(r, 5000));
    if (!got.insight) { const { data } = await c.from("portfolio_insights").select("generated_at").eq("user_id", uid).gt("generated_at", startISO).limit(1); if (data?.length) got.insight = secs(); }
    if (!got.symbols && syms.length) { const { data } = await c.from("insights").select("symbol").in("symbol", syms).gt("generated_at", startISO); if (data && new Set(data.map((d) => d.symbol)).size >= Math.min(syms.length, 3)) got.symbols = secs(); }
    if (!got.brief) { const { data } = await c.from("daily_briefs").select("generated_at").eq("user_id", uid).gt("generated_at", startISO).limit(1); if (data?.length) got.brief = secs(); }
    if (got.insight && got.symbols && got.brief) break;
  }
  const pass = (got.kick === 302 || got.kick === 200) && got.insight !== null && got.insight <= BUDGET.insight && got.symbols !== null && got.brief !== null && got.brief <= BUDGET.brief;
  results.push({ run, pass, ...got });
  console.log(`run ${run}: ${pass ? "PASS" : "FAIL"} kick=${got.kick} insight=${got.insight ?? "-"}s symbols=${got.symbols ?? "-"}s brief=${got.brief ?? "-"}s`);
  if (run < RUNS) await new Promise((r) => setTimeout(r, 20000));
}
const rate = Math.round(100 * results.filter((r) => r.pass).length / results.length);
console.log(`\nSUCCESS RATE: ${rate}% over ${results.length} runs (target >= 95%)`);
