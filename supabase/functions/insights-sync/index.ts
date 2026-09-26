// Assetly insights-sync — hourly, per held symbol: MARA Cloud (MiniMax M3) turns the
// last 7 days of headlines, the latest earnings-call transcript, and multi-horizon price
// action into 3-5 opinionated bullets plus one-line takes for 7D/30D/60D/1Y/2Y.
// Stored in public.insights; rendered clearly separated from raw news. Fixture mode for tests.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { TZ, OPEN_MIN, zonedParts, marketState, sessionLine, dayTag, marketOf } from "../_shared/calendar.ts";
import {
  adviceHits, aliasesFor, booksKorean, CARD_PLAIN, cardCopyHits, dayMoveMismatches, deliveriesEstimate, earningsLine, EVIDENCE_LAW, fixArticles, fixPriceConfusions,
  YTD, dividendContradictions, fixWeights, historicalClaims, isEarningsCallTitle, noviceGloss, unattributedDollars, overlap, periodReturnMismatches, tidyNumbers, unsupportedCauses, levelMismatches, type LiveFact, mentionedSymbols, pctText, plainScrub, PORTFOLIO_PLAIN, type PosFact, usableNews, wrongDeliveriesDates,
  digitsForWritten, dropInstructionEcho, fixFractions, promoCharacterisations, crossedLevelClaims, unicodeMinus, sanitize, glossParenthetical, anchorNewsItem, staleNewsTitle,
  readerLevel, softVerdicts, duplicateMoveBullets, earningsEstimate, relativeGapClaims, productVersionClaims, directionCauseClaims, splitSentences, glossedCardHits, CARD_MAX_AGE_DAYS, canonicalSymbol,
} from "../_shared/intel.ts";
import { dividendRows, ensureHistory, hiLo, refreshDividends, repairNames, windowReturns } from "../_shared/history.ts";
import { bearerOf, userIdFrom } from "../_shared/auth.ts";
import { earningsFilings } from "../_shared/filings.ts";
import { callJudge } from "../_shared/judge.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const WINDOWS: [string, number][] = [["d7", 7], ["d30", 30], ["d60", 60], ["ytd", YTD], ["y1", 365], ["y2", 730]];


async function askMara(key: string, model: string, prompt: string, maxTokens = 10000, timeoutMs = 75000): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch(`${Deno.env.get("MARA_BASE_URL") ?? "https://api.cloud.mara.com"}/v1/chat/completions`, {   // base overridable for local fixture runs
    signal: ac.signal,
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a sharp buy-side equity analyst writing for busy retail investors. Be specific, opinionated about what matters and why, and honest about uncertainty; never about whether to buy or sell. Plain language, no hedging filler, no disclaimers. Use concrete numbers from the provided data, exactly as given. Respond with the JSON object ONLY — your first character must be '{'. Never write analysis prose outside the JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  }).finally(() => clearTimeout(timer));
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
// primaryTimeoutMs: the connect moment (a user waiting on their first assessment) caps the primary model's
// attempt so a deterministic "truncated" failure (~85s on M3) costs 35s, not the whole chain's clock.
async function askMaraFb(key: string, model: string, prompt: string, maxTokens = 10000, primaryTimeoutMs = 75000): Promise<string | null> {
  if (model !== FAST_MODEL) {
    try {
      const c = await askMara(key, model, prompt, maxTokens, primaryTimeoutMs);
      if (c) return c;
    } catch (e) {
      console.log("insights: primary model failed, falling back to " + FAST_MODEL + ": " + String(e).slice(0, 140));
    }
  }
  return await askMara(key, FAST_MODEL, prompt, maxTokens);
}

// ---- trading calendar: ../_shared/calendar.ts (shared with daily-brief and ask) ----
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
 *  tempos: a Korean name refreshes on the Korea clock, a US name on the New York clock. */
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

/** What is wrong with each line of a take, against the live numbers it was written from: a day move that is
 *  not the session's move ("VOO down 0.6%" at +0.45%), a price level that is not where it trades ("BTC near
 *  $78K" at $83.7K), a trade instruction or a valuation call ("looks cheap", "sets up well"). Round 2 saw all
 *  three on cards written after the round-1 deploy. */
// Round 3 added: a deliveries date that is not the known one ("Q3 deliveries due late October"; Tesla's is Oct 2),
// pipeline wording ("Two-year price history is unavailable"), returns "from the 1Y low" instead of the window.
type DlvFact = { names: string[]; est: string | null };
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
function takeProblems(lines: string[], facts: LiveFact[], dlv: DlvFact[] = []): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const s of dayMoveMismatches(l, facts)) out.push(`"${s}" states a day move that is not the session move in the data`);
    for (const s of levelMismatches(l, facts)) out.push(`"${s}" puts the price somewhere it is not trading (see the share price in the data)`);
    for (const s of adviceHits(l)) out.push(`"${s}" is a buy/sell, cheap/expensive or catalyst call; state the fact or the metric instead`);
    for (const s of wrongDeliveriesDates(l, dlv, todayEt())) out.push(`"${s}" dates a deliveries report that is not in the data (deliveries are not earnings)`);
    for (const s of cardCopyHits(l)) out.push(`"${s}" talks about missing data or measures a return from a high or low; use only the windows given and never mention data availability`);
  }
  return out;
}
const lineOk = (l: string, facts: LiveFact[], dlv: DlvFact[] = []) => !dayMoveMismatches(l, facts).length && !levelMismatches(l, facts).length && !adviceHits(l).length
  && !wrongDeliveriesDates(l, dlv, todayEt()).length && !cardCopyHits(l).length;
// the shared cards are read by every tier, so desk slang is translated for everyone ("show-me tape", "ripping")
// round 6: our own prompt words echoed into a card ("…two weeks old, so it is context, not news") go, and figures
// stay digits in written copy
// round 8: position cards are shared by every reader of a symbol, so they carry no beginner glosses ("a wide the biggest
// companies gap of its price tag against profits" reached advanced readers); signed figures use the true minus sign
// r10: "adds legal risk hanging over it to Meta's AI-driven rally" (a template garble) reads "adds legal risk to …"
const cardScrub = (t: string) => sanitize(tidyNumbers(plainScrub(String(t ?? "").replace(/\s+hanging over it(?= (?:to|on|for)\b)/gi, ""), [...PORTFOLIO_PLAIN, ...CARD_PLAIN])));

/** A second read of a finished card by the fast model, for what patterns cannot see: a bullet that is garbled
 *  (two headlines compressed into nonsense, round 3: "TSLA leads 2,500 electric trucks backed by Microsoft and
 *  PepsiCo") or claims something no headline or number given supports. Dropping beats garbling; a card keeps
 *  at least two bullets, and a failed or slow check changes nothing. */
async function incoherent(key: string, lines: string[], source: string): Promise<Set<number>> {
  if (!key || lines.length < 3) return new Set();
  const res = await askMara(key, FAST_MODEL, `SOURCE (the only facts available):\n${source.slice(0, 6000)}\n\nBULLETS:\n${lines.map((l, i) => `${i}. ${l}`).join("\n")}\n\nReturn STRICT JSON {"bad": [indexes]} listing only the bullets that are ungrammatical or garbled (a subject doing something that makes no sense, two stories merged into one), or that state a fact, number, date or historical comparison the SOURCE does not contain. Return {"bad": []} when all are fine.`, 800, 9000).catch(() => null);
  try {
    const o = JSON.parse(String(res ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").slice(String(res ?? "").indexOf("{")));
    const bad = new Set<number>((Array.isArray(o.bad) ? o.bad : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < lines.length));
    return lines.length - bad.size >= 2 ? bad : new Set();
  } catch { return new Set(); }
}
const VALUE_LAW = `VERDICT LAW: information, never a verdict. Never call the stock cheap, expensive, undervalued, overvalued, a bargain or a buying opportunity (no "undervaluation framing" either, unless a named source says it), never say a drop "sets up well" or offers "downside protection", never call anything "a clear catalyst" or "a catalyst for upside", never "top pick", never tell anyone to buy, sell, hold or add. State the metric (a P/E against its own history, a target and who set it) and what would change the picture. Day moves and prices come ONLY from the data above, with its session label. Returns come ONLY from the windows given, never measured from a high or a low. Never mention missing data, price history or what is "on file": if a window has no figure, leave it out. A deliveries report is not an earnings report; state a deliveries date only if the data gives one. Plain words: no desk slang ("tape", "ripping", "show-me", "bid", "bulls/bears", "book" for portfolio, "names" for stocks). Each bullet is ONE grammatical sentence about ONE story; never merge two headlines into one claim. No historical comparison (a past year, "since 2008", "all-time", "record") unless a headline states it.`;


// ---- reader profile: the 6 sign-up answers steer VOICE, EMPHASIS and PURPOSE, never the facts ----
type Investor = { styles?: string[] | string; purpose?: string[] | string; horizon?: string[] | string; target?: string[] | string; risk?: string[] | string; level?: string[] | string };
// answers may be single strings (old profiles) or arrays (multi-select quiz): normalize, and reduce where one value must win
const toArr = (x: unknown, d: string[]): string[] => Array.isArray(x) ? (x.length ? x.map(String) : d) : (typeof x === "string" && x ? [x] : d);
const LVL_ORDER = ["novice", "intermediate", "advanced", "pro"];
// round 8: an unknown level ("confident" on the showcase profile) reads as intermediate, never as beginner
const topLevel = (xs: string[]): string => readerLevel(xs);
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
// idempotent: a gloss the model already wrote is never doubled ("VIX, the market's fear gauge, the market's ...")
// one shared beginner map (_shared/intel.ts NOVICE_PLAIN), applied in context so a gloss never reads as nonsense
// round 8 newcomer: beginner glosses are parenthetical ("moat (lasting edge over competitors)"), never substitutions
const noviceScrub = (t: string): string => glossParenthetical(t);

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
  const bearerJwt2 = bearerOf(req);
  let onlyUser: string | null = typeof body.user_id === "string" ? body.user_id : null;
  if (onlyUser) {
    const isSvc = (() => { try { return JSON.parse(atob(bearerJwt2.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
    // internal hops (orchestrator, callback) authorize with the shared token: the platform gate rejects the legacy service JWT
    let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
    if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
    const isInternal = !!itok && (req.headers.get("x-internal-token") ?? "") === itok;
    if (!isSvc && !isInternal) {
      if (await userIdFrom(admin, bearerJwt2) !== onlyUser) return json({ ok: false, error: "forbidden target" }, 403);   // never silently widen or no-op
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
  // r11 load: only recent cards (the served one is the newest); the whole card history of every held symbol was read each lap
  const { data: existing } = await admin.from("insights").select("symbol, generated_at, bullets, windows").gte("generated_at", new Date(Date.now() - 21 * 86400000).toISOString())
    .in("symbol", targets).order("generated_at", { ascending: false });
  const age = new Map<string, number>();
  // A served card that fails today's guards (a valuation call, pipeline wording, a return "from the 1Y low",
  // written before a guard existed) is rewritten on the next lap, a few per lap, so no card has to wait for
  // its market's staleness clock (round 3: Samsung "45% undervaluation framing", KO "a clear catalyst").
  const failing = new Set<string>();
  const periodCards = new Map<string, string[]>();
  for (const e of existing ?? []) {
    if (age.has(e.symbol)) continue;
    age.set(e.symbol, +new Date(e.generated_at));
    const lines = [...((e.bullets as string[] | null) ?? []), String((e.windows as { trend?: string } | null)?.trend ?? "")];
    if (lines.some((l) => adviceHits(l).length || cardCopyHits(l).length) || glossedCardHits(lines).length) failing.add(e.symbol);
    else if (lines.some((l) => /\d\s?%/.test(l) && /\b(?:year|YTD|month|week|1Y|2Y)\b/i.test(l))) periodCards.set(e.symbol, lines);
  }
  // served cards stating a period return are checked against the windows, a few per lap (round 5 poweruser:
  // "Up 453% in a year" for SK hynix at +422%, Samsung's 1Y figure labelled "year to date")
  if (!fixture && !only) {
    for (const [sy, lines] of [...periodCards.entries()].slice(0, 6)) {
      const kind = (await admin.from("symbols").select("kind").eq("symbol", sy).maybeSingle()).data?.kind;
      const wr = await windowReturns(admin, sy, [7, 30, 60, YTD, 365, 730], Date.now(), kind === "crypto" ? null : sy.endsWith(".KS") || sy.endsWith(".KQ") ? "KR" : "US");
      if (lines.some((l) => periodReturnMismatches(l, [{ names: [sy, ...aliasesFor(sy)], windows: wr.pct }]).length)) failing.add(sy);
    }
    // round 7 native: a served card claiming a level the price never reached ("BTC surged past $87,000") is rewritten
    const levelCards = [...age.keys()].filter((sy) => !failing.has(sy)).map((sy) => {
      const e = (existing ?? []).find((x) => x.symbol === sy)!;
      return [sy, [...((e.bullets as string[] | null) ?? []), String((e.windows as { trend?: string } | null)?.trend ?? "")]] as const;
    }).filter(([, ls]) => ls.some((l) => /\$\s?\d/.test(l) && /\b(?:past|above|over|through|beyond|below|under|hit|reached|touched|topped)\b/i.test(l))).slice(0, 6);
    for (const [sy, ls] of levelCards) {
      const px = (await admin.from("prices").select("price").eq("symbol", sy).maybeSingle()).data?.price;
      const hl = await hiLo(admin, sy, 30, px === null || px === undefined ? null : Number(px)).catch(() => ({ high: null, low: null }));
      if (ls.some((l) => crossedLevelClaims(l, [{ names: [sy, ...aliasesFor(sy)], pct: null, ...hl }]).length)) failing.add(sy);
    }
  }
  // Round 9 newcomer: cards nobody's lap refreshes (symbols no one holds, seen on the add strip) are not served once
  // they are old, carry a verdict, or carry the old gloss; nor are the cards of a duplicate listing (BRKB for BRK.B).
  // Deleted a few hundred per lap; a held symbol's failing card is regenerated instead (above).
  if (!fixture && !only && !onlyUser && new Date().getUTCMinutes() < 15) {   // r11 load: once an hour
    const cutoff = new Date(Date.now() - CARD_MAX_AGE_DAYS * 86400000).toISOString();
    const heldSet = new Set(held);
    const heldList = `(${held.map((h) => `"${h.replace(/"/g, "")}"`).join(",")})`;
    const { data: strayOld } = await (held.length ? admin.from("insights").select("id, symbol").lt("generated_at", cutoff).not("symbol", "in", heldList) : admin.from("insights").select("id, symbol").lt("generated_at", cutoff)).limit(400);
    const { data: strayNew } = await admin.from("insights").select("id, symbol, bullets, windows").gte("generated_at", cutoff).order("generated_at", { ascending: false }).limit(600);
    const { data: symRows } = await admin.from("symbols").select("symbol, yahoo");
    const dup = new Set(((symRows ?? []) as { symbol: string; yahoo: string | null }[]).filter((r) => canonicalSymbol(r.symbol, r.yahoo) !== r.symbol).map((r) => r.symbol));
    const drop = [
      ...((strayOld ?? []) as { id: number; symbol: string }[]).filter((r) => !heldSet.has(r.symbol)).map((r) => r.id),
      ...((strayNew ?? []) as { id: number; symbol: string; bullets: string[] | null; windows: { trend?: string } | null }[]).filter((r) => {
        if (heldSet.has(r.symbol)) return false;   // a held symbol's card is regenerated, never left missing
        if (dup.has(r.symbol)) return true;
        const ls = [...(r.bullets ?? []), String(r.windows?.trend ?? "")];
        return ls.some((l) => adviceHits(l).length || cardCopyHits(l).length) || glossedCardHits(ls).length > 0;
      }).map((r) => r.id),
    ].slice(0, 300);
    if (drop.length) await admin.from("insights").delete().in("id", drop).then(() => {}, () => {});
  }
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
  const recheck = [...failing].slice(0, 4);
  if (!only && !force) targets = targets.filter((sy) => (staleInsight(age.get(sy) ?? 0, mktOf(sy)) && worthRegen(sy)) || recheck.includes(sy));
  if (force) targets = [];                                    // force = refresh the portfolio layer only
  // Priority: names whose market is OPEN right now first (their tape is moving), then the stalest, then the biggest.
  const openNow = (sy: string) => { const mk = mktOf(sy); return mk ? (marketState(mk).phase === "open" ? 0 : 1) : 1; };
  targets = targets.sort((a, b) =>
    openNow(a) - openNow(b) || (age.get(a) ?? 0) - (age.get(b) ?? 0) || (invested.get(b) ?? 0) - (invested.get(a) ?? 0)).slice(0, 16);

  // Self-healing price history: every lap backfills a few held symbols whose daily history does not reach back
  // 400 days (a symbol added without the backfill, like AMZN in round 2, read a 28-day move as its "1M").
  // Bounded and idempotent; the connect path does its own before it calls here.
  const healed = !fixture && !force && !onlyUser ? await ensureHistory(admin, held, { cap: 6, budgetMs: 20000 }) : null;
  // ...and a catalog name that is only the ticker ("AVGO AVGO" on Home) gets the company's real name
  if (!fixture && !force && !onlyUser) await Promise.race([repairNames(admin, held, 3).catch(() => []), new Promise((res) => setTimeout(res, 6000))]);
  // ...and dividend data for every held symbol, a few per lap (migration 40; answers income questions in Ask)
  if (!fixture && !force && !onlyUser) await Promise.race([refreshDividends(admin, held, 8).catch(() => []), new Promise((res) => setTimeout(res, 8000))]);

  let wrote = 0;
  const errors: string[] = [];
  for (const symbol of targets) {
    try {
      const { data: srow } = await admin.from("symbols").select("name, name_kr").eq("symbol", symbol).single();
      const aka = aliasesFor(symbol, srow?.name, (srow as { name_kr?: string | null } | null)?.name_kr);
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: news7raw } = await admin.from("news").select("title,url,source,summary,published_at")
        .eq("symbol", symbol).gte("published_at", since7)
        .order("published_at", { ascending: false }).limit(60);
      // quote pages, option chains, single-user posts and stories not about this holding are not its news (an
      // AVGO card read a Moomoo user's 32-share trade as "confirms support"); judged at READ time too, because
      // rows stored before the ingest gate are still in the table
      const news7 = (news7raw ?? []).filter((n) => usableNews(n, aka)).slice(0, 25);
      const { count: n30 } = await admin.from("news").select("id", { count: "exact", head: true })
        .eq("symbol", symbol).gte("published_at", since30);
      // windows read point by point (the latest price, and the price at each window's start): the old
      // ascending 2,000-row pull was capped at 1,000 rows and never reached today; a window the history does
      // not cover says so instead of reusing a shorter one
      const wr = await windowReturns(admin, symbol, WINDOWS.map(([, d]) => d), Date.now(), mktOf(symbol));
      const perf = Object.fromEntries(WINDOWS.map(([k, d]) => [k, pctText(wr.pct[d] ?? null)]));
      const { data: quote } = await admin.from("prices").select("price,change_pct,currency,as_of").eq("symbol", symbol).maybeSingle();
      // the live quote, unless the history holds a newer tick (a quote row the minute job stopped updating
      // must not put Bitcoin "near $78K" when it trades at $83.7K)
      const quoteFresh = quote?.price !== null && quote?.price !== undefined && (!wr.last || +new Date(String(quote.as_of ?? 0)) >= +new Date(wr.last.ts) - 5 * 60000);
      const price = quoteFresh ? Number(quote!.price) : wr.last?.price ?? (quote?.price ?? null);
      const cur = String(quote?.currency ?? "USD");
      const { data: fils } = await admin.from("filings").select("form,title,filed_at")
        .eq("symbol", symbol).order("filed_at", { ascending: false }).limit(10);
      // the forms that date a report, 13 months deep (the newest 20 of any form lost the year-ago quarter)
      const filItems = await earningsFilings(admin, [symbol]);
      const { data: tr } = await admin.from("transcripts").select("title,content,published_at")
        .eq("symbol", symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(4);
      // a conference talk is not an earnings call (Nvidia's Sep 10 Goldman Sachs appearance was read as its latest call)
      const calls = (tr ?? []).filter((t) => isEarningsCallTitle(t.title));
      const talks = (tr ?? []).filter((t) => !isEarningsCallTitle(t.title));
      const latestTr = calls[0];
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const earn = earningsLine(srow?.name ?? symbol, (filItems ?? fils ?? []) as { form: string; filed_at: string; items?: string | null }[], tr ?? [], today);
      const korean = symbol.endsWith(".KS") || symbol.endsWith(".KQ") || cur === "KRW";
      const dlv = deliveriesEstimate(symbol, today);
      const dlvFacts = [{ names: [symbol, ...aka], est: dlv?.est ?? null }];

      let content: string | null;
      let sourceText = "";
      if (fixture) {
        content = JSON.stringify(body.canned ?? { bullets: ["fixture bullet one", "fixture bullet two", "fixture bullet three"], windows: { d7: "flat week", d30: "quiet month", d60: "range-bound", y1: "recovering", y2: "volatile" } });
      } else {
        const mkt = mktOf(symbol);
        const px = price === null ? "n/a" : cur === "KRW" ? `\u20a9${Math.round(Number(price)).toLocaleString("en-US")}` : `${cur === "USD" ? "$" : cur + " "}${Number(price).toFixed(2)}`;
        const chg = quote?.change_pct === null || quote?.change_pct === undefined ? "n/a" : (Number(quote.change_pct) >= 0 ? "+" : "") + Number(quote.change_pct).toFixed(1) + "%";
        const prompt = `TODAY is ${today}.
Company: ${srow?.name ?? symbol} (${symbol}). Share price (ONE share) ${px}${quote?.as_of ? ` as of ${String(quote.as_of).slice(0, 16).replace("T", " ")} UTC` : ""}; day change ${chg} [${dayTag(marketOf(symbol, kindOf.get(symbol), cur))}].
Price change by window (d7 = 1 week, d30 = 1 month, d60 = 2 months, ytd = year to date (since the prior year's last close; never call a 1-year figure "this year"), y1 = 1 year, y2 = 2 years; "not enough price history yet" means there is no figure for that window, so never state one): ${JSON.stringify(perf)}.
Session: ${mkt ? sessNote(mkt) : "Crypto trades 24/7; day changes are rolling."}
Earnings: ${earn ? earn.replace(/^[^:]+:\s*/, "") : "no earnings date known; never guess one"}.${dlv ? `\nDeliveries: the ${dlv.quarter} deliveries report is expected ~${dlv.est.slice(5).replace("-", "/")} (est), about the 2nd day after the quarter ends; it is NOT the earnings report.` : ""}
Headlines from the last 7 days (${n30 ?? 0} stories in 30d):
${news7.map((n) => `- [${n.source}] ${n.title}`).join("\n") || "- (no fresh headlines)"}
${(fils ?? []).length ? `\nSEC filings (last 9 months): ${(fils ?? []).map((f) => `${f.form} ${f.filed_at}`).join(", ")}` : ""}${latestTr ? `\nLatest earnings call ("${latestTr.title}", ${latestTr.published_at}):\n${String(latestTr.content).slice(0, 7000)}\n${callAgeNote(latestTr.published_at)}\n${calls.slice(1).length ? "Older calls on file: " + calls.slice(1).map((t) => t.title).join(" | ") : ""}` : "\n(no earnings transcript on file yet)"}${talks.length ? `\nConference talks on file (NOT earnings reports; never call them results): ${talks.map((t) => `${t.title} (${String(t.published_at).slice(0, 10)})`).join(" | ")}` : ""}
${EVIDENCE_LAW}
${VALUE_LAW}

Return STRICT JSON: {"bullets": [3-4 strings], "trend": str}.
bullets: the sharpest takes on what matters RIGHT NOW, synthesizing news, the earnings call, and price action. Respect the call's age above: a call older than a week is context for a take, never the news itself. DAY-CHANGE LAW: a day figure is today's tape only while the market is open or closed under 3 hours; otherwise it is past tense with the session named, and on a day the market is closed the takes are about the week and the news, never a move. Each 10-15 words MAX. Interpret, never restate headlines. Refer to the company by NAME, never numeric KRX codes.${korean ? " Write won amounts with the \u20a9 sign." : " Money is US dollars; never write won."} Plain punchy language. Never use em dashes or semicolons.
trend: ONE sentence, max 20 words, covering the recent move and the longer-term picture together.`;
        sourceText = prompt;
        content = await askMaraFb(key, model, prompt);
        // one corrective rewrite when a line contradicts the live numbers or passes a verdict
        const first = content ? parseInsight(content) : null;
        // round 7 native: a level "surged past $87,000" is held to the highest price of the month
        const hl = await hiLo(admin, symbol, 30, price === null ? null : Number(price)).catch(() => ({ high: null, low: null }));
        const facts: LiveFact[] = [{ names: [symbol, ...aka], pct: quote?.change_pct === null || quote?.change_pct === undefined ? null : Number(quote.change_pct), price: price === null ? null : Number(price), ...hl }];
        const found = first ? takeProblems([...first.bullets, String(first.windows?.trend ?? "")].map(cardScrub), facts, dlvFacts) : [];
        if (found.length) {
          const redo = await askMaraFb(key, model, `${prompt}\n\nYOUR DRAFT:\n${content}\nIt broke these rules:\n- ${found.slice(0, 6).join("\n- ")}\nReturn the corrected JSON in the same shape; keep everything that was right.`).catch(() => null);
          const second = redo ? parseInsight(redo) : null;
          if (second && takeProblems([...second.bullets, String(second.windows?.trend ?? "")].map(cardScrub), facts, dlvFacts).length < found.length) content = redo;
        }
      }
      const parsed = content ? parseInsight(content) : null;
      if (!parsed) { errors.push(symbol + ": unparseable raw[" + String(content).slice(0, 260).replace(/\n/g, " ") + "]"); continue; }
      const trAge = callAgeDays(latestTr?.published_at);
      // whatever still contradicts the numbers (or passes a verdict) is dropped, never stored
      const hl2 = await hiLo(admin, symbol, 30, price === null ? null : Number(price)).catch(() => ({ high: null, low: null }));
      const liveFacts: LiveFact[] = [{ names: [symbol, ...aka], pct: quote?.change_pct === null || quote?.change_pct === undefined ? null : Number(quote.change_pct), price: price === null ? null : Number(price), ...hl2 }];
      // no historical comparison the data does not hold ("Tech concentration at 1965 highs", round 3)
      let bullets = parsed.bullets.map((b) => fixArticles(cardScrub(deJust(b, trAge))))
        .filter((b) => !!b.trim() && lineOk(b, liveFacts, dlvFacts) && !(sourceText && (historicalClaims(b, sourceText, today).length || unsupportedCauses(b, sourceText).length))
          // "Up 453% in a year" when the trailing year is +422% (the run from the 12-month low), round 4
          && !periodReturnMismatches(b, [{ names: [symbol, ...aka], windows: wr.pct }]).length);
      if (!fixture) { const bad = await incoherent(key, bullets, sourceText); bullets = bullets.filter((_, i) => !bad.has(i)); }
      // r11 P4: a card is the source Ask echoes ("Q3 deliveries ~Oct 2, one week before earnings" at ~Oct 21): its date gaps,
      // product generations and cause directions are checked before it is stored
      {
        const est = earningsEstimate((filItems ?? fils ?? []) as { form: string; filed_at: string; items?: string | null }[], (tr ?? []) as { title: string; published_at: string | null }[], today);
        const gapFacts = [{ names: [symbol, ...aka], dates: { earnings: est ? (est.range ? est.range[0] : est.est) : null, deliveries: deliveriesEstimate(symbol, today)?.est ?? null, exdate: null } }];
        // r11 P9: card verdicts ("not a reversal signal", "the bull thesis has visible cracks", "over-extended, raising
        // write-off risk", "valuation stretch to $7T") and a day move stated twice on one card
        const badG = new Set([...relativeGapClaims(bullets.join(" "), gapFacts), ...productVersionClaims(bullets.join(" "), sourceText), ...directionCauseClaims(bullets.join(" ")), ...softVerdicts(bullets.join(" "))]);
        if (badG.size) bullets = bullets.map((b) => splitSentences(b).filter((x) => !badG.has(x)).join(" ")).filter((b) => b.trim());
        bullets = duplicateMoveBullets(bullets);
      }
      // r10: card bullets in the app's own voice ("UPI dominance caps near-term growth", "a structural risk to AMZN") go
      // through the same compliance judge as Ask; a card the judge cannot read keeps the regex result
      // r10 load: bullets the served card already carries were judged when it was written; only new text is judged
      const prevLines = new Set((((existing ?? []).find((e) => e.symbol === symbol)?.bullets as string[] | null) ?? []).map((x) => x.trim()));
      const fresh = bullets.map((b, i) => ({ b, i })).filter((x) => !prevLines.has(x.b.trim()));
      if (!fixture && fresh.length) { const j = await callJudge(key, fresh.map((x) => x.b), 6000); if (j.flags?.size) { const drop = new Set([...j.flags].map((k) => fresh[k].i)); bullets = bullets.filter((_, i) => !drop.has(i)); } }
      if (bullets.length < 2) { errors.push(symbol + ": take contradicted the live numbers; kept the previous one"); continue; }
      const trend = parsed.windows?.trend ? (fixArticles(cardScrub(String(parsed.windows.trend))) || null) : null;
      // the summary line may not restate a bullet (round 4: "Off 7.6% over two months despite 5% one-year gain"
      // under "Two-month 7.6% slide contrasts with 5% one-year gain" on every card)
      const echoes = trend !== null && bullets.some((b) => overlap(b, trend) >= 0.6);
      const windows = trend === null ? (parsed.windows?.trend ? { ...parsed.windows, trend: "" } : parsed.windows) : lineOk(trend, liveFacts, dlvFacts) && !echoes && !periodReturnMismatches(trend, [{ names: [symbol, ...aka], windows: wr.pct }]).length ? { ...parsed.windows, trend } : {};
      const { error: upErr } = await admin.from("insights").insert({
        symbol, bullets, windows, model,
      });
      if (upErr) errors.push(symbol + ": " + upErr.message); else wrote++;
    } catch (e) { errors.push(symbol + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  // ---- portfolio-level insights: per user, their actual mix ----
  let pWrote = 0;
  // one user's refresh reads one user's rows (the connect path used to pull every portfolio in the project)
  const pfQ = admin.from("portfolio").select("user_id, symbol, kind, account, currency, qty, price, value, change_pct, nickname, name");
  const { data: pf } = onlyUser ? await pfQ.eq("user_id", onlyUser) : await pfQ;
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
      // share price and position value are separate, labelled fields: "NVDA $112 = 2.9% of assets" was read as
      // "NVDA sits near $112" (the 0.5-share position; the stock traded at $224) in a new user's first insight
      const pxOf = (r: (typeof rows)[number]) => r.price === null || r.price === undefined ? null : Number(r.price) / (fxMap.get(String(r.currency)) ?? 1);
      const desc = assets.sort((a, b) => usd(b) - usd(a)).slice(0, 15).map((r) => {
        const acct = r.account !== "brokerage" ? ", " + r.account : "";
        if (r.symbol.startsWith("$") || r.kind === "cash") return `${nOf(r.symbol)} (cash${acct}): balance $${Math.round(usd(r))} = ${(usd(r) / total * 100).toFixed(1)}% of assets`;
        const px = pxOf(r);
        return `${nOf(r.symbol)} (${r.kind}${acct}): ${Number(r.qty ?? 0)} shares at a share price of ${px === null ? "n/a" : "$" + (px >= 1000 ? Math.round(px).toLocaleString("en-US") : px.toFixed(2))} = position value $${Math.round(usd(r))} (${(usd(r) / total * 100).toFixed(1)}% of assets); day ${r.change_pct === null ? "n/a" : (Number(r.change_pct) >= 0 ? "+" : "") + Number(r.change_pct).toFixed(1) + "%"} [${dayTag(marketOf(r.symbol, r.kind, r.currency))}]`;
      }).join("\n");
      const posFacts: PosFact[] = assets.filter((r) => !r.symbol.startsWith("$")).map((r) => ({ names: [nOf(r.symbol), ...aliasesFor(r.symbol, r.name)], price: pxOf(r), value: usd(r) }));
      const bookNames = assets.filter((r) => !r.symbol.startsWith("$") && r.kind !== "cash" && r.kind !== "debt")
        .map((r) => ({ symbol: r.symbol, names: [nOf(r.symbol), ...aliasesFor(r.symbol, r.name)] }));
      const liveFacts: LiveFact[] = await Promise.all(assets.filter((r) => !r.symbol.startsWith("$") && r.kind !== "cash" && r.kind !== "debt").slice(0, 20)
        .map(async (r) => ({ names: [nOf(r.symbol), ...aliasesFor(r.symbol, r.name)], pct: r.change_pct === null ? null : Number(r.change_pct), price: pxOf(r),
          ...(await hiLo(admin, r.symbol, 30, pxOf(r)).catch(() => ({ high: null, low: null }))) })));
      const korean = booksKorean(rows);
      const { data: invRow } = await admin.from("profiles").select("investor").eq("id", uid).maybeSingle();
      const READER = readerBlock(invRow?.investor as Investor | null);
      const { data: symIns } = await admin.from("insights").select("symbol, bullets, generated_at")
        .in("symbol", assets.map((r) => r.symbol)).order("generated_at", { ascending: false }).limit(30);
      const latestBySym = new Map<string, string>();
      for (const i of symIns ?? []) if (!latestBySym.has(i.symbol)) latestBySym.set(i.symbol, (i.bullets as string[])[0] ?? "");
      // signals beyond price: latest earnings calls (dated) + fresh headlines per holding
      const sigSyms = assets.map((r) => r.symbol).filter((sy) => !sy.startsWith("$")).slice(0, 12);
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ data: trsAll }, { data: nws }, { data: fls }] = await Promise.all([
        admin.from("transcripts").select("symbol,title,published_at").in("symbol", sigSyms).order("published_at", { ascending: false, nullsFirst: false }).limit(30),
        admin.from("news").select("symbol,title,url,source,summary,published_at").in("symbol", sigSyms).gte("published_at", since7).order("published_at", { ascending: false }).limit(160),
        earningsFilings(admin, sigSyms).then((data) => ({ data })),
      ]);
      // earnings CALLS only: a conference appearance is not a report (and never "just reported")
      const trs = (trsAll ?? []).filter((x) => isEarningsCallTitle(x.title));
      const callLines = sigSyms.map((sy) => { const t = trs.find((x) => x.symbol === sy); return t ? `- ${nOf(sy)}: ${String(t.title).slice(0, 80)} (call date ${String(t.published_at).slice(0, 10)}, ${callAgeDays(t.published_at) ?? "?"} days ago${(callAgeDays(t.published_at) ?? 0) > CALL_FRESH_DAYS ? ", background, not news" : ", fresh"})` : null; }).filter(Boolean).join("\n");
      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const earnLines = sigSyms.map((sy) => earningsLine(nOf(sy), ((fls ?? []) as { symbol: string; form: string; filed_at: string; items?: string | null }[]).filter((f) => f.symbol === sy), (trsAll ?? []).filter((t) => t.symbol === sy), todayEt)).filter(Boolean).map((x) => "- " + x).join("\n");
      const akaOf = new Map(bookNames.map((b) => [b.symbol, b.names]));
      const newsLines = sigSyms.map((sy) => (nws ?? []).filter((x) => x.symbol === sy && usableNews(x, akaOf.get(sy) ?? aliasesFor(sy)) && !staleNewsTitle(String(x.title), x.published_at, todayEt)).slice(0, 2).map((x) => `- ${nOf(sy)} [${x.source}]: ${String(x.title).slice(0, 90)}`).join("\n")).filter(Boolean).join("\n");
      let content: string | null;
      let prompt = "";
      if (fixture) {
        content = JSON.stringify(body.cannedPortfolio ?? { bullets: ["portfolio fixture one", "portfolio fixture two", "portfolio fixture three"], news5: ["fixture signal one", "fixture signal two", "fixture signal three", "fixture signal four", "fixture signal five"] });
      } else {
        prompt = `TODAY is ${todayEt}.
A retail investor's portfolio (total assets $${Math.round(total)}, debt $${Math.round(debt)}). Every holding lists its SHARE PRICE (one share) and its POSITION VALUE (the whole holding) separately: a sentence about where a stock trades uses the share price, never the position value. Each day figure is tagged with its session.
SESSIONS (deterministic; obey over any instinct):\n${userMkts.map((mk) => sessNote(mk)).join("\n")}
${desc}
Earnings dates (computed from SEC filings; the ONLY earnings dates you may state, estimates spoken as "expected around ..."):
${earnLines || "- (none on file)"}
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
Respect the session notes: never present the last session's move as happening today. Refer to Korean companies by NAME, never numeric KRX codes like 005930.KS.${korean ? " Write won amounts with the \u20a9 sign." : " Money is US dollars; never write won."} Plain punchy language. Never use em dashes or semicolons. No generic advice, and never a buy or sell instruction.
${EVIDENCE_LAW}
${VALUE_LAW}`;
        content = await askMaraFb(key, model, prompt, 14000, force && onlyUser ? 35000 : 75000);
      }
      let parsed = content ? parseInsight(content) : null;
      if (!parsed && !fixture) {   // a valid-JSON-but-wrong-shape reply still deserves one clean retry on the fast model
        const retry = await askMaraFb(key, FAST_MODEL, prompt, 14000).catch(() => null);
        parsed = retry ? parseInsight(retry) : null;
      }
      if (!parsed) { errors.push("user " + uid.slice(0, 8) + ": unparseable"); continue; }
      const freshestCall = Math.min(...sigSyms.map((sy) => callAgeDays(trs.find((x) => x.symbol === sy)?.published_at) ?? Infinity));
      const pAge = Number.isFinite(freshestCall) ? freshestCall : null;
      // round 7 newcomer: beginner glosses for BEGINNERS only ("Bitcoin down 0.3% as ETF new money turn positive" reached an
      // Intermediate reader)
      const isNovice = topLevel(toArr((invRow?.investor as Investor | null | undefined)?.level, ["novice"])) === "novice";
      // a position value quoted as a share price is corrected from the same data block the model was given
      // a holding's weight is its own ("30.1% Bitcoin weight" was Bitcoin + Ether, round 5)
      const weightFacts = assets.filter((r) => !r.symbol.startsWith("$")).map((r) => ({ names: [nOf(r.symbol), ...aliasesFor(r.symbol, r.name)], weight: usd(r) / total * 100 }));
      const cryptoShare = assets.filter((r) => r.kind === "crypto").reduce((a, r) => a + usd(r), 0) / total * 100;
      const scrubB = (xs: string[] | null | undefined) => (xs ?? []).map((x) => fixWeights(fixArticles(plainScrub(fixPriceConfusions(deJust(isNovice ? noviceScrub(x) : x, pAge), posFacts), PORTFOLIO_PLAIN)), weightFacts, [{ label: /\bcrypto\b/i, value: cryptoShare }])).map((x) => fixFractions(x, weightFacts, [{ label: /\bcrypto\b/i, value: cryptoShare }]));
      // The book may have changed while the model wrote (round 2: PEP and F were removed at 12:18 and a card
      // stamped 12:20 still led with "Pepsi near yearly lows"): a line about a symbol that has left the book is
      // dropped, and so is a line that contradicts the live numbers or passes a verdict.
      const { data: nowRows } = await admin.from("portfolio").select("symbol").eq("user_id", uid);
      const heldNow = new Set((nowRows ?? []).map((r) => String(r.symbol)));
      const gone = new Set(bookNames.map((b) => b.symbol).filter((sy) => !heldNow.has(sy)));
      // Round 5: "VOO: $10,450 tax on reinvested dividends, no cash paid out" was an article's hypothetical $1M
      // stake stated as the reader's own figure, and false (VOO pays cash quarterly). A dollar figure of $1,000+
      // that is not one of the reader's own numbers must say where it comes from, and a payer never "pays no cash".
      const divRowsP = await dividendRows(admin, bookNames.map((b) => b.symbol));
      const payers = bookNames.filter((b) => Number(divRowsP.get(b.symbol)?.div_ttm ?? 0) > 0);
      const ownDollars = [total, debt, ...assets.map((r) => usd(r)), ...assets.map((r) => {
        const d = divRowsP.get(r.symbol); return d?.div_ttm ? Number(d.div_ttm) * Number(r.qty ?? 0) : 0;
      })].filter((v) => v > 0);
      // round 7 newcomer: "Samsung stock has run 339% this year" (the headline gave no period; YTD is +138%) and "SCHD up
      // 0.3% this week" (the week is -1.4%; +0.3% was today): a period claim about a holding is checked against its window
      const heldSyms = assets.filter((r) => !r.symbol.startsWith("$") && r.kind !== "cash").map((r) => r.symbol).slice(0, 15);
      const winOf = new Map(await Promise.all(heldSyms.map(async (sy) => {
        const r = assets.find((a) => a.symbol === sy)!;
        const w = await windowReturns(admin, sy, [7, 30, 365, YTD], Date.now(), r.kind === "crypto" ? null : sy.endsWith(".KS") || sy.endsWith(".KQ") ? "KR" : "US").catch(() => null);
        return [sy, w?.pct ?? {}] as const;
      })));
      const periodFacts = heldSyms.map((sy) => ({ names: [nOf(sy), ...aliasesFor(sy, assets.find((a) => a.symbol === sy)?.name)], windows: winOf.get(sy) ?? {} }));
      const keep = (x: string) => lineOk(x, liveFacts) && !mentionedSymbols(x, bookNames).some((sy) => gone.has(sy)) && !(prompt && historicalClaims(x, prompt, todayEt).length)
        && !unattributedDollars(x, ownDollars).length && !dividendContradictions(x, payers).length && !(prompt && unsupportedCauses(x, prompt).length)
        && !periodReturnMismatches(x, periodFacts).length && !promoCharacterisations(x).length;
      let bullets = scrubB(parsed.bullets).filter(keep).slice(0, 3);
      let news5 = parsed.news5 ? scrubB(parsed.news5).filter(keep) : parsed.news5;
      if (!fixture) {
        const bad = await incoherent(key, bullets, prompt);
        bullets = bullets.filter((_, i) => !bad.has(i));
        if (news5) { const badN = await incoherent(key, news5, prompt); news5 = news5.filter((_, i) => !badN.has(i)); }
      }
      if (bullets.length < 2) { errors.push("user " + uid.slice(0, 8) + ": take contradicted the live book; kept the previous one"); continue; }
      const heldBook = bookNames.map((b) => b.symbol).filter((sy) => !gone.has(sy));
      bullets = bullets.map((b) => sanitize(b)).filter(Boolean);
      if (!fixture && bullets.length) {
        const j = await callJudge(key, bullets, 6000);
        if (j.flags?.size) {
          bullets = bullets.filter((_, i) => !j.flags!.has(i));
          if (bullets.length < 2) { errors.push("user " + uid.slice(0, 8) + ": the judge removed the take; kept the previous one"); continue; }
        }
      }
      // round 8 newcomer: a News line reversed its source ("NVDA CEO warns AI slowdown risk despite hype" for "Nvidia CEO
      // Pushes Back On The 'AI Apocalypse'"): each line is replaced by the matching source headline, verbatim and cleaned
      let news5Items: { text: string; source: string | null }[] | null = null;
      if (news5) {
        const heads = (nws ?? []).filter((x) => !staleNewsTitle(String(x.title), x.published_at, todayEt) && usableNews(x, akaOf.get(x.symbol) ?? aliasesFor(x.symbol)))
          .map((x) => ({ symbol: String(x.symbol), names: akaOf.get(x.symbol) ?? aliasesFor(x.symbol), title: String(x.title), source: x.source ? String(x.source) : null }));
        // round 9 designer: headlines are attributed quotes ("Yahoo Finance: ..."), filtered for buy framing, listicles,
        // forecasts and filings, matched on most of the line's words, and held to the live day move
        const dayMoves = Object.fromEntries(assets.filter((r) => r.change_pct !== null).map((r) => [r.symbol, Number(r.change_pct)]));
        const seen = new Set<string>();
        // round 9 (client 562eecd): each line is {text, source}; the client shows the source as the attribution
        news5Items = news5.map((l) => anchorNewsItem(l, heads, 96, dayMoves)).filter((l): l is { text: string; source: string | null } => !!l && !seen.has(l.text) && (seen.add(l.text), true))
          .map((l) => ({ ...l, text: sanitize(l.text) })).filter((l) => !!l.text);
        news5 = news5Items.map((l) => l.text);
      }
      // the symbol tags follow the FINAL lines (anchoring drops and replaces lines; tags taken before it went out of step)
      const tagged = { bullet_symbols: bullets.map((b) => mentionedSymbols(b, bookNames)), news5_symbols: news5 ? news5.map((b) => mentionedSymbols(b, bookNames)) : null, held_symbols: heldBook };
      const row = { user_id: uid, bullets, news5: news5Items ?? news5, model };
      // the symbol tags arrive with migration 38; before it the row is written without them
      let { error: piErr } = await admin.from("portfolio_insights").insert({ ...row, ...tagged });
      if (piErr && /bullet_symbols|news5_symbols|held_symbols|column/i.test(piErr.message)) ({ error: piErr } = await admin.from("portfolio_insights").insert(row));
      if (piErr) errors.push("user " + uid.slice(0, 8) + ": " + piErr.message); else pWrote++;
    } catch (e) { errors.push("user: " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, portfolios: userIds.length, portfolioWrote: pWrote, ...(healed && healed !== "timeout" && Object.keys(healed).length ? { backfilled: healed } : {}), errors: errors.slice(0, 5) });
});
