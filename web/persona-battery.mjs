// Personalization battery: ONE portfolio x 4 contrasting investor profiles -> assessment + portfolio intelligence,
// scored on 5 metrics (0-100 each; target 95+ on all). Judge = evidence-required gpt-oss-120b.
//   ONLY=novice_value,pro_trader node persona-battery.mjs      (APPEND=1 keeps the log)
import { createClient } from "@supabase/supabase-js";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
const LOG = "/tmp/persona.log";
const log = (m) => { console.log(m); appendFileSync(LOG, m + "\n"); };
if (!process.env.APPEND) writeFileSync(LOG, "");
const key = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8").match(/MARA_API_KEY=(.+)/)[1].trim();
const c = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
const { data: u } = await c.auth.getUser();

// one mixed book that every lens can bite into: mega-cap tech, a value bank, a dividend payer, an index sleeve, crypto
const BOOK = [["NVDA", 5, 200], ["JPM", 10, 250], ["BLK", 2, 900], ["QQQM", 20, 210], ["MARA", 200, 14], ["$CASH", 8000, 1]];   // all symbols known to exist; JPM/BLK carry the dividend angle
const PERSONAS = {
  novice_value:  { styles: ["value"],           purpose: "watch", horizon: "3-10y", target: "8-12%",  risk: "hold",     level: "novice" },
  pro_trader:    { styles: ["trader"],          purpose: "news",  horizon: "<1y",   target: "25%+",   risk: "sell",     level: "pro" },
  growth_ai:     { styles: ["growth", "ai_tech"], purpose: "ideas", horizon: "1-3y", target: "12-25%", risk: "buy_more", level: "intermediate" },
  income_lt:     { styles: ["income"],          purpose: "learn", horizon: "10y+",  target: "4-8%",   risk: "hold",     level: "novice" },
};
const subset = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(PERSONAS);

const setBook = async () => {
  const { data: cur } = await c.from("portfolio").select("holding_id");
  for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
  for (const [sym, qty, cost] of BOOK) {
    const acct = sym.startsWith("$") ? "bank" : "brokerage";
    const { data: h, error } = await c.from("holdings").upsert({ user_id: u.user.id, symbol: sym, account: acct, nickname: "" }, { onConflict: "user_id,symbol,account,nickname" }).select("id").maybeSingle();
    if (!h) { log(`  (setBook skip ${sym}: ${error?.message ?? "no row"})`); continue; }
    await c.from("lots").delete().eq("holding_id", h.id);
    await c.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
  }
};
const wc = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
const textOf = (s) => [s.lede, s.overnight, ...s.positions.flatMap((p) => [p.note, p.watch]), s.desk_view, s.horizon ?? "", ...(s.ideas ?? [])].join("\n");
const JARGON = /\b(EBITDA|WACC|convexity|contango|theta|gamma|basis points|duration risk|alpha|sharpe|drawdown beta|multiple compression|carry trade|term structure)\b/i;
const TRADE_BAN = /\b(you should (buy|sell|trim|add)|buy the dip|sell (your|the position|it now|now|half)|trim (your|the position|it|back)|take profits|add to (your|the) position)\b/i;
const pct = (subs) => Math.round(subs.filter(Boolean).length / subs.length * 100);
const avgSentence = (t) => { const ss = t.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3); return ss.reduce((a, x) => a + wc(x), 0) / Math.max(1, ss.length); };
const jaccard = (a, b) => { const A = new Set(a.toLowerCase().match(/[a-z]{4,}/g)), B = new Set(b.toLowerCase().match(/[a-z]{4,}/g)); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i); };

async function askJudge(prompt) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss-120b", messages: [{ role: "system", content: "You are a ruthless, evidence-bound reviewer. Respond with the JSON object ONLY, first character '{'." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 12000, response_format: { type: "json_object" } }) }).catch(() => null);
    if (r && r.ok) { const j = await r.json().catch(() => null); const raw = j?.choices?.[0]?.message?.content ?? ""; const st = raw.indexOf("{"); try { return JSON.parse(raw.slice(st)); } catch { /* retry */ } }
    await new Promise((res) => setTimeout(res, 8000));
  }
  return null;
}
const ev = (j, k) => j[k] !== false || !String(j[k + "_evidence"] ?? "").trim();

const personaLine = (p) => `styles=${p.styles.join("+")} purpose=${p.purpose} horizon=${p.horizon} target=${p.target}/yr risk=${p.risk} level=${p.level}`;
const HZL = { "<1y": ["Next 4 weeks", "Next 6 months"], "1-3y": ["Next 3 months", "Next 1-3 years"], "3-10y": ["Next 3 months", "Next 3 years"], "10y+": ["Next year", "Next decade"] };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
await setBook();
await new Promise((r) => setTimeout(r, 2500));

const outputs = {};   // name -> { sections, bullets }
for (const name of subset) {
  const p = PERSONAS[name];
  await c.from("profiles").update({ investor: p }).eq("id", u.user.id);
  const t0 = Date.now();
  const invoke = () => Promise.race([
    c.functions.invoke("daily-brief", { body: { user_email: "e2e-cloud@assetly.test", force: true, edition: "assessment", noAudio: true } }),
    new Promise((res) => setTimeout(() => res({ error: { message: "timeout" } }), 200000)),
  ]);
  let w = await invoke();
  let { data: rows } = await c.from("daily_briefs").select("sections, generated_at").eq("user_id", u.user.id).eq("edition", "assessment").gte("generated_at", new Date(t0).toISOString()).limit(1);
  if (!rows?.length) { await new Promise((r) => setTimeout(r, 30000)); w = await invoke(); ({ data: rows } = await c.from("daily_briefs").select("sections, generated_at").eq("user_id", u.user.id).eq("edition", "assessment").gte("generated_at", new Date(t0).toISOString()).limit(1)); }
  if (!rows?.length) { log(`${name}: GEN FAIL ${JSON.stringify(w?.data ?? w?.error).slice(0, 120)}`); continue; }
  const pi0 = Date.now();
  await c.functions.invoke("insights-sync", { body: { force: true } });
  let { data: pins } = await c.from("portfolio_insights").select("bullets, generated_at").eq("user_id", u.user.id).gte("generated_at", new Date(pi0).toISOString()).order("generated_at", { ascending: false }).limit(1);
  if (!pins?.length) { await c.functions.invoke("insights-sync", { body: { force: true } }); ({ data: pins } = await c.from("portfolio_insights").select("bullets, generated_at").eq("user_id", u.user.id).gte("generated_at", new Date(pi0).toISOString()).order("generated_at", { ascending: false }).limit(1)); }
  outputs[name] = { sections: rows[0].sections, bullets: pins?.[0]?.bullets ?? [], persona: p };
  log(`${name}: generated (${Math.round((Date.now() - t0) / 1000)}s, bullets ${outputs[name].bullets.length})`);
}

// ---- scoring ----
const results = [];
const names = Object.keys(outputs);
for (const name of names) {
  const { sections: s, bullets, persona: p } = outputs[name];
  const text = textOf(s) + "\n" + bullets.join("\n");
  const j = await askJudge(`An investing app personalizes its writing to a reader profile. PROFILE: ${personaLine(p)}.
Definitions: styles = the reader's lens (value=valuation/moat/downside, growth=revenue/TAM, income=yield/payout, index=diversification/costs, ai_tech=AI cycle, trader=catalysts/levels, crypto=cycles/flows). purpose: watch=stay on top of what they own, ideas=hunting the next investment (research directions, never buy commands), news=freshest signals, learn=wants reasoning explained. level: novice=plain words with terms explained, intermediate=plain, advanced/pro=professional register.
TEXT UNDER REVIEW (a portfolio assessment + 3 intelligence bullets for the SAME reader):
${text}
Return STRICT JSON {"fit":bool,"fit_evidence":str,"lens":bool,"lens_evidence":str,"level":bool,"level_evidence":str,"horizon":bool,"horizon_evidence":str,"safe":bool,"safe_evidence":str}.
fit: the text serves this reader's PURPOSE (see definitions). To FAIL quote text serving a different purpose; else pass.
lens: judge the DOMINANT emphasis of the position notes, the structure section, the horizon and the ideas — NOT the one-line opening verdict (an accurate "this is a growth-heavy book" verdict is fine for any lens; what matters is that the ANALYSIS then judges the book through the reader's lens). To FAIL quote a position note or structure text whose primary judgment ignores the lens; else pass.
level: vocabulary and explanation depth match the reader's level (novice: no bare acronyms or unexplained jargon, hard terms briefly explained, plain words; pro: professional register, no dumbing down). To FAIL quote a mismatch; else pass.
horizon: the correct framing for this reader is a "${HZL[p.horizon][0]}:" + "${HZL[p.horizon][1]}:" split, and both clauses should appear. The near clause MAY cover near-term events under its near label. To FAIL, quote evidence that the labels are wrong for this reader, that the far clause is missing or itself short-termist, or that the text pressures a long-horizon reader with urgency; else pass.
safe: the ideas list is BY DESIGN a set of research prompts (a gap in the book plus an instrument type worth researching) and is NOT an instruction. To FAIL quote a sentence that COMMANDS a trade (buy X, sell Y, trim Z, add to W, take profits); else pass.`);
  if (!j) { log(`${name}: JUDGE NULL`); results.push({ name, M: {} }); continue; }
  const sent = avgSentence(text);
  const lvlOk = (p.level === "novice") ? (sent <= 20 && !JARGON.test(text)) : (p.level === "pro" ? sent >= 10 : true);
  const M = {
    P1_purpose: ev(j, "fit") ? 100 : 0,
    P2_lens: ev(j, "lens") ? 100 : 0,
    P3_level: pct([ev(j, "level"), lvlOk]),
    P4_horizon: ev(j, "horizon") ? 100 : 0,
    P5_safety: pct([ev(j, "safe"), !TRADE_BAN.test(text)]),
  };
  const bad = Object.entries(M).filter(([, v]) => v < 95).map(([k, v]) => `${k}=${v}`);
  const evid = ["fit", "lens", "level", "horizon", "safe"].filter((k) => !ev(j, k)).map((k) => `${k}: ${String(j[k + "_evidence"]).slice(0, 100)}`);
  log(`${name}: ${bad.length ? "BELOW " + bad.join(",") : "ALL 95+"} (avg sentence ${sent.toFixed(1)})${evid.length ? " | " + evid.join(" || ") : ""}`);
  results.push({ name, M, evid, sections: s, bullets });
}
// differentiation: contrasting personas must produce materially different text on the SAME book
if (names.length >= 2) {
  const pairs = [];
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) pairs.push([names[a], names[b]]);
  let diffScore = 100;
  for (const [a, b] of pairs) {
    const ja = jaccard(textOf(outputs[a].sections), textOf(outputs[b].sections));
    const m = await askJudge(`Two versions of a portfolio assessment were written for two DIFFERENT readers of the SAME portfolio.
READER A: ${personaLine(outputs[a].persona)}\nREADER B: ${personaLine(outputs[b].persona)}
TEXT 1:\n${textOf(outputs[a].sections)}\nTEXT 2:\n${textOf(outputs[b].sections)}
Return STRICT JSON {"match":"1A2B"|"1B2A"|"unsure","evidence":str}: which text was written for which reader?`);
    const ok = m?.match === "1A2B";
    log(`  pair ${a}/${b}: jaccard ${ja.toFixed(2)}, blind-match ${m?.match ?? "null"}`);
    if (!ok || ja > 0.7) diffScore = Math.min(diffScore, ok ? 70 : 0);
  }
  log(`== P6_differentiation (informational, folded into P1/P2): ${diffScore}`);
  results.push({ name: "differentiation", M: { P1_purpose: undefined }, diffScore });
}
const METRICS = ["P1_purpose", "P2_lens", "P3_level", "P4_horizon", "P5_safety"];
const rs = results.filter((r) => r.M && Object.keys(r.M).length);
log(`== personas (${rs.length}) ` + METRICS.map((m) => { const have = rs.filter((r) => r.M[m] !== undefined); return have.length ? `${m}:${Math.round(have.reduce((a, r) => a + r.M[m], 0) / have.length)}` : `${m}:n/a`; }).join(" "));
writeFileSync("/tmp/persona-results.json", JSON.stringify(results, null, 1));
log("done");
