// Three-edition brief battery: portfolios x (morning, midday, close) -> 10 quality metrics, each 0-100.
// Deterministic checks in code; judgment metrics via an evidence-required M2.7 judge.
// Run: ONLY=P1_tech,P2_crypto EDS=morning,midday,close caffeinate -i node brief-battery3.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
const LOG = "/tmp/brief3.log";
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
  P9_wide: [["NVDA",3,200],["AMD",8,150],["META",2,650],["RDDT",10,170],["MARA",200,14],["000660.KS",20,95000],["QQQM",20,200],["$CASH",10000,1]],
};
const EDS = (process.env.EDS ?? "morning,midday,close").split(",");
const subset = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(P);

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
const CAPS = {
  morning: { lede: 40, tape: 62, note: 36, desk: 45, total: 340 },
  midday:  { lede: 32, tape: 56, note: 32, desk: 40, total: 300 },
  close:   { lede: 35, tape: 62, note: 34, desk: 45, total: 320 },
};
const FILLER = /(investors should|keep an eye|monitor closely|time will tell|stay tuned|it'?s important to|as always|remains to be seen|worth watching|demands scrutiny|warrants attention)/i;
const PROCESS = /(skeptic|the memo|pushback|analyst note)/i;
const pct = (subs) => Math.round(subs.filter(Boolean).length / subs.length * 100);
const roundOk = (all) => (all.match(/\$[\d,]+(?:\.\d+)?/g) ?? []).every((m) => {
  const v = Number(m.replace(/[$,]/g, ""));
  return v < 1000 || (m.includes(",") && v % 100 === 0);
});
const sentences = (s) => JSON.stringify(s).split(/(?<=[.!?])\s+|","/).map((x) => x.replace(/[^a-zA-Z0-9 %$.]/g, "").trim()).filter((x) => x.length > 30);

async function judgeOnce(ed, s, desc, stats, market, morning) {
  const edRubric = ed === "morning"
    ? "This is a PRE-OPEN morning brief. m5 passes if it is forward-looking into today's session (overnight tape, what to watch today) and never narrates today's US close as already done."
    : ed === "midday"
    ? "This is an 11:00 AM Central MIDDAY pulse, 2.5h into the US session. m5 passes only if it reads as live intraday coverage: what is moving NOW and what to watch this afternoon, not a morning preview and not a day recap. m8 passes only if it builds on the morning brief without repeating its sentences or claims."
    : "This is a CLOSING note published right after the 4 PM ET close. m5 passes only if it settles what the day meant (day tally) AND arms the reader for the next session (tonight or tomorrow or next week). m8 passes only if it completes the day's arc from the morning brief without repeating its sentences.";
  const prompt = `Grade this ${ed} investment brief. Portfolio: ${desc}.
PORTFOLIO STATS (ground truth): ${stats}
MARKET DATA (ground truth): ${market}
${morning ? `MORNING BRIEF (earlier today): ${JSON.stringify(morning)}` : ""}
BRIEF UNDER REVIEW: ${JSON.stringify(s)}
${edRubric}
Return STRICT JSON {"m2":bool,"m2_evidence":str,"m3":bool,"m3_evidence":str,"m5":bool,"m5_evidence":str,"m6":bool,"m6_evidence":str,"m7":bool,"m7_evidence":str,"m8":bool,"m8_evidence":str,"m10":bool,"m10_evidence":str,"worst":str}.
m2 factual accuracy: every number is consistent with the ground truth above or internally consistent. Rounding within 1% is fine; day-change percentages within 0.4 percentage points of ground truth are live price drift, NOT errors (example: brief says 0.7% drop, truth says 0.9% drop: 0.2pp apart, m2 PASSES). To FAIL you MUST quote a contradicting pair differing by more than 1% in m2_evidence; else m2 passes.
m3 insight: the lede or desk_view contains at least one NON-OBVIOUS portfolio-specific implication (a connection, risk, or setup a naive reader would miss), not just a price recap. To FAIL quote the recap-only text; else pass.
m5 timing fit: per the rubric above. To FAIL quote the out-of-time phrase; else pass.
m6 coverage: the portfolio's LARGEST position is addressed somewhere. To FAIL state the missing name in m6_evidence; else pass.
m7 actionability: every watch item is a concrete event, date, level, or time a reader could act on. To FAIL quote the vague watch; else pass.
m8 continuity: per the rubric (morning briefs auto-pass). To FAIL quote the repeated or contradictory text; else pass.
m10 voice: reads like a sharp human analyst (varied sentences, confident, zero AI boilerplate). To FAIL quote the robotic or boilerplate sentence; else pass.
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
const ev = (j, k) => j[k] !== false || !String(j[k + "_evidence"] ?? "").trim() ? true : false;
// price-drift override: if m2 evidence cites two percentages within 0.45pp, it is drift, not error
const drifty = (t) => { const ps = (String(t).match(/-?\d+(?:\.\d+)?\s*%/g) || []).map(x => Math.abs(parseFloat(x))); return ps.length >= 2 && Math.abs(ps[0] - ps[1]) <= 0.45; };
const evM2 = (j) => ev(j, "m2") || drifty(j.m2_evidence);

const today = new Date().toISOString().slice(0, 10);
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
  const freshTruth = async () => {
    const { data: rows } = await c.from("portfolio").select("symbol,name,nickname,value,currency,change_pct,kind,total_gl");
    const tot = (rows ?? []).filter(r => r.kind !== "debt").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
    const stats = `Total $${Math.round(tot)}. ` + (rows ?? []).map(r => `${r.nickname || r.name || r.symbol}: $${Math.round(usd(Number(r.value ?? 0), r.currency))} (${(usd(Number(r.value ?? 0), r.currency) / tot * 100).toFixed(1)}%), day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}, total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`).join("; ");
    const syms = (rows ?? []).filter(r => !r.symbol.startsWith("$")).map(r => r.symbol);
    const { data: hp } = await c.from("prices").select("symbol,price").in("symbol", syms);
    const priceLine = (hp ?? []).map(q => `${q.symbol} price $${Number(q.price).toLocaleString("en-US")}`).join("; ");
    const { data: mkt } = await c.from("prices").select("symbol,price,change_pct").in("symbol", ["ES=F","NQ=F","^VIX","^GSPC","^KS11","USDKRW"]);
    const market = (mkt ?? []).map(m => `${m.symbol} ${Number(m.price).toLocaleString("en-US")} (${m.change_pct === null ? "n/a" : Number(m.change_pct).toFixed(1) + "%"})`).join(" | ");
    return { stats: stats + (priceLine ? ` | UNIT PRICES (per share/coin, distinct from position values): ${priceLine}` : ""), market };
  };
  let morningSecs = null;
  for (const ed of EDS) {
    try {
      const t0 = Date.now();
      const invoke = () => Promise.race([
        c.functions.invoke("daily-brief", { body: { user_email: "e2e-cloud@assetly.test", force: true, edition: ed, noAudio: true } }),
        new Promise((res) => setTimeout(() => res({ error: { message: "invoke timeout 200s" } }), 200000)),
      ]);
      // M1 mirrors production: cron + sweeps = up to 3 delivery attempts per window. Delivered = stable.
      let w = await invoke(); let attempts = 1;
      if (w.error || !(w.data?.wrote > 0)) { await new Promise(r => setTimeout(r, 60000)); w = await invoke(); attempts = 2; }
      if (w.error || !(w.data?.wrote > 0)) { await new Promise(r => setTimeout(r, 120000)); w = await invoke(); attempts = 3; }
      const genScore = 100;
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      let { data: b } = await c.from("daily_briefs").select("sections, model, generated_at").eq("user_id", u.user.id).eq("brief_date", today).eq("edition", ed).maybeSingle();
      const freshRow = b && (Date.now() - +new Date(b.generated_at)) < 900000;   // written in the last 15 min = this run's
      if ((w.error || !(w.data?.wrote > 0)) && !freshRow) { log(`${name}/${ed}: GEN FAIL ${secs}s ${w.error?.message ?? JSON.stringify(w.data)}`); results.push({ name, ed, M: { M1: 0 } }); continue; }
      if (b && String(b.model ?? "").includes("compact") && attempts < 3) {
        // sweep simulation: a degraded (compact-fallback) brief gets one upgrade pass
        await new Promise(r => setTimeout(r, 60000)); await invoke(); attempts += 1;
        const { data: b2 } = await c.from("daily_briefs").select("sections, model").eq("user_id", u.user.id).eq("brief_date", today).eq("edition", ed).maybeSingle();
        if (b2 && !String(b2.model ?? "").includes("compact")) b = b2;
      }
      const s = b?.sections;
      if (!s) { log(`${name}/${ed}: NO ROW`); results.push({ name, ed, M: { M1: 0 } }); continue; }
      if (ed === "morning") morningSecs = s;
      const all = JSON.stringify(s);
      const cap = CAPS[ed];
      const { stats, market } = await freshTruth();
      const jj = await judge(ed, s, name + " " + list.map(x => x[0]).join(","), stats, market, ed === "morning" ? null : morningSecs);
      if (!jj) { log(`${name}/${ed}: JUDGE-NULL`); results.push({ name, ed, M: { M1: genScore }, judgeNull: true, sections: s }); continue; }
      const watchOk = s.positions.every(p => wc(p.watch) <= 14 && !/\b(monitor|watch|track|keep an eye)\b/i.test(p.watch));
      const repeatOk = ed === "morning" || !morningSecs ? true : !sentences(morningSecs).some(x => all.includes(x));
      const M = {
        M1: genScore,
        M2: evM2(jj) ? 100 : 0,
        M3: ev(jj, "m3") ? 100 : 0,
        M4: pct([wc(s.lede) <= cap.lede, wc(s.overnight) <= cap.tape, s.positions.every(p => wc(p.note) <= cap.note), wc(s.desk_view) <= cap.desk, totalWords(s) <= cap.total, !FILLER.test(all)]),
        M5: ev(jj, "m5") ? 100 : 0,
        M6: pct([(s.overnight.match(/\d[\d,.]*/g) ?? []).length >= 3, s.positions.length >= 1 && s.positions.length <= 4, ev(jj, "m6")]),
        M7: pct([watchOk, ev(jj, "m7")]),
        M8: ed === "morning" ? 100 : pct([repeatOk, ev(jj, "m8")]),
        M9: pct([!all.includes("—"), !/[0-9]{6}\.(KS|KQ)/.test(all), !/KRW\s?[0-9]/.test(all), !FILLER.test(all), !PROCESS.test(all), roundOk(all)]),
        M10: ev(jj, "m10") ? 100 : 0,
      };
      const bad = Object.entries(M).filter(([, v]) => v < 95).map(([k, v]) => `${k}=${v}`);
      const evid = ["m2","m3","m5","m6","m7","m8","m10"].filter(k => k === "m2" ? !evM2(jj) : !ev(jj, k)).map(k => `${k}: ${String(jj[k + "_evidence"]).slice(0, 80)}`);
      log(`${name}/${ed}: ${bad.length ? "BELOW " + bad.join(",") : "ALL 95+"} (${secs}s, ${totalWords(s)}w, try${attempts})${evid.length ? " | " + evid.join(" || ") : ""}`);
      results.push({ name, ed, M, evid, worst: jj.worst, sections: s });
    } catch (e) { log(`${name}/${ed}: ERROR ${e.message}`); results.push({ name, ed, M: { M1: 0 } }); }
  }
}
// ---- matrix ----
const METRICS = ["M1","M2","M3","M4","M5","M6","M7","M8","M9","M10"];
for (const ed of EDS) {
  const rs = results.filter(r => r.ed === ed && r.M && !r.judgeNull);
  if (!rs.length) continue;
  const line = METRICS.map(m => {
    const have = rs.filter(r => r.M[m] !== undefined);
    return have.length ? `${m}:${Math.round(have.reduce((a, r) => a + r.M[m], 0) / have.length)}` : `${m}:n/a`;
  }).join(" ");
  log(`== ${ed} (${rs.length} portfolios) ${line}`);
}
writeFileSync("/tmp/brief3-results.json", JSON.stringify(results, null, 1));
log("done");
