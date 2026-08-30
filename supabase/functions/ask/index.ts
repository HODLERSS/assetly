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

/** Pull the question-relevant windows out of a long transcript instead of the
 *  boilerplate intro (operator, safe-harbor) that always leads these pages. */
function excerptFor(content: string, question: string): string {
  const c = String(content);
  if (c.length <= 4500) return c;
  const words = question.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const stop = new Set(["the","and","what","are","this","that","view","views","about","does","how","why","when","tell","their","your","latest","recent","say","said"]);
  const keys = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 6);
  const lower = c.toLowerCase();
  const spans: [number, number][] = [[0, 1200]];
  for (const k of keys) {
    let idx = 0, found = 0;
    while (found < 2) {
      const i = lower.indexOf(k, idx);
      if (i < 0) break;
      spans.push([Math.max(0, i - 600), Math.min(c.length, i + 1400)]);
      idx = i + 1400; found++;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) { const l = merged[merged.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else merged.push([sp[0], sp[1]]); }
  let out = "";
  for (const [a, b] of merged) { out += c.slice(a, b) + "\n[...]\n"; if (out.length > 6000) break; }
  return out.slice(0, 6500);
}

/** M2.7 narrates its reasoning unless forced into JSON; extract only the answer. */
function parseAnswer(raw: string): { answer: string; followups: string[] } | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf('{"answer"') >= 0 ? cleaned.indexOf('{"answer"') : cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  try {
    const o = JSON.parse(cleaned.slice(start, end));
    if (!o.answer) return null;
    const followups = Array.isArray(o.followups) ? o.followups.map(String).filter((f: string) => f.trim()).slice(0, 3) : [];
    return { answer: String(o.answer), followups };
  } catch { return null; }
}

/** Keep the hard 20-second-read guarantee even when the model overruns: cut at
 *  line boundaries down to ~95 words (whole first line survives regardless). */
function trimAnswer(a: string): string {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  if (words(a) <= 100) return a;
  const lines = a.split("\n");
  let out: string[] = [], n = 0;
  for (const ln of lines) {
    const w = words(ln);
    if (out.length && n + w > 95) break;
    out.push(ln); n += w;
  }
  let joined = out.join("\n");
  if (words(joined) > 100) joined = joined.split(/\s+/).slice(0, 95).join(" ") + " …";
  return joined;
}


// ---- reader profile: the 6 sign-up answers steer VOICE, EMPHASIS and PURPOSE, never the facts ----
type Investor = { styles?: string[]; purpose?: string; horizon?: string; target?: string; risk?: string; level?: string };
function readerBlock(inv: Investor | null | undefined): string {
  const v = { styles: ["value"], purpose: "watch", horizon: "3-10y", target: "8-12%", risk: "hold", level: "novice", ...(inv ?? {}) };
  const styleG: Record<string, string> = {
    value: "valuation, moat, margin of safety and downside first",
    growth: "revenue growth, market size and execution first",
    income: "yield, payout safety and income stability first",
    index: "diversification, costs and factor tilts first",
    ai_tech: "AI and technology-cycle positioning first",
    trader: "catalysts, momentum and actionable levels first",
    crypto: "crypto cycles, flows and custody risk first",
  };
  const purpG: Record<string, string> = {
    watch: "They mainly want to STAY ON TOP of what they already own: lead with what changed and what it means for their book.",
    ideas: "They are hunting their NEXT investment in the coming weeks: emphasize research directions, screening angles and gaps worth exploring (still never a direct buy or sell instruction).",
    news: "They mainly want the SIGNAL STREAM: lead with the freshest material development and why it matters.",
    learn: "They want to LEARN as they go: give one short line of reasoning behind each conclusion.",
  };
  const lvlG: Record<string, string> = {
    novice: "BEGINNER reader: plain words, short sentences. NO bare acronyms or jargon ANYWHERE, including watch items and bullets. Banned for this reader: EVERY financial acronym and term of art, including ROE, ROIC, EBITDA, FCF, P/E, EPS, AUM, NIM, capex, basis points, net flows, net interest margin (say: lending profit margin), and the bare word moat (say: a lasting edge over competitors). Use the plain phrase instead: profit growth not ROE, cash flow not FCF, operating profit not EBITDA. Ticker symbols with weights (like QQQM 25.6%) are fine, they are names, not jargon. If a term is unavoidable, gloss it in-line (like: free cash flow, the cash left after all expenses). Never condescend.",
    intermediate: "Informed reader: plain language, common financial terms need no explanation.",
    advanced: "Advanced reader: precise financial vocabulary welcome, no hand-holding.",
    pro: "Professional reader: dense, technical, desk-note register.",
  };
  const horG: Record<string, string> = {
    "<1y": "SHORT horizon: near-term catalysts and levels matter most",
    "1-3y": "1-3 year horizon: balance near catalysts with the medium-term case",
    "3-10y": "3-10 year horizon: structural quality and compounding outweigh weekly noise",
    "10y+": "10+ year horizon: long-run compounding is everything; day-to-day noise barely matters",
  };
  const riskG: Record<string, string> = {
    buy_more: "treats drawdowns as buying opportunities", hold: "holds through drawdowns",
    trim: "trims into weakness", sell: "is quick to cut losses; flag risk early and clearly",
  };
  const st = (Array.isArray(v.styles) && v.styles.length ? v.styles : ["value"]).map((x) => styleG[x] ?? "").filter(Boolean).join("; also ");
  return `READER PROFILE (personalize EMPHASIS, VOCABULARY and FRAMING for this one reader; facts and numbers stay identical):
- ${lvlG[v.level] ?? lvlG.novice}
- Lens: ${st || styleG.value}. Apply the lens TO this book in EVERY position note and the structure section: the first judgment in each comes through this lens (value: what it is worth versus its price and the downside; income: state in EVERY position note whether and roughly how well that holding pays the owner, dividend or yield posture included, and in the structure section how much income the whole book actually produces), even when the book does not match the lens. The one-line verdict may still name what kind of book it is.
- ${purpG[v.purpose] ?? purpG.watch}
- ${horG[v.horizon] ?? horG["3-10y"]}; target return ${v.target}/yr; ${riskG[v.risk] ?? riskG.hold}.`;
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
  const { data: invRow } = await admin.from("profiles").select("investor").eq("id", u.user.id).maybeSingle();
  const READER = readerBlock(invRow?.investor as Investor | null);
  const { data: fxRow } = await admin.from("prices").select("price").eq("symbol", "USDKRW").maybeSingle();
  const fx = fxRow ? Number(fxRow.price) : 1380;
  const { data: fxRows } = await admin.from("prices").select("symbol,price").like("symbol", "USD___");
  const fxMap = new Map<string, number>([["USD", 1], ["KRW", fx]]);
  for (const r of fxRows ?? []) { const v = Number(r.price); if (v > 0) fxMap.set(String(r.symbol).slice(3), v); }
  const usd = (v: number, c: string) => v / (fxMap.get(c) ?? 1);
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

  // ---- signal digest for EVERY holding (news, filings, earnings calls) ----
  let digest = "";
  const digSyms = held.slice(0, 12).map((r) => r.symbol);
  if (digSyms.length) {
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const [{ data: dn }, { data: dt }, { data: df }] = await Promise.all([
      admin.from("news").select("symbol,title,source,published_at").in("symbol", digSyms).gte("published_at", since14).order("published_at", { ascending: false }).limit(80),
      admin.from("transcripts").select("symbol,title,published_at").in("symbol", digSyms).order("published_at", { ascending: false, nullsFirst: false }).limit(48),
      admin.from("filings").select("symbol,form,filed_at").in("symbol", digSyms).order("filed_at", { ascending: false }).limit(60),
    ]);
    for (const s of digSyms) {
      const tt = (dt ?? []).filter((x) => x.symbol === s).slice(0, 1).map((x) => `latest earnings call ${String(x.published_at).slice(0, 10)}`);
      const ff = (df ?? []).filter((x) => x.symbol === s).slice(0, 2).map((x) => `${x.form} ${String(x.filed_at).slice(5, 10)}`);
      const nn = (dn ?? []).filter((x) => x.symbol === s).slice(0, 2).map((x) => `"${String(x.title).slice(0, 90)}" [${x.source} ${String(x.published_at).slice(5, 10)}]`);
      const bits = [...tt, ...(ff.length ? ["filings " + ff.join(", ")] : []), ...nn];
      if (bits.length) digest += `\n${s}: ${bits.join(" · ")}`;
    }
  }

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
    const { data: trAll } = await admin.from("transcripts").select("title,published_at,content").eq("symbol", sym)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(4);
    context += `\n[${sym}] 7d headlines:\n${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- none"}`;
    if (ins?.[0]) context += `\n[${sym}] current AI take: ${(ins[0].bullets as string[]).join(" | ")}`;
    if (fils?.length) context += `\n[${sym}] SEC filings: ${fils.map((f) => `${f.form} ${f.filed_at}`).join(", ")}`;
    if (trAll?.length) {
      context += `\n[${sym}] earnings calls on file: ${trAll.map((t) => `${String(t.title).slice(0, 90)} (${String(t.published_at).slice(0, 10)})`).join(" ; ")}`;
      const latest = trAll[0];
      if (latest.content && String(latest.content).length > 200) context += `\n[${sym}] latest call excerpts (question-relevant windows): ${excerptFor(String(latest.content), question)}`;
    }
  }

  const prompt = `User's portfolio (all $ figures USD at ₩${Math.round(fx)}/$):
${stats.join("\n")}
Portfolio total: $${Math.round(totNow)} · movement ${totalLines}
Signals on file per holding (earnings calls, SEC filings, headlines):${digest || "\n(none)"}
${context}

Question: "${question}"

${READER}
Answer as THEIR analyst (see the reader profile): direct, specific, tight. Ground qualitative answers in the signals, headlines, filings, and earnings-call material above, not just prices. Numbers must come only from the stats block. Earnings-call titles and dates listed are reliable even when the excerpt is partial. HARD LIMIT: 80 words total, 3-5 short bullets max, readable on a phone in under 20 seconds. No preamble, no repetition. If the question needs data you truly don't have, one line saying exactly what's missing.`;

  if (fixture) return json({ ok: true, answer: "FIXTURE\n" + "TOTAL:" + Math.round(totNow) + "\n" + totalLines, followups: ["Fixture follow-up one?", "Fixture follow-up two?"], mentioned });

  let key = Deno.env.get("MARA_API_KEY") ?? "";
  if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
  if (!key) return json({ ok: false, error: "not configured" }, 500);
  let parsedA: { answer: string; followups: string[] } | null = null;
  // Reliability: each attempt gets a hard timeout (a hung call otherwise eats the whole 150s and surfaces
  // as a transport error = "unavailable"); 3 attempts with short backoff outlast a slow wave.
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3 && !parsedA; attempt++) {
  if (Date.now() - t0 > 110000) break;
  if (attempt > 0) await new Promise((res) => setTimeout(res, 2500 * attempt));
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), attempt === 0 ? 45000 : 35000);
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    signal: ac.signal,
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7",
      messages: [
        { role: "system", content: 'You are a direct, analytical portfolio assistant. Respond ONLY with strict JSON: {"answer": "...", "followups": ["...", "..."]}. Your first character must be {. The answer value: plain text, • bullets and **bold** allowed, 80 words MAX, no preamble, no repeated points, never narrate your reasoning, never invent numbers, never use em dashes, no disclaimers. Refer to Korean companies by name, never numeric KRX codes; write won amounts with the \u20a9 sign. The followups value: AFTER writing the answer, reread it and offer 2-3 natural next questions this user would ask, each under 12 words, ending with ?, answerable from their portfolio stats, news, SEC filings, or earnings-call data, and never repeating the question just answered.' },
        { role: "user", content: prompt },
      ],
      temperature: attempt === 0 ? 0.2 : 0.4, max_tokens: 6000,
      response_format: { type: "json_object" },
    }),
  }).catch(() => null);
  clearTimeout(timer);
  if (!r || !r.ok) { continue; }
  const out = await r.json().catch(() => null);
  parsedA = parseAnswer(out?.choices?.[0]?.message?.content ?? "");
  }
  const deDash = (v: string) => v.trim().replace(/\s*\u2014\s*/g, ": ").replace(/\s*\u2013\s*/g, ": ");
  const answer = trimAnswer(deDash(parsedA?.answer ?? ""));
  if (!answer) return json({ ok: false, error: "The analyst lost the thread mid-answer. Ask again." }, 502);
  return json({ ok: true, answer, followups: (parsedA?.followups ?? []).map(deDash), mentioned });
});
