// Narrate: turn a stored brief into audio. One job, its own 150s wall clock, idempotent, resilient.
//   - script: M2.7 with a TIGHT budget (35s, one retry), else a deterministic script assembled from the
//     sections — TTS always has input, the text API's slow waves can't starve narration.
//   - TTS: ElevenLabs with 3 attempts (backoff), then upload + audio_path.
//   - callers: daily-brief (fire-and-forget after every write), the backfill sweep (rows missing audio),
//     and the orchestrator. Auth: internal token, service role, or the owning user.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
type Sections = { lede: string; overnight: string; positions: { name: string; note: string; watch: string }[]; desk_view: string; calendar?: string[]; horizon?: string; ideas?: string[] };

function parseJsonBlock(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{"); if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) { if (cleaned[i] === "{") depth++; else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } } }
  if (end < 0) return null;
  try { return JSON.parse(cleaned.slice(start, end)); } catch { return null; }
}
async function askModel(key: string, system: string, prompt: string, maxTokens: number, timeoutMs: number, model?: string): Promise<Record<string, unknown> | null> {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    signal: ac.signal, method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model ?? Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7", temperature: 0.25, max_tokens: maxTokens, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system + " Respond with the JSON object ONLY, first character '{'." }, { role: "user", content: prompt }] }),
  }).catch(() => null);
  clearTimeout(timer);
  if (!r || !r.ok) return null;
  const out = await r.json().catch(() => null);
  const c = out?.choices?.[0]?.message?.content;
  return c ? parseJsonBlock(String(c)) : null;
}
// tickers for the ear: "NVDA" must be spoken as "NVIDIA", never N-V-D-A. Names come from the symbols table, trimmed of
// corporate suffixes; applied to the model script AND the fallback, whole-word, longest ticker first.
const speechName = (name: string) => {
  let n = name.trim();
  for (let i = 0; i < 3; i++) n = n.replace(/[,\s]*\b(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|PLC|N\.V\.|S\.A\.|AG|SE|Holdings?|Group|Trust|Fund|ETF|Class [A-C]( Shares)?|Common Stock|Ordinary Shares|ADR|\(.*?\))\s*$/i, "").trim();
  return n || name;
};
async function tickerNames(admin: ReturnType<typeof createClient>, userId: string, text: string): Promise<[string, string][]> {
  const { data: held } = await admin.from("portfolio").select("symbol, name, nickname").eq("user_id", userId);
  const cands = new Set<string>((held ?? []).map((r) => String(r.symbol)).filter((x) => !x.startsWith("$")));
  for (const m of text.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g) ?? []) cands.add(m);
  const { data: syms } = await admin.from("symbols").select("symbol, name").in("symbol", [...cands]);
  const out = new Map<string, string>();
  for (const r of syms ?? []) if (r.name) out.set(String(r.symbol), speechName(String(r.name)));
  for (const r of held ?? []) if (r.nickname && !out.has(String(r.symbol))) out.set(String(r.symbol), String(r.nickname));
  return [...out.entries()].sort((a, b) => b[0].length - a[0].length);
}
const sayNames = (t: string, names: [string, string][]) => {
  let x = t;
  for (const [sym, nm] of names) {
    if (nm.toUpperCase() === sym) continue;   // the company IS called by its ticker (MARA): nothing to say differently
    const bare = sym.replace(/\.(KS|KQ)$/, "");
    x = x.replace(new RegExp("(^|[^A-Za-z0-9$])" + sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9])", "g"), `$1${nm}`);
    if (bare !== sym && /^[A-Z]{2,5}$/.test(bare)) x = x.replace(new RegExp("(^|[^A-Za-z0-9$])" + bare + "(?![A-Za-z0-9])", "g"), `$1${nm}`);
  }
  return x;
};
// numbers for the ear: $107,300 -> "a hundred and seven thousand three hundred dollars" is model work; the
// fallback keeps digits but spaces them so TTS reads them cleanly ("107,300 dollars", "5.8 percent")
// verbal rounding: nobody says "thirty-four point three percent" or "forty-three thousand two hundred twenty-four dollars"
const roundPct = (v: number) => (Math.abs(v) < 1 ? v.toFixed(1) : String(Math.round(v)));
const roundUsd = (v: number) => {
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + " billion dollars";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + " million dollars";
  if (v >= 1000) { const m = Math.pow(10, String(Math.round(v)).length - 2); return Math.round(v / m) * m + " dollars"; }
  return Math.round(v) + " dollars";
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];
const earNumbers = (t: string) => t
  // an ISO date read aloud is "two thousand twenty six dash zero nine"; say it like a person
  .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, _y, m, d) => `${MONTHS[Number(m) - 1] ?? ""} ${ORD[Number(d)] ?? Number(d)}`.trim())
  // "$85k" must not lose its magnitude: matching "$85" alone left the orphan "k" ("85 dollarsk")
  .replace(/\$([\d,]+(?:\.\d+)?)\s?([kKmMbB]|bn|BN)\b/g, (_, d, suf) => {
    const mult = /^[kK]$/.test(suf) ? 1e3 : /^[mM]$/.test(suf) ? 1e6 : 1e9;
    return roundUsd(Number(String(d).replace(/,/g, "")) * mult);
  })
  .replace(/\$([\d,]+(?:\.\d+)?)/g, (_, d) => roundUsd(Number(String(d).replace(/,/g, ""))))
  .replace(/(-?\d+(?:\.\d+)?)\s?%/g, (_, n) => roundPct(Number(n)) + " percent")
  .replace(/₩([\d,]+)/g, "$1 won")
  .replace(/\s+&(?=[.,]|\s|$)/g, "");   // a truncated legal name ("JPMORGAN CHASE &") must not be spoken
// The fallback ships to a real listener whenever the model wanes, so it obeys the same laws as the written
// script: bottom line first, only the two positions that matter, no stat line read aloud, no laundry list.
function fallbackScript(s: Sections, dayLine: string, edition: string): string {
  const greet = edition === "assessment" ? `Hi, it's ${dayLine}. Here's your portfolio assessment.` : edition === "close" ? `Good evening, it's ${dayLine}. Here's your closing note.` : edition === "midday" ? `It's ${dayLine}, midday. Here's your pulse.` : `Good morning, it's ${dayLine}. Here's your brief.`;
  const say = (t: string) => earNumbers(String(t ?? "").trim());
  const firstSentence = (t: string) => (String(t ?? "").split(/(?<=[.!?])\s+/)[0] ?? "").trim();
  const top = (s.positions ?? []).slice(0, 2);
  const parts = [
    greet,
    say(s.lede),
    // the two names that matter, each in ONE sentence, with the ampersand of a truncated legal name removed
    ...top.map((p) => `${say(String(p.name).replace(/\s*&\s*$/, ""))}: ${say(firstSentence(p.note))}`),
    say(s.desk_view),
    ...(edition === "assessment" && s.horizon ? [say(firstSentence(s.horizon))] : []),
    edition === "assessment" ? "That's your assessment. Talk soon." : "That's your brief. Talk soon."];
  return parts.filter(Boolean).join(' <break time="0.7s" /> ');
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now(); const elapsed = () => (Date.now() - t0) / 1000;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
  const isInternal = !!itok && (req.headers.get("x-internal-token") ?? "") === itok;
  const isSvc = (() => { try { return JSON.parse(atob(bearer.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
  let uid: string | null = typeof body.user_id === "string" ? body.user_id : null;
  const voiceFor = async (userId: string): Promise<string> => {
    const { data: pr } = await admin.from("profiles").select("investor").eq("id", userId).maybeSingle();
    const inv = (pr?.investor ?? {}) as { level?: string[] | string; purpose?: string[] | string };
    const lvls = Array.isArray(inv.level) ? inv.level : [inv.level ?? "novice"];
    const purps = Array.isArray(inv.purpose) ? inv.purpose : [inv.purpose ?? "watch"];
    const order = ["novice", "intermediate", "advanced", "pro"];
    const top = lvls.reduce((a, b) => (order.indexOf(String(b)) > order.indexOf(String(a)) ? b : a), "novice");
    const lvl = top === "pro" || top === "advanced" ? "The listener is experienced: professional vocabulary is fine, keep it dense."
      : top === "intermediate" ? "The listener knows the basics: plain language, no definitions needed. Keep spoken sentences under 18 words."
      : "The listener is a BEGINNER: plain everyday words, and briefly explain any financial term as you use it. Keep every spoken sentence under 14 words: a long sentence is hard to follow by ear.";
    return lvl + (purps.includes("learn") ? " They like understanding the why, so give a short reason with each point." : "");
  };
  if (!isInternal && !isSvc) { const { data: ud } = await admin.auth.getUser(bearer); if (!ud?.user?.id) return json({ ok: false, error: "not signed in" }, 401); uid = ud.user.id; }
  // internal operator utilities (internal token only): showcase capture + demo profile switching.
  if (typeof body.sign_path === "string" && (isInternal || isSvc)) {
    const { data: signed } = await admin.storage.from("briefs-audio").createSignedUrl(body.sign_path, 604800);
    return json({ ok: !!signed?.signedUrl, url: signed?.signedUrl ?? null });
  }
  if (body.fetch_brief && (isInternal || isSvc)) {
    const f = body.fetch_brief as { user_id: string; edition: string };
    const { data } = await admin.from("daily_briefs").select("brief_date, edition, sections, generated_at, audio_path")
      .eq("user_id", f.user_id).eq("edition", f.edition).order("generated_at", { ascending: false }).limit(1);
    return json({ ok: true, row: data?.[0] ?? null });
  }
  if (body.fetch_insight && (isInternal || isSvc)) {
    const f = body.fetch_insight as { user_id: string };
    const { data } = await admin.from("portfolio_insights").select("bullets, news5, generated_at")
      .eq("user_id", f.user_id).order("generated_at", { ascending: false }).limit(1);
    return json({ ok: true, row: data?.[0] ?? null });
  }
  if (body.set_investor && (isInternal || isSvc)) {
    const f = body.set_investor as { user_id: string; investor: unknown };
    const { error } = await admin.from("profiles").update({ investor: f.investor }).eq("id", f.user_id);
    return json({ ok: !error, error: error?.message ?? null });
  }
  const briefDate = typeof body.brief_date === "string" ? body.brief_date : null;
  const edition = typeof body.edition === "string" ? body.edition : null;

  // target rows: a specific brief, or (sweep mode) every real-user brief from the last 2 days missing audio
  let q = admin.from("daily_briefs").select("id, user_id, brief_date, edition, sections, audio_path").is("audio_path", null)
    .gte("brief_date", new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  if (uid) q = q.eq("user_id", uid);
  if (briefDate) q = q.eq("brief_date", briefDate);
  if (edition) q = q.eq("edition", edition);
  const { data: rows } = await q.order("generated_at", { ascending: false }).limit(uid ? 3 : 6);
  if (!rows?.length) return json({ ok: true, narrated: 0, reason: "nothing missing audio" });

  let ek = Deno.env.get("ELEVEN_API_KEY") ?? "";
  if (!ek) { const { data } = await admin.rpc("get_secret", { secret_name: "eleven_api_key" }); ek = data ?? ""; }
  let key = Deno.env.get("MARA_API_KEY") ?? "";
  if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
  if (!ek) return json({ ok: false, error: "tts not configured" }, 500);
  const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const testIds = new Set((au?.users ?? []).filter((u) => u.email?.endsWith("assetly.test")).map((u) => u.id));
  const voice = Deno.env.get("ELEVEN_VOICE_ID") ?? "JBFqnCBsd6RMkjVDRZzb";

  const scriptOnly = body.script_only === true;
  let narrated = 0; const errors: string[] = []; const scripts: Record<string, string> = {};
  for (const row of rows) {
    if (!scriptOnly && testIds.has(row.user_id)) continue;
    if (elapsed() > 110) { errors.push("wall clock; remaining rows next sweep"); break; }
    try {
      const s = row.sections as Sections;
      const dayLine = new Date(String(row.brief_date) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      const ed = String(row.edition);
      // every edition speaks BLUF in at most ~90 seconds at a NORMAL pace: bottom line first, then only what matters
      const spec = ed === "midday" ? { len: "a 60-to-80 second (150-190 word)", who: "midday-desk", floor: 110 }
        : ed === "close" ? { len: "a 75-to-90 second (170-210 word)", who: "end-of-day", floor: 130 }
        : ed === "assessment" ? { len: "a 75-to-90 second (170-215 word)", who: "portfolio-strategist", floor: 130 }
        : { len: "a 75-to-90 second (170-210 word)", who: "morning-desk", floor: 130 };
      // The FIDELITY law alone did not stop an invented threshold ("below seventy thousand dollars" with no
      // such figure anywhere in the brief), so the allowed figures are handed over explicitly.
      const figuresOf = (obj: unknown): string[] => {
        const t = JSON.stringify(obj ?? "");
        return [...new Set((t.match(/-?\d[\d,]*(?:\.\d+)?\s?%|\$\s?[\d,]+(?:\.\d+)?[kKmMbB]?/g) ?? []).map((x) => x.trim()))].slice(0, 24);
      };
      const allowed = figuresOf(s);
      const figureLine = allowed.length
        ? `\nALLOWED FIGURES (the ONLY numbers you may speak, rounded for the ear): ${allowed.join(", ")}. Any other number is a fabrication: if a threshold or level is not in this list, describe it in words instead ("below its trigger level").`
        : "\nThe brief carries no figures: speak none.";
      const isAssess = ed === "assessment";
      const names = await tickerNames(admin, String(row.user_id), JSON.stringify(s));
      const nameLine = names.length ? `\nSPEECH NAMES (say these, never spell a ticker letter by letter): ${names.map(([k, v]) => `${k} = ${v}`).join("; ")}` : "";
      // ---- script: tight-budget model call, else deterministic fallback ----
      let spoken: string | null = null;
      if (key) {
        const prompt = isAssess
          ? `Assessment:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken script of this portfolio assessment, BOTTOM LINE UP FRONT, at a normal unhurried pace. It is the FIRST look at a client's newly added portfolio. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} speaking to ONE client they are just getting to know; confident and OPINIONATED where the facts back it, never wishy-washy; straightforward and data-driven but constructive: a risk always comes with what to watch or do about it, never bare doom. Short sentences. Contractions. STRUCTURE: quick greeting, then the VERDDICT and single most important structural fact in the first two sentences, then only the TWO OR THREE things that matter most (not every position), one clear risk, one thing worth looking into, and the sign-off ("That's your assessment. Talk soon."), which the script MUST end with. NUMBER RULES: at most FIVE numbers in the whole script; round everything for the ear (34.3% becomes thirty-four percent; $43,224 becomes forty-three thousand dollars); never read decimals aloud ABOVE one percent; a figure UNDER one percent keeps its decimal ("zero point two percent"), because rounding 0.2% to "two percent" changes the fact tenfold. FIDELITY: every figure you speak must trace to the assessment. Rounding for the ear is required, changing the fact is not: never turn a percentage into a fraction word that does not match it (a quarter is 25%, a third is 33%, half is 50%); if the fraction is not a clean match, say the rounded percent instead. Insert <break time="0.6s" /> between beats. Use ONLY facts from the assessment. Never tell them to buy or sell. ${await voiceFor(String(row.user_id))} No ticker codes, company names only.${nameLine}${figureLine} Never mention that this is generated.`
          : `Brief:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken radio script of this brief, BOTTOM LINE UP FRONT, at a normal unhurried pace. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} analyst speaking to ONE client they know well; confident and opinionated where the facts back it; constructive: a risk always comes with what to watch or do about it, never bare doom. Short sentences. Contractions. STRUCTURE: quick greeting, then WHAT TODAY MEANS for their money in the first two sentences (never a list of moves), then the two or three things that actually matter with why, one look-ahead, and the sign-off ("That's your brief. Talk soon."), which the script MUST end with. NUMBER RULES: at most FIVE numbers in the whole script; round for the ear (down 2.3% becomes down two percent; $43,224 becomes forty-three thousand dollars); never read a stock-by-stock percentage list. NEVER DROP A DECIMAL: 0.2% is "zero point two percent" and 0.4% is "zero point four percent", never "two percent" or "four percent"; a figure under one percent keeps its decimal or is spoken as "a fraction of a percent". Never tell them to buy, sell, trim, add, or rotate, and never say "keep an eye on": name the risk and what would confirm it instead. FIDELITY: every figure you speak must trace to the brief. Rounding for the ear is required, changing the fact is not: never turn a percentage into a fraction word that does not match it (a quarter is 25%, a third is 33%, half is 50%); if the fraction is not a clean match, say the rounded percent instead. Insert <break time="0.6s" /> between beats. Insert <break time="0.7s" /> between sections. Use ONLY facts from the brief. ${await voiceFor(String(row.user_id))} No ticker codes, company names only.${nameLine}${figureLine} Never mention that this is generated.`;
        for (let a = 0; a < 3 && !spoken; a++) {
          // every edition is written by the fast model: M2.7 over-thinks these shapes and times out, and the
          // deterministic fallback recites every position in turn, which is the laundry list BLUF forbids
          const out = await askModel(key, "You turn a written investment brief into a vivid spoken radio script. Output only the JSON.", prompt, 9000, 35000, "gpt-oss-120b");
          const sp = out && typeof (out as { spoken?: unknown }).spoken === "string" ? String((out as { spoken: string }).spoken) : null;
          // on the last attempt a slightly short model script is still far better than the template
          const floorNow = a === 2 ? Math.round(spec.floor * 0.75) : spec.floor;
          if (sp) { const t = sp.replace(/(?:\s*<break[^>]*\/>\s*)+$/g, "").trim(); if (t.split(/\s+/).length >= floorNow && /[.!?]$/.test(t)) spoken = t; }
        }
      }
      let usedFallback = false;
      if (!spoken) { spoken = fallbackScript(s, dayLine, ed); usedFallback = true; }
      if (scriptOnly) { scripts[`${row.brief_date}-${ed}`] = sayNames(earNumbers(spoken), names); narrated++; continue; }
      spoken = sayNames(earNumbers(spoken.replace(/(\d+(?:\.\d+)?)\s?percent/gi, "$1%").replace(/(\d[\d,]*(?:\.\d+)?)\s?dollars/gi, "$$$1")), names);   // normalize then round: every spoken number comes out rounded, tickers come out as company names
      if (!/(talk soon|see you|that's your|that’s your)/i.test(spoken.slice(-120))) spoken += ` <break time="0.6s" /> ${isAssess ? "That's your assessment." : "That's your brief."} Talk soon.`;
      // ---- TTS: 3 attempts with backoff ----
      let audio: Uint8Array | null = null;
      for (let a = 0; a < 3 && !audio; a++) {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 40000);
        const vr = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
          signal: ac.signal, method: "POST", headers: { "xi-api-key": ek, "Content-Type": "application/json" },
          body: JSON.stringify({ text: spoken, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
        }).catch(() => null);
        clearTimeout(tm);
        if (vr && vr.ok) { const buf = new Uint8Array(await vr.arrayBuffer()); if (buf.length > 20000) audio = buf; }
        else if (vr && (vr.status === 401 || vr.status === 402)) { errors.push(`tts ${vr.status}`); break; }   // key/quota: retrying won't help
        if (!audio && a < 2) await new Promise((r) => setTimeout(r, 3000 * (a + 1)));
      }
      if (!audio) { errors.push(`${String(row.user_id).slice(0, 8)}: tts failed`); continue; }
      const path = `${row.user_id}/${row.brief_date}-${ed}.mp3`;
      const { error: upE } = await admin.storage.from("briefs-audio").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
      if (upE) { errors.push(`${String(row.user_id).slice(0, 8)}: upload ${upE.message}`); continue; }
      await admin.from("daily_briefs").update({ audio_path: path }).eq("id", row.id);
      narrated++;
      if (usedFallback) errors.push(`${String(row.user_id).slice(0, 8)}: fallback script`);   // informational
    } catch (e) { errors.push(String(row.user_id).slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, narrated, considered: rows.length, secs: Math.round(elapsed()), errors: errors.slice(0, 6), ...(scriptOnly ? { scripts } : {}) });
});
