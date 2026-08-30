// Portfolio Assessment battery: fixture portfolios -> edition "assessment" -> 10 quality metrics (A1..A10), each 0-100.
// Deterministic checks in code; judgment metrics via an evidence-required M2.7 judge. Target: every metric 95+.
// Run: ONLY=P1_tech,P2_crypto caffeinate -i node assessment-battery.mjs     (APPEND=1 keeps the log)
import { createClient } from "@supabase/supabase-js";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
const LOG = "/tmp/assess.log";
const log = (m) => { console.log(m); appendFileSync(LOG, m + "\n"); };
if (!process.env.APPEND) writeFileSync(LOG, "");
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
  P6_debt: [["NVDA",10,150],["MSFT",5,400],["RDDT",20,170],["$CASH",8000,1],["$DEBT",25000,1]],
  P9_wide: [["NVDA",3,200],["AMD",8,150],["META",2,650],["RDDT",10,170],["MARA",200,14],["000660.KS",20,95000],["QQQM",20,200],["$CASH",10000,1]],
};
const subset = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(P);

const setPortfolio = async (list) => {
  const { data: cur } = await c.from("portfolio").select("holding_id");
  for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
  for (const [sym, qty, cost] of list) {
    const acct = sym.startsWith("$") ? "bank" : "brokerage";
    const { data: h, error } = await c.from("holdings").upsert({ user_id: u.user.id, symbol: sym, account: acct, nickname: "" }, { onConflict: "user_id,symbol,account,nickname" }).select("id").single();
    if (error || !h) { log(`  (skip ${sym}: ${error?.message})`); continue; }
    await c.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
  }
};

const wc = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
const totalWords = (s) => wc(s.lede) + wc(s.overnight) + s.positions.reduce((a, p) => a + wc(p.note) + wc(p.watch) + wc(p.name), 0) + wc(s.desk_view) + wc(s.horizon) + (s.ideas ?? []).reduce((a, x) => a + wc(x), 0);
const CAP = { lede: 30, book: 60, note: 34, watch: 12, desk: 50, horizon: 50, idea: 14, total: 440, totalMin: 300 };
const FILLER = /(investors should|keep an eye|monitor closely|time will tell|stay tuned|it'?s important to|as always|remains to be seen|worth watching|demands scrutiny|warrants attention)/i;
const PROCESS = /(skeptic|the memo|pushback|analyst note)/i;
const HORIZON_BAN = /\b(today|tonight|overnight|yesterday|this morning|premarket|pre-market|after-hours|futures|session|intraday)\b/i;
const TRADE_BAN = /\b(you should (buy|sell|trim|add)|buy more|buy the dip|sell (your|the|it|now|half)|trim (your|the|it|back)|take profits|add to (your|the) position|dump)\b/i;
const pct = (subs) => Math.round(subs.filter(Boolean).length / subs.length * 100);
const roundOk = (all) => (all.match(/\$[\d,]+(?:\.\d+)?/g) ?? []).every((m) => { const v = Number(m.replace(/[$,]/g, "")); return v < 1000 || (m.includes(",") && v % 100 === 0); });
const avgSentence = (s) => { const txt = [s.lede, s.overnight, ...s.positions.map((p) => p.note), s.desk_view, s.horizon].join(" "); const ss = txt.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3); return ss.reduce((a, x) => a + wc(x), 0) / Math.max(1, ss.length); };
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameHit = (hay, h) => { const first = String(h.name).split(/\s+/)[0].replace(/[^A-Za-z0-9가-힣]/g, ""); const sym = String(h.sym).replace(/\.(KS|KQ)$/, ""); return (first.length >= 2 && new RegExp(esc(first), "i").test(hay)) || new RegExp("\\b" + esc(sym) + "\\b", "i").test(hay); };

async function judgeOnce(s, desc, stats) {
  const prompt = `Grade this PORTFOLIO ASSESSMENT (the first brief after an investor adds their positions: quality of the book, structure and risk, next-quarter vs next-years horizons, gaps worth researching; NOT a daily tape note). Portfolio: ${desc}.
PORTFOLIO STATS (ground truth): ${stats}
ASSESSMENT UNDER REVIEW: ${JSON.stringify(s)}
Return STRICT JSON {"m2":bool,"m2_evidence":str,"m4":bool,"m4_evidence":str,"m5":bool,"m5_evidence":str,"m6":bool,"m6_evidence":str,"m7":bool,"m7_evidence":str,"m10":bool,"m10_evidence":str,"m11":bool,"m11_evidence":str,"worst":str}.
m2 factual accuracy: every number (weights, totals, percentages) is consistent with the ground truth or internally consistent; rounding within 1.5 percentage points is fine. Qualitative business descriptions count as errors only if plainly false about a well-known company. To FAIL you MUST quote a contradicting pair in m2_evidence; else m2 passes.
m4 horizon fit: it reads as a first look at quality and structure over months and years. To FAIL quote a sentence that narrates a single day's or overnight move or uses tape language; else pass.
m5 quality depth: positions cover only the 2-4 largest equity, fund, or crypto holdings (cash and debt are NOT positions and need no note). EVERY position note says what the business is, gives a quality judgment (moat, growth, profitability, or balance sheet), and carries both a strength and a risk or condition; none is a price recap. To FAIL quote the weakest note; else pass.
m6 structural insight: desk_view names a concentration, correlation, currency, or leverage fact SPECIFIC to this book that a naive owner would miss, and says what it means. To FAIL quote the generic text; else pass.
m7 actionability: every watch item is a concrete, observable tripwire or catalyst (a metric, an event, a guidance item), and every idea names a specific theme, sector, geography, or instrument type worth researching (not a bare "diversify"). To FAIL quote the vague item; else pass.
m10 voice: reads like a sharp, candid human strategist writing to one client (varied sentences, confident, zero AI boilerplate, no hype). To FAIL quote the robotic or boilerplate sentence; else pass.
m11 balance and advice law: strengths AND risks both get real words, and it never instructs the reader to buy, sell, trim, add, or take profits. To FAIL quote the one-sided or instructing sentence; else pass.
worst: the single weakest sentence, quoted. Be harsh but evidence-bound.`;
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "MiniMax-M2.7", messages: [
      { role: "system", content: "You are a ruthless, evidence-bound editorial reviewer. Respond with the JSON object ONLY, first character '{'." },
      { role: "user", content: prompt }], temperature: 0.1, max_tokens: 9000, response_format: { type: "json_object" } }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const out = await r.json().catch(() => null);
  const raw = out?.choices?.[0]?.message?.content ?? "";
  const st = raw.indexOf("{"); if (st < 0) return null;
  let d = 0, e = -1;
  for (let i = st; i < raw.length; i++) { if (raw[i] === "{") d++; else if (raw[i] === "}") { d--; if (!d) { e = i + 1; break; } } }
  try { return JSON.parse(raw.slice(st, e)); } catch { return null; }
}
async function judge(...a) {
  for (let i = 0; i < 3; i++) { const j = await judgeOnce(...a); if (j && typeof j.m2 === "boolean") return j; await new Promise(r => setTimeout(r, 10000)); }
  return null;
}
const ev = (j, k) => j[k] !== false || !String(j[k + "_evidence"] ?? "").trim();
const drifty = (t) => { const ps = (String(t).match(/-?\d+(?:\.\d+)?\s*%/g) || []).map(x => Math.abs(parseFloat(x))); return ps.length >= 2 && Math.abs(ps[0] - ps[1]) <= 1.5; };
const evM2 = (j) => ev(j, "m2") || drifty(j.m2_evidence);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const results = [];
for (const name of subset) {
  const list = P[name];
  await setPortfolio(list);
  await new Promise(r => setTimeout(r, 2500));
  { const t0 = Date.now();
    const pr = await fetch("https://api.cloud.mara.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "Reply {\"ok\":true}" }], max_tokens: 300, response_format: { type: "json_object" } }) }).catch(() => null);
    log(`[api-health ${name}: ${pr && pr.ok ? ((Date.now() - t0) / 1000).toFixed(1) + "s" : "FAIL"}]`); }
  const fx = 1380;
  const usd = (v, cc) => cc === "KRW" ? v / fx : v;
  const truth = async () => {
    const { data: rows } = await c.from("portfolio").select("symbol,name,nickname,value,currency,kind,total_gl");
    const assets = (rows ?? []).filter(r => r.kind !== "debt");
    const tot = assets.reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
    const hold = assets.filter(r => !r.symbol.startsWith("$")).map(r => ({ name: r.nickname || r.name || r.symbol, sym: r.symbol, w: usd(Number(r.value ?? 0), r.currency) / tot * 100 })).sort((a, b) => b.w - a.w);
    const stats = `Total assets $${Math.round(tot)}. ` + (rows ?? []).map(r => `${r.nickname || r.name || r.symbol}${r.kind === "debt" ? " (DEBT)" : ""}: $${Math.round(usd(Number(r.value ?? 0), r.currency))} (${(usd(Number(r.value ?? 0), r.currency) / tot * 100).toFixed(1)}% of assets), total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`).join("; ");
    return { stats, hold };
  };
  try {
    const t0 = Date.now();
    const invoke = () => Promise.race([
      c.functions.invoke("daily-brief", { body: { user_email: "e2e-cloud@assetly.test", force: true, edition: "assessment", noAudio: true } }),
      new Promise((res) => setTimeout(() => res({ error: { message: "invoke timeout 200s" } }), 200000)),
    ]);
    let w = await invoke(); let attempts = 1;
    const fresh = async () => { const { data: b } = await c.from("daily_briefs").select("sections, model, generated_at").eq("user_id", u.user.id).eq("brief_date", today).eq("edition", "assessment").maybeSingle(); return b && +new Date(b.generated_at) >= t0 ? b : null; };
    let b = await fresh();
    if (!b) { await new Promise(r => setTimeout(r, 30000)); w = await invoke(); attempts = 2; b = await fresh(); }
    if (!b) { await new Promise(r => setTimeout(r, 60000)); w = await invoke(); attempts = 3; b = await fresh(); }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (!b) { log(`${name}: GEN FAIL ${secs}s ${w?.error?.message ?? JSON.stringify(w?.data)}`); results.push({ name, M: { A1: 0 } }); continue; }
    const s = b.sections;
    const compact = String(b.model ?? "").includes("compact");
    const all = JSON.stringify(s);
    const text = [s.lede, s.overnight, ...s.positions.flatMap(p => [p.name, p.note, p.watch]), s.desk_view, s.horizon, ...(s.ideas ?? [])].join("\n");
    const { stats, hold } = await truth();
    const jj = await judge(s, name + " " + list.map(x => x[0]).join(","), stats);
    if (!jj) { log(`${name}: JUDGE-NULL (${secs}s)`); results.push({ name, M: { A1: secs <= 180 && attempts === 1 ? 100 : 0 }, judgeNull: true, sections: s }); continue; }
    const posText = s.positions.map(p => p.name).join(" | ");
    const big = hold.filter(h => h.w >= 20);
    const watchOk = s.positions.every(p => wc(p.watch) <= 14 && !/\b(monitor|watch|track|keep an eye)\b/i.test(p.watch));
    const ideas = s.ideas ?? [];
    const M = {
      A1: secs <= 180 && attempts === 1 ? 100 : secs <= 300 ? 70 : 0,
      A2: evM2(jj) ? 100 : 0,
      A3: pct([hold[0] ? nameHit(posText, hold[0]) : true, big.every(h => nameHit(posText, h)), hold[0] ? nameHit(s.overnight, hold[0]) : true, (s.overnight.match(/\d[\d,.]*/g) ?? []).length >= 3]),
      A4: pct([!HORIZON_BAN.test(text), ev(jj, "m4"), /next 3 months/i.test(s.horizon ?? "") && /next 3 years/i.test(s.horizon ?? "")]),
      A5: ev(jj, "m5") ? 100 : 0,
      A6: pct([ev(jj, "m6"), /\d+(\.\d+)?\s?%/.test(s.desk_view)]),
      A7: pct([watchOk, ideas.length >= 2 && ideas.length <= 3 && ideas.every(x => wc(x) <= 16) && !ideas.some(x => /^diversif/i.test(x.trim())), ev(jj, "m7")]),
      A8: pct([wc(s.lede) <= CAP.lede, wc(s.overnight) <= CAP.book, s.positions.every(p => wc(p.note) <= CAP.note), s.positions.every(p => wc(p.watch) <= CAP.watch), wc(s.desk_view) <= CAP.desk, wc(s.horizon) <= CAP.horizon, ideas.every(x => wc(x) <= CAP.idea), totalWords(s) >= CAP.totalMin && totalWords(s) <= CAP.total && totalWords(s) / 145 <= 3.05]),
      A9: pct([!all.includes("—"), !/[0-9]{6}\.(KS|KQ)/.test(all), !/KRW\s?[0-9]/.test(all), !FILLER.test(all), !PROCESS.test(all), roundOk(all), avgSentence(s) <= 26, !/\*\*|^#|\n#/.test(all)]),
      A10: pct([!TRADE_BAN.test(text), ev(jj, "m10"), ev(jj, "m11")]),
    };
    const bad = Object.entries(M).filter(([, v]) => v < 95).map(([k, v]) => `${k}=${v}`);
    const evid = ["m2","m4","m5","m6","m7","m10","m11"].filter(k => k === "m2" ? !evM2(jj) : !ev(jj, k)).map(k => `${k}: ${String(jj[k + "_evidence"]).slice(0, 90)}`);
    const det = [];
    if (M.A3 < 100) det.push(`A3 top=${hold[0]?.name} big=${big.map(h => h.name).join("/")} pos=${posText}`);
    if (M.A4 < 100 && HORIZON_BAN.test(text)) det.push(`A4 word=${text.match(HORIZON_BAN)[0]}`);
    if (M.A8 < 100) det.push(`A8 lede${wc(s.lede)} book${wc(s.overnight)} notes${s.positions.map(p => wc(p.note)).join("/")} watch${s.positions.map(p => wc(p.watch)).join("/")} desk${wc(s.desk_view)} hz${wc(s.horizon)} ideas${ideas.map(x => wc(x)).join("/")} total${totalWords(s)}`);
    if (M.A9 < 100) det.push(`A9 sent=${avgSentence(s).toFixed(1)} em=${all.includes("—")} round=${roundOk(all)} filler=${FILLER.test(all)}`);
    if (M.A10 < 100 && TRADE_BAN.test(text)) det.push(`A10 trade=${text.match(TRADE_BAN)[0]}`);
    log(`${name}: ${bad.length ? "BELOW " + bad.join(",") : "ALL 95+"} (${secs}s, ${totalWords(s)}w, try${attempts}${compact ? ", COMPACT" : ""})${evid.length ? " | " + evid.join(" || ") : ""}${det.length ? " | " + det.join(" | ") : ""}`);
    results.push({ name, M, evid, det, worst: jj.worst, secs, attempts, compact, sections: s });
  } catch (e) { log(`${name}: ERROR ${e.message}`); results.push({ name, M: { A1: 0 } }); }
}
const METRICS = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"];
const rs = results.filter(r => r.M && !r.judgeNull);
if (rs.length) log(`== assessment (${rs.length} portfolios) ` + METRICS.map(m => { const have = rs.filter(r => r.M[m] !== undefined); return have.length ? `${m}:${Math.round(have.reduce((a, r) => a + r.M[m], 0) / have.length)}` : `${m}:n/a`; }).join(" "));
writeFileSync("/tmp/assess-results.json", JSON.stringify(results, null, 1));
log("done");
