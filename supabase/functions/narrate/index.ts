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
// numbers for the ear: $107,300 -> "a hundred and seven thousand three hundred dollars" is model work; the
// fallback keeps digits but spaces them so TTS reads them cleanly ("107,300 dollars", "5.8 percent")
const earNumbers = (t: string) => t.replace(/\$([\d,]+(?:\.\d+)?)/g, "$1 dollars").replace(/(\d+(?:\.\d+)?)%/g, "$1 percent").replace(/₩([\d,]+)/g, "$1 won");
function fallbackScript(s: Sections, dayLine: string, edition: string): string {
  const greet = edition === "assessment" ? `Hi, it's ${dayLine}. Here's your portfolio assessment.` : edition === "close" ? `Good evening, it's ${dayLine}. Here's your closing note.` : edition === "midday" ? `It's ${dayLine}, midday. Here's your pulse.` : `Good morning, it's ${dayLine}. Here's your brief.`;
  const parts = [greet, earNumbers(s.lede), earNumbers(s.overnight),
    ...s.positions.map((p) => `${p.name}. ${earNumbers(p.note)} ${edition === "assessment" ? "The tripwire:" : "What to watch:"} ${earNumbers(p.watch)}.`),
    earNumbers(s.desk_view),
    ...(edition === "assessment" ? [earNumbers(s.horizon ?? ""), (s.ideas ?? []).length ? "Worth researching: " + earNumbers((s.ideas ?? []).join(". ")) + "." : ""] : []),
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
  if (!isInternal && !isSvc) { const { data: ud } = await admin.auth.getUser(bearer); if (!ud?.user?.id) return json({ ok: false, error: "not signed in" }, 401); uid = ud.user.id; }
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

  let narrated = 0; const errors: string[] = [];
  for (const row of rows) {
    if (testIds.has(row.user_id)) continue;
    if (elapsed() > 110) { errors.push("wall clock; remaining rows next sweep"); break; }
    try {
      const s = row.sections as Sections;
      const dayLine = new Date(String(row.brief_date) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      const ed = String(row.edition);
      const spec = ed === "midday" ? { len: "a 60-to-90 second (150-220 word)", who: "midday-desk", floor: 120 }
        : ed === "close" ? { len: "a 90-second-to-2-minute (200-290 word)", who: "end-of-day", floor: 170 }
        : ed === "assessment" ? { len: "a 2-to-3 minute (330-420 word)", who: "portfolio-strategist", floor: 260 }
        : { len: "a 2-to-3 minute (340-430 word)", who: "morning-desk", floor: 280 };
      const isAssess = ed === "assessment";
      // ---- script: tight-budget model call, else deterministic fallback ----
      let spoken: string | null = null;
      if (key) {
        const prompt = isAssess
          ? `Assessment:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken script of this exact portfolio assessment for expressive text-to-speech. It is the FIRST look at a client's newly added portfolio: its quality, its structure, the next quarter versus the next few years, and gaps worth researching. Not a daily tape note. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} speaking to ONE client they are just getting to know. Short sentences. Contractions. Spell numbers for the ear ("thirty eight percent of your assets"). Vary rhythm; one earned exclamation at most. Structure, all REQUIRED: greeting with the date, the verdict (lede), what they own (overnight), each position with its tripwire (watch), structure and risk (desk_view), the horizons (horizon), what is worth researching (ideas), and a closing sign-off that says goodbye ("That's your assessment. Talk soon."). The script MUST end with that sign-off. Insert <break time="0.7s" /> between sections. Use ONLY facts from the assessment. Never tell them to buy or sell. No ticker codes, company names only. Never mention that this is generated.`
          : `Brief:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken radio script of this exact brief for expressive text-to-speech. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} analyst speaking to ONE client they know well. Short sentences. Contractions. Spell numbers for the ear ("up five point eight percent"). Vary rhythm; one earned exclamation at most. Structure, all REQUIRED: greeting with the date, the lede, the tape, each position with what to watch, the desk view, and a closing sign-off that says goodbye ("That's your brief. Talk soon."). The script MUST end with that sign-off. Insert <break time="0.7s" /> between sections. Use ONLY facts from the brief. No ticker codes, company names only. Never mention that this is generated.`;
        for (let a = 0; a < 2 && !spoken; a++) {
          // the assessment script is written by the fast model: M2.7 over-thinks the longer assessment shape and times out
          const out = await askModel(key, "You turn a written investment brief into a vivid spoken radio script. Output only the JSON.", prompt, 9000, 35000, isAssess ? "gpt-oss-120b" : undefined);
          const sp = out && typeof (out as { spoken?: unknown }).spoken === "string" ? String((out as { spoken: string }).spoken) : null;
          if (sp) { const t = sp.replace(/(?:\s*<break[^>]*\/>\s*)+$/g, "").trim(); if (t.split(/\s+/).length >= spec.floor && /[.!?]$/.test(t)) spoken = t; }
        }
      }
      let usedFallback = false;
      if (!spoken) { spoken = fallbackScript(s, dayLine, ed); usedFallback = true; }
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
  return json({ ok: true, narrated, considered: rows.length, secs: Math.round(elapsed()), errors: errors.slice(0, 6) });
});
