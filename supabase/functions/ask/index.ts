// Assetly ASK — direct, analytical answers about YOUR portfolio, grounded in the DB.
// Deterministic stats are computed server-side and handed to the model, so numbers
// are never hallucinated. MARA Cloud MiniMax M2.7.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function pctOver(history: { ts: string; price: number }[], days: number): number | null {
  if (history.length < 2) return null;
  const cutoff = Date.now() - days * 86400000;
  const start = history.find((h) => +new Date(h.ts) >= cutoff);
  const last = history[history.length - 1];
  if (!start || start === last) return null;
  return ((last.price / start.price) - 1) * 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ ok: false, error: "sign in required" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").slice(0, 500).trim();
  if (!question) return json({ ok: false, error: "ask something" }, 400);

  // ---- deterministic portfolio math (the model never invents numbers) ----
  const { data: rows } = await admin.from("portfolio").select("symbol,nickname,kind,account,currency,qty,value,change_pct,avg_cost,total_gl").eq("user_id", u.user.id);
  const { data: fxRow } = await admin.from("prices").select("price").eq("symbol", "USDKRW").maybeSingle();
  const fx = fxRow ? Number(fxRow.price) : 1380;
  const usd = (v: number, c: string) => (c === "KRW" ? v / fx : v);
  const held = (rows ?? []).filter((r) => !r.symbol.startsWith("$"));
  const windows = [7, 30, 90];
  const stats: string[] = [];
  let totNow = 0;
  const totThen: Record<number, number> = { 7: 0, 30: 0, 90: 0 };
  for (const r of rows ?? []) {
    const sign = r.kind === "debt" ? -1 : 1;
    const vNow = usd(Number(r.value ?? 0), r.currency) * sign;
    totNow += vNow;
    let line = `${r.nickname || r.symbol} (${r.kind}${r.account !== "brokerage" ? "/" + r.account : ""}): now $${Math.round(usd(Number(r.value ?? 0), r.currency))}, day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}, avg cost ${Number(r.avg_cost ?? 0).toFixed(2)} ${r.currency}, total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`;
    if (!r.symbol.startsWith("$")) {
      const { data: hist } = await admin.from("price_history").select("ts,price")
        .eq("symbol", r.symbol).gte("ts", new Date(Date.now() - 91 * 86400000).toISOString())
        .order("ts", { ascending: true }).limit(1500);
      const h = (hist ?? []).map((x) => ({ ts: String(x.ts), price: Number(x.price) }));
      for (const d of windows) {
        const p = pctOver(h, d);
        if (p !== null) {
          const then = vNow / (1 + p / 100);
          totThen[d] += then;
          if (d === 7) line += `, 1W ${p.toFixed(1)}% ($${Math.round(vNow - then)})`;
          if (d === 30) line += `, 1M ${p.toFixed(1)}% ($${Math.round(vNow - then)})`;
        } else totThen[d] += vNow;
      }
    } else { for (const d of windows) totThen[d] += vNow; }
    stats.push(line);
  }
  const totalLines = windows.map((d) => {
    const delta = totNow - totThen[d];
    const pct = totThen[d] !== 0 ? (delta / totThen[d]) * 100 : 0;
    return `${d}D: $${Math.round(delta)} (${pct.toFixed(1)}%)`;
  }).join(" · ");

  // ---- context for mentioned symbols ----
  const qUp = question.toUpperCase();
  const mentioned = held.filter((r) => qUp.includes(r.symbol.toUpperCase().replace(".KS", "").replace(".KQ", "")) || (r.nickname && qUp.includes(r.nickname.toUpperCase()))).map((r) => r.symbol).slice(0, 3);
  let context = "";
  for (const sym of mentioned) {
    const { data: news } = await admin.from("news").select("title,source,published_at").eq("symbol", sym)
      .gte("published_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("published_at", { ascending: false }).limit(12);
    const { data: ins } = await admin.from("insights").select("bullets,generated_at").eq("symbol", sym)
      .order("generated_at", { ascending: false }).limit(1);
    const { data: fils } = await admin.from("filings").select("form,filed_at,title").eq("symbol", sym)
      .order("filed_at", { ascending: false }).limit(6);
    const { data: tr } = await admin.from("transcripts").select("title,content").eq("symbol", sym)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(1);
    context += `\n[${sym}] 7d headlines:\n${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- none"}`;
    if (ins?.[0]) context += `\n[${sym}] current AI take: ${(ins[0].bullets as string[]).join(" | ")}`;
    if (fils?.length) context += `\n[${sym}] SEC filings: ${fils.map((f) => `${f.form} ${f.filed_at}`).join(", ")}`;
    if (tr?.[0]) context += `\n[${sym}] latest earnings call (${tr[0].title}): ${String(tr[0].content).slice(0, 3000)}`;
  }

  const prompt = `User's portfolio (all $ figures USD at ₩${Math.round(fx)}/$):
${stats.join("\n")}
Portfolio total: $${Math.round(totNow)} · movement ${totalLines}
${context}

Question: "${question}"

Answer as their analyst: direct, specific, concise. Use ONLY the numbers above — never invent figures. Prefer 2-5 short bullets or <=90 words. If the question needs data you don't have, say exactly what's missing in one line.`;

  if (fixture) return json({ ok: true, answer: "FIXTURE\n" + "TOTAL:" + Math.round(totNow) + "\n" + totalLines, mentioned });

  let key = Deno.env.get("MARA_API_KEY") ?? "";
  if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
  if (!key) return json({ ok: false, error: "not configured" }, 500);
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7",
      messages: [
        { role: "system", content: "You are a direct, analytical portfolio assistant. Straightforward, concise, opinionated where the data supports it. Plain text (bullets with • allowed). Never invent numbers. No disclaimers." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2, max_tokens: 4000,
    }),
  });
  if (!r.ok) return json({ ok: false, error: "model " + r.status }, 502);
  const out = await r.json().catch(() => null);
  const answer = (out?.choices?.[0]?.message?.content ?? "").trim();
  if (!answer) return json({ ok: false, error: "empty answer" }, 502);
  return json({ ok: true, answer, mentioned });
});
