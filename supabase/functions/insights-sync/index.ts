// Assetly insights-sync — hourly, per held symbol: MARA Cloud (MiniMax M3) turns the
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

// MiniMax-M2.7 (the model before M3, 2026-09-13) + json_object could exhaust its token budget on the longest prompt shapes and return
// HTTP 400 "Model did not output valid JSON. The output was truncated" - which used to kill the whole
// insight for that user. gpt-oss-120b writes the same shape validly, so every call falls back to it.
const FAST_MODEL = "gpt-oss-120b";
async function askMaraFb(key: string, model: string, prompt: string, maxTokens = 10000): Promise<string | null> {
  if (model !== FAST_MODEL) {
    try {
      const c = await askMara(key, model, prompt, maxTokens);
      if (c) return c;
    } catch (e) {
      console.log("insights: primary model failed, falling back to " + FAST_MODEL + ": " + String(e).slice(0, 140));
    }
  }
  return await askMara(key, FAST_MODEL, prompt, maxTokens);
}

// ---- trading calendar (mirror of web/src/lib/markets.ts; lunar KR holidays are listed explicitly) ----
// Every prompt that mentions a "day" move gets these lines, so the model knows WHICH session a figure
// belongs to and how long ago that session ended. Caught 2026-09-11: a Friday 3:30 PM CT note said the
// Korean names "fell 1.5% today" about a Seoul session that had closed 14 hours earlier.
type Mkt = "US" | "KR";
const HOL: Record<Mkt, Set<string>> = {
  US: new Set(["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]),
  KR: new Set(["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-02","2026-05-01","2026-05-05","2026-05-25","2026-06-03","2026-06-06","2026-08-17","2026-09-24","2026-09-25","2026-10-05","2026-10-09","2026-12-25","2026-12-31","2027-01-01","2027-02-08","2027-02-09","2027-02-10","2027-03-01","2027-05-05","2027-05-13","2027-06-07","2027-08-16","2027-09-14","2027-09-15","2027-09-16","2027-10-04","2027-10-11","2027-12-31"]),
};
const TZ: Record<Mkt, string> = { US: "America/New_York", KR: "Asia/Seoul" };
const OPEN_MIN: Record<Mkt, number> = { US: 570, KR: 540 };    // 9:30 ET, 9:00 KST
const CLOSE_MIN: Record<Mkt, number> = { US: 960, KR: 930 };   // 4:00 PM ET, 3:30 PM KST
function zonedParts(now: Date, tz: string): { ymd: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[get("weekday")] ?? 0;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, dow, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}
const ymdShift = (ymd: string, days: number): string => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const dowOf = (ymd: string): number => new Date(ymd + "T12:00:00Z").getUTCDay();
const isTradingDay = (mkt: Mkt, ymd: string): boolean => { const d = dowOf(ymd); return d >= 1 && d <= 5 && !HOL[mkt].has(ymd); };
const prevTradingDay = (mkt: Mkt, ymd: string): string => { let x = ymd; do x = ymdShift(x, -1); while (!isTradingDay(mkt, x)); return x; };
const nextTradingDay = (mkt: Mkt, ymd: string): string => { let x = ymd; do x = ymdShift(x, 1); while (!isTradingDay(mkt, x)); return x; };
function tzOffsetMin(epoch: number, tz: string): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(epoch)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = s.match(/([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
/** Epoch ms of a wall-clock minute on a date in a zone (DST-safe: the offset is read at that instant). */
function zonedEpoch(ymd: string, minutes: number, tz: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, 0, minutes);
  return naive - tzOffsetMin(naive, tz) * 60000;
}
type MarketState = { mkt: Mkt; ymd: string; dow: number; tradingToday: boolean; holidayToday: boolean; phase: "pre" | "open" | "post" | "closed"; minutesIn: number; lastSessionDate: string; lastCloseEpoch: number; hoursSinceClose: number; nextSessionDate: string; hoursToNextOpen: number; upcomingHolidays: string[] };
function marketState(mkt: Mkt, now = new Date()): MarketState {
  const z = zonedParts(now, TZ[mkt]);
  const tradingToday = isTradingDay(mkt, z.ymd);
  const phase: MarketState["phase"] = !tradingToday ? "closed" : z.minutes < OPEN_MIN[mkt] ? "pre" : z.minutes < CLOSE_MIN[mkt] ? "open" : "post";
  const lastSessionDate = phase === "open" || phase === "post" ? z.ymd : prevTradingDay(mkt, z.ymd);
  const lastCloseEpoch = zonedEpoch(lastSessionDate, CLOSE_MIN[mkt], TZ[mkt]);
  const nextSessionDate = phase === "pre" ? z.ymd : nextTradingDay(mkt, z.ymd);
  const nextOpenEpoch = zonedEpoch(nextSessionDate, OPEN_MIN[mkt], TZ[mkt]);
  const horizon = ymdShift(z.ymd, 10);
  return { mkt, ymd: z.ymd, dow: z.dow, tradingToday, holidayToday: HOL[mkt].has(z.ymd), phase, minutesIn: phase === "open" ? z.minutes - OPEN_MIN[mkt] : 0,
    lastSessionDate, lastCloseEpoch, hoursSinceClose: phase === "open" ? 0 : Math.max(0, (now.getTime() - lastCloseEpoch) / 3600000),
    nextSessionDate, hoursToNextOpen: Math.max(0, (nextOpenEpoch - now.getTime()) / 3600000),
    upcomingHolidays: [...HOL[mkt]].filter((h) => h > z.ymd && h <= horizon).sort() };
}
const dayName = (ymd: string): string => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayOf = (ymd: string): string => dayName(ymd).split(",")[0];
const spanText = (h: number): string => h < 1.5 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
/** Is a day figure from this market "today's tape"? Open now, or closed under 3 hours ago. */
const isLiveTape = (s: MarketState): boolean => s.phase === "open" || (s.phase === "post" && s.hoursSinceClose < 3);
/** One deterministic sentence per market for the prompts: what session the day figures belong to, how stale it is, what comes next. */
function sessionLine(mkt: Mkt, now = new Date()): string {
  const s = marketState(mkt, now);
  const name = mkt === "US" ? "US market" : "Korean market (KRX)";
  const hol = s.upcomingHolidays.length ? `; ${mkt} market holiday${s.upcomingHolidays.length > 1 ? "s" : ""} ahead: ${s.upcomingHolidays.map(dayName).join(", ")}` : "";
  const next = `Next ${mkt} session: ${dayName(s.nextSessionDate)}, opens in ${spanText(s.hoursToNextOpen)}${hol}.`;
  if (s.phase === "open") return `${name}: OPEN now, ${s.minutesIn} minutes into the ${dayName(s.ymd)} session. ${mkt} day changes are today's live tape. ${next}`;
  const closedWhy = s.phase === "closed" ? (s.holidayToday ? " Closed today for a market holiday." : " Closed today (weekend).") : s.phase === "pre" ? " Not open yet today." : "";
  const ago = s.phase === "post" && s.hoursSinceClose < 3 ? "just closed" : `closed ${spanText(s.hoursSinceClose)} ago`;
  const which = s.phase === "post" ? `today's ${dayName(s.ymd)} session` : `its last session, ${dayName(s.lastSessionDate)}`;
  const law = isLiveTape(s) ? `${mkt} day changes are today's final moves.`
    : s.phase === "post" ? `${mkt} day changes are from today's session, which ended ${spanText(s.hoursSinceClose)} ago: past tense ("in today's session"), never "now", "this morning" or "live".`
    : `${mkt} day changes are from that ${weekdayOf(s.lastSessionDate)} session, NOT today's tape: write "in ${weekdayOf(s.lastSessionDate)}'s session", never "today", "now" or "this morning".`;
  return `${name}: ${ago} (${which}).${closedWhy} ${law} ${next}`;
}
function minsSinceOpen(mkt: "US" | "KR", now = new Date()): number | null {
  const st = marketState(mkt, now);
  if (!st.tradingToday) return null;
  const z = zonedParts(now, TZ[mkt]);
  return z.minutes >= OPEN_MIN[mkt] ? z.minutes - OPEN_MIN[mkt] : null;
}
const OPEN_GATE = 10;   // minutes after the bell before the new day's tape is trusted
const CLOSE_GATE = 5;   // minutes after the close before the final numbers are trusted
const FRESH_OPEN_MIN = 30, FRESH_CLOSED_MIN = 50;
/** Stale = older than the tempo for that market (30 min while it trades, 50 min otherwise), OR written
 *  before today's open once the market has traded >= 10 min, OR written before the close once the close
 *  is >= 5 min old (the closing numbers deserve a fresh take within the hour). Two-market books get both
 *  tempos: a Korean name refreshes on the Seoul clock, a US name on the New York clock. */
function staleInsight(genMs: number, mkt: "US" | "KR" | null, now = new Date()): boolean {
  const st = mkt ? marketState(mkt, now) : null;
  const fresh = st?.phase === "open" ? FRESH_OPEN_MIN : FRESH_CLOSED_MIN;
  if (now.getTime() - genMs > fresh * 60000) return true;
  if (!mkt || !st) return false;
  const m = minsSinceOpen(mkt, now);
  if (m !== null && m >= OPEN_GATE && genMs < now.getTime() - m * 60000) return true;
  return st.phase === "post" && st.hoursSinceClose * 60 >= CLOSE_GATE && st.hoursSinceClose < 1 && genMs < st.lastCloseEpoch;
}
/** Days since an earnings call was published (null when there is no call on file). */
function callAgeDays(publishedAt: unknown, now = new Date()): number | null {
  const t = +new Date(String(publishedAt ?? ""));
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86400000)) : null;
}
const CALL_FRESH_DAYS = 7;
/** What the model must know about the call's age. A quarter-old transcript reads like today's news
 *  without this: "Reddit just posted its 8th straight quarter" shipped 40 days after the call (2026-09-08). */
function callAgeNote(publishedAt: unknown, now = new Date()): string {
  const age = callAgeDays(publishedAt, now);
  if (age === null) return "";
  const iso = String(publishedAt).slice(0, 10);
  if (age <= CALL_FRESH_DAYS) return `That call is ${age} day${age === 1 ? "" : "s"} old (${iso}): its results are fresh news.`;
  return `That call was ${age} days ago (${iso}), long before today. It is BACKGROUND, not news: nothing in it was "just" reported. Never write just, today, this week, fresh, new, or latest about anything from it; date it ("the ${iso.slice(5)} call", "last quarter") or frame it as still true. Only the dated headlines and the price windows are current.`;
}
/** Deterministic backstop: with a stale call, "just posted/reported ..." is a dating error, never a fact. */
const STALE_JUST = /\b(just|freshly|newly)\s+(posted|reported|printed|delivered|hit|logged|notched|announced|beat|put up|turned in|closed|grew|guided|raised|lifted|showed|confirmed)\b/gi;
function deJust(text: string, callAge: number | null): string {
  if (callAge === null || callAge <= CALL_FRESH_DAYS) return text;
  return text.replace(STALE_JUST, "$2");
}
function sessNote(mkt: "US" | "KR", now = new Date()): string { return sessionLine(mkt, now); }


// ---- reader profile: the 6 sign-up answers steer VOICE, EMPHASIS and PURPOSE, never the facts ----
type Investor = { styles?: string[] | string; purpose?: string[] | string; horizon?: string[] | string; target?: string[] | string; risk?: string[] | string; level?: string[] | string };
// answers may be single strings (old profiles) or arrays (multi-select quiz): normalize, and reduce where one value must win
const toArr = (x: unknown, d: string[]): string[] => Array.isArray(x) ? (x.length ? x.map(String) : d) : (typeof x === "string" && x ? [x] : d);
const LVL_ORDER = ["novice", "intermediate", "advanced", "pro"];
const topLevel = (xs: string[]): string => xs.reduce((a, b) => (LVL_ORDER.indexOf(b) > LVL_ORDER.indexOf(a) ? b : a), "novice");
const HZ_ORDER = ["<1y", "1-3y", "3-10y", "10y+"];
const longestHz = (xs: string[]): string => xs.reduce((a, b) => (HZ_ORDER.indexOf(b) > HZ_ORDER.indexOf(a) ? b : a), xs[0] ?? "3-10y");

function readerBlock(inv: Investor | null | undefined): string {
  const raw = inv ?? {};
  const v = { styles: toArr(raw.styles, ["value"]), purpose: toArr(raw.purpose, ["watch"]), horizon: toArr(raw.horizon, ["3-10y"]),
    target: toArr(raw.target, ["8-12%"]), risk: toArr(raw.risk, ["hold"]), level: topLevel(toArr(raw.level, ["novice"])) };
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
    novice: "BEGINNER reader: plain words, short sentences. Sentences of at most 14 words. NO bare acronyms or jargon ANYWHERE, including watch items and bullets. Banned for this reader: EVERY financial acronym and term of art, including ROE, ROIC, EBITDA, FCF, P/E, EPS, AUM, NIM, capex, basis points, net flows, net interest margin (say: lending profit margin), and the bare word moat (say: a lasting edge over competitors). Use the plain phrase instead: profit growth not ROE, cash flow not FCF, operating profit not EBITDA. Ticker symbols with weights (like QQQM 25.6%) are fine, they are names, not jargon. If a term is unavoidable, gloss it in-line (like: free cash flow, the cash left after all expenses). Never condescend.",
    intermediate: "Informed reader: plain everyday language with as little financial jargon as possible; everyday investing words (dividend, earnings, revenue, valuation) are fine without explanation, but avoid acronyms and terms of art the same way you would for a beginner, minus the in-line explanations.",
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
  const st = v.styles.map((x) => styleG[x] ?? "").filter(Boolean).join("; also ");
  const pp = v.purpose.map((x) => purpG[x] ?? "").filter(Boolean).join(" ");
  const hz = horG[longestHz(v.horizon)] ?? horG["3-10y"];
  const rk = v.risk.map((x) => riskG[x] ?? "").filter(Boolean).join(" and ");
  return `READER PROFILE (personalize EMPHASIS, VOCABULARY and FRAMING for this one reader; facts and numbers stay identical):
- ${lvlG[v.level] ?? lvlG.novice}
- Lens: ${st || styleG.value}. Apply the lens TO this book in EVERY position note and the structure section: the first judgment in each comes through this lens (value: what it is worth versus its price and the downside; income: state in EVERY position note whether and roughly how well that holding pays the owner, dividend or yield posture included, and in the structure section how much income the whole book actually produces), even when the book does not match the lens. Even the one-line verdict must carry the lens: name what kind of book it is AND what that means through this lens (for income: what the book pays its owner; for value: what it costs versus what it earns).
- ${pp || purpG.watch}
- ${hz}; target return ${v.target.join(" or ")}/yr; ${rk || riskG.hold}.`;
}


// deterministic plain-language pass for BEGINNER readers: the recurring terms the model keeps leaking, mapped in code
const NOVICE_MAP: [RegExp, string][] = [
  [/\bshort interest\b/gi, "bets against the stock"], [/\bof float\b/gi, "of its tradable shares"],
  [/\bleverage(d)?\b/gi, "borrowed money"], [/\bhigh[- ]beta\b/gi, "sharper-moving-than-the-market"],
  [/\bbeta\b/gi, "sensitivity to market swings"], [/\bvaluation multiple(s)?\b/gi, "price tag relative to earnings"],
  [/\bmultiple compression\b/gi, "a shrinking price tag relative to earnings"], [/\bnet interest margin\b/gi, "lending profit margin"],
  [/\bAUM\b/g, "assets under management"], [/\bROE\b/g, "return on the owners' money"], [/\bROIC\b/g, "return on invested money"],
  [/\bEBITDA\b/g, "operating profit"], [/\bFCF\b/g, "spare cash flow"], [/\bP\/E\b/g, "price-to-earnings ratio"],
  [/\bEPS\b/g, "earnings per share"], [/\bcapex\b/gi, "spending on equipment and buildout"], [/\bbasis points\b/gi, "hundredths of a percent"],
  [/\bshort-duration\b/gi, "shorter-term"], [/\blong-duration\b/gi, "longer-term"], [/\binflows\b/gi, "money coming in"], [/\boutflows\b/gi, "money leaving"],
  [/\brotce\b/gi, "bank profitability"], [/\broa\b/gi, "profit on assets"], [/\breturn on (tangible )?(common )?equity\b/gi, "bank profitability"],
  [/\bmoat\b/gi, "lasting edge over competitors"], [/\bdrawdown(s)?\b/gi, "drop from the top"], [/\bDAU\b/g, "daily users"],
];
const noviceScrub = (t: string): string => { let x = t; for (const [re, plain] of NOVICE_MAP) x = x.replace(re, plain); return x; };

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
  const model = Deno.env.get("MARA_MODEL") ?? "MiniMax-M3";
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
  // Newest headline per target: on a day its market is closed, a symbol regenerates only when there is something
  // new to say (a take rewritten hourly from the same Friday data is repetition, not insight).
  const { data: newsRows } = await admin.from("news").select("symbol,published_at").in("symbol", targets)
    .gte("published_at", new Date(Date.now() - 4 * 86400000).toISOString()).order("published_at", { ascending: false }).limit(1500);
  const newestNews = new Map<string, number>();
  for (const n of newsRows ?? []) if (!newestNews.has(n.symbol)) newestNews.set(n.symbol, +new Date(String(n.published_at)));
  const worthRegen = (sy: string): boolean => { const mk = mktOf(sy); if (!mk || marketState(mk).tradingToday) return true; return (newestNews.get(sy) ?? 0) > (age.get(sy) ?? 0); };
  if (!only && !force) targets = targets.filter((sy) => staleInsight(age.get(sy) ?? 0, mktOf(sy)) && worthRegen(sy));
  if (force) targets = [];                                    // force = refresh the portfolio layer only
  // Priority: names whose market is OPEN right now first (their tape is moving), then the stalest, then the biggest.
  const openNow = (sy: string) => { const mk = mktOf(sy); return mk ? (marketState(mk).phase === "open" ? 0 : 1) : 1; };
  targets = targets.sort((a, b) =>
    openNow(a) - openNow(b) || (age.get(a) ?? 0) - (age.get(b) ?? 0) || (invested.get(b) ?? 0) - (invested.get(a) ?? 0)).slice(0, 16);

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
        const prompt = `TODAY is ${new Date().toISOString().slice(0, 10)}.
Company: ${srow?.name ?? symbol} (${symbol}). Current price ${price}. Price change by window: ${JSON.stringify(perf)}.
Session: ${mkt ? sessNote(mkt) : "Crypto trades 24/7; day changes are rolling."}
Headlines from the last 7 days (${n30 ?? 0} stories in 30d):
${(news7 ?? []).map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (no fresh headlines)"}
${(fils ?? []).length ? `\nSEC filings (last 9 months): ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}${latestTr ? `\nLatest earnings call ("${latestTr.title}", ${latestTr.published_at}):\n${String(latestTr.content).slice(0, 7000)}\n${callAgeNote(latestTr.published_at)}\n${(tr ?? []).slice(1).length ? "Older calls on file: " + (tr ?? []).slice(1).map((t) => t.title).join(" | ") : ""}` : "\n(no earnings transcript on file yet)"}

Return STRICT JSON: {"bullets": [3-4 strings], "trend": str}.
bullets: the sharpest takes on what matters RIGHT NOW, synthesizing news, the earnings call, and price action. Respect the call's age above: a call older than a week is context for a take, never the news itself. DAY-CHANGE LAW: a day figure is today's tape only while the market is open or closed under 3 hours; otherwise it is past tense with the session named, and on a day the market is closed the takes are about the week and the news, never a move. Each 10-15 words MAX. Interpret, never restate headlines. Refer to the company by NAME, never numeric KRX codes. Write won amounts with the \u20a9 sign. Plain punchy language. Never use em dashes or semicolons.
trend: ONE sentence, max 20 words, covering the recent move and the longer-term picture together.`;
        content = await askMaraFb(key, model, prompt);
      }
      const parsed = content ? parseInsight(content) : null;
      if (!parsed) { errors.push(symbol + ": unparseable raw[" + String(content).slice(0, 260).replace(/\n/g, " ") + "]"); continue; }
      const trAge = callAgeDays(latestTr?.published_at);
      const { error: upErr } = await admin.from("insights").insert({
        symbol, bullets: parsed.bullets.map((b) => deJust(b, trAge)), windows: parsed.windows, model,
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
      // Same session-aware staleness as symbols, on every market the book holds: a two-market book refreshes on
      // both clocks (30 min while either market trades, 50 min otherwise, plus the open and close gates).
      if (!fixture && !force && !userMkts.some((mk) => staleInsight(lastPi.get(uid) ?? 0, mk))
          && Date.now() - (lastPi.get(uid) ?? 0) <= FRESH_CLOSED_MIN * 60000) continue;
      // No held market trades today: only new headlines justify another portfolio take
      if (!fixture && !force && userMkts.length && userMkts.every((mk) => !marketState(mk).tradingToday)) {
        const { count } = await admin.from("news").select("id", { count: "exact", head: true }).in("symbol", rows.map((r) => r.symbol)).gte("published_at", new Date(lastPi.get(uid) ?? 0).toISOString());
        if (!(count ?? 0)) continue;
      }
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
      const callLines = sigSyms.map((sy) => { const t = (trs ?? []).find((x) => x.symbol === sy); return t ? `- ${nOf(sy)}: ${String(t.title).slice(0, 80)} (call date ${String(t.published_at).slice(0, 10)}, ${callAgeDays(t.published_at) ?? "?"} days ago${(callAgeDays(t.published_at) ?? 0) > CALL_FRESH_DAYS ? ", background, not news" : ", fresh"})` : null; }).filter(Boolean).join("\n");
      const newsLines = sigSyms.map((sy) => (nws ?? []).filter((x) => x.symbol === sy).slice(0, 2).map((x) => `- ${nOf(sy)} [${x.source}]: ${String(x.title).slice(0, 90)}`).join("\n")).filter(Boolean).join("\n");
      let content: string | null;
      let prompt = "";
      if (fixture) {
        content = JSON.stringify(body.cannedPortfolio ?? { bullets: ["portfolio fixture one", "portfolio fixture two", "portfolio fixture three"], news5: ["fixture signal one", "fixture signal two", "fixture signal three", "fixture signal four", "fixture signal five"] });
      } else {
        prompt = `TODAY is ${new Date().toISOString().slice(0, 10)}.
A retail investor's portfolio (total assets $${Math.round(total)}, debt $${Math.round(debt)}):
SESSIONS (deterministic; obey over any instinct):\n${userMkts.map((mk) => sessNote(mk)).join("\n")}
${desc}
Latest earnings calls on file:
${callLines || "- (none)"}
Fresh headlines (7d):
${newsLines || "- (none)"}
Sharpest current takes per holding:
${[...latestBySym.entries()].map(([sym, b]) => `- ${nOf(sym)}: ${b}`).join("\n") || "- (none yet)"}

Return STRICT JSON: {"bullets": [exactly 3 strings], "news5": [exactly 5 strings]}. You are their portfolio strategist.
Bullet 1: the ONLY price bullet. Moves from a market that is today's tape per SESSIONS, with numbers; a market whose session ended more than 3 hours ago is past tense with the session named; if no held market traded today, this bullet is the WEEK's direction (say "this week"), never "today".
Bullet 2: the most decision-relevant company signal right now: an earnings call (state its date; a call marked background was weeks ago and was NOT just reported, so never write just, today, this week, or fresh about it), interview, filing, or news. Any holding qualifies, not just the largest position.
Bullet 3: a mid-term signal a value investor should note: valuation, fundamentals trend, or upcoming catalyst.
Each bullet 15 words MAX. Spread coverage across different holdings when the signals warrant it.
news5: the top 5 signals from this week across their holdings, RANKED by importance to THIS portfolio (weight by position size and decision impact). Each 10 words MAX, names the company (US ticker OK; Korean companies by NAME), no two about the same story.
${READER}
Bullet 3 must speak to THIS reader's lens, purpose and horizon (see the profile above).
Respect the session notes: never present the last session's move as happening today. Refer to Korean companies by NAME, never numeric KRX codes like 005930.KS. Write won amounts with the \u20a9 sign. Plain punchy language. Never use em dashes or semicolons. No generic advice.`;
        content = await askMaraFb(key, model, prompt, 14000);
      }
      let parsed = content ? parseInsight(content) : null;
      if (!parsed && !fixture) {   // a valid-JSON-but-wrong-shape reply still deserves one clean retry on the fast model
        const retry = await askMaraFb(key, FAST_MODEL, prompt, 14000).catch(() => null);
        parsed = retry ? parseInsight(retry) : null;
      }
      if (!parsed) { errors.push("user " + uid.slice(0, 8) + ": unparseable"); continue; }
      const freshestCall = Math.min(...sigSyms.map((sy) => callAgeDays((trs ?? []).find((x) => x.symbol === sy)?.published_at) ?? Infinity));
      const pAge = Number.isFinite(freshestCall) ? freshestCall : null;
      const isNovice = ["novice", "intermediate"].includes(topLevel(toArr((invRow?.investor as Investor | null | undefined)?.level, ["novice"])));
      const scrubB = (xs: string[] | null | undefined) => (xs ?? []).map((x) => deJust(isNovice ? noviceScrub(x) : x, pAge));
      const { error: piErr } = await admin.from("portfolio_insights").insert({ user_id: uid, bullets: scrubB(parsed.bullets).slice(0, 3), news5: parsed.news5 ? scrubB(parsed.news5) : parsed.news5, model });
      if (piErr) errors.push("user " + uid.slice(0, 8) + ": " + piErr.message); else pWrote++;
    } catch (e) { errors.push("user: " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, portfolios: userIds.length, portfolioWrote: pWrote, errors: errors.slice(0, 5) });
});
