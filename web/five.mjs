import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
const env = readFileSync("/Users/minjaelee/Documents/_Claude/AI/stockAnalysis/app/supabase/.env.local", "utf8");
const ITOK = env.match(/INTERNAL_TOKEN=(.+)/)[1].trim();
const BASE = "https://hhdpthrfmsdmxdrfckxq.supabase.co", PK = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const sleep = ms => new Promise(r => setTimeout(r, ms));
// same five books as the previous run, taken from the saved data so this is a clean before/after
const PEOPLE = JSON.parse(readFileSync("/tmp/five/data-before.json", "utf8"))
  .map(({ tag, name, blurb, inv, book }) => ({ tag, name, blurb, inv, book }));

const run = async (P) => {
  const c = createClient(BASE, PK, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
  const { data: u } = await c.auth.getUser(); const { data: sess } = await c.auth.getSession();
  const H = { "Content-Type": "application/json", apikey: PK, Authorization: `Bearer ${sess.session.access_token}`, "x-internal-token": ITOK };
  const call = async (fn, body) => { try { const r = await fetch(`${BASE}/functions/v1/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) }); return await r.json(); } catch { return null; } };
  const uid = u.user.id;
  const { data: cur } = await c.from("portfolio").select("holding_id");
  for (const r of cur ?? []) await c.from("holdings").delete().eq("id", r.holding_id);
  for (const [sym, qty, cost] of P.book) {
    const acct = sym.startsWith("$") ? "bank" : (["BTC","ETH"].includes(sym) ? "crypto" : "brokerage");
    const { data: h } = await c.from("holdings").upsert({ user_id: uid, symbol: sym, account: acct, nickname: "" }, { onConflict: "user_id,symbol,account,nickname" }).select("id").maybeSingle();
    if (h) { await c.from("lots").delete().eq("holding_id", h.id); await c.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost }); }
  }
  await call("price-sync", { force: true, user_id: uid });
  await call("narrate", { set_investor: { user_id: uid, investor: P.inv } });
  await sleep(3000);
  const rec = { ...P, uid };
  await Promise.all(["assessment", "midday"].map(async (ed) => {
    const t0 = new Date().toISOString();
    await call("daily-brief", { force: true, user_id: uid, edition: ed, noAudio: true });
    for (let i = 0; i < 34 && !rec[ed]; i++) { await sleep(5000);
      const r = await call("narrate", { fetch_brief: { user_id: uid, edition: ed } });
      if (r?.row && r.row.generated_at > t0) rec[ed] = r.row; }
    if (!rec[ed]) { console.log(`${P.tag}/${ed}: no brief`); return; }
    await call("narrate", { user_id: uid, edition: ed, brief_date: rec[ed].brief_date, tts_test: true });
    for (let i = 0; i < 24; i++) { await sleep(5000);
      const r = await call("narrate", { fetch_brief: { user_id: uid, edition: ed } });
      if (r?.row?.audio_path) { rec[ed] = r.row; break; } }
    if (rec[ed]?.audio_path) {
      const sg = await call("narrate", { sign_path: rec[ed].audio_path });
      if (sg?.url) { const buf = Buffer.from(await (await fetch(sg.url)).arrayBuffer());
        writeFileSync(`/tmp/five/${P.tag}-${ed}.mp3`, buf); rec[`${ed}Audio`] = `${P.tag}-${ed}.mp3`;
        console.log(`${P.tag}/${ed}: brief + audio ${Math.round(buf.length/1024)}KB`); }
    } else console.log(`${P.tag}/${ed}: brief, no audio`);
  }));
  return rec;
};
const out = [];
for (const P of PEOPLE) { const r = await run(P); if (r) out.push(r); writeFileSync("/tmp/five/data.json", JSON.stringify(out, null, 1)); }
console.log("DONE", out.length, "personas");
