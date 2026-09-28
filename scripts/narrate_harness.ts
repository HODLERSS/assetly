// Local narration harness: composes spoken scripts for REAL stored briefs exactly as the narrate function does
// (same composeScript), but never calls ElevenLabs and never writes to the database. Use it to iterate on script
// quality without spending TTS credits.
//
//   SRK=<service role key> npx -y deno@2 run -A scripts/narrate_harness.ts [--limit 6] [--edition close] [--user f7e1]
//
// The MARA key is read server-side through get_secret with the service role; it is never printed.
import { composeScript, speechName, type Sections } from "../supabase/functions/narrate/compose.ts";
import { earAudit } from "../supabase/functions/narrate/ear.ts";
import { readerLevel } from "../supabase/functions/_shared/intel.ts";

const URL = "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const SRK = Deno.env.get("SRK") ?? "";
if (!SRK) { console.error("set SRK"); Deno.exit(1); }
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const arg = (k: string, d = "") => { const i = Deno.args.indexOf(`--${k}`); return i >= 0 ? Deno.args[i + 1] : d; };
const rest = async (path: string) => { const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H }); return r.json(); };

const key: string = await (await fetch(`${URL}/rest/v1/rpc/get_secret`, { method: "POST", headers: H, body: JSON.stringify({ secret_name: "mara_api_key" }) })).json();
if (!key || typeof key !== "string") { console.error("no MARA key"); Deno.exit(1); }

const limit = Number(arg("limit", "6"));
let q = `daily_briefs?select=user_id,brief_date,edition,sections&order=generated_at.desc&limit=${limit}`;
if (arg("edition")) q += `&edition=eq.${arg("edition")}`;
if (arg("date")) q += `&brief_date=eq.${arg("date")}`;
const rows = (await rest(q)) as { user_id: string; brief_date: string; edition: string; sections: Record<string, unknown> }[];
const users = arg("user") ? rows.filter((r) => r.user_id.startsWith(arg("user"))) : rows;

const voiceFor = async (uid: string) => {
  const pr = ((await rest(`profiles?select=investor&id=eq.${uid}`)) as { investor?: { level?: string[] | string; purpose?: string[] | string } }[])[0];
  const inv = pr?.investor ?? {};
  const lvls = Array.isArray(inv.level) ? inv.level : [inv.level ?? "novice"];
  const purps = Array.isArray(inv.purpose) ? inv.purpose : [inv.purpose ?? "watch"];
  const top = readerLevel(lvls);
  const lvl = top === "pro" || top === "advanced" ? "The listener is experienced: professional vocabulary is fine, keep it dense."
    : top === "intermediate" ? "The listener knows the basics: plain language, no definitions needed. Keep spoken sentences under 18 words."
    : "The listener is a BEGINNER: plain everyday words, and briefly explain any financial term as you use it. Keep every spoken sentence under 14 words: a long sentence is hard to follow by ear.";
  return lvl + (purps.includes("learn") ? " They like understanding the why, so give a short reason with each point." : "");
};
const namesFor = async (uid: string, text: string): Promise<[string, string][]> => {
  const held = (await rest(`portfolio?select=symbol,name,nickname&user_id=eq.${uid}`)) as { symbol: string; nickname?: string }[];
  const cands = new Set(held.map((r) => r.symbol).filter((x) => !x.startsWith("$")));
  for (const m of text.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g) ?? []) cands.add(m);
  const syms = (await rest(`symbols?select=symbol,name&symbol=in.(${[...cands].map((c) => `"${c}"`).join(",")})`)) as { symbol: string; name?: string }[];
  const out = new Map<string, string>();
  for (const r of syms) if (r.name) out.set(r.symbol, speechName(r.name));
  for (const r of held) if (r.nickname && !out.has(r.symbol)) out.set(r.symbol, r.nickname);
  return [...out.entries()].sort((a, b) => b[0].length - a[0].length);
};

let totalIssues = 0, fallbacks = 0;
for (const r of users) {
  const { as_of: _a, day_sign: _s, day_pct: _p, day_usd: _u, held: _h, day_by_symbol: _d, ...s } = r.sections ?? {};
  const t0 = Date.now();
  const c = await composeScript({ s: s as unknown as Sections, briefDate: r.brief_date, edition: r.edition, key, names: await namesFor(r.user_id, JSON.stringify(s)), voiceLine: await voiceFor(r.user_id), savedScript: null });
  const issues = earAudit(c.spoken);
  totalIssues += issues.length; if (c.usedFallback) fallbacks++;
  const words = c.spoken.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(`\n===== ${r.brief_date} ${r.edition} ${r.user_id.slice(0, 8)}  ${c.usedFallback ? "FALLBACK" : "model"}  ${words}w  ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(c.spoken.replace(/\s*<break[^>]*\/>\s*/g, " | "));
  if (c.log.length) console.log("  log: " + c.log.join(" / "));
  console.log(issues.length ? "  EAR ISSUES: " + issues.join("; ") : "  ear: clean");
}
console.log(`\n${users.length} scripts, ${fallbacks} fallback, ${totalIssues} ear issues`);
