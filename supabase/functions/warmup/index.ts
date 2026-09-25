// Assetly warmup — first-look intelligence in TWO passes.
// Pass 1 (critical path, target <=5s): latest news + whatever transcript/filings are
//   already on file -> quick 2-bullet glance, inserted immediately.
// Pass 2 (background, EdgeRuntime.waitUntil): full transcript/filing pull, then a
//   richer regeneration that silently upgrades the card. The hourly cron owns it after.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { backfillShort, windowReturns } from "../_shared/history.ts";
import { EVIDENCE_LAW, isEarningsCallTitle, isJunkNews, pctText } from "../_shared/intel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function askModel(key: string, prompt: string, maxTokens: number): Promise<string | null> {
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("MARA_MODEL") ?? "MiniMax-M3",
      messages: [
        { role: "system", content: "You are a sharp buy-side equity analyst. Respond with the JSON object ONLY, first character '{'. Be fast and decisive, no deliberation. Never write analysis prose outside the JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2, max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) return null;
  const out = await r.json().catch(() => null);
  return out?.choices?.[0]?.message?.content ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  if (!symbol || symbol.startsWith("$")) return json({ ok: false, error: "symbol required" }, 400);

  const { data: existing } = await admin.from("insights").select("generated_at").eq("symbol", symbol)
    .order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing && Date.now() - +new Date(existing.generated_at) < 50 * 60000) {
    return json({ ok: true, cached: true });
  }

  const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const base = Deno.env.get("SUPABASE_URL")!;
  const call = (fn: string) => fetch(`${base}/functions/v1/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SK}`, apikey: SK, "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: [symbol] }),
  }).catch(() => null);

  let key = "";
  if (!fixture) {
    key = Deno.env.get("MARA_API_KEY") ?? "";
    if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
    if (!key) return json({ ok: false, error: "not configured" }, 500);
    // Pass 1 waits for news (and a year of daily prices for a symbol held for the first time) at most 3.5s;
    // everything slower belongs to pass 2. The backfill is what gives a new holding real 1M / 1Y windows.
    const since6h = new Date(Date.now() - 6 * 3600000).toISOString();
    const { count: nFresh } = await admin.from("news").select("id", { count: "exact", head: true })
      .eq("symbol", symbol).gte("published_at", since6h);
    await Promise.race([Promise.all([nFresh ? Promise.resolve(null) : call("news-sync"), backfillShort(admin, [symbol], { cap: 1 }).catch(() => null)]), sleep(3500)]);
  }

  const gather = async (deep: boolean) => {
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data: srow }, { data: newsRaw }, { data: fils }, { data: tr }, wr] = await Promise.all([
      admin.from("symbols").select("name,kind,currency").eq("symbol", symbol).maybeSingle(),
      admin.from("news").select("title,url,source,published_at").eq("symbol", symbol).gte("published_at", since30)
        .order("published_at", { ascending: false }).limit(deep ? 24 : 16),
      admin.from("filings").select("form,filed_at").eq("symbol", symbol).order("filed_at", { ascending: false }).limit(6),
      admin.from("transcripts").select("title,content,published_at").eq("symbol", symbol)
        .order("published_at", { ascending: false, nullsFirst: false }).limit(4),
      // windows read point by point: the old ascending 2,000-row pull was capped at 1,000 rows and a thin
      // history made every window "since it was added"
      windowReturns(admin, symbol, [30, 365, 730]),
    ]);
    const news = (newsRaw ?? []).filter((n) => !isJunkNews(n.title, n.url, n.source)).slice(0, deep ? 12 : 8);
    const perf = { d30: pctText(wr.pct[30] ?? null), y1: pctText(wr.pct[365] ?? null), y2: pctText(wr.pct[730] ?? null) };
    // a conference talk is not an earnings call
    const latestTr = (tr ?? []).find((t) => isEarningsCallTitle(t.title));
    const korean = symbol.endsWith(".KS") || symbol.endsWith(".KQ") || srow?.currency === "KRW";
    const prompt = `First-look brief for a retail investor who JUST added ${srow?.name ?? symbol} (${symbol}).
Price change: 30d ${perf.d30}, 1y ${perf.y1}, 2y ${perf.y2} ("not enough price history yet" means no figure exists; never estimate one).
${latestTr ? `Latest earnings call ("${String(latestTr.title).slice(0, 120)}", ${String(latestTr.published_at).slice(0, 10)}):\n${String(latestTr.content).slice(0, deep ? 6000 : 3000)}` : "No earnings call transcript on file."}
${(fils ?? []).length ? `SEC filings: ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}
Headlines (30d):
${news.map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (none on file yet)"}
${EVIDENCE_LAW}

Return STRICT JSON: {"bullets": [exactly 2 strings], "trend": str}.
bullet 1: the latest earnings call in one line WITH its date. If none on file, the most recent fundamental signal instead, honestly labeled.
bullet 2: the single biggest story of the past month, interpreted, never restated.
trend: the 2-year trajectory in ONE sentence, max 20 words.
Each bullet 10-15 words. Refer to the company by NAME, never numeric KRX codes.${korean ? " Write won amounts with the \u20a9 sign." : " Money is US dollars; never write won."} Plain punchy language. Never use em dashes or semicolons.`;
    return { prompt, hadTranscript: !!latestTr, newsCount: news.length };
  };

  const writeGlance = async (content: string | null) => {
    const parsed = content ? parseGlance(content) : null;
    if (!parsed) return false;
    const { error: e } = await admin.from("insights").insert({
      symbol, bullets: parsed.bullets, windows: parsed.windows,
      model: fixture ? "fixture" : (Deno.env.get("MARA_MODEL") ?? "MiniMax-M3"),
    });
    return !e;
  };

  // ---- pass 1: fast ----
  const g1 = await gather(false);
  let content: string | null;
  if (fixture) content = JSON.stringify(body.canned ?? { bullets: ["fixture call verdict with date", "fixture biggest headline take"], trend: "fixture two-year trajectory in one line" });
  else content = await askModel(key, g1.prompt, 5000);
  const wrote = await writeGlance(content);
  if (!wrote && !fixture) {
    // one immediate retry on a transient model failure keeps the promise to the UI
    const retry = await askModel(key, g1.prompt, 5000);
    if (!(await writeGlance(retry))) return json({ ok: false, error: "unparseable" }, 502);
  } else if (!wrote) {
    return json({ ok: false, error: "unparseable" }, 502);
  }

  // ---- pass 2: background enrichment (transcript + filings), never blocks the card ----
  if (!fixture && !g1.hadTranscript) {
    const enrich = (async () => {
      try {
        await Promise.all([call("transcripts-sync"), call("filings-sync")]);
        const g2 = await gather(true);
        if (g2.hadTranscript || g2.newsCount > g1.newsCount) {
          const richer = await askModel(key, g2.prompt, 8000);
          await writeGlance(richer);
        }
      } catch { /* the hourly lap covers it */ }
    })();
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(enrich); }
    catch { /* runtime without waitUntil: enrichment may be cut short; hourly covers */ }
  }
  return json({ ok: true, wrote: true, deep: g1.hadTranscript });
});
