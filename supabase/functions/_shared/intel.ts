// Pure, deterministic helpers shared by the intelligence functions (ask, daily-brief, insights-sync,
// warmup, news-sync, price-sync). No I/O here, so every rule is unit-tested in intel_test.ts.
// Each helper exists because a model got a number, a date or a framing wrong in production; the
// comment on each names the failure it closes.
import { CLOSE_MIN, HOL, TZ, type Mkt, zonedEpoch, zonedParts } from "./calendar.ts";
export { aliasesFor, centrality, decodeEntities, isJunkNews, newsRelevant, type NewsRow, publisherFor, titleKey, usableNews } from "./news_rules.ts";

// ---------------------------------------------------------------------------------------------
// Returns over a window
// ---------------------------------------------------------------------------------------------
export type Pt = { ts: string; price: number };

/** Session closes of `mkt` that fall strictly between two instants (weekends and listed holidays skipped).
 *  Counting stops once it passes `limit` (callers only ask "more than N?"). */
export function closesBetween(mkt: Mkt, fromMs: number, toMs: number, limit = Infinity): number {
  if (!(toMs > fromMs)) return 0;
  let n = 0;
  let ymd = zonedParts(new Date(fromMs), TZ[mkt]).ymd;
  for (let guard = 0; guard < 800; guard++) {
    const d = new Date(ymd + "T12:00:00Z");
    const close = zonedEpoch(ymd, CLOSE_MIN[mkt], TZ[mkt]);
    if (close >= toMs) break;
    const dow = d.getUTCDay();
    if (close > fromMs && dow >= 1 && dow <= 5 && !HOL[mkt].has(ymd) && ++n > limit) break;
    d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
  }
  return n;
}

/** Percent change over the trailing `days`, or null when the stored history cannot honestly answer it.
 *  The old version started the window at the FIRST point after the cutoff, so a symbol with 7 days of
 *  stored prices reported the same "+3.7%" for 1W and 1M (TSLA, 2026-09-25). Round 1 then accepted a first
 *  point up to 3.75 days late as "the start of the month", and AMZN (history from Aug 28) reported a 28-day
 *  -5.9% as its 1M; the real month was -3.7%. Now the base must sit on the window's start, measured in the
 *  holding's own trading sessions: a base BEFORE the start may be at most 2 session closes stale (a missing
 *  daily bar or two), and a base AFTER the start may skip at most 1 session close (the session in progress
 *  when the window opened). Crypto trades every day: 2 days before, 1 day after. `mkt` undefined = US. */
export function pctOver(history: Pt[], days: number, now = Date.now(), mkt?: Mkt | null): number | null {
  if (history.length < 2) return null;
  const cutoff = now - days * 86400000;
  let base: Pt | null = null;
  for (const h of history) { if (+new Date(h.ts) <= cutoff) base = h; else break; }
  const market = mkt === undefined ? "US" : mkt;
  if (base) {
    const at = +new Date(base.ts);
    const stale = market ? closesBetween(market, at, cutoff + 1, 2) > 2 : cutoff - at > 2 * 86400000;
    if (stale) return null;
  } else {
    const first = history[0], at = +new Date(first.ts);
    const late = market ? closesBetween(market, cutoff, at, 1) > 1 : at - cutoff > 86400000;
    if (!late) base = first;
  }
  const last = history[history.length - 1];
  if (!base || base === last || !(base.price > 0) || !(last.price > 0)) return null;
  return ((last.price / base.price) - 1) * 100;
}
export const NO_HISTORY = "not enough price history yet";
/** "+3.2%" / "-0.4%", or the explicit no-data phrase the model is told to repeat instead of improvising. */
export const pctText = (p: number | null): string => p === null ? NO_HISTORY : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;

// ---------------------------------------------------------------------------------------------
// Earnings dates
// ---------------------------------------------------------------------------------------------
/** A transcript is an EARNINGS CALL only when its title says so. Seeking Alpha's feed also carries
 *  conference appearances ("NVIDIA Presents at Goldman Sachs Communacopia + Technology Conference"), and
 *  treating that Sep 10 talk as the latest call moved Nvidia's "last report" from Aug 26 to Sep 10 and
 *  its next one to "around December 10" in every brief and in Ask (2026-09-24/25). */
export function isEarningsCallTitle(title: string): boolean {
  const t = String(title ?? "");
  if (/\b(presents?|presentation|fireside|investor day|analyst day|capital markets day|annual (?:general |shareholders?'? )?meeting|summit|forum|keynote)\b|\bconference\b(?!\s+call)/i.test(t)) return false;
  return /\bearnings\b|\b(results|quarterly)\s+(conference\s+)?call\b|\bQ[1-4]\s*(?:FY)?\s*'?\d{2,4}\b.*\b(call|transcript)\b/i.test(t);
}

export type FilingLite = { form: string; filed_at: string; items?: string | null };
export type TranscriptLite = { title: string; published_at: string | null };
export type EarningsSource = "8-K item 2.02" | "8-K with 10-Q/10-K" | "earnings call";
const ymdOf = (x: string) => String(x).slice(0, 10);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dayDiff = (a: string, b: string) => Math.round((+new Date(ymdOf(a) + "T12:00:00Z") - +new Date(ymdOf(b) + "T12:00:00Z")) / 86400000);

/** The date the company last REPORTED results, from the strongest evidence on file:
 *  1. an 8-K carrying item 2.02 (Results of Operations) is the earnings release itself;
 *  2. an 8-K filed on the day of, or up to 3 days before, a 10-Q/10-K is the same release (companies
 *     file both around the call; NVDA 8-K + 10-Q on Aug 26, MSFT 8-K + 10-K on Jul 29);
 *  3. an earnings-call transcript (never a conference talk), dated by publication.
 *  The fetch or publication date of anything else is NOT an earnings date. */
export function lastEarnings(filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string):
  { date: string; source: EarningsSource } | null {
  return reportDates(filings, transcripts, todayYmd)[0] ?? null;
}

/** Every past report on file, newest first, one per quarter (a release filed Aug 26 and its transcript posted
 *  Aug 27 are the same report: the filing date wins). */
export function reportDates(filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string): { date: string; source: EarningsSource }[] {
  const cands: { date: string; source: EarningsSource; rank: number }[] = [];
  const periodic = filings.filter((f) => /^10-[QK]/.test(f.form)).map((f) => ymdOf(f.filed_at));
  for (const f of filings) {
    if (!/^8-K/.test(f.form)) continue;
    const d = ymdOf(f.filed_at);
    if (/\b2\.02\b/.test(String(f.items ?? ""))) cands.push({ date: d, source: "8-K item 2.02", rank: 0 });
    else if (!f.items && periodic.some((p) => { const g = dayDiff(p, d); return g >= 0 && g <= 3; })) cands.push({ date: d, source: "8-K with 10-Q/10-K", rank: 1 });
  }
  for (const t of transcripts) if (t.published_at && isEarningsCallTitle(t.title)) cands.push({ date: ymdOf(t.published_at), source: "earnings call", rank: 2 });
  const past = cands.filter((c) => c.date <= todayYmd).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.rank - b.rank));
  const out: { date: string; source: EarningsSource }[] = [];
  const used = new Set<number>();
  for (let i = 0; i < past.length; i++) {
    if (used.has(i)) continue;
    const group = past.map((c, j) => ({ c, j })).filter(({ c, j }) => !used.has(j) && Math.abs(dayDiff(c.date, past[i].date)) <= 10);
    for (const g of group) used.add(g.j);
    const best = group.map((g) => g.c).sort((a, b) => a.rank - b.rank || (a.date < b.date ? 1 : -1))[0];
    out.push({ date: best.date, source: best.source });
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortDate = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "early / mid / late November": an estimate is spoken as a part of a month, never as a precise day. */
export const partOfMonth = (ymd: string): string => {
  const d = Number(ymd.slice(8, 10)), m = MONTHS[Number(ymd.slice(5, 7)) - 1];
  return `${d <= 10 ? "early" : d <= 20 ? "mid" : "late"} ${m}`;
};
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Next report estimate. Companies keep a yearly rhythm more than a 91-day one: Alphabet reported Q2 on Jul 22
 *  but reports Q3 in the last week of October (Oct 29, 2025), so "last + 91" said Oct 21 while every calendar
 *  said ~Oct 28. When the same quarter a year earlier is on file (a report 52 weeks before a date 8-18 weeks
 *  after the last one), the estimate is that report + 364 days (same weekday); otherwise last + 91 (13 weeks).
 *  When the date has just passed with nothing newer on file, the report is due, not a quarter away. */
export function nextEarningsEstimate(lastYmd: string, todayYmd: string, history: string[] = []): { est: string; due: boolean } {
  const yearAgo = history.map((d) => addDays(d, 364)).filter((d) => dayDiff(d, lastYmd) >= 56 && dayDiff(d, lastYmd) <= 126).sort()[0];
  let est = yearAgo ?? addDays(lastYmd, 91);
  if (est < todayYmd && dayDiff(todayYmd, est) <= 21) return { est, due: true };
  while (est < todayYmd) est = addDays(est, 91);
  return { est, due: false };
}

/** The last report and the next estimate from everything on file (null = nothing that dates a report). */
export function earningsEstimate(filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string): { last: string; source: EarningsSource; est: string; due: boolean } | null {
  const all = reportDates(filings, transcripts, todayYmd);
  if (!all.length) return null;
  const nx = nextEarningsEstimate(all[0].date, todayYmd, all.slice(1).map((r) => r.date));
  return { last: all[0].date, source: all[0].source, ...nx };
}

/** One line per holding for the NEXT EARNINGS block of every prompt: the real last report date and the
 *  labelled estimate. The "~Mon D (est)" token is kept so calendar items still pass the dated-item filter. */
export function earningsLine(name: string, filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string): string | null {
  const e = earningsEstimate(filings, transcripts, todayYmd);
  if (!e) return null;
  const when = e.due ? `due any day now (was expected ~${shortDate(e.est)} (est), not yet on file)`
    : `expected around ${partOfMonth(e.est)}, ~${shortDate(e.est)} (est, not confirmed)`;
  return `${name}: last reported ${shortDate(e.last)} (${e.source}); next report ${when}`;
}

const MON_IDX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** Calendar and watch items that put a holding's earnings (report, results, call) on a date away from the
 *  computed estimate. Caught 2026-09-25: a midday brief listed "Microsoft earnings call Sep 28" (it reports
 *  late October, ~Oct 28); the only earnings dates a brief may carry are the ones in its NEXT EARNINGS block.
 *  An item within 7 days of the estimate passes; an earnings date for a holding with no estimate is dropped. */
export function wrongEarningsDates(items: string[], ests: { names: string[]; est: string | null }[], todayYmd: string): string[] {
  const bad: string[] = [];
  for (const raw of items) {
    const t = String(raw ?? "");
    if (!/\b(earnings|results|reports?|reporting|quarterly|Q[1-4]|call|print)\b/i.test(t)) continue;
    const who = ests.find((e) => e.names.some((n) => n && new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, "iu").test(t)));
    if (!who) continue;
    const m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (!m) continue;
    if (!who.est) { bad.push(raw); continue; }
    const mo = MON_IDX[m[1].toLowerCase()], dd = Number(m[2]);
    const y = Number(todayYmd.slice(0, 4)) + (mo < Number(todayYmd.slice(5, 7)) - 2 ? 1 : 0);
    const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (Math.abs(dayDiff(ymd, who.est)) > 7) bad.push(raw);
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Advice guard (Ask, insights): information, never a trade instruction or a verdict on the user's own book
// ---------------------------------------------------------------------------------------------
const TRADE = "buy|sell|hold|add|trim|swap|rotate|reduce|increase|dump|exit|accumulate|take profits?|lock in|double down|average down|rebalance|redeploy|deploy|allocate|put|move|shift|cut|keep|stay";
// a sentence that OPENS with one of these is an instruction ("Add to NVDA next.", "Skip AVGO and AMZN");
// nouns that happen to share the spelling ("Buy ratings dominate", "Increase in revenue") are not
const IMPERATIVE = new RegExp("^(?:(?:in|for|with|inside) your [^,]{1,30},\\s*)?(?:buy|sell|hold|add|trim|swap|rotate|reduce|dump|exit|accumulate|take profits?|lock in|double down|average down|rebalance|redeploy|deploy|allocate|cut|keep|stay|skip|avoid|sell off|get out|load up|pile in|consider (?:buying|selling|adding|trimming|swapping|rotating|reducing|taking|moving))\\b"
  + "(?!\\s*(?:ratings?|side|case|signals?|-side|backs?|volume|orders?|in mind|an eye|aware|informed|tuned|the course of)\\b)", "i");
// a sentence may end inside bold or a quote ("**Add to NVDA next.** Your cash...")
// (a list number is not a sentence end: "1. MSFT" stays one line)
const sentencesOf = (t: string): string[] => String(t ?? "").split(/(?<=[.!?。](?:\*\*|["'”’)\]])?)(?<!(?:^|\n)[\s*•-]*\d{1,2}[.)])\s+(?=\S)|\n+/).map((s) => s.trim()).filter(Boolean);
const bare = (s: string) => s.replace(/^[\s•*\-–·\d.)]+/, "").replace(/\*\*/g, "").trim();

// A figure a reader can check: a multiple, a ratio against an average, a percentage over a named window.
const OBJECTIVE = /\b\d+(?:\.\d+)?x\b|\bP\/E\b|price-to-(?:earnings|sales|book)|\btimes (?:earnings|sales|book)\b|\b(?:above|below|versus|vs\.?)\s+(?:its|the|a)?\s*(?:\d+-year|five-year|ten-year|historical|long-run|sector|5y|10y)?\s*(?:average|median|norm)\b/i;
// Someone else's view, a condition or a question is information about the judgement, not the judgement.
const ATTRIBUTED = /\b(whether|if|unless|argues?|argued|says?|said|calls?|called|according to|analysts?|morningstar|the street|wall street|bulls?|bears?|critics|skeptics|some investors|rates? it|rated|sees?|debate|would|could|might|the case for|the case against)\b|(?:인지|여부|라면|따르면|분석가|평가합니다|볼 수도)/i;
/** A valuation CALL on a holding ("looks cheap", "undervalued", "good downside protection", "a buying
 *  opportunity"): a verdict dressed as analysis. Caught 2026-09-25 (round 2): "SK hynix price looks cheap,
 *  giving good downside protection for long term" and an AVGO card's "down 6.9% sets up well against
 *  Morningstar's $650 target". A checkable metric ("P/E is 25x vs its 5-year average of 30x"), someone else's
 *  attributed view, or a conditional ("whether it looks cheap depends on ...") stays allowed. */
export function valuationHits(text: string): string[] {
  const hits: string[] = [];
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    if (!s || ATTRIBUTED.test(s)) continue;
    const call = /\b(?:looks?|looking|seems?|appears?|is|are|remains?|stays?|trad(?:es|ing)|priced|now)\s+(?:\w+\s+){0,2}?(?:cheap|inexpensive|expensive|pricey|undervalued|overvalued|under-valued|over-valued|a bargain|a steal|attractive(?:ly priced)?|good value|great value|compelling value|a no-brainer)\b/i.test(s)
      || /\b(?:undervalued|overvalued|bargain|downside protection|good entry|attractive entry|entry point|buying opportunity|attractive (?:price|valuation|level|levels)|on sale|cheap (?:entry|shares|stock)|sets? up well|screams? (?:buy|value))\b/i.test(s)
      || /(저평가|고평가|싸\s?보|싼 편|비싸\s?보|매수\s?기회|저가\s?매수|하방\s?경직|하방\s?보호)/.test(s);
    if (call && !(OBJECTIVE.test(s) && !/\b(cheap|undervalued|overvalued|bargain|buying opportunity|downside protection)\b/i.test(s))) hits.push(raw);
  }
  return hits;
}

const METRIC_WINDOW = /%|\b(?:over|this|past|since|in|by|for)\b[^.]{0,24}\b(?:week|month|year|quarter|day|session|return|returns|performance|volatility|weight|size|value|yield|dividend)s?\b|\bby (?:return|performance|weight|size|value|volatility|yield)\b/i;
/** Answers to a "which should I keep / rank them best to worst to own / the one you'd dump" question that
 *  hand down the verdict anyway. Caught 2026-09-25 (round 2): "Top: MSFT, NVDA, AAPL, GOOGL ... Bottom: AVGO,
 *  TSLA, META" and "AVGO looks weakest ... Watch the $352 mark". A ranking by a stated metric over a stated
 *  window ("AMZN is the weakest over 1 month, down 5.9%") is information and stays. */
export function verdictRankHits(text: string): string[] {
  const hits: string[] = [];
  const lines = sentencesOf(text);
  const numbered = lines.filter((l) => /^\s*(?:#?\d{1,2}[.)]|#\d)\s+\**\s*[A-Z0-9가-힣]/.test(l) && !METRIC_WINDOW.test(l));
  for (const raw of lines) {
    const s = bare(raw);
    if (!s) continue;
    const label = /^(?:top|bottom|best|worst|strongest|weakest|keepers?|dump|sell|cut|buy|hold|own)(?:\s+[\w'-]+){0,3}\s*[:–-]\s*\S/i.test(s) && !METRIC_WINDOW.test(s);
    const superl = /\b(?:looks?|is|seems?|stands? out as|ranks? as|comes? (?:out )?as|would be|reads? as)\s+(?:the\s+)?(?:weakest|strongest|best|worst|riskiest|safest)\b/i.test(s) && !METRIC_WINDOW.test(s);
    const pick = /\b(?:the one (?:to|I'?d)|first to go|I'?d (?:dump|sell|cut|drop|ditch|keep|pick|choose|own)|my (?:pick|choice|favou?rite)|weakest link|(?:dump|sell|cut|ditch|drop|trim) (?:first|would be)|the (?:clear|obvious) (?:keeper|pick|loser|winner))\b/i.test(s)
      || /(제가 고른|제 선택|가장 먼저 팔|먼저 정리할|버릴 종목|최고의 선택)/.test(s);
    if (label || superl || pick || (numbered.length >= 3 && numbered.includes(raw))) hits.push(raw);
  }
  return hits;
}

/** Sentences (or bullets) that tell the reader what to do with their money, or pass a verdict on it. Caught
 *  2026-09-25 in Ask: "Verdict: hold", "Add to NVDA next. Your $120K cash sits idle", "Skip AVGO and AMZN",
 *  "In your 401k, swap QQQM to an international or bond fund"; round 2 added valuation calls ("looks cheap")
 *  and, when the question asked for one, rankings of what to keep or dump. Scenario and conditional framing
 *  stays allowed ("a sell case would rest on...", "adding would lift the weight to 25%"): that is information. */
export function adviceHits(text: string, opts: { verdictQuestion?: boolean } = {}): string[] {
  const hits = new Set<string>();
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    if (!s) continue;
    const verdict = /\b(verdict|recommendation|my (?:pick|call|take)|bottom line|action)\s*:\s*(?:\*\*)?\s*(buy|sell|hold|add|trim|keep|accumulate|avoid|skip|swap|reduce|dump)\b/i.test(s);
    const imperative = IMPERATIVE.test(s);
    const second = new RegExp(`\\byou (?:should|must|need to|ought to|might want to|may want to|could consider|'d be wise to)\\s+(?:consider\\s+)?(?:${TRADE}|buying|selling|adding|trimming|swapping|taking)\\b`, "i").test(s);
    const first = new RegExp(`\\b(?:i(?:'d| would)|i recommend|i suggest|we recommend|i'm a)\\s+(?:be\\s+)?(?:${TRADE}|buying|selling|adding|trimming|a buyer|a seller)\\b`, "i").test(s);
    const rating = /\b(?:is|as|looks like|rate it)\s+an?\s+(?:strong\s+|clear\s+)?(buy|sell)\b(?!\s+(?:case|signal|side|rating|-side))|\b(?:top|best)\s+(?:pick|buy|add)\b|\bnow is (?:a|the) (?:good|great|right) (?:time|moment|entry) to\b/i.test(s);
    const korean = /(매수하세요|매도하세요|사세요|파세요|정리하세요|사는 게 좋|파는 게 좋|팔아야 합니다|사야 합니다|추천합니다|추천드립니다)/.test(s);
    if (verdict || imperative || second || first || rating || korean) hits.add(raw);
  }
  for (const v of valuationHits(text)) hits.add(v);
  if (opts.verdictQuestion) for (const v of verdictRankHits(text)) hits.add(v);
  return sentencesOf(text).filter((s) => hits.has(s));
}
/** Delete the offending sentences (deletion only: the figure-integrity rule of the brief scrubs). */
export function stripAdvice(text: string, opts: { verdictQuestion?: boolean } = {}): string {
  const bad = new Set(adviceHits(text, opts));
  if (!bad.size) return text;
  return String(text).split("\n").map((line) => {
    const parts = sentencesOf(line);
    if (!parts.length) return line;
    const kept = parts.filter((p) => !bad.has(p));
    if (kept.length === parts.length) return line;
    if (!kept.length) return null;
    const lead = line.match(/^[\s•\-–·]+/)?.[0] ?? "";
    return lead + kept.map(bare).join(" ");
  }).filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// What a ranking is BY: a question that names one wants information, not a verdict.
const QUESTION_METRIC = /\b(returns?|perform\w*|gain\w*|loss(?:es)?|size|sizes|weights?|weighting|value|volatil\w*|risk\w*|dividends?|yields?|price|market cap|p\/e|valuation|growth|revenue|earnings|percent|ytd|today|week|month|year|quarter|1[dwmy])\b|%/i;
const TRADE_VERB = "keep|dump|sell|buy|add|trim|cut|ditch|drop|own|hold|get rid of|exit|unload|offload|bet on";
/** A question that asks what to trade or which holding "wins", in any phrasing. Round 1 caught "should I sell
 *  NVDA"; round 2 found the indirect ones still got a verdict: "rank my holdings from best to worst to own",
 *  "what's the one stock you'd dump", "what would you do if you were me", "which should I keep", "top pick",
 *  "sell or hold", and Korean "팔까요 / 사도 될까요 / 정리할까요 / 추천해줘". A ranking by a named metric ("rank my
 *  holdings by 1-month return") is a data question and is NOT one of these. */
export function isTradeQuestion(q: string): boolean {
  const t = String(q ?? "");
  return /\b(should|shall|do|would|must)\s+(i|we)\s+(?:still\s+|just\s+|really\s+)?(buy|sell|hold|add|trim|keep|dump|exit|get out|get rid of|take profits?|swap|rotate|double down|average down|cut|load up|rebalance|move|invest|put|ditch|unload)\b/i.test(t)
    || /\b(buy|sell|hold|add|trim|keep|dump)\s*(?:it\s+)?(or|\/)\s*(buy|sell|hold|add|trim|wait|keep|dump)\b/i.test(t)
    || /\b(is|it's)\s+(it|now|this)\s+(a\s+)?(good|right|bad|smart)\s+(time|moment|idea)\s+to\s+(buy|sell|add|trim)\b/i.test(t)
    || /\btime to (buy|sell|take profits?|get out|trim|add|cash out)\b|\bbuy the dip\b/i.test(t)
    || /\bhow much\b[^?]{0,40}\b(buy|sell|add|put|invest|allocate)\b/i.test(t)
    || new RegExp(`\\bwhich\\b[^?]{0,50}\\b(?:should|would|do|to)\\s+(?:i\\s+|you\\s+|we\\s+)?(?:\\w+\\s+)?(${TRADE_VERB})\\b`, "i").test(t)
    || /\bworth (buying|selling|adding|keeping|holding|owning)\b/i.test(t)
    || new RegExp(`\\byou'?d\\s+(?:\\w+\\s+)?(${TRADE_VERB}|pick|choose)\\b|\\bwould you\\s+(?:\\w+\\s+)?(${TRADE_VERB}|pick|choose|do)\\b`, "i").test(t)
    || /\bif (?:you were|i were) (?:me|you)\b|\bin my shoes\b|\bwhat would you do\b|\bwhat do you (?:recommend|suggest)\b|\bwhat (?:should|would) (?:i|you) (?:do|buy|sell)\b/i.test(t)
    || /\b(?:top|best) (?:pick|picks|buy|idea)\b|\byour (?:pick|favou?rite)\b/i.test(t)
    || new RegExp(`\\b(?:one|stock|stocks|holding|holdings|position|name|names)\\s+(?:to|i should|i'd)\\s+(${TRADE_VERB})\\b`, "i").test(t)
    || /\b(?:is|are)\s+\S+(?:\s+\S+)?\s+(?:a|still a)\s+(buy|sell|hold)\b/i.test(t)
    || /\bwhere (?:would|should) (?:my|the|this|i|it)\b[^?]{0,40}\b(go|put|invest|deploy)\b/i.test(t)
    || /\b(?:best|worst|strongest|weakest)\b[^?]{0,20}\bto (?:own|hold|keep|buy|sell|dump)\b/i.test(t)
    || (/\b(?:rank|order|sort|list|grade|rate)\b[^?]{0,60}\b(?:best|worst|strongest|weakest|keep|dump|sell|own|hold|buy)\b/i.test(t) && !QUESTION_METRIC.test(t))
    || /(사야|팔아야|매수해야|매도해야|살까|팔까|사도 될까|팔아도 될까|추가 매수|정리할까|정리해야|정리하는 게|정리하는 것이|손절|익절|추천해|추천 좀|추천할|추천 종목|종목 추천|뭘 사|뭘 팔|뭐 사|뭐 팔|무엇을 사|무엇을 팔|어떤 (?:종목|주식)을? (?:사|팔|정리|버리)|당신이라면|너라면|제 입장이라면|저라면 어떻게|어떻게 하시겠|어떻게 할래|들고 가야|계속 보유해야|보유해야 할까|보유할까|비중을 (?:늘려|줄여)|늘려야 할까|줄여야 할까|버려야|버릴까)/.test(t);
}

const NO_CALL = /\b(can'?t|cannot|won'?t|don'?t|isn'?t (?:mine|my place))\b[^.]{0,40}\b(tell you|say|make|pick|decide|call|recommend|rank)\b|\b(not|isn'?t) my call\b|\byour call\b|\bthat's your decision\b|제가 (정해|결정)|(말씀|정해|골라|추천해)\s?드릴 수 없|판단은[^.]{0,20}몫|결정은[^.]{0,20}몫/i;
/** A "should I sell X" answer opens with ONE short, natural line that the decision is theirs, then gives
 *  the considerations. Added in code when the model left it out, and never twice in a row: round 2 found the
 *  same canned opener on six answers in one conversation, which read robotic. */
export function withNoCallLine(answer: string, question: string, previousAnswer = ""): string {
  if (!isTradeQuestion(question) || NO_CALL.test(answer) || NO_CALL.test(previousAnswer)) return answer;
  return (hasHangul(question) ? "매매 여부는 제가 정해드릴 수 없지만, 판단의 근거는 이렇습니다." : "I can't tell you whether to trade it, but here's what the decision rests on.") + "\n" + answer;
}
/** Follow-up chips ask why / what / how, never "should I buy/sell/add". Caught: "Should I add to Meta on
 *  this dip?", "How much NVDA should I buy with the cash?", "Which holding should I add to next?". Round 2:
 *  a chip in the wrong person ("How exposed are you to NVIDIA?") and one assuming a goal the user never set
 *  ("How does my 6.7% monthly return compare to my yearly target?"). */
export function isTradeFollowup(f: string): boolean {
  return isTradeQuestion(f) || /^\s*(should|shall)\s+(i|we)\b/i.test(f) || /\bshould\s+(i|we)\b/i.test(f)
    || /\b(which|what)\b[^?]{0,40}\b(to|should)\s+(buy|sell|add|trim)\b/i.test(f)
    || /\b(time to|good entry|entry point|when to)\s+(buy|sell|add|trim|take)\b/i.test(f)
    || valuationHits(f).length > 0;
}
const badChip = (f: string) => /\b(?:are|were|do|did|have) you\b|\byou(?:'re| are)\b|\byour (?:portfolio|book|holdings?|stake|position|exposure)\b/i.test(f)
  || /\b(?:yearly|annual|return|income)\s+(?:target|goal)\b|\bmy (?:target|goal)\b/i.test(f);
export function cleanFollowups(list: string[], fallbacks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...list, ...fallbacks]) {
    const t = String(f ?? "").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k) || isTradeFollowup(t) || badChip(t)) continue;
    seen.add(k); out.push(/[?？]$/.test(t) ? t : t + "?");
    if (out.length >= 3) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Language: a Korean question gets a Korean answer
// ---------------------------------------------------------------------------------------------
export const hasHangul = (s: string): boolean => /[가-힣]/.test(String(s ?? ""));
/** Share of the answer's words written in Korean. Tickers, numbers and short brand acronyms are neutral
 *  (a Korean answer still writes "NVDA", "AI", "$224"). */
export function hangulShare(text: string): number {
  let ko = 0, en = 0;
  for (const w of String(text ?? "").replace(/\*\*/g, " ").split(/\s+/)) {
    if (/[가-힣]/.test(w)) ko++;
    else if (/[A-Za-z]{2,}/.test(w) && !/^[^A-Za-z]*[A-Z0-9&.$-]{1,6}[^A-Za-z]*$/.test(w)) en++;
  }
  return ko + en === 0 ? 1 : ko / (ko + en);
}
/** Round 2: "테슬라 팔까요?" came back entirely in English, because the prompt's example opener was English and
 *  the model copied its language. A Korean question needs a Korean-majority answer. */
export const wrongLanguage = (question: string, answer: string): boolean => hasHangul(question) && hangulShare(answer) < 0.5;

// ---------------------------------------------------------------------------------------------
// Share price vs position value
// ---------------------------------------------------------------------------------------------
export type PosFact = { names: string[]; price: number | null; value: number | null };
const PRICE_CTX = /\b(price[sd]?|trad(?:es|ed|ing)|clos(?:e|ed|es|ing)|sits?|sat|near|around|hit|reached|opened|quoted?|per share|a share|shares? (?:at|of)|stock (?:at|is|was)|at)\s*$/i;
// a thousands comma must be followed by three digits: "$264,526," ends at the 6, not at the clause comma
const moneyRe = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?[kKmM]\b)?/g;
const moneyVal = (num: string, suf?: string) => Number(num.replace(/,/g, "")) * (/k/i.test(suf ?? "") ? 1e3 : /m/i.test(suf ?? "") ? 1e6 : 1);
const near = (a: number, b: number, tol: number) => b > 0 && Math.abs(a / b - 1) <= tol;
/** "$X" quoted AS A SHARE PRICE where X is really the position value. Caught 2026-09-25: Ask said "TSLA
 *  closed yesterday near $264,526" (the position; the close was $377.94) and a new user's first insight
 *  said "NVDA sits near $112" (their 0.5-share position; NVDA traded at $224). */
export function priceConfusions(text: string, positions: PosFact[]): { match: string; index: number; pos: PosFact }[] {
  const out: { match: string; index: number; pos: PosFact }[] = [];
  const s = String(text ?? "");
  for (const m of s.matchAll(moneyRe)) {
    const v = moneyVal(m[1], m[2]);
    const idx = m.index ?? 0;
    const before = s.slice(Math.max(0, idx - 70), idx);
    const after = s.slice(idx + m[0].length, idx + m[0].length + 14);
    if (!PRICE_CTX.test(before) && !/^\s*(a|per)\s+share\b/i.test(after)) continue;
    // "your NVDA stake at $112" IS the position value: only a figure framed as the stock's price is suspect
    if (/\b(stake|position|holding|worth|valued?|invested|allocation|slice|bag|exposure)\b[^.$]{0,25}$/i.test(before)) continue;
    for (const p of positions) {
      if (!p.value || !p.price || near(v, p.price, 0.08) || !near(v, p.value, 0.02)) continue;
      if (!p.names.some((n) => n && before.toLowerCase().includes(n.toLowerCase()))) continue;
      out.push({ match: m[0], index: idx, pos: p });
      break;
    }
  }
  return out;
}
const fmtPrice = (p: number) => "$" + (p >= 1000 ? Math.round(p).toLocaleString("en-US") : p.toFixed(2));
/** Replace each confused figure with the verified share price from the same data block the model was
 *  given (a correction from ground truth, not an invented figure). */
export function fixPriceConfusions(text: string, positions: PosFact[]): string {
  const hits = priceConfusions(text, positions);
  let out = String(text ?? "");
  for (const h of hits.sort((a, b) => b.index - a.index)) out = out.slice(0, h.index) + fmtPrice(h.pos.price!) + out.slice(h.index + h.match.length);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Currency: ₩ only for books that hold something Korean
// ---------------------------------------------------------------------------------------------
/** A USD-only book never sees won. Caught 2026-09-25: Ask answered a follow-up on a US-only account with
 *  "adding roughly ₩141 million", because every prompt carried a ₩ FX line and a "write won with ₩" rule. */
export function booksKorean(rows: { symbol: string; currency?: string | null }[], profile?: { base_currency?: string | null; display_kr?: string | null } | null): boolean {
  if (rows.some((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ") || r.currency === "KRW")) return true;
  return profile?.base_currency === "KRW";
}

// ---------------------------------------------------------------------------------------------
// Beginner vocabulary map: idempotent glossing
// ---------------------------------------------------------------------------------------------
/** Apply a plain-language map WITHOUT doubling a gloss the model already wrote. Caught 2026-09-25: the
 *  model wrote "VIX, the market's fear gauge, fell 3.3%"; mapping VIX produced "The market's fear gauge,
 *  the market's fear gauge, fell 3.3%". An appositive ("TERM, gloss," / "TERM (gloss)" / "gloss (TERM)")
 *  collapses into the gloss alone; a final pass removes any immediate repeat of a phrase. Running the
 *  scrub twice gives the same text as running it once. */
export function plainScrub(t: string, map: [RegExp, string][]): string {
  let x = String(t ?? "");
  for (const [re, plain] of map) {
    if (!plain.includes("$")) {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      const fi = flags.includes("i") ? flags : flags + "i";
      // keep the case of the first letter the reader saw ("The VIX, the market's fear gauge," opens a sentence)
      // the gloss keeps the model's own casing, capitalised only where it now opens a sentence
      const keepCase = (g: string, before: string) => (/(?:^|[.!?]["')\]]?\s+|["\n]\s*)$/.test(before) ? g.charAt(0).toUpperCase() + g.slice(1) : g);
      // (a named group: the map's own pattern may carry numbered groups of its own)
      x = x.replace(new RegExp(`(?:\\b(?:the|a|an)\\s+)?(?:${re.source})\\s*(?:,\\s*|\\(\\s*|\\s[-–—]\\s)(?<gloss>${esc(plain)})\\s*(?:\\)|,(?=\\s)|\\s[-–—](?=\\s))?`, fi),
        (...a: unknown[]) => keepCase(String((a[a.length - 1] as { gloss: string }).gloss), String(a[a.length - 2]).slice(0, Number(a[a.length - 3]))));
      x = x.replace(new RegExp(`(${esc(plain)})\\s*\\(\\s*(?:${re.source})\\s*\\)`, fi), "$1");
    }
    x = x.replace(re, plain);
  }
  return dedupePhrases(x);
}
/** "the market's fear gauge, the market's fear gauge," -> "the market's fear gauge,"; "the the" -> "the". */
export function dedupePhrases(t: string): string {
  let x = String(t ?? "");
  let prev = "";
  while (prev !== x) {
    prev = x;
    // a phrase of 2+ words repeated back to back, as an appositive or a parenthesis
    x = x.replace(/(?<![\p{L}\p{N}])([\p{L}][\p{L}\p{N}'’-]*(?: [\p{L}\p{N}'’-]+){1,7})(?:,\s+|\s+\(|\s+)\1(?![\p{L}\p{N}])\)?/giu, "$1");
  }
  // an article stranded in front of a replacement that starts with its own ("the VIX" -> "the the ...")
  return x.replace(/\b(the|a|an|The|A|An) the\b/g, (_m, a: string) => (/^[A-Z]/.test(a) ? "The" : "the"));
}

// ---------------------------------------------------------------------------------------------
// Session wording guards (brief post-processing; deletion or relabelling only, never a new figure)
// ---------------------------------------------------------------------------------------------
/** In a brief written while the US market is open, a sentence that names a US holding together with ITS
 *  live day move and calls it "yesterday" is mislabelled: the figure is today's. Caught 2026-09-25: "Your
 *  Microsoft stake jumped 3.7% yesterday" when Microsoft had fallen 0.5% yesterday and was up 3.7% live.
 *  Only a sentence carrying the exact live figure is touched, so a real reference to yesterday survives. */
export function liveNotYesterday(text: string, live: { names: string[]; pct: number }[]): string {
  return String(text ?? "").split(/(?<=[.!?])\s+/).map((sent) => {
    if (!/\byesterday\b/i.test(sent)) return sent;
    const figs = [...sent.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
    const hit = live.some((m) => m.names.some((n) => n && new RegExp(`(^|[^\\p{L}])${esc(n)}`, "iu").test(sent))
      && figs.some((f) => Math.abs(f - Math.abs(Number(m.pct.toFixed(1)))) < 0.051));
    return hit ? sent.replace(/\byesterday's\b/gi, (w) => (w[0] === "Y" ? "Today's" : "today's")).replace(/\byesterday\b/gi, (w) => (w[0] === "Y" ? "So far today" : "so far today")) : sent;
  }).join(" ");
}
/** "hits your Microsoft and Amazon directly": a causal link no headline supports. Drop the intensifier. */
export const deDirect = (t: string): string => String(t ?? "")
  .replace(/\b((?:hits?|hurts?|helps?|lifts?|weighs? on|drags? on|affects?|touch(?:es)?|threatens?|boosts?|pressures?)\b[^.;]{1,70}?)\s+directly\b/gi, "$1")
  .replace(/\bdirectly\s+((?:hits?|hurts?|helps?|lifts?|affects?|threatens?|boosts?|pressures?)\b)/gi, "$1");

// ---------------------------------------------------------------------------------------------
// Prompt rules shared by every writer
// ---------------------------------------------------------------------------------------------
/** Attribution and evidence rules for any prompt fed headlines. Caught 2026-09-25: the brief turned an
 *  industry-wide "$200 billion in data center shut downs" headline into "Oracle's $200 billion data center
 *  cut hits your Microsoft and Amazon directly"; an insight quoted a Moomoo user's 32-share trade. */
export const EVIDENCE_LAW = `EVIDENCE LAW: a figure belongs to whoever the headline gives it to. An industry-wide or market-wide figure (sector spending, "$200 billion in data-center projects") is never attributed to one company, and a company's figure never to another. Never say a story "hits" or "helps" a holding "directly" unless a headline names that holding. A single person's post, trade or price target from a social site or forum is not evidence of anything; ignore it. Quote-page and option-chain entries are not news.`;

// ---------------------------------------------------------------------------------------------
// Live-number checks for model-written takes (per-symbol cards, portfolio intelligence, warmup)
// ---------------------------------------------------------------------------------------------
/** What a take may say about a holding right now: its names, its session day move (%), its live share price. */
export type LiveFact = { names: string[]; pct: number | null; price?: number | null };
const nameIn = (s: string, n: string) => !!n && (/^[A-Z0-9.]{1,6}$/.test(n)
  ? new RegExp(`(?:^|[^A-Za-z0-9])\\$?${esc(n)}(?=$|[^A-Za-z0-9])`).test(s)
  : new RegExp(`(?:^|[^\\p{L}])${esc(n)}(?=$|[^\\p{L}])`, "iu").test(s));
const firstIdx = (s: string, names: string[]) => Math.min(...names.map((n) => {
  if (!n) return Infinity;
  const m = s.match(/^[A-Z0-9.]{1,6}$/.test(n) ? new RegExp(`(?:^|[^A-Za-z0-9])\\$?${esc(n)}(?=$|[^A-Za-z0-9])`) : new RegExp(`(?:^|[^\\p{L}])${esc(n)}(?=$|[^\\p{L}])`, "iu"));
  return m?.index ?? Infinity;
}));
const NEG_MOVE = /^(down|fell|falls|falling|lost|loses|losing|slipped|slips|slid|slides|dropped|drops|dropping|sank|sinks|shed|sheds|declined|declines|dipped|dips|edged down|edged lower|lower|off|tumbled|tumbles|plunged|plunges|drop|decline|fall|slide|loss|dip|slump|selloff|sell-off)$/i;
const MOVE_FWD = /\b(up|down|rose|rises|rising|fell|falls|falling|gained|gains|gaining|lost|loses|losing|slipped|slips|slid|slides|dropped|drops|dropping|climbed|climbs|jumped|jumps|sank|sinks|added|adds|shed|sheds|rallied|rallies|declined|declines|dipped|dips|edged (?:up|down|higher|lower)|higher|lower|off|advanced|surged|surges|tumbled|tumbles|plunged|plunges|popped|pops)\s+(?:by\s+|about\s+|nearly\s+|roughly\s+|almost\s+|another\s+)?(\d+(?:\.\d+)?)\s?%/gi;
const MOVE_REV = /\b(\d+(?:\.\d+)?)\s?%\s+(gain|rise|jump|pop|rally|climb|advance|drop|decline|fall|slide|loss|dip|slump|selloff|sell-off)\b/gi;
// a figure qualified by a window, a fundamental or a previous session is not today's move
const NOT_TODAY = /\b(weeks?|weekly|months?|monthly|years?|yearly|annual|annually|quarters?|quarterly|YTD|since|over the|past|\d+-day|two-month|decade|all-time|from (?:its|the) (?:high|peak|low)|(?:below|off) (?:its|the) (?:high|peak)|record|drawdown|target|upside|downside|expected|forecast|guidance|revenue|sales|earnings|margins?|growth|share of|of assets|weight|stake|yields?|dividends?|rates?|inflation|index|yesterday|last session|overnight|premarket|pre-market|after-hours|(?:mon|tues|wednes|thurs|fri|satur|sun)day's|in (?:mon|tues|wednes|thurs|fri)day)\b/i;
/** Sentences that state a holding's move as today's with a figure that is not its live session move.
 *  Caught 2026-09-25 (round 2): a VOO card said "VOO down 0.6% on GOOG drag" while VOO was +0.45% and never
 *  traded below its prior close. A sentence that qualifies its figure (a window, a fundamental, yesterday)
 *  is left alone; with one fact (a per-symbol card) an unnamed subject means that holding. */
export function dayMoveMismatches(text: string, facts: LiveFact[], tolPp = 0.35): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    if (!s || NOT_TODAY.test(s)) continue;
    const moves: { idx: number; val: number }[] = [];
    for (const m of s.matchAll(MOVE_FWD)) moves.push({ idx: m.index ?? 0, val: Number(m[2]) * (NEG_MOVE.test(m[1].split(/\s+/).pop()!) || /\bdown\b|\blower\b/i.test(m[1]) ? -1 : 1) });
    for (const m of s.matchAll(MOVE_REV)) moves.push({ idx: m.index ?? 0, val: Number(m[1]) * (NEG_MOVE.test(m[2]) ? -1 : 1) });
    if (!moves.length) continue;
    for (const mv of moves) {
      // the holding the figure belongs to: the nearest one named before it, else the only one there is
      const named = facts.map((f) => ({ f, at: firstIdx(s, f.names) })).filter((x) => x.at <= mv.idx).sort((a, b) => b.at - a.at)[0]?.f
        ?? (facts.length === 1 ? facts[0] : undefined);
      if (!named || named.pct === null || !Number.isFinite(named.pct)) continue;
      const live = named.pct;
      const wrongSign = Math.abs(live) >= 0.1 && Math.abs(mv.val) >= 0.1 && Math.sign(live) !== Math.sign(mv.val);
      if (wrongSign || Math.abs(Math.abs(mv.val) - Math.abs(live)) > tolPp) { bad.push(raw); break; }
    }
  }
  return bad;
}

const moneyAll = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?[kKmMbBtT](?:illion|n)?\b)?/g;
const CUR_CTX = /\b(?:trad(?:es|ing|ed)|sits?|sitting|hover(?:s|ing)?|range-?bound|priced|changing hands|parked|now|currently|stuck|holding|near|around|at)\s+(?:at\s+|near\s+|around\s+|about\s+|roughly\s+|close to\s+|~\s*)?$/i;
const LEVEL_CTX = /\b(support|resistance|targets?|floor|ceiling|highs?|lows?|levels?|mark|peak|top|bottom|break(?:s|out)?|tests?|strike|entry|stop|from|toward|towards|above|below|under|over|since|record|fair value|valuation|worth|cap|capitali[sz]ation|revenue|sales|options?|calls?|puts?|expiry|buyback|raise|deal|stake|position|investment|invest|plan|fund|goal|price target)\b[^$]{0,30}$/i;
/** A "$X" stated as where the holding trades now, more than `tol` away from its live price. Caught 2026-09-25
 *  (round 2): "BTC range-bound near $78K" with Bitcoin at $83.7K (the same card also said "stuck below $85K",
 *  a level, which stays). Levels, targets, market caps and deal sizes are not current-price claims. */
export function levelMismatches(text: string, facts: LiveFact[], tol = 0.06): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    for (const m of s.matchAll(moneyAll)) {
      const suf = (m[2] ?? "").trim().toLowerCase();
      if (/^[bt]/.test(suf)) continue;   // $15.6B, $1.5T: sizes, never a share price
      const v = moneyVal(m[1], suf.startsWith("m") ? "m" : suf.startsWith("k") ? "k" : "");
      const idx = m.index ?? 0;
      const before = s.slice(Math.max(0, idx - 40), idx);
      if (!CUR_CTX.test(before) || LEVEL_CTX.test(before)) continue;
      const named = facts.map((f) => ({ f, at: firstIdx(s, f.names) })).filter((x) => x.at <= idx).sort((a, b) => b.at - a.at)[0]?.f
        ?? (facts.length === 1 ? facts[0] : undefined);
      const px = named?.price;
      if (!px || !(px > 0)) continue;
      if (Math.abs(v / px - 1) > tol) { bad.push(raw); break; }
    }
  }
  return bad;
}

/** Which holdings a line of text is about (tickers as tickers, names as proper nouns). Portfolio intelligence
 *  stores this per bullet so a bullet about a holding the user has since removed can be hidden (round 2: the
 *  card led with "Pepsi near yearly lows" four minutes after PEP was removed). */
export function mentionedSymbols(text: string, book: { symbol: string; names: string[] }[]): string[] {
  const s = String(text ?? "");
  return book.filter((b) => b.names.some((n) => n && n.length >= 2 && nameIn(s, n))).map((b) => b.symbol);
}

// ---------------------------------------------------------------------------------------------
// Copy fixes applied after generation (no new facts, only grammar and repetition)
// ---------------------------------------------------------------------------------------------
const AN_LETTERS = /^[AEFHILMNORSX]/;
const vowelSound = (w: string): boolean => {
  const x = w.replace(/^[*"'“‘(]+/, "");
  if (/^\d/.test(x)) return /^8/.test(x) || /^1[18](?!\d)/.test(x);
  const caps = x.match(/^[A-Z][A-Z0-9&.]*/)?.[0] ?? "";
  if (caps.replace(/[^A-Z]/g, "").length >= 2 && !/^[a-z]/.test(x.slice(caps.length))) return AN_LETTERS.test(x);   // acronyms are spelled out: "an S&P fund", "a TSMC order", "a US-listed fund"
  const l = x.toLowerCase();
  if (/^(uni|use|usu|uti|ure|uro|eu|ewe|one\b|once|ubiq|u\.s|ukr|uganda)/.test(l)) return false;
  if (/^(hour|honest|honou?r|heir)/.test(l)) return true;
  return /^[aeiou]/.test(l);
};
/** "A ultra-concentrated book" -> "An ultra-concentrated book"; "an S&P fund" stays; "an US listing" -> "a US". */
export function fixArticles(t: string): string {
  return String(t ?? "").replace(/\b(a|A|an|An)(\s+)(\**["'“‘(]?[A-Za-z0-9][\w&.'’-]*)/g, (m, art: string, sp: string, word: string, at: number, all: string) => {
    // a capital "A" mid-sentence is a letter, not an article ("Class A shares", "Series A")
    if (/^A/.test(art) && !/(?:^|[.!?:]\s+|\n\s*|["“(]\s*|\*\*\s*)$/.test(all.slice(0, at))) return m;
    const want = vowelSound(word) ? "an" : "a";
    if (art.toLowerCase() === want) return m;
    return (art[0] === "A" ? want[0].toUpperCase() + want.slice(1) : want) + sp + word;
  });
}
const tokensOf = (t: string) => new Set(String(t ?? "").toLowerCase().match(/[a-z0-9][a-z0-9.%$-]{2,}|\d+(?:\.\d+)?%?/g) ?? []);
/** Word overlap of two short texts (0..1). */
export function overlap(a: string, b: string): number {
  const A = tokensOf(a), B = tokensOf(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
/** A quality note whose risk sentence repeats the tripwire printed right under it ("Risk: top-ten holdings
 *  exceed 35% ... Tripwire: Top-ten holdings exceed 35%", round 2) loses the repeat; the tripwire stays. */
export function dropEcho(note: string, watch: string): string {
  const w = String(watch ?? "");
  if (tokensOf(w).size < 3) return note;
  const parts = String(note ?? "").split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return note;
  const kept = parts.filter((p, i) => i === 0 || overlap(p.replace(/^(?:the\s+)?risk:\s*/i, ""), w) < 0.7);
  return kept.join(" ");
}

/** An idea that pushes an income or bond product at a reader whose lens is growth / AI / crypto. Round 2: a
 *  Growth + AI + Crypto newcomer's assessment suggested a "dividend-focused fund" and a "short-term bond fund
 *  to reduce overall volatility". A missing asset class may still be named as a diversification FACT ("no bond
 *  or international exposure"). */
export function offLensIdea(idea: string, styles: string[]): boolean {
  if (styles.some((s) => s === "income" || s === "value" || s === "index")) return false;
  const t = String(idea ?? "");
  if (!/\b(dividend|income|bonds?|treasur(?:y|ies)|fixed[- ]income|annuit(?:y|ies)|money[- ]market|high[- ]yield|CDs?)\b/i.test(t)) return false;
  return !/\b(no|zero|without|lacks?|missing|none|absent|nothing in)\b/i.test(t);
}
