// Assetly Daily Brief — three personal research notes per trading day: morning (pre-open,
// full 4-stage chain), midday pulse (11am CT, live tape vs the morning view), closing note
// (post-close, day tally + next-session setup). Edition resolves from the clock or body.edition.
// Four-stage chain, token-maximalist by design:
//   1 analyst memos  (parallel, one per top holding: full transcript + news + filings)
//   2 devil's advocate (attacks the memos: what's overstated, what's missing)
//   3 editor synthesis (memos + rebuttals + market context + yesterday's brief -> the note)
//   4 fact-check       (every number verified against the deterministic stats, or cut)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const LEADERS = ["NVDA", "AAPL", "MSFT", "TSLA", "META", "AMZN", "GOOGL"];

const deDash = (v: string) => v.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");
function deepDeDash<T>(v: T): T {
  if (typeof v === "string") return deDash(v) as unknown as T;
  if (Array.isArray(v)) return v.map(deepDeDash) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = deepDeDash(val);
    return o as unknown as T;
  }
  return v;
}

function parseJsonBlock(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(cleaned.slice(start, end)); } catch { return null; }
}

let lastMeta = "";   // finish_reason + content length of the most recent call (diagnostics)
async function askModel(key: string, system: string, prompt: string, maxTokens: number, timeoutMs = 30000): Promise<Record<string, unknown> | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    signal: ac.signal,
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7",
      messages: [
        { role: "system", content: system + " Respond with the JSON object ONLY, first character '{'. Never write prose outside the JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.25, max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  }).catch(() => null);
  clearTimeout(timer);
  if (!r || !r.ok) { lastMeta = "http=" + (r ? r.status : "abort"); return null; }
  const out = await r.json().catch(() => null);
  const c = out?.choices?.[0]?.message?.content;
  lastMeta = "fr=" + (out?.choices?.[0]?.finish_reason ?? "?") + " clen=" + String(c ?? "").length;
  return c ? parseJsonBlock(String(c)) : null;
}

const krName = (sy: string, nick?: string | null, nm?: string | null) =>
  (nick || ((sy.endsWith(".KS") || sy.endsWith(".KQ")) && nm ? nm : sy));

function pctOver(history: { ts: string; price: number }[], days: number): string {
  if (!history.length) return "n/a";
  const cutoff = Date.now() - days * 86400000;
  const start = history.find((h) => +new Date(h.ts) >= cutoff);
  const last = history[history.length - 1];
  if (!start || start === last) return "n/a";
  return (((last.price / start.price) - 1) * 100).toFixed(1) + "%";
}

type Sections = { lede: string; overnight: string; positions: { name: string; note: string; watch: string }[]; desk_view: string; calendar: string[]; spoken?: string };
function validSections(o: unknown): o is Sections {
  const s = o as Sections;
  return !!s && typeof s.lede === "string" && !!s.lede.trim() && typeof s.overnight === "string"
    && Array.isArray(s.positions) && s.positions.length >= 1 && s.positions.length <= 5
    && s.positions.every((p) => p && typeof p.name === "string" && typeof p.note === "string" && typeof p.watch === "string")
    && typeof s.desk_view === "string" && Array.isArray(s.calendar ?? []);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = await req.json().catch(() => ({}));
  const force = url.searchParams.get("force") === "1" || body.force === true;
  const onlyEmail = typeof body.user_email === "string" ? body.user_email : null;
  const noAudio = body.noAudio === true;   // battery/test runs must not spend TTS quota
  const validEd = (x: unknown): x is "morning" | "midday" | "close" => x === "morning" || x === "midday" || x === "close";
  const edRaw = url.searchParams.get("edition") ?? (body as { edition?: unknown }).edition;
  const utcH = new Date().getUTCHours();
  const edition: "morning" | "midday" | "close" = validEd(edRaw) ? edRaw : utcH >= 19 ? "close" : utcH >= 15 ? "midday" : "morning";

  let key = "";
  if (!fixture) {
    key = Deno.env.get("MARA_API_KEY") ?? "";
    if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
    if (!key) return json({ ok: false, error: "not configured" }, 500);
  }
  const model = Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7";

  // Brief date = US Eastern trading day.
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const briefDate = etParts;   // YYYY-MM-DD

  // ---- shared market context (deterministic) ----
  const ctxSyms = ["ES=F", "NQ=F", "^VIX", "^KS11", "^GSPC", "USDKRW"];
  const { data: ctxPrices } = await admin.from("prices").select("symbol,price,change_pct").in("symbol", [...ctxSyms, ...LEADERS]);
  const px = new Map((ctxPrices ?? []).map((p) => [p.symbol, { price: Number(p.price), chg: p.change_pct === null ? null : Number(p.change_pct) }]));
  const fmtCtx = (sy: string, label: string) => {
    const p = px.get(sy);
    return p ? `${label} ${p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${p.chg !== null ? ` (${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%)` : ""}` : null;
  };
  const marketLines = [
    fmtCtx("ES=F", "S&P500 futures"), fmtCtx("NQ=F", "Nasdaq futures"), fmtCtx("^GSPC", "S&P500 close"),
    fmtCtx("^VIX", "VIX"), fmtCtx("^KS11", "KOSPI"), fmtCtx("USDKRW", "USDKRW"),
  ].filter(Boolean).join(" · ");
  const mktLive = [
    fmtCtx("^GSPC", "S&P500 index"), fmtCtx("NQ=F", "Nasdaq futures"), fmtCtx("^VIX", "VIX"),
    fmtCtx("^KS11", "KOSPI"), fmtCtx("USDKRW", "USDKRW"),
  ].filter(Boolean).join(" · ");
  const leaderLines = LEADERS.map((sy) => { const p = px.get(sy); return p && p.chg !== null ? `${sy} ${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%` : null; }).filter(Boolean).join(" · ");
  const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: leaderNews } = await admin.from("news").select("symbol,title").in("symbol", LEADERS)
    .gte("published_at", since24h).order("published_at", { ascending: false }).limit(7);
  const leaderHeads = (leaderNews ?? []).map((n) => `- ${n.symbol}: ${String(n.title).slice(0, 90)}`).join("\n");

  // ---- users ----
  const { data: pf } = await admin.from("portfolio").select("user_id, symbol, kind, account, currency, value, change_pct, nickname, name, cost_basis, total_gl");
  const byUser = new Map<string, NonNullable<typeof pf>>();
  for (const r of pf ?? []) { if (!byUser.has(r.user_id)) byUser.set(r.user_id, []); byUser.get(r.user_id)!.push(r); }
  const fxNum = px.get("USDKRW")?.price ?? 1380;
  let userIds = [...byUser.keys()];
  if (onlyEmail) {
    const { data: us } = await admin.from("profiles").select("id, display_name").in("id", userIds);
    void us;   // profiles has no email; resolve via auth admin
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const target = au?.users?.find((u) => u.email === onlyEmail)?.id;
    userIds = target ? [target].filter((t) => byUser.has(t)) : [];
  }
  userIds = userIds.slice(0, 10);

  let wrote = 0;
  const errors: string[] = [];
  for (const uid of userIds) {
    const tStart = Date.now();
    const elapsed = () => (Date.now() - tStart) / 1000;
    try {
      const rows = byUser.get(uid)!;
      const usd = (v: number, c: string) => (c === "KRW" ? v / fxNum : v);
      const assets = rows.filter((r) => r.kind !== "debt");
      const total = assets.reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
      if (total < 100) continue;
      if (!force) {
        const { data: have } = await admin.from("daily_briefs").select("id").eq("user_id", uid).eq("brief_date", briefDate).eq("edition", edition).maybeSingle();
        if (have) continue;
      }
      const holdings = assets.filter((r) => !r.symbol.startsWith("$"))
        .sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency));
      const statsLines = rows.map((r) => {
        const sign = r.kind === "debt" ? -1 : 1;
        return `${krName(r.symbol, r.nickname, r.name)}: $${Math.round(sign * usd(Number(r.value ?? 0), r.currency))} (${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of assets), day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}, total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`;
      }).join("\n");

      // yesterday for continuity
      const { data: prev } = await admin.from("daily_briefs").select("brief_date, sections, memos").eq("user_id", uid)
        .lt("brief_date", briefDate).order("brief_date", { ascending: false }).limit(1).maybeSingle();
      let morningRow: { sections: unknown; memos: unknown } | null = null;
      if (edition !== "morning") {
        const { data: te } = await admin.from("daily_briefs").select("sections, memos").eq("user_id", uid)
          .eq("brief_date", briefDate).eq("edition", "morning").maybeSingle();
        morningRow = te ?? null;
      }

      let sections: Sections | null = null;
      let memosOut: Record<string, unknown>[] = [];
      if (fixture) {
        sections = body.canned ?? {
          lede: "Fixture lede for the day.", overnight: "Fixture overnight with numbers.",
          positions: [{ name: "FixtureCo", note: "Fixture note 1", watch: "fixture watch" }, { name: "FixtureCo2", note: "Fixture note 2", watch: "fixture watch 2" }],
          desk_view: "Fixture desk view.", calendar: [],
        };
      } else if (edition === "morning") {
        // ---- stage 1: analyst memos, parallel over top holdings ----
        const memoTargets = holdings.slice(0, 5);
        const memos = await Promise.all(memoTargets.map(async (r) => {
          try {
            const dispN = krName(r.symbol, r.nickname, r.name);
            const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
            const [{ data: news }, { data: fils }, { data: tr }, { data: hist }] = await Promise.all([
              admin.from("news").select("title,source,published_at").eq("symbol", r.symbol).gte("published_at", since14).order("published_at", { ascending: false }).limit(10),
              admin.from("filings").select("form,filed_at").eq("symbol", r.symbol).order("filed_at", { ascending: false }).limit(5),
              admin.from("transcripts").select("title,content,published_at").eq("symbol", r.symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(1),
              admin.from("price_history").select("ts,price").eq("symbol", r.symbol).gte("ts", new Date(Date.now() - 400 * 86400000).toISOString()).order("ts", { ascending: true }).limit(1200),
            ]);
            const h = (hist ?? []).map((x) => ({ ts: String(x.ts), price: Number(x.price) }));
            const memoPrompt = `Internal analyst memo on ${dispN} (${r.symbol}) for a portfolio where it is ${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of assets. Day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}, 30d ${pctOver(h, 30)}, 1y ${pctOver(h, 365)}.
${tr?.[0] ? `Latest earnings call ("${String(tr[0].title).slice(0, 100)}", ${String(tr[0].published_at).slice(0, 10)}):\n${String(tr[0].content).slice(0, 4000)}` : "No earnings call on file."}
${(fils ?? []).length ? `Filings: ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}
News (14d):\n${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- none"}

Return STRICT JSON: {"name": "${dispN}", "changed": str, "promise_check": str, "bull": str, "bear": str, "watch": str}.
changed: what actually changed in the last 24-48h (or "quiet"). promise_check: management's last stated promise and whether evidence supports it. Each field <= 22 words. Specific, numbers where available, no filler.`;
            let m = await askModel(key, "You are a buy-side analyst writing an internal memo.", memoPrompt, 6000, 25000);
            if (!m) m = await askModel(key, "You are a buy-side analyst writing an internal memo.", memoPrompt, 6000, 30000);   // API slow-wave retry
            return m ? { symbol: r.symbol, ...m } : null;
          } catch { return null; }
        }));
        memosOut = memos.filter(Boolean) as Record<string, unknown>[];
        if (!memosOut.length) { errors.push(uid.slice(0, 8) + ": no memos"); continue; }

        // ---- stage 2: devil's advocate ----
        const devil = await askModel(key, "You are the desk's skeptic.",
          `Memos:\n${JSON.stringify(memosOut)}\n\nReturn STRICT JSON: {"pushback": [{"name": str, "point": str}]}. For each memo that deserves it (max 4): the single strongest objection, what's overstated, or the risk it ignores. <= 18 words each. Ruthless, specific.`, 5000, 20000);
        const pushback = Array.isArray((devil as { pushback?: unknown })?.pushback) ? (devil as { pushback: unknown[] }).pushback : [];

        // ---- stage 3: editor ----
        const editorPrompt = `Write today's ${briefDate} morning brief for ONE investor. You are their personal research desk; this is your ${prev ? "ongoing coverage (yesterday's brief below)" : "first note to them"}.

MARKET: ${marketLines || "(no market data)"}
LEADERS: ${leaderLines || "(none tracked)"}
LEADER HEADLINES (24h):\n${leaderHeads || "- none"}

PORTFOLIO (deterministic; the ONLY source of portfolio numbers):
Total assets $${Math.round(total)}.
${statsLines}

ANALYST MEMOS:
${memosOut.slice(0, 4).map((m) => `- ${m.name}: changed: ${m.changed}. promises: ${m.promise_check}. bull: ${m.bull}. bear: ${m.bear}. watch: ${m.watch}`).join("\n")}
SKEPTIC PUSHBACK:
${pushback.slice(0, 3).map((pb) => `- ${(pb as { name?: string }).name}: ${(pb as { point?: string }).point}`).join("\n") || "- none"}
${prev ? `YESTERDAY'S NOTE (for continuity): lede "${(prev.sections as { lede?: string })?.lede ?? ""}" · desk view "${(prev.sections as { desk_view?: string })?.desk_view ?? ""}"` : ""}

Return STRICT JSON:
{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": [str]}
lede: the ONE thing that matters for THIS portfolio today. <= 2 sentences, <= 34 words. Earn the reader's next 3 minutes.
overnight: the tape that touches them. MUST contain at least THREE literal numbers copied from the MARKET line (futures, VIX, index, FX) using their EXACT labels (never call futures "the S&P"; never merge two instruments), then one clause on what it means for their largest exposures BY NAME. <= 55 words.
positions: the 1-4 holdings that EARNED coverage today (news, calls, filings, breaks). Not just the biggest. note <= 32 words with at least one number; incorporate the skeptic where it sharpens. watch <= 10 words and must be a CONCRETE event, date, or level (e.g. "Q3 guidance Sep 4", "HBM pricing at Goldman conf"). NEVER verbs like monitor, watch, track, keep an eye.
desk_view: one STRUCTURAL observation only: valuation, correlation, concentration, or rotation. It may not contain ANY overnight or single-day number; multi-week, valuation, or weight numbers only. Builds on yesterday when given. <= 40 words.
calendar: 0-3 items <= 10 words each (estimated earnings dates OK if labeled est).
BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as ₩ (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.`;
        let draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly, then write.", editorPrompt, 24000, 75000);
        const meta1 = lastMeta;
        if ((!draft || !validSections(draft)) && elapsed() < 70) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly. Output the exact JSON shape requested.", editorPrompt, 24000, 60000);
        }
        if (!draft || !validSections(draft)) {
          // graceful degradation for API slow waves: a compact editor beats no brief
          const compactPrompt = `Write today's ${briefDate} morning brief for ONE investor. Be dense; every word counts.
MARKET: ${marketLines || "(none)"}
PORTFOLIO (only source of numbers): Total $${Math.round(total)}.
${statsLines}
TOP MEMOS:
${memosOut.slice(0, 3).map((m) => `- ${m.name}: ${m.changed}. ${m.bull}. ${m.bear}.`).join("\n")}
Return STRICT JSON {"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": []}.
lede <= 34 words; overnight <= 55 words with >= 3 market numbers tied to their holdings; 1-3 positions, note <= 32 words with a number, watch <= 10 words naming a concrete event (NEVER the words monitor, watch, track, keep an eye); desk_view <= 40 words, structural only: no day moves, no overnight numbers. Banned: investors should, keep an eye, monitor, worth watching, remains to be seen. No filler, no em dashes, Korean companies by name, won as ₩.`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compactPrompt, 12000, 40000);
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": editor failed [" + meta1 + " | " + lastMeta + "]"); continue; }

        // ---- stage 4: fact-check (skipped when the wall clock is tight; scrub still runs) ----
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET: ${marketLines}\nLEADERS: ${leaderLines}\nPORTFOLIO:\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (lede 34, overnight 55, note 32, watch 10, desk_view 40) by tightening, not by losing substance. Also: replace any numeric KRX code (like 005930.KS) with the company name; write won as ₩ never "KRW"; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); if desk_view recaps today's prices, rewrite it as a structural point; overnight must keep at least three market numbers.`, 10000, 30000);
        sections = (checked && validSections(checked)) ? checked as Sections : draft as Sections;
      } else {
        // ---- intraday editions (midday pulse / closing note): reuse the morning desk work, focus on the live tape ----
        memosOut = Array.isArray(morningRow?.memos) ? (morningRow?.memos as Record<string, unknown>[]) : [];
        if (!memosOut.length) {
          const quick = await Promise.all(holdings.slice(0, 4).map(async (r) => {
            try {
              const dispN = krName(r.symbol, r.nickname, r.name);
              const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
              const { data: news } = await admin.from("news").select("title,source").eq("symbol", r.symbol).gte("published_at", since7).order("published_at", { ascending: false }).limit(6);
              const m = await askModel(key, "You are a buy-side analyst. Terse.",
                `Quick memo on ${dispN}, ${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of the portfolio, day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}.
News (7d):
${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- none"}

Return STRICT JSON {"name": "${dispN}", "changed": str, "watch": str}. changed: the live driver or "quiet". watch: next concrete catalyst. <= 18 words each.`, 3500, 18000);
              return m ? { symbol: r.symbol, ...m } : null;
            } catch { return null; }
          }));
          memosOut = quick.filter(Boolean) as Record<string, unknown>[];
        }
        const nameBy = new Map(holdings.map((r) => [r.symbol, krName(r.symbol, r.nickname, r.name)]));
        const since8h = new Date(Date.now() - 8 * 3600000).toISOString();
        const { data: freshNews } = await admin.from("news").select("symbol,title").in("symbol", holdings.slice(0, 8).map((r) => r.symbol))
          .gte("published_at", since8h).order("published_at", { ascending: false }).limit(12);
        const freshHeads = (freshNews ?? []).map((n) => `- ${nameBy.get(n.symbol) ?? n.symbol}: ${String(n.title).slice(0, 90)}`).join("\n");
        const dayPnl = assets.reduce((a, r) => r.change_pct === null ? a : a + usd(Number(r.value ?? 0), r.currency) * (Number(r.change_pct) / 100) / (1 + Number(r.change_pct) / 100), 0);
        const dayPct = total > 0 ? (dayPnl / (total - dayPnl) * 100) : 0;
        const pnlLine = `DAY P&L: ${dayPnl >= 0 ? "+" : "-"}$${Math.abs(Math.round(dayPnl)).toLocaleString("en-US")} (${dayPnl >= 0 ? "+" : ""}${dayPct.toFixed(1)}%)`;
        const mSec = morningRow ? morningRow.sections as Sections : null;
        const morningCtx = mSec ? `THIS MORNING'S BRIEF (build on it, never repeat a sentence from it): lede "${mSec.lede}" \u00b7 tape "${mSec.overnight}" \u00b7 desk view "${mSec.desk_view}" \u00b7 watches: ${mSec.positions.map((p) => `${p.name}: ${p.watch}`).join("; ")}` : "(no morning brief today; write standalone, no references to an earlier note)";
        const isFri = new Date(briefDate + "T12:00:00Z").getUTCDay() === 5;
        const krHeld = holdings.some((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ"));
        const STYLE_RULES = `BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as \u20a9 (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.`;
        const dataBlock = `MARKET NOW: ${mktLive || "(no market data)"}
LEADERS: ${leaderLines || "(none tracked)"}
FRESH HEADLINES (8h):
${freshHeads || "- none"}

PORTFOLIO (deterministic; the ONLY source of portfolio numbers):
Total assets $${Math.round(total)}. ${pnlLine}
${statsLines}

DESK CONTEXT (from the morning work):
${memosOut.slice(0, 4).map((m) => `- ${m.name}: ${m.changed ?? ""}${m.bull ? `. bull: ${m.bull}` : ""}${m.bear ? `. bear: ${m.bear}` : ""}. watch: ${m.watch ?? ""}`).join("\n") || "- none"}
${morningCtx}`;
        const shape = `Return STRICT JSON:\n{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": [str]}`;
        const writerPrompt = edition === "midday"
          ? `Write the ${briefDate} MIDDAY PULSE (11:00 AM Central, about 2.5 hours into the US session) for ONE investor. You wrote this morning's brief; now tell them what the session is ACTUALLY doing versus what was expected.

${dataBlock}

${shape}
lede: the ONE thing that changed since the open for THIS portfolio, stated as a CONSEQUENCE for the reader (what it does to their risk, concentration, or plan), never a bare move recap. <= 28 words.
overnight: the tape RIGHT NOW: at least THREE literal numbers copied from MARKET NOW with their EXACT labels, then the single biggest portfolio day move BY NAME with its number. <= 50 words.
positions: the 1-4 holdings actually moving or with fresh news since the open, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and current weight, before smaller names. note <= 28 words with the day number and WHY it moves; if the driver is unknown write "no clear driver yet" rather than inventing one. watch <= 10 words: a concrete afternoon or tonight event, level, or time. NEVER verbs like monitor, watch, track.
desk_view: what today's action changes about the morning view, or the specific level or event this afternoon that would change it. Structural; never repeat the morning desk view. <= 36 words.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it with new evidence from today's session; restating it in different words is a failure. Cover what the morning could not know.
calendar: 0-3 items for this afternoon or tonight, <= 10 words each.
${STYLE_RULES}`
          : `Write the ${briefDate} CLOSING NOTE (published minutes after the 4:00 PM Eastern close${isFri ? "; it is FRIDAY, so set up the WEEK AHEAD" : ""}) for ONE investor. Your job: settle what today meant for their money and arm them for the next session.

${dataBlock}

${shape}
lede: the day's story for THIS portfolio in one breath, anchored on the DAY P&L number and what it MEANS for the reader, not a bare recap. <= 30 words.
overnight: the tape at the bell: at least THREE literal numbers copied from MARKET NOW with their EXACT labels, plus the portfolio day P&L. <= 55 words.
positions: the 1-4 holdings that defined the day, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and weight, before smaller names. note <= 30 words: what happened AND what it means beyond today, with the day number. watch <= 10 words naming a concrete ${isFri ? "next-week" : "tonight-or-tomorrow"} catalyst, level, or event (after-hours earnings, data time, KRX open). NEVER verbs like monitor, watch, track.
desk_view: the setup for ${isFri ? "next week" : "tomorrow"}: the one structural risk or opportunity to sleep on. No single-day numbers. <= 40 words.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it (resolved, worsened, confirmed by the close); restating it in different words is a failure.
calendar: 0-3 items: tonight's after-hours reports, ${isFri ? "next week's" : "tomorrow's"} data or earnings. <= 10 words each.${krHeld ? `\nTheir Korean holdings trade TONIGHT (KRX opens 9:00 PM Eastern). If a Korean name has a catalyst, put it in positions or calendar.` : ""}
${STYLE_RULES}`;
        let draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly, then write.", writerPrompt, 20000, 60000);
        if ((!draft || !validSections(draft)) && elapsed() < 70) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Think briefly. Output the exact JSON shape requested.", writerPrompt, 20000, 45000);
        }
        if ((!draft || !validSections(draft)) && elapsed() < 105) {
          // API slow-wave degradation: a compact intraday note beats no note
          const compact = `Write the ${briefDate} ${edition === "midday" ? "MIDDAY session pulse (11 AM Central)" : "post-close note"} for ONE investor. Dense; every word counts.
MARKET NOW: ${mktLive || "(none)"}
PORTFOLIO (only source of numbers): Total $${Math.round(total)}. ${pnlLine}
${statsLines}
${shape}
lede <= 28 words as a consequence for the reader; overnight <= 50 words with >= 3 MARKET NOW numbers and exact labels; 1-3 positions ordered by weight, note <= 28 words with a number, watch <= 10 words naming a concrete event (NEVER monitor/watch/track); desk_view <= 36 words structural only; calendar []. No filler, no em dashes, Korean companies by name, won as \u20a9.`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compact, 12000, 35000);
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": writer failed [" + lastMeta + "]"); continue; }
        const caps = edition === "midday" ? "lede 28, overnight 50, note 28, watch 10, desk_view 36" : "lede 30, overnight 55, note 30, watch 10, desk_view 40";
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET NOW: ${mktLive}\nLEADERS: ${leaderLines}\nPORTFOLIO: Total $${Math.round(total)}. ${pnlLine}\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (${caps}) by tightening, not by losing substance. Also: replace any numeric KRX code with the company name; write won as \u20a9 never "KRW"; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); overnight must keep at least three market numbers.`, 10000, 30000);
        sections = (checked && validSections(checked)) ? checked as Sections : draft as Sections;
      }
      if (!sections || !validSections(sections)) { errors.push(uid.slice(0, 8) + ": invalid sections"); continue; }
      sections.positions = sections.positions.slice(0, 4);
      sections = deepDeDash(sections);
      // deterministic style guarantees: KRX codes -> names, KRW-prefix -> ₩
      const codeToName = new Map(holdings.map((r) => [r.symbol, krName(r.symbol, r.nickname, r.name)] as [string, string]));
      const scrub = (t: string) => {
        let x = t;
        for (const [code, nm] of codeToName) if (code.endsWith(".KS") || code.endsWith(".KQ")) x = x.split(code).join(nm);
        x = x.replace(/KRW\s?(?=[0-9₩])/g, "₩").replace(/₩\s+(?=[0-9])/g, "₩");
        // NUMBER STYLE is guaranteed in code: dollar amounts >= 1,000 rounded to the nearest hundred, comma-grouped
        return x.replace(/\$([\d,]+)(\.\d+)?/g, (m, d, dec) => {
          const v = Number(String(d).replace(/,/g, "") + (dec ?? ""));
          return v >= 1000 ? "$" + (Math.round(v / 100) * 100).toLocaleString("en-US") : m;
        });
      };
      const scrubDeep = (v: unknown): unknown => typeof v === "string" ? scrub(v)
        : Array.isArray(v) ? v.map(scrubDeep)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubDeep(x)])) : v;
      sections = scrubDeep(sections) as Sections;
      const { error: upErr } = await admin.from("daily_briefs").upsert({
        user_id: uid, brief_date: briefDate, edition, sections, memos: memosOut.slice(0, 8), generated_at: new Date().toISOString(), model: fixture ? "fixture" : model,
      }, { onConflict: "user_id,brief_date,edition" });
      if (upErr) errors.push(uid.slice(0, 8) + ": " + upErr.message); else wrote++;
      // ---- audio narration (background; the text brief never waits on it) ----
      if (!fixture && !upErr && !noAudio) {
        const uidCopy = uid, dateCopy = briefDate, edCopy = edition, finalSections = sections;
        const doAudio = (async () => {
          try {
            const { data: au } = await admin.auth.admin.getUserById(uidCopy);
            if (au?.user?.email?.endsWith("assetly.test")) return;   // test accounts never spend TTS quota
            let ek = Deno.env.get("ELEVEN_API_KEY") ?? "";
            if (!ek) { const { data } = await admin.rpc("get_secret", { secret_name: "eleven_api_key" }); ek = data ?? ""; }
            if (!ek) return;
            const dayLine = new Date(dateCopy + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
            const spec = edCopy === "midday"
              ? { label: "midday check-in radio script", len: "a 60-to-90 second (150-220 word)", who: "midday-desk", floor: 120, min: 250 }
              : edCopy === "close"
              ? { label: "closing-bell wrap radio script", len: "a 90-second-to-2-minute (200-290 word)", who: "end-of-day", floor: 170, min: 250 }
              : { label: "radio script", len: "a 2-to-3 minute (340-430 word)", who: "morning-desk", floor: 280, min: 400 };
            const scriptPrompt = `Brief:\n${JSON.stringify(finalSections)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken ${spec.label} of this exact brief for expressive text-to-speech. Today is ${dayLine} — use that in the greeting and NEVER guess a different weekday. Voice: a sharp, warm ${spec.who} analyst speaking to ONE client they know well. Short sentences. Contractions. Spell numbers for the ear ("up five point eight percent", "about a hundred and forty-seven thousand dollars"). Vary the rhythm: punchy for surprises, slower with commas and ellipses for risk warnings, one earned exclamation at most. Structure, all parts REQUIRED: one-line greeting with the date, the lede, the overnight tape, each position with what to watch, the desk view, and a closing sign-off sentence that says goodbye (e.g. "That\u2019s your brief. Talk soon."). The script MUST end with that complete sign-off sentence — never end on a market point or a pause. Insert <break time="0.7s" /> between sections and <break time="0.3s" /> after key numbers. Use ONLY facts and numbers from the brief. No headers, no ticker codes, company names only. Never mention sections or that this is generated.`;
            const sysLine = "You turn a written morning investment brief into a vivid spoken radio script. Output only the JSON.";
            const getScript = async (): Promise<string | null> => {
              const out = await askModel(key, sysLine, scriptPrompt, 12000, 70000);
              const sp = out && typeof (out as { spoken?: unknown }).spoken === "string" ? String((out as { spoken: string }).spoken) : null;
              if (!sp) return null;
              // trailing pause tags read as an abrupt dead-air ending — always strip
              const trimmed = sp.replace(/(?:\s*<break[^>]*\/>\s*)+$/g, "").trim();
              return trimmed.split(/\s+/).length >= spec.floor && /[.!?]$/.test(trimmed) ? trimmed : null;
            };
            let spoken = await getScript();
            if (!spoken) spoken = await getScript();   // one retry on a short or broken script
            if (!spoken || spoken.length < spec.min) return;
            // deterministic safety net: never ship a script that stops on a market point
            if (!/(talk soon|talk to you|see you|good luck|tomorrow|that\u2019s your|that's your|sign\w* off|catch you|have a (good|great)|go get)/i.test(spoken.slice(-160)))
              spoken += ` <break time="0.6s" /> That\u2019s your brief for this ${dayLine.split(",")[0]}. Talk soon.`;
            const voice = Deno.env.get("ELEVEN_VOICE_ID") ?? "JBFqnCBsd6RMkjVDRZzb";   // George: warm storyteller
            const vr = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
              method: "POST", headers: { "xi-api-key": ek, "Content-Type": "application/json" },
              body: JSON.stringify({
                text: spoken, model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
              }),
            });
            if (!vr.ok) return;
            const audio = new Uint8Array(await vr.arrayBuffer());
            const path = `${uidCopy}/${dateCopy}-${edCopy}.mp3`;
            const { error: upE } = await admin.storage.from("briefs-audio").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
            if (!upE) await admin.from("daily_briefs").update({ audio_path: path }).eq("user_id", uidCopy).eq("brief_date", dateCopy).eq("edition", edCopy);
          } catch { /* the written brief stands alone */ }
        })();
        try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(doAudio); } catch { /* ignore */ }
      }
    } catch (e) { errors.push(uid.slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, users: userIds.length, wrote, briefDate, errors: errors.slice(0, 5) });
});
