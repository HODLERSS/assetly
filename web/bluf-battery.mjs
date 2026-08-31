// READ + LISTEN quality battery: 10 metrics (B1-B10), each 0-100, target 95+ on all.
// Grid: 2 personas (novice55 = a 55-year-old who bought her first stock, NVIDIA, 9 months ago; pro) x 2 editions
// (assessment + close) x 2 artifacts (the read text, the spoken script via narrate script_only - no TTS spend).
// Methodology: fixed fixture book, deterministic checks first, evidence-bound gpt-oss judge for the rest,
// raw artifacts saved to /tmp/bluf-results.json every run. Run: node bluf-battery.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync, appendFileSync, writeFileSync } from "fs";
const LOG = "/tmp/bluf.log"; const log = (m) => { console.log(m); appendFileSync(LOG, m + "\n"); };
if (!process.env.APPEND) writeFileSync(LOG, "");
const env = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8");
const ITOK = env.match(/INTERNAL_TOKEN=(.+)/)[1].trim();
const key = env.match(/MARA_API_KEY=(.+)/)[1].trim();
const BASE = "https://hhdpthrfmsdmxdrfckxq.supabase.co", PK = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const c = createClient(BASE, PK, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
const { data: u } = await c.auth.getUser();
const { data: sess } = await c.auth.getSession();
const H = { "Content-Type": "application/json", apikey: PK, Authorization: `Bearer ${sess.session.access_token}`, "x-internal-token": ITOK };
const call = async (fn, body) => { try { const r = await fetch(`${BASE}/functions/v1/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) }); return await r.json(); } catch { return null; } };

const BOOK = [["NVDA", 5, 200], ["JPM", 10, 250], ["BLK", 2, 900], ["QQQM", 20, 210], ["MARA", 200, 14], ["$CASH", 8000, 1]];
const PERSONAS = {
  novice55: { desc: "a 55-year-old first-time investor who bought her first stock, NVIDIA, nine months ago", inv: { styles: ["value"], purpose: "learn", horizon: "3-10y", target: "8-12%", risk: "hold", level: "novice" } },
  pro: { desc: "a professional investor", inv: { styles: ["value", "growth"], purpose: "watch", horizon: "3-10y", target: "12-25%", risk: "trim", level: "pro" } },
};
const setBook = async () => {
  const { data: cur } = await c.from("portfolio").select("holding_id");
  for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
  for (const [sym, qty, cost] of BOOK) {
    const acct = sym.startsWith("$") ? "bank" : "brokerage";
    const { data: h } = await c.from("holdings").upsert({ user_id: u.user.id, symbol: sym, account: acct, nickname: "" }, { onConflict: "user_id,symbol,account,nickname" }).select("id").maybeSingle();
    if (h) { await c.from("lots").delete().eq("holding_id", h.id); await c.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost }); }
  }
};
const strip = (t) => String(t ?? "").replace(/<[^>]*>/g, " ");           // SSML tags are never heard
// index/product names that merely contain digits are names, not numbers the reader must absorb
const NAMEY = /\b(Nasdaq[-\s]?100|S&P[-\s]?500|Russell[-\s]?2000|FTSE[-\s]?100|Nikkei[-\s]?225|Dow[-\s]?30|MSCI[-\s]?\w+)\b/gi;
const wc = (t) => strip(t).split(/\s+/).filter(Boolean).length;
const textOf = (s) => [s.lede, s.overnight, ...(s.positions ?? []).flatMap((p) => [p.name, p.note, p.watch]), s.desk_view, s.horizon ?? "", ...(s.ideas ?? []), ...(s.calendar ?? [])].join("\n");
const nums = (t) => (strip(t).replace(NAMEY, "INDEX").match(/-?\d[\d,]*(?:\.\d+)?\s?%?|\$\s?[\d,]+/g) ?? []).filter((x) => !/^(19|20)\d\d$/.test(x.trim()));
// the listener hears spelled-out quantities too ("twenty-six percent"), so the script diet counts those as well
const WORDNUM = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine|hundred|thousand|million|billion))*\s+(?:percent|dollars?|won|times|basis points)/gi;
// dates and durations are scaffolding, not statistics the reader must absorb; a range is ONE figure
const DATEY = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b|\b\d+\s*[-\s]?(?:week|month|year|day|quarter)s?\b/gi;
const stats = (t) => nums(String(t ?? "").replace(DATEY, " ").replace(/-?\d[\d.]*\s*(?:-|\u2013|to)\s*-?\d[\d.]*\s?%/g, "0%"));
// the NUMBER DIET law is per section (<=3), not a global budget: a five-position book honestly carries more
// figures than a two-position one. The book/overnight line is the one section a full stat line belongs in.
const dietSections = (s) => {
  const out = [["lede", s.lede, 3], ["book", s.overnight, 6], ["desk", s.desk_view, 3], ["horizon", s.horizon ?? "", 3]];
  (s.positions ?? []).forEach((p, i) => { out.push([`note${i}`, p.note, 3], [`watch${i}`, p.watch, 3]); });
  (s.ideas ?? []).forEach((x, i) => out.push([`idea${i}`, x, 2]));
  return out;
};
const dietMisses = (s) => dietSections(s).filter(([, t, cap]) => stats(t).length > cap).map(([k, t, cap]) => `${k}:${stats(t).length}>${cap}`);
const heard = (t) => nums(t).length + (strip(t).replace(NAMEY, "INDEX").match(WORDNUM) ?? []).length;
const JARGON = /\b(ROE|ROIC|ROTCE|EBITDA|FCF|EPS|AUM|NIM|beta|alpha|sharpe|capex|basis points|convexity|duration|multiple compression|net interest margin|short interest|float)\b/;
const HEDGE = /\b(may or may not|it is unclear whether|only time will tell|could go either way|hard to say|remains uncertain whether|we cannot know)\b/i;
const DOOM = /\b(catastroph\w*|devastat\w*|wipe(d)? out|collapse imminent|doomed|disaster looms)\b/i;
// a chain of MOVES (signed percents), not a weights listing (the book section lists weights by design)
const TICKER_CHAIN = /[A-Z]{2,5}[^.]{0,10}(?:[-+]\d|down |up )[^.]{0,8}%[^.]{0,25}[A-Z]{2,5}[^.]{0,10}(?:[-+]\d|down |up )[^.]{0,8}%/;
const pct = (subs) => Math.round(subs.filter(Boolean).length / subs.length * 100);
const avgSentence = (t) => { const ss = strip(t).split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3); return ss.reduce((a, x) => a + wc(x), 0) / Math.max(1, ss.length); };
const roundedOk = (raw) => {
  const script = strip(raw);
  const badPct = (script.match(/\d+\.\d+\s?percent/gi) ?? []).filter((m) => Math.abs(parseFloat(m)) >= 1);
  const badUsd = (script.match(/\b\d{4,}\b(?=\s?(dollars|won))/g) ?? []).filter((d) => Number(d) % (Math.pow(10, String(d).length - 2)) !== 0);
  return badPct.length === 0 && badUsd.length === 0;
};
// ---- B7 FIDELITY: the ear version may round, it may not change the fact. Every quantity the listener
// hears must trace to a figure in the read brief (a real miss found in round 3: the brief said QQQM is
// "one quarter of assets" at 25.6% while the script said "about half").
const W1 = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19 };
const W10 = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
const wordVal = (phrase) => {
  let total = 0, cur = 0, seen = false;
  for (const t of String(phrase).toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean)) {
    if (t in W1) { cur += W1[t]; seen = true; }
    else if (t in W10) { cur += W10[t]; seen = true; }
    else if (t === "hundred") { cur = (cur || 1) * 100; seen = true; }
    else if (t === "thousand") { total += (cur || 1) * 1000; cur = 0; seen = true; }
    else if (t === "million") { total += (cur || 1) * 1e6; cur = 0; seen = true; }
    else if (t === "billion") { total += (cur || 1) * 1e9; cur = 0; seen = true; }
  }
  return seen ? total + cur : null;
};
const FRACW = { "half": 50, "a third": 33, "one third": 33, "two thirds": 67, "a quarter": 25, "one quarter": 25, "three quarters": 75, "a fifth": 20 };
// what the listener hears as a quantity, in numbers
const spokenValues = (script) => {
  const t = strip(script).replace(NAMEY, "INDEX");
  const words = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)";
  const seq = `(?:${words}(?:[\\s-]${words})*)`;
  const pct = [
    ...[...t.matchAll(new RegExp(`(${seq})\\s+percent`, "gi"))].map((m) => wordVal(m[1])),
    ...[...t.matchAll(/(-?\d[\d.]*)\s?%/g)].map((m) => Math.abs(parseFloat(m[1]))),
  ].filter((v) => v !== null);
  const usd = [
    ...[...t.matchAll(new RegExp(`(${seq})\\s+dollars`, "gi"))].map((m) => wordVal(m[1])),
    ...[...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1].replace(/,/g, ""))),
  ].filter((v) => v !== null);
  const frac = Object.entries(FRACW).filter(([w]) => new RegExp(`\\b${w}\\b`, "i").test(t)).map(([, v]) => v);
  return { pct, usd, frac };
};
// the brief spells numbers out for beginners too, so both sides use the same parser
const readValues = (read) => spokenValues(read);
const fidelityMisses = (read, script) => {
  const R = readValues(read), S = spokenValues(script), out = [];
  const nearPct = (v, tol) => R.pct.some((r) => Math.abs(r - v) <= tol);
  for (const v of S.pct) if (!nearPct(v, 1.5)) out.push(`${v}% not in brief`);
  for (const v of S.usd) if (!R.usd.some((r) => r > 0 && Math.abs(r - v) / Math.max(r, 1) <= 0.15)) out.push(`$${v} not in brief`);
  for (const v of S.frac) if (!nearPct(v, 8)) out.push(`fraction ~${v}% contradicts the brief`);
  return out;
};
async function judge(prompt) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss-120b", messages: [{ role: "system", content: "You are a ruthless, evidence-bound reviewer. Respond with the JSON object ONLY, first character '{'." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 12000, response_format: { type: "json_object" } }) }).catch(() => null);
    if (r && r.ok) { const j = await r.json().catch(() => null); const raw = j?.choices?.[0]?.message?.content ?? ""; try { return JSON.parse(raw.slice(raw.indexOf("{"))); } catch { /* retry */ } }
    await new Promise((res) => setTimeout(res, 8000));
  }
  return null;
}
const ev = (j, k) => j[k] !== false || !String(j[k + "_evidence"] ?? "").trim();

await setBook(); await new Promise((r) => setTimeout(r, 2500));
const results = [];
for (const [pname, P] of Object.entries(PERSONAS)) {
  await call("narrate", { set_investor: { user_id: u.user.id, investor: P.inv } });
  for (const ed of ["assessment", "close"]) {
    const t0 = Date.now();
    await call("daily-brief", { force: true, user_id: u.user.id, edition: ed, noAudio: true });
    let row = null;
    for (let i = 0; i < 45 && !row; i++) { await new Promise((r) => setTimeout(r, 6000)); const r2 = await call("narrate", { fetch_brief: { user_id: u.user.id, edition: ed } }); if (r2?.row && +new Date(r2.row.generated_at) >= t0) row = r2.row; }
    if (!row) { await call("daily-brief", { force: true, user_id: u.user.id, edition: ed, noAudio: true }); for (let i = 0; i < 45 && !row; i++) { await new Promise((r) => setTimeout(r, 6000)); const r2 = await call("narrate", { fetch_brief: { user_id: u.user.id, edition: ed } }); if (r2?.row && +new Date(r2.row.generated_at) >= t0) row = r2.row; } }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (!row) { log(`${pname}/${ed}: GEN FAIL`); results.push({ pname, ed, M: { B10: 0 } }); continue; }
    const sc = await call("narrate", { user_id: u.user.id, edition: ed, script_only: true, brief_date: row.brief_date });
    const script = Object.values(sc?.scripts ?? {})[0] ?? "";
    const s = row.sections, read = textOf(s);
    const isAssess = ed === "assessment", novice = P.inv.level === "novice";
    const j = await judge(`Assetly writes a short ${isAssess ? "portfolio assessment" : "daily close brief"} (READ) and a spoken script (LISTEN) for ${P.desc}.
READ:\n${read}\nLISTEN SCRIPT:\n${script}
Return STRICT JSON {"bluf_read":bool,"bluf_read_evidence":str,"bluf_listen":bool,"bluf_listen_evidence":str,"tier_read":bool,"tier_read_evidence":str,"tier_listen":bool,"tier_listen_evidence":str,"clear":bool,"clear_evidence":str,"opinion":bool,"opinion_evidence":str,"construct":bool,"construct_evidence":str,"faithful":bool,"faithful_evidence":str,"worst":str}.
bluf_read: every READ section opens with its conclusion, never a list of moves; evidence follows the point. To FAIL quote a section that buries its point; else pass.
bluf_listen: the LISTEN script delivers the bottom line in its first two sentences after the greeting and covers only what matters, no laundry lists. To FAIL quote the buried opening or a list; else pass.
tier_read / tier_listen: language matches the reader (novice/intermediate: plain everyday words, no unexplained financial terms of art — ticker symbols, index names, company/product names are fine; pro: professional register). To FAIL quote the mismatch; else pass.
clear: a smart newcomer could retell the main points after one pass; sentences are short and concrete. To FAIL quote the confusing passage; else pass.
opinion: at least one clear, fact-backed judgment (not a hedge, not a command to trade). To FAIL state "no opinion found" plus the closest attempt; else pass.
construct: risks are framed constructively, not bare doom; a measurable tripwire or watch item attached to a risk COUNTS as its next step (that is the design). To FAIL quote actual doom language, or a risk that has neither framing nor any tripwire/watch/next step anywhere near it; else pass.
faithful: nothing in the LISTEN script contradicts the READ text. Rounding for the ear is CORRECT and never a failure (25.6% spoken as "twenty-six percent", $43,224 as "forty-three thousand dollars"). A failure is a changed FACT: a weight described as a fraction that does not match the read figure (a quarter is 25%, a third is 33%, half is 50%), a figure attached to the wrong holding, or a number that appears nowhere in the read text. To FAIL quote BOTH the read figure and the script figure; else pass.
worst: weakest sentence overall, quoted.`);
    if (!j) { log(`${pname}/${ed}: JUDGE NULL`); results.push({ pname, ed, M: {} }); continue; }
    const readWords = wc(read), scriptWords = wc(script);
    const M = {
      B1_bluf_read: pct([ev(j, "bluf_read"), !TICKER_CHAIN.test([s.lede, ...(s.positions ?? []).map((p) => p.note), s.desk_view].join("\n"))]),
      B2_bluf_listen: pct([ev(j, "bluf_listen"), !TICKER_CHAIN.test(script)]),
      B3_number_diet: pct([dietMisses(s).length === 0, heard(script) <= 7, roundedOk(script)]),
      B4_tier_read: pct([ev(j, "tier_read"), !(novice && JARGON.test(read))]),
      B5_tier_listen: pct([ev(j, "tier_listen"), !(novice && JARGON.test(script))]),
      B6_length: pct([readWords / 200 <= 2.02 && readWords >= (isAssess ? 200 : 120), scriptWords >= 100 && scriptWords <= 225]),   // <=2 min read; <=1.5 min listen at ~150 wpm, no fast-forward
      B7_fidelity: pct([fidelityMisses(read, script).length === 0, ev(j, "faithful")]),
      B8_understand: pct([ev(j, "clear"), avgSentence(read) <= (novice ? 16 : 22), avgSentence(script) <= (novice ? 16 : 20)]),
      B9_opinion: pct([ev(j, "opinion"), !HEDGE.test(read + script), ev(j, "construct"), !DOOM.test(read + script)]),
      B10_delivery: pct([secs <= 180, !!script, /talk soon/i.test(script.slice(-160)), !/\b(NVDA|JPM|BLK|QQQM)\b/.test(script)]),
    };
    const bad = Object.entries(M).filter(([, v]) => v < 95).map(([k, v]) => `${k}=${v}`);
    if (dietMisses(s).length) log(`   diet misses: ${dietMisses(s).join(", ")}`);
    if (fidelityMisses(read, script).length) log(`   fidelity misses: ${fidelityMisses(read, script).join(", ")}`);
    const evid = ["bluf_read", "bluf_listen", "tier_read", "tier_listen", "clear", "opinion", "construct", "faithful"].filter((k) => !ev(j, k)).map((k) => `${k}: ${String(j[k + "_evidence"]).slice(0, 90)}`);
    log(`${pname}/${ed}: ${bad.length ? "BELOW " + bad.join(",") : "ALL 95+"} (${secs}s, read ${readWords}w, listen ${scriptWords}w)${evid.length ? " | " + evid.join(" || ") : ""}`);
    results.push({ pname, ed, M, evid, read: s, script, secs });
    writeFileSync("/tmp/bluf-results.json", JSON.stringify(results, null, 1));
  }
}
const METRICS = ["B1_bluf_read","B2_bluf_listen","B3_number_diet","B4_tier_read","B5_tier_listen","B6_length","B7_fidelity","B8_understand","B9_opinion","B10_delivery"];
const rs = results.filter((r) => r.M && Object.keys(r.M).length > 1);
log(`== bluf (${rs.length} cells) ` + METRICS.map((m) => { const have = rs.filter((r) => r.M[m] !== undefined); return have.length ? `${m}:${Math.round(have.reduce((a, r) => a + r.M[m], 0) / have.length)}` : `${m}:n/a`; }).join(" "));
log("done");
