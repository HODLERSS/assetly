// Daily Brief quality battery: 11 hypothetical portfolios -> generate -> score.
// Score = 10 binary criteria x 10. Deterministic checks in code; judgment calls via M2.7.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
const LOG = "/tmp/brief-battery.log";
const log = (m) => { console.log(m); appendFileSync(LOG, m + "\n"); };
writeFileSync(LOG, "");
const key = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8").match(/MARA_API_KEY=(.+)/)[1].trim();
const c = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
const { data: u } = await c.auth.getUser();

const P = {
  P1_tech: [["NVDA",5,200],["MSFT",4,480],["META",3,700],["AMD",10,160]],
  P2_crypto: [["MARA",500,15],["MSTR",5,300],["BTC",0.5,60000],["ETH",4,2500]],
  P3_korea: [["000660.KS",50,90000],["005935.KS",100,60000],["024110.KS",300,14000],["003690.KS",500,8000],["$CASH.KRW",30000000,1]],
  P4_balanced: [["BRK.B",10,440],["QQQM",50,210],["FXAIX",100,220],["$CASH",20000,1]],
  P5_single: [["NVDA",40,150],["$CASH",5000,1]],
  P6_growth: [["FIG",100,55],["RDDT",30,180],["SHOP",20,140],["UBER",25,80]],
  P7_value: [["INTC",200,30],["BRK.B",8,430],["024110.KS",500,13500]],
  P8_momentum: [["NVDA",10,180],["MARA",800,12],["ARM",30,140],["NFLX",4,900]],
  P9_wide: [["NVDA",3,200],["AMD",8,150],["META",2,650],["RDDT",10,170],["MARA",200,14],["000660.KS",20,95000],["QQQM",20,200],["$CASH",10000,1]],
  P10_leveraged: [["NVDA",30,190],["$CASH",3000,1],["$DEBT",25000,1]],
  P11_semis: [["AMD",30,155],["ARM",40,135],["INTC",300,28],["000660.KS",30,88000]],
};

const setPortfolio = async (list) => {
  const { data: cur } = await c.from("portfolio").select("holding_id");
  for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
  for (const [sym, qty, cost] of list) {
    const acct = sym.startsWith("$") ? "bank" : "brokerage";
    const { data: h } = await c.from("holdings").upsert({ user_id: u.user.id, symbol: sym, account: acct, nickname: "" }, { onConflict: "user_id,symbol,account,nickname" }).select("id").single();
    await c.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
  }
};

const wc = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
const totalWords = (s) => wc(s.lede) + wc(s.overnight) + s.positions.reduce((a, p) => a + wc(p.note) + wc(p.watch) + wc(p.name), 0) + wc(s.desk_view) + (s.calendar ?? []).reduce((a, x) => a + wc(x), 0);
const hasNum = (t) => /\d/.test(String(t ?? ""));

function codeChecks(s) {
  const r = {};
  r.c1_lede = wc(s.lede) <= 40 && s.lede.trim().length > 0;
  r.c3_notes_numeric = s.positions.length > 0 && s.positions.every((p) => hasNum(p.note));
  r.c4_positions = s.positions.length >= 2 && s.positions.length <= 4 && s.positions.every((p) => p.watch && wc(p.watch) <= 14);
  const all = JSON.stringify(s);
  r.c6_style = !all.includes("—") && !/[0-9]{6}\.(KS|KQ)/.test(all) && !/KRW[0-9]/.test(all);
  r.c8_length = totalWords(s) <= 330;
  return r;
}

async function judgeOnce(s, portfolioDesc) {
  const prompt = `Grade this personal morning investment brief against 5 criteria. Portfolio: ${portfolioDesc}.
BRIEF: ${JSON.stringify(s)}
Return STRICT JSON {"c2": bool, "c5": bool, "c7": bool, "c9": bool, "c10": bool, "worst": str}.
c2: the overnight section cites at least 3 actual market numbers (futures/index/VIX/FX levels or %).
c5: ZERO filler or generic advice (fail on phrases like "investors should", "keep an eye on", "time will tell", "as always", vague hedging).
c7: desk_view is a genuine mid-term structural observation (valuation, correlation, rotation), not a price recap.
c9: broader-market or leader context is CONNECTED to this specific portfolio, not floating commentary.
c10: no internal contradictions and no suspicious numbers (percentages that don't fit, made-up-looking figures).
worst: the single weakest sentence in the brief, quoted.
Be harsh. A criterion only passes if fully met.`;
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "MiniMax-M2.7", messages: [
      { role: "system", content: "You are a ruthless editorial reviewer. Respond with the JSON object ONLY, first character '{'." },
      { role: "user", content: prompt }], temperature: 0.1, max_tokens: 9000, response_format: { type: "json_object" } }),
  });
  if (!r.ok) return null;
  const out = await r.json().catch(() => null);
  const raw = out?.choices?.[0]?.message?.content ?? "";
  const st = raw.indexOf("{"); if (st < 0) return null;
  let d = 0, e = -1;
  for (let i = st; i < raw.length; i++) { if (raw[i] === "{") d++; else if (raw[i] === "}") { d--; if (!d) { e = i + 1; break; } } }
  try { return JSON.parse(raw.slice(st, e)); } catch { return null; }
}

async function judge(s, d) {
  for (let i = 0; i < 3; i++) {
    const j = await judgeOnce(s, d);
    if (j && typeof j.c2 === "boolean") return j;
    await new Promise(r => setTimeout(r, 10000));
  }
  return null;
}

const results = [];
for (const [name, list] of Object.entries(P)) {
  try {
    await setPortfolio(list);
    await new Promise(r => setTimeout(r, 2000));
    const t0 = Date.now();
    const w = await c.functions.invoke("daily-brief", { body: { user_email: "e2e-cloud@assetly.test", force: true } });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (w.error || !(w.data?.wrote > 0)) { log(`${name}: GEN FAIL ${secs}s ${w.error?.message ?? JSON.stringify(w.data)}`); results.push({ name, score: 0 }); continue; }
    const { data: b } = await c.from("daily_briefs").select("sections").eq("user_id", u.user.id).order("generated_at", { ascending: false }).limit(1).maybeSingle();
    const s = b?.sections;
    if (!s) { log(`${name}: NO BRIEF ROW`); results.push({ name, score: 0 }); continue; }
    const cc = codeChecks(s);
    const jj = await judge(s, name + " " + list.map((x) => x[0]).join(","));
    if (!jj) { log(`${name}: JUDGE-NULL (brief generated fine; regrade needed)`); results.push({ name, score: -1, sections: s }); continue; }
    const passes = [cc.c1_lede, jj?.c2, cc.c3_notes_numeric, cc.c4_positions, jj?.c5, cc.c6_style, jj?.c7, cc.c8_length, jj?.c9, jj?.c10];
    const score = passes.filter(Boolean).length * 10;
    const fails = ["c1","c2","c3","c4","c5","c6","c7","c8","c9","c10"].filter((_, i) => !passes[i]);
    log(`${name}: ${score}/100 (${secs}s, ${totalWords(s)}w)${fails.length ? " FAIL:" + fails.join(",") : ""}${jj?.worst ? " | worst: " + String(jj.worst).slice(0, 90) : ""}`);
    results.push({ name, score, fails, sections: s });
  } catch (e) { log(`${name}: ERROR ${e.message}`); results.push({ name, score: 0 }); }
}
// stability: regenerate P1 twice more, structures must validate
await setPortfolio(P.P1_tech);
for (let i = 0; i < 2; i++) {
  const w = await c.functions.invoke("daily-brief", { body: { user_email: "e2e-cloud@assetly.test", force: true } });
  log(`stability run ${i + 1}: ${w.error ? "FAIL" : "wrote=" + w.data?.wrote}`);
}
const { data: rows } = await c.from("daily_briefs").select("id").eq("user_id", u.user.id);
log(`db rows for fixture (should be 1, upsert per day): ${rows?.length}`);
// unknown email -> zero users, no crash
const bad = await c.functions.invoke("daily-brief", { body: { user_email: "nobody@nowhere.test", force: true } });
log(`unknown-email path: ${bad.error ? "FAIL" : JSON.stringify(bad.data)}`);
const graded = results.filter((r) => r.score >= 0);
const avg = graded.reduce((a, r) => a + r.score, 0) / Math.max(1, graded.length);
log(`\nAVG ${avg.toFixed(1)}/100 across ${results.length} portfolios`);
writeFileSync("/tmp/brief-battery-results.json", JSON.stringify(results, null, 1));
// restore empty fixture book
const { data: cur } = await c.from("portfolio").select("holding_id");
for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
log("fixture book cleaned");
