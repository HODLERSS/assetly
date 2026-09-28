// Narrate: turn a stored brief into audio. One job, its own 150s wall clock, idempotent, resilient.
//   - script: M2.7 with a TIGHT budget (35s, one retry), else a deterministic script assembled from the
//     sections — TTS always has input, the text API's slow waves can't starve narration.
//   - TTS: ElevenLabs with 3 attempts (backoff), then upload + audio_path. The script itself is saved on the row
//     first, so the app's device voice can read it when the ElevenLabs quota is gone (checked once per run).
//   - callers: daily-brief (fire-and-forget after every write), the backfill sweep (rows missing audio),
//     and the orchestrator. Auth: internal token, service role, or the owning user.
import { composeScript, speechName, type Sections } from "./compose.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readerLevel } from "../_shared/intel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const briefText = (raw: unknown): Sections => {
  const { as_of: _a, day_sign: _s, day_pct: _p, day_usd: _u, held: _h, day_by_symbol: _d, ...rest } = (raw ?? {}) as Record<string, unknown>;
  return rest as unknown as Sections;
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
    const top = readerLevel(lvls);   // round 8: an unknown level reads as intermediate
    void order;
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
  const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const target = (withScript: boolean | null) => {
    let q = admin.from("daily_briefs").select("id, user_id, brief_date, edition, sections, audio_path, script").is("audio_path", null).gte("brief_date", since);
    if (withScript === false) q = q.is("script", null);
    if (uid) q = q.eq("user_id", uid);
    if (briefDate) q = q.eq("brief_date", briefDate);
    if (edition) q = q.eq("edition", edition);
    return q.order("generated_at", { ascending: false }).limit(uid ? 3 : 6);
  };
  // Round 5: rows whose script a repair cleared go FIRST (a repaired morning sat with script NULL and no audio
  // behind newer rows); then the rest of the rows missing audio, up to the same cap
  const { data: first } = await target(false);
  const { data: rest } = (first ?? []).length >= (uid ? 3 : 6) ? { data: [] } : await target(null);
  const seen = new Set<unknown>();
  const rows = [...(first ?? []), ...(rest ?? [])].filter((r) => !seen.has(r.id) && (seen.add(r.id), true)).slice(0, uid ? 3 : 6);
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
  // ElevenLabs quota, checked ONCE per run: below the margin the script is still composed and saved (the app
  // reads it with the device voice) and no TTS call is made, so an exhausted plan degrades on purpose, not on a 402.
  let ttsLeft: number | null = null;   // characters left; null = unknown, let the call decide
  if (!scriptOnly) {
    try {
      const sr = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": ek } });
      if (sr.ok) { const sj = await sr.json(); const lim = Number(sj?.character_limit ?? 0), used = Number(sj?.character_count ?? 0); if (lim > 0) ttsLeft = lim - used; }
    } catch { /* unknown: the TTS call reports 402 on its own */ }
  }
  let narrated = 0; const errors: string[] = []; const scripts: Record<string, string> = {};
  for (const row of rows) {
    // Test accounts never spend TTS credits by default. An OPERATOR holding the internal token can opt a
    // run in (body.tts_test) to produce real audio for a demo, which is the only way to hear a fixture book.
    if (!scriptOnly && testIds.has(row.user_id) && !(isInternal && body.tts_test === true)) continue;
    // 9/28: a restated script with rewrites can take ~100s; never START a row after 45s of a 150s budget
    if (elapsed() > 45) { errors.push("wall clock; remaining rows next sweep"); break; }
    // Round 9 intelligence: the showcase's Listen read a script written for an EARLIER version of the row (a narration
    // started at 00:32:08 landed on the text rewritten at 00:32:28). The script and audio are written only while the
    // row still carries the text they were made from; otherwise the newer version's own narration owns the row.
    const readText = JSON.stringify(row.sections);
    const unchanged = async () => {
      try {
        const { data } = await admin.from("daily_briefs").select("sections").eq("id", row.id).maybeSingle();
        return !!data && JSON.stringify((data as { sections?: unknown }).sections) === readText;
      } catch { return false; }
    };
    const writeIfSame = async (patch: Record<string, unknown>) => {
      if (!(await unchanged())) { errors.push(`${String(row.user_id).slice(0, 8)}: text changed while narrating; left to the newer version`); return false; }
      await admin.from("daily_briefs").update(patch).eq("id", row.id);
      return true;
    };
    try {
      const s = briefText(row.sections);
      const ed = String(row.edition);
      const isAssess = ed === "assessment";
      const names = await tickerNames(admin, String(row.user_id), JSON.stringify(s));
      const savedScript = typeof row.script === "string" && row.script.length > 80 ? row.script : null;
      const c = await composeScript({ s, briefDate: String(row.brief_date), edition: ed, key, names, voiceLine: await voiceFor(String(row.user_id)), savedScript });
      let spoken = c.spoken; const usedFallback = c.usedFallback;
      void isAssess;
      if (c.savedChanged && !(await writeIfSame({ script: spoken }))) continue;
      if ((!savedScript || usedFallback) && !(await writeIfSame({ script: spoken }))) continue;
      if (scriptOnly) { scripts[`${row.brief_date}-${ed}`] = spoken; narrated++; continue; }
      if (ttsLeft !== null && ttsLeft < spoken.length + 100) { errors.push(`${String(row.user_id).slice(0, 8)}: tts quota (${ttsLeft} chars left); script saved for the device voice`); continue; }
      // ---- TTS: 3 attempts with backoff ----
      let audio: Uint8Array | null = null;
      for (let a = 0; a < 3 && !audio; a++) {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 40000);
        // Model (9/28): eleven_v4 during its free window; set ELEVEN_MODEL=eleven_multilingual_v2 to go back.
        // v4 ignores SSML <break> tags (tested: a 1s break added 0.08s), so pauses become paragraph breaks there.
        const ttsModel = Deno.env.get("ELEVEN_MODEL") ?? "eleven_v4";
        const ssml = /multilingual_v2|turbo_v2|flash_v2(?!_5)/.test(ttsModel);
        const ttsText = ssml ? spoken : spoken.replace(/\s*<break[^>]*\/>\s*/g, "\n\n").trim();
        const vr = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
          signal: ac.signal, method: "POST", headers: { "xi-api-key": ek, "Content-Type": "application/json" },
          // Professional voice clone (Minjae, 9/27): style exaggeration is off, as ElevenLabs recommends for a PVC.
          body: JSON.stringify({ text: ttsText, model_id: ttsModel, voice_settings: ssml ? { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true } : { stability: 0.5, similarity_boost: 0.8 } }),
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
      if (!(await writeIfSame({ audio_path: path }))) continue;
      if (ttsLeft !== null) ttsLeft -= spoken.length;
      narrated++;
      if (usedFallback) errors.push(`${String(row.user_id).slice(0, 8)}: fallback script`);   // informational
    } catch (e) { errors.push(String(row.user_id).slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, narrated, considered: rows.length, secs: Math.round(elapsed()), errors: errors.slice(0, 6), ...(scriptOnly ? { scripts } : {}) });
});
