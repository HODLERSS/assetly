// Assetly Daily Brief — three personal research notes per trading day: morning (pre-open,
// full 4-stage chain), midday pulse (11am CT, live tape vs the morning view), closing note
// (post-close, day tally + next-session setup). Edition resolves from the clock or body.edition.
// Plus the PORTFOLIO ASSESSMENT (edition "assessment"): the first brief after a connect or a run of
// manual adds. Not a tape note: quality of the book, structure and risk, next-quarter vs next-years
// horizons, and gaps worth researching. Never produced by the clock; only on request (orchestrator).
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

// a dash glued to a digit is a MINUS SIGN (−32.8%, –5%): normalize it before the dash-to-comma rewrite, or the sign is lost
const deDash = (v: string) => v.replace(/[\u2212\u2013\u2014]\s?(?=\d)/g, "-").replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");
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
// FAST model for composition steps (editor, compact, fact-check) of the assessment: M2.7 burns its whole token
// budget thinking on that prompt shape (HTTP 400 "truncated" after ~85s); gpt-oss-120b writes it validly in ~20s.
const FAST_MODEL = "gpt-oss-120b";
async function askModel(key: string, system: string, prompt: string, maxTokens: number, timeoutMs = 30000, model?: string): Promise<Record<string, unknown> | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    signal: ac.signal,
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model ?? Deno.env.get("MARA_MODEL") ?? "MiniMax-M2.7",
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
    novice: "BEGINNER reader: plain words, short sentences. NO bare acronyms or jargon ANYWHERE, including watch items and bullets. Banned for this reader: ROE, ROIC, EBITDA, FCF, P/E, EPS, capex, basis points, net flows, and the bare word moat (say: a lasting edge over competitors). Use the plain phrase instead: profit growth not ROE, cash flow not FCF, operating profit not EBITDA. If a term is unavoidable, gloss it in-line (like: free cash flow, the cash left after all expenses). Never condescend.",
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
- Lens: ${st || styleG.value}. Apply the lens TO this book in EVERY position note and the structure section: the first judgment in each comes through this lens (value: what it is worth versus its price and the downside; income: what it pays and how safely), even when the book does not match the lens. The one-line verdict may still name what kind of book it is.
- ${purpG[v.purpose] ?? purpG.watch}
- ${horG[v.horizon] ?? horG["3-10y"]}; target return ${v.target}/yr; ${riskG[v.risk] ?? riskG.hold}.`;
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

const MONTH_IDX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// a calendar item survives only with an explicit date that is today or later (45-day lookback tolerance handles year rollover)
function futureDated(text: string, briefDate: string): boolean {
  const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (!m) return false;
  const today = new Date(briefDate + "T00:00:00Z");
  let d = new Date(Date.UTC(today.getUTCFullYear(), MONTH_IDX[m[1].slice(0, 3).toLowerCase()], Number(m[2])));
  if (+d < +today - 45 * 86400000) d = new Date(Date.UTC(today.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  return +d >= +today - 86400000;
}

type Sections = { lede: string; overnight: string; positions: { name: string; note: string; watch: string }[]; desk_view: string; calendar: string[]; horizon?: string; ideas?: string[]; spoken?: string };
// the assessment carries two extra sections: horizon (two "Next <period>:" clauses whose periods ADAPT to the reader's
// declared horizon: a <1y trader gets weeks/months, a 10y+ holder gets year/decade) and ideas (gaps worth researching)
function validAssessment(o: unknown): o is Sections {
  const s = o as Sections;
  return validSections(o) && typeof s.horizon === "string" && (s.horizon.match(/next [^:]{1,14}:/gi) ?? []).length >= 2
    && Array.isArray(s.ideas) && s.ideas.filter((x) => typeof x === "string" && x.trim()).length >= 2;
}
const HZ_LABELS: Record<string, [string, string]> = {
  "<1y": ["Next 4 weeks", "Next 6 months"], "1-3y": ["Next 3 months", "Next 1-3 years"],
  "3-10y": ["Next 3 months", "Next 3 years"], "10y+": ["Next year", "Next decade"],
};
// deterministic theme + geography tags: the assessment's concentration and correlation numbers come from code, never the model
const THEMES: Record<string, string> = {
  NVDA: "AI semiconductors", AMD: "AI semiconductors", ARM: "AI semiconductors", INTC: "AI semiconductors", AVGO: "AI semiconductors", TSM: "AI semiconductors", MU: "AI semiconductors", QCOM: "AI semiconductors", MRVL: "AI semiconductors",
  "000660.KS": "AI semiconductors", "005930.KS": "AI semiconductors", "005935.KS": "AI semiconductors",
  SMCI: "AI infrastructure", DELL: "AI infrastructure", VRT: "AI infrastructure", ANET: "AI infrastructure", IREN: "AI infrastructure", CIFR: "AI infrastructure", WULF: "AI infrastructure", APLD: "AI infrastructure", NBIS: "AI infrastructure", CRWV: "AI infrastructure",
  MARA: "crypto beta", MSTR: "crypto beta", COIN: "crypto beta", RIOT: "crypto beta", CLSK: "crypto beta", HOOD: "crypto beta",
  BTC: "crypto", ETH: "crypto", SOL: "crypto", "BTC-USD": "crypto", "ETH-USD": "crypto", "SOL-USD": "crypto",
  MSFT: "mega-cap platforms", META: "mega-cap platforms", AAPL: "mega-cap platforms", GOOGL: "mega-cap platforms", GOOG: "mega-cap platforms", AMZN: "mega-cap platforms", NFLX: "mega-cap platforms",
  TSLA: "EV and autos", RIVN: "EV and autos", "005380.KS": "EV and autos", "000270.KS": "EV and autos",
  RDDT: "consumer internet", SNAP: "consumer internet", PINS: "consumer internet", UBER: "consumer internet", SPOT: "consumer internet", DUOL: "consumer internet", "035420.KS": "consumer internet", "035720.KS": "consumer internet",
  PLTR: "software", CRM: "software", NOW: "software", ORCL: "software", SNOW: "software", FIG: "software", CRWD: "software", ADBE: "software",
  JPM: "financials", BAC: "financials", GS: "financials", COF: "financials", V: "financials", MA: "financials", "024110.KS": "financials", "105560.KS": "financials",
  "BRK.B": "diversified conglomerate", "BRK-B": "diversified conglomerate",
  JNJ: "healthcare", UNH: "healthcare", LLY: "healthcare", PFE: "healthcare", "068270.KS": "healthcare", "207940.KS": "healthcare",
  XOM: "energy", CVX: "energy", "373220.KS": "batteries", "006400.KS": "batteries", "003690.KS": "consumer staples", KO: "consumer staples", PG: "consumer staples", COST: "consumer staples", WMT: "consumer staples",
  "012450.KS": "defense", LMT: "defense", RTX: "defense", "042660.KS": "shipbuilding", "009540.KS": "shipbuilding", "329180.KS": "shipbuilding",
  SPY: "broad US index", VOO: "broad US index", VTI: "broad US index", IVV: "broad US index", FXAIX: "broad US index", QQQ: "Nasdaq 100 index", QQQM: "Nasdaq 100 index",
  VXUS: "international index", BND: "bonds", TLT: "bonds", AGG: "bonds", GLD: "gold", IAU: "gold", SCHD: "dividend equity", VYM: "dividend equity", JEPI: "income equity",
};
const themeOf = (sym: string, kind: string | null) => THEMES[sym] ?? (kind === "crypto" ? "crypto" : kind === "etf" || kind === "fund" ? "funds" : "other");
const geoOf = (sym: string, kind: string | null) => kind === "crypto" || sym.endsWith("-USD") ? "crypto" : (sym.endsWith(".KS") || sym.endsWith(".KQ")) ? "Korea" : "US";
const STYLE_RULES = `BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as \u20a9 (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.`;
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
  // user_id targeting: a signed-in user may target only themself; service callers may target anyone.
  const bearerJwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  let onlyUserId: string | null = typeof body.user_id === "string" ? body.user_id : null;
  if (onlyUserId) {
    const isSvc = (() => { try { return JSON.parse(atob(bearerJwt.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
    let internalTok = Deno.env.get("INTERNAL_TOKEN") ?? "";
    if (!internalTok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); internalTok = data ?? ""; }
    const isInternal = !!internalTok && (req.headers.get("x-internal-token") ?? "") === internalTok;
    if (!isSvc && !isInternal) {
      const { data: ud } = await admin.auth.getUser(bearerJwt);
      // a caller may only target themself: refuse outright rather than silently widening to everyone
      if (ud?.user?.id !== onlyUserId) return json({ ok: false, error: "forbidden target" }, 403);
    }
  }
  const noAudio = body.noAudio === true;   // battery/test runs must not spend TTS quota
  type Edition = "morning" | "midday" | "close" | "assessment";
  const validEd = (x: unknown): x is Edition => x === "morning" || x === "midday" || x === "close" || x === "assessment";
  const edRaw = url.searchParams.get("edition") ?? (body as { edition?: unknown }).edition;
  const utcMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();   // close = 4:05 PM ET (20:05 UTC), never before the bell
  // "assessment" is never chosen by the clock: it is requested explicitly (orchestrator / brief-retry) and always forced
  const edition: Edition = validEd(edRaw) ? edRaw : utcMin >= 20 * 60 + 5 ? "close" : utcMin >= 15 * 60 ? "midday" : "morning";
  if (edition === "assessment" && !force && !fixture) return json({ ok: false, error: "assessment requires force" }, 400);

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
  const { data: invRows } = await admin.from("profiles").select("id, investor");
  const invBy = new Map<string, Investor | null>((invRows ?? []).map((r) => [String(r.id), r.investor as Investor | null]));
  const byUser = new Map<string, NonNullable<typeof pf>>();
  for (const r of pf ?? []) { if (!byUser.has(r.user_id)) byUser.set(r.user_id, []); byUser.get(r.user_id)!.push(r); }
  const fxNum = px.get("USDKRW")?.price ?? 1380;
  // every FX pair the price pipeline keeps (USDxxx = units per USD): brokerage imports arrive in CAD, GBP, EUR, JPY ...
  const { data: fxRows } = await admin.from("prices").select("symbol,price").like("symbol", "USD___");
  const fxMap = new Map<string, number>([["USD", 1], ["KRW", fxNum]]);
  for (const r of fxRows ?? []) { const v = Number(r.price); if (v > 0) fxMap.set(String(r.symbol).slice(3), v); }
  let userIds = [...byUser.keys()];
  if (!onlyEmail && !fixture) {
    // cron runs never touch test accounts (no token spend, no interference with battery fixtures)
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const testIds = new Set((au?.users ?? []).filter((u) => u.email?.endsWith("assetly.test")).map((u) => u.id));
    userIds = userIds.filter((id) => !testIds.has(id));
  }
  if (onlyUserId) userIds = byUser.has(onlyUserId) ? [onlyUserId] : [];
  else if (onlyEmail) {
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
      const usd = (v: number, c: string) => v / (fxMap.get(c) ?? 1);
      const assets = rows.filter((r) => r.kind !== "debt");
      const total = assets.reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
      if (total < 100) continue;
      let backfillOnly: Sections | null = null;
      if (!force) {
        const { data: have } = await admin.from("daily_briefs").select("id, model, audio_path, sections").eq("user_id", uid).eq("brief_date", briefDate).eq("edition", edition).maybeSingle();
        if (have && !String(have.model ?? "").includes("compact")) {
          // self-heal: the text exists but narration is missing -> regenerate audio only
          if (!fixture && !noAudio && !have.audio_path && validSections(have.sections)) backfillOnly = have.sections as Sections;
          else continue;
        }
      }
      const READER = readerBlock(invBy.get(uid));
      const [HZ1, HZ2] = HZ_LABELS[String((invBy.get(uid) as { horizon?: string } | null | undefined)?.horizon ?? "3-10y")] ?? HZ_LABELS["3-10y"];
      const holdings = assets.filter((r) => !r.symbol.startsWith("$"))
        .sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency));
      const statsLines = rows.map((r) => {
        const sign = r.kind === "debt" ? -1 : 1;
        return `${krName(r.symbol, r.nickname, r.name)}: $${Math.round(sign * usd(Number(r.value ?? 0), r.currency))} (${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of assets), day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}, total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`;
      }).join("\n");

      // deterministic next-earnings estimates: last call date + ~91d, rolled past today. The ONLY earnings dates the model may use.
      const { data: trDates } = await admin.from("transcripts").select("symbol, published_at").in("symbol", holdings.slice(0, 6).map((r) => r.symbol)).order("published_at", { ascending: false });
      const nextEarnSeen = new Set<string>();
      const nextEarn: string[] = [];
      for (const t of trDates ?? []) {
        if (!t.published_at || nextEarnSeen.has(t.symbol)) continue;
        nextEarnSeen.add(t.symbol);
        const hRow = holdings.find((h) => h.symbol === t.symbol);
        let d = new Date(+new Date(String(t.published_at)) + 91 * 86400000);
        const today0 = new Date(briefDate + "T00:00:00Z");
        while (+d < +today0) d = new Date(+d + 91 * 86400000);
        nextEarn.push(`${krName(t.symbol, hRow?.nickname, hRow?.name)} ~${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} (est)`);
      }
      const earnLine = nextEarn.join("; ") || "(none on file)";
      const dateLaw = `TODAY is ${briefDate}. Anything dated before today is the PAST and must NOT appear in calendar or watch. Earnings dates may come ONLY from NEXT EARNINGS ESTIMATES, always labeled (est); never invent a date.`;

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
      let usedCompact = false;
      let memosOut: Record<string, unknown>[] = [];
      if (backfillOnly) {
        sections = backfillOnly;
      } else if (fixture) {
        sections = body.canned ?? {
          lede: "Fixture lede for the day.", overnight: "Fixture overnight with numbers.",
          positions: [{ name: "FixtureCo", note: "Fixture note 1", watch: "fixture watch" }, { name: "FixtureCo2", note: "Fixture note 2", watch: "fixture watch 2" }],
          desk_view: "Fixture desk view.", calendar: [],
        };
      } else if (edition === "assessment") {
        // ---- PORTFOLIO ASSESSMENT: quality memos (parallel) -> portfolio skeptic -> editor -> fact-check ----
        const w = (r: { value: unknown; currency: string }) => usd(Number(r.value ?? 0), r.currency) / total * 100;
        const cashRows = assets.filter((r) => r.symbol.startsWith("$"));
        const cashPct = cashRows.reduce((a, r) => a + w(r), 0);
        const debtUsd = rows.filter((r) => r.kind === "debt").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
        const themeAgg = new Map<string, { pct: number; names: string[] }>();
        const geoAgg = new Map<string, number>();
        for (const r of holdings) {
          const th = themeOf(r.symbol, r.kind), g = geoOf(r.symbol, r.kind);
          const cur = themeAgg.get(th) ?? { pct: 0, names: [] };
          cur.pct += w(r); cur.names.push(krName(r.symbol, r.nickname, r.name)); themeAgg.set(th, cur);
          geoAgg.set(g, (geoAgg.get(g) ?? 0) + w(r));
        }
        const themeLine = [...themeAgg.entries()].sort((a, b) => b[1].pct - a[1].pct).slice(0, 6)
          .map(([th, v]) => `${th} ${v.pct.toFixed(1)}% (${v.names.slice(0, 4).join(", ")})`).join(" · ") || "(no equity positions)";
        const geoLine = [...geoAgg.entries()].sort((a, b) => b[1] - a[1]).map(([g, p]) => `${g} ${p.toFixed(1)}%`).join(" · ");
        const top1 = holdings[0] ? `${krName(holdings[0].symbol, holdings[0].nickname, holdings[0].name)} ${w(holdings[0]).toFixed(1)}%` : "n/a";
        const top3 = holdings.slice(0, 3).reduce((a, r) => a + w(r), 0).toFixed(1) + "%";
        const bookLine = `Total assets $${Math.round(total)}. ${holdings.length} equity or crypto positions. Largest ${top1}; top three ${top3}. Cash ${cashPct.toFixed(1)}%.${debtUsd > 0 ? ` Debt $${Math.round(debtUsd)} (${(debtUsd / total * 100).toFixed(1)}% of assets).` : " No debt recorded."}`;
        const structLines = rows.map((r) => {
          if (r.kind === "debt") return `${krName(r.symbol, r.nickname, r.name)}: $${Math.round(usd(Number(r.value ?? 0), r.currency))} OWED (a liability equal to ${w(r).toFixed(1)}% of assets; write it as "debt of $X", never with a minus sign)`;
          return `${krName(r.symbol, r.nickname, r.name)}: $${Math.round(usd(Number(r.value ?? 0), r.currency))} (${w(r).toFixed(1)}% of assets), total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`;
        }).join("\n");
        const memoTargets = holdings.slice(0, 5);
        const perf: string[] = [];
        const memos = await Promise.all(memoTargets.map(async (r) => {
          try {
            const dispN = krName(r.symbol, r.nickname, r.name);
            const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
            const [{ data: news }, { data: fils }, { data: tr }, { data: hist }, { data: ins }] = await Promise.all([
              admin.from("news").select("title,source,published_at").eq("symbol", r.symbol).gte("published_at", since14).order("published_at", { ascending: false }).limit(8),
              admin.from("filings").select("form,filed_at").eq("symbol", r.symbol).order("filed_at", { ascending: false }).limit(4),
              admin.from("transcripts").select("title,content,published_at").eq("symbol", r.symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(1),
              admin.from("price_history").select("ts,price").eq("symbol", r.symbol).gte("ts", new Date(Date.now() - 400 * 86400000).toISOString()).order("ts", { ascending: true }).limit(1200),
              admin.from("insights").select("bullets").eq("symbol", r.symbol).order("generated_at", { ascending: false }).limit(1),
            ]);
            const h = (hist ?? []).map((x) => ({ ts: String(x.ts), price: Number(x.price) }));
            perf.push(`${dispN} 30d ${pctOver(h, 30)}, 1y ${pctOver(h, 365)}`);
            const memoPrompt = `Quality memo on ${dispN} (${r.symbol}), ${w(r).toFixed(1)}% of a private investor's assets. Performance: 30d ${pctOver(h, 30)}, 1y ${pctOver(h, 365)}.
${tr?.[0] ? `Latest earnings call ("${String(tr[0].title).slice(0, 100)}", ${String(tr[0].published_at).slice(0, 10)}):\n${String(tr[0].content).slice(0, 4000)}` : "No earnings call on file."}
${(fils ?? []).length ? `Filings: ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}
News (14d):\n${(news ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- none"}
${ins?.[0] ? `Desk's recent take: ${(ins[0].bullets as string[]).slice(0, 3).join(" ")}` : ""}

Return STRICT JSON: {"name": "${dispN}", "business": str, "quality": str, "role": str, "long_case": str, "tripwire": str, "near": str}.
business: what it actually sells and to whom (for a fund: what it holds and how concentrated; for a coin: what it is and who uses it), <= 16 words, plain language.
quality: for a company: moat, growth, profitability, balance sheet in ONE candid verdict; for a fund: what is inside it, its concentration, its cost; for a coin: adoption, supply rules, custody risk. <= 28 words; numbers ONLY if they appear in the call text above. Never grade a fund on "profitability" or "balance sheet".
role: what this position does in a portfolio (compounder, cyclical bet, leveraged proxy, index ballast, speculative call), <= 12 words.
long_case: what must be true over the next 3 years for this to pay off, <= 20 words.
tripwire: the single observable sign that the thesis is breaking, <= 14 words, MEASURABLE: a named metric with a threshold, a guidance item, or a dated event (e.g. "data-center revenue growth below 30% next print", "Fed holds above 4% through year end"). Never vague words like "significantly", "sharply", "weakens".
near: the next catalyst in the coming 1-3 months, <= 14 words; never invent a date.
Candid, specific, no filler. Never em dashes.`;
            let m = await askModel(key, "You are a buy-side analyst grading business quality for a long-term owner. Think briefly.", memoPrompt, 5000, 25000);
            // M2.7 wave or token exhaustion: the fast model writes the memo instead of the whole attempt failing
            if (!m && elapsed() < 40) m = await askModel(key, "You are a buy-side analyst grading business quality for a long-term owner.", memoPrompt, 5000, 22000, FAST_MODEL);
            return m ? { symbol: r.symbol, ...m } : null;
          } catch { return null; }
        }));
        memosOut = memos.filter(Boolean) as Record<string, unknown>[];
        if (!memosOut.length) { errors.push(uid.slice(0, 8) + ": no quality memos"); continue; }
        const perfLine = perf.join("; ") || "(none)";

        // ---- structure, deterministic: the dominant theme and how much of the book rides on it ----
        const topTheme = [...themeAgg.entries()].sort((a, b) => b[1].pct - a[1].pct)[0];
        const skStructure = topTheme ? `${topTheme[1].pct.toFixed(1)}% of assets sits in one theme, ${topTheme[0]} (${topTheme[1].names.slice(0, 4).join(", ")}): one shared driver.` : "";
        const geoTop = [...geoAgg.entries()].sort((a, b) => b[1] - a[1])[0];
        const skMissing = [geoTop && geoTop[1] > 85 ? `${geoTop[1].toFixed(0)}% in ${geoTop[0]} only` : "", cashPct < 3 ? "no cash ballast" : "", !holdings.some((r) => themeOf(r.symbol, r.kind).includes("index") || themeOf(r.symbol, r.kind) === "bonds") ? "no index or bond ballast" : ""].filter(Boolean).join("; ");

        // ---- editor: the assessment ----
        const dataBlock = `PORTFOLIO (deterministic; the ONLY source of portfolio numbers; every percentage below is a share of TOTAL ASSETS, so write "of assets", never "of equity" or "of holdings"):
${bookLine}
${structLines}
THEME EXPOSURE (deterministic): ${themeLine}
GEOGRAPHY (share of total assets; cash and debt excluded, so it sums to the invested share): ${geoLine}
PERFORMANCE (30d = trailing 30 days, 1y = trailing 12 months; never call either "YTD"): ${perfLine}
NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}

QUALITY MEMOS:
${memosOut.slice(0, 5).map((m) => `- ${m.name}: business: ${m.business}. quality: ${m.quality}. role: ${m.role}. long case: ${m.long_case}. tripwire: ${m.tripwire}. near: ${m.near}`).join("\n")}
STRUCTURE FACT (deterministic): ${skStructure || "none"}
GAPS (deterministic hints; refine with judgment): ${skMissing || "none"}`;
        const shapeA = `Return STRICT JSON:\n{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "horizon": str, "ideas": [str], "calendar": []}`;
        const editorPrompt = `Write the ${briefDate} PORTFOLIO ASSESSMENT for ONE investor who just put these positions into Assetly. It is a first look at the QUALITY and STRUCTURE of what they own, over the next quarter and the next few years. It is NOT a daily brief: no overnight tape, no day moves, no futures, no session talk.

${dataBlock}

${shapeA}
lede: the verdict on this book in one breath: what kind of bet it is, and the single structural fact that matters most. <= 30 words.
overnight: YOUR BOOK: what they own. Total, the top holdings BY NAME with their weights, the concentration figure, the theme and geography mix, and cash or debt if present. At least THREE numbers copied from PORTFOLIO or THEME EXPOSURE, quoted EXACTLY as given: never add themes together into a new percentage, never relabel a theme (MARA-style miners and MSTR are "crypto beta" equities, not "crypto"); never state the same weight twice (if a theme is one holding, name it once). Three or four short sentences, none over 20 words. No performance figures here (they belong in the notes). <= 60 words.
positions: the 3-4 largest equity, fund, or crypto holdings by weight (2 only if the book has two), largest first; every such holding above 20% of assets MUST appear; cash and debt are NEVER positions (they belong in YOUR BOOK and STRUCTURE only). note <= 34 words of flowing prose: what the business is, the quality verdict (for a company: moat, growth, balance sheet; for a fund: what it holds, concentration, cost; for a coin: adoption, supply, custody), and its role in this book; a strength AND a risk or condition, written as sentences, NEVER as "Strength:" / "Risk:" labels: the LAST sentence of every note must be the risk, and must start with "The risk:" or "But" (never a positive clause after "while"); at most two numbers, from the data only. watch 5-10 words, no padding words: the thesis TRIPWIRE, MEASURABLE (a metric with a threshold, a guidance item, or a dated event); vague words like "significantly", "sharply", "weakens" are forbidden; NEVER verbs like monitor, watch, track, keep an eye.
desk_view: STRUCTURE AND RISK, exactly two or three sentences: first the concentration, correlation, currency, or leverage fact the owner probably does not see, with its percentage from the data; then a sentence starting "This means" that says what it does to them (a shared driver, a single point of failure, an FX exposure, leverage on a thin equity base). No performance figures here (they belong in the notes), no list of returns, no single-day numbers. <= 50 words. Never invent a hypothetical loss or drawdown percentage.
horizon: exactly two labeled clauses in this shape: "${HZ1}: ... ${HZ2}: ..." The first names what actually decides the ${HZ1.toLowerCase()} for THIS book (a print, a cycle, a macro number); any date you write must be AFTER today and come from NEXT EARNINGS ESTIMATES, otherwise say "the next earnings print" without a date. The second names what must be true over the ${HZ2.toLowerCase()} for this book to deliver. 36-46 words total.
ideas: 2-3 items, <= 14 words each, each about a GAP in this book (not about the names already held): name the gap, then the specific theme or instrument type worth researching to fill it (e.g. "No income sleeve: dividend-growth ETFs", "All-US book: developed-market ex-US index funds"). Never start with Add, Buy, Consider, or Allocate (write "No income sleeve: dividend-growth ETFs" or "All-US book: developed-market ex-US index funds"; after the colon name the instrument type directly, never a verb); never a price target.
LENGTH TARGET: ${holdings.length <= 2 ? `260-380 words in total. This book has only ${holdings.length} holding${holdings.length > 1 ? "s" : ""}: give each note a deeper quality read of 40-55 words, and use the full budgets for the book, structure and horizon.` : "340-420 words in total."} Use the budget: lede 20-30 words, book 40-58, ${holdings.length <= 2 ? "each note 40-55" : "each note 26-33"}, structure 36-48, horizon 36-46, each idea 8-13. Shorter than the floors reads thin; longer than the caps gets cut.
ADVICE LAW: never tell them to buy, sell, trim, add, or take profits. You describe, you judge quality, you point at what to research.
HORIZON LAW: forbidden words and phrases: today, tonight, overnight, yesterday, this morning, premarket, after-hours, after market close, at the bell, futures, session, intraday. Timeframes are weeks, months, quarters, years.
BALANCE LAW: the book's strengths and its risks both get real words; no hype, no doom.
SENTENCE LAW: short sentences everywhere, at most 22 words each; split any list of holdings or numbers into two sentences.
${STYLE_RULES}\n${READER}`;
        // composition on the FAST model (~20s): one attempt, one retry, then the compact editor
        let draft = await askModel(key, "You are the editor of a one-reader research desk writing a first portfolio assessment. Candid, precise, every word counts. Keep your thinking short, then write.", editorPrompt, 12000, 50000, FAST_MODEL);
        const meta1 = lastMeta;
        if ((!draft || !validAssessment(draft)) && elapsed() < 95) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Output the exact JSON shape requested, including horizon and ideas.", editorPrompt, 12000, 40000, FAST_MODEL);
        }
        if ((!draft || !validAssessment(draft)) && elapsed() < 118) {
          const compact = `Write the ${briefDate} PORTFOLIO ASSESSMENT (quality and structure of what they own; not a daily note: no day moves, no tape) for ONE investor. Dense; every word counts.
${bookLine}
${structLines}
THEME EXPOSURE: ${themeLine}
MEMOS:
${memosOut.slice(0, 4).map((m) => `- ${m.name}: ${m.business}. ${m.quality}. tripwire: ${m.tripwire}`).join("\n")}
${shapeA}
lede 20-30 words (the verdict on this book); overnight 40-60 words naming the top holdings with weights and the concentration figure (>= 3 numbers from the data); 2-4 positions largest first, note 26-34 words of prose with a strength and a risk (no "Strength:" labels), watch <= 12 words naming a MEASURABLE tripwire (a metric with a threshold or a dated event; NEVER monitor/watch/track, never "significantly"); desk_view 36-50 words on concentration or correlation with its percentage, no invented loss figures; horizon "${HZ1}: ... ${HZ2}: ..." 36-50 words; ideas: 2-3 gaps worth researching, 8-14 words each, never buy or sell instructions. Aim for 340 words in total. Forbidden words: today, overnight, yesterday, session, futures. A total G/L figure may only be phrased as "up/down $X since purchase", never as a move or a delivery. No filler, no em dashes, Korean companies by name, won as ₩.\n${READER}`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compact, 8000, Math.max(20000, Math.min(30000, (146 - elapsed()) * 1000)), FAST_MODEL);
          if (draft && validAssessment(draft)) usedCompact = true;
        }
        if (!draft || !validAssessment(draft)) { errors.push(uid.slice(0, 8) + ": assessment editor failed [" + meta1 + " | " + lastMeta + "]"); continue; }
        // BALANCE LAW guaranteed in code: a note with no risk clause gets the memo's own risk (from its quality verdict, else its tripwire)
        const RISK = /\b(but|though|although|yet|risk|risks|however|unless|could|downside|threat|pressure|stretched|uncertain|concern|exposed|depends|if)\b/i;
        const NEG = /\b(risk|below|declin|slow|cut|weak|loss|debt|leverage|competit|dependen|concentrat|regulat|cyclical|volatil|stretched|expensive|valuation|uncertain|pressure|margin (compression|squeeze)|dilut|custody|export)\w*/i;
        const ensureRisk = (o: Sections): Sections => ({ ...o, positions: o.positions.map((p) => {
          if (RISK.test(p.note)) return p;
          const m = memosOut.find((x) => String(x.name).toLowerCase() === p.name.toLowerCase() || String(x.symbol).toLowerCase() === p.name.toLowerCase());
          const q = String(m?.quality ?? ""); const parts = q.split(/;|\bbut\b|\byet\b|\bthough\b|\bwhile\b/i).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 3);
          const riskSeg = [...parts].reverse().find((x) => NEG.test(x));
          // keep the clause that actually carries the risk (a comma list can open with praise and end with the caveat)
          const negClause = riskSeg ? riskSeg.split(/,\s*/).find((c) => NEG.test(c)) : undefined;
          let phrase = (negClause ?? riskSeg ?? String(m?.tripwire ?? "")).replace(/[.\s]+$/, "");
          if (!NEG.test(phrase) && m?.tripwire) phrase = String(m.tripwire).replace(/[.\s]+$/, "");
          // keep the note near its cap: a long note gets a short risk clause
          phrase = phrase.split(/\s+/).slice(0, p.note.split(/\s+/).length > 24 ? 8 : 11).join(" ");   // the memo segment can be long
          return phrase ? { ...p, note: p.note.replace(/[.\s]+$/, "") + `. The risk: ${phrase[0].toLowerCase() + phrase.slice(1)}.` } : p;
        }) });
        draft = ensureRisk(draft as Sections);   // before the fact-check, so a lengthened note gets tightened to its cap
        const checked = elapsed() > 112 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims. Think briefly.",
          `Draft assessment:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\n${bookLine}\n${structLines}\nTHEME EXPOSURE: ${themeLine}\nGEOGRAPHY: ${geoLine}\nPERFORMANCE: ${perfLine}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape (keep horizon and ideas). Fix any number that contradicts the data; delete any claim you cannot trace to it; if a position note has no risk or condition, append one short clause taken from that memo's quality or tripwire; enforce the word caps (lede 30, overnight 60, note ${holdings.length <= 2 ? 56 : 34}, watch 12, desk_view 50, horizon 50, each idea 14) by tightening, not by losing substance, and never shorten a section that is already within its cap. Also: in desk_view delete any hypothetical loss or drawdown percentage (only weights and performance figures from the data may appear); rewrite any "Strength:" / "Risk:" labels into prose; replace any vague watch ("drops significantly", "weakens") with a measurable threshold or dated event from the memos, or the memo's own tripwire; delete any sentence containing today, tonight, overnight, yesterday, this morning, premarket, after-hours, after market close, at the bell, futures, session, or intraday; delete any instruction to buy, sell, trim, add, or take profits, and rewrite any idea that starts with Add/Buy/Consider adding as a research gap; horizon must keep the literal labels "${HZ1}:" and "${HZ2}:"; replace any numeric KRX code with the company name; write won as ₩ never "KRW"; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains. Finally enforce the reader profile below, especially its vocabulary rules (for a beginner, replace every banned acronym with its plain phrase everywhere, watch items included).\n${READER}`, 8000, 30000, FAST_MODEL);
        sections = (checked && validAssessment(checked)) ? checked as Sections : draft as Sections;
        // LENGTH floor guaranteed by a pass AFTER the fact-check (so the checker cannot shrink it back): elaborate, never add numbers or claims
        const wcA = (o: Sections) => [o.lede, o.overnight, o.desk_view, o.horizon ?? "", ...(o.ideas ?? []), ...o.positions.flatMap((p) => [p.name, p.note, p.watch])].join(" ").split(/\s+/).filter(Boolean).length;
        const floor = holdings.length <= 2 ? 240 : 315;
        for (let ga = 0; ga < 2 && wcA(sections) < floor && elapsed() < 118; ga++) {
          const grown = await askModel(key, "You are the editor. Keep every fact and number exactly as given; add depth, not new claims.",
            `This assessment is too thin at ${wcA(sections)} words; it must reach ${floor + 25}-420 words. Expand it toward these floors WITHOUT adding any number, number-word, or new factual claim that is not already in it: keep every existing number verbatim, never describe a hypothetical loss or drawdown; elaborate on what the existing facts mean for the owner (shared drivers, what must hold, what the tripwires signal): each position note ${holdings.length <= 2 ? "44-55" : "30-33"} words (business, quality verdict, role, ending with the risk sentence), desk_view 42-48 words, horizon 42-46 words ("${HZ1}: ... ${HZ2}: ..."), overnight 48-58 words. Keep lede, watch items and ideas as they are. Sentences of at most 22 words. Never use the words today, overnight, yesterday, session, futures. Never em dashes.\n${READER}\n\n${JSON.stringify(sections)}\n\nReturn the SAME JSON shape.`, 8000, 25000, FAST_MODEL);
          // the expansion may only elaborate: every original number survives, nothing numeric is added, no loss talk
          // numbers compared by VALUE (so "$9,900" vs "9,900 dollars" or "60.2%" vs "60.2 percent" still match), plus number-words
          const nums = (o: Sections) => new Set((JSON.stringify(o).match(/\d[\d,.]*|\b(half|third|thirds|quarter|quarters|double|triple|majority)\b/gi) ?? []).map((x) => /^\d/.test(x) ? String(Number(x.replace(/,/g, "").replace(/\.$/, ""))) : x.toLowerCase()));
          const LOSS = /\b(erod\w*|wipe\w*|los(e|es|ing|t)\b|loss of|drawdown|evaporat\w*|halv\w*)/i;
          if (grown && validAssessment(grown) && wcA(grown as Sections) > wcA(sections)) {
            const before = nums(sections), after = nums(grown as Sections);
            // dropping a number is allowed (a later guarantee restores the structure percentage); ADDING one never is
            const kept = true, noNew = [...after].every((n) => before.has(n));
            const g = grown as Sections;
            const lossy = LOSS.test([g.desk_view, g.horizon ?? "", ...g.positions.map((p) => p.note)].join(" ")) && !LOSS.test([sections.desk_view, sections.horizon ?? "", ...sections.positions.map((p) => p.note)].join(" "));
            const wcS = (t: string) => t.split(/\s+/).filter(Boolean).length;
            const noteCapX = holdings.length <= 2 ? 55 : 34;
            const withinCaps = wcS(g.overnight) <= 60 && wcS(g.desk_view) <= 50 && wcS(g.horizon ?? "") <= 50 && g.positions.every((p) => wcS(p.note) <= noteCapX && wcS(p.watch) <= 12);
            if (kept && noNew && !lossy && withinCaps) sections = ensureRisk(g);
          }
        }
        // STRUCTURE must say what the fact MEANS (guaranteed in code): a bare data dump gets the deterministic consequence sentence
        const MEANS = /\b(means|meaning|implies|leaves|makes|exposes|depends|lockstep|same driver|shared driver|single point|one bet|at once|together|amplif\w*|so the book|which is why)\b/i;
        if (!MEANS.test(sections.desk_view) && topTheme) {
          const wcD = (t: string) => t.split(/\s+/).filter(Boolean).length;
          const consequence = `This means ${topTheme[1].names.slice(0, 3).join(", ")} rise and fall on the same driver, so ${topTheme[1].pct.toFixed(1)}% of the book moves at once.`;
          let base = sections.desk_view.trim().replace(/\s*(recent )?(30|1)[- ]?(day|year) returns?:[^.]*\.?/gi, "").trim();   // returns belong in the notes
          while (wcD(base) + wcD(consequence) > 50 && /[.!?]\s+[^.!?]+[.!?]?$/.test(base)) base = base.replace(/\s+[^.!?]+[.!?]?$/, "").trim();
          sections.desk_view = `${base} ${consequence}`.trim();
        }
        // STRUCTURE must carry its percentage (guaranteed in code): a desk_view that lost it gets the deterministic structure fact up front
        if (!/\d+(?:\.\d+)?\s?%/.test(sections.desk_view) && skStructure) {
          const wcS2 = (t: string) => t.split(/\s+/).filter(Boolean).length;
          let rest = sections.desk_view.trim();
          while (wcS2(skStructure) + wcS2(rest) > 50 && /[.!?]\s+[^.!?]+[.!?]?$/.test(rest)) rest = rest.replace(/\s+[^.!?]+[.!?]?$/, "").trim();   // drop trailing sentences to fit
          if (wcS2(skStructure) + wcS2(rest) > 50) rest = rest.split(/\s+/).slice(0, Math.max(0, 50 - wcS2(skStructure))).join(" ").replace(/[,;:]?$/, ".");   // last resort: a hard cut
          sections.desk_view = `${skStructure} ${rest}`.trim();
        }
        // section caps guaranteed in code: trailing sentences go first, a hard cut only as the last resort
        const fitCap = (t: string, cap: number, mustKeep?: RegExp): string => {
          const wcT = (x: string) => x.split(/\s+/).filter(Boolean).length;
          let out = t.trim();
          while (wcT(out) > cap && /[.!?]\s+[^.!?]+[.!?]?$/.test(out)) {
            const shorter = out.replace(/\s+[^.!?]+[.!?]?$/, "").trim();
            if (mustKeep && !mustKeep.test(shorter)) break;
            out = shorter;
          }
          if (wcT(out) > cap) {
            const cut = out.split(/\s+/).slice(0, cap).join(" ").replace(/[,;:]?$/, ".");
            if (!mustKeep || mustKeep.test(cut)) out = cut;   // last resort: a hard cut, but never one that loses the required clause
          }
          return out;
        };
        sections.lede = fitCap(sections.lede, 30);
        sections.overnight = fitCap(sections.overnight, 60);
        sections.desk_view = fitCap(sections.desk_view, 50);
        sections.horizon = fitCap(sections.horizon ?? "", 50, /next [^:]{1,14}:[\s\S]*next [^:]{1,14}:/i);
        sections.calendar = [];
        sections.ideas = (sections.ideas ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
        // filler phrases guaranteed out in code (the fast model still slips one in occasionally)
        const deFill = (t: string) => t
          .replace(/\b(YTD|year[- ]to[- ]date)\b/g, "over the past year")   // the only year figure in the data is trailing 12 months
          .replace(/(\d+(?:\.\d+)?\s?%) of (equity|equities|the equity book|the equity sleeve|stock holdings|holdings|the invested portfolio)\b/gi, "$1 of assets")   // every weight is a share of total assets
          .replace(/\bit'?s important to (note|remember|watch|monitor)( that)?\s*/gi, "").replace(/\bit'?s important\b/gi, "it matters")
          .replace(/\bkeep (a close |an )?eye on\b/gi, "the thing to follow is").replace(/\bworth watching\b/gi, "the thing to follow")
          .replace(/\bremains to be seen\b/gi, "is unproven").replace(/\btime will tell\b/gi, "is unproven")
          .replace(/\binvestors should\b/gi, "the owner can").replace(/\bmonitor closely\b/gi, "matters most")
          .replace(/\b(stay tuned|as always)[,.]?\s*/gi, "").replace(/\b(demands scrutiny|warrants attention)\b/gi, "matters")
          .replace(/\s{2,}/g, " ").trim();
        sections.lede = deFill(sections.lede); sections.overnight = deFill(sections.overnight); sections.desk_view = deFill(sections.desk_view);
        sections.horizon = deFill(sections.horizon ?? ""); sections.positions = sections.positions.map((p) => ({ ...p, note: deFill(p.note), watch: deFill(p.watch) }));
        sections.ideas = (sections.ideas ?? []).map(deFill);
        // horizon law, guaranteed in code for the two words the fast model still slips in
        const deTape = (t: string) => t.replace(/\btoday's\b/gi, "current").replace(/\btoday\b/gi, "now").replace(/\btonight\b/gi, "soon");
        sections.lede = deTape(sections.lede); sections.overnight = deTape(sections.overnight); sections.desk_view = deTape(sections.desk_view);
        sections.horizon = deTape(sections.horizon ?? ""); sections.positions = sections.positions.map((p) => ({ ...p, note: deTape(p.note), watch: deTape(p.watch) }));
        // ideas are research gaps, never instructions (guaranteed in code): strip a leading Add/Buy/Consider/Allocate
        const VERB = /(add|buy|consider|allocate|explore|introduce|include|hold|own|put|use|pair|layer)(ing)?\s+(adding\s+|an?\s+|some\s+|the\s+)?/i;
        sections.ideas = sections.ideas.map((x) => {
          let y = x.replace(new RegExp("^" + VERB.source, "i"), "").trim();
          y = y.replace(new RegExp("(:\\s*)" + VERB.source, "i"), "$1");   // "...: add a global index fund" -> "...: global index fund"
          return y ? y[0].toUpperCase() + y.slice(1) : x;
        });
        sections = ensureRisk(sections);
        // note cap guaranteed in code: an over-long note loses its second sentence if a risk clause survives
        const noteCapF = holdings.length <= 2 ? 56 : 35;
        sections.positions = sections.positions.map((p) => {
          const wcN = (t: string) => t.split(/\s+/).filter(Boolean).length;
          if (wcN(p.note) <= noteCapF) return p;
          const sents = p.note.split(/(?<=[.!?])\s+/);
          if (sents.length >= 3) {
            const trimmed = [sents[0], ...sents.slice(2)].join(" ");
            if (RISK.test(trimmed) && wcN(trimmed) >= 22 && wcN(trimmed) <= noteCapF) return { ...p, note: trimmed };
          }
          // two long sentences: keep the first (business + quality) and let ensureRisk re-attach a short risk clause
          if (sents.length >= 2 && wcN(sents[0]) <= noteCapF - 9 && wcN(sents[0]) >= 14) return { ...p, note: sents[0] };
          const cutN = p.note.split(/\s+/).slice(0, noteCapF - 11).join(" ").replace(/[,;:]?$/, ".");   // room for the re-attached risk clause
          return { ...p, note: cutN };
        });
        sections = ensureRisk(sections);   // re-attach a short risk clause where the trim removed it
        // the card already labels the tripwire; a model-written "Tripwire:" / "Watch:" prefix would double it
        sections.positions = sections.positions.map((p) => ({ ...p, watch: p.watch
          .replace(/^\s*(tripwire|watch|trigger)\s*[:\-]\s*/i, "")
          // padding the fast model adds to reach a word count ("... triggers watch condition for the quarter")
          .replace(/[,;\s]*\b(which |that |and )?(triggers?|would trigger|trips?|breaks?)\s+(the\s+|a\s+)?(watch|tripwire|trigger|thesis)(\s+condition|\s+trigger)?\b.*$/i, "")
          .replace(/[,;\s]*\b(watch|tripwire)\s+condition\b.*$/i, "")
          .replace(/\s+for the (quarter|period|portfolio)\s*$/i, "")
          .replace(/[,;\s]*\b(triggers?|would trigger|trips?)\s*[.]?\s*$/i, "")
          .trim() }));
        // cash and debt are book facts, never positions (guaranteed in code)
        sections.positions = sections.positions.filter((p) => !/^\$?(cash|debt)\b/i.test(p.name.trim()));
        if (!sections.positions.length) { errors.push(uid.slice(0, 8) + ": assessment had no equity positions"); continue; }
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
NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}

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
calendar: 0-3 items <= 10 words each; EVERY item must carry an explicit FUTURE date (from NEXT EARNINGS ESTIMATES or dated headlines); undated or past items are forbidden.
BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as ₩ (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.\n${READER}`;
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
          if (draft && validSections(draft)) usedCompact = true;
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": editor failed [" + meta1 + " | " + lastMeta + "]"); continue; }

        // ---- stage 4: fact-check (skipped when the wall clock is tight; scrub still runs) ----
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET: ${marketLines}\nLEADERS: ${leaderLines}\nPORTFOLIO:\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (lede 34, overnight 55, note 32, watch 10, desk_view 40) by tightening, not by losing substance. Also: replace any numeric KRX code (like 005930.KS) with the company name; write won as ₩ never "KRW"; delete any calendar or watch item whose date is before today (${briefDate}) and any undated calendar item; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains; if desk_view recaps today's prices, rewrite it as a structural point; overnight must keep at least three market numbers.`, 10000, 30000);
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
        // STYLE_RULES hoisted to module scope (shared with the assessment)
        const dataBlock = `MARKET NOW: ${mktLive || "(no market data)"}
LEADERS: ${leaderLines || "(none tracked)"}
FRESH HEADLINES (8h):
${freshHeads || "- none"}

PORTFOLIO (deterministic; the ONLY source of portfolio numbers):
Total assets $${Math.round(total)}. ${pnlLine}
${statsLines}

NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}
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
positions: the 1-4 holdings actually moving or with fresh news since the open, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and current weight, before smaller names. The largest holding gets the MOST substantive note; spend both its allowed numbers there. note <= 28 words with the day number and WHY it moves; if the driver is unknown write "no clear driver yet" rather than inventing one. watch <= 10 words: a concrete afternoon or tonight event, level, or time; any date must be a REAL FUTURE date (after ${briefDate}), never past. For crypto assets: a price level, ETF flow print, protocol event, or dated macro print. NEVER verbs like monitor, watch, track.
desk_view: what today's action changes about the morning view, or the specific level or event this afternoon that would change it. Structural; never repeat the morning desk view. <= 36 words.
QUIET-BOOK LAW: if no holding moved more than 1.5% and there is no fresh news, SAY the session is quiet in one clause and make the afternoon catalyst the centerpiece. Never manufacture drama, never invent price levels: any level you cite must be within 20% of a price that appears in the data above.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it with new evidence from today's session; restating it in different words is a failure. Cover what the morning could not know.
calendar: 0-3 items for this afternoon or tonight, <= 10 words each.
${STYLE_RULES}\n${READER}`
          : `Write the ${briefDate} CLOSING NOTE (published minutes after the 4:00 PM Eastern close${isFri ? "; it is FRIDAY, so set up the WEEK AHEAD" : ""}) for ONE investor. Your job: settle what today meant for their money and arm them for the next session.

${dataBlock}

${shape}
lede: the day's story for THIS portfolio in one breath: the DAY P&L number, then a consequence clause ("which leaves...", "which means...") saying what it changes about their position. A move recap with no consequence is a failure. <= 30 words.
overnight: the tape at the bell: at least THREE literal numbers copied from MARKET NOW with their EXACT labels, plus the portfolio day P&L. <= 55 words.
positions: the 1-4 holdings that defined the day, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and weight, before smaller names. The largest holding gets the MOST substantive note; spend both its allowed numbers there. note <= 30 words: what happened AND what it means beyond today, with the day number. watch <= 10 words naming a concrete ${isFri ? "next-week" : "tonight-or-tomorrow"} catalyst, level, or event (after-hours earnings, data time, KRX open); any date must be a REAL FUTURE date (after ${briefDate}), never past. For crypto assets: a price level, ETF flow print, protocol event, or dated macro print. NEVER verbs like monitor, watch, track.
desk_view: the setup for ${isFri ? "next week" : "tomorrow"}: the one structural risk or opportunity to sleep on. No single-day numbers. <= 40 words.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it (resolved, worsened, confirmed by the close); restating it in different words is a failure.
calendar: 0-3 items: tonight's after-hours reports, ${isFri ? "next week's" : "tomorrow's"} data or earnings. <= 10 words each.${krHeld ? `\nTheir Korean holdings trade TONIGHT (KRX opens 9:00 PM Eastern). If a Korean name has a catalyst, put it in positions or calendar.` : ""}
${STYLE_RULES}\n${READER}`;
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
DESK CONTEXT:
${memosOut.slice(0, 4).map((m) => `- ${m.name}: ${m.changed ?? ""}. watch: ${m.watch ?? ""}`).join("\n") || "- none"}
${shape}
lede <= 28 words as a consequence for the reader; overnight <= 50 words with >= 3 MARKET NOW numbers and exact labels; 1-3 positions ordered by weight, note <= 28 words with a number, watch <= 10 words taken from DESK CONTEXT or "next session open", NEVER an invented level or date (and NEVER monitor/watch/track); desk_view <= 36 words structural only; calendar []. The day G/L figures in PORTFOLIO are the only loss/gain numbers allowed. No filler, no em dashes, Korean companies by name, won as \u20a9.`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compact, 12000, 35000);
          if (draft && validSections(draft)) usedCompact = true;
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": writer failed [" + lastMeta + "]"); continue; }
        const caps = edition === "midday" ? "lede 28, overnight 50, note 28, watch 10, desk_view 36" : "lede 30, overnight 55, note 30, watch 10, desk_view 40";
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET NOW: ${mktLive}\nLEADERS: ${leaderLines}\nPORTFOLIO: Total $${Math.round(total)}. ${pnlLine}\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (${caps}) by tightening, not by losing substance. Also: replace any numeric KRX code with the company name; write won as \u20a9 never "KRW"; delete any calendar or watch item whose date is before today (${briefDate}) and any undated calendar item; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains; overnight must keep at least three market numbers.`, 10000, 30000);
        sections = (checked && validSections(checked)) ? checked as Sections : draft as Sections;
      }
      if (!sections || !validSections(sections)) { errors.push(uid.slice(0, 8) + ": invalid sections"); continue; }
      sections.calendar = (sections.calendar ?? []).filter((c) => futureDated(String(c), briefDate)).slice(0, 3);
      sections.positions = sections.positions.slice(0, 4)
        .map((p) => ({ ...p, watch: p.watch.replace(/[,;\s]*\b(watch(ing)?|monitor(ing)?|track(ing)?)\b[.\s]*$/i, "").trim() }));
      sections = deepDeDash(sections);
      // deterministic style guarantees: KRX codes -> names, KRW-prefix -> ₩
      const codeToName = new Map(holdings.map((r) => [r.symbol, krName(r.symbol, r.nickname, r.name)] as [string, string]));
      const scrub = (t: string) => {
        let x = t;
        for (const [code, nm] of codeToName) if (code.endsWith(".KS") || code.endsWith(".KQ")) x = x.split(code).join(nm);
        x = x.replace(/KRW\s?(?=[0-9₩])/g, "₩").replace(/₩\s+(?=[0-9])/g, "₩").replace(/\u2011/g, "-");   // non-breaking hyphens read badly in TTS
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
      const { error: upErr } = backfillOnly ? { error: null } : await admin.from("daily_briefs").upsert({
        user_id: uid, brief_date: briefDate, edition, sections, memos: memosOut.slice(0, 8), generated_at: new Date().toISOString(), model: fixture ? "fixture" : usedCompact ? model + " compact" : model,
        audio_path: null,   // new text => stale audio; narrate re-runs for this row
      }, { onConflict: "user_id,brief_date,edition" });
      if (upErr) errors.push(uid.slice(0, 8) + ": " + (upErr as { message: string }).message); else wrote++;
      // ---- audio narration: handed to the dedicated `narrate` function (own wall clock, retries, fallback) ----
      if (!fixture && !upErr && !noAudio) {
        const svcK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
        if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
        // waitUntil: a bare fire-and-forget fetch dies when this request's response is sent
        const handoff = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/narrate`, {
          method: "POST", headers: { Authorization: `Bearer ${svcK}`, apikey: svcK, "Content-Type": "application/json", "x-internal-token": itok },
          body: JSON.stringify({ user_id: uid, brief_date: briefDate, edition }),
        }).then((r) => r.text().catch(() => "")).catch(() => null);
        try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(handoff); } catch { /* ignore */ }
      }
    } catch (e) { errors.push(uid.slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, users: userIds.length, wrote, briefDate, errors: errors.slice(0, 5) });
});
