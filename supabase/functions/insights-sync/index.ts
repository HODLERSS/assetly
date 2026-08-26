// Assetly insights-sync — hourly, per held symbol: MARA Cloud (MiniMax M2.7) turns the
// last 7 days of headlines, the latest earnings-call transcript, and multi-horizon price
// action into 3-5 opinionated bullets plus one-line takes for 7D/30D/60D/1Y/2Y.
// Stored in public.insights; rendered clearly separated from raw news. Fixture mode for tests.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const WINDOWS: [string, number][] = [["d7", 7], ["d30", 30], ["d60", 60], ["y1", 365], ["y2", 730]];

function pctOver(history: { ts: string; price: number }[], days: number): string {
  if (!history.length) return "n/a";
  const cutoff = Date.now() - days * 86400000;
  const start = history.find((h) => +new Date(h.ts) >= cutoff);
  const last = history[history.length - 1];
  if (!start || start === last) return "n/a";
  return (((last.price / start.price) - 1) * 100).toFixed(1) + "%";
}

async function askMara(key: string, model: string, prompt: string): Promise<string | null> {
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a sharp buy-side equity analyst writing for busy retail investors. Be specific, opinionated, and honest about uncertainty. Plain language, no hedging filler, no disclaimers. Use concrete numbers from the provided data. Respond with the JSON object ONLY — your first character must be '{'. Never write analysis prose outside the JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3, max_tokens: 6000,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error("mara api " + r.status + " " + (await r.text().catch(() => "")).slice(0, 120));
  const body = await r.json().catch(() => null);
  const c = body?.choices?.[0]?.message?.content;
  if (!c) throw new Error("mara empty content, finish=" + body?.choices?.[0]?.finish_reason);
  return c;
}

function parseInsight(raw: string): { bullets: string[]; windows: Record<string, string> } | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf('{"bullets"') >= 0 ? cleaned.indexOf('{"bullets"') : cleaned.indexOf("{");
  if (start < 0) return null;
  // walk to the matching close brace so trailing prose can't break the parse
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  try {
    const o = JSON.parse(cleaned.slice(start, end));
    if (!Array.isArray(o.bullets) || o.bullets.length < 2) return null;
    return { bullets: o.bullets.slice(0, 5).map(String), windows: o.windows ?? {} };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  let key = Deno.env.get("MARA_API_KEY") ?? "";
  if (!key && !fixture) {
    const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" });
    key = data ?? "";
  }
  const model = Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7";
  if (!key && !fixture) return json({ ok: false, error: "mara_api_key not configured" }, 500);

  const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
  if (hErr) return json({ ok: false, error: hErr.message }, 500);
  const held = [...new Set((heldRows ?? []).map((h) => h.symbol))].filter((s) => !s.startsWith("$") && s !== "USDKRW");
  const only = url.searchParams.get("symbols")?.split(",") ??
    (Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(String) : undefined);
  let targets = held.filter((s) => !only || only.includes(s));
  // Priority: stalest insight first; money invested breaks ties (big positions refresh first).
  const { data: existing } = await admin.from("insights").select("symbol, generated_at")
    .in("symbol", targets).order("generated_at", { ascending: false });
  const age = new Map<string, number>();
  for (const e of existing ?? []) if (!age.has(e.symbol)) age.set(e.symbol, +new Date(e.generated_at));
  const { data: pv } = await admin.from("portfolio").select("symbol, value").in("symbol", targets);
  const invested = new Map<string, number>();
  for (const r of pv ?? []) invested.set(r.symbol, (invested.get(r.symbol) ?? 0) + Number(r.value ?? 0));
  targets = targets.sort((a, b) =>
    (age.get(a) ?? 0) - (age.get(b) ?? 0) || (invested.get(b) ?? 0) - (invested.get(a) ?? 0)).slice(0, 20);

  let wrote = 0;
  const errors: string[] = [];
  for (const symbol of targets) {
    try {
      const { data: srow } = await admin.from("symbols").select("name").eq("symbol", symbol).single();
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: news7 } = await admin.from("news").select("title,source,published_at")
        .eq("symbol", symbol).gte("published_at", since7)
        .order("published_at", { ascending: false }).limit(25);
      const { count: n30 } = await admin.from("news").select("id", { count: "exact", head: true })
        .eq("symbol", symbol).gte("published_at", since30);
      const { data: hist } = await admin.from("price_history").select("ts,price")
        .eq("symbol", symbol).gte("ts", new Date(Date.now() - 731 * 86400000).toISOString())
        .order("ts", { ascending: true }).limit(2000);
      const history = (hist ?? []).map((h) => ({ ts: String(h.ts), price: Number(h.price) }));
      const perf = Object.fromEntries(WINDOWS.map(([k, d]) => [k, pctOver(history, d)]));
      const price = history.length ? history[history.length - 1].price : null;
      const { data: tr } = await admin.from("transcripts").select("title,content,published_at")
        .eq("symbol", symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(4);
      const latestTr = tr?.[0];

      let content: string | null;
      if (fixture) {
        content = JSON.stringify(body.canned ?? { bullets: ["fixture bullet one", "fixture bullet two", "fixture bullet three"], windows: { d7: "flat week", d30: "quiet month", d60: "range-bound", y1: "recovering", y2: "volatile" } });
      } else {
        const prompt = `Company: ${srow?.name ?? symbol} (${symbol}). Current price ${price}. Price change by window: ${JSON.stringify(perf)}.
Headlines from the last 7 days (${n30 ?? 0} stories in 30d):
${(news7 ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (no fresh headlines)"}
${latestTr ? `\nLatest earnings call ("${latestTr.title}", ${latestTr.published_at}):\n${String(latestTr.content).slice(0, 7000)}\n${(tr ?? []).slice(1).length ? "Older calls on file: " + (tr ?? []).slice(1).map((t) => t.title).join(" | ") : ""}` : "\n(no earnings transcript on file yet)"}

Return STRICT JSON: {"bullets": [3-5 strings], "windows": {"d7": str, "d30": str, "d60": str, "y1": str, "y2": str}}.
bullets: your sharpest takes on what actually matters for this company RIGHT NOW — synthesize the recent news, the earnings call substance, and the price action; each <= 20 words; specific, opinionated, useful. Do not restate headlines; interpret them.
windows: one crisp line each (<= 12 words) on what that horizon's move means.`;
        content = await askMara(key, model, prompt);
      }
      const parsed = content ? parseInsight(content) : null;
      if (!parsed) { errors.push(symbol + ": unparseable raw[" + String(content).slice(0, 260).replace(/\n/g, " ") + "]"); continue; }
      const { error: upErr } = await admin.from("insights").insert({
        symbol, bullets: parsed.bullets, windows: parsed.windows, model,
      });
      if (upErr) errors.push(symbol + ": " + upErr.message); else wrote++;
    } catch (e) { errors.push(symbol + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  // ---- portfolio-level insights: per user, their actual mix ----
  let pWrote = 0;
  const { data: pf } = await admin.from("portfolio").select("user_id, symbol, kind, account, currency, value, change_pct, nickname");
  const byUser = new Map<string, NonNullable<typeof pf>>();
  for (const r of pf ?? []) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }
  const { data: fxRow } = await admin.from("prices").select("price").eq("symbol", "USDKRW").maybeSingle();
  const fx = fxRow ? Number(fxRow.price) : 1380;
  const userIds = fixture ? [...byUser.keys()] : [...byUser.keys()].slice(0, 25);
  for (const uid of userIds) {
    try {
      const rows = byUser.get(uid)!;
      const usd = (r: (typeof rows)[number]) => (r.currency === "KRW" ? Number(r.value ?? 0) / fx : Number(r.value ?? 0));
      const assets = rows.filter((r) => r.kind !== "debt");
      const debt = rows.filter((r) => r.kind === "debt").reduce((a, r) => a + usd(r), 0);
      const total = assets.reduce((a, r) => a + usd(r), 0);
      if (total < 100) continue;                                   // nothing meaningful to say
      const desc = assets.sort((a, b) => usd(b) - usd(a)).slice(0, 15)
        .map((r) => `${r.nickname || r.symbol} (${r.kind}${r.account !== "brokerage" ? ", " + r.account : ""}): $${Math.round(usd(r))} = ${(usd(r) / total * 100).toFixed(1)}% of assets, day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}`).join("\n");
      const { data: symIns } = await admin.from("insights").select("symbol, bullets, generated_at")
        .in("symbol", assets.map((r) => r.symbol)).order("generated_at", { ascending: false }).limit(30);
      const latestBySym = new Map<string, string>();
      for (const i of symIns ?? []) if (!latestBySym.has(i.symbol)) latestBySym.set(i.symbol, (i.bullets as string[])[0] ?? "");
      let content: string | null;
      if (fixture) {
        content = JSON.stringify(body.cannedPortfolio ?? { bullets: ["portfolio fixture one", "portfolio fixture two", "portfolio fixture three"] });
      } else {
        const prompt = `A retail investor's portfolio (total assets $${Math.round(total)}, debt $${Math.round(debt)}):
${desc}
Sharpest current takes per holding:
${[...latestBySym.entries()].map(([sym, b]) => `- ${sym}: ${b}`).join("\n") || "- (none yet)"}

Return STRICT JSON: {"bullets": [3-5 strings]}. You are their portfolio strategist: assess concentration, what actually moved their money today, cross-holding themes, and one thing they should watch or consider. Each bullet <= 22 words, specific to THIS portfolio (use the numbers), opinionated, useful. No generic advice.`;
        content = await askMara(key, model, prompt);
      }
      const parsed = content ? parseInsight(content) : null;
      if (!parsed) { errors.push("user " + uid.slice(0, 8) + ": unparseable"); continue; }
      const { error: piErr } = await admin.from("portfolio_insights").insert({ user_id: uid, bullets: parsed.bullets, model });
      if (piErr) errors.push("user " + uid.slice(0, 8) + ": " + piErr.message); else pWrote++;
    } catch (e) { errors.push("user: " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, portfolios: userIds.length, portfolioWrote: pWrote, errors: errors.slice(0, 5) });
});
