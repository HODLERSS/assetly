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
const wc = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
const textOf = (s) => [s.lede, s.overnight, ...(s.positions ?? []).flatMap((p) => [p.name, p.note, p.watch]), s.desk_view, s.horizon ?? "", ...(s.ideas ?? []), ...(s.calendar ?? [])].join("\n");
const nums = (t) => (String(t).match(/-?\d[\d,]*(?:\.\d+)?\s?%?|\$\s?[\d,]+/g) ?? []).filter((x) => !/^(19|20)\d\d$/.test(x.trim()));
const JARGON = /\b(ROE|ROIC|ROTCE|EBITDA|FCF|EPS|AUM|NIM|beta|alpha|sharpe|capex|basis points|convexity|duration|multiple compression|net interest margin|short interest|float)\b/;
const HEDGE = /\b(may or may not|it is unclear whether|only time will tell|could go either way|hard to say|remains uncertain whether|we cannot know)\b/i;
const DOOM = /\b(catastroph\w*|devastat\w*|wipe(d)? out|collapse imminent|doomed|disaster looms)\b/i;
// a chain of MOVES (signed percents), not a weights listing (the book section lists weights by design)
const TICKER_CHAIN = /[A-Z]{2,5}[^.]{0,10}(?:[-+]\d|down |up )[^.]{0,8}%[^.]{0,25}[A-Z]{2,5}[^.]{0,10}(?:[-+]\d|down |up )[^.]{0,8}%/;
const pct = (subs) => Math.round(subs.filter(Boolean).length / subs.length * 100);
const avgSentence = (t) => { const ss = String(t).split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3); return ss.reduce((a, x) => a + wc(x), 0) / Math.max(1, ss.length); };
const roundedOk = (script) => {
  const badPct = (script.match(/\d+\.\d+\s?percent/gi) ?? []).filter((m) => Math.abs(parseFloat(m)) >= 1);
  const badUsd = (script.match(/\b\d{4,}\b(?=\s?(dollars|won))/g) ?? []).filter((d) => Number(d) % (Math.pow(10, String(d).length - 2)) !== 0);
  return badPct.length === 0 && badUsd.length === 0;
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
Return STRICT JSON {"bluf_read":bool,"bluf_read_evidence":str,"bluf_listen":bool,"bluf_listen_evidence":str,"tier_read":bool,"tier_read_evidence":str,"tier_listen":bool,"tier_listen_evidence":str,"clear":bool,"clear_evidence":str,"opinion":bool,"opinion_evidence":str,"construct":bool,"construct_evidence":str,"worst":str}.
bluf_read: every READ section opens with its conclusion, never a list of moves; evidence follows the point. To FAIL quote a section that buries its point; else pass.
bluf_listen: the LISTEN script delivers the bottom line in its first two sentences after the greeting and covers only what matters, no laundry lists. To FAIL quote the buried opening or a list; else pass.
tier_read / tier_listen: language matches the reader (novice/intermediate: plain everyday words, no unexplained financial terms of art — ticker symbols, index names, company/product names are fine; pro: professional register). To FAIL quote the mismatch; else pass.
clear: a smart newcomer could retell the main points after one pass; sentences are short and concrete. To FAIL quote the confusing passage; else pass.
opinion: at least one clear, fact-backed judgment (not a hedge, not a command to trade). To FAIL state "no opinion found" plus the closest attempt; else pass.
construct: risks are framed constructively, not bare doom; a measurable tripwire or watch item attached to a risk COUNTS as its next step (that is the design). To FAIL quote actual doom language, or a risk that has neither framing nor any tripwire/watch/next step anywhere near it; else pass.
worst: weakest sentence overall, quoted.`);
    if (!j) { log(`${pname}/${ed}: JUDGE NULL`); results.push({ pname, ed, M: {} }); continue; }
    const readWords = wc(read), scriptWords = wc(script);
    const M = {
      B1_bluf_read: pct([ev(j, "bluf_read"), !TICKER_CHAIN.test([s.lede, ...(s.positions ?? []).map((p) => p.note), s.desk_view].join("\n"))]),
      B2_bluf_listen: pct([ev(j, "bluf_listen"), !TICKER_CHAIN.test(script)]),
      B3_number_diet: pct([nums(read).length <= (isAssess ? 17 : 13), nums(script).length <= 7, roundedOk(script)]),   // the prompt law is <=3 per section
      B4_tier_read: pct([ev(j, "tier_read"), !(novice && JARGON.test(read))]),
      B5_tier_listen: pct([ev(j, "tier_listen"), !(novice && JARGON.test(script))]),
      B6_read_len: readWords / 200 <= 2.02 && readWords >= (isAssess ? 200 : 120) ? 100 : 0,
      B7_listen_len: scriptWords >= 100 && scriptWords <= 225 ? 100 : 0,   // <= 1.5 min at ~150 wpm, no fast-forward
      B8_understand: pct([ev(j, "clear"), avgSentence(read) <= (novice ? 16 : 22), avgSentence(script) <= (novice ? 16 : 20)]),
      B9_opinion: pct([ev(j, "opinion"), !HEDGE.test(read + script), ev(j, "construct"), !DOOM.test(read + script)]),
      B10_delivery: pct([secs <= 180, !!script, /talk soon/i.test(script.slice(-160)), !/\b(NVDA|JPM|BLK|QQQM)\b/.test(script)]),
    };
    const bad = Object.entries(M).filter(([, v]) => v < 95).map(([k, v]) => `${k}=${v}`);
    const evid = ["bluf_read", "bluf_listen", "tier_read", "tier_listen", "clear", "opinion", "construct"].filter((k) => !ev(j, k)).map((k) => `${k}: ${String(j[k + "_evidence"]).slice(0, 90)}`);
    log(`${pname}/${ed}: ${bad.length ? "BELOW " + bad.join(",") : "ALL 95+"} (${secs}s, read ${readWords}w, listen ${scriptWords}w)${evid.length ? " | " + evid.join(" || ") : ""}`);
    results.push({ pname, ed, M, evid, read: s, script, secs });
    writeFileSync("/tmp/bluf-results.json", JSON.stringify(results, null, 1));
  }
}
const METRICS = ["B1_bluf_read","B2_bluf_listen","B3_number_diet","B4_tier_read","B5_tier_listen","B6_read_len","B7_listen_len","B8_understand","B9_opinion","B10_delivery"];
const rs = results.filter((r) => r.M && Object.keys(r.M).length > 1);
log(`== bluf (${rs.length} cells) ` + METRICS.map((m) => { const have = rs.filter((r) => r.M[m] !== undefined); return have.length ? `${m}:${Math.round(have.reduce((a, r) => a + r.M[m], 0) / have.length)}` : `${m}:n/a`; }).join(" "));
log("done");
