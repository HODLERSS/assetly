// Assetly warmup — the first-five-minutes moment. The instant a symbol is added, pull
// its news, SEC filings, and earnings transcript, then write its FIRST Assetly
// Intelligence card ("while you weren't looking") so the UI never has to say
// "wait for the hourly lap". The hourly session-aware cron owns freshness afterward.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function pctOver(history: { ts: string; price: number }[], days: number): string {
  if (!history.length) return "n/a";
  const cutoff = Date.now() - days * 86400000;
  const start = history.find((h) => +new Date(h.ts) >= cutoff);
  const last = history[history.length - 1];
  if (!start || start === last) return "n/a";
  return (((last.price / start.price) - 1) * 100).toFixed(1) + "%";
}

const deDash = (v: unknown) => String(v).replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");

function parseGlance(raw: string): { bullets: string[]; windows: Record<string, string> } | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  try {
    const o = JSON.parse(cleaned.slice(start, end));
    if (!Array.isArray(o.bullets) || o.bullets.length < 2) return null;
    return { bullets: o.bullets.slice(0, 3).map(deDash), windows: o.trend ? { trend: deDash(o.trend) } : {} };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  if (!symbol || symbol.startsWith("$")) return json({ ok: false, error: "symbol required" }, 400);

  // Fresh-guard: a current insight means the wow is already on the shelf (shared table,
  // so popular symbols cost zero tokens and return instantly).
  const { data: existing } = await admin.from("insights").select("generated_at").eq("symbol", symbol)
    .order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing && Date.now() - +new Date(existing.generated_at) < 50 * 60000) {
    return json({ ok: true, cached: true });
  }

  // Pull the raw material in parallel (each sibling is idempotent + fast).
  if (!fixture) {
    const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const base = Deno.env.get("SUPABASE_URL")!;
    const call = (fn: string) => fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SK}`, apikey: SK, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [symbol] }),
    }).catch(() => null);
    await Promise.all([call("news-sync"), call("filings-sync"), call("transcripts-sync")]);
  }

  const { data: srow } = await admin.from("symbols").select("name,kind").eq("symbol", symbol).maybeSingle();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: news }, { data: fils }, { data: tr }, { data: hist }] = await Promise.all([
    admin.from("news").select("title,source,published_at").eq("symbol", symbol).gte("published_at", since30)
      .order("published_at", { ascending: false }).limit(12),
    admin.from("filings").select("form,filed_at").eq("symbol", symbol).order("filed_at", { ascending: false }).limit(6),
    admin.from("transcripts").select("title,content,published_at").eq("symbol", symbol)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(1),
    admin.from("price_history").select("ts,price").eq("symbol", symbol)
      .gte("ts", new Date(Date.now() - 731 * 86400000).toISOString()).order("ts", { ascending: true }).limit(2000),
  ]);
  const history = (hist ?? []).map((h) => ({ ts: String(h.ts), price: Number(h.price) }));
  const perf = { d30: pctOver(history, 30), y1: pctOver(history, 365), y2: pctOver(history, 730) };
  const latestTr = tr?.[0];

  let content: string | null;
  if (fixture) {
    content = JSON.stringify(body.canned ?? { bullets: ["fixture call verdict with date", "fixture biggest headline take"], trend: "fixture two-year trajectory in one line" });
  } else {
    let key = Deno.env.get("MARA_API_KEY") ?? "";
    if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
    if (!key) return json({ ok: false, error: "not configured" }, 500);
    const prompt = `First-look brief for a retail investor who JUST added ${srow?.name ?? symbol} (${symbol}) to their portfolio.
Price change: 30d ${perf.d30}, 1y ${perf.y1}, 2y ${perf.y2}.
${latestTr ? `Latest earnings call ("${String(latestTr.title).slice(0, 120)}", ${String(latestTr.published_at).slice(0, 10)}):\n${String(latestTr.content).slice(0, 6000)}` : "No earnings call transcript on file."}
${(fils ?? []).length ? `SEC filings: ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}
Headlines (30d):
${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (none on file yet)"}

Return STRICT JSON: {"bullets": [exactly 2 strings], "trend": str}.
bullet 1: the latest earnings call in one line WITH its date. If none on file, the most recent fundamental signal instead, honestly labeled.
bullet 2: the single biggest story of the past month, interpreted, never restated.
trend: the 2-year trajectory in ONE sentence, max 20 words.
Each bullet 10-15 words. Plain punchy language. Never use em dashes or semicolons.`;
    const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7",
        messages: [
          { role: "system", content: "You are a sharp buy-side equity analyst. Respond with the JSON object ONLY, first character '{'. Never write analysis prose outside the JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3, max_tokens: 8000,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return json({ ok: false, error: "model " + r.status }, 502);
    const out = await r.json().catch(() => null);
    content = out?.choices?.[0]?.message?.content ?? null;
  }
  const parsed = content ? parseGlance(content) : null;
  if (!parsed) return json({ ok: false, error: "unparseable" }, 502);
  const { error: insErr } = await admin.from("insights").insert({
    symbol, bullets: parsed.bullets, windows: parsed.windows, model: fixture ? "fixture" : (Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7"),
  });
  if (insErr) return json({ ok: false, error: insErr.message }, 500);
  return json({ ok: true, wrote: true });
});
