// Assetly ASK — direct, analytical answers about YOUR portfolio, grounded in the DB.
// Deterministic stats are computed server-side and handed to the model, so numbers
// are never hallucinated. MARA Cloud MiniMax M3.
//
// Two rules sit above everything else here (audit 2026-09-25):
//  1. INFORMATION, NEVER A TRADE INSTRUCTION. Ask explains drivers, risks, scenarios and what a buy or sell
//     case would rest on; it never says buy / sell / hold / add / trim / swap for the user's own book and
//     never sizes a position. Enforced in the prompt AND after generation (regenerate once, then delete the
//     offending sentence), the way the daily brief's verifier does it. Follow-up chips ask why / what / how.
//  2. EVERY NUMBER CARRIES ITS LABEL. Share price vs position value, the session a day move belongs to,
//     the currency, and "not enough price history yet" instead of a window that silently reused a shorter one.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { dayTag, marketOf, marketState, weekdayOf } from "../_shared/calendar.ts";
import { dividendLine, dividendRows, ensureHistory, refreshDividends, windowReturns } from "../_shared/history.ts";
import { bearerOf, userIdFrom } from "../_shared/auth.ts";
import { earningsFilings } from "../_shared/filings.ts";
import {
  adviceHits, aliasesFor, booksKorean, chipInLanguage, cleanFollowups, earningsLine, EVIDENCE_LAW, fixArticles, fixPriceConfusions, isEarningsCallTitle, questionIsKorean,
  isTradeQuestion, NO_HISTORY, pctText, priceConfusions, stripAdvice, usableNews, withNoCallLine, wrongLanguage, type PosFact,
  curatedListHits, deliveriesEstimate, isPickQuestion, normalizeBullets, plainScrub, PORTFOLIO_PLAIN, wrongDeliveriesDates,
  dayMoveMismatches, earningsEstimate, type LiveFact, plainDataWords, tidyNumbers, unsupportedCauses, wrongDividendAmounts, wrongEarningsMonths,
  buildHusk, dayMoveDump, labelClosedMoves, wrongDividendTiming, circularCauses, fixFractions,
  perLine, splitSentences, periodReturnMismatches, spanOfMonth, spanOfMonthKo, holdingRankClaims, superlativeClaims, costBasisClaims, targetBandClaims, misattributedCauses, fixGroupShares, unicodeMinus, themeOf, holdingRankPremise, YTD, labelEstimatedDates, paymentLagClaims, promoCharacterisations, targetPaceClaims, isRankQuestion, isSellQuestion, koNamesFor, suggestionHits, digitsForWritten, diversifiedClaims, dropInstructionEcho,
  readerLevel,
} from "../_shared/intel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

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

/** Keep the phone-read guarantee even when the model overruns: cut at line boundaries down to the
 *  budget (the whole first line survives regardless). */
function trimAnswer(a: string, cap = 100): string {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  if (words(a) <= cap) return a;
  const lines = a.split("\n");
  const out: string[] = [];
  let n = 0;
  for (const ln of lines) {
    const w = words(ln);
    if (out.length && n + w > cap - 5) {
      // round 7: an opener line followed by ONE long paragraph shipped as the opener alone. The next line is cut
      // at its last whole sentence inside the budget instead of being dropped whole
      if (out.length === 1) {
        let part = "";
        for (const sen of ln.split(/(?<=[.!?])[ \t]+/)) { if (words(part + " " + sen) > cap - 5 - n) break; part = (part + " " + sen).trim(); }
        if (part) out.push(part);
      }
      break;
    }
    out.push(ln); n += w;
  }
  let joined = out.join("\n");
  if (words(joined) > cap) joined = joined.split(/\s+/).slice(0, cap - 5).join(" ") + " …";
  return joined;
}

/** A long, multi-part question (concentration AND tax AND a plan) earns a longer answer than a quick one. */
const isComplex = (q: string) => q.split(/\s+/).filter(Boolean).length > 28 || (q.match(/\?/g) ?? []).length >= 2
  || (q.match(/\b(and|also|plus|as well as)\b/gi) ?? []).length >= 3;

type Turn = { q: string; a: string };
/** The last three turns from the client (question + short answer). Old 1.0 clients send none. */
function historyOf(body: Record<string, unknown>): Turn[] {
  const raw = Array.isArray(body.history) ? body.history : [];
  const clean = (x: unknown, n: number) => String(x ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
  return raw.slice(-3).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return { q: clean(o.q ?? o.question, 300), a: clean(o.a ?? o.answer, 700) };
  }).filter((t) => t.q);
}

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
    trader: "catalysts, momentum and the levels that matter first",
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
- Lens: ${st || styleG.value}. Apply the lens to the answer: the first judgment comes through it, even when the book does not match the lens.
- ${pp || purpG.watch}
- ${hz}; target return ${v.target.join(" or ")}/yr; ${rk || riskG.hold}.`;
}

const money = (v: number, cur = "USD"): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (cur === "KRW") return `${s}₩${Math.round(a).toLocaleString("en-US")}`;
  const body = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return cur === "USD" ? `${s}$${body}` : `${s}${body} ${cur}`;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const signedUsd = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

// Round 8: three single asks took ~54s. The budget clock started after sign-in and the book reads, and the per-holding
// window reads (20 holdings x 5 windows, doubled by 1Y/YTD) had no cap under load. Every pre-model read is now capped
// and the clock starts with the request.
const capped = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const tReq = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const uid = await userIdFrom(admin, bearerOf(req));
  if (!uid) return json({ ok: false, error: "sign in required" }, 401);

  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const question = String(body.question ?? "").slice(0, 500).trim();
  if (!question) return json({ ok: false, error: "ask something" }, 400);
  const turns = historyOf(body);
  const t0 = tReq;

  // ---- deterministic portfolio math (the model never invents numbers) ----
  const [{ data: rows }, { data: prof }, { data: fxRows }] = await Promise.all([
    admin.from("portfolio").select("symbol,nickname,name,kind,account,currency,qty,price,value,change_pct,avg_cost,total_gl,as_of").eq("user_id", uid),
    admin.from("profiles").select("investor,base_currency,display_kr").eq("id", uid).maybeSingle(),
    admin.from("prices").select("symbol,price").like("symbol", "USD___"),
  ]);
  const READER = readerBlock(prof?.investor as Investor | null);
  const fxMap = new Map<string, number>([["USD", 1], ["KRW", 1380]]);
  for (const r of fxRows ?? []) { const v = Number(r.price); if (v > 0) fxMap.set(String(r.symbol).slice(3), v); }
  const usd = (v: number, c: string) => v / (fxMap.get(c) ?? 1);
  const book = rows ?? [];
  const korean = booksKorean(book, prof);
  const nameOf = (r: { symbol: string; nickname?: string | null; name?: string | null }) =>
    r.nickname || ((r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ")) && r.name ? r.name : r.symbol);
  const held = book.filter((r) => !r.symbol.startsWith("$") && r.kind !== "cash" && r.kind !== "debt");
  const assetsUsd = book.filter((r) => r.kind !== "debt").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
  const weight = (v: number) => { const w = v / (assetsUsd || 1) * 100; return w > 0 && w < 0.05 ? "under 0.1%" : `${w.toFixed(1)}%`; };
  // round 7 newcomer: "1-year return isn't loaded" for long-listed names; 1Y and YTD are windows too
  const windows = [7, 30, 90, 365, YTD];
  const winLabel = (d: number) => d === 7 ? "1W" : d === 30 ? "1M" : d === 90 ? "3M" : d === 365 ? "1Y" : "YTD";
  // each window is judged in the holding's own sessions (a Korean share by KRX closes, crypto by the day)
  // the per-holding reads run together (round 5 latency: they ran one after another before the model call)
  const heldSyms = held.map((r) => r.symbol);
  const [perfArr, quotesR, shareR, divRows] = await Promise.all([
    Promise.all(held.slice(0, 20).map(async (r) => [r.symbol, await capped(windowReturns(admin, r.symbol, windows, Date.now(), marketOf(r.symbol, r.kind, r.currency)), 6000, { last: null, pct: {} as Record<number, number | null> })] as const)),
    held.length ? admin.from("prices").select("symbol,prev_close").in("symbol", heldSyms).then((r) => r, () => ({ data: [] })) : Promise.resolve({ data: [] }),
    held.length ? admin.from("symbols").select("symbol,shares_outstanding,shares_as_of").in("symbol", heldSyms).then((r) => r, () => ({ data: [] })) : Promise.resolve({ data: [] }),
    dividendRows(admin, heldSyms),
  ]);
  const perf = new Map(perfArr);
  // a held symbol whose history is too short to answer these windows is backfilled after the answer ships,
  // so the next question has them (bounded; the insights lap covers the rest)
  const shortSyms = held.filter((r) => windows.some((d) => (perf.get(r.symbol)?.pct[d] ?? null) === null)).map((r) => r.symbol);
  if (shortSyms.length) {
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(ensureHistory(admin, shortSyms, { cap: 3, budgetMs: 60000 })); } catch { /* the insights lap heals it */ }
  }
  // the previous session's close, so "what did X close at?" has its own labelled number
  const quotes = (quotesR as { data: { symbol: string; prev_close: number | null }[] | null }).data;
  const prevClose = new Map((quotes ?? []).map((q) => [String(q.symbol), q.prev_close === null ? null : Number(q.prev_close)]));
  // Company size, so a premise like "TSLA is cheaper per share than AVGO, so it's the better deal" can be checked
  // and a model never infers company value from a share price (round 3 invented "TSLA has more shares, so its
  // company value is larger": both halves false). Shares outstanding come from SEC filings (filings-sync).
  const shareRows = (shareR as { data: unknown[] | null }).data;
  const sharesOut = new Map(((shareRows ?? []) as { symbol: string; shares_outstanding: number | null; shares_as_of: string | null }[])
    .filter((x) => Number(x.shares_outstanding) > 0).map((x) => [x.symbol, { n: Number(x.shares_outstanding), asOf: x.shares_as_of }]));
  const bigMoney = (v: number) => v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`;
  const bigCount = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`;
  // DIVIDENDS, keyed by symbol (round 4: "SCHD paid $0.96 quarterly" was VTI's figure, and "how much income does
  // my portfolio make" had nothing to answer from). Stale or missing data is refreshed after the answer ships.

  // refresh when a held symbol was never checked or is older than 3 days (every symbol already has a row, so
  // "no row" was never true and the refresh never ran)
  if (held.some((r) => { if (r.kind === "crypto") return false; const d = divRows.get(r.symbol); return !d?.div_as_of || Date.now() - +new Date(d.div_as_of) > 3 * 86400000; })) {
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(refreshDividends(admin, held.map((r) => r.symbol), 8).catch(() => [])); } catch { /* the insights lap refreshes them */ }
  }
  const divLines = held.map((r) => ({ r, d: dividendLine(nameOf(r), divRows.get(r.symbol), Number(r.qty ?? 0), r.currency ?? "USD", fxMap.get(r.currency ?? "USD") ?? 1) }));
  const divIncome = divLines.reduce((a, x) => a + x.d.annual, 0);
  const divPending = held.filter((r) => r.kind !== "crypto" && !divRows.get(r.symbol)?.div_as_of).length;   // coins are never checked
  const divFacts = divLines.map((x) => ({ names: [nameOf(x.r), ...aliasesFor(x.r.symbol, x.r.name)], amounts: x.d.amounts }));

  const stats: string[] = [];
  let totNow = 0;
  const moved: Record<number, { then: number; now: number; missing: string[] }> = { 7: { then: 0, now: 0, missing: [] }, 30: { then: 0, now: 0, missing: [] }, 90: { then: 0, now: 0, missing: [] }, 365: { then: 0, now: 0, missing: [] }, [YTD]: { then: 0, now: 0, missing: [] } };
  const posFacts: PosFact[] = [];
  for (const r of book) {
    const valUsd = usd(Number(r.value ?? 0), r.currency);
    const acct = r.account !== "brokerage" ? `, ${r.account}` : "";
    if (r.kind === "debt") { totNow -= valUsd; stats.push(`- ${nameOf(r)} (debt${acct}): owed ${money(valUsd)}`); continue; }
    totNow += valUsd;
    if (r.symbol.startsWith("$") || r.kind === "cash") { stats.push(`- ${nameOf(r)} (cash${acct}): balance ${money(valUsd)} (${weight(valUsd)} of assets)`); continue; }
    const cur = String(r.currency ?? "USD");
    const px = r.price === null || r.price === undefined ? null : Number(r.price);
    const mk = marketOf(r.symbol, r.kind, cur);
    const bits = [
      `share price ${px === null ? "n/a" : money(px, cur)}${cur !== "USD" && px !== null ? ` (about ${money(usd(px, cur))})` : ""}`,
      ...(prevClose.get(r.symbol) ? [`previous session close ${money(prevClose.get(r.symbol)!, cur)}`] : []),
      ...(sharesOut.get(r.symbol) && px !== null ? [`company market cap about ${bigMoney(usd(px, cur) * sharesOut.get(r.symbol)!.n)} (${bigCount(sharesOut.get(r.symbol)!.n)} shares outstanding, SEC filing)`] : []),
      `shares ${Number(r.qty ?? 0)}`,
      `position value ${money(valUsd)} (${weight(valUsd)} of assets)`,
      `day ${r.change_pct === null ? "n/a" : (Number(r.change_pct) >= 0 ? "+" : "") + Number(r.change_pct).toFixed(1) + "%"} [${dayTag(mk)}]`,
      `avg cost ${money(Number(r.avg_cost ?? 0), cur)}/share`,
      `total gain/loss ${signedUsd(usd(Number(r.total_gl ?? 0), cur))} since purchase`,
    ];
    const p = perf.get(r.symbol);
    for (const d of windows) {
      const pct = p?.pct[d] ?? null;
      const label = winLabel(d);
      if (pct === null) { moved[d].missing.push(nameOf(r)); if (d === 7 || d === 30) bits.push(`${label} ${NO_HISTORY}`); continue; }
      const then = valUsd / (1 + pct / 100);
      moved[d].then += then; moved[d].now += valUsd;
      bits.push(`${label} ${pctText(pct)} (${signedUsd(valUsd - then)})`);
    }
    const who = r.name && r.name !== nameOf(r) ? `${r.name}, ${r.symbol}` : r.symbol;
    // round 6: a Korean answer called NVDA a fund that "holds many stocks": every holding's TYPE is stated
    const typeOf = r.kind === "etf" || r.kind === "fund" ? "fund (ETF: holds many stocks)" : r.kind === "crypto" ? "crypto coin (not a company, not diversified)" : r.kind === "bond" ? "bond" : "single stock (one company, not diversified)";
    stats.push(`- ${nameOf(r)} (${who === nameOf(r) ? "" : who + "; "}type: ${typeOf}${acct}): ${bits.join(" · ")}`);
    posFacts.push({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], price: px === null ? null : usd(px, cur), value: valUsd });
  }
  const investedUsd = held.reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
  // the portfolio's move TODAY, stated on its own line: a Korean answer called the 1-week +2.6% "오늘" (round 4)
  // today = the sessions trading TODAY (and crypto); a market closed today keeps its last session's move out of
  // the total (round 5: Samsung's Wednesday move was counted in Friday's "today" during KRX's Chuseok break)
  const tradesToday = (r: (typeof held)[number]) => { const mk = marketOf(r.symbol, r.kind, r.currency); return mk === null || marketState(mk).tradingToday; };
  const closedToday = held.filter((r) => !tradesToday(r)).map((r) => nameOf(r));
  const bookDayUsd = held.filter(tradesToday).reduce((a, r) => r.change_pct === null ? a : a + usd(Number(r.value ?? 0), r.currency) * (Number(r.change_pct) / 100) / (1 + Number(r.change_pct) / 100), 0);
  const bookDayPct = totNow - bookDayUsd > 0 ? bookDayUsd / (totNow - bookDayUsd) * 100 : 0;
  const totalLines = windows.map((d) => {
    const m = moved[d];
    const label = winLabel(d);
    // a "portfolio" move that leaves out a fifth of the invested money is not the portfolio's move
    if (!m.then || m.now < investedUsd * 0.8) return `${label}: ${NO_HISTORY}${m.missing.length ? ` (missing: ${m.missing.slice(0, 5).join(", ")})` : ""}`;
    const delta = m.now - m.then;
    const miss = m.missing.length ? ` (covers holdings with enough history; missing: ${m.missing.slice(0, 5).join(", ")})` : "";
    return `${label}: ${signedUsd(delta)} (${pctText(delta / m.then * 100)})${miss}`;
  }).join(" · ");

  // ---- signal digest for EVERY holding (news, filings, earnings) ----
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  let digest = "";
  const askEsts: { names: string[]; est: string | null; range?: [string, string] }[] = [];
  const headlinesBy = new Map<string, string>();
  const digSyms = held.slice(0, 12).map((r) => r.symbol);
  if (digSyms.length) {
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const none = { data: [] as never[] };
    const [{ data: dn }, { data: dt }, { data: df }] = await Promise.all([
      capped(admin.from("news").select("symbol,title,url,source,summary,published_at").in("symbol", digSyms).gte("published_at", since14).order("published_at", { ascending: false }).limit(160).then((r) => r) as unknown as Promise<{ data: unknown[] | null }>, 5000, none as { data: unknown[] | null }),
      capped(admin.from("transcripts").select("symbol,title,published_at").in("symbol", digSyms).order("published_at", { ascending: false, nullsFirst: false }).limit(48).then((r) => r) as unknown as Promise<{ data: unknown[] | null }>, 5000, none as { data: unknown[] | null }),
      // only the forms that date a report, 13 months deep (a page of "newest of any form" lost the year-ago quarter)
      capped(earningsFilings(admin, digSyms).then((data) => ({ data })), 5000, none as { data: unknown[] | null }),
    ]) as unknown as [{ data: { symbol: string; title: string; url: string; source: string; summary: string | null; published_at: string }[] | null }, { data: { symbol: string; title: string; published_at: string | null }[] | null }, { data: { symbol: string; form: string; filed_at: string; items?: string | null }[] | null }];
    // each holding's own recent headlines, for the cause check (round 8: META's drop "after a director sale filing" was AVGO's)
    for (const s of digSyms) {
      const r = held.find((h) => h.symbol === s)!;
      headlinesBy.set(s, (dn ?? []).filter((x) => x.symbol === s && usableNews(x, aliasesFor(r.symbol, r.name))).slice(0, 12).map((x) => `${x.title} ${x.summary ?? ""}`).join(" \n "));
    }
    for (const s of digSyms) {
      const r = held.find((h) => h.symbol === s)!;
      const aka = aliasesFor(r.symbol, r.name);
      const fs = (df ?? []).filter((x) => x.symbol === s) as { form: string; filed_at: string; items?: string | null }[];
      const ts = (dt ?? []).filter((x) => x.symbol === s) as { title: string; published_at: string | null }[];
      const earn = earningsLine(nameOf(r), fs, ts, today);
      const est = earningsEstimate(fs, ts, today);
      if (est) askEsts.push({ names: [nameOf(r), ...aka], est: est.est, ...(est.range ? { range: est.range } : {}) });
      const talks = ts.filter((x) => !isEarningsCallTitle(x.title)).slice(0, 1).map((x) => `conference talk (not an earnings report) ${String(x.published_at).slice(0, 10)}`);
      const ff = fs.slice(0, 2).map((x) => `${x.form} ${String(x.filed_at).slice(5, 10)}`);
      // judged again at read time: rows stored before the ingest gate still hold option chains and off-topic stories
      const nn = (dn ?? []).filter((x) => x.symbol === s && usableNews(x, aka)).slice(0, 2).map((x) => `"${String(x.title).slice(0, 90)}" [${x.source} ${String(x.published_at).slice(5, 10)}]`);
      const dlv = deliveriesEstimate(s, today);
      const bits = [...(earn ? [earn.replace(/^[^:]+:\s*/, "")] : ["no earnings date known"]),
        // a deliveries report is not earnings (round 3: "Q3 deliveries due late October"; Tesla's came Oct 2)
        ...(dlv ? [`${dlv.quarter} deliveries report expected ~${dlv.est.slice(5).replace("-", "/")} (est; about the 2nd day after the quarter ends, separate from earnings)`] : []),
        ...talks, ...(ff.length ? ["filings " + ff.join(", ")] : []), ...nn];
      digest += `\n${nameOf(r)}: ${bits.join(" · ")}`;
    }
  }

  // ---- deeper context for the holdings this conversation is about ----
  // the question first, then the last turn ("why did that happen?" is about the holding just discussed)
  const convo = [question, ...turns.slice(-1).flatMap((t) => [t.q, t.a])].join(" ");
  const mentioned = held.filter((r) => {
    const tick = r.symbol.replace(/\.(KS|KQ)$/, "");
    // a short ticker counts only in capitals ("ON" the ticker, never "on" the word); names in any case
    const tickHit = !/^\d+$/.test(tick) && new RegExp(`(^|[^A-Za-z0-9])${esc(tick)}($|[^A-Za-z0-9])`, tick.length <= 3 ? "" : "i").test(convo);
    return tickHit || [r.nickname, ...aliasesFor(r.symbol, r.name).filter((a) => a !== tick)].some((n) => !!n && n.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}($|[^\\p{L}\\p{N}])`, "iu").test(convo));
  }).map((r) => r.symbol).slice(0, 3);
  const mentionedNow = held.filter((r) => {
    const tick = r.symbol.replace(/\.(KS|KQ)$/, "");
    const tickHit = !/^\d+$/.test(tick) && new RegExp(`(^|[^A-Za-z0-9])${esc(tick)}($|[^A-Za-z0-9])`, tick.length <= 3 ? "" : "i").test(question);
    return tickHit || [r.nickname, ...aliasesFor(r.symbol, r.name).filter((a) => a !== tick), ...koNamesFor(r.symbol)].some((n) => !!n && n.length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}($|[^\\p{L}\\p{N}])`, "iu").test(question));
  }).map((r) => r.symbol);
  let context = "";
  // the deep-context reads for the holdings this question is about run together, then are written in order
  const deepNone = [{ data: [] }, { data: [] }, { data: [] }, { data: [] }] as unknown as [{ data: { title: string; url: string; source: string; summary: string | null; published_at: string }[] | null }, { data: { bullets: string[]; generated_at: string }[] | null }, { data: { form: string; filed_at: string; title: string | null }[] | null }, { data: { title: string; published_at: string | null; content: string | null }[] | null }];
  const deep = await Promise.all(mentioned.map((sym) => capped(Promise.all([
      admin.from("news").select("title,url,source,summary,published_at").eq("symbol", sym).gte("published_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("published_at", { ascending: false }).limit(24),
      admin.from("insights").select("bullets,generated_at").eq("symbol", sym).order("generated_at", { ascending: false }).limit(1),
      admin.from("filings").select("form,filed_at,title").eq("symbol", sym).order("filed_at", { ascending: false }).limit(6),
      admin.from("transcripts").select("title,published_at,content").eq("symbol", sym).order("published_at", { ascending: false, nullsFirst: false }).limit(4),
    ]) as unknown as Promise<typeof deepNone>, 6000, deepNone)));
  for (const [k, sym] of mentioned.entries()) {
    const [{ data: news }, { data: ins }, { data: fils }, { data: trAll }] = deep[k];
    const hr = held.find((h) => h.symbol === sym)!;
    const nm = nameOf(hr);
    const heads = (news ?? []).filter((n) => usableNews(n, aliasesFor(hr.symbol, hr.name))).slice(0, 12);
    context += `\n[${nm}] 7d headlines:\n${heads.map((n) => `- [${n.source}, ${String(n.published_at).slice(5, 10)}] ${n.title}`).join("\n") || "- none"}`;
    if (ins?.[0]) context += `\n[${nm}] current desk take (written ${String(ins[0].generated_at).slice(0, 16).replace("T", " ")} UTC; its prices may be older than the stats above, which win): ${(ins[0].bullets as string[]).join(" | ")}`;
    if (fils?.length) context += `\n[${nm}] SEC filings: ${fils.map((f) => `${f.form} ${f.filed_at}`).join(", ")}`;
    const calls = (trAll ?? []).filter((t) => isEarningsCallTitle(t.title));
    const others = (trAll ?? []).filter((t) => !isEarningsCallTitle(t.title));
    if (calls.length) {
      context += `\n[${nm}] earnings calls on file: ${calls.map((t) => `${String(t.title).slice(0, 90)} (posted ${String(t.published_at).slice(0, 10)})`).join(" ; ")}`;
      if (String(calls[0].content ?? "").length > 2000) context += `\n[${nm}] latest earnings call excerpts (question-relevant windows): ${excerptFor(String(calls[0].content), question)}`;
    }
    if (others.length) context += `\n[${nm}] other talks on file (conferences, NOT earnings reports): ${others.map((t) => `${String(t.title).slice(0, 90)} (${String(t.published_at).slice(0, 10)})`).join(" ; ")}`;
  }

  const complex = isComplex(question);
  const cap = complex ? 170 : 90;
  // "should I?" right after a trade question is the same question
  const tradeQ = isTradeQuestion(question) || (turns.length > 0 && /\bshould (i|we)\b|(할까|될까|해야)/i.test(question) && isTradeQuestion(turns[turns.length - 1].q));
  // the language of the QUESTION decides the answer's language, trade questions included (round 2: "테슬라
  // 팔까요?" came back in English because the example opener below was English and the model copied it)
  const ko = questionIsKorean(question);
  // today's move per holding and for the portfolio, for the number check (±0.15 point, sign)
  const moveFacts: LiveFact[] = [
    ...held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], pct: r.change_pct === null || !tradesToday(r) ? null : Number(r.change_pct) })),
    { names: ["portfolio", "your holdings", "your book", "포트폴리오", "전체 자산", "총자산", "자산"], pct: bookDayPct },
  ];
  const causeSource = `${digest}\n${context}`;
  // the direct answer to a share or best-performer question, from code (the lead a guard may have taken)
  const leadFact = (): string | null => {
    const one = mentionedNow.length === 1 ? held.find((h) => h.symbol === mentionedNow[0]) : null;
    if (one && /\b(?:share|weight|percent|portion|how much of|what part)\b|%|비중|얼마나 차지/i.test(question)) {
      const v = usd(Number(one.value ?? 0), one.currency);
      return ko ? `• ${nameOf(one)}는 자산의 ${weight(v)}(${money(v)})입니다.` : `• ${nameOf(one)} is ${weight(v)} of your portfolio (${money(v)}).`;
    }
    const w = /\b(?:this year|YTD|year to date)\b|올해/i.test(question) ? YTD : /\bmonth\b|한 달/i.test(question) ? 30 : /\bweek\b|이번 주/i.test(question) ? 7 : /\byear\b|1년/i.test(question) ? 365 : null;
    if (w !== null && /\b(?:best|strongest|top|leading|worst|weakest)\b|가장/i.test(question)) {
      const worst = /\b(?:worst|weakest)\b|가장 (?:많이 내린|부진)/i.test(question);
      const ranked = held.filter((r) => typeof perf.get(r.symbol)?.pct[w] === "number").sort((a, b) => (perf.get(b.symbol)!.pct[w]! - perf.get(a.symbol)!.pct[w]!) * (worst ? -1 : 1));
      if (!ranked.length) return null;
      const r0 = ranked[0], v = perf.get(r0.symbol)!.pct[w]!;
      const lbl = w === YTD ? (ko ? "올해" : "this year") : w === 365 ? (ko ? "1년" : "over the past year") : w === 30 ? (ko ? "한 달" : "this month") : (ko ? "이번 주" : "this week");
      return ko ? `• ${lbl} ${worst ? "가장 부진한" : "가장 많이 오른"} 종목은 ${nameOf(r0)}(${pctText(v)})입니다.` : `• ${nameOf(r0)} is your ${worst ? "weakest" : "best"} holding ${lbl}, ${pctText(v)}.`;
    }
    return null;
  };
  const rankFacts = held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)], weight: usd(Number(r.value ?? 0), r.currency) / (assetsUsd || 1) * 100 }));
  /** The informational answer built from the stats when the model's is a husk: what the decision rests on. */
  // Round 6: the code-built answer was 2-3 thin bullets. It is now 4-5, specific to this book: concentration,
  // theme mix with crypto and cash, reports in the next 45 days, dividend payers with income and ex-dates in the
  // next 45 days (div_next_ex), and what a buyer would weigh.
  // Round 7: the husk fits the question: a seller's frame for sell/trim/dump, a ranking by stated metrics for "rank my
  // holdings", and an answer built around the one holding a trade question names
  // Round 8: "Give me the 3 best stocks to buy" after "Is NVDA overvalued?" got a buyer's case for NVDA (the previous
  // turn's symbol), and "Should I buy the dip on META?" got the generic husk. Focus follows the CURRENT question only,
  // and a pick / "N best" question never focuses.
  const nowSyms = mentionedNow;
  const focusRow = tradeQ && !isPickQuestion(question) && nowSyms.length === 1 ? held.find((h) => h.symbol === nowSyms[0])! : null;
  const estOf = (sym: string) => { const r = held.find((h) => h.symbol === sym); const e = r ? askEsts.find((x) => x.names[0] === nameOf(r)) : undefined; return e ? (e.range ? spanOfMonth(e.range) : e.est ? "~" + new Date(e.est + "T12:00:00Z").toLocaleDateString(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null) : null; };
  const defaultInfo = (): string => buildHusk({
    holdings: held.map((r) => ({ name: nameOf(r), symbol: r.symbol, kind: r.kind, usd: usd(Number(r.value ?? 0), r.currency) })),
    cashUsd: book.filter((r) => r.symbol.startsWith("$") || r.kind === "cash").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0),
    assetsUsd, today,
    reports: askEsts.map((e) => ({ name: e.names[0], est: e.est, ...(e.range ? { range: e.range } : {}) })),
    dividends: divLines.map((x) => ({ name: nameOf(x.r), annualUsd: x.d.annual, nextEx: divRows.get(x.r.symbol)?.div_next_ex ?? null, current: x.d.current })),
    mode: isRankQuestion(question) ? "rank" : isSellQuestion(question) ? "sell" : "buy",
    returns1m: Object.fromEntries(held.map((r) => [r.symbol, perf.get(r.symbol)?.pct[30] ?? null])),
    ...(focusRow ? { focus: {
      name: nameOf(focusRow), weight: usd(Number(focusRow.value ?? 0), focusRow.currency) / (assetsUsd || 1) * 100, usd: usd(Number(focusRow.value ?? 0), focusRow.currency),
      gainUsd: focusRow.total_gl === null || focusRow.total_gl === undefined ? null : usd(Number(focusRow.total_gl), focusRow.currency),
      dayPct: focusRow.change_pct === null || !tradesToday(focusRow) ? null : Number(focusRow.change_pct),
      r1m: perf.get(focusRow.symbol)?.pct[30] ?? null, r3m: perf.get(focusRow.symbol)?.pct[90] ?? null, report: estOf(focusRow.symbol),
      divAnnual: divLines.find((x) => x.r.symbol === focusRow.symbol)?.d.annual ?? 0, divCurrent: divLines.find((x) => x.r.symbol === focusRow.symbol)?.d.current ?? false,
    } } : {}),
  }, ko);
  // Round 7: three 502s ("lost the thread") on plain data questions. A non-decision question whose model lanes both
  // failed now gets the figures built in code (today, the windows, the reports ahead, the largest holdings)
  const dataFallback = (): string => {
    // Round 8: the fallback was the same generic block for every question ("TSLA is up 20% today, why?" got no TSLA
    // figure and no correction). It now answers the question's own subject first, from code.
    const one = mentionedNow.length === 1 ? held.find((h) => h.symbol === mentionedNow[0])! : null;
    if (one) {
      const nm = nameOf(one), chg = one.change_pct === null ? null : Number(one.change_pct), px = one.price === null ? null : Number(one.price);
      const cur = String(one.currency ?? "USD");
      const lines: string[] = [];
      const claim = /\b(?:up|down|rose|fell|gained|lost|jumped|dropped|crashed|surged)\s+(\d+(?:\.\d+)?)\s?%/i.exec(question) ?? /(\d+(?:\.\d+)?)\s?%\s*(?:올랐|상승|내렸|하락|빠졌)/.exec(question);
      if (claim && chg !== null && Math.abs(Math.abs(chg) - Number(claim[1])) > 0.3) {
        lines.push(ko ? `• ${nm}는 오늘 ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%입니다. ${claim[1]}%가 아닙니다.` : `• ${nm} ${chg >= 0 ? "rose" : "fell"} ${Math.abs(chg).toFixed(1)}% today, not ${claim[1]}%.`);
      } else if (chg !== null) {
        lines.push(ko ? `• ${nm}: 오늘 ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%${px !== null ? `, 현재 ${money(px, cur)}` : ""}.` : `• ${nm} is ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(1)}% today${px !== null ? `, at ${money(px, cur)}` : ""}.`);
      }
      const w = usd(Number(one.value ?? 0), one.currency) / (assetsUsd || 1) * 100;
      lines.push(ko ? `• 자산의 ${w.toFixed(1)}%(${money(usd(Number(one.value ?? 0), one.currency))})입니다.` : `• It is ${w.toFixed(1)}% of your portfolio (${money(usd(Number(one.value ?? 0), one.currency))}).`);
      if (/\b(?:dividend|pay(?:s|out)?|per share|quarter)\b|배당/i.test(question)) {
        const dl = divLines.find((x) => x.r.symbol === one.symbol)?.d.line;
        if (dl) lines.push(`• ${dl.replace(/^[^:]+:\s*/, `${nm}: `)}.`);
      }
      const p = perf.get(one.symbol)?.pct ?? {};
      const wins = [[30, ko ? "1개월" : "1 month"], [365, ko ? "1년" : "1 year"]].filter(([d]) => typeof p[d as number] === "number").map(([d, l]) => `${l} ${pctText(p[d as number] as number)}`);
      if (wins.length) lines.push(`• ${wins.join(", ")}.`);
      return lines.join("\n");
    }
    if (/\bconcentrat|\bhow (?:spread|diversified)\b|집중/i.test(question)) {
      const ws = [...held].sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency)).slice(0, 6).map((r) => `${nameOf(r)} ${weight(usd(Number(r.value ?? 0), r.currency))}`);
      const top3 = [...held].sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency)).slice(0, 3).reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / (assetsUsd || 1) * 100;
      return ko ? `• 상위 3개 종목이 자산의 ${top3.toFixed(0)}%입니다.\n• 비중: ${ws.join(", ")}.` : `• Your three largest holdings are ${top3.toFixed(0)}% of the portfolio.\n• Weights: ${ws.join(", ")}.`;
    }
    const reps = [...askEsts].filter((e) => e.est && e.est > today).sort((a, b) => String(a.est).localeCompare(String(b.est))).slice(0, 8)
      .map((e) => `${e.names[0]} ${e.range ? (ko ? spanOfMonthKo(e.range) : spanOfMonth(e.range)) : (ko ? "" : "~") + new Date(e.est + "T12:00:00Z").toLocaleDateString(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + (ko ? "경" : "")}`);
    const tops = [...held].sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency)).slice(0, 3).map((r) => `${nameOf(r)} ${weight(usd(Number(r.value ?? 0), r.currency))}`);
    return ko ? [
      `• 오늘 포트폴리오: ${bookDayPct >= 0 ? "+" : ""}${bookDayPct.toFixed(2)}%(${signedUsd(bookDayUsd)}).`,
      `• 기간별: ${totalLines}.`,
      reps.length ? `• 다가오는 실적 발표(추정): ${reps.join(", ")}.` : "",
      tops.length ? `• 비중 상위: ${tops.join(", ")}.` : "",
    ].filter(Boolean).join("\n") : [
      `• Today your portfolio is ${bookDayPct >= 0 ? "+" : ""}${bookDayPct.toFixed(2)}% (${signedUsd(bookDayUsd)}).`,
      `• Longer windows: ${totalLines}.`,
      reps.length ? `• Reports expected (estimates): ${reps.join(", ")}.` : "",
      tops.length ? `• Largest holdings: ${tops.join(", ")}.` : "",
    ].filter(Boolean).join("\n");
  };
  // a day move of a market closed today carries its session ("SK hynix up 1.2% (Wed)" during a KRX holiday)
  const KO_DAY = ["일", "월", "화", "수", "목", "금", "토"];
  const closedFacts = held.filter((r) => !tradesToday(r)).map((r) => {
    const mk = marketOf(r.symbol, r.kind, r.currency);
    const last = mk ? marketState(mk).lastSessionDate : today;
    return { names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], label: ko ? `${KO_DAY[new Date(last + "T12:00:00Z").getUTCDay()]}요일` : weekdayOf(last).slice(0, 3) };
  });
  const divTiming = held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], nextEx: divRows.get(r.symbol)?.div_next_ex ?? null }));
  // Round 7: a FOLLOW-UP turn to a decision question is a decision question too ("If you had my $120K cash, where
  // would it go?" after "What should I buy with $10K?" got a named buy list), and so is a cash question in Korean
  const prevQ = turns.length ? turns[turns.length - 1].q : "";
  const prevA = turns.length ? turns[turns.length - 1].a : "";
  const prevWasHusk = /usually weighs here|보통 따지는 것/.test(prevA);
  const followDecision = turns.length > 0 && (isTradeQuestion(prevQ) || isPickQuestion(prevQ) || prevWasHusk)
    && /\b(?:cash|money|\$\s?\d|what about|how about|and if|instead|where would|what would|if you had|the rest|with that)\b|현금|돈|그럼|대신|나머지/i.test(question);
  const pickQ = isPickQuestion(question) || followDecision
    || /(현금|돈)[^?]{0,12}(뭘|무엇을|어디에|어떤)[^?]{0,8}(사|넣|투자)/.test(question);
  // Korean names too, so a Korean shortlist ("애플은… 마이크로소프트는…") is recognised (round 7)
  const bookNames = held.map((r) => ({ symbol: r.symbol, names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)] }));
  const dlvFacts = held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], est: deliveriesEstimate(r.symbol, today)?.est ?? null }));
  const lastA = turns.length ? turns[turns.length - 1].a : "";
  const saidNoCall = tradeQ && /can'?t tell you|not my call|your call|정해드릴 수 없|말씀드릴 수 없/i.test(lastA);
  const opener = ko ? `"매도 여부는 제가 정해드릴 수 없지만, 판단의 근거는 이렇습니다."` : `"I can't tell you whether to sell, but here's what it hinges on."`;
  const convoBlock = turns.length
    ? `CONVERSATION SO FAR (oldest first). The new question may refer back to it ("that", "it", "why?", "what about the other one"): resolve those against the MOST RECENT answer and stay on the same holding unless the user switches.\n${turns.map((t, i) => `Q${i + 1}: ${t.q}\nA${i + 1}: ${t.a}`).join("\n")}\n`
    : "";
  const ccyLine = korean
    ? `Money: portfolio totals and position values are US dollars ($); Korean shares also show their won price. Write won amounts with the ₩ sign.`
    : `Money: every amount is in US dollars ($). This account holds nothing in Korean won: write ₩ only when the user asks for won, converting at the rate on file: USD/KRW ${Math.round(fxMap.get("KRW") ?? 1380).toLocaleString("en-US")} (₩ per $1); say it is a conversion at that rate.`;
  const prompt = `TODAY is ${today} (US Eastern date).
${ccyLine}
User's portfolio (deterministic; the ONLY source of numbers). For each holding: "share price" is the price of ONE share; "position value" is what the user's whole holding is worth. They are different numbers: a question about the stock's price or close gets the SHARE PRICE, never the position value. Each "day" figure is tagged with the session it belongs to: a LIVE session is today's move so far, a "past (not today)" session is named by its day, and a live move is never "yesterday".
${stats.join("\n")}
Portfolio total: ${money(totNow)} · TODAY (this session only${closedToday.length ? `; excludes ${closedToday.join(", ")}, whose market is closed today` : ""}): ${signedUsd(bookDayUsd)} (${bookDayPct >= 0 ? "+" : ""}${bookDayPct.toFixed(2)}%) · longer windows (NEVER "today"): ${totalLines}
Window figures that read "${NO_HISTORY}" have no data: say so plainly for that window; never reuse another window's number in its place.
DIVIDENDS per holding (the ONLY dividend figures you may state, each for its own holding; an estimate is labelled "(est)" and every estimated date you write keeps that label; when the cash is paid after the ex-date is NOT in the data, so never state a payment lag; a coin such as bitcoin pays no dividend, say so plainly):
${divLines.map((x) => "- " + x.d.line).join("\n")}
${divPending ? `Portfolio dividend income: still loading for ${divPending} holding(s); say the figures are being fetched and to ask again in a minute, never state $0 or a partial total as the portfolio's income.` : `Portfolio dividend income ≈ ${money(divIncome)} a year (shares × last 12 months' payments per holding)${assetsUsd > 0 ? `, ${(divIncome / assetsUsd * 100).toFixed(2)}% of assets` : ""}.`}
Signals on file per holding (earnings dates, filings, headlines; the earnings dates are computed from SEC filings and are the ONLY earnings dates you may state, with "(est)" estimates spoken as "expected around ..."):${digest || "\n(none)"}
${context}

${convoBlock}Question: "${question}"

${READER}
Answer as THEIR analyst (see the reader profile): direct, specific, tight. Ground qualitative answers in the signals, headlines, filings and earnings material above, not just prices. Numbers come only from the stats block.
PREMISE LAW: check every fact the question takes for granted against the stats first ("X is cheaper than Y", "X is down this month", "X reports next week"). If it is false, say so in the first line with the real figures, then answer. A share price says nothing about a company's size or value: compare companies by market cap only when it is given above, and never infer shares outstanding or company value from a share price. Dates: earnings, deliveries and other events only as given above; a deliveries report is not an earnings report; never invent a date. Never make a historical comparison (a past year, "since 2008", "all-time", "record") the data above does not state. Plain words: say "portfolio", never "book"; "the market", never "the tape"; "stocks", never "names". A cause for a move comes only from a headline above (never "profit-taking" or "X warned" unless a headline says so); otherwise say the news does not explain it. Name holdings by name, never anonymously ("a semiconductor firm"). A figure for TODAY is only the "day" figure or the portfolio's TODAY line; 1W / 1M / 3M are never "today".
ANSWER LAW (above everything else): you give INFORMATION, never a trade instruction or a verdict on their own holdings. Never tell them to buy, sell, hold, add, trim, swap, rotate or take profits, never give a verdict ("Verdict: hold", "a buy here", "top pick", "the one I'd dump"), never rank their holdings by which is best or worst to own or keep (a ranking by a stated metric over a stated window, like 1-month return, is fine), never call a holding cheap, expensive, undervalued, overvalued, a bargain or a buying opportunity (state the metric instead: its P/E versus its own history), and never size a position ("put $X into", "buy N shares"). Instead explain what is driving it, the risks, the scenarios, what to watch next (a date or a level), and what a buy case or a sell case would rest on.${tradeQ ? (saidNoCall ? ` This question asks what to trade or which holding wins; your previous answer already said the call is theirs, so do not repeat that line: go straight to the balanced considerations on both sides.` : ` This question asks what to trade or which holding wins: open with ONE short, natural line in your own words that the decision is theirs to make (the sense of ${opener}), then give the balanced considerations on both sides. One line, never a wall of disclaimer.`) : ""}
LANGUAGE (decided by the CURRENT question only, never by the holdings' names or the conversation so far): ${ko ? "the question is in KOREAN: write the entire answer AND every followup in natural Korean (tickers and US company names may stay as written)." : "the question is in ENGLISH: write the entire answer AND every followup in English, even when earlier turns or Korean holdings' names are in Korean (use a Korean company's English name)."}
${EVIDENCE_LAW}
If the question is not about investing, their portfolio or markets, answer in one friendly line that you stick to their portfolio and markets, and suggest one thing you can help with.
HARD LIMIT: ${complex ? "170 words; this is a multi-part question, so give each part a short bold header and a direct answer" : "80 words total, 3-5 short bullets max, readable on a phone in under 20 seconds"}. No preamble, no repetition. If the question needs data you truly don't have, one line saying exactly what's missing.`;

  if (fixture) return json({ ok: true, answer: "FIXTURE\nTOTAL:" + Math.round(totNow) + "\n" + totalLines + "\nTURNS:" + turns.length + "\nKRW:" + korean, followups: ["Fixture follow-up one?", "Fixture follow-up two?"], mentioned, ...(url.searchParams.get("prompt") === "1" ? { prompt } : {}) });   // prompt=1: the caller's own data block, for tests

  let key = Deno.env.get("MARA_API_KEY") ?? "";
  if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
  if (!key) return json({ ok: false, error: "not configured" }, 500);
  const system = `You are a direct, analytical portfolio assistant. You explain and inform; you never tell the user what to buy or sell. Respond ONLY with strict JSON: {"answer": "...", "followups": ["...", "..."]}. Your first character must be {. The answer value: plain text, • bullets and **bold** allowed, ${complex ? "170" : "80"} words MAX, no preamble, no repeated points, never narrate your reasoning, never invent numbers, never use em dashes, no boilerplate disclaimers.${korean ? " Refer to Korean companies by name, never numeric KRX codes; write won amounts with the ₩ sign." : " All money is US dollars; write won only when asked, converted at the USD/KRW rate given."} The followups value: AFTER writing the answer, reread it and offer 2-3 natural next questions this user would ask, each under 12 words, ending with ?, starting with Why, What or How, written in the language of the CURRENT question (a Korean question: in Korean, asking 왜, 무엇 or 어떻게), answerable from their portfolio stats, news, SEC filings, or earnings data, never repeating the question just answered, and NEVER asking whether or how much to buy, sell, add or trim.`;
  // Round 3 measured a 97.5s first answer: a 45s first attempt, backoff, a 35s retry and a 35s rewrite. Now the
  // primary model gets 20s, the fast lane (gpt-oss, same prompt and guards) whatever is left of ~29s, and the
  // corrective rewrite runs only when it can finish inside that budget; otherwise the code-side guards
  // (deletion, language-matched opener) stand alone.
  // Round 5: 5 of 38 answers took over 30s (max 39.6s): a serial primary-then-fast fallback plus a husk re-ask.
  // Now the fast lane is HEDGED: it starts at 7s if the primary has not answered (or at once if the primary
  // failed), and the first valid answer wins; the rewrite and the husk re-ask run only while they fit, so an
  // answer ships inside ~29s.
  // Round 6: a trade or pick question ends in the code-built answer whenever the models are slow, so it stops
  // waiting on them at 10s (fast lane from 3s) and its whole budget is 15s.
  const decisionQ = tradeQ || pickQ;
  if (decisionQ && prevWasHusk && !fixture) {
    const again = withNoCallLine(defaultInfo(), question, "", "", true);
    return json({ ok: true, answer: plainDataWords(tidyNumbers(again)), followups: cleanFollowups([], ko ? ["내 포트폴리오는 얼마나 집중돼 있나요?", "내 포트폴리오의 가장 큰 위험은 뭔가요?"] : ["How concentrated is my portfolio?", "What are the biggest risks in my portfolio?"]), mentioned });
  }
  // round 7 newcomer: a 502 at 27.9s (Korean 1-year question). The whole non-decision answer now ships inside 26s, well
  // under the gateway, with the code-built figures as the fallback
  const FAST = "gpt-oss-120b", BUDGET = decisionQ ? 15000 : 26000;
  const left = () => BUDGET - (Date.now() - t0);
  const ask = async (msgs: { role: string; content: string }[], temperature: number, timeoutMs: number, model = Deno.env.get("MARA_MODEL") ?? "MiniMax-M3") => {
    if (timeoutMs < 1500) return null;
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(`${Deno.env.get("MARA_BASE_URL") ?? "https://api.cloud.mara.com"}/v1/chat/completions`, {   // base overridable for local fixture runs
      signal: ac.signal,
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens: 6000, response_format: { type: "json_object" } }),
    }).catch(() => null);
    clearTimeout(timer);
    if (!r || !r.ok) return null;
    const out = await r.json().catch(() => null);
    return parseAnswer(out?.choices?.[0]?.message?.content ?? "");
  };
  const base = [{ role: "system", content: system }, { role: "user", content: prompt }];
  let parsedA: { answer: string; followups: string[] } | null = null;
  type Ans = { answer: string; followups: string[] } | null;
  parsedA = await new Promise<Ans>((resolve) => {
    let settled = false, fastStarted = false, open = 1;
    const finish = (v: Ans) => {
      if (settled) return;
      if (v) { settled = true; resolve(v); return; }
      open--;
      if (!fastStarted) startFast(); else if (open <= 0) { settled = true; resolve(null); }
    };
    const startFast = () => {
      if (fastStarted || settled) return;
      fastStarted = true; open++;
      ask(base, 0.3, Math.min(decisionQ ? 7000 : 20000, left() - 1500), FAST).then(finish, () => finish(null));
    };
    ask(base, 0.2, Math.min(decisionQ ? 10000 : 20000, left() - 1500)).then(finish, () => finish(null));
    setTimeout(startFast, decisionQ ? 3000 : 7000);
    if (decisionQ) setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 10000);
  });
  const deDash = (v: string) => v.trim().replace(/\s*—\s*/g, ": ").replace(/\s*–\s*/g, ": ");
  // one bullet per line before any check: a shortlist written "• A. • B." on one line reads as one line otherwise
  let answer = normalizeBullets(deDash(parsedA?.answer ?? ""));
  // ---- verifier: a trade instruction or a position value quoted as a share price gets ONE rewrite ----
  const problems = (a: string) => [
    ...adviceHits(a, { verdictQuestion: tradeQ || pickQ }).map((s) => `It tells the user what to trade or passes a verdict (a ranking of what to keep or dump, or a cheap/expensive call): "${s.slice(0, 120)}". Rewrite it as information (drivers, risks, the metric itself, what a buy or sell case would rest on).`),
    ...priceConfusions(a, posFacts).map((h) => `It quotes ${h.match} as a share price, but that is the user's POSITION VALUE; the share price is in the stats.`),
    ...(wrongLanguage(question, a) ? [ko ? "It is written in English but the question is in Korean: write the whole answer and the followups in Korean."
      : "It is written in Korean but the question is in English: write the whole answer and the followups in English."] : []),
    ...(decisionQ ? suggestionHits(a, bookNames) : []).slice(0, 2).map((s) => `"${s.slice(0, 120)}" suggests adding to or buying a named holding. Never name what to buy or add to: explain what the decision rests on for the portfolio as a whole.`),
    ...(pickQ ? curatedListHits(a, bookNames) : []).slice(0, 1).map(() => `It answers a pick question with a shortlist of some holdings. Do not single out names: explain what such a decision rests on (concentration, drivers, risks) for the book as a whole, or give one neutral fact per holding for ALL holdings in order of weight.`),
    ...wrongDeliveriesDates(a, dlvFacts, today).map((s) => `"${s.slice(0, 120)}" dates a deliveries report that is not in the data (a deliveries report is not earnings).`),
    ...dayMoveMismatches(a, moveFacts, 0.15).map((s) => `"${s.slice(0, 120)}" states a move for TODAY that is not today's figure in the stats (check the period and the sign; longer windows are never "today").`),
    ...wrongEarningsMonths(a, askEsts).map((s) => `"${s.slice(0, 120)}" puts a report in a month its estimate does not cover.`),
    ...unsupportedCauses(a, causeSource).map((s) => `"${s.slice(0, 120)}" gives a cause for a move that no headline states; say the cause is not clear from the news.`),
    ...wrongDividendAmounts(a, divFacts).map((s) => `"${s.slice(0, 120)}" states a dividend figure that is not that holding's (see DIVIDENDS).`),
  ];
  const found = answer ? problems(answer) : [];
  if (found.length && left() > (decisionQ ? 5500 : 8000)) {
    const fixed = await ask([...base, { role: "assistant", content: JSON.stringify({ answer, followups: parsedA?.followups ?? [] }) },
      { role: "user", content: `Your answer broke the rules:\n- ${found.join("\n- ")}\nReturn the corrected JSON in the same shape. Keep everything else that was right.` }], 0.2, Math.min(decisionQ ? 4500 : 9000, left() - 1500), FAST);
    if (fixed && problems(normalizeBullets(deDash(fixed.answer))).length < found.length) { parsedA = fixed; answer = normalizeBullets(deDash(fixed.answer)); }
  }
  // ...and whatever survives the rewrite is removed or corrected in code
  // both lanes out of time: a trade or pick question still gets the answer built in code from the stats (below)
  // inside the budget, rather than a 502 after ~27s; any other question has nothing honest to fall back on
  // Round 7: no 502 any more. A decision question falls through to the code-built husk; any other question gets the
  // code-built figures (the three 502s were plain data questions that worked on a re-ask)
  let softFallback = false;
  if (!answer && !(tradeQ || pickQ)) { answer = dataFallback(); softFallback = true; }
  // code-side guards, on EVERY answer (whether or not an opener is added): verdicts and valuation calls, a
  // shortlist answering a pick question, a deliveries date that is not in the data
  const dropLines = new Set([...(pickQ ? curatedListHits(answer, bookNames) : []), ...(decisionQ ? suggestionHits(answer, bookNames) : []),
    ...holdingRankClaims(answer, rankFacts), ...wrongDeliveriesDates(answer, dlvFacts, today),
    ...dayMoveMismatches(answer, moveFacts, 0.15), ...wrongEarningsMonths(answer, askEsts), ...unsupportedCauses(answer, causeSource), ...wrongDividendAmounts(answer, divFacts),
    ...wrongDividendTiming(answer, divTiming, today),
    // round 6: "QQQ·VOO·NVDA는 여러 종목을 담고 있어" (NVDA is one company); "SoFi fell after an article noted its drop"
    ...diversifiedClaims(answer, held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], fund: r.kind === "etf" || r.kind === "fund" }))), ...circularCauses(answer),
    // round 7 newcomer: "+7.2% this month, on pace with your 8-12% annual target"; "입금은 보통 2-4주 뒤"; "crypto hedge"
    ...targetPaceClaims(answer), ...paymentLagClaims(answer), ...promoCharacterisations(answer),
    // round 8: "the strongest gain in your portfolio" (NVDA; AAPL leads YTD), "below your buy price" (TSLA is +50% over
    // cost), "inside your 12-20% target" (11.5%), a cause from another holding's news
    ...superlativeClaims(answer, held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)], windows: (perf.get(r.symbol)?.pct ?? {}) as Record<number, number | null> }))),
    ...costBasisClaims(answer, held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)], gainPct: Number(r.avg_cost ?? 0) > 0 && r.price !== null ? (Number(r.price) / Number(r.avg_cost) - 1) * 100 : null }))),
    ...targetBandClaims(answer),
    ...misattributedCauses(answer, held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], headlines: headlinesBy.get(r.symbol) ?? "" }))),
    // round 7 newcomer: "339% this year" for Samsung (YTD +138%): a period claim is held to the holding's own window
    ...periodReturnMismatches(answer, held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)], windows: (perf.get(r.symbol)?.pct ?? {}) as Record<number, number | null> })))]);
  const pruned0 = answer;
  // Round 8: "What share of my portfolio is NVDA?" shipped "That is $675,210 out of…" with the 19.2% gone, and a premise
  // answer read "NVDA is, at 19.2% of assets." Drops now remove WHOLE sentences only (never a substring inside one),
  // and if the lead goes and the next line opens on "That/It/This", the lead fact is rebuilt from code.
  const dropSet = [...dropLines].map((d) => d.trim()).filter(Boolean);
  const isDropped = (sen: string) => dropSet.some((d) => d === sen.trim() || d.includes(sen.trim()) || (sen.trim().length > 12 && sen.includes(d)));
  const leadSen = splitSentences(pruned0)[0] ?? "";
  let pruned = perLine(pruned0, (line) => splitSentences(line).filter((sen) => !isDropped(sen)).join(" "));
  if (leadSen && isDropped(leadSen) && /^\s*(?:•\s*)?(?:That|It|This|These|Those|They|이는|이것|그것)\b/.test(pruned)) {
    const fact = leadFact();
    const subj = mentionedNow.length === 1 ? nameOf(held.find((h) => h.symbol === mentionedNow[0])!) : null;
    // the orphan pronoun takes the holding's name when the question names one; otherwise the orphan line goes
    pruned = fact ? `${fact}\n${pruned}` : subj ? pruned.replace(/^(\s*(?:•\s*)?)(?:It|This|That)\b/, `$1${subj}`) : pruned.replace(/^\s*(?:•\s*)?(?:That|It|This|These|Those|They)\b[^\n]*\n?/, "");
  }

  let guarded = fixPriceConfusions(stripAdvice(normalizeBullets(pruned), { verdictQuestion: tradeQ || pickQ }), posFacts).trim();
  // Round 4: after the guards, "What should I buy with $10K?" was left with one unrelated line and "top pick"
  // with a ten-holding dump. When the guards took most of an answer to a trade or pick question, the model
  // gets ONE informational re-ask, and if that is thin too, the answer is built in code from the stats.
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const moveNames = held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name), ...koNamesFor(r.symbol)] }));
  // round 6: "top pick?" was answered with 11 day moves joined by semicolons: not an answer to the question
  const husk = (g: string) => (tradeQ || pickQ) && (words(g) < 25 || words(g) < words(answer) * 0.45 || dayMoveDump(g, moveNames));
  // Round 6: no model re-ask for a husk any more. husk() applies only to trade and pick questions, and the
  // answer built in code from this portfolio (below) is richer than the re-ask was and costs no time.
  let builtInCode = false;
  if (husk(guarded) || !guarded) {
    builtInCode = true;
    // a data question whose every sentence failed the number checks gets the verified figures instead
    const day = ko ? `• 오늘 포트폴리오는 ${bookDayPct >= 0 ? "+" : ""}${bookDayPct.toFixed(2)}%(${signedUsd(bookDayUsd)})입니다.`
      : `• Today your portfolio is ${bookDayPct >= 0 ? "+" : ""}${bookDayPct.toFixed(2)}% (${signedUsd(bookDayUsd)}).`;
    guarded = tradeQ || pickQ ? defaultInfo() : [day, defaultInfo().split("\n")[0]].join("\n");
  }
  // a closed market's day move is labelled with its session, or dropped when it is called today's (round 6)
  guarded = labelClosedMoves(guarded, closedFacts) || guarded;
  // every date we ESTIMATED (ex-dates, report dates) carries its label (round 7: "2026-09-28 (3일 뒤)" with no 추정)
  guarded = labelEstimatedDates(guarded, [...held.map((r) => divRows.get(r.symbol)?.div_next_ex ?? ""), ...askEsts.map((e) => e.est ?? "")], ko);
  // round 7: "Apple is my biggest holding" (NVDA is) was repeated as fact: the premise is corrected in the first line
  { const fix = holdingRankPremise(question, rankFacts, ko); if (fix && !guarded.includes(fix)) guarded = `${fix}\n${guarded}`; }
  // the husk text is held to the same report dates as everything else (round 5: "NVDA … late October")
  { const bad = new Set(wrongEarningsMonths(guarded, askEsts)); if (bad.size) guarded = guarded.split("\n").filter((l) => ![...bad].some((b) => l.includes(b))).join("\n") || defaultInfo(); }
  // "on file" is pipeline language (round 5: "BTC: no dividend data on file")
  // round 6e: a fraction word must match the share it names ("over a third" for a 21.1% holding)
  const fracHold = held.map((r) => ({ names: [nameOf(r), ...aliasesFor(r.symbol, r.name)], weight: usd(Number(r.value ?? 0), r.currency) / (assetsUsd || 1) * 100 }));
  const cashShare = book.filter((r) => r.symbol.startsWith("$") || r.kind === "cash").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / (assetsUsd || 1) * 100;
  const cryptoShareA = held.filter((r) => r.kind === "crypto").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / (assetsUsd || 1) * 100;
  const fracGroupsA = [{ label: /\bcash\b/i, value: cashShare }, { label: /\bcrypto\b/i, value: cryptoShareA }];
  // round 8: "Tech makes up about 57% of assets" (it is ~97%)
  const TECH = new Set(["AI semiconductors", "AI infrastructure", "mega-cap platforms", "software", "consumer internet", "Nasdaq 100 index"]);
  const techShare = held.filter((r) => TECH.has(themeOf(r.symbol, r.kind))).reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / (assetsUsd || 1) * 100;
  guarded = fixGroupShares(guarded, [{ label: /\b(?:tech|technology)(?: stocks| names| holdings| exposure| share)?/i, value: techShare }]);
  answer = unicodeMinus(plainDataWords(tidyNumbers(digitsForWritten(withNoCallLine(dropInstructionEcho(fixFractions(ko ? guarded : fixArticles(plainScrub(guarded, PORTFOLIO_PLAIN)), fracHold, fracGroupsA)), question, lastA, prevQ, decisionQ)))));
  void softFallback;
  // the code-built answer is 4-5 checked bullets (~100 words with the opener): the phone cap must not cut its
  // last bullet, which is the one about what a buyer weighs
  answer = trimAnswer(answer, builtInCode ? 150 : cap + 10);
  const focus = (mentioned.length ? mentioned : held.slice(0, 1).map((r) => r.symbol)).map((s) => nameOf(held.find((h) => h.symbol === s)!));
  const fallbacks = ko ? [
    ...(focus[0] ? [`${focus[0]}을(를) 움직이는 요인은 뭔가요?`, `${focus[0]} 전망을 바꿀 변수는 뭔가요?`] : []),
    "내 포트폴리오는 얼마나 집중돼 있나요?", "내 포트폴리오의 가장 큰 위험은 뭔가요?",
  ] : [
    ...(focus[0] ? [`What's driving ${focus[0]} right now?`, `What would change the outlook for ${focus[0]}?`] : []),
    "How concentrated is my portfolio?", "What are the biggest risks in my portfolio?",
  ];
  // chips follow the question's language too
  const followups = cleanFollowups((parsedA?.followups ?? []).map(deDash).filter((f) => chipInLanguage(question, f)), fallbacks);
  return json({ ok: true, answer, followups, mentioned });
});
