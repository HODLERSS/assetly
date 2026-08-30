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

async function askMara(key: string, model: string, prompt: string, maxTokens = 10000): Promise<string | null> {
  const r = await fetch("https://api.cloud.mara.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a sharp buy-side equity analyst writing for busy retail investors. Be specific, opinionated, and honest about uncertainty. Plain language, no hedging filler, no disclaimers. Use concrete numbers from the provided data. Respond with the JSON object ONLY — your first character must be '{'. Never write analysis prose outside the JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error("mara api " + r.status + " " + (await r.text().catch(() => "")).slice(0, 120));
  const body = await r.json().catch(() => null);
  const c = body?.choices?.[0]?.message?.content;
  if (!c) throw new Error("mara empty content, finish=" + body?.choices?.[0]?.finish_reason);
  return c;
}

// ---- market sessions (mirror of web/src/lib/markets.ts) ----
const US_HOL = new Set(["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01"]);
const KR_HOL = new Set(["2026-01-01","2026-03-02","2026-05-01","2026-05-05","2026-06-03","2026-06-06","2026-08-17","2026-10-05","2026-10-09","2026-12-25","2026-12-31","2027-01-01"]);
function minsSinceOpen(mkt: "US" | "KR", now = new Date()): number | null {
  const tz = mkt === "US" ? "America/New_York" : "Asia/Seoul";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[get("weekday")] ?? 0;
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  if (dow < 1 || dow > 5 || (mkt === "US" ? US_HOL : KR_HOL).has(ymd)) return null;
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const open = mkt === "US" ? 570 : 540;
  return mins >= open ? mins - open : null;
}
const OPEN_GATE = 10;   // minutes after the bell before the new day's tape is trusted
/** Stale = older than 50min, OR written before today's open once that market has
 *  been trading >=10 min (a pre-open take must not survive into the session). */
function staleInsight(genMs: number, mkt: "US" | "KR" | null, now = new Date()): boolean {
  if (now.getTime() - genMs > 50 * 60000) return true;
  if (!mkt) return false;
  const m = minsSinceOpen(mkt, now);
  return m !== null && m >= OPEN_GATE && genMs < now.getTime() - m * 60000;
}
function sessNote(mkt: "US" | "KR", now = new Date()): string {
  const m = minsSinceOpen(mkt, now);
  const name = mkt === "US" ? "US market" : "Korean market";
  if (m === null) return `${name} has NOT opened today. Any day-change figure is from the LAST completed session. Never call it today's move.`;
  if (m < 390) return `${name} opened ${m} minutes ago. Day changes are TODAY's live tape.`;
  return `${name} finished today's session. Day changes are today's final moves.`;
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

function parseInsight(raw: string): { bullets: string[]; windows: Record<string, string>; news5: string[] | null } | null {
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
    const deDash = (v: unknown) => String(v).replace(/\s*\u2014\s*/g, ", ").replace(/\s*\u2013\s*/g, ", ");
    o.bullets = o.bullets.map(deDash);
    if (o.trend) o.trend = deDash(o.trend);
    const windows = o.trend ? { trend: String(o.trend) } : (o.windows ?? {});
    const news5 = Array.isArray(o.news5) ? o.news5.map(deDash).filter((x: string) => x.trim()).slice(0, 5) : null;
    return { bullets: o.bullets.slice(0, 5).map(String), windows, news5 };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const force = url.searchParams.get("force") === "1" || body.force === true;
  const bearerJwt2 = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  let onlyUser: string | null = typeof body.user_id === "string" ? body.user_id : null;
  if (onlyUser) {
    const isSvc = (() => { try { return JSON.parse(atob(bearerJwt2.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
    // internal hops (orchestrator, callback) authorize with the shared token: the platform gate rejects the legacy service JWT
    let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
    if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
    const isInternal = !!itok && (req.headers.get("x-internal-token") ?? "") === itok;
    if (!isSvc && !isInternal) {
      const { data: ud } = await admin.auth.getUser(bearerJwt2);
      if (ud?.user?.id !== onlyUser) return json({ ok: false, error: "forbidden target" }, 403);   // never silently widen or no-op
    }
  }

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
  // Incremental + session-aware: fresh insights are skipped, but anything written
  // before today's open regenerates ~10 min into the session (no stale "today" takes).
  const { data: kindRows } = await admin.from("symbols").select("symbol,kind").in("symbol", targets);
  const kindOf = new Map((kindRows ?? []).map((k) => [k.symbol, String(k.kind)]));
  const mktOf = (sy: string): "US" | "KR" | null =>
    kindOf.get(sy) === "crypto" ? null : (sy.endsWith(".KS") || sy.endsWith(".KQ") ? "KR" : "US");
  if (!only && !force) targets = targets.filter((sy) => staleInsight(age.get(sy) ?? 0, mktOf(sy)));
  if (force) targets = [];                                    // force = refresh the portfolio layer only
  targets = targets.sort((a, b) =>
    (age.get(a) ?? 0) - (age.get(b) ?? 0) || (invested.get(b) ?? 0) - (invested.get(a) ?? 0)).slice(0, 16);

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
      const { data: fils } = await admin.from("filings").select("form,title,filed_at")
        .eq("symbol", symbol).order("filed_at", { ascending: false }).limit(10);
      const { data: tr } = await admin.from("transcripts").select("title,content,published_at")
        .eq("symbol", symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(4);
      const latestTr = tr?.[0];

      let content: string | null;
      if (fixture) {
        content = JSON.stringify(body.canned ?? { bullets: ["fixture bullet one", "fixture bullet two", "fixture bullet three"], windows: { d7: "flat week", d30: "quiet month", d60: "range-bound", y1: "recovering", y2: "volatile" } });
      } else {
        const mkt = mktOf(symbol);
        const prompt = `Company: ${srow?.name ?? symbol} (${symbol}). Current price ${price}. Price change by window: ${JSON.stringify(perf)}.
Session: ${mkt ? sessNote(mkt) : "Crypto trades 24/7; day changes are rolling."}
Headlines from the last 7 days (${n30 ?? 0} stories in 30d):
${(news7 ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (no fresh headlines)"}
${(fils ?? []).length ? `\nSEC filings (last 9 months): ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}${latestTr ? `\nLatest earnings call ("${latestTr.title}", ${latestTr.published_at}):\n${String(latestTr.content).slice(0, 7000)}\n${(tr ?? []).slice(1).length ? "Older calls on file: " + (tr ?? []).slice(1).map((t) => t.title).join(" | ") : ""}` : "\n(no earnings transcript on file yet)"}

Return STRICT JSON: {"bullets": [3-4 strings], "trend": str}.
bullets: the sharpest takes on what matters RIGHT NOW, synthesizing news, the earnings call, and price action. Each 10-15 words MAX. Interpret, never restate headlines. Refer to the company by NAME, never numeric KRX codes. Write won amounts with the \u20a9 sign. Plain punchy language. Never use em dashes or semicolons.
trend: ONE sentence, max 20 words, covering the recent move and the longer-term picture together.`;
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
  const { data: pf } = await admin.from("portfolio").select("user_id, symbol, kind, account, currency, value, change_pct, nickname, name");
  const byUser = new Map<string, NonNullable<typeof pf>>();
  for (const r of pf ?? []) {
    if (onlyUser && r.user_id !== onlyUser) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }
  const { data: fxRow } = await admin.from("prices").select("price").eq("symbol", "USDKRW").maybeSingle();
  const fx = fxRow ? Number(fxRow.price) : 1380;
  const { data: fxRows } = await admin.from("prices").select("symbol,price").like("symbol", "USD___");
  const fxMap = new Map<string, number>([["USD", 1], ["KRW", fx]]);
  for (const r of fxRows ?? []) { const v = Number(r.price); if (v > 0) fxMap.set(String(r.symbol).slice(3), v); }
  // Korean tickers are opaque numbers; the model reads and writes NAMES for them.
  const dispName = (sy: string, nick?: string | null, nm?: string | null) =>
    (nick || ((sy.endsWith(".KS") || sy.endsWith(".KQ")) && nm ? nm : sy));
  const nameBySym = new Map<string, string>();
  for (const r of pf ?? []) nameBySym.set(r.symbol, dispName(r.symbol, r.nickname, (r as { name?: string }).name));
  const nOf = (sy: string) => nameBySym.get(sy) ?? sy;
  const userIds = fixture ? [...byUser.keys()] : [...byUser.keys()].slice(0, 25);
  const { data: lastPis } = await admin.from("portfolio_insights").select("user_id, generated_at")
    .in("user_id", userIds).order("generated_at", { ascending: false }).limit(200);
  const lastPi = new Map<string, number>();
  for (const pRow of lastPis ?? []) if (!lastPi.has(pRow.user_id)) lastPi.set(pRow.user_id, +new Date(pRow.generated_at));
  for (const uid of userIds) {
    try {
      const rows = byUser.get(uid)!;
      const userMkts: ("US" | "KR")[] = [...new Set(rows
        .filter((r) => r.kind !== "cash" && r.kind !== "debt" && r.kind !== "crypto")
        .map((r) => (r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ") ? "KR" as const : "US" as const)))];
      // Same session-aware staleness as symbols: skip only while genuinely current.
      if (!fixture && !force && !userMkts.some((mk) => staleInsight(lastPi.get(uid) ?? 0, mk))
          && Date.now() - (lastPi.get(uid) ?? 0) <= 50 * 60000) continue;
      const usd = (r: (typeof rows)[number]) => Number(r.value ?? 0) / (fxMap.get(String(r.currency)) ?? 1);
      const assets = rows.filter((r) => r.kind !== "debt");
      const debt = rows.filter((r) => r.kind === "debt").reduce((a, r) => a + usd(r), 0);
      const total = assets.reduce((a, r) => a + usd(r), 0);
      if (total < 100) continue;                                   // nothing meaningful to say
      const desc = assets.sort((a, b) => usd(b) - usd(a)).slice(0, 15)
        .map((r) => `${nOf(r.symbol)} (${r.kind}${r.account !== "brokerage" ? ", " + r.account : ""}): $${Math.round(usd(r))} = ${(usd(r) / total * 100).toFixed(1)}% of assets, day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"}`).join("\n");
      const { data: invRow } = await admin.from("profiles").select("investor").eq("id", uid).maybeSingle();
      const READER = readerBlock(invRow?.investor as Investor | null);
      const { data: symIns } = await admin.from("insights").select("symbol, bullets, generated_at")
        .in("symbol", assets.map((r) => r.symbol)).order("generated_at", { ascending: false }).limit(30);
      const latestBySym = new Map<string, string>();
      for (const i of symIns ?? []) if (!latestBySym.has(i.symbol)) latestBySym.set(i.symbol, (i.bullets as string[])[0] ?? "");
      // signals beyond price: latest earnings calls (dated) + fresh headlines per holding
      const sigSyms = assets.map((r) => r.symbol).filter((sy) => !sy.startsWith("$")).slice(0, 12);
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ data: trs }, { data: nws }] = await Promise.all([
        admin.from("transcripts").select("symbol,title,published_at").in("symbol", sigSyms).order("published_at", { ascending: false, nullsFirst: false }).limit(30),
        admin.from("news").select("symbol,title,source,published_at").in("symbol", sigSyms).gte("published_at", since7).order("published_at", { ascending: false }).limit(80),
      ]);
      const callLines = sigSyms.map((sy) => { const t = (trs ?? []).find((x) => x.symbol === sy); return t ? `- ${nOf(sy)}: ${String(t.title).slice(0, 80)} (call date ${String(t.published_at).slice(0, 10)})` : null; }).filter(Boolean).join("\n");
      const newsLines = sigSyms.map((sy) => (nws ?? []).filter((x) => x.symbol === sy).slice(0, 2).map((x) => `- ${nOf(sy)} [${x.source}]: ${String(x.title).slice(0, 90)}`).join("\n")).filter(Boolean).join("\n");
      let content: string | null;
      if (fixture) {
        content = JSON.stringify(body.cannedPortfolio ?? { bullets: ["portfolio fixture one", "portfolio fixture two", "portfolio fixture three"], news5: ["fixture signal one", "fixture signal two", "fixture signal three", "fixture signal four", "fixture signal five"] });
      } else {
        const prompt = `A retail investor's portfolio (total assets $${Math.round(total)}, debt $${Math.round(debt)}):
Market sessions right now: ${userMkts.map((mk) => sessNote(mk)).join(" ")}
${desc}
Latest earnings calls on file:
${callLines || "- (none)"}
Fresh headlines (7d):
${newsLines || "- (none)"}
Sharpest current takes per holding:
${[...latestBySym.entries()].map(([sym, b]) => `- ${nOf(sym)}: ${b}`).join("\n") || "- (none yet)"}

Return STRICT JSON: {"bullets": [exactly 3 strings], "news5": [exactly 5 strings]}. You are their portfolio strategist.
Bullet 1: the ONLY price bullet. Recent moves that mattered, with numbers.
Bullet 2: the most decision-relevant company signal right now: an earnings call (state its date), interview, filing, or news. Any holding qualifies, not just the largest position.
Bullet 3: a mid-term signal a value investor should note: valuation, fundamentals trend, or upcoming catalyst.
Each bullet 15 words MAX. Spread coverage across different holdings when the signals warrant it.
news5: the top 5 signals from this week across their holdings, RANKED by importance to THIS portfolio (weight by position size and decision impact). Each 10 words MAX, names the company (US ticker OK; Korean companies by NAME), no two about the same story.
${READER}
Bullet 3 must speak to THIS reader's lens, purpose and horizon (see the profile above).
Respect the session notes: never present the last session's move as happening today. Refer to Korean companies by NAME, never numeric KRX codes like 005930.KS. Write won amounts with the \u20a9 sign. Plain punchy language. Never use em dashes or semicolons. No generic advice.`;
        content = await askMara(key, model, prompt, 14000);
      }
      const parsed = content ? parseInsight(content) : null;
      if (!parsed) { errors.push("user " + uid.slice(0, 8) + ": unparseable"); continue; }
      const { error: piErr } = await admin.from("portfolio_insights").insert({ user_id: uid, bullets: parsed.bullets.slice(0, 3), news5: parsed.news5, model });
      if (piErr) errors.push("user " + uid.slice(0, 8) + ": " + piErr.message); else pWrote++;
    } catch (e) { errors.push("user: " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, portfolios: userIds.length, portfolioWrote: pWrote, errors: errors.slice(0, 5) });
});
