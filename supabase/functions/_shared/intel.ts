// Pure, deterministic helpers shared by the intelligence functions (ask, daily-brief, insights-sync,
// warmup, news-sync, price-sync). No I/O here, so every rule is unit-tested in intel_test.ts.
// Each helper exists because a model got a number, a date or a framing wrong in production; the
// comment on each names the failure it closes.
import { CLOSE_MIN, HOL, OPEN_MIN, TZ, type Mkt, zonedEpoch, zonedParts, isTradingDay, prevTradingDay } from "./calendar.ts";
import { decodeEntities } from "./news_rules.ts";
export { aliasesFor, centrality, decodeEntities, isJunkNews, newsRelevant, type NewsRow, publisherFor, staleRedated, titleKey, urlDate, usableNews } from "./news_rules.ts";

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

/** The calendar date a window starts on, in the market's own zone: 1M is the same day last month (Sep 25 ->
 *  Aug 25), 3M three months back, 1Y / 2Y the same date one / two years back, and any other length (1W, 60d
 *  in insights) that many days back. A day that does not exist (Mar 31 minus a month) falls to the month's end. */
/** The window key for "year to date" (pass it where a number of days goes). */
export const YTD = -1;
export function windowTargetYmd(days: number, now = Date.now(), mkt?: Mkt | null): string {
  const market = mkt === undefined ? "US" : mkt;
  const ymd = market ? marketToday(market, now) : new Date(now).toISOString().slice(0, 10);
  const months = ({ 30: 1, 60: 2, 90: 3, 180: 6, 365: 12, 730: 24 } as Record<number, number>)[days];
  const [y, m, d] = ymd.split("-").map(Number);
  if (days === YTD) return `${y - 1}-12-31`;   // year to date: the base is the prior year's last close
  if (!months) { const t = new Date(Date.UTC(y, m - 1, d - days)); return t.toISOString().slice(0, 10); }
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
}
/** The market's current day: its zone's date once that day's session has opened, else the LAST TRADING SESSION.
 *  A US afternoon is already the next morning in Seoul; counting Samsung's 1Y from that Seoul date based it on a close
 *  one day later (+242.7% instead of +231.6%, round 4). Round 9 poweruser: the old fallback was the CALENDAR day
 *  before, so at 9:00 KST on a Saturday (00:00 UTC) or a KRX holiday "today" became that non-trading date and every
 *  1M-2Y window slid a day with no trading at all (Samsung 1Y +231.59% -> +242.74%). Windows now end at the last
 *  session and hold still through weekends and holidays. */
export function marketToday(mkt: Mkt, now = Date.now()): string {
  const z = zonedParts(new Date(now), TZ[mkt]);
  if (isTradingDay(mkt, z.ymd) && z.minutes >= OPEN_MIN[mkt]) return z.ymd;
  return prevTradingDay(mkt, z.ymd);
}
/** The last instant that still belongs to the window's target date (its end, in the market's zone). */
export function windowCutoff(days: number, now = Date.now(), mkt?: Mkt | null): number {
  const market = mkt === undefined ? "US" : mkt;
  const ymd = windowTargetYmd(days, now, mkt);
  return market ? zonedEpoch(ymd, 24 * 60, TZ[market]) - 1 : Date.parse(ymd + "T23:59:59.999Z");
}

/** Percent change over a window, or null when the stored history cannot honestly answer it. The base is the
 *  last price ON OR BEFORE the window's target date (1M on Sep 25 = the Aug 25 close), never a later one:
 *  round 1 let a base land after the start, and TSLA's 1M read +8.0% from the Aug 26 close instead of +6.6%
 *  from Aug 25; before that, a symbol with 7 days of prices reported the same "+3.7%" for 1W and 1M. A base
 *  more than 2 session closes older than the target date (a gap in the history, or a history that starts
 *  after it) is no base: "not enough price history yet". Crypto trades every day: at most 2 days older.
 *  `mkt` undefined = US, null = crypto. */
export function pctOver(history: Pt[], days: number, now = Date.now(), mkt?: Mkt | null): number | null {
  if (history.length < 2) return null;
  const market = mkt === undefined ? "US" : mkt;
  const cutoff = windowCutoff(days, now, mkt);
  let base: Pt | null = null;
  for (const h of history) { if (+new Date(h.ts) <= cutoff) base = h; else break; }
  if (!base) return null;
  const at = +new Date(base.ts);
  const stale = market ? closesBetween(market, at, cutoff, 2) > 2 : cutoff - at > 3 * 86400000;
  if (stale) return null;
  const last = history[history.length - 1];
  if (base === last || !(base.price > 0) || !(last.price > 0)) return null;
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
 *  1. the LAST 8-K carrying item 2.02 (Results of Operations) filed in the 45 days before a 10-Q/10-K: the
 *     release that precedes the periodic report. Item 2.02 alone is not enough: Tesla files its quarterly
 *     DELIVERIES under 2.02 in the first days of Jan/Apr/Jul/Oct, three weeks before its earnings release, and
 *     "last reported Oct 2" made every surface say "next report ~early January" and Ask "~Oct 1" (round 2).
 *     A 2.02 with no periodic report after it (a deliveries update, a release whose 10-Q is not filed yet)
 *     is ignored. 45 days, not 10: banks file the 10-Q two to three weeks after the release;
 *  2. an 8-K without item data filed on the day of, or up to 3 days before, a 10-Q/10-K (rows stored before
 *     item numbers were kept; NVDA 8-K + 10-Q on Aug 26, MSFT 8-K + 10-K on Jul 29);
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
  // amendments (10-K/A) are filed at any time and date nothing
  const periodic = filings.filter((f) => /^10-[QK]$/.test(f.form)).map((f) => ymdOf(f.filed_at));
  const results = filings.filter((f) => /^8-K/.test(f.form) && /\b2\.02\b/.test(String(f.items ?? ""))).map((f) => ymdOf(f.filed_at));
  for (const p of new Set(periodic)) {
    const release = results.filter((d) => { const g = dayDiff(p, d); return g >= 0 && g <= 45; }).sort().pop();
    if (release) cands.push({ date: release, source: "8-K item 2.02", rank: 0 });
  }
  for (const f of filings) {
    if (!/^8-K/.test(f.form) || f.items) continue;
    const d = ymdOf(f.filed_at);
    if (periodic.some((p) => { const g = dayDiff(p, d); return g >= 0 && g <= 3; })) cands.push({ date: d, source: "8-K with 10-Q/10-K", rank: 1 });
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
export function nextEarningsEstimate(lastYmd: string, todayYmd: string, history: string[] = []): { est: string; due: boolean; range?: [string, string] } {
  // the one nearest a quarter after the last report (never simply the earliest: a stray year-ago date must not win)
  const yearAgo = history.map((d) => addDays(d, 364)).filter((d) => dayDiff(d, lastYmd) >= 56 && dayDiff(d, lastYmd) <= 126)
    .sort((a, b) => Math.abs(dayDiff(a, lastYmd) - 91) - Math.abs(dayDiff(b, lastYmd) - 91))[0];
  const quarterOn = addDays(lastYmd, 91);
  let est = yearAgo ?? quarterOn;
  // When the year-ago rhythm and "a quarter after the last report" disagree by more than 5 days, neither is a
  // date: the estimate is a span of the month, never a day (NVDA: Nov 18 by last year, Nov 25 by the last
  // report, and calendars say ~Nov 25; round 3 printed "~Nov 18" as if it were known).
  let range: [string, string] | undefined = yearAgo && Math.abs(dayDiff(yearAgo, quarterOn)) > 5
    ? (yearAgo < quarterOn ? [yearAgo, quarterOn] : [quarterOn, yearAgo]) : undefined;
  if (est < todayYmd && dayDiff(todayYmd, est) <= 21) return { est, due: true, ...(range ? { range } : {}) };
  while (est < todayYmd) { est = addDays(est, 91); range = undefined; }
  return { est, due: false, ...(range ? { range } : {}) };
}
/** The Korean span ("11월 중순~하순", "10월 하순"), matching spanOfMonth (round 8: KR said "10월 21일~10월 28일" where EN
 *  said "late October"). */
export const spanOfMonthKo = (r: [string, string]): string => {
  const part = (ymd: string) => { const d = Number(ymd.slice(8, 10)); return { m: Number(ymd.slice(5, 7)), p: d <= 10 ? "초" : d <= 20 ? "중순" : "하순" }; };
  const a = part(r[0]), b = part(r[1]);
  const pa = a.p === "초" ? "초순" : a.p;
  if (a.m === b.m) return a.p === b.p ? `${a.m}월 ${pa}` : `${a.m}월 ${pa}~${b.p === "초" ? "초순" : b.p}`;
  return `${a.m}월 ${pa}~${b.m}월 ${b.p === "초" ? "초순" : b.p}`;
};
/** "mid to late November" for a span, "late November" when both ends fall in the same part of the month. */
export const spanOfMonth = (r: [string, string]): string => {
  const a = partOfMonth(r[0]), b = partOfMonth(r[1]);
  if (a === b) return a;
  const [pa, ma] = [a.split(" ")[0], a.split(" ").slice(1).join(" ")], [pb, mb] = [b.split(" ")[0], b.split(" ").slice(1).join(" ")];
  return ma === mb ? `${pa} to ${pb} ${mb}` : `${a} to ${b}`;
};

/** The last report and the next estimate from everything on file (null = nothing that dates a report). */
export function earningsEstimate(filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string): { last: string; source: EarningsSource; est: string; due: boolean; range?: [string, string] } | null {
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
    : e.range ? `expected in ${spanOfMonth(e.range)} (est; the exact day is not known, so never state one)`
    : `expected around ${partOfMonth(e.est)}, ~${shortDate(e.est)} (est, not confirmed)`;
  return `${name}: last reported ${shortDate(e.last)} (${e.source}); next report ${when}`;
}

const MON_IDX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** Calendar and watch items that put a holding's earnings (report, results, call) on a date away from the
 *  computed estimate. Caught 2026-09-25: a midday brief listed "Microsoft earnings call Sep 28" (it reports
 *  late October, ~Oct 28); the only earnings dates a brief may carry are the ones in its NEXT EARNINGS block.
 *  An item within 7 days of the estimate passes; an earnings date for a holding with no estimate is dropped. */
export function wrongEarningsDates(items: string[], ests: { names: string[]; est: string | null; range?: [string, string] }[], todayYmd: string): string[] {
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
    const [lo, hi] = who.range ?? [who.est, who.est];
    if (dayDiff(lo, ymd) > 7 || dayDiff(ymd, hi) > 7) bad.push(raw);
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
// An abbreviation's period is not a sentence end (round 5: "BND is a bond fund holding U.S." lost "Treasury and
// corporate bonds" at the split). Shared by every splitter here and exported for the functions.
const ABBREV_END = /(?:\b(?:U\.S|U\.K|U\.N|E\.U|Inc|Co|Corp|Ltd|Cos|Bros|e\.g|i\.e|etc|vs|No|St|Mr|Ms|Mrs|Dr|Jr|Sr|a\.m|p\.m|approx|est|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$/;
export function splitSentences(t: string): string[] {
  const parts = String(t ?? "").split(/(?<=[.!?。](?:\*\*|["'”’)\]])?)(?<!(?:^|\n)[\s*•-]*\d{1,2}[.)])\s+(?=\S)|\n+/);
  const out: string[] = [];
  for (const p of parts) {
    const x = p.trim();
    if (!x) continue;
    // glue a piece back onto one that ended on an abbreviation and is followed by more of the same sentence
    if (out.length && ABBREV_END.test(out[out.length - 1]) && /^[A-Za-z0-9$]/.test(x)) out[out.length - 1] += " " + x;
    else out.push(x);
  }
  return out;
}
const sentencesOf = (t: string): string[] => splitSentences(t);
/** Apply a sentence-level transform LINE BY LINE, keeping every newline and each line's bullet lead ("• ", "- ",
 *  "1. "). Round 7: dropInstructionEcho and fixFractions ran splitSentences() over the whole answer and rejoined
 *  with " ", which flattened every bulleted Ask answer into one paragraph. A line the transform empties is dropped. */
export function perLine(text: string, fn: (line: string) => string): string {
  const src = String(text ?? "");
  if (!src.includes("\n")) {
    const lead = src.match(/^[\s•*\-–·]+|^\s*\d{1,2}[.)]\s+/)?.[0] ?? "";
    const out = fn(src.slice(lead.length));
    return out.trim() ? lead + out : "";
  }
  return src.split("\n").map((line) => {
    if (!line.trim()) return line;
    const lead = line.match(/^[\s•*\-–·]+|^\s*\d{1,2}[.)]\s+/)?.[0] ?? "";
    const out = fn(line.slice(lead.length));
    return out.trim() ? lead + out : null;
  }).filter((l): l is string => l !== null).join("\n");
}
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
    // "undervalued" needs a NAMED source ("Morningstar says"): "another piece calls it 24% undervalued" is our voice
    const valuationWord = /\b(?:undervalued|overvalued|under-?valuation|over-?valuation|fair value|buying (?:chance|opportunit(?:y|ies))|chance to buy)\b/i.test(s);
    const GENERIC = /^(?:The|This|That|It|Another|A|An|Some|One|Its|Their|Our|We|They|He|She|Analysts?|Critics|Investors|Bulls|Bears|Many|Most|Wall|Street)$/;
    const namedSource = [...s.matchAll(/\b(?:according to ([A-Z][\w&.'-]+)|([A-Z][\w&.'-]+)(?: [A-Z][\w&.'-]+){0,3}(?:'s)? (?:says|said|calls|called|sees|rates|estimates|puts|pegs|argues|argued|analysts?|fair value|price target|target))\b/g)]
      .some((m) => !GENERIC.test(m[1] ?? m[2] ?? ""));
    const debate = /\bbulls?\b[\s\S]*\bbears?\b|\bbears?\b[\s\S]*\bbulls?\b/i.test(s);   // both sides of an argument is information
    // "could double on a $2T IPO" (round 5 GOOGL card): "could" reads as hedged, but a doubling or tripling of
    // value in the app's voice is a price call unless a named source says it
    if (s && /\b(?:could|would|will|should|might) (?:double|triple|quadruple)\b|\b(?:doubles?|triples?) (?:from here|in value)\b/i.test(s) && !namedSource) { hits.push(raw); continue; }
    // round 7 cards: reassurance and verdicts in the app's voice ("a cooldown after a 31.9% surge, not a thesis
    // break", "a legal headline, not a near-term financial hit", "makes Google Cloud the clear second growth engine")
    // round 8 newcomer: "Long-term AI and robotics thesis … is intact" (TSLA −17.3% YTD): the CONCEPT, in any order
    if (s && /\b(?:thesis|story|case|narrative)\b/i.test(s) && /\b(?:intact|holds|holding|unchanged|unbroken|on track|still valid|remains? valid|not broken|still (?:stands|works))\b/i.test(s) && !namedSource && !/\b(?:if|whether|unless|would|could|might)\b/i.test(s)) { hits.push(raw); continue; }
    if (s && /\bnot a thesis break\b|\bthesis (?:is |remains |stays )?(?:still )?(?:intact|unchanged|holds|on track)\b|\bnot a (?:near-term |real |material |lasting )?(?:financial )?hit\b|\bthe clear (?:second |next |new |main )?(?:growth )?(?:engine|winner|leader)\b|\ba (?:credible|real|proven|clear|genuine|legitimate|durable) (?:second |next |new |third )?(?:growth )?engine\b|\b(?:the )?(?:growth )?story is (?:real|alive|intact|working)\b|\bkeeps? the story alive\b|\b(?:is )?not broken\b|\bpillars? (?:are |is )?(?:still )?standing\b|\bthe steadier of\b|\b(?:a )?deliberate (?:AI )?moat\b|\bcarr(?:y|ies) the strongest signal\b|\bshows? (?:the )?strongest (?:revenue |growth )?signals?\b|\b(?:is|are) no longer theoretical\b|\bbeats? dry powder\b|\b(?:your (?:wife|husband|partner|spouse|dad|father|mom|mother|friend|advisor|adviser)|he|she) (?:is|was) right\b(?!-)|\bthe (?:plan|clock|book|portfolio) needs\b|\b(?:revenue|growth) (?:story |thesis )?(?:remains? |is |stays )?intact\b|\bfits? your (?:hold[- ]through[- ]drawdowns |long-term |compounding )?(?:style|goal|plan|horizon)\b|\b(?:a )?(?:real |big |huge )?optionality story\b|\b(?:powerful|strong|healthy|intact) (?:longer-term |long-term )?uptrend\b|\batop a (?:powerful|strong|longer-term|long-term)\b|\b(?:stay|staying|remain|remaining|keep|keeping) (?:weighted|overweight|invested|exposed|heavy|concentrated)\b[^.]{0,50}\b(?:beneficial|pays? off|makes sense|wise|smart|the right)\b|\bremains? (?:significantly |very |highly )?beneficial\b|\bjust a (?:cooldown|breather|pause)\b|\ba (?:normal|healthy) (?:breather|pullback|cooldown)\b|\b(?:keeps?|keeping) (?:the |your )?(?:portfolio|book|plan|goals?) on track\b/i.test(s) && !namedSource && !/\b(?:if|whether|unless)\b/i.test(s)) { hits.push(raw); continue; }
    // round 9 v44 re-check: contractions and near-paraphrases ("Thesis isn't broken, it's being tested", "Cloud is the new
    // engine", "makes robotaxi optionality real", "Grade: B.", "not stretched on that metric", "Trend intact", "modest but
    // compounding", "현금 3.4%는 낮은 수준", "현금이 채권 대체 일부 가능")
    if (s && /\b(?:isn['’]t|is not|not|wasn['’]t|hasn['’]t been|never) (?:yet |really )?broken\b|\bthe (?:new|next|second|real|clear) (?:growth |profit )?engine\b|\bmakes? [\w' -]{0,30}\b(?:optionality|story|case|thesis) real\b|\boptionality (?:is |looks )?(?:now )?real\b|(?:^|[.:]\s*)grade:?\s*[A-F][+-]?(?=[\s.,;]|$)|\bgets? an? [A-F][+-]?\b(?= grade|$|[.,])|\b(?:isn['’]t|is not|not|doesn['’]t look|does not look|hardly) (?:too |overly |that |especially )?(?:stretched|expensive|cheap|overvalued|undervalued|rich|frothy|pricey)\b|\btrend (?:is |remains |stays |looks )?intact\b|\bnot structural\b|\b(?:is|looks|seems|appears) (?:temporary|transitory|cyclical, not structural)\b|\bmodest but compounding\b|\b(?:solid|healthy|strong|robust) (?:growth|execution|fundamentals|momentum)\b(?![^.]{0,20}\b(?:if|whether|unless)\b)|\bexecution (?:is |looks |remains )?(?:mostly |largely )?(?:positive|solid|strong|on track)\b|(?:현금|비중).{0,20}?(?:낮은|높은|적정한?|적당한|과한|부족한|중립적인?) 수준|대체 (?:일부 )?가능|대신할 수 있|(?:양호|탄탄|견조)(?:합니다|한 편|해 보)/i.test(s) && !namedSource && !/\b(?:if|whether|unless)\b|만약|경우에/i.test(s)) { hits.push(raw); continue; }
    if (!s || (ATTRIBUTED.test(s) && (!valuationWord || namedSource || debate))) continue;
    // round 4: "a hidden asset the market isn't fully pricing", "17x versus the S&P's 25x leaves cushion", "the
    // long-term story still looks solid" (to "is it on sale?"): verdicts in the app's voice
    // round 4 newcomer/poweruser: "SCHD dip viewed as buying chance", "leaves little margin", "stretched"
    const ownVoice = /\b(?:buying|buy) (?:chance|opportunit(?:y|ies)|window)\b|\bchance to (?:buy|add|scoop)\b|\bleaves? (?:little|no|thin|limited) (?:margin|room|cushion)\b|\b(?:valuation|multiple|price tag|price|shares?|stock)\s+(?:looks? |is |seems |remains |now )?(?:stretched|frothy|rich|full|demanding)\b|\b(?:stretched|frothy|demanding) (?:valuation|multiple|price tag)\b|\b(?:isn'?t|is not|aren'?t|are not|not) (?:yet )?(?:fully |really )?pric(?:ing|ed)(?: in)?\b|\bnot fully priced\b|\bhidden (?:asset|value|gem)\b|\bleaves? (?:a |some |plenty of |more )?(?:cushion|room(?: to run| for upside)?|upside)\b|\b(?:valuation|margin of safety) cushion\b|\bat a discount\b|\b(?:cheap(?:er)?|discounted) (?:versus|vs\.?|relative to|compared (?:to|with)) the (?:market|index|S&P)|\b(?:story|thesis|case) (?:still |remains |is still )?(?:looks |look )?(?:solid|intact|strong|compelling)\b|\bstill intact\b|\bthe run is real\b|\bsupports? the upside view\b|\bahead of most targets\b/i.test(s)
      // round 5: "an asset the 17x multiple ignores", "could double on a $2T IPO": the market missing something is a
      // valuation call in the app's voice; so is advice to time cash ("Keeping cash lets you wait for a clearer price")
      || /\b(?:multiple|market|price|valuation|shares?|stock|investors?|the street)\s+(?:still\s+|largely\s+|mostly\s+)?(?:ignores?|overlooks?|misses|underrates?|underprices?|leaves? out|doesn'?t (?:reflect|price|count|credit)|isn'?t (?:reflecting|crediting|counting))\b|\b(?:ignored|overlooked|underappreciated|underrated|unpriced|not priced) by (?:the )?(?:market|multiple|investors|street)\b|\bcould (?:double|triple)\b/i.test(s)
      || /\b(?:keep(?:ing)?|hold(?:ing)?|park(?:ing)?|sit(?:ting)? on|leave|leaving)\s+(?:your\s+|some\s+|more\s+|the\s+|extra\s+)?cash\b[^.]{0,50}\b(?:lets? you|so you can|allows? you|gives? you|until|wait|clearer|better (?:price|entry|moment)|lower prices?|pullback|dip|opportunit)/i.test(s)
      || /\b(?:deploy|put|invest)(?:ing)?\s+(?:your\s+|the\s+|that\s+)?cash\b[^.]{0,30}\b(?:gradually|over time|in stages|in tranches|slowly|now|later)\b/i.test(s)
      // a buy-the-dip nudge about the user's cash ("Holding cash lets you buy during a pullback", r3/r4)
      || /\b(?:lets? you|allows? you to|so you can|ready to|leaves? you room to|gives? you room to)\s+(?:buy|add|pounce|act|scoop|step in)\b[^.]{0,50}\b(?:dips?|pullbacks?|drops?|sell-?offs?|lower prices?|weakness|falls?|declines?)\b/i.test(s);
    const call = ownVoice || /\b(?:looks?|looking|seems?|appears?|is|are|remains?|stays?|trad(?:es|ing)|priced|now)\s+(?:\w+\s+){0,2}?(?:cheap|inexpensive|expensive|pricey|undervalued|overvalued|under-valued|over-valued|a bargain|a steal|attractive(?:ly priced)?|good value|great value|compelling value|a no-brainer)\b/i.test(s)
      || /\b(?:undervalued|overvalued|under-?valuation|over-?valuation|bargain|downside protection|(?:gives?|hands?|offers?|has) \w+(?:'s)? (?:a )?(?:clear|strong|obvious|real) (?:near-term )?catalyst|catalyst for (?:upside|gains|a rally|a re-?rating)|top pick|good entry|attractive entry|entry point|buying opportunity|attractive (?:price|valuation|level|levels)|on sale|cheap (?:entry|shares|stock)|sets? up well|screams? (?:buy|value))\b/i.test(s)
      || /(저평가|고평가|싸\s?보|싼 편|비싸\s?보|매수\s?기회|저가\s?매수|하방\s?경직|하방\s?보호)/.test(s)
      // round 5: "싸다고 보긴 어려워요" is still a verdict on the price
      || /(싸다|비싸다|저렴하다|싸|비싸|저렴)(?:고|다고|다거나)?\s?(?:보|판단|말하|평가|느껴|생각)/.test(s);
    if (ownVoice || call && !(OBJECTIVE.test(s) && !/\b(cheap|undervalued|overvalued|under-?valuation|over-?valuation|bargain|buying opportunity|downside protection)\b/i.test(s))) hits.push(raw);
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
    // round 5: "MSFT, AAPL, QQQM을 나눠 사는 게 안전해요" answered "현금으로 뭘 사야 할까?"
    const korean = /(매수하세요|매도하세요|사세요|파세요|정리하세요|사는 게 좋|파는 게 좋|팔아야 합니다|사야 합니다|추천합니다|추천드립니다)/.test(s)
      || /(나눠 사|분할 매수|사는 게|사는 것이|매수하는 게|추가하는 게|늘리는 게|담는 게|사 두는|사두는|편입하는 게|넣는 게|투자하는 게)[^.]{0,20}(좋|안전|낫|괜찮|방법|유리|현명)/.test(s)
      || /(을|를)\s?(추가로 |더 |조금 더 |조금씩 )?(사세요|담으세요|늘리세요|추가하세요|고려해 보세요|고려해보세요)/.test(s);
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
  return /\b(should|shall|would|must)\s+(i|we)\s+(?:still\s+|just\s+|really\s+)?(buy|sell|hold|add|trim|keep|dump|exit|get out|get rid of|take profits?|swap|rotate|double down|average down|cut|load up|rebalance|move|invest|put|ditch|unload)\b/i.test(t)
    // "do I sell?" asks for a call; "how much cash do I hold?" asks for a number
    || /\bdo\s+(i|we)\s+(?:still\s+|just\s+|really\s+)?(buy|sell|add|trim|dump|exit|get out|get rid of|take profits?|swap|rotate|double down|average down|cut|load up|rebalance|ditch|unload)\b/i.test(t)
    || /\b(buy|sell|hold|add|trim|keep|dump)\s*(?:it\s+)?(or|\/)\s*(buy|sell|hold|add|trim|wait|keep|dump)\b/i.test(t)
    || /\b(is|it's)\s+(it|now|this)\s+(a\s+)?(good|right|bad|smart)\s+(time|moment|idea)\s+to\s+(buy|sell|add|trim)\b/i.test(t)
    || /\btime to (buy|sell|take profits?|get out|trim|add|cash out)\b|\bbuy(?:ing)? the dip\b/i.test(t)
    // round 4: "META fell 3% today. Is it on sale now?" got "the long-term story still looks solid"
    || /\bon sale\b|\b(?:a|the) bargain\b|\bcheap (?:now|here|enough)\b|\b(?:is|are) (?:it|they|\w+) cheap\b|\bgood entry\b|\bentry point\b|\bworth buying\b|\bundervalued now\b/i.test(t)
    || /(싸졌|싸게|저가 매수|줍줍|바겐|저점 매수|물타기)/.test(t)
    || /\bhow much\b[^?]{0,40}\b(buy|sell|add|put|invest|allocate)\b/i.test(t)
    || new RegExp(`\\bwhich\\b[^?]{0,50}\\b(?:should|would|do|to)\\s+(?:i\\s+|you\\s+|we\\s+)?(?:\\w+\\s+)?(${TRADE_VERB})\\b`, "i").test(t)
    || /\bworth (buying|selling|adding|keeping|holding|owning)\b/i.test(t)
    || new RegExp(`\\byou(?:'?d| would)\\s+(?:\\w+\\s+)?(${TRADE_VERB}|pick|choose)\\b|\\bwould you\\s+(?:\\w+\\s+)?(${TRADE_VERB}|pick|choose|do)\\b`, "i").test(t)
    || /\bif (?:you were|i were) (?:me|you)\b|\bin my shoes\b|\bwhat would you do\b|\bwhat do you (?:recommend|suggest)\b|\bwhat (?:should|would) (?:i|you) (?:do|buy|sell)\b/i.test(t)
    || /\b(?:top|best) (?:pick|picks|buy|idea)\b|\byour (?:pick|favou?rite)\b/i.test(t)
    || new RegExp(`\\b(?:one|stock|stocks|holding|holdings|position|name|names)\\s+(?:to|i should|i'd)\\s+(${TRADE_VERB})\\b`, "i").test(t)
    || /\b(?:is|are)\s+\S+(?:\s+\S+)?\s+(?:a|still a)\s+(buy|sell|hold)\b/i.test(t)
    || /\bwhere (?:would|should) (?:my|the|this|i|it)\b[^?]{0,40}\b(go|put|invest|deploy)\b/i.test(t)
    // where the user's own cash should go is an allocation, which is a trade instruction (round 3: "If you had my
    // $120K cash, where would it go?" got "MSFT first, maybe not more NVDA")
    || /\bif you had my\b|\bwhere would (?:it|that|the (?:cash|money)|my\s+\S+)\s+go\b|\bwhat (?:would|should|could|can) (?:you|i|we) (?:do|buy|get) with (?:my|the|this|that|our)\b|\bwhat (?:should|would|could|can) i buy\b|\bwhat do you (?:recommend|suggest) i do\b/i.test(t)
    || /\b(?:put|invest|deploy|allocate|park|spend|use)\s+(?:my|the|this|that|our)\s+(?:\$?[\d,.]+[kKmM]?\s+)?(?:cash|money|savings|funds|dollars|bonus)\b/i.test(t)
    || /(현금|예수금|여윳돈|목돈|돈)[^?]{0,20}(어디에|뭘|무엇을|어떤 종목)|어디에 (?:넣|투자|써)|뭘 사면|무엇을 사면|투자하면 좋을|사면 좋을/.test(t)
    || /\b(?:best|worst|strongest|weakest)\b[^?]{0,20}\bto (?:own|hold|keep|buy|sell|dump)\b/i.test(t)
    || (/\b(?:rank|order|sort|list|grade|rate)\b[^?]{0,60}\b(?:best|worst|strongest|weakest|keep|dump|sell|own|hold|buy)\b/i.test(t) && !QUESTION_METRIC.test(t))
    || /(사야|팔아야|매수해야|매도해야|살까|팔까|사도 될까|팔아도 될까|추가 매수|정리할까|정리해야|정리하는 게|정리하는 것이|손절|익절|추천해|추천 좀|추천할|추천 종목|종목 추천|뭘 사|뭘 팔|뭐 사|뭐 팔|무엇을 사|무엇을 팔|어떤 (?:종목|주식)을? (?:사|팔|정리|버리)|당신이라면|너라면|제 입장이라면|저라면 어떻게|어떻게 하시겠|어떻게 할래|들고 가야|계속 보유해야|보유해야 할까|보유할까|비중을 (?:늘려|줄여)|늘려야 할까|줄여야 할까|버려야|버릴까)/.test(t);
}

// the model's own ways of saying the decision is theirs; round 3 found a second, canned opener stacked on top of
// "The call is yours; here is what each side rests on." and "정리 여부는 본인 판단이지만"
const NO_CALL = /\b(can'?t|cannot|won'?t|don'?t|isn'?t (?:mine|my place))\b[^.]{0,40}\b(tell you|say|make|pick|decide|call|recommend|rank)\b|\b(not|isn'?t) my call\b|\byour (?:own )?(?:call|decision|choice)\b|\b(?:call|decision|choice) (?:is|stays|remains) (?:yours|your own|up to you)\b|\bup to you\b|\bthat's your decision\b|\b(?:is|are|stays|remains) (?:yours|your own|your call)\b|\byours to (?:make|decide|call)\b|제가 (정해|결정)|정하실 몫|결정하실 몫|판단하실 몫|본인이 (?:정|결정|판단)|(말씀|정해|골라|추천해)\s?드릴 수 없|판단은[^.]{0,20}몫|결정은[^.]{0,20}몫|본인(?:의)? (?:판단|선택|결정)|직접 (?:결정|판단)|스스로 (?:결정|판단)|(?:결정|판단|선택)[은는이]?[^.]{0,15}달려 있|드리기 어렵|드릴 수는 없|권해\s?드릴 수 없|추천(?:해)?\s?드리기 어렵/i;
/** A "should I sell X" answer opens with ONE short, natural line that the decision is theirs, then gives
 *  the considerations. Added in code when the model left it out, and never twice in a row: round 2 found the
 *  same canned opener on six answers in one conversation, which read robotic. */
export function withNoCallLine(answer: string, question: string, _previousAnswer = "", _previousQuestion = "", decision?: boolean): string {
  // Every trade or pick answer carries it, unless THIS answer's first sentence already declines (round 5: it was
  // dropped whenever the previous turn had said "your call", and a trade question after a trade question went
  // out bare). `decision` lets the caller mark a follow-up turn ("and if it were $120K?") as a decision question.
  if (!(decision ?? (isTradeQuestion(question) || isPickQuestion(question)))) return answer;
  // EXACTLY one opener (round 7: "매매 여부는…" stacked on the model's own "매매 결정은 고객님께 달려 있지만…"):
  // a refusal that opens the answer is the opener; every other refusal sentence goes
  const sents0 = splitSentences(answer);
  const firstIsRefusal = !!sents0[0] && NO_CALL.test(sents0[0]);
  let kept = 0;
  answer = perLine(String(answer ?? ""), (line) => splitSentences(line).filter((x) => {
    if (!NO_CALL.test(x)) return true;
    kept++;
    return firstIsRefusal && kept === 1;
  }).join(" "));
  if (firstIsRefusal) return answer;
  // the opener speaks the BODY's language, so the two can never mix (the body has already been held to the
  // question's language; this only matters when that failed)
  const ko = String(answer ?? "").trim() ? isKoreanText(answer) : questionIsKorean(question);
  // the line fits the question (round 6: "whether to trade it" answered "what should I buy with my cash?" and
  // "what's your top pick?", where "it" refers to nothing)
  const cashQ = /\b(?:cash|money|what (?:should|do) i buy|what to buy|where (?:should|do) i (?:put|invest))\b|\$\s?\d[\d,.]*\s?[kK]?\b|현금|돈으로|뭘 사|무엇을 사|어디에 (?:넣|투자)/i.test(question);
  const pickOnly = isPickQuestion(question) && !/\b(?:sell|trim|take profits?|dump|exit|cut|reduce|buy more|add to)\b|팔|매도|정리|더 살/i.test(question);
  // round 8: "Rank my holdings" opened "I can't tell you whether to trade it"
  if (isRankQuestion(question)) return (ko ? "무엇을 남길지는 정해드릴 수 없지만, 숫자로 본 순위는 이렇습니다." : "I can't tell you which to keep, but here's how your holdings rank by the numbers.") + "\n" + answer;
  const line = ko
    ? (cashQ ? "무엇을 살지는 제가 정해드릴 수 없지만, 판단의 근거는 이렇습니다." : pickOnly ? "종목을 골라드릴 수는 없지만, 그 선택이 무엇에 달려 있는지는 이렇습니다." : "매매 여부는 제가 정해드릴 수 없지만, 판단의 근거는 이렇습니다.")
    : (cashQ ? "I can't tell you what to buy, but here's what that decision rests on in your portfolio." : pickOnly ? "I can't pick a holding for you, but here's what that choice rests on." : "I can't tell you whether to trade it, but here's what the decision rests on.");
  return line + "\n" + answer;
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
/** Korean text: a Hangul majority of its words (tickers and numbers neutral). */
export const isKoreanText = (s: string): boolean => hasHangul(s) && hangulShare(s) >= 0.5;
/** The language of the CURRENT question decides the answer's and the chips': a Hangul-majority question is
 *  Korean, anything else English ("Should I sell 삼성전자?" is English). Never the holdings' or the history's
 *  language: round-2 live smoke on a book holding Samsung and SK hynix answered "Rank my holdings from best to
 *  worst to own" with an English opener, a Korean body and Korean chips. */
export const questionIsKorean = (q: string): boolean => isKoreanText(q);
/** The answer's script does not match the question's language, in either direction. An English answer may
 *  still name a Korean company in Hangul; a fifth of its words in Hangul is not English any more. */
export const wrongLanguage = (question: string, answer: string): boolean =>
  questionIsKorean(question) ? hangulShare(answer) < 0.5 : hangulShare(answer) > 0.2;
/** A chip belongs to the conversation only in the question's language. */
export const chipInLanguage = (question: string, chip: string): boolean =>
  questionIsKorean(question) ? isKoreanText(chip) : hangulShare(chip) <= 0.2;

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
  return String(text ?? "").split(/(?<=[.!?])[ \t]+/).map((sent) => {
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
export type LiveFact = { names: string[]; pct: number | null; price?: number | null; high?: number | null; low?: number | null };
// Hangul names match as substrings (a particle attaches: "자산은", "Nvidia는"); Latin names end at a Latin letter
const nameIn = (s: string, n: string) => !!n && (/^[A-Z0-9.]{1,6}$/.test(n)
  ? new RegExp(`(?:^|[^A-Za-z0-9])\\$?${esc(n)}(?=$|[^A-Za-z0-9])`).test(s)
  : /[\uac00-\ud7a3]/.test(n) ? s.includes(n)
  : new RegExp(`(?:^|[^A-Za-z])${esc(n)}(?=$|[^A-Za-z])`, "i").test(s));
const firstIdx = (s: string, names: string[]) => Math.min(...names.map((n) => {
  if (!n) return Infinity;
  if (/[\uac00-\ud7a3]/.test(n)) { const i = s.indexOf(n); return i < 0 ? Infinity : i; }
  const m = s.match(/^[A-Z0-9.]{1,6}$/.test(n) ? new RegExp(`(?:^|[^A-Za-z0-9])\\$?${esc(n)}(?=$|[^A-Za-z0-9])`) : new RegExp(`(?:^|[^A-Za-z])${esc(n)}(?=$|[^A-Za-z])`, "i"));
  return m?.index ?? Infinity;
}));
const NEG_MOVE = /^(down|fell|falls|falling|lost|loses|losing|slipped|slips|slid|slides|dropped|drops|dropping|sank|sinks|shed|sheds|declined|declines|dipped|dips|edged down|edged lower|lower|off|tumbled|tumbles|plunged|plunges|drop|decline|fall|slide|loss|dip|slump|selloff|sell-off)$/i;
const MOVE_FWD = /\b(up|down|rose|rises|rising|fell|falls|falling|gained|gains|gaining|lost|loses|losing|slipped|slips|slid|slides|dropped|drops|dropping|climbed|climbs|jumped|jumps|sank|sinks|added|adds|shed|sheds|rallied|rallies|declined|declines|dipped|dips|edged (?:up|down|higher|lower)|higher|lower|off|advanced|surged|surges|tumbled|tumbles|plunged|plunges|popped|pops)\s+(?:by\s+|about\s+|nearly\s+|roughly\s+|almost\s+|another\s+)?(\d+(?:\.\d+)?)\s?%/gi;
const MOVE_REV = /\b(\d+(?:\.\d+)?)\s?%\s+(gain|rise|jump|pop|rally|climb|advance|drop|decline|fall|slide|loss|dip|slump|selloff|sell-off)\b/gi;
// a figure qualified by a window, a fundamental or a previous session is not today's move
const NOT_TODAY = /(?:1주|일주일|한 주|주간|한 달|1개월|\d+개월|분기|1년|연간|올해)|\b(weeks?|weekly|months?|monthly|years?|yearly|annual|annually|quarters?|quarterly|YTD|since|over the|past|\d+-day|two-month|decade|all-time|from (?:its|the) (?:high|peak|low)|(?:below|off) (?:its|the) (?:high|peak)|record|drawdown|target|upside|downside|expected|forecast|guidance|revenue|sales|earnings|margins?|growth|share of|of assets|weight|stake|yields?|dividends?|rates?|inflation|index|yesterday|last session|overnight|premarket|pre-market|after-hours|(?:mon|tues|wednes|thurs|fri|satur|sun)day's|in (?:mon|tues|wednes|thurs|fri)day|of (?:your |the )?(?:portfolio|holdings|total|invested)|makes? up|made up|accounts? for|since (?:January|you bought|purchase)|year to date|this year|in 20\d\d|above (?:your|its) (?:cost|buy)|below (?:your|its) (?:cost|buy))\b/i;
/** Sentences that state a holding's move as today's with a figure that is not its live session move.
 *  Caught 2026-09-25 (round 2): a VOO card said "VOO down 0.6% on GOOG drag" while VOO was +0.45% and never
 *  traded below its prior close. A sentence that qualifies its figure (a window, a fundamental, yesterday)
 *  is left alone; with one fact (a per-symbol card) an unnamed subject means that holding. */
export function dayMoveMismatches(text: string, facts: LiveFact[], tolPp = 0.35): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    // a word approximation is a figure too (round 6: "each rose about half a percent" when NVDA rose 0.22%)
    const s = bare(raw).replace(/\b(?:about |roughly |around |nearly |almost )?half (?:a|of a|of one) percent(?:age point)?\b/gi, "0.5%")
      .replace(/\b(?:about |roughly |around )?a quarter (?:of a )?percent\b/gi, "0.25%").replace(/\b(?:about |roughly |around )?a tenth of a percent\b/gi, "0.1%")
      .replace(/\b(?:about |roughly |around )?(?:one|a) percent\b/gi, "1%");
    if (!s || NOT_TODAY.test(s)) continue;
    const moves: { idx: number; val: number }[] = [];
    for (const m of s.matchAll(MOVE_FWD)) moves.push({ idx: m.index ?? 0, val: Number(m[2]) * (NEG_MOVE.test(m[1].split(/\s+/).pop()!) || /\bdown\b|\blower\b/i.test(m[1]) ? -1 : 1) });
    for (const m of s.matchAll(MOVE_REV)) moves.push({ idx: m.index ?? 0, val: Number(m[1]) * (NEG_MOVE.test(m[2]) ? -1 : 1) });
    // a signed figure tied to "today" / "오늘" ("today +2.6%", "오늘 -0.4%", "오늘 2.6% 올랐") (round 4: the 1-week
    // +2.6% labelled "오늘")
    for (const m of s.matchAll(/(?:\btoday\b|오늘|금일)[^.%\d+−-]{0,16}([+−-]?)\s?(\d+(?:\.\d+)?)\s?%(\s?(?:하락|내렸|떨어|빠졌|down|lower))?/gi)) {
      if (moves.some((x) => Math.abs(x.idx - (m.index ?? 0)) < 25)) continue;
      const neg = m[1] === "-" || m[1] === "−" || !!m[3];
      moves.push({ idx: m.index ?? 0, val: Number(m[2]) * (neg ? -1 : 1) });
    }
    if (!moves.length) continue;
    for (const mv of moves) {
      // the holding the figure belongs to: the nearest one named before it, else the only one there is
      const before = facts.map((f) => ({ f, at: firstIdx(s, f.names) })).filter((x) => x.at <= mv.idx).sort((a, b) => b.at - a.at);
      // "QQQ, Nvidia and VOO each rose ..." states the move for EVERY holding named before it
      const group = /\b(?:each|all|both|every one of them|all three|all two)\b/i.test(s) ? before.map((x) => x.f) : [];
      const named = before[0]?.f ?? (facts.length === 1 ? facts[0] : undefined);
      const whom = group.length > 1 ? group : named ? [named] : [];
      const off = whom.some((f) => {
        if (f.pct === null || !Number.isFinite(f.pct)) return false;
        const live = f.pct;
        const wrongSign = Math.abs(live) >= 0.1 && Math.abs(mv.val) >= 0.1 && Math.sign(live) !== Math.sign(mv.val);
        return wrongSign || Math.abs(Math.abs(mv.val) - Math.abs(live)) > tolPp;
      });
      if (off) { bad.push(raw); break; }
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
  for (const c of crossedLevelClaims(text, facts)) if (!bad.includes(c)) bad.push(c);
  return bad;
}

/** A level the price is said to have CROSSED or HIT that it never reached (round 7 native: "BTC surged past $87,000"
 *  when its highest close was $86,602.91 and it trades at $84,077). Checked against the holding's high / low over the
 *  recent window (`high`/`low` on its fact: closes and live ticks). Conditions and targets ("if it breaks $90K",
 *  "needs to reclaim $2,800", "support at $80K") are not claims and stay. */
export function crossedLevelClaims(text: string, facts: LiveFact[], tolPct = 0.3): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    if (/\b(?:if|could|would|might|may|needs? to|must|target|targets|support|resistance|reclaim|fails? to|watch|tripwire|should|unless|a move (?:above|below)|break (?:above|below))\b/i.test(s)) continue;
    const UP = /\b(?:surg\w*|rose|ris\w*|rallied|rall\w*|climb\w*|jump\w*|push\w*|broke|break\w*|topp?\w*|soar\w*|spik\w*|trad\w*|mov\w*|ran|run\w*|clear\w*)\s+(?:back\s+)?(?:past|above|over|through|beyond)\s+(\$\s?[\d,.]+\s?[kKmM]?)|\b(?:hit|hits|reached|reaches|touched|tagged|topped|set a (?:new )?high (?:of|at|near))\s+(?:a (?:new )?(?:high|record) (?:of|at|near)\s+)?(\$\s?[\d,.]+\s?[kKmM]?)/gi;
    const DOWN = /\b(?:fell|fall\w*|dropp?\w*|slid|slump\w*|sank|sink\w*|tumbl\w*|plung\w*|dipp?\w*|broke|break\w*)\s+(?:back\s+)?(?:below|under|through)\s+(\$\s?[\d,.]+\s?[kKmM]?)/gi;
    const val = (t: string) => { const m = /\$\s?([\d,.]+)\s?([kKmM]?)/.exec(t); if (!m) return NaN; const n = Number(m[1].replace(/,/g, "")); return m[2].toLowerCase() === "k" ? n * 1e3 : m[2].toLowerCase() === "m" ? n * 1e6 : n; };
    const who = (at: number) => facts.map((f) => ({ f, i: firstIdx(s, f.names) })).filter((x) => x.i <= at).sort((a, b) => b.i - a.i)[0]?.f ?? (facts.length === 1 ? facts[0] : undefined);
    let hit = false;
    for (const m of s.matchAll(UP)) {
      const v = val(m[1] ?? m[2] ?? ""), f = who(m.index ?? 0);
      if (f && typeof f.high === "number" && f.high > 0 && v > f.high * (1 + tolPct / 100)) { hit = true; break; }
    }
    if (!hit) for (const m of s.matchAll(DOWN)) {
      const v = val(m[1] ?? ""), f = who(m.index ?? 0);
      if (f && typeof f.low === "number" && f.low > 0 && v < f.low * (1 - tolPct / 100)) { hit = true; break; }
    }
    if (hit) bad.push(raw);
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
  const parts = String(note ?? "").split(/(?<=[.!?])[ \t]+/);
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

// ---------------------------------------------------------------------------------------------
// Round 3 (2026-09-25): shortlists, deliveries dates, unsupported dated claims, bullets, card jargon
// ---------------------------------------------------------------------------------------------
/** A question that asks for ONE pick or a destination ("the one stock you'd dump", "which would you keep",
 *  "where would my cash go"). An answer to it that lists some of the holdings IS the pick. */
export function isPickQuestion(q: string): boolean {
  const t = String(q ?? "");
  return /\bthe one\b|\bwhich (?:of (?:my|your|the|these) )?(?:one|ones|stock|stocks|holding|holdings|name|names|position|positions)\b[^?.]{0,50}\b(?:buy|sell|dump|trim|keep|add|cut|ditch|drop|own|pick|choose|get rid|invest in|put|double down|load up|best|worst)\b|\bwhere (?:would|should|could)\b|\byou(?:'?d| would) (?:dump|sell|buy|keep|pick|choose|add|cut|ditch|drop)\b|\bwould you (?:dump|sell|buy|keep|pick|choose|add|cut|ditch|drop)\b|\b(?:top|best|your) pick\b|\bif you had\b|\bwhat (?:would|should|could|can) (?:you|i) (?:do|buy) with\b|\bwhat should i buy\b|\b(?:\d+|two|three|four|five|a few|some) (?:best|top|good) (?:stocks?|picks?|names|holdings?|buys?)\b|\bbest (?:stocks?|picks?|names) to (?:buy|own|add)\b/i.test(t)
    || /(어떤 종목|어느 종목|하나만|어디에|뭘 사|무엇을 사|뭘 팔|무엇을 팔)/.test(t);
}
/** Lines of an answer that open on a holding's name, when they cover SOME but not all of the book: a curated
 *  shortlist. Round 3: "the one stock you'd dump" got "META: ... / AVGO: ... / AMZN: ... / TSLA: ..." (four
 *  dump candidates, each with its negative) and "$120K cash, where would it go?" got "MSFT: ... / NVDA: ...".
 *  A line per holding for the whole book (a fact table) is not a shortlist. */
export function curatedListHits(text: string, book: { symbol: string; names: string[] }[]): string[] {
  const lines = String(text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const led = lines.map((l) => {
    const head = bare(l).replace(/\*\*/g, "").slice(0, 48);
    const hit = book.find((b) => b.names.some((n) => n && n.length >= 2 && new RegExp(`^(?:the\\s+)?${esc(n)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(head)));
    return hit ? { line: l, symbol: hit.symbol } : null;
  }).filter((x): x is { line: string; symbol: string } => !!x);
  const distinct = new Set(led.map((x) => x.symbol));
  if (distinct.size < 2 || distinct.size >= book.length) return [];
  return led.map((x) => x.line);
}

/** "• A. • B. • C." on one line (the model returned bullets without newlines) becomes one bullet per line. */
export const normalizeBullets = (t: string): string => String(t ?? "").replace(/[ \t]+•\s+/g, "\n• ").replace(/^\s*•\s*/, "• ")
  // a fact table joined by semicolons in one bullet ("NVDA $224, 19.1%; AAPL $336, 13.6%; ...", round 4)
  .split("\n").map((line) => {
    const parts = line.replace(/^\s*•\s*/, "").split(/;\s+/);
    // round 6: any run of 3+ short clauses ("BTC down 0.9% (largest 25% weight); cash stable $18.5k; SK hynix up
    // 1.2%; ...") is a table, whatever case each clause starts with
    const short = parts.every((p) => p.trim().split(/\s+/).length <= 14);
    const upper = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
    return parts.length >= 3 && short ? parts.map((p) => "• " + upper(p.trim().replace(/[.;]$/, "")) + ".").join("\n") : line;
  }).join("\n").trim();

const DELIVERIES_REPORTERS = new Set(["TSLA", "RIVN", "LCID", "NIO", "XPEV", "LI", "POLE"]);
/** Companies that publish a quarterly DELIVERIES / production report, separate from earnings: Tesla's comes out
 *  on about the 2nd day after the quarter ends (Oct 2 for Q3). Round 3: a card and Ask said "Q3 deliveries due
 *  late October", confusing deliveries with the earnings release. Null for everyone else. */
export function deliveriesEstimate(symbol: string, todayYmd: string): { quarter: string; est: string } | null {
  if (!DELIVERIES_REPORTERS.has(symbol.replace(/-USD$/, ""))) return null;
  const [y, m] = todayYmd.split("-").map(Number);
  // the quarter that just ended (its report may still be ahead: Oct 1 -> Oct 2) or the one that ends next
  const qEnd = Math.ceil(m / 3) * 3;
  for (const end of [qEnd - 3, qEnd]) {
    const est = new Date(Date.UTC(y, end, 2)).toISOString().slice(0, 10);   // the 2nd of the month after the quarter ends
    if (est >= todayYmd) { const qy = end <= 0 ? y - 1 : y; const qn = ((end + 11) % 12 + 1) / 3; return { quarter: `Q${qn} ${qy}`, est }; }
  }
  return null;
}
const MONTH_RE = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\\.?";
/** Every "Mon D", "D Mon" and "early / mid / late Month" in a text, as YYYY-MM-DD relative to today (a date more
 *  than two months in the past rolls into next year); a part of a month maps to its 5th / 15th / 25th. */
export function datesIn(text: string, todayYmd: string): { raw: string; ymd: string; approx: boolean; at: number }[] {
  const out: { raw: string; ymd: string; approx: boolean; at: number }[] = [];
  const y0 = Number(todayYmd.slice(0, 4)), m0 = Number(todayYmd.slice(5, 7));
  const mk = (mon: string, d: number, raw: string, approx: boolean, at = 0) => {
    const mo = MON_IDX[mon.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3)];
    if (!mo || d < 1 || d > 31) return;
    const y = y0 + (mo < m0 - 2 ? 1 : 0);
    out.push({ raw, ymd: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, approx, at });
  };
  const s = String(text ?? "");
  for (const m of s.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"))) mk(m[1], Number(m[2]), m[0], false, m.index ?? 0);
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b`, "gi"))) mk(m[2], Number(m[1]), m[0], false, m.index ?? 0);
  for (const m of s.matchAll(new RegExp(`\\b(early|mid|late)[- ]${MONTH_RE}`, "gi"))) mk(m[2], m[1].toLowerCase() === "early" ? 5 : m[1].toLowerCase() === "mid" ? 15 : 25, m[0], true, m.index ?? 0);
  for (const m of s.matchAll(/(\d{1,2})월\s*(\d{1,2})일/g)) mk(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][Number(m[1]) - 1] ?? "", Number(m[2]), m[0], false);
  for (const m of s.matchAll(/(\d{1,2})월\s*(초|중순|말)/g)) mk(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][Number(m[1]) - 1] ?? "", m[2] === "초" ? 5 : m[2] === "중순" ? 15 : 25, m[0], true);
  return out;
}
/** Sentences that date a DELIVERIES / production report away from the known estimate (more than 5 days, or
 *  10 for "early / mid / late Month"), or date one for a company that publishes none on our list. */
export function wrongDeliveriesDates(text: string, facts: { names: string[]; est: string | null }[], todayYmd: string): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    const kw = raw.search(/\b(deliver(?:y|ies)|production (?:report|numbers|figures)|units? (?:report|numbers))\b|인도량|판매량 발표/i);
    if (kw < 0) continue;
    // the date that belongs to the deliveries claim is the one nearest the word ("deliveries ~Oct 2, weeks
    // before earnings around Oct 21" dates deliveries Oct 2)
    const all = datesIn(raw, todayYmd).sort((a, b) => Math.abs(a.at - kw) - Math.abs(b.at - kw));
    if (!all.length) continue;
    const ds = [all[0]];
    const who = facts.find((f) => f.names.some((n) => n && nameIn(raw, n))) ?? (facts.length === 1 ? facts[0] : undefined);
    if (!who) continue;
    if (!who.est || ds.some((d) => Math.abs(dayDiff(d.ymd, who.est!)) > (d.approx ? 10 : 5))) bad.push(raw);
  }
  return bad;
}
/** Future-dated claims ("Meta AI spend guidance Sep 30", "Microsoft earnings call Sep 28") whose date appears
 *  nowhere in the data the writer was given (the estimates, the sessions, the headlines). Round 3 found both
 *  in a served midday brief; dates are the one kind of fact a reader cannot sanity-check. */
export function unsupportedDated(items: string[], sourceText: string, todayYmd: string, extraYmds: string[] = []): string[] {
  const allowed = [...datesIn(sourceText, todayYmd).map((d) => d.ymd), ...extraYmds];
  return items.filter((it) => datesIn(it, todayYmd).some((d) => d.ymd >= todayYmd && !allowed.some((a) => Math.abs(dayDiff(a, d.ymd)) <= (d.approx ? 10 : 1))));
}

/** Plain words for the shared per-stock cards (every reader sees the same card): desk slang the model keeps
 *  writing. Round 3: "show-me tape", "NVDA keeps ripping", "tape bid 0.5% higher", "bulls lean on". */
export const CARD_PLAIN: [RegExp, string][] = [
  [/\bshow-me tape\b/gi, "market that wants proof"], [/\bshow-me (?:story|market)\b/gi, "market that wants proof"],
  [/\bkeeps ripping\b/gi, "keeps rising fast"], [/\bkept ripping\b/gi, "kept rising fast"], [/\bripping\b/gi, "rising fast"], [/\brips? higher\b/gi, "jumps"],
  [/\btape (?:is |was )?bid\b/gi, "the stock is trading"], [/\bthe tape\b/gi, "trading"], [/\btape\b/gi, "trading"],
  [/\bbulls lean on\b/gi, "supporters point to"], [/\bbears lean on\b/gi, "skeptics point to"], [/\bbulls\b/gi, "optimists"], [/\bbears\b/gi, "skeptics"],
  [/\bpinned (?:near|at|around)\b/gi, "holding near"], [/\bTAM\b/g, "market size"], [/\bY1\b/g, "year one"], [/\bMorningstars\b/g, "Morningstar's"],
  [/\bthe street keeps underweighting\b/gi, "analysts keep underrating"], [/\bdouble-edged catalyst\b/gi, "event that could cut either way"], [/\boverhangs\b/gi, "risks hanging over it"], [/\boverhang\b/gi, "risk hanging over it"], [/\bthe street\b/gi, "analysts"], [/\bcapitulat(?:ing|ion)\b/gi, "giving up"],
];

/** Lines a shared card must never carry: pipeline internals ("Two-year price history is unavailable", round 3
 *  KO card) and returns measured from a high or a low instead of the trailing window ("up 242.7% from the 1Y
 *  low" next to a 231.6% 1Y on the chart). */
export function cardCopyHits(text: string): string[] {
  return sentencesOf(text).filter((s) =>
    /\b(?:price )?(?:history|data|figures?|numbers?)\b[^.]{0,30}\b(?:unavailable|missing|not available|isn'?t available|not on file|lacking)\b|\bnot enough (?:price )?history\b|\bno (?:price )?(?:data|history) (?:on file|available|yet)\b|\bon file\b/i.test(s)
    || /\bfrom (?:its|the) (?:1Y |one-year |yearly |annual |2Y |two-year |recent )?(?:low|lows|high|highs|bottom|peak|trough)\b[^.]{0,20}\d|\d[^.]{0,30}\bfrom (?:its|the) (?:1Y |one-year |yearly |annual |2Y |two-year |recent )?(?:low|lows|high|highs|bottom|peak|trough)\b/i.test(s));
}

// Function words and modifiers a sentence can never end on ("... on sustained a shrinking price tag relative.")
const DANGLING_END = /\b(?:the|a|an|of|on|in|to|for|with|by|from|at|as|and|or|but|so|than|that|which|its|their|his|her|our|your|this|these|those|into|onto|over|under|about|between|against|toward|towards|through|across|amid|per|via|versus|vs|plus|including|relative|sustained|continued|further|ongoing|more|less|very|such|each|every|any|some|no|not|also|still|just|even|only|is|are|was|were|be|been|has|have|had|will|would|could|should|can|may|might)\s*[.!?]?$/i;
/** Sentences a reader would stop at: a dangling ending, a doubled or stacked article, an article in front of
 *  another determiner or an adjective-less gap, two amounts run together with no verb ("Total assets $26,600
 *  cash $2,500"), or a bare "book" without a determiner ("risk for book overall performance"). Round 3
 *  newcomer's first assessment: "Watch QQQ on sustained a shrinking price tag relative." */
export function brokenSentences(text: string): string[] {
  return sentencesOf(text).filter((raw) => {
    const s = bare(raw).replace(/[)"'’”]+$/, "");
    // "It adds." (round 5): a pronoun and a verb with nothing after is a fragment left by a deletion
    if (s.split(/\s+/).length < 3) return /^(?:it|this|that|they|these|those|he|she)\s+\w+[.!]?$/i.test(s);
    return DANGLING_END.test(s.replace(/[.!?]+$/, ""))
      || /\b(the|a|an)\s+(the|a|an)\b/i.test(s)
      || /\b(sustained|continued|further|ongoing|persistent|renewed|steady|heavy|deeper|more|less)\s+an?\s+/i.test(s)
      || /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?[kKmMbB]?\s+(?!(?:vs|versus|to|and|or|from|plus|minus|over|against|in|of|per|at)\b)[a-z]+\s+\$\d/.test(s)
      || /\b(?:for|of|to|in|on) book\b/i.test(s)
      || /\b(?:a|an|the)\s*[.!?]$/i.test(s)
      // round 6: "lags S&P 500 by than ten percent", "is the main portfolio.", "US companies, weighted.", "and keep
      // health", "has sheet"
      || /\bby than\b|\bis the (?:main|biggest|largest|key) (?:portfolio|book)\s*[.!?]?$|,\s*weighted\s*[.!?]?$|\bkeep health\b|\bhas sheet\b|\bprovides exposure and\b/i.test(s)
      // round 6 replay: the memo's quality list flattened with its adjectives dropped ("It has an edge, profit and
      // solid balance sheet", "It has an edge, sticky contracts, profit and a balance sheet"), and an object-less
      // "It offers exposure."
      || /\bhas (?:a |an )?(?:lasting |dominant |platform |real )*edge(?: (?:in|with) [A-Za-z]+)?,? (?:(?:sticky contracts|profit|cash|margins),? (?:and )?)+(?:a |an |solid |strong |net cash )?balance sheet\b/i.test(s)
      || /^(?:it|this|the fund)\s+(?:offers|gives|provides|adds)\s+exposure\s*[.!]?$/i.test(s)
      // round 7: "It 13.9% of assets and gives a 0.16% dividend $11 yearly."
      || /^(?:it|this|that|they|its)\s+[+\-−]?\$?\d/i.test(s)
      || verblessList(raw).length > 0;
  });
}
/** Stack of articles and an article after a modifier, left by a gloss swapped into a sentence ("on sustained a
 *  shrinking price tag", "the the market") - deletion of the stray article only. */
export const fixGlossArticles = (t: string): string => String(t ?? "")
  .replace(/\b(sustained|continued|further|ongoing|persistent|renewed|steady|heavy|deeper|more|less)\s+an?\s+/gi, "$1 ")
  .replace(/\b(the|a|an)\s+(?=(?:the|a|an)\s)/gi, "");

/** Everyday words for the portfolio in every reader-facing text (Ask, briefs, cards): "your book" is desk
 *  jargon for a portfolio, "tape" for the market, "names" for stocks (round-3 native review). Words that only
 *  look alike are left alone ("book value", "the company's name"). */
export const PORTFOLIO_PLAIN: [RegExp, string][] = [
  // round 7: "artificial-intelligence" spelled out five times in one assessment; AI is the everyday word
  [/\bartificial[- ]intelligence\b/gi, "AI"],
  [/\b(your|the|this|whole|entire|overall|a|their|my)\s+book(?!\s+(?:value|values|of business|to bill|ratio|keeping))\b/gi, "$1 portfolio"],
  [/\bbook-level\b/gi, "portfolio-level"], [/\bbook-wide\b/gi, "portfolio-wide"],
  [/\b(the|a|quiet|this|today's)\s+tape\b/gi, "$1 market"],
  [/\b(your|these|those|the|other|single|one|each|every|US|Korean|tech|chip|growth|AI|megacap|big|biggest|largest|top|two|three|four|five|several|many|few|both|held|such)\s+names\b/gi, "$1 stocks"],
  [/\b(single|one|each|every|any)\s+name\b(?!\s+(?:of|for|change))/gi, "$1 stock"],
];

const YEAR_RE = /\b(19\d{2}|20\d{2})\b/g;
/** Historical comparisons the data does not contain ("Tech concentration at 1965 highs", "the worst week since
 *  2008", "all-time high"): dropped unless the same year or phrase is in what the writer was given. */
export function historicalClaims(text: string, sourceText: string, todayYmd: string): string[] {
  const src = String(sourceText ?? "").toLowerCase();
  const thisYear = Number(todayYmd.slice(0, 4));
  return sentencesOf(text).filter((s) => {
    const years = [...s.matchAll(YEAR_RE)].map((m) => Number(m[1])).filter((y) => y <= thisYear - 2);
    if (years.some((y) => !src.includes(String(y)))) return true;
    const phrase = s.match(/\b(all-time (?:high|low)s?|record (?:high|low)s?|(?:highest|lowest|most|least|biggest|largest|worst|best|strongest|weakest|first) (?:level |close |week |month |quarter |year )?since)\b/i)?.[1];
    return !!phrase && !src.includes(phrase.toLowerCase().split(" ")[0] === "all-time" ? "all-time" : phrase.toLowerCase().includes("record") ? "record" : "since");
  });
}

// ---------------------------------------------------------------------------------------------
// Round 4 (2026-09-25): earnings months, verbless lists, spoken scripts, calendar labels
// ---------------------------------------------------------------------------------------------
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** A sentence that puts a holding's report in a month its estimate does not cover ("NVDA reports in December"
 *  when the estimate is mid to late November, round 4). English month names and Korean "N월". */
export function wrongEarningsMonths(text: string, ests: { names: string[]; est: string | null; range?: [string, string] }[]): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    if (!/\b(earnings|results|reports?|reporting|quarterly|print|call)\b|실적|어닝/i.test(raw)) continue;
    // every holding the sentence names (round 5: "MSFT, AAPL and NVDA report in late October" passed on MSFT)
    const named = ests.filter((e) => e.est && e.names.some((n) => n && nameIn(raw, n)));
    if (!named.length) continue;
    const months = [
      ...[...raw.toLowerCase().matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g)].map((m) => MONTH_NAMES.indexOf(m[1]) + 1),
      ...[...raw.matchAll(/(\d{1,2})월/g)].map((m) => Number(m[1])),
    ].filter((m) => m >= 1 && m <= 12);
    if (!months.length) continue;
    if (named.some((who) => {
      const [lo, hi] = who.range ?? [who.est!, who.est!];
      const allowed = new Set([Number(lo.slice(5, 7)), Number(hi.slice(5, 7))]);
      return months.every((m) => !allowed.has(m));
    })) bad.push(raw);
  }
  return bad;
}

const VERB_HINT = /\b(is|are|was|were|be|been|has|have|had|rose|fell|gained|lost|added|slipped|climbed|dropped|trades?|traded|sits?|sat|closed|opened|moved|leads?|led|holds?|held|shows?|showed|stands?|stood|ended|finished|jumped|sank|edged|dipped|rallied|slid|remains?|remained|hit|reached|makes?|made|means?|meant|drives?|drove|carries|carried|reports?|reported|expects?|expected|grew|grows|rises?|falls?|gets?|got|keeps?|kept|puts?|looks?|seems?|matters?|comes?|came|goes|went|owns?|pays?|paid|lifts?|lifted|weighs?|weighed|surged|tumbled|advanced|declined|eased|firmed|steadied)\b|\b\w+ed\b/i;
/** A list of figures with no verb ("S&P 500 7,737.41 (+0.4%), Nasdaq futures 30,887.75 (+0.7%), and one smaller
 *  position.", round 4 midday brief): a fragment, never a sentence. */
export function verblessList(text: string): string[] {
  return sentencesOf(text).filter((raw) => {
    const s = bare(raw).replace(/\([^)]*\)/g, " ");
    // a thousands separator is not a list comma ("the ₩1,862,000 price" is one figure)
    return (s.match(/(?<!\d),|,(?!\d)/g) ?? []).length >= 2 && (raw.match(/\d/g) ?? []).length >= 4 && !VERB_HINT.test(s);
  });
}

/** Spoken-script sentences that must not be read aloud: a promise about returns or goals ("boosting future
 *  returns", "should enhance long-term returns", "aligns with your goals"), a trade or valuation call, a
 *  threshold on a day move ("if NVIDIA falls below zero point two percent"), a move read as a weight
 *  ("Microsoft added three point seven percent weight" when it rose 3.7%), a broken sentence, or a
 *  historical comparison the brief does not make. Round 4: the midday script said all of these. */
export function scriptProblems(script: string, sectionsText: string, todayYmd: string): string[] {
  const src = String(sectionsText ?? "");
  const movePcts = new Set([...src.matchAll(/\b(?:up|down|rose|fell|gained|lost|slipped|climbed|jumped|dropped|added|shed|rallied|declined)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s?%/gi)].map((m) => Number(m[1])));
  const weightPcts = new Set([...src.matchAll(/(\d+(?:\.\d+)?)\s?%\s+(?:of (?:assets|the portfolio|your portfolio|the book|holdings)|weight|stake)/gi)].map((m) => Number(m[1])));
  const numOf = (s: string) => [...s.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|percent)/gi)].map((m) => Number(m[1]));
  return String(script ?? "").replace(/<break[^>]*\/>/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).filter((s) =>
    /\b(?:boost(?:s|ing)?|enhanc(?:e|es|ing)|improv(?:e|es|ing)|lift(?:s|ing)?|rais(?:e|es|ing)|increas(?:e|es|ing)|supercharg\w*)\b[^.]{0,30}\b(?:future |long-term |your |its )?returns?\b|\baligns? with your (?:long-term )?goals\b|\b(?:should|will|would) (?:deliver|pay off|reward|enhance|boost)\b|\boutlook improves\b/i.test(s)
    || adviceHits(s).length > 0 || valuationHits(s).length > 0
    || /\b(?:falls?|drops?|slips?|dips?|rises?|climbs?)\s+(?:below|above|under|past)\s+(?:zero point \w+|0\.\d+|\d?\.\d+)\s?(?:%|percent)/i.test(s)
    || (/\bweight\b|\bstake\b|\bof your (?:holdings|portfolio)\b/i.test(s) && /\badded\b|\bgained\b/i.test(s) && numOf(s).some((n) => movePcts.has(n) && !weightPcts.has(n)))
    || brokenSentences(s).length > 0 || verblessList(s).length > 0
    || historicalClaims(s, src, todayYmd).length > 0
    // round 8 close script: a figure spoken for the wrong subject ("Oracle … more than five point one percent" was the
    // VIX change), checked with spelled numbers read as digits
    || misplacedScriptFigures(s, src).length > 0
    || productPushHits(s).length > 0 || promoCharacterisations(s).length > 0);
}

/** Calendar lines built from the computed estimates, never from the model's wording: "Microsoft earnings
 *  expected ~Oct 28 (est)", "Nvidia earnings expected mid to late November (est)". Round 4: the midday brief
 *  listed "Oct 28 earnings call MSFT", "Oct 29 earnings preview AAPL" and an invented "Oct 28 AI spend update
 *  META" as facts. A model item about a holding's earnings is replaced by its estimate line; any other dated
 *  item must share a content word with a dated line in the writers' sources, or it goes. */
export function canonicalCalendar(items: string[], ests: { names: string[]; label: string; est: string | null; range?: [string, string] }[], sourceText: string, todayYmd: string): string[] {
  const out: string[] = [];
  const srcLines = String(sourceText ?? "").split(/\n+/);
  const MONTHISH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[a-z]*)$/;
  const words = (x: string) => new Set((x.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !(MONTHISH.test(w) && MONTH_NAMES.some((m) => m.startsWith(w)) || w === "sept")));
  for (const raw of items) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const who = ests.find((e) => e.names.some((n) => n && nameIn(t, n)));
    if (who && /\b(earnings|results|reports?|reporting|quarterly|Q[1-4]|call|print|preview)\b/i.test(t)) {
      if (!who.est) continue;
      const line = who.range ? `${who.label} earnings expected ${spanOfMonth(who.range)} (est)`
        : `${who.label} earnings expected ~${new Date(who.est + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} (est)`;
      if (!out.includes(line)) out.push(line);
      continue;
    }
    const ds = datesIn(t, todayYmd);
    const mine = words(t);
    for (const e of ests) for (const n of e.names) for (const w of words(n)) mine.delete(w);
    const supported = !ds.length || srcLines.some((l) => datesIn(l, todayYmd).some((d) => ds.some((x) => Math.abs(dayDiff(d.ymd, x.ymd)) <= 1)) && [...mine].some((w) => l.toLowerCase().includes(w)));
    if (supported && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A move explained by profit-taking or by who "warned", with no headline saying so (round 3/4: "META's drop
 *  is profit-taking, not a thesis break"; "트윌리오가 경고했고 투자자들이 이익을 확정"). A cause is a fact: it
 *  needs a source. */
export function unsupportedCauses(text: string, sourceText: string): string[] {
  const src = String(sourceText ?? "").toLowerCase();
  return sentencesOf(text).filter((s) => {
    if (/\b(profit[- ]taking|taking profits|took profits|cashing out|locked? in gains|traders? (?:sold|cashing)|selling after a big (?:gain|run))\b|이익을?\s?(?:실현|확정)|차익\s?실현/i.test(s)) return !/profit|차익|이익 실현/.test(src);
    const warned = s.match(/\b([A-Z][\w&.-]+)(?:'s)? (?:warned|warns|warning)\b/);
    return !!warned && !src.includes(warned[1].toLowerCase());
  });
}

// ---------------------------------------------------------------------------------------------
// Round 4 newcomer / poweruser (2026-09-25): plain-language glosses in context, dividends, period returns
// ---------------------------------------------------------------------------------------------
/** The beginner vocabulary map, one copy for every writer (it was duplicated in daily-brief and insights-sync
 *  and the copies drifted). `sample` is a phrase the entry must rewrite; the tests put every entry through
 *  three contexts. */
export type Gloss = { re: RegExp; plain: string; sample: string };
export const NOVICE_PLAIN: Gloss[] = [
  { re: /\bshort interest\b/gi, plain: "bets against the stock", sample: "short interest" },
  { re: /\bof float\b/gi, plain: "of its tradable shares", sample: "of float" },
  { re: /\bleverage(d)?\b/gi, plain: "borrowed money", sample: "leverage" },
  { re: /\bhigh[- ]beta\b/gi, plain: "fast-moving", sample: "high-beta" },
  { re: /\bbeta\b/gi, plain: "sensitivity to market swings", sample: "beta" },
  { re: /\bvaluation multiples?\b/gi, plain: "price tag relative to earnings", sample: "valuation multiple" },
  { re: /\bmultiple compression\b/gi, plain: "a shrinking price tag relative to earnings", sample: "multiple compression" },
  { re: /\b(?:net interest margin|lending profit margin|net interest income|NII|NIM)\b/g, plain: "profit on lending", sample: "NIM" },
  { re: /\b(?:common equity tier (?:one|1)(?: ratio)?|core capital ratio|CET\s?1(?: ratio)?|tier (?:1|one)(?: capital)?(?: ratio)?)\b/gi, plain: "its safety cushion of capital", sample: "CET1 ratio" },
  { re: /\bmegacaps?\b/gi, plain: "the biggest companies", sample: "megacap" },
  { re: /\bdry powder\b/gi, plain: "cash ready to invest", sample: "dry powder" },
  { re: /\b(?:net new money|net new assets|net flows?)\b/gi, plain: "money coming in from customers", sample: "net new money" },
  { re: /\b(?:price[- ]to[- ]book|book value per share|P\/B)\b/gi, plain: "what the company is worth on paper", sample: "price-to-book" },
  { re: /\b(?:price[- ]to[- ]earnings|P\/E)(?: ratio)?\b/gi, plain: "its price tag against profits", sample: "P/E" },
  { re: /\b(?:loan cost gap|net interest spread)\b/gi, plain: "the gap between what a bank earns and pays", sample: "net interest spread" },
  { re: /\b(?:assets? under management|AUM)\b/g, plain: "the money it manages for clients", sample: "AUM" },
  { re: /\b(?:deposit betas?|funding costs?)\b/gi, plain: "what it pays for deposits", sample: "funding costs" },
  { re: /\bROE\b/g, plain: "return on the owners' money", sample: "ROE" },
  { re: /\bROIC\b/g, plain: "return on invested money", sample: "ROIC" },
  { re: /\bEBITDA\b/g, plain: "operating profit", sample: "EBITDA" },
  { re: /\bFCF\b/g, plain: "spare cash flow", sample: "FCF" },
  { re: /\bEPS\b/g, plain: "earnings per share", sample: "EPS" },
  // round 5: "Burry's Big Tech capex warning" became "warning of the spending on equipment and buildout"; a
  // two-word gloss reads right as a noun AND as a modifier
  { re: /\bcapex\b/gi, plain: "equipment spending", sample: "capex" },
  { re: /\b(?:basis points|bps)\b/gi, plain: "hundredths of a percent", sample: "basis points" },
  { re: /\bshort-duration\b/gi, plain: "shorter-term", sample: "short-duration" },
  { re: /\blong-duration\b/gi, plain: "longer-term", sample: "long-duration" },
  // round 7: "ETF inflows turn negative" became "ETF new money turn negative" (a plural verb on a singular gloss); a
  // plural gloss keeps the verb right
  { re: /\bnet inflows\b/gi, plain: "net purchases", sample: "net inflows" },
  { re: /\binflows\b/gi, plain: "purchases", sample: "inflows" },
  { re: /\bnet outflows\b/gi, plain: "net withdrawals", sample: "net outflows" },
  { re: /\boutflows\b/gi, plain: "withdrawals", sample: "outflows" },
  { re: /\b(?:rotce|return on (?:tangible )?(?:common )?equity)\b/gi, plain: "bank profitability", sample: "ROTCE" },
  { re: /\broa\b/gi, plain: "profit on assets", sample: "ROA" },
  // round 7: "Its ecosystem moat" / "a wide moat" became "Its ecosystem lasting edge over competitors": after a
  // possessive, an adjective or a noun modifier, the one-word "edge" reads right
  { re: /(?<=\b(?:its|their|his|her|wide|narrow|deep|strong|durable|real|big|ecosystem|brand|network|cost|scale|data|software|platform|switching-cost|economic)\s+)moat\b/gi, plain: "edge", sample: "wide moat" },
  { re: /\bmoat\b/gi, plain: "lasting edge over competitors", sample: "moat" },
  { re: /\bdrawdowns?\b/gi, plain: "drop from the top", sample: "drawdown" },
  { re: /\bDAU\b/g, plain: "daily users", sample: "DAU" },
  { re: /\bvalue tilt\b/gi, plain: "value focus", sample: "value tilt" },
  { re: /\bgrowth tilt\b/gi, plain: "growth focus", sample: "growth tilt" },
  { re: /\btilt\b/gi, plain: "focus", sample: "tilt" },
  { re: /\bday P&L\b/gi, plain: "day's gain or loss", sample: "day P&L" },
  { re: /\bP&L\b/g, plain: "gain or loss", sample: "P&L" },
  { re: /\bVIX\b/g, plain: "the market's fear gauge", sample: "VIX" },
  { re: /\b(?:YoY|Y\/Y)\b/g, plain: "year over year", sample: "YoY" },
  { re: /\bQoQ\b/g, plain: "quarter over quarter", sample: "QoQ" },
  { re: /\btape\b/gi, plain: "market", sample: "tape" },
  { re: /\bhash ?power\b/gi, plain: "mining power", sample: "hashpower" },
  { re: /\bhash ?rate\b/gi, plain: "mining speed", sample: "hash rate" },
  { re: /\bcash drag\b/gi, plain: "idle cash", sample: "cash drag" },
  { re: /\brebalanc(?:e|ing)\b/gi, plain: "reshuffle", sample: "rebalancing" },
  { re: /\bgrowth premium\b/gi, plain: "high price tag", sample: "growth premium" },
  // round 7: "guide valuation" became "guide price tag": after a verb the gloss takes its article
  { re: /(?<=\b(?:guide|drive|drives|set|sets|support|supports|lift|lifts|pressure|pressures|cap|caps|justify|justifies|anchor|anchors|stretch|stretches|compress|compresses)\s+)valuations?\b/gi, plain: "the price tag", sample: "guide valuation" },
  { re: /\bvaluations?\b/gi, plain: "price tag", sample: "valuation" },
  // round 6: "the ₩1,862,000 print" (a price print) became "the ₩1,862,000 report": after a figure it is a price
  { re: /(?<=\d[\d,.]*\s)print\b/gi, plain: "price", sample: "1,862,000 print" },
  { re: /\bprint\b/gi, plain: "report", sample: "print" },
  { re: /\bcrypto[- ]beta\b/gi, plain: "crypto exposure", sample: "crypto-beta" },
];
// words that follow a term as a VERB, an adverb or a function word (so the term is a noun, not a modifier)
const GLOSS_HEAD = /^(?:risks?|scrutiny|plans?|warnings?|cycles?|budgets?|growth|guidance|boom|bust|story|concerns?|fears?|pressures?|outlook|trends?|levels?|ratios?|numbers?|figures?|data|headwinds?|tailwinds?|exposure|profile|strategy|discipline|targets?|surge|slowdown|cuts?|hikes?|spending|question|debate|premium|reset|squeeze|math|picture|trajectory|momentum|limits?|caps?|floor|ceiling|threshold|signals?|metrics?|expansion|compression|gap|spread|trade)$/i;
const NOT_NOUN = /^(?:is|are|was|were|be|been|has|have|had|and|or|but|of|in|on|at|to|for|with|by|as|that|which|who|than|from|into|over|under|about|remains?|stays?|looks?|seems?|rose|fell|grew|grows|rises|falls|jumps?|jumped|slows?|slowed|climbs?|climbed|drops?|dropped|matters?|hits?|tops?|beats?|misses|means?|surges?|surged|soars?|sinks?|lags?|leads?|weighs?|keeps?|helps?|hurts?|tracks?|trails?|runs?|comes?|goes|holds?|makes?|takes?|needs?|continues?|continued|shows?|showed|suggests?|could|would|should|will|may|might|can|must|also|still|now|again|alone|itself|too|here|there|this|these|those|the|a|an|its|their|our|your|his|her|if|while|because|so|when|where|then|just|only|even|both|each|every|ever|never|already|below|above|near|around|across|after|before|since|until|through|during|without|within|against|toward|towards|per|vs|versus|up|down|out|off|higher|lower|more|less)$/i;
/** A beginner reader's plain words, grammatical in context. Round 4: "AI capex scrutiny" became "AI spending on
 *  equipment and buildout scrutiny", because a multi-word gloss was dropped in front of the noun the term was
 *  modifying. A term used as a MODIFIER ("capex scrutiny") now becomes "scrutiny of <gloss>"; one used as a
 *  noun is swapped in place, and a stray article left by a gloss that brings its own is removed. */
export function noviceGloss(text: string, keep: string[] = []): string {
  let x = String(text ?? "");
  // `keep`: map samples left as written (the assessment keeps "P/E", explained once by the writer)
  const MAP = NOVICE_PLAIN.filter((g) => !keep.includes(g.sample));
  for (const g of MAP) {
    const multi = g.plain.split(" ").length >= 3 || /^(?:a|an|the|its|their)\s/.test(g.plain);
    if (multi) {
      const bareGloss = g.plain.replace(/^(?:a|an|the)\s+/, "");
      x = x.replace(new RegExp(`(?:\\b(?:the|a|an)\\s+)?(?:${g.re.source})\\s+(?<noun>[a-z][a-z-]{2,})\\b`, g.re.flags.includes("i") ? "gi" : "g"), (...a: unknown[]) => {
        // (a named group: the map's own pattern may carry numbered groups)
        const m = String(a[0]), noun = String((a[a.length - 1] as { noun: string }).noun);
        // round 6 trace: "drawdown exceeds 20%" became "exceeds of the drop from the top 20%": only a known NOUN
        // head after the term makes it a modifier ("drawdown risk" -> "risk of the drop from the top")
        return NOT_NOUN.test(noun) || !GLOSS_HEAD.test(noun) ? m : `${noun} of ${/^(?:its|their)\s/.test(bareGloss) ? bareGloss : "the " + bareGloss}`;
      });
    }
  }
  x = plainScrub(x, MAP.map((g) => [g.re, g.plain] as [RegExp, string]));
  // a gloss that opens a sentence is capitalised ("Capex rose 40%" -> "Equipment spending rose 40%", round 5)
  for (const g of MAP) {
    const esc = g.plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    x = x.replace(new RegExp(`(^|(?<![A-Z]\\.[A-Z])[.!?]\\s+|\\n)(${esc})`, "g"), (_m, p: string, w: string) => p + w.charAt(0).toUpperCase() + w.slice(1));
  }
  // a modifier rewrite can open a sentence ("Drawdown risk" -> "risk of the drop from the top")
  return capSentenceStarts(fixGlossArticles(x).replace(/\b([Aa]n?|[Tt]he)\s+(its|their|his|her)\b/g, (_m, art: string, poss: string) => (/^[A-Z]/.test(art) ? poss.charAt(0).toUpperCase() + poss.slice(1) : poss))
    .replace(/\bof the (its|their)\b/g, "of $1"));
}

/** "86 %" / "86 percent" spacing and "+ 3.2%" are normalised to "86%" and "+3.2%" (round 4 assessment). */
export const tidyNumbers = (t: string): string => String(t ?? "")
  .replace(/(\d)\s+%/g, "$1%").replace(/([+−-])\s+(\d[\d,.]*\s?%)/g, "$1$2").replace(/\$\s+(\d)/g, "$$$1");

/** A risk clause that names a strength ("The risk: net cash balance sheet.", round 4 assessment). */
export const strengthAsRisk = (t: string): boolean =>
  /\b(?:the )?risk(?:s)?\s*(?:is|:|—|-)\s*(?:a |an |its |the )?(?:net[- ]cash|no debt|zero debt|debt-free|cash-rich|strong balance sheet|fortress balance sheet|pristine balance sheet|buybacks?|share repurchases?|dividend growth|rising dividends?|investment[- ]grade|wide moat|high margins?|steady cash flow)\b/i.test(String(t ?? ""));

// ---- dividends ----
export type DividendInfo = { last: number | null; lastEx: string | null; ttm: number | null; perYear: number | null; freqDays: number | null; nextEx: string | null; yieldPct: number | null };
/** Dividends from a Yahoo v8 chart response with events=div: the last amount and ex-date, the trailing 12-month
 *  sum, the payment rhythm, the next ex-date estimate (last + rhythm) and the yield on `price`. */
export function parseDividends(body: { chart?: { result?: { events?: { dividends?: Record<string, { amount?: number; date?: number }> } }[] } }, price: number | null, todayYmd: string, symbol = ""): DividendInfo | null {
  const ev = body?.chart?.result?.[0]?.events?.dividends ?? {};
  const pts = Object.values(ev).filter((d) => (d.amount ?? 0) > 0 && typeof d.date === "number")
    .map((d) => ({ ymd: new Date(d.date! * 1000).toISOString().slice(0, 10), amount: Number(d.amount) })).sort((a, b) => (a.ymd < b.ymd ? -1 : 1));
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const yearAgo = new Date(Date.parse(todayYmd + "T12:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
  const ttmPts = pts.filter((p) => p.ymd > yearAgo);
  const ttm = ttmPts.reduce((a, p) => a + p.amount, 0);
  const gaps = pts.slice(1).map((p, i) => Math.round((Date.parse(p.ymd) - Date.parse(pts[i].ymd)) / 86400000)).slice(-4);
  const freqDays = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
  let nextEx: string | null = null;
  if (freqDays && freqDays >= 20) {
    // Each rhythm candidate (last + freq, + 2·freq, …) takes the same quarter a year earlier + 364 days when that is on
    // file (round 5: KO's Q4 ex-date comes around Dec 1, not "last + 91" Dec 18), THEN the first date strictly after
    // today wins. Round 8: VOO's rhythm date was today (Sep 25), so it stepped to December before the year-ago
    // check could say Sep 28 (Sep 29 2025 + 364), and the husk said "none in 45 days".
    const todayT = Date.parse(todayYmd + "T12:00:00Z");
    const stamps = pts.map((p) => Date.parse(p.ymd + "T12:00:00Z"));
    for (let k = 1; k <= 8 && !nextEx; k++) {
      const t = Date.parse(last.ymd + "T12:00:00Z") + k * freqDays * 86400000;
      const want = t - 364 * 86400000;
      const yearAgo = stamps.filter((x) => Math.abs(x - want) <= 25 * 86400000).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      const cand = yearAgo ? yearAgo + 364 * 86400000 : t;
      if (cand > todayT) nextEx = new Date(cand).toISOString().slice(0, 10);
    }
  }
  // Round 7: a KRX quarterly payer's record date is the quarter's last day and its ex-date the KRX session before
  // it (T+2): Samsung's Q3 2026 ex-date is Tue Sep 29 (record Wed Sep 30), not the year-ago date + 364 (Sep 28)
  if (nextEx && /\.(?:KS|KQ)$/.test(symbol) && freqDays && freqDays >= 80 && freqDays <= 100) nextEx = krxExDate(nextEx, todayYmd);
  const perYear = freqDays ? last.amount * Math.max(1, Math.round(365 / freqDays)) : null;
  return { last: last.amount, lastEx: last.ymd, ttm: ttm > 0 ? Number(ttm.toFixed(4)) : null, perYear, freqDays, nextEx, yieldPct: price && ttm > 0 ? Number((ttm / price * 100).toFixed(2)) : null };
}
/** Dividend dollar figures that belong to another holding or to nothing on file (round 4: "SCHD paid $0.96
 *  quarterly"; SCHD's was $0.2665 and $0.9555 was VTI's). A figure must be within 3% of that holding's last
 *  payment, its 12-month total, a year at the current rate, or the owner's annual / per-payment income from it. */
export function wrongDividendAmounts(text: string, facts: { names: string[]; amounts: number[] }[]): string[] {
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    if (!/\b(dividends?|distributions?|payouts?|paid|pays|paying|income|yield)\b|배당|분배/i.test(raw)) continue;
    const vals = [...raw.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?[kKmM]\b)?/g)].map((m) => ({ v: moneyVal(m[1], (m[2] ?? "").trim()), at: m.index ?? 0 }));
    if (!vals.length) continue;
    for (const { v, at } of vals) {
      const who = facts.map((f) => ({ f, i: firstIdx(raw, f.names) })).filter((x) => x.i <= at).sort((a, b) => b.i - a.i)[0]?.f
        ?? (facts.length === 1 ? facts[0] : undefined);
      if (!who) continue;
      if (!who.amounts.some((a) => a > 0 && Math.abs(v / a - 1) <= 0.03)) { bad.push(raw); break; }
    }
  }
  return bad;
}

/** Period returns stated in a take ("up 453% in a year", "242.7% one-year run") must be the trailing-window
 *  return (round 4 poweruser: SK hynix +422%, Samsung +231.6%; the cards used the 12-month LOW). A figure from
 *  the low is fine only when it says so ("from its 12-month low"). `windows` maps days to the window return. */
export function periodReturnMismatches(text: string, facts: { names: string[]; windows: Record<number, number | null> }[], tolPp = 1): string[] {
  const WINDOW_WORDS: [RegExp, number][] = [
    // year to date first: "231.6% year to date" for Samsung was its 1Y figure (YTD +138.1%), round 5
    [/\b(?:year[- ]to[- ]date|YTD|so far this year|this year|since (?:the start of the year|January))\b|올해|연초\s?(?:대비|이후)/i, YTD],
    [/\b(?:in a year|one-year|1-year|1Y|12-month|twelve-month|over the (?:past|last) year|year-over-year run|on the year|past 12 months|in the past year|a year ago)\b|1년(?:\s?(?:간|동안|새|수익률))?|지난\s?1년/i, 365],
    [/\b(?:two-year|2-year|2Y|over (?:the )?(?:past |last )?two years|in two years)\b/i, 730],
    [/\b(?:two-month|2-month|60-day|over (?:the )?(?:past |last )?two months)\b/i, 60],
    [/\b(?:one-month|1-month|30-day|this month|over the (?:past|last) month|in a month)\b|한\s?달|1개월/i, 30],
    [/\b(?:one-week|1-week|this week|over the (?:past|last) week|in a week|five-day|5-day)\b|이번\s?주|1주(?:일)?(?:\s?(?:간|동안))?/i, 7],
  ];
  const bad: string[] = [];
  for (const raw of sentencesOf(text)) {
    if (/\bfrom (?:its|the) (?:12-month|52-week|one-year|1Y|yearly|recent)?\s?(?:low|high|lows|highs|bottom|peak)\b/i.test(raw)) continue;
    const w = WINDOW_WORDS.find(([re]) => re.test(raw))?.[1];
    if (!w) continue;
    const pcts = [...raw.matchAll(/([+−-]?\d+(?:\.\d+)?)\s?%/g)].map((m) => ({ v: Math.abs(Number(m[1].replace("−", "-"))), at: m.index ?? 0 }));
    for (const p of pcts) {
      const who = facts.map((f) => ({ f, i: firstIdx(raw, f.names) })).filter((x) => x.i <= p.at).sort((a, b) => b.i - a.i)[0]?.f ?? (facts.length === 1 ? facts[0] : undefined);
      const truth = who?.windows[w];
      if (truth === null || truth === undefined) continue;
      if (Math.abs(p.v - Math.abs(truth)) > Math.max(tolPp, Math.abs(truth) * 0.02)) { bad.push(raw); break; }
    }
  }
  return bad;
}

/** A dated event on a weekend (markets and companies do not hold earnings calls on a Sunday: round 4 midday
 *  brief "Copilot earnings preview Sep 27"). */
export function weekendDated(items: string[], todayYmd: string): string[] {
  return items.filter((it) => datesIn(it, todayYmd).some((d) => !d.approx && [0, 6].includes(new Date(d.ymd + "T12:00:00Z").getUTCDay())));
}

// ---------------------------------------------------------------------------------------------
// Round 5 (2026-09-25): exposure figures, promotional and forecast lines, hypothetical figures, risk-profile ideas
// ---------------------------------------------------------------------------------------------
/** "VOO rise and fall" (round 5): a single ticker (or "it", "the fund") takes a singular verb. */
export const fixAgreement = (t: string): string => String(t ?? "").replace(
  /(?<!(?:\band|\bor|,|&|\bwith)\s+)\b((?:[A-Z]{2,5}(?:\.[A-Z]{1,2})?)|[Ii]t|[Tt]he fund|[Tt]he stock|[Tt]he portfolio)\s+(rise|fall|move|trade|track|drop|climb|swing|react|lag|lead)(\s+and\s+)(rise|fall|move|drop|climb|swing|react|lag|lead)\b/g,
  (_m, subj: string, v1: string, and: string, v2: string) => `${subj} ${v1}s${and}${v2}s`);

/** Promotional or unsupported product claims in the app's voice ("captures the full S&P 500 upside while
 *  avoiding individual stock fees", round 5): not analysis. */
export function promoClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => /\bcaptures? (?:the )?(?:full|entire|all (?:of )?the)\b[^.]{0,40}\bupside\b|\bavoid(?:s|ing)? (?:individual[- ])?stock fees\b|\bwithout (?:the |any )?(?:risk|downside)\b|\b(?:risk-free|guaranteed|can'?t lose|no-lose)\b|\bwhile keeping (?:costs|fees|expenses) low\b|\bat (?:almost )?no cost\b/i.test(s));
}
/** A return forecast in the app's voice ("should support a 4-8% annual return", round 5). */
export function returnForecasts(text: string): string[] {
  return sentencesOf(text).filter((s) => /\b(?:long[- ](?:run|term) )?(?:significant |strong |outsized |big )?return potential\b|\bsignificant (?:long[- ](?:run|term) )?returns?\b(?! (?:so far|this year|since))/i.test(s) || /\b(?:support|deliver|generate|produce|achieve|reach|hit|earn|return|yield|compound(?:ing)? at)\w*\b[^.]{0,40}?\b\d+(?:\.\d+)?(?:\s?(?:-|–|to)\s?\d+(?:\.\d+)?)?\s?%\s*(?:an?\s+|per\s+)?(?:annual(?:ly|ized)?|a year|per year|yearly|each year)?\s*(?:returns?|gains?|growth)\b/i.test(s)
    && !/\b(?:target|goal|you (?:set|chose|picked)|your (?:target|goal))\b/i.test(s) || /\b(?:should|will|can)\s+(?:return|earn|deliver|compound)\b[^.]{0,30}\d+(?:\.\d+)?\s?%/i.test(s));
}
/** An idea to ADD to crypto for a reader whose profile is not crypto (round 5: a stability / income investor
 *  was told to "improve the modest Bitcoin position"). */
export function offRiskIdea(idea: string, styles: string[]): boolean {
  if (styles.includes("crypto")) return false;
  return /\b(?:crypto|bitcoin|btc|ether(?:eum)?|solana|altcoins?)\b/i.test(idea) && /\b(?:improve|increase|add|grow|expand|build|raise|larger|bigger|more)\b/i.test(idea);
}

export type Exposure = { usEquity: number; krEquity: number; crypto: number; bonds: number; cash: number; other?: number };
const EXPOSURE_KEYS: [keyof Exposure, RegExp][] = [
  ["usEquity", /\b(?:US|U\.S\.|American)\s+(?:equit(?:y|ies)|stocks?|shares)(?:\s+exposure)?\b/i],
  ["krEquity", /\b(?:Korea(?:n)?|KRX)\s*(?:equit(?:y|ies)|stocks?|shares)?(?:\s+exposure)?\b/i],
  ["crypto", /\bcrypto(?:currency|currencies)?(?:\s+exposure)?\b/i],
  ["bonds", /\bbonds?(?:\s+(?:exposure|funds?|sleeve))?\b/i],
  ["cash", /\bcash\b/i],
];
/** Exposure percentages the text states ("the 46.4% US equity exposure") corrected to the computed ones
 *  (round 5: 46.4% was VOO alone; US equity was 69.2%). A figure is corrected only when it sits right next to the
 *  quantity it names; the correction comes from the same numbers the writer was given. */
export function fixExposure(text: string, exp: Exposure, tolPp = 1): string {
  let out = String(text ?? "");
  for (const [key, re] of EXPOSURE_KEYS) {
    const truth = exp[key];
    if (typeof truth !== "number") continue;
    const src = re.source;
    // "46.4% US equity" / "US equity exposure of 46.4%" / "US equity at 46.4%" / "US equity (46.4%)"
    const before = new RegExp(`(\\d+(?:\\.\\d+)?)\\s?%(\\s+(?:of\\s+(?:the\\s+)?(?:portfolio\\s+)?(?:is\\s+|in\\s+)?)?(?:${src}))`, "gi");
    const after = new RegExp(`((?:${src})\\s*(?:is|at|of|stands at|sits at|makes up|\\(|:|,)?\\s*(?:about|around|roughly)?\\s*)(\\d+(?:\\.\\d+)?)\\s?%`, "gi");
    out = out.replace(before, (m: string, n: string, rest: string) => Math.abs(Number(n) - truth) > tolPp ? `${truth.toFixed(1)}%${rest}` : m);
    out = out.replace(after, (m: string, lead: string, n: string) => Math.abs(Number(n) - truth) > tolPp ? `${lead}${truth.toFixed(1)}%` : m);
  }
  return out;
}

/** A dollar figure from an article, stated as if it were the reader's ("VOO: $10,450 tax on reinvested
 *  dividends", round 5; the article's hypothetical $1M stake): a figure of $1,000 or more that is not one of the
 *  reader's own numbers must say where it comes from ("an article estimates", "on a $1M stake"). */
export function unattributedDollars(text: string, own: number[]): string[] {
  return sentencesOf(text).filter((s) => {
    if (/\b(?:article|estimates?|example|hypothetical|illustrat\w*|according to|says|said|reports?|on a \$|for a \$|per \$|analysts?|survey)\b/i.test(s)) return false;
    return [...s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?[kKmMbBtT](?:illion|n)?\b)?/g)].some((m) => {
      const suf = (m[2] ?? "").trim().toLowerCase();
      if (/^[bt]/.test(suf)) return false;   // company-scale sizes are the story's, not the reader's
      const v = moneyVal(m[1], suf.startsWith("m") ? "m" : suf.startsWith("k") ? "k" : "");
      return v >= 1000 && !own.some((o) => o > 0 && Math.abs(v / o - 1) <= 0.03);
    });
  });
}
/** "no cash paid out" / "pays no dividend" about a holding that pays one (round 5: VOO, $1.962 a share in June). */
const NO_DIV = /\bno (?:cash|dividends?|payouts?|income) (?:is )?(?:paid|paid out|payout)?\b|\bpays? no (?:cash|dividends?)\b|\b(?:doesn'?t|does not|do not|don'?t|never) pays? (?:a |any )?(?:cash |regular )?(?:dividends?|payouts?|cash)\b|\bno cash paid out\b|\bnon-?dividend\b|배당(?:을|이)?\s?(?:없|주지 않|지급하지 않)/i;
const PAYS_DIV = /\bpays? (?:a |an |its )?(?:small |modest |regular |quarterly |steady )?(?:cash )?dividends?\b|\bprovides? (?:a )?(?:modest |small )?dividend\b|배당(?:을)? (?:주|지급)/i;
export function dividendContradictions(text: string, payers: { names: string[] }[]): string[] {
  return sentencesOf(text).filter((s) => NO_DIV.test(s) && payers.some((p) => p.names.some((n) => n && nameIn(s, n))));
}
/** Dividend sentences in a position note that contradict the holding's own record (round 6 trace: the fact-checker,
 *  given no dividend data, wrote "It does not pay a dividend" into the NVDA and QQQ notes). `pays` is the record:
 *  true, false, or null when unknown (then any dividend claim goes). */
export function noteDividendClaims(note: string, pays: boolean | null): string[] {
  return sentencesOf(note).filter((s) => (NO_DIV.test(s) && pays !== false) || (!NO_DIV.test(s) && PAYS_DIV.test(s) && pays !== true));
}

/** Data-pipeline words in reader copy ("no dividend data on file", "the rate on file", round 5). */
export const plainDataWords = (t: string): string => String(t ?? "")
  .replace(/\bthe (?:exchange )?rate on file\b/gi, "the latest stored rate")
  .replace(/\b(?:no |not )?(?:\w+ )?(?:data|figures?|numbers?|dates?|history|record) on file\b/gi, (m) => m.replace(/\s+on file\b/i, "").replace(/^no (\w+ )?(data|figures?|numbers?)$/i, "no $1$2 available"))
  .replace(/\bon file\b/gi, "available").replace(/\s{2,}/g, " ");

/** The assessment's YOUR PORTFOLIO paragraph, built from the book: every holding of 2% or more with its dollars and
 *  share, cash, the smaller holdings counted, the exposure by type, then at most two of the model's sentences
 *  that carry no figures and no geography list (round 4/5: the model's version named two or three holdings and
 *  ended "…, and one smaller position"). Every sentence has a verb, so no later grammar pass can drop it. */
export function buildPortfolioParagraph(holdings: { name: string; usd: number }[], cashUsd: number, total: number, exp: Exposure, modelText = ""): string {
  const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
  const pct = (v: number) => (v / (total || 1) * 100).toFixed(1) + "%";
  const sorted = [...holdings].sort((a, b) => b.usd - a.usd);
  const big = sorted.filter((h) => h.usd / (total || 1) >= 0.02);
  const small = sorted.filter((h) => h.usd / (total || 1) < 0.02);
  const parts = [...big.map((h) => `${h.name} ${money(h.usd)} (${pct(h.usd)})`), ...(cashUsd > 0 ? [`cash ${money(cashUsd)} (${pct(cashUsd)})`] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
  const smallShare = small.reduce((a, h) => a + h.usd, 0) / (total || 1) * 100;
  const count = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][small.length] ?? String(small.length);
  const smallTxt = small.length ? ` ${count} smaller holding${small.length > 1 ? "s" : ""} make${small.length > 1 ? "" : "s"} up ${smallShare < 0.1 ? "under 0.1%" : smallShare.toFixed(1) + "%"}.` : "";
  const types = [["US stocks and stock funds", exp.usEquity], ["bonds", exp.bonds], ["crypto", exp.crypto], ["Korean stocks", exp.krEquity], ["cash", exp.cash]]
    .filter(([, v]) => Number(v) > 0).map(([k, v]) => `${Number(v).toFixed(1)}% ${k}`);
  const typeTxt = types.length ? ` By type, it holds ${types.length > 1 ? `${types.slice(0, -1).join(", ")} and ${types[types.length - 1]}` : types[0]}.` : "";
  const extra = splitSentences(modelText).filter((x) => !/\d\s?%|\$\s?\d|\bgeograph|\bUnited States\b|\bsmaller position|\btotals?\b|\bbiggest holdings?\b/i.test(x) && !brokenSentences(x).length).slice(0, 2);
  return `Your portfolio of ${money(total)} is made up of ${list}.${smallTxt}${typeTxt}${extra.length ? " " + extra.join(" ") : ""}`.replace(/\s{2,}/g, " ").trim();
}

/** A holding's weight stated wrong ("30.1% Bitcoin weight" when BTC is 25.2%; 30.1% was BTC + ETH, round 5
 *  poweruser). A figure next to a holding's name and a weight word must be that holding's weight, unless the
 *  sentence labels it as a group ("crypto 30.1%") and it equals that group's share. Corrected from the book. */
export function fixWeights(text: string, holdings: { names: string[]; weight: number }[], groups: { label: RegExp; value: number }[] = [], tolPp = 0.6): string {
  return perLine(text, (line) => splitSentences(line).map((s) => {
    if (!/\b(?:weight(?:ing)?|of (?:assets|the portfolio|your portfolio|the book|holdings)|stake|allocation|position|share)\b|\d\s?%\s+(?:in|into|is in|sits in)\s+[A-Z]/i.test(s)) return s;
    return s.replace(/(\d+(?:\.\d+)?)\s?%/g, (m: string, n: string, at: number) => {
      const v = Number(n);
      const near = s.slice(Math.max(0, at - 40), at + m.length + 30);
      // Round 7: "META dropped 3.3% and makes up 12.8% of assets" became "META dropped 12.8%": a figure after a move
      // verb or a sign is a MOVE, and only a figure with a weight word right beside it is a weight
      const before = s.slice(Math.max(0, at - 28), at), after = s.slice(at + m.length, at + m.length + 36);
      if (/\b(?:rose|fell|dropped|drops?|climbed|climbs?|gained|gains?|slipped|slips?|jumped|jumps?|surged|sank|tumbled|rallied|declined|lost|added|adds|up|down|higher|lower|increased|decreased|advanced|eased|dipped|slid|soared|plunged|moved)\b[^.%\d]{0,14}$|[+\-−]\s?$/i.test(before)) return m;
      // round 9: "96.6% in NVDA" (19.2%): a figure followed by "in <holding>" is that holding's weight
      const inHolding = /^\s*(?:in|into)\s+(\S+(?:\s+\S+)?)/.exec(after);
      const inNamed = !!inHolding && holdings.some((h) => h.names.some((nm) => nm && nameIn(inHolding[1], nm)));
      if (!inNamed && !/^\s*(?:\)|,)?\s*(?:[A-Z][\w.&'-]*\s+){0,2}(?:of (?:assets|the portfolio|your portfolio|the book|holdings|total)|(?:portfolio |position |book )?(?:weight|weighting|stake|allocation|share)\b|in (?:the |your )?(?:portfolio|book))/i.test(after)
        && !/\b(?:weight(?:ing)?|stake|allocation|position|share|makes? up|accounts? for|represents?|is|at)\b[^.%\d]{0,16}$/i.test(before)) return m;
      if (!inNamed && groups.some((g) => g.label.test(near) && Math.abs(g.value - v) <= tolPp)) return m;
      // round 7 newcomer: a theme value named anywhere in the sentence wins over any single holding
      if (!inNamed && groups.some((g) => g.value >= 0 && new RegExp(g.label.source, g.label.flags.replace("g", "")).test(s) && Math.abs(g.value - v) <= tolPp)) return m;
      // a weight of something INSIDE a holding ("VOO's tech weight at 38%", "sector weight", "exposure to chips")
      // describes the fund, not the portfolio (round 6: rewritten to VOO's 21.1% portfolio weight)
      if (/\b(?:tech|technology|sector|industry|semiconductors?|chips?|software|financials?|energy|health ?care|top[- ](?:ten|10|five|5)|mega-?caps?|magnificent|category|index|the index's|fund's)\s+(?:weight(?:ing)?|share|exposure|concentration|allocation)\b|\bexposure to\b|\bweight(?:ing)? (?:in|of) (?:tech|technology|the index|the fund|the S&P)\b/i.test(near)) return m;
      // the holding named closest to the figure (before it, or right after: "30.1% Bitcoin weight")
      const cands = inNamed ? holdings.filter((h) => h.names.some((nm) => nm && nameIn(inHolding![1], nm))).map((h) => ({ h, i: 0 })).slice(0, 1) : holdings.map((h) => {
        const i = h.names.map((nm) => { const k = firstIdx(s, [nm]); return k === Infinity ? Infinity : Math.abs(k - at); }).reduce((a, b) => Math.min(a, b), Infinity);
        return { h, i };
      }).filter((x) => x.i <= 40).sort((a, b) => a.i - b.i);
      // Round 7 newcomer: "17.2% of assets in AAPL and MSFT" (27.7%, the pair) became AAPL's 17.2%; "Mega-cap platforms
      // (AAPL, MSFT) occupy 27.7%" became MSFT's 10.4%. With two or more holdings named by the figure it is their SUM
      // or a group share: it is checked against the sum and is never rewritten to one member's weight.
      if (cands.length >= 2) {
        const sum = cands.reduce((a, c) => a + c.h.weight, 0);
        if (Math.abs(sum - v) > Math.max(tolPp, 1) && !groups.some((g) => Math.abs(g.value - v) <= tolPp)) {
          const inSentence = holdings.filter((h) => h.names.some((nm) => firstIdx(s, [nm]) !== Infinity));
          const total = inSentence.reduce((a, h) => a + h.weight, 0);
          if (inSentence.length >= 2 && Math.abs(total - v) > Math.max(tolPp, 1) && Math.abs(sum - total) < 0.05) return `${sum.toFixed(1)}%`;
        }
        return m;
      }
      const who = cands[0]?.h;
      if (!who || Math.abs(who.weight - v) <= tolPp) return m;
      if (holdings.some((h) => Math.abs(h.weight - v) <= 0.05 && h !== who)) return m;   // another holding's weight: leave to the reader
      return `${who.weight.toFixed(1)}%`;
    });
  }).join(" "));
}

/** Every sentence a stored brief must lose on repair: the grammar pass (broken, verbless) and the advice pass
 *  (trade, valuation, promo, forecast). Round 5: repairSections ran only the calendar checks and stamped the
 *  version, so "...Nasdaq futures (+0.7%), and one smaller position." survived the repair. */
export function repairDrops(text: string): string[] {
  const t = String(text ?? "");
  return [...new Set([...brokenSentences(t), ...verblessList(t), ...adviceHits(t), ...valuationHits(t), ...promoClaims(t), ...returnForecasts(t)])];
}

type ClockEdition = "morning" | "midday" | "close" | "assessment" | "weekend" | "kr_open" | "kr_close";
/** The editions a run for `edition` treats as LIVE: only the edition itself, whose window is still open. A live
 *  row written by an older daily-brief is REGENERATED from current data; every other edition is patched in place.
 *  Round 6: the previous edition was regenerated too, so the close run rewrote the Midday Pulse at 4:31 PM and it
 *  shipped "MIDDAY PULSE · Written at 4:31 PM": a past-window edition keeps its timing and is patched instead. */
export function liveEditions(edition: ClockEdition): ClockEdition[] {
  return edition === "assessment" ? [] : [edition];
}

/** Holding themes (moved here from daily-brief so Ask's code-built answer can state the theme mix). */
export const THEMES: Record<string, string> = {
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
  // r12: leveraged funds are themed (SOXL was "other", so a chip-heavy book read as tech-light)
  SOXL: "leveraged semiconductors", NVDL: "leveraged semiconductors", NVDU: "leveraged semiconductors", SMHX: "leveraged semiconductors",
  TQQQ: "leveraged tech", TECL: "leveraged tech", QLD: "leveraged tech", ROM: "leveraged tech",
  // round 9: Berkshire counts as Financials (GICS), under every spelling of the ticker
  "BRK.B": "financials", "BRK-B": "financials", BRKB: "financials", "BRK.A": "financials", "BRK-A": "financials", BRKA: "financials",
  JNJ: "healthcare", UNH: "healthcare", LLY: "healthcare", PFE: "healthcare", "068270.KS": "healthcare", "207940.KS": "healthcare",
  XOM: "energy", CVX: "energy", "373220.KS": "batteries", "006400.KS": "batteries", "003690.KS": "consumer staples", KO: "consumer staples", PG: "consumer staples", COST: "consumer staples", WMT: "consumer staples",
  "012450.KS": "defense", LMT: "defense", RTX: "defense", "042660.KS": "shipbuilding", "009540.KS": "shipbuilding", "329180.KS": "shipbuilding",
  SPY: "broad US index", VOO: "broad US index", VTI: "broad US index", IVV: "broad US index", FXAIX: "broad US index", QQQ: "Nasdaq 100 index", QQQM: "Nasdaq 100 index",
  VXUS: "international index", BND: "bonds", TLT: "bonds", AGG: "bonds", GLD: "gold", IAU: "gold", SCHD: "dividend equity", VYM: "dividend equity", JEPI: "income equity",
};
export const themeOf = (sym: string, kind: string | null): string => THEMES[sym] ?? (kind === "crypto" || /-USD$/.test(sym) ? "crypto" : kind === "etf" || kind === "fund" ? "funds" : "other");
const THEME_KO: Record<string, string> = {
  "AI semiconductors": "AI 반도체", "AI infrastructure": "AI 인프라", "crypto beta": "암호화폐 관련주", crypto: "암호화폐", "mega-cap platforms": "대형 플랫폼",
  "EV and autos": "전기차·자동차", "consumer internet": "인터넷 서비스", software: "소프트웨어", financials: "금융", "diversified conglomerate": "복합 기업",
  healthcare: "헬스케어", energy: "에너지", batteries: "배터리", "consumer staples": "필수소비재", defense: "방산", shipbuilding: "조선",
  "broad US index": "미국 지수", "Nasdaq 100 index": "나스닥100 지수", "international index": "해외 지수", bonds: "채권", gold: "금",
  "dividend equity": "배당주", "income equity": "인컴 ETF", funds: "펀드", other: "기타",
};

/** Inputs for the answer built in code for a trade or pick question (round 6: it was 2-3 thin bullets). */
export type HuskInput = {
  holdings: { name: string; symbol: string; kind: string | null; usd: number }[];
  cashUsd: number; assetsUsd: number; today: string;
  reports: { name: string; est: string | null; range?: [string, string] }[];
  /** round 9: the estimates read failed (timed out): say nothing about reports rather than "no holding reports" */
  reportsUnknown?: boolean;
  /** r11: the dividends read failed: say nothing about dividends rather than "no holding pays a dividend" */
  dividendsUnknown?: boolean;
  dividends: { name: string; annualUsd: number; nextEx: string | null; current?: boolean }[];
  // round 7: the husk fits the question. sell/trim/dump questions get a SELLER's frame, "rank my holdings" a ranking
  // by stated metrics, and a trade question about ONE holding an answer built around that holding
  mode?: "buy" | "sell" | "rank";
  returns1m?: Record<string, number | null>;
  focus?: { name: string; weight: number; usd: number; gainUsd: number | null; dayPct: number | null; r1m: number | null; r3m: number | null; report?: string | null; divAnnual?: number; divCurrent?: boolean };
};
const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// "upcoming" means strictly after today (round 6: an ex-date estimated for today was listed as coming up)
const within = (ymd: string | null | undefined, today: string, days: number) => !!ymd && ymd > today && ymd <= addDaysYmd(today, days);
const usdText = (v: number) => `$${Math.round(v >= 1000 ? Math.round(v / 100) * 100 : v).toLocaleString("en-US")}`;
const pct1 = (v: number, ko = false) => v > 0 && v < 0.05 ? (ko ? "0.1% 미만" : "under 0.1%") : `${v.toFixed(1)}%`;
const NUM_WORD = ["", "one", "two", "three"];
/** The code-built answer to a trade or pick question: 4-5 bullets specific to this portfolio, one per line.
 *  Concentration, theme mix with crypto and cash, reports in the next 45 days (estimates), dividend payers and
 *  income with ex-dates in the next 45 days, and what a buyer would weigh. Never names anything to buy. */
export function buildHusk(inp: HuskInput, ko: boolean): string {
  if (inp.focus) return focusHusk(inp, ko);
  if (inp.mode === "rank") return rankHusk(inp, ko);
  const A = inp.assetsUsd || 1;
  const hs = [...inp.holdings].filter((h) => h.usd > 0).sort((a, b) => b.usd - a.usd);
  const top = hs.slice(0, 3);
  const topShare = top.reduce((a, h) => a + h.usd, 0) / A * 100;
  const themes = new Map<string, number>();
  for (const h of hs) { const t = themeOf(h.symbol, h.kind); themes.set(t, (themes.get(t) ?? 0) + h.usd); }
  const crypto = hs.filter((h) => themeOf(h.symbol, h.kind) === "crypto").reduce((a, h) => a + h.usd, 0) / A * 100;
  const cashPct = inp.cashUsd / A * 100;
  // a theme under half a percent is noise in a mix line ("AI semiconductors 0.0%", round 6 mock)
  const topThemes = [...themes.entries()].filter(([t, v]) => t !== "other" && v / A * 100 >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cryptoListed = topThemes.some(([t]) => t === "crypto");
  // in date order (round 7: "TSLA Oct 21, AAPL Oct 29, MSFT Oct 28")
  const reports = inp.reports.filter((r) => within(r.range ? r.range[0] : r.est, inp.today, 45) || within(r.est, inp.today, 45))
    .sort((a, b) => String(a.range ? a.range[0] : a.est).localeCompare(String(b.range ? b.range[0] : b.est)));
  const payers = inp.dividends.filter((d) => d.annualUsd > 0).sort((a, b) => b.annualUsd - a.annualUsd);
  const income = payers.reduce((a, d) => a + d.annualUsd, 0);
  const soonEx = payers.filter((d) => within(d.nextEx, inp.today, 45));
  const md = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const out: string[] = [];
  if (ko) {
    if (top.length) out.push(top.length === 1 ? `• 집중도: 보유 종목은 ${top[0].name} 하나로 자산의 ${topShare.toFixed(0)}%입니다.` : `• 집중도: 상위 ${top.length}개 종목(${top.map((h) => `${h.name} ${pct1(h.usd / A * 100, true)}`).join(", ")})이 자산의 ${topShare.toFixed(0)}%입니다.`);
    out.push(`• 구성: ${[...topThemes.map(([t, v]) => `${THEME_KO[t] ?? t} ${pct1(v / A * 100, true)}`), ...(crypto > 0 && !cryptoListed ? [`암호화폐 ${pct1(crypto, true)}`] : []), `현금 ${pct1(cashPct, true)}(${usdText(inp.cashUsd)})`].join(", ")}입니다.`);
    if (!inp.reportsUnknown) out.push(reports.length ? `• 45일 안에 예상되는 실적 발표(추정): ${reports.map((r) => `${r.name} ${r.range ? spanOfMonthKo(r.range) : md(r.est!) + "경"}`).join(", ")}.` : "• 45일 안에 실적 발표가 예상되는 보유 종목은 없습니다.");
    if (!inp.dividendsUnknown) out.push(payers.length ? `• 배당: ${payers.slice(0, 4).map((d) => d.name).join(", ")}${payers.length > 4 ? ` 외 ${payers.length - 4}개` : ""}에서 연 약 ${usdText(income)}이 나옵니다${payers.some((d) => d.current) ? "(현재 배당률 기준)" : ""}. ${soonEx.length ? `45일 안의 배당락(추정): ${soonEx.map((d) => `${d.name} ${md(d.nextEx!)}경`).join(", ")}.` : "45일 안에 배당락이 예상되는 종목은 없습니다."}` : "• 배당: 기록상 배당을 주는 보유 종목이 없습니다.");
    if (inp.mode === "sell") { out.push(`• 파는 쪽에서 보통 따지는 것: 차익에 붙는 세금, 한 종목(상위 ${top[0]?.name ?? ""} ${pct1((top[0]?.usd ?? 0) / A * 100, true)})에 원하는 것보다 많이 실려 있는지, 처음 산 이유가 아직 유효한지.`); return out.join("\n"); }
    out.push(`• 이런 결정에서 보통 따지는 것: 새 돈이 이미 ${topShare.toFixed(0)}%인 ${top.length === 1 ? top[0].name : "상위 종목"} 비중을 더 키우는지, ${crypto > 0 ? `포트폴리오가 암호화폐(현재 ${pct1(crypto)})에 얼마나 흔들리길 원하는지` : `현금(현재 ${pct1(cashPct)})을 얼마나 남겨둘지`}, 투자 기간과 세금.`);
    return out.join("\n");
  }
  if (top.length) out.push(top.length === 1 ? `• Concentration: your only holding, ${top[0].name}, is ${topShare.toFixed(0)}% of the portfolio.` : `• Concentration: your ${NUM_WORD[top.length]} largest holdings (${top.map((h) => `${h.name} ${pct1(h.usd / A * 100)}`).join(", ")}) are ${topShare.toFixed(0)}% of the portfolio.`);
  const mix = [...topThemes.map(([t, v]) => `${t} ${pct1(v / A * 100)}`), ...(crypto > 0 && !cryptoListed ? [`crypto ${pct1(crypto)}`] : [])];
  out.push(`• Mix: ${mix.length ? mix.join(", ") + ", and " : ""}cash ${pct1(cashPct)} (${usdText(inp.cashUsd)}).`);
  if (!inp.reportsUnknown) out.push(reports.length ? `• Reports expected in the next 45 days (estimates): ${reports.map((r) => `${r.name} ${r.range ? spanOfMonth(r.range) : "~" + md(r.est!)}`).join(", ")}.` : "• No holding has an earnings report expected in the next 45 days.");
  if (!inp.dividendsUnknown) out.push(payers.length ? `• Dividends: ${payers.slice(0, 4).map((d) => d.name).join(", ")}${payers.length > 4 ? ` and ${payers.length - 4} more` : ""} pay about ${usdText(income)} a year together${payers.some((d) => d.current) ? " at the current rate" : ""}; ${soonEx.length ? `ex-dates expected in the next 45 days: ${soonEx.map((d) => `${d.name} ~${md(d.nextEx!)}`).join(", ")}.` : "none has an ex-date expected in the next 45 days."}` : "• Dividends: no holding pays a dividend on record.");
  if (inp.mode === "sell") {
    out.push(`• What a seller usually weighs here: the tax on any gain, whether one holding (${top[0]?.name ?? "the largest"} is ${pct1((top[0]?.usd ?? 0) / A * 100)}) is more of the portfolio than you want, and whether the reason you bought still holds.`);
    return out.join("\n");
  }
  out.push(`• What a buyer usually weighs here: whether new money adds to the ${topShare.toFixed(0)}% already in ${top.length === 1 ? top[0].name : `the top ${NUM_WORD[top.length]}`}, ${crypto > 0 ? `how much of the portfolio should swing with crypto (${pct1(crypto)} now)` : `how much to keep in cash (${pct1(cashPct)} now)`}, and your time horizon and taxes.`);
  return out.join("\n");
}

const MOVE_PCT = String.raw`(?:up|down|rose|fell|gained|lost|slipped|climbed|dropped|jumped|added|sank|edged (?:up|down)|[+\-−])\s?\d+(?:\.\d+)?%`;
const SESSION_LABEL = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?\b|\b(?:last|previous|prior) (?:session|close|trading day)\b|\b(?:1W|1M|3M|YTD|week|month|year|quarter)\b|요일|지난 거래일|직전 거래일|주간|개월|1년|연초/i;
/** A day move for a holding whose market is CLOSED today, stated without its session (round 6: during a KRX
 *  holiday a pick answer listed "SK hynix up 1.2%; Samsung up 3.3%", Wednesday's moves, as if current). The
 *  move gets its session label ("(Wed)"); a sentence that calls it today's is dropped. */
export function labelClosedMoves(text: string, closed: { names: string[]; label: string }[]): string {
  if (!closed.length) return String(text ?? "");
  return String(text ?? "").split("\n").map((line) => {
    const lead = (line.match(/^\s*(?:•\s*)?/) ?? [""])[0];
    const kept = splitSentences(line.slice(lead.length)).map((sent) => {
      let x = sent; const labelled = SESSION_LABEL.test(sent);
      for (const c of closed) {
        for (const n of c.names.filter(Boolean)) {
          const nm = /[가-힣]/.test(n) ? esc(n) : `(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`;
          const re = new RegExp(`(${nm}[^.;%\\n]{0,30}?${MOVE_PCT})(?!\\s*\\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)(?:요일)?\\))`, /^[A-Z0-9.]{1,6}$/.test(n) ? "g" : "gi");
          if (!re.test(x)) continue;
          if (/\btoday\b|\bso far\b|\bthis session\b|오늘|장중/i.test(x)) return "";
          if (labelled) continue;   // the sentence already names its session or window
          x = x.replace(new RegExp(re.source, re.flags), (m) => `${m} (${c.label})`);
        }
      }
      return x;
    }).filter((x) => x.trim());
    return kept.length ? lead + kept.join(" ") : "";
  }).filter((l) => l.trim()).join("\n");
}

/** An answer to a pick or trade question that is mostly a list of day moves ("BTC down 0.9%; SK hynix up 1.2%;
 *  Samsung up 3.3%; ..."): four or more holdings with a move is not an answer to "what's your top pick". */
export function dayMoveDump(text: string, holdings: { names: string[] }[]): boolean {
  const t = String(text ?? "");
  const hit = holdings.filter((h) => h.names.filter(Boolean).some((n) => {
    const nm = /[가-힣]/.test(n) ? esc(n) : `(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`;
    return new RegExp(`${nm}[^.;\\n]{0,30}?${MOVE_PCT}`, /^[A-Z0-9.]{1,6}$/.test(n) ? "" : "i").test(t);
  }));
  return hit.length >= 4;
}

/** "Dividends are coming soon from AAPL, VOO" / "배당이 곧 들어오는 주식은 AAPL, VOO 등" when neither has an
 *  ex-date expected in the next 45 days (round 6): a payout timing claim is checked against div_next_ex. */
export function wrongDividendTiming(text: string, divs: { names: string[]; nextEx: string | null }[], today: string): string[] {
  const SOON = /\b(?:dividends?|payouts?)\b[^.]{0,40}\b(?:soon|coming up|upcoming|imminent|about to|next few weeks|this month|shortly)\b|\b(?:soon|upcoming|imminent)\b[^.]{0,20}\b(?:dividends?|payouts?|ex-dividend|ex-dates?)\b|\bex-dividend soon\b|배당[^.]{0,20}(?:곧|임박|다가오|앞두)|(?:곧|임박|다가오는|앞둔)[^.]{0,20}배당/i;
  return sentencesOf(text).filter((s) => {
    if (!SOON.test(s)) return false;
    const named = divs.filter((d) => d.names.some((n) => n && nameIn(s, n)));
    return named.length > 0 && named.some((d) => !within(d.nextEx, today, 45));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Round 6: written sections keep figures as DIGITS. The fact-checker model spelled them out ("below forty percent",
// "expense over zero point three percent" for 0.03%): narration-style numbers belong only in the Listen script.
const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMW = `(?:${[...Object.keys(TENS), ...Object.keys(ONES)].join("|")})(?:[- ](?:${Object.keys(ONES).join("|")}))?`;
const SPELLED_PCT = new RegExp(`\\b(${NUMW}(?: hundred(?: (?:and )?${NUMW})?)?)(?: point (${Object.keys(ONES).slice(0, 10).join("|")}))? percent\\b`, "gi");
const SPELLED_ANY = new RegExp(`\\b(?:${NUMW}) (?:hundred|thousand|million|billion|percent)\\b|\\bzero point\\b|\\b(?:${NUMW}) point (?:${Object.keys(ONES).slice(0, 10).join("|")})\\b`, "gi");
function wordsToInt(w: string): number | null {
  let total = 0, cur = 0;
  for (const t of w.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((x) => x && x !== "and")) {
    if (t in ONES) cur += ONES[t]; else if (t in TENS) cur += TENS[t]; else if (t === "hundred") cur = (cur || 1) * 100; else return null;
  }
  return total + cur;
}
/** Spelled-out figures in written text ("forty percent", "five hundred", "zero point three"). */
export const spelledNumbers = (t: string): string[] => [...String(t ?? "").matchAll(SPELLED_ANY)].map((m) => m[0]);
/** "forty percent" -> "40%", "one point five percent" -> "1.5%". Only a "<number> percent" phrase is converted. */
export const digitsForWritten = (t: string): string => String(t ?? "").replace(SPELLED_PCT, (m, n: string, dec?: string) => {
  const v = wordsToInt(n);
  if (v === null) return m;
  return `${v}${dec ? "." + ONES[dec.toLowerCase()] : ""}%`;
});

/** Our own prompt instructions echoed into reader copy (round 6 poweruser: "…two weeks old, so it is context, not
 *  news"). The clause goes when it is a tail; a sentence that only talks about our data goes whole. */
const ECHO_TAIL = /,?\s*(?:so |which makes it |making it |and )?(?:it(?:'s| is) |this is )?(?:context|background),? not (?:news|a new development)\b/gi;
const ECHO_SENT = /\b(?:per the data(?: block)?|as instructed|the ONLY (?:figures|numbers|source|dates?)|(?:data|stats) block|from the data above|in the data (?:provided|given)|deterministic(?:ally)?|the prompt|quote-page (?:and|or) option-chain)\b/i;
export function dropInstructionEcho(text: string): string {
  const src = String(text ?? "");
  const out = perLine(src, (line) => splitSentences(line.replace(ECHO_TAIL, "")).filter((x) => !ECHO_SENT.test(x)).join(" "));
  return out.trim() ? out : src.replace(ECHO_TAIL, "");
}

/** A claim that a single stock or a coin "holds many stocks" / is diversified (round 6: "QQQ·VOO·NVDA는 여러 종목을
 *  담고 있어 상대적으로 안정적"). Returns the sentences that make it about a holding that is not a fund. */
export function diversifiedClaims(text: string, holdings: { names: string[]; fund: boolean }[]): string[] {
  const CLAIM = /\b(?:hold|holds|holding|own|owns|contain|contains|spread across|made up of)\s+(?:many|hundreds of|dozens of|a basket of|lots of|\d{2,} )\s*(?:different )?(?:stocks|companies|holdings)\b|\bdiversified\b|\bbroad(?:ly)? (?:spread|diversified)\b|여러 종목|분산(?:되어|돼|된|투자)|다양한 종목|종목을 담/i;
  return sentencesOf(text).filter((s) => CLAIM.test(s) && holdings.some((h) => !h.fund && h.names.some((n) => n && nameIn(s, n))));
}

/** A cause that is only the move itself ("SoFi fell 1.3% after a MarketBeat article noted its drop", round 6). */
export function circularCauses(text: string): string[] {
  return sentencesOf(text).filter((s) => /\b(?:after|as|because|since|on)\b[^.]{0,40}\b(?:article|report|story|headline|piece|post)\b[^.]{0,30}\b(?:noted|reported|said|showed|highlighted|flagged|pointed to|covered|described)\b[^.]{0,12}\b(?:its|the|a) (?:drop|decline|fall|slide|dip|gain|rise|rally|jump|move|slump)\b/i.test(s));
}

/** Sentence starts after a real sentence end are capitalised; an abbreviation ("vs.", "e.g.", "U.S.") is not an
 *  end (round 6 trace: noviceScrub turned "price tag extreme vs. peers" into "vs. Peers"). */
export function capSentenceStarts(t: string): string {
  return String(t ?? "").replace(/(^|(?<=[a-z0-9%)])[.!?]\s+)([a-z])/g, (m: string, a: string, b: string, off: number, whole: string) =>
    /\b(?:vs|e\.g|i\.e|etc|approx|est|U\.S|U\.K|Inc|Co|Corp|Ltd|No|St|Mr|Ms|Dr|Jr|Sr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.\s*$/.test(whole.slice(0, off + a.length)) ? m : a + b.toUpperCase());
}

// Round 6 trace: fitCap on a position note dropped trailing sentences until it fit, and the LAST sentence of every
// note is its risk ("the risk: data-center growth below 30%"), so a 34-word note on a 33-word cap lost its risk
// and ensureRisk then glued a memo fragment in its place. A note sheds its MIDDLE sentences first, never the
// risk, and may run a few words over rather than lose it.
export const capNoteKeepRisk = (note: string, cap: number, fit: (t: string, cap: number) => string = (t) => t): string => {
  const wc = (x: string) => x.split(/\s+/).filter(Boolean).length;
  const t = String(note ?? "").trim();
  if (wc(t) <= cap) return t;
  const sents = splitSentences(t);
  if (sents.length <= 1) return fit(t, cap);
  const keep = sents.slice();
  while (wc(keep.join(" ")) > cap && keep.length > 2) keep.splice(keep.length - 2, 1);
  return keep.join(" ");
};

/** The fact-checker's JSON, accepted FIELD BY FIELD (round 6 trace: given the draft, the checker spelled figures out,
 *  "below forty percent", "zero point three percent" for 0.03%, and wrote "It does not pay a dividend" into the
 *  NVDA and QQQ notes). A field keeps the checker's text only when it spells no figure the draft wrote in digits,
 *  brings no figure found in neither the draft nor the data, and makes no dividend claim the draft did not make. */
type Draftish = { lede: string; overnight: string; desk_view: string; horizon?: string; ideas?: string[]; positions: { name: string; note: string; watch: string }[] };
export function mergeChecked<T extends Draftish>(draft: T, checked: T, data: string): T {
  const figs = (t: string) => (String(t ?? "").match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((x) => x.replace(/,/g, ""));
  const known = new Set([...figs(JSON.stringify(draft)), ...figs(data)]);
  const DIV = /\bdividends?\b|\bpayouts?\b|배당/i;
  const ok = (before: string, after: string) => typeof after === "string" && !!after.trim()
    && spelledNumbers(after).length <= spelledNumbers(before).length
    && figs(after).every((f) => known.has(f))
    && !(DIV.test(after) && !DIV.test(before));
  const pick = (b: string, a: string) => (ok(b, a) ? a : b);
  const out: T = { ...draft,
    lede: pick(draft.lede, checked.lede), overnight: pick(draft.overnight, checked.overnight), desk_view: pick(draft.desk_view, checked.desk_view),
    ...(draft.horizon !== undefined || checked.horizon !== undefined ? { horizon: pick(draft.horizon ?? "", checked.horizon ?? "") } : {}),
    ideas: (draft.ideas ?? []).map((x, i) => pick(x, (checked.ideas ?? [])[i] ?? x)),
    positions: draft.positions.map((p) => {
      const c = checked.positions.find((q) => String(q.name).toLowerCase() === String(p.name).toLowerCase());
      // a watch must stay MEASURABLE: the checker swapped "Nasdaq-100 drawdown >20%" for "Top-heavy in mega-cap tech"
      const wc = (t: string) => String(t ?? "").split(/\s+/).filter(Boolean).length;
      const watchOk = !c || ((!figs(p.watch).length || figs(c.watch).length > 0) && wc(c.watch) >= Math.min(4, wc(p.watch)));
      return c ? { ...p, note: pick(p.note, c.note), watch: watchOk ? pick(p.watch, c.watch) : p.watch } : p;
    }).filter((p) => checked.positions.some((q) => String(q.name).toLowerCase() === String(p.name).toLowerCase()) || draft.positions.length <= 2),
  };
  return out;
}

/** The reader block for the ASSESSMENT edition (round 6 decision): a beginner's sentences may run to 20 words, not
 *  14, and well-known names stay as written (S&P 500, Nasdaq-100, ETF, and P/E when explained once). The trace
 *  showed gpt-oss dropping words to fit the 14-word cap and the acronym bans ("has sheet", "Standard Poor's 500").
 *  Daily editions keep the stricter block. */
export function assessmentReader(reader: string): string {
  if (!/BEGINNER reader/.test(reader)) return reader;
  return reader
    .replace(/Sentences of at most 14 words\./, "Sentences of at most 20 words.")
    .replace(/, P\/E, /, ", ")
    .replace(/(Never condescend\.)/, "Well-known names stay exactly as written, never shortened or respelled: S&P 500, Nasdaq-100, ETF (say once what it is: a fund that trades like a stock), and P/E when you explain it once in plain words (its price tag against profits). $1");
}

// ---------------------------------------------------------------------------------------------------------------
// Round 6e: a fraction word is a figure ("one-third of the book tied to a single theme" when that theme is 21.1%,
// "over a third"). Each fraction phrase is checked against the share it describes: the holding or group named
// nearest to it in the sentence (a holding's weight, a theme / crypto / cash / top-three share). Within 5 points
// (or on the right side of "over" / "under") it stays; otherwise it becomes the exact percentage. A fraction with
// nothing named to check it against is left alone.
const FRAC_VAL: Record<string, number> = { "half": 50, "one-half": 50, "a half": 50, "a third": 100 / 3, "one-third": 100 / 3, "one third": 100 / 3, "two-thirds": 200 / 3, "two thirds": 200 / 3,
  "a quarter": 25, "one-quarter": 25, "one quarter": 25, "three-quarters": 75, "three quarters": 75, "a fifth": 20, "one-fifth": 20, "one fifth": 20 };
const FRAC_RE = /\b((?:well |just |roughly |about |around |nearly |almost |over |more than |under |less than |close to )*)(one[- ]half|a half|half|two[- ]thirds|one[- ]third|a third|three[- ]quarters|one[- ]quarter|a quarter|one[- ]fifth|a fifth)\b(?=\s+of\s+(?:the\s+|your\s+|its\s+|this\s+|all\s+)?(?:book|portfolio|assets|holdings|money|invested|total|wealth|equit(?:y|ies)|stock holdings)\b)/gi;
export function fixFractions(text: string, holdings: { names: string[]; weight: number }[], groups: { label: RegExp; value: number }[] = [], tolPp = 5): string {
  return perLine(text, (line) => splitSentences(line).map((sent) => sent.replace(FRAC_RE, (m: string, mods: string, frac: string, at: number) => {
    const v = FRAC_VAL[frac.toLowerCase().replace(/\s+/g, " ")] ?? FRAC_VAL[frac.toLowerCase().replace(" ", "-")];
    if (v === undefined) return m;
    // the share the fraction describes: the nearest named holding or group in the sentence
    const cands: { value: number; d: number }[] = [];
    for (const h of holdings) for (const n of h.names) {
      if (!n) continue;
      const k = firstIdx(sent, [n]);
      if (k !== Infinity) cands.push({ value: h.weight, d: Math.abs(k - at) });
    }
    for (const g of groups) {
      const mm = sent.match(new RegExp(g.label.source, g.label.flags.replace("g", "")));
      if (mm && mm.index !== undefined && g.value >= 0) cands.push({ value: g.value, d: Math.abs(mm.index - at) });
    }
    if (!cands.length) return m;
    const share = cands.sort((a, b) => a.d - b.d)[0].value;
    const md = mods.toLowerCase();
    const ok = /\b(?:over|more than)\b/.test(md) ? share >= v - 1 && share <= v + 15
      : /\b(?:under|less than|nearly|almost|close to)\b/.test(md) ? share <= v + 1 && share >= v - 15
      : Math.abs(share - v) <= tolPp;
    return ok ? m : `${share.toFixed(1)}%`;
  })).join(" "));
}

const signed1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
/** The code-built answer for a trade question about ONE holding: that holding's facts, then what the decision rests
 *  on, in a seller's or a buyer's frame. */
function focusHusk(inp: HuskInput, ko: boolean): string {
  const f = inp.focus!;
  const sell = inp.mode === "sell";
  const money = (v: number) => usdText(Math.abs(v));
  if (ko) {
    return [
      `• ${f.name}: 자산의 ${pct1(f.weight, true)}(${usdText(f.usd)})${f.gainUsd !== null ? `, 매수 이후 ${f.gainUsd >= 0 ? "+" : "-"}${money(f.gainUsd)}` : ""}.`,
      `• 움직임: ${[f.dayPct !== null ? `오늘 ${signed1(f.dayPct)}` : "", f.r1m !== null ? `1개월 ${signed1(f.r1m)}` : "", f.r3m !== null ? `3개월 ${signed1(f.r3m)}` : ""].filter(Boolean).join(", ") || "기간 수익률 데이터 없음"}.`,
      f.report ? `• 다음 실적 발표(추정): ${f.report}.` : "",
      f.divAnnual ? `• 배당: 연 약 ${usdText(f.divAnnual)}${f.divCurrent ? "(현재 배당률 기준)" : ""}.` : "",
      sell ? "• 파는 쪽에서 보통 따지는 것: 차익에 붙는 세금, 이 종목 비중이 원하는 수준보다 큰지, 처음 산 이유가 아직 유효한지." : "• 사는 쪽에서 보통 따지는 것: 새 돈이 이 종목 비중을 얼마나 키우는지, 다음 실적 전후의 변동, 투자 기간.",
    ].filter(Boolean).join("\n");
  }
  return [
    `• ${f.name} is ${pct1(f.weight)} of your portfolio (${usdText(f.usd)})${f.gainUsd !== null ? `, ${f.gainUsd >= 0 ? "up" : "down"} ${money(f.gainUsd)} since you bought` : ""}.`,
    `• Moves: ${[f.dayPct !== null ? `today ${signed1(f.dayPct)}` : "", f.r1m !== null ? `1 month ${signed1(f.r1m)}` : "", f.r3m !== null ? `3 months ${signed1(f.r3m)}` : ""].filter(Boolean).join(", ") || "no window figures yet"}.`,
    f.report ? `• Next report expected ${f.report} (estimate).` : "",
    f.divAnnual ? `• Dividend: about ${usdText(f.divAnnual)} a year${f.divCurrent ? " at the current rate" : ""}.` : "",
    sell ? `• What a seller usually weighs here: the tax on the gain, whether ${pct1(f.weight)} in ${f.name} is more than you want in one name, and whether the reason you bought it still holds.`
      : `• What a buyer usually weighs here: how far new money would lift ${f.name} above its ${pct1(f.weight)} weight, the swing around the next report, and your time horizon.`,
  ].filter(Boolean).join("\n");
}
/** "Rank my holdings": a ranking by stated metrics, never by which to keep (r5 did this correctly). */
function rankHusk(inp: HuskInput, ko: boolean): string {
  const A = inp.assetsUsd || 1;
  const hs = [...inp.holdings].filter((h) => h.usd > 0).sort((a, b) => b.usd - a.usd);
  // round 8: every holding is listed (AMZN, the weakest, fell off an 8-item cut)
  const byW = hs.slice(0, 15).map((h) => `${h.name} ${pct1(h.usd / A * 100, ko)}`).join(", ");
  const r = inp.returns1m ?? {};
  const byR = hs.filter((h) => typeof r[h.symbol] === "number").sort((a, b) => (r[b.symbol]! - r[a.symbol]!)).slice(0, 15).map((h) => `${h.name} ${signed1(r[h.symbol]!)}`).join(", ");
  if (ko) return [`• 비중 순: ${byW}.`, byR ? `• 1개월 수익률 순: ${byR}.` : "", "• 어떤 종목을 남기거나 뺄지는 순위가 아니라 목표, 기간, 세금에 달려 있습니다."].filter(Boolean).join("\n");
  return [`• By weight: ${byW}.`, byR ? `• By 1-month return: ${byR}.` : "", "• Which to keep or cut depends on your goals, horizon and taxes, not on the ranking itself."].filter(Boolean).join("\n");
}

/** A sell-side question ("should I sell TSLA", "which one would you trim", "dump"). */
export const isSellQuestion = (q: string): boolean => /\b(?:sell|trim|dump|take profits?|get rid of|exit|cut|reduce|ditch|unload|offload|cash out|lighten|rebalanc\w*)\b|팔|매도|정리|익절|손절|줄일/i.test(String(q ?? ""));
/** "Rank my holdings (best to worst)". */
export const isRankQuestion = (q: string): boolean => /\brank(?:ing|ed)?\b|\bbest to worst\b|\bworst to best\b|순위|순서대로/i.test(String(q ?? ""));

/** Korean names for common US holdings, so the Korean guards recognise "애플", "마이크로소프트" (round 7: a 4-name
 *  shortlist in Korean slipped past curatedListHits, which only knew the English names). */
const KO_NAMES: Record<string, string[]> = {
  AAPL: ["애플"], MSFT: ["마이크로소프트", "마소"], NVDA: ["엔비디아"], META: ["메타"], GOOGL: ["구글", "알파벳"], GOOG: ["구글", "알파벳"],
  AMZN: ["아마존"], AVGO: ["브로드컴"], TSLA: ["테슬라"], NFLX: ["넷플릭스"], AMD: ["AMD"], PLTR: ["팔란티어"], QQQ: ["나스닥"], QQQM: ["나스닥"],
  VOO: ["S&P 500", "S&P500"], SPY: ["S&P 500"], KO: ["코카콜라"], JNJ: ["존슨앤드존슨"], SCHD: ["SCHD"], BTC: ["비트코인"], "BTC-USD": ["비트코인"], ETH: ["이더리움"], "ETH-USD": ["이더리움"],
  "005930.KS": ["삼성전자", "삼성"], "005935.KS": ["삼성전자우"], "000660.KS": ["SK하이닉스", "하이닉스"], "035420.KS": ["네이버", "NAVER"], "035720.KS": ["카카오"], "005380.KS": ["현대차"],
  SOFI: ["소파이"], INTC: ["인텔"], ORCL: ["오라클"], CRM: ["세일즈포스"], COIN: ["코인베이스"], MSTR: ["마이크로스트래티지"],
};
export const koNamesFor = (sym: string): string[] => KO_NAMES[sym] ?? [];

/** A named buy suggestion in answer to a trade / pick / cash question (round 7: "$120K cash" follow-up got "Adding
 *  to the index fund (QQQM) would increase broad market exposure. Buying more dividend-paying shares like
 *  Microsoft or Broadcom could raise annual income. Consider more shares in under-weighted areas like Google or
 *  Amazon before earnings."). Scenario framing is allowed elsewhere; under a decision question it IS the pick. */
export function suggestionHits(text: string, book: { names: string[] }[]): string[] {
  const VERB = /\b(?:adding (?:to|more)|add(?:ing)? more|buying more|buy(?:ing)? more|more shares (?:in|of)|consider(?:ing)? (?:more|adding|buying|a position)|increas(?:e|ing) (?:your |the )?(?:stake|position|exposure|weight) in|top(?:ping)? up|putting (?:it|the cash|money|some) (?:in|into)|(?:could|would) go (?:in|into|to)|under-?weighted (?:areas|names|holdings) like|a good (?:home|place) for)\b|더 담|추가 매수|비중을 (?:늘|높)|더 사|사 모으|넣는 (?:것|게)|편입/i;
  return sentencesOf(text).filter((s) => VERB.test(s) && book.some((b) => b.names.some((n) => n && n.length >= 2 && nameIn(s, n))));
}

/** "Apple is my biggest holding" (round 7: accepted when NVDA is 19.2% and Apple 13.6%). The premise in the QUESTION
 *  is checked against the book; the correction line comes back, or null when the premise holds or names nothing. */
export function holdingRankPremise(question: string, holdings: { names: string[]; weight: number }[], ko = false): string | null {
  const q = String(question ?? "");
  const big = /\b(?:is|are)\s+(?:my|the)\s+(?:biggest|largest|top|main|heaviest|single biggest|single largest)\s+(?:holding|position|stock|bet|weight)\b|(?:가장|제일)\s?(?:큰|많은|비중이 큰)\s?(?:종목|보유|비중)/i;
  const small = /\b(?:is|are)\s+(?:my|the)\s+(?:smallest|tiniest|least)\s+(?:holding|position|stock)\b|(?:가장|제일)\s?(?:작은|적은)\s?(?:종목|보유|비중)/i;
  const which = big.test(q) ? "big" : small.test(q) ? "small" : null;
  if (!which || holdings.length < 2) return null;
  const named = holdings.filter((h) => h.names.some((n) => n && nameIn(q, n)));
  if (named.length !== 1) return null;
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const truth = which === "big" ? sorted[0] : sorted[sorted.length - 1];
  if (truth === named[0] || Math.abs(truth.weight - named[0].weight) < 0.05) return null;
  const n0 = named[0].names[0], t0 = truth.names[0];
  if (ko) return `${which === "big" ? "가장 큰" : "가장 작은"} 보유 종목은 ${n0}가 아니라 ${t0}(${truth.weight.toFixed(1)}%)입니다. ${n0}는 ${named[0].weight.toFixed(1)}%입니다.`;
  return `Your ${which === "big" ? "biggest" : "smallest"} holding is ${t0} at ${truth.weight.toFixed(1)}%, not ${n0}; ${n0} is ${named[0].weight.toFixed(1)}%.`;
}
/** Sentences that call a holding the biggest / smallest when it is not (the answer repeating a false premise). */
export function holdingRankClaims(text: string, holdings: { names: string[]; weight: number }[]): string[] {
  if (holdings.length < 2) return [];
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  return sentencesOf(text).filter((s) => {
    const big = /\b(?:the )?(?:biggest|largest|top|heaviest)(?: single)? (?:holding|position|stock|weight)\b|가장 큰 (?:종목|보유|비중)/i.test(s);
    const small = /\b(?:the )?(?:smallest|tiniest)(?: single)? (?:holding|position|stock)\b|가장 작은 (?:종목|보유|비중)/i.test(s);
    if (!big && !small) return false;
    const named = holdings.filter((h) => h.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const truth = big ? sorted[0] : sorted[sorted.length - 1];
    return named[0] !== truth && Math.abs(truth.weight - named[0].weight) >= 0.05;
  });
}

/** A holding's portfolio WEIGHT printed as its day MOVE ("META dropped 12.8%" when META is 12.8% of assets and fell
 *  3.3%, round 6/7 midday). Used on stored briefs, whose original figure is gone: the sentence goes. */
export function weightAsMoveHits(text: string, facts: { names: string[]; weight: number; pct: number | null }[]): string[] {
  return sentencesOf(text).filter((s) => facts.some((f) => f.names.some((n) => {
    if (!n || !nameIn(s, n)) return false;
    const re = new RegExp(`${/[가-힣]/.test(n) ? esc(n) : `(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`}[^.%]{0,30}?\\b(?:rose|fell|dropped|climbed|gained|slipped|jumped|surged|sank|tumbled|rallied|declined|lost|added|up|down)\\s+(?:by\\s+|about\\s+)?(\\d+(?:\\.\\d+)?)\\s?%`, "i");
    const m = s.match(re);
    if (!m) return false;
    const v = Number(m[1]);
    return Math.abs(v - f.weight) <= 0.05 && (f.pct === null || Math.abs(Math.abs(f.pct) - v) > 0.2);
  })));
}

/** A portfolio or holding yield that is not one we computed ("a yield near 0.5%" when the book yields 0.30% TTM /
 *  0.34% at the current rate, round 6/7 morning). */
export function wrongYieldClaims(text: string, allowed: number[], tol = 0.06): string[] {
  return sentencesOf(text).filter((s) => {
    if (!/\byield(?:s|ing)?\b|배당\s?수익률/i.test(s)) return false;
    const figs = [...s.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
    return figs.length > 0 && figs.every((v) => !allowed.some((a) => Math.abs(a - v) <= tol));
  });
}

/** A brief written during the day states the book's live day gain and total; the header above it moves on (round 7
 *  poweruser: "A $211 gain lifts today's book to $116,500" under a header reading +$319 / $116,620). Each such
 *  figure is labelled with the time it was read, once per sentence ("$116,500 (as of 4:05 PM ET)"). */
export function labelLiveFigures(text: string, figures: number[], label: string): string {
  const figs = figures.filter((f) => Number.isFinite(f) && Math.abs(f) >= 1);
  if (!figs.length) return String(text ?? "");
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((sent) => {
    if (sent.includes(label)) return sent;
    let lastEnd = -1;
    for (const m of sent.matchAll(/[+\-−]?\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)) {
      const v = Number(m[1].replace(/,/g, ""));
      if (figs.some((f) => Math.abs(Math.abs(f) - v) <= Math.max(1, Math.abs(f) * 0.005))) lastEnd = (m.index ?? 0) + m[0].length;
    }
    return lastEnd < 0 ? sent : `${sent.slice(0, lastEnd)} (${label})${sent.slice(lastEnd)}`;
  }).join(" "));
}

const KR_HOL = HOL.KR;
const krTrading = (ymd: string) => { const d = new Date(ymd + "T12:00:00Z").getUTCDay(); return d >= 1 && d <= 5 && !KR_HOL.has(ymd); };
const ymdAdd = (ymd: string, n: number) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** The KRX ex-date for the quarter an estimate falls in: record date = the quarter's last day (the last KRX session
 *  on or before it), ex-date = the session before that. Rolls to the next quarter when that is not after today. */
export function krxExDate(estimate: string, todayYmd: string): string {
  let y = Number(estimate.slice(0, 4)), q = Math.floor((Number(estimate.slice(5, 7)) - 1) / 3);
  for (let i = 0; i < 5; i++) {
    const end = new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10);
    let rec = end; while (!krTrading(rec)) rec = ymdAdd(rec, -1);
    let ex = ymdAdd(rec, -1); while (!krTrading(ex)) ex = ymdAdd(ex, -1);
    if (ex > todayYmd) return ex;
    q++; if (q > 3) { q = 0; y++; }
  }
  return estimate;
}

/** "(est)" belongs next to a DATE (round 7: "ETF inflows turn negative two months (est)", "CXMT DRAM shipments to
 *  hyperscaler (est)"). A tag with no date in front of it is removed. */
export function stripStrayEst(text: string): string {
  return String(text ?? "").replace(/\s*\((?:est|estimate|est\.)\)/gi, (m: string, at: number, whole: string) => {
    const before = whole.slice(Math.max(0, at - 32), at);
    return /(?:~|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,2}|\b(?:early|mid|late)[a-z -]*\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}|\bQ[1-4](?:\s+\d{4})?|\d+월(?:\s*\d+일)?)\s*$/i.test(before) ? m : "";
  });
}

/** Month names and brand names a lower-casing step left lower case ("The risk: december quarter", "siri settlement"). */
const PROPER_FIX: [RegExp, string][] = [
  ...["january", "february", "april", "june", "july", "august", "september", "october", "november", "december"].map((mo) => [new RegExp(`\\b${mo}\\b`, "g"), mo[0].toUpperCase() + mo.slice(1)] as [RegExp, string]),
  [/\bsiri\b/g, "Siri"], [/\biphone(s?)\b/g, "iPhone$1"], [/\bipad(s?)\b/g, "iPad$1"], [/\bazure\b/g, "Azure"], [/\bchatgpt\b/g, "ChatGPT"],
  [/\byoutube\b/g, "YouTube"], [/\bopenai\b/g, "OpenAI"], [/\bcopilot\b/g, "Copilot"], [/\bnvidia\b/g, "Nvidia"], [/\bnasdaq\b/g, "Nasdaq"], [/\bs&p\b/g, "S&P"],
];
export const fixProperCase = (t: string): string => PROPER_FIX.reduce((x, [re, to]) => x.replace(re, to), String(t ?? ""));

/** Promotional or unsupported characterisations in the app's voice (round 7 newcomer: "while cushioning volatility",
 *  "crypto hedge", "a speculative macro hedge"). */
export function promoCharacterisations(text: string): string[] {
  return sentencesOf(text).filter((s) => /\bcushion(?:s|ing|ed)? (?:the )?(?:volatility|swings|downside|drops?|the ride)\b|\bsmooth(?:s|ing|ed)? (?:out )?(?:the )?(?:ride|volatility|swings)\b|\b(?:crypto|macro|inflation|recession|dollar) hedge\b|\b(?:acts?|serves?|works?) as an? (?:\w+ )?hedge\b|\bas an? (?:\w+ )?hedge (?:against|for)\b/i.test(s));
}

/** "…delivering most of its dividend yield" about holdings that pay a small share of the income (round 7: AAPL + MSFT
 *  pay 26% of it, SCHD 53%). `payers` carries each holding's share of the portfolio's dividend income (0..100). */
export function dividendShareClaims(text: string, payers: { names: string[]; share: number }[]): string[] {
  return sentencesOf(text).filter((s) => {
    if (!/\b(?:most|the bulk|the majority|nearly all|almost all|the lion's share|most of) (?:of )?(?:its |the |your |the portfolio's )?(?:dividends?|income|dividend yield|yield|payouts?)\b|배당[^.]{0,10}(?:대부분|절반 이상)/i.test(s)) return false;
    const named = payers.filter((p) => p.names.some((n) => n && nameIn(s, n)));
    if (!named.length) return false;
    return named.reduce((a, p) => a + p.share, 0) < 50;
  });
}

/** A window's return compared with the yearly target ("+7.2% this month, on pace with your 8-12% annual target",
 *  round 7): a month is not a year. */
export function targetPaceClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => /\b(?:this|past|last|a|one|the)\s+(?:week|month|quarter)\b|\b(?:1W|1M|3M|30-day|7-day|90-day)\b|이번 (?:주|달)|한 달|1개월|3개월/i.test(s)
    && /\b(?:on pace|on track|in line|ahead of|behind|keeping pace|pace with|already (?:hit|met|beat))\b[^.]{0,50}\b(?:target|goal)\b|\b(?:annual|yearly|a year|per year|\/yr)\s*(?:return )?(?:target|goal)\b[^.]{0,30}\b(?:on pace|on track|in line|met|hit|beat)\b|목표[^.]{0,15}(?:달성|부합|페이스|순항)/i.test(s));
}

/** When the cash arrives is not in the data ("실제 입금은 보통 2-4주 뒤", round 7: wrong for Korean dividends, paid
 *  about 7 weeks after the record date). */
export function paymentLagClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => /\b(?:paid|payment|cash|deposit(?:ed)?|arrives?|hits? your account)\b[^.]{0,40}\b\d+\s?(?:[–-]|to)\s?\d+\s?(?:weeks?|days?)\b[^.]{0,20}\b(?:after|later|following)\b|(?:입금|지급|들어오)[^.]{0,20}\d+\s?[–~-]\s?\d+\s?(?:주|일)\s?(?:뒤|후)/i.test(s));
}

/** A dividend or report date we ESTIMATED, written without its label ("2026-09-28 (3일 뒤)" with no 추정 in a Korean
 *  answer, round 7): the label is added next to the date. `ymds` are the estimated dates (YYYY-MM-DD). */
export function labelEstimatedDates(text: string, ymds: string[], ko = false): string {
  let x = String(text ?? "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const ymd of [...new Set(ymds.filter(Boolean))]) {
    const mo = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
    const forms = [ymd.replace(/-/g, "\\-"), `${MON[mo - 1]}[a-z]*\\.? ${d}(?!\\d)`, `${mo}월\\s?${d}일`];
    for (const f of forms) {
      x = x.replace(new RegExp(`(~\\s*)?(${f})(\\s*\\([^)]{0,12}\\))?`, "g"), (m: string, tilde: string | undefined, date: string, paren: string | undefined, at: number, whole: string) => {
        const around = whole.slice(Math.max(0, at - 24), at + m.length + 14);
        const next = whole.slice(at + m.length, at + m.length + 3);
        if (tilde || /^\s?(?:경|쯤|께)/.test(next) || /\b(?:est|estimated|expected|around|about)\b|추정|예상|쯤/i.test(around)) return m;
        const tag = ko ? " (추정)" : " (est)";
        return paren ? `${date}${tag}${paren}` : `${date}${tag}`;
      });
    }
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------------------
// Round 8 intelligence audit
// ---------------------------------------------------------------------------------------------------------------
/** Reader level from the stored quiz answers. Round 8: the showcase profile had level ["confident"], not a quiz value
 *  (novice / intermediate / advanced / pro), and every function resolved it to NOVICE (beginner prompts and glosses).
 *  An unknown value now reads as intermediate; an empty answer stays novice (the quiz default). */
const LEVELS = ["novice", "intermediate", "advanced", "pro"];
export function readerLevel(xs: unknown): string {
  const arr = (Array.isArray(xs) ? xs : xs === undefined || xs === null || xs === "" ? [] : [xs]).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  if (!arr.length) return "novice";
  const known = arr.filter((x) => LEVELS.includes(x));
  if (!known.length) return "intermediate";
  return known.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), known[0]);
}

/** Superlatives over a window ("the strongest gain in your portfolio" for NVDA's +20.7% YTD when AAPL is +25.5%).
 *  The named holding must be the leader (or laggard) of that window. */
export function superlativeClaims(text: string, facts: { names: string[]; windows: Record<number, number | null> }[]): string[] {
  const WIN: [RegExp, number][] = [[/\b(?:year to date|YTD|this year|since January)\b|올해|연초/i, -1], [/\b(?:1-year|one-year|over (?:the )?(?:past |last )?year|12-month|1Y)\b|1년/i, 365],
    [/\b(?:three months|3-month|3M|quarter)\b|3개월/i, 90], [/\b(?:this month|one-month|1-month|30-day|1M|past month)\b|한 달|1개월/i, 30], [/\b(?:this week|one-week|1-week|1W|past week)\b|\b(?:the|this) week's\b|\bon the week\b|\bweekly\b|이번 주|1주/i, 7]];
  return sentencesOf(text).filter((s) => {
    const up = /\b(?:strongest|best|biggest|top|largest|leading|highest)\s+(?:gain|gainer|performer|performance|return|returner|rise|winner|mover)s?\b|\b(?:leads|tops) (?:your|the) (?:portfolio|holdings|pack|book)\b|\b(?:leads|is leading|tops|is ahead)\b(?=[^.]{0,30}(?:\bYTD\b|this year|year to date|\b1Y\b|past year|3-month|3M|this month|1M|this week))|가장 (?:많이 오른|큰 상승|수익률이 높은)/i.test(s);
    const down = /\b(?:weakest|worst|biggest|largest)\s+(?:loser|performer|performance|return|drop|decline|laggard)s?\b|\b(?:lags|trails) (?:your|the) (?:portfolio|holdings|pack|book)\b|가장 (?:많이 내린|부진한)/i.test(s);
    if (!up && !down) return false;
    const w = WIN.find(([re]) => re.test(s))?.[1];
    if (w === undefined) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const vals = facts.map((f) => f.windows[w]).filter((v): v is number => typeof v === "number");
    const mine = named[0].windows[w];
    if (typeof mine !== "number" || vals.length < 2) return false;
    return up ? mine < Math.max(...vals) - 0.05 : mine > Math.min(...vals) + 0.05;
  });
}

/** "below your buy price" / "underwater" for a holding that is ABOVE its cost (round 8: "Furthest below your buy price
 *  over 1 year: TSLA -12.1%", TSLA is +50% over its $248.70 average cost; -12.1% was its 1Y price return). */
export function costBasisClaims(text: string, facts: { names: string[]; gainPct: number | null }[]): string[] {
  return sentencesOf(text).filter((s) => {
    const below = /\b(?:below|under) (?:your|its|the) (?:buy|purchase|cost|average cost|entry|price you paid)(?: price| basis)?\b|\bunderwater\b|\bat a loss (?:on|since)\b|\blosing money on\b|매수가(?:보다)? 아래|손실 중/i.test(s);
    const above = /\b(?:above|over) (?:your|its|the) (?:buy|purchase|cost|average cost|entry)(?: price| basis)?\b|\bin the green (?:on|since)\b/i.test(s);
    if (!below && !above) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    return named.some((f) => typeof f.gainPct === "number" && (below ? f.gainPct >= 0 : f.gainPct < 0));
  });
}

/** "Both sit inside your 12-20% yearly target" when one of them is 11.5% (round 8). Every figure the sentence places
 *  inside / above / below the target band must be there. */
export function targetBandClaims(text: string): string[] {
  const all = sentencesOf(text);
  return all.filter((s, idx) => {
    // "Both sit inside your target" takes its figures from the sentence before
    const prev = /^(?:both|they|these|those|it|that|each|all three|all two|the two)\b/i.test(bare(s)) && idx > 0 ? all[idx - 1] : "";
    const band = /(\d+(?:\.\d+)?)\s?%?\s?(?:-|–|to)\s?(\d+(?:\.\d+)?)\s?%\s*(?:yearly |annual |a year |per year )?(?:return )?(?:target|goal)|목표[^.\d]{0,10}(\d+)\s?[~-]\s?(\d+)\s?%/i.exec(s);
    if (!band) return false;
    const lo = Number(band[1] ?? band[3]), hi = Number(band[2] ?? band[4]);
    let figs = [...s.matchAll(/([+−-]?\d+(?:\.\d+)?)\s?%/g)].filter((m) => (m.index ?? 0) < (band.index ?? 0) || (m.index ?? 0) > (band.index ?? 0) + band[0].length)
      .map((m) => Math.abs(Number(m[1].replace("−", "-"))));
    if (!figs.length && prev) figs = [...prev.matchAll(/([+−-]?\d+(?:\.\d+)?)\s?%/g)].map((m) => Math.abs(Number(m[1].replace("−", "-"))));
    if (!figs.length) return false;
    if (/\b(?:inside|within|in line with|on pace with|meets?|meeting|hits?|in)\s+(?:your|the)\b[^.]{0,6}\d|안에|범위 안|부합|달성/i.test(s)) return figs.some((v) => v < lo || v > hi);
    if (/\b(?:above|beats?|exceeds?|ahead of|over)\s+(?:your|the)\b/i.test(s)) return figs.some((v) => v <= hi);
    if (/\b(?:below|under|short of|behind|misses?)\s+(?:your|the)\b/i.test(s)) return figs.some((v) => v >= lo);
    return false;
  });
}

/** A group share stated as a figure ("Tech makes up about 57% of assets" when it is ~97%) corrected to the computed
 *  share. `groups` label a group and its share of assets. */
export function fixGroupShares(text: string, groups: { label: RegExp; value: number }[], tolPp = 5, members: { names: string[] }[] = []): string {
  return perLine(text, (line) => splitSentences(line).map((sent) => {
    // r12 C: a sentence that lists its own members ("NVDA, AMD and SOXL: 48%") states THEIR share, not the group's
    if (members.filter((m) => m.names.some((n) => n && nameIn(sent, n))).length >= 2) return sent;
    for (const g of groups) {
      const re = new RegExp(`(${g.label.source}[^.%]{0,40}?\\b(?:makes? up|is|are|at|about|around|roughly|nearly|near|accounts? for|totals?)\\s+(?:about |around |roughly |nearly |near |~)?)(\\d+(?:\\.\\d+)?)(\\s?%)`, g.label.flags.replace("g", "") + "g");
      sent = sent.replace(re, (m: string, pre: string, n: string, pct: string) => Math.abs(Number(n) - g.value) > tolPp ? `${pre}${g.value.toFixed(1)}${pct}` : m);
    }
    return sent;
  }).join(" "));
}

/** A move's cause taken from ANOTHER holding's news ("META fell 3.3% after a director sale filing": the director sale
 *  was Broadcom's, round 8), or "no clear news" for a holding that has a headline today. `facts` carry each holding's
 *  own recent headlines. */
export function misattributedCauses(text: string, facts: { names: string[]; headlines: string }[]): string[] {
  const STOP = new Set(["after", "about", "their", "there", "which", "while", "shares", "stock", "stocks", "today", "report", "reports", "company", "market", "investors", "percent", "filing", "news", "since", "would", "could", "being"]);
  return sentencesOf(text).filter((s) => {
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const me = named[0];
    // round 9: "No META headline explains today's 3.3% drop" (Forbes and Yahoo carried two), "none in file", "No fresh
    // headlines available" (NVDA had 40): a no-news claim for a holding that HAS headlines goes
    if (/\bon no (?:clear |obvious )?news\b|\bno (?:clear |obvious |specific |single )?(?:[A-Z][\w.&-]* )?(?:headlines?|news)\b[^.]{0,40}\b(?:explains?|behind|available|points? to|in (?:the )?file|on file|cites?|gives?)\b|\bnone (?:in|on) file\b|\bno fresh (?:headlines?|news)\b|뚜렷한 (?:뉴스|이유) 없이|(?:헤드라인|뉴스)(?:이|가|은|는|에)?[^.]{0,20}(?:없|부재)|원인(?:은|이)? (?:없|불분명|확인되지 않)|원인 없음|설명하는 (?:헤드라인|뉴스)(?:이|가|는)? 없/i.test(s)) return me.headlines.trim().length > 0;
    const m = /\b(?:after|on|following|as|because of|due to|amid)\s+(?:a |an |the )?([^.,;]{6,80})/i.exec(s);
    if (!m) return false;
    const words = (m[1].toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []).filter((w) => !STOP.has(w) && !me.names.some((n) => n.toLowerCase().includes(w)));
    if (!words.length) return false;
    const mine = me.headlines.toLowerCase();
    if (words.some((w) => mine.includes(w))) return false;
    return facts.some((f) => f !== me && words.filter((w) => f.headlines.toLowerCase().includes(w)).length >= Math.min(2, words.length));
  });
}

/** Signed figures in generated copy use the true minus sign (U+2212), as the client renders them ("META -3.3%" in a
 *  fresh News card, round 8). A hyphen inside a range ("12-20%") or a word is left alone. */
export const unicodeMinus = (t: string): string => String(t ?? "").replace(/(^|[\s(\[:,])-(?=\$?\d)/g, "$1−");

/** A single-sentence field whose only sentence carries a verdict TAIL ("A $211 gain lifts today's book to $116,500,
 *  keeping the portfolio on track.") loses the tail, not the sentence (round 8: the fresh close lede kept it because
 *  dropping its only sentence would empty the field). */
export const stripVerdictTails = (t: string): string => String(t ?? "")
  .replace(/,?\s*(?:while |and |thereby )?(?:keeping|keeps) (?:the |your )?(?:portfolio|book|plan|goals?) on track\b/gi, "")
  .replace(/,?\s*(?:while |and )?cushioning (?:the )?(?:volatility|swings|downside)\b/gi, "")
  .replace(/,?\s*(?:while |and )?keeping (?:costs|fees|expenses) low\b/gi, "")
  .replace(/\s+([.!?])/g, "$1");

/** Spoken-script figures that belong to something else (round 8: "Oracle may cut data center spending by more than
 *  five point one percent", where 5.1% was the VIX change). Each percent spoken (words or digits) must appear in a
 *  sentence of the brief that names the same subject. */
export function misplacedScriptFigures(script: string, sectionsText: string): string[] {
  // the sections arrive as JSON: every string value is its own text, split into sentences
  const src = String(sectionsText ?? "");
  const values = src.trim().startsWith("{") ? (src.match(/"(?:[^"\\]|\\.)*"/g) ?? []).map((x) => x.slice(1, -1).replace(/\\n/g, " ")) : [src];
  const briefSents = values.flatMap((v) => splitSentences(v));
  const caps = (x: string) => new Set((x.match(/\b[A-Z][A-Za-z&.-]{2,}\b/g) ?? []).filter((w) => !/^(?:The|This|That|Your|It|They|But|And|Today|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|Talk|That's)$/.test(w)));
  return String(script ?? "").replace(/<break[^>]*\/>/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).filter((sent) => {
    const digits = digitsForWritten(sent);
    const figs = [...digits.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
    if (!figs.length) return false;
    const subj = caps(sent);
    if (!subj.size) return false;
    return figs.some((v) => {
      const homes = briefSents.filter((b) => [...b.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].some((m) => Math.abs(Number(m[1]) - v) < 0.06 || Math.abs(Math.round(Number(m[1])) - v) < 0.01));
      if (!homes.length) return true;
      return !homes.some((b) => [...subj].some((w) => b.includes(w)));
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Round 8 newcomer: one sanitize() for every generated surface, a product denylist, parenthetical glosses,
// stale news, headline-anchored news lines
// ---------------------------------------------------------------------------------------------------------------
/** Product categories the app never points a reader to (round 8: "Crypto risk: hedge with stablecoin yield platforms to
 *  smooth volatility" in GAPS & IDEAS). Flagged when suggested (a verb of use, an idea's "gap: product" shape, or a
 *  purpose like "to smooth / for yield"), or in any idea line. */
const PRODUCTS = /\b(?:(?:stablecoin |crypto |defi )?yield (?:platforms?|farming|products?|accounts?|vaults?)|stablecoin yields?|staking (?:platforms?|services?|pools?|rewards? programs?)|(?:crypto |defi |p2p )?lending (?:platforms?|protocols?|products?)|leveraged (?:ETFs?|funds?|products?|tokens?)|inverse (?:ETFs?|funds?)|(?:2x|3x|triple|double)[- ]leveraged|(?:covered[- ]call|options?|put[- ]selling|straddle|collar|spread|wheel) (?:strateg(?:y|ies)|income|funds?|ETFs?)|(?:buying|selling|writing|trading) (?:calls|puts|options)|margin (?:loans?|trading|accounts?|borrowing)|on margin|buy now,? pay later|crypto loans?)\b/i;
export function productPushHits(text: string, ideaSurface = false): string[] {
  return sentencesOf(text).filter((s) => PRODUCTS.test(s) && (ideaSurface
    || /\b(?:consider|try|use|using|look (?:at|into)|research|explore|add|adding|via|through|hedge with|switch to|move (?:it |cash )?(?:to|into)|put (?:it |cash )?(?:in|into))\b|:\s*\S|\bto (?:smooth|boost|earn|protect|hedge|juice|enhance)\b|\bfor (?:yield|income|protection|extra return)\b|활용|고려|알아보/i.test(s)));
}

/** ONE pipeline for every piece of generated reader copy (Ask, briefs incl. ideas and watch items, cards, News lines,
 *  narration scripts). It removes whole sentences only, keeps lines and bullets, and returns "" when nothing
 *  survives, so a caller can drop an idea or a card line instead of shipping it. Context-free guards only:
 *  advice and verdicts (incl. valuation), promo and product pushes, return forecasts, target pace, payment lag,
 *  circular causes and our own prompt words; then verdict tails, digits and true minus signs. Figure checks that
 *  need the book (moves, weights, periods) stay at each surface. */
export function sanitize(text: string, opts: { verdictQuestion?: boolean; ideaSurface?: boolean } = {}): string {
  const src = stripVerdictTails(dropInstructionEcho(String(text ?? "")));
  const bad = new Set([...adviceHits(src, { verdictQuestion: opts.verdictQuestion }), ...promoClaims(src), ...promoCharacterisations(src), ...productPushHits(src, opts.ideaSurface),
    ...returnForecasts(src), ...targetPaceClaims(src), ...paymentLagClaims(src), ...circularCauses(src)].map((x) => bare(x)));
  const out = bad.size ? perLine(src, (line) => splitSentences(line).filter((x) => !bad.has(bare(x))).join(" ")) : src;
  return out.trim() ? unicodeMinus(digitsForWritten(out)) : "";
}

/** A beginner gloss that cannot break grammar: the term stays and its plain meaning follows once, in parentheses
 *  ("moat (a lasting edge over competitors)"). Round 8: substituted glosses read "defends Amazon's retail lasting
 *  edge over competitors" and "a wide the biggest companies gap". */
export function glossParenthetical(text: string, keep: string[] = []): string {
  let x = String(text ?? "");
  const done = new Set<string>();
  // the context-only variants (lookbehind entries: "wide moat" -> "edge") are for substitution; a parenthesis gives the full meaning
  for (const g of NOVICE_PLAIN.filter((e) => !keep.includes(e.sample) && !e.re.source.startsWith("(?<="))) {
    if (done.has(g.plain)) continue;
    const re = new RegExp(g.re.source, g.re.flags.replace("g", ""));
    const m = re.exec(x);
    if (!m || m.index === undefined) continue;
    const after = x.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^\s?\(/.test(after) || done.has(m[0].toLowerCase())) continue;   // already explained
    const plain = g.plain.replace(/^(?:its|their) /, "").replace(/^the /, "");
    x = x.slice(0, m.index + m[0].length) + ` (${plain})` + x.slice(m.index + m[0].length);
    done.add(g.plain); done.add(m[0].toLowerCase());
  }
  return x;
}

/** A headline about a quarter whose report has already passed ("Ahead Of Q2 Report" in late September, round 8), or
 *  older than `maxDays`: not news for today. */
export function staleNewsTitle(title: string, publishedAt: string | null, todayYmd: string, maxDays = 10): boolean {
  if (publishedAt && Date.parse(todayYmd + "T12:00:00Z") - Date.parse(publishedAt) > maxDays * 86400000) return true;
  const m = /\b(?:ahead of|before|into|preview(?:ing)?|awaits?|upcoming|expected)\b[^.]{0,30}\bQ([1-4])\b|\bQ([1-4])\b[^.]{0,20}\b(?:preview|expectations|estimates|report (?:is )?(?:coming|due|ahead))\b/i.exec(String(title ?? ""));
  if (!m) return false;
  const q = Number(m[1] ?? m[2]);
  const mo = Number(todayYmd.slice(5, 7));
  // the quarter whose reports come next: Q3 in Sep-Nov, Q4 in Dec-Feb, Q1 in Mar-May, Q2 in Jun-Aug
  const upcoming = mo % 3 === 0 ? mo / 3 : Math.ceil(mo / 3) - 1 || 4;
  return q !== upcoming;
}

/** A headline that may stand in a News line (round 9 designer: the verbatim anchoring put "Is Meta the Best Magnificent
 *  Seven Stock to Buy…?" and "Apple Stock Price Up 1.5% - Time to Buy?" into the card in Assetly's voice). Buy/sell
 *  framing, listicles, "if you invest $X" and "could be worth" forecasts, price-target calls, insider-filing boilerplate
 *  and question-form clickbait are not news lines. */
export function headlineOk(title: string): boolean {
  const t = decodeHtml(String(title ?? "")).replace(/[‘’]/g, "'").trim();
  if (!t) return false;
  if (/(?:…|\.\.\.)\s*$/.test(t)) return false;                                            // cut by the feed ("renewa...")
  if (/\?\s*(?:[-|–—]\s*[^?]{2,40})?$/.test(t)) return false;                        // question-form titles
  if (/(?:^|[.:]\s+)(?:could|can|will|is|are|should|would|where|what|why|how (?:much|high|low|far))\b[^?]{3,80}\?/i.test(t)) return false;   // a question heading the title
  if (/\b(?:this|these) (?:\w+ )?stocks? (?:may|could|might|is|are)\b|\b(?:may|could) be the best\b/i.test(t)) return false;
  if (/\b(?:(?:to|a|a better|still a|strong|top|best)\s+buy|buy(?:ing)? (?:now|the dip|opportunity)|time to (?:buy|sell)|(?:should|would) you (?:buy|sell)|worth buying|to sell now|(?:better|best) (?:stock|pick|buy)|is (?:a )?(?:buy|sell)\b|sell[- ]off alert|on sale\b|bargain|no[- ]brainer|millionaire|retire (?:rich|early))/i.test(t)) return false;
  if (/^\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:[A-Z][\w-]*|AI|top|great|dividend|growth|unstoppable|magnificent)\s+){0,3}(?:stocks?|etfs?|reasons?|things|ways|picks)\b/i.test(t)) return false;   // listicles
  if (/:\s*(?:\d+|one)\s+(?:\w+\s+){0,2}stocks?\b|\b\d+\s+(?:AI\s+)?stocks?\s+to\b/i.test(t)) return false;
  if (/\bif you (?:had )?invest(?:ed)?\s+\$|\bcould be worth\b|\bwhat (?:it|they) could be worth|\bhere'?s (?:what|how much)\b|\bprice (?:targets?|predictions?|forecasts?)\b|\bstock forecasts?\b|\bby 20[3-9]\d\b/i.test(t)) return false;
  // r11: pitches ("Meet the…", "Our Target Leaves Wall Street Behind", "82% Upside")
  if (/^meet the\b|\bour (?:price )?target\b|\b\d+(?:\.\d+)?% upside\b|\bupside (?:potential|target)\b|\bleaves wall street behind\b|\bmillionaire[- ]maker\b|\bgenerational\b|\bmust[- ]own\b|\bcould soar\b|\bset to (?:soar|explode)\b/i.test(t)) return false;
  // r10: "Why now might be a good time to invest in Alphabet", "(and 3 Other Stocks to Watch)"
  if (/\b(?:good|great|right|best) time to (?:buy|invest|add|own)\b|\btime to invest\b|\b\d+ other stocks?\b|\bstocks? to (?:watch|own|hold)\b/i.test(t)) return false;
  if (/\bForm\s*4\b|\bSEC Form\b|\b(?:director|officer|insider|10% owner|ceo|cfo|evp|svp)\b[^.]{0,40}\b(?:reported|reports|files?|filed)\b[^.]{0,40}\b(?:sale|sales|purchase|purchases|gift|acquisition)s?\b|\bshare gift\b|\bsells? [\d,]+ shares\b|\bbuys? [\d,]+ shares\b/i.test(t)) return false;
  if (/\bwhat'?s (?:going on|next|happening)\b|\bwhy (?:is|are|did|does)\b[^.]{0,40}\bstock\b/i.test(t)) return false;
  return true;
}

/** HTML entities in a feed title ("&amp;", "&#39;", "&quot;"): the shared rule, plus numeric entities. */
const decodeHtml = (t: string): string => decodeEntities(String(t ?? "")).replace(/&nbsp;|&#160;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));

const PUBLISHERS = "Yahoo Finance|Reuters|Bloomberg|MarketBeat|Investing\\.com(?: Canada)?|Seeking Alpha|The Motley Fool|Motley Fool|Benzinga|CNBC|Barron's|MarketWatch|TipRanks|Zacks(?: Investment Research)?|Forbes|TheStreet|Barchart|GuruFocus|Stocktwits|24/7 Wall St\\.|Investor's Business Daily|Stock Titan|TradingKey|Fox Business|Financial Post";
/** A feed title in the card's typography: entities decoded, publisher suffixes ("- Yahoo Finance", "By Investing.com")
 *  and ticker parentheticals ("Apple (AAPL)", "(NASDAQ:AAPL)") removed, em and en dashes made commas or colons (house
 *  style has no em dashes), curly quotes straightened, a trailing "…" removed. */
export function cleanHeadline(title: string, names: string[] = []): string {
  let t = decodeHtml(String(title ?? "")).replace(/\s+/g, " ").trim();
  // r10: feed labels ("Market Chatter:", "The 8:30:", "UPDATE 2 -", "| Closing Bell")
  t = t.replace(/^(?:Market Chatter|The \d{1,2}:\d{2}|Breaking|Exclusive|Update(?: \d+)?|Stock Market Today(?:,[^:]{0,20})?|Earnings Preview|Midday Movers|Premarket Movers)\s*[:\-\u2013\u2014]\s*/i, "")
    .replace(/\s*\|\s*(?:Closing Bell|Opening Bell|Mad Money|Squawk Box|Power Lunch|Fast Money|The Exchange|Market Wrap|Morning Brief)\s*$/i, "");
  t = t.replace(new RegExp(`\\s*(?:[-|–—]\\s*|\\bBy\\s+)(?:${PUBLISHERS})\\s*$`, "i"), "");
  // a trailing " - <holding name>" section tag ("What's Going On With Microsoft Stock Friday? - Microsoft")
  for (const n of names) if (n && n.length >= 3) t = t.replace(new RegExp(`\\s+[-|–—]\\s+${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  t = t.replace(/\s*\((?:NASDAQ|NYSE|NYSEARCA|AMEX|KRX|KOSPI|KOSDAQ|OTC|TSX|LSE)\s*:\s*[A-Z0-9.\-]+\)/gi, "")
    .replace(/\s*\((?:[A-Z]{1,5}(?:\.[A-Z])?|\d{6}(?:\.K[SQ])?)\)/g, "");
  t = t.replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"');
  // "Market—While": a comma; spaced "X — Y" / "X -- Y" / "X - Y": a colon when nothing punctuates before it, else a comma
  t = t.replace(/(\S)[—–](\S)/g, "$1, $2")
    .replace(/\s+(?:—|–|--?)\s+/g, (_m, at: number, whole: string) => (/[:,;]/.test(whole.slice(0, at)) ? ", " : ": "))
    .replace(/[—–]/g, ", ");
  t = t.replace(/\s*(?:…|\.\.\.)\s*$/, "").replace(/\s+([,.:;!])/g, "$1").replace(/[,:;]\s*$/, "").trim();
  return t;
}

/** The first day-move percent a headline states ("Apple Stock Price Up 1.5%", "Meta Slides 4%"), signed, or null.
 *  Monthly / yearly / weekly figures ("32% monthly run") are not day moves. */
function headlineDayMove(t: string): number | null {
  const m = /\b(up|down|rises?|rose|gains?|gained|climbs?|climbed|jumps?|jumped|soars?|soared|surges?|surged|rall(?:y|ies|ied)|falls?|fell|drops?|dropped|slides?|slid|slips?|slipped|sinks?|sank|tumbles?|tumbled|plunges?|plunged|dips?|dipped|sheds?|lower|higher)\s+(?:by\s+|nearly\s+|almost\s+|over\s+|more than\s+|about\s+)?(\d+(?:\.\d+)?)%(?!\s*(?:in|over|this|a|for|since)?\s*(?:the\s+)?(?:past\s+)?(?:month|monthly|year|yearly|week|weekly|ytd|quarter|\d+\s*(?:days|weeks|months)))/i.exec(t);
  if (!m) return null;
  const down = /^(?:down|falls?|fell|drops?|dropped|slides?|slid|slips?|slipped|sinks?|sank|tumbles?|tumbled|plunges?|plunged|dips?|dipped|sheds?|lower)$/i.test(m[1]);
  return (down ? -1 : 1) * Number(m[2]);
}

/** News lines stay anchored to their source (round 8: "NVDA CEO warns AI slowdown risk despite hype" for "Nvidia CEO
 *  Pushes Back On The 'AI Apocalypse'"). Each line is REPLACED by the source headline it paraphrases, attributed
 *  ("Reuters: …"), or dropped. Round 9 designer: only headlines that pass headlineOk are candidates; the match must share
 *  most of the line's words besides the holding's names (0.35, was 0.1, which took "Apple (AAPL) Reaches $250 Million
 *  Siri Settlement" for "Apple climbs toward 350 dollars"); a headline whose day move disagrees with the live move by
 *  more than half a point goes ("Meta Slides 4%" at -3.3%); a title too long for the line is cut at a clause or not used,
 *  never cut mid-phrase with "…". `dayMoves`: live day % by symbol. */
export function anchorNewsLine(line: string, heads: { symbol: string; names: string[]; title: string; source?: string | null }[], maxLen = 96, dayMoves: Record<string, number | null | undefined> = {}): string | null {
  const it = anchorNewsItem(line, heads, maxLen, dayMoves);
  return it ? (it.source ? `${it.source}: ${it.text}` : it.text) : null;
}
/** The anchored headline as the client renders it: {text, source} (the source shown as the attribution, round 9). A
 *  title that does not name the holding is prefixed with it ("Meta: ..."). */
export function anchorNewsItem(line: string, heads: { symbol: string; names: string[]; title: string; source?: string | null }[], maxLen = 96, dayMoves: Record<string, number | null | undefined> = {}): { text: string; source: string | null } | null {
  const named = heads.filter((h) => h.names.some((n) => n && nameIn(line, n)) && headlineOk(h.title));
  if (!named.length) return null;
  const STOP = /^(?:the|and|for|with|its|after|from|this|that|stock|stocks|shares|share|inc|corp|company|today|says|said|amid|over|into|than|more|on|as|at|by|of|to|in|an|a)$/;
  const toks = (t: string, names: string[]) => {
    const nameToks = new Set(names.flatMap((n) => String(n).toLowerCase().match(/[a-z0-9]+/g) ?? []));
    return new Set((t.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").match(/[a-z0-9$%.]{3,}|\d+(?:\.\d+)?%?/g) ?? [])
      .map((w) => w.replace(/\.$/, "").replace(/'s$/, "")).filter((w) => w.length >= 2 && !STOP.test(w) && !nameToks.has(w.replace(/[$%]/g, ""))));
  };
  const cands = named.filter((h) => {
    // r10: "Amazon: Meta's Muse Just Handed Investors A $65 Billion Gift" is about Meta: a "<name>:" prefix whose rest does
    // not name the holding is not that holding's headline
    const m = /^([^:]{2,30}):\s*(.+)$/.exec(cleanHeadline(h.title));
    return !m || [h.symbol.replace(/\.(?:KS|KQ)$/, ""), ...h.names].some((n) => n && n.length >= 2 && nameIn(m[2], n));
  }).map((h) => {
    const t = cleanHeadline(h.title, [h.symbol.replace(/\.(?:KS|KQ)$/, ""), ...h.names]);
    const L = toks(line, [h.symbol, ...h.names]), T = toks(t, [h.symbol, ...h.names]);
    let n = 0; for (const w of L) if (T.has(w)) n++;
    return { h, t, sc: n / Math.max(1, Math.min(L.size, T.size)), n };
  }).filter((c) => {
    if (c.sc < 0.35 || c.n < 2) return false;
    const live = dayMoves[c.h.symbol];
    const said = headlineDayMove(c.t);
    return !(typeof live === "number" && said !== null && Math.abs(said - live) > 0.5);
  }).sort((a, b) => (b.sc - a.sc) || ((a.t.length <= maxLen ? 0 : 1) - (b.t.length <= maxLen ? 0 : 1)));
  for (const c of cands) {
    let t = c.t;
    if (t.length > maxLen) {
      // cut at the last clause boundary that fits, or skip this headline
      const cut = t.slice(0, maxLen + 1).match(/^(.{30,}?)(?:[,;:]\s|\s(?:as|after|while|amid|but|despite)\s)(?!.*(?:[,;:]\s|\s(?:as|after|while|amid|but|despite)\s))/);
      if (!cut) continue;
      t = cut[1].trim();
    }
    const sym = c.h.symbol.replace(/\.(?:KS|KQ)$/, "");
    const src = sourceName(String(c.h.source ?? ""));
    const mentions = [sym, ...c.h.names].some((n) => n && nameIn(t, n));
    const pretty = c.h.names.find((n) => n && !/^[A-Z0-9.]{1,6}$/.test(n)) ?? c.h.names[0];
    return { text: mentions ? t : `${pretty}: ${t}`, source: src || null };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 newcomer
// ---------------------------------------------------------------------------------------------------------------
/** One symbol for one listing: "BRKB" and "BRK-B" are BRK.B (round 9: the duplicate BRKB ranked first in search with its
 *  own wrong price row). A US class share written without its dot, or with Yahoo's dash, takes the dotted form. */
export function canonicalSymbol(symbol: string, yahoo?: string | null): string {
  const s = String(symbol ?? "").toUpperCase().trim();
  if (/\.(?:KS|KQ)$|-USD$|^\^|=F$|^USD[A-Z]{3}$/.test(s)) return s;
  const y = String(yahoo ?? "").toUpperCase();
  const m = /^([A-Z]{1,4})-([A-Z])$/.exec(y);
  if (m && (s === `${m[1]}${m[2]}` || s === `${m[1]}-${m[2]}` || s === `${m[1]}.${m[2]}`)) return `${m[1]}.${m[2]}`;
  if (/^[A-Z]{1,4}-[A-Z]$/.test(s)) return s.replace("-", ".");
  return s;
}

/** r12 C: ONE definition of "tech and chips" for every surface (ask had two copies without leveraged semiconductors). An
 *  index fund (QQQM) is not counted: counting the whole fund as tech double-counted it ("96.5% tech"). */
export const TECH_THEMES = new Set(["AI semiconductors", "AI infrastructure", "mega-cap platforms", "software", "consumer internet", "leveraged semiconductors", "leveraged tech"]);
const THEME_WORDS: [RegExp, string[]][] = [
  [/\bhealth ?care|health-care|pharma|medical\b/i, ["healthcare"]], [/\bfinancials?|banks?|banking|insurers?\b/i, ["financials"]],
  [/\btech(?:nology)?\b/i, [...TECH_THEMES]],
  [/\bsemiconductors?|chips?\b/i, ["AI semiconductors", "leveraged semiconductors"]], [/\benergy|oil\b/i, ["energy"]], [/\bconsumer staples|staples\b/i, ["consumer staples"]],
  [/\bcrypto\b/i, ["crypto", "crypto beta"]], [/\bdividend\b/i, ["dividend equity", "income equity"]], [/\bbonds?\b/i, ["bonds"]], [/\bsoftware\b/i, ["software"]],
];
/** "healthcare-heavy", "the single biggest thematic weight" for a theme that is not the biggest (round 9: healthcare 19.4%
 *  called the biggest while financials, JPM + BRK, were 28.5%). `themes` are the computed theme weights (% of assets). */
export function themeClaims(text: string, themes: { name: string; pct: number }[]): string[] {
  if (themes.length < 2) return [];
  const top = [...themes].sort((a, b) => b.pct - a.pct)[0];
  const share = (names: string[]) => themes.filter((t) => names.includes(t.name)).reduce((a, t) => a + t.pct, 0);
  return sentencesOf(text).filter((s) => {
    const heavy = /\b([A-Za-z]{2,20})-heavy\b|\bheavy (?:in|on) ([a-z][a-z ]{2,20})\b|\bdominated by ([a-z][a-z ]{2,20})\b/i.exec(s);
    const biggest = /\b(?:single )?(?:biggest|largest|top|dominant|main|heaviest)\s+(?:thematic weight|theme|sector|exposure|bet|tilt)\b/i.test(s);
    if (!heavy && !biggest) return false;
    const scope = heavy ? (heavy[1] ?? heavy[2] ?? heavy[3] ?? "") : s;
    const hit = THEME_WORDS.find(([re]) => re.test(scope));
    if (!hit) return false;
    const mine = share(hit[1]);
    // the named theme must be the biggest (within 2 points of the top theme's weight)
    return !hit[1].includes(top.name) && top.pct - mine > 2;
  });
}

/** Ideas that contradict the book (round 9: "All-US book: developed-market ex-US index funds" next to a 12.6% Korean
 *  holding; "dividend-growth ETFs beyond SCHD" for a SCHD holder) or copy the prompt's own examples word for word. */
export function ideaContradictions(idea: string, book: { names: string[]; theme: string; pct: number; region: "US" | "KR" | "crypto" }[], examples: string[] = []): boolean {
  const t = String(idea ?? "");
  const low = t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (examples.some((e) => { const x = e.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); return x && (low === x || low.includes(x)); })) return true;
  const nonUS = book.filter((b) => b.region === "KR").reduce((a, b) => a + b.pct, 0);
  if (/\ball[- ]us\b|\bus[- ]only\b|\bonly us\b|\bno (?:international|non-us|foreign|ex-us|overseas)\b/i.test(t) && nonUS >= 2) return true;
  if (/\bno crypto\b/i.test(t) && book.some((b) => b.region === "crypto" && b.pct >= 1)) return true;
  // an idea is about a GAP: naming a holding, or a category the book already holds (3%+), is not one
  if (book.some((b) => b.names.some((n) => n && n.length >= 2 && nameIn(t, n)))) return true;
  const CAT: [RegExp, string[]][] = [[/\bdividend(?:-growth)?\b|\bincome\b/i, ["dividend equity", "income equity"]], [/\bbonds?\b|\bfixed income\b|\btreasur/i, ["bonds"]],
    [/\bgold\b/i, ["gold"]], [/\binternational|ex-us|developed-market\b/i, ["international index"]], [/\bs&p 500|broad (?:us |market )?index\b/i, ["broad US index"]]];
  for (const [re, themes] of CAT) if (re.test(t) && book.filter((b) => themes.includes(b.theme)).reduce((a, b) => a + b.pct, 0) >= 3) return true;
  return false;
}

/** A holding's quality note, cleaned (round 9: KO's "The risk:" listed strengths, the raw field name leaked as
 *  ">consensus tripwire", SCHD's risk came twice, JNJ and BRKB had none). Field names go, repeated sentences go, and a
 *  risk sentence with no negative in it goes. `needsRisk` says the caller must supply one (from data) or leave it out. */
export function cleanNote(note: string): { note: string; needsRisk: boolean } {
  let x = String(note ?? "").replace(/\s*\b(?:tripwire|long[_ ]case|near[_ ]term catalyst|role|memo)\b\s*:?/gi, (m) => /^\s*tripwire\b/i.test(m) ? " " : m)
    .replace(/(\S)\s+tripwire\b/gi, "$1").replace(/\b(?:business|quality|role|tripwire|near)\s*:\s*/gi, "")
    // memo shorthand ">consensus", "<4%": words
    .replace(/(^|\s)>\s?(?=[A-Za-z$\d])/g, "$1above ").replace(/(^|\s)<\s?(?=[A-Za-z$\d])/g, "$1below ").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  const seen: string[] = [];
  const NEG = /\b(?:risk|below|declin\w*|slow\w*|cut\w*|weak\w*|loss\w*|lose|debt|leverage\w*|competit\w*|depend\w*|concentrat\w*|regulat\w*|cyclical|volatil\w*|stretch\w*|expensive|uncertain\w*|pressure\w*|dilut\w*|custody|export|miss\w*|fall\w*|drop\w*|shrink\w*|lawsuit|litigation|probe|tariff\w*|headwind\w*|exposure to|could|if|fails?|erod\w*|squeeze\w*|slump\w*|downgrad\w*|trail\w*|underperform\w*|lag\w*|behind|erosion|erod\w*|biosimilar\w*|miss\w*)\b/i;
  const sents = splitSentences(x).filter((sen) => !/\bgiving (?:it |you )?an edge\b|\bbacked by an edge\b|\bexposure to companies\b/i.test(sen)).filter((sen) => {
    const k = sen.toLowerCase().replace(/[^a-z0-9%.]+/g, " ").trim();
    if (seen.some((p) => p === k || overlap(p, k) >= 0.9)) return false;
    seen.push(k);
    return true;
  }).filter((sen) => {
    if (!/^\s*(?:the )?risk\s*:/i.test(sen)) return true;
    const body = sen.replace(/^\s*(?:the )?risk\s*:/i, "");
    if (!NEG.test(body)) return false;
    // a list of strengths in the risk slot (KO: "iconic brand moat, ..., high margins, strong cash generation,
    // manageable leverage"): most items carry a strength marker
    const items = body.split(/,|;|\band\b/).map((x) => x.trim()).filter(Boolean);
    // r10: "highly diversified with no concentration risk" (a strength), "expense ratio could exceed 0.05%" (not a real risk)
    if (/\bno (?:\w+ ){0,2}risks?\b|\b(?:highly |broadly |well[- ])?diversified\b|\blow[- ]cost\b|\blow fees?\b|\bexpense ratio\b/i.test(body) && !/\b(?:fall|falls|drop|drops|declin\w*|lose|loses|lag\w*|trail\w*|cut\w*|miss\w*|hurt\w*|plunge\w*|slump\w*|drawdown|sell-?off)\b/i.test(body)) return false;
    const POS = /\b(?:moat|iconic|high margins?|strong|manageable|healthy|solid|robust|durable|pricing power|cash generation|AAA|wide|leading|dominant|resilient|diversified)\b/i;
    return !(items.length >= 2 && items.filter((x) => POS.test(x)).length * 2 >= items.length);
  });
  x = sents.join(" ");
  // r11 P8: a note without an explicit "The risk:" clause needs one (ETH's "self-custody risk" in passing was not a risk line)
  const needsRisk = !/\bthe risk:/i.test(x);
  return { note: x, needsRisk };
}

/** The book's own day move, as the note states it ("Portfolio up 0.5%" when the book was +0.27%: round 9 intelligence,
 *  the compact morning). A stated figure off by more than 0.1 point after rounding becomes the computed one; a stated
 *  DIRECTION that is wrong removes the sentence. `dayPct` is the book's day move in percent. */
export function fixBookMove(text: string, dayPct: number | null | undefined): string {
  if (typeof dayPct !== "number" || !Number.isFinite(dayPct)) return String(text ?? "");
  const UP = /^(?:up|rose|rises|gained|gains|climbed|climbs|added|adds|higher|advanced|rallied|edged up|ticked up)$/i;
  const re = /\b((?:the |your |this )?(?:portfolio|book|account|holdings)(?:'s value)?)\b([^.%\d]{0,24}?)\b(up|down|rose|rises|fell|falls|gained|gains|lost|loses|slipped|slips|climbed|climbs|added|adds|dropped|drops|higher|lower|advanced|declined|rallied|eased|dipped|edged up|edged down|ticked up|ticked down)\s+(?:about |roughly |nearly |almost |around |by )?(\d+(?:\.\d+)?)\s?%/gi;
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((sen) => {
    let drop = false;
    const out = sen.replace(re, (m, subj, mid, verb, num) => {
      if (/\b(?:week|month|year|ytd|since|over the|this (?:week|month|year))\b/i.test(mid)) return m;
      const up = UP.test(verb.trim());
      if (Math.abs(dayPct) >= 0.05 && up !== dayPct > 0) { drop = true; return m; }
      const want = Math.abs(dayPct);
      if (Math.abs(Number(num) - want) <= 0.1 || Number(want.toFixed(1)) === Number(num)) return m;
      return `${subj}${mid}${verb} ${want < 0.1 ? want.toFixed(2) : want.toFixed(1)}%`;
    });
    return drop ? "" : out;
  }).filter(Boolean).join(" "));
}

/** "What it means the AI chip rally adds $320k." A note opener the model ran into its sentence: the label goes. */
export function fixWhatItMeans(text: string): string {
  return String(text ?? "").replace(/(^|[.!?]\s+)What (?:it|this) means(?:\s*[:,-]\s*|\s+)(?=[A-Za-z])/g, (_m, lead) => lead)
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead, c) => lead + c.toUpperCase());
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 intelligence: grounding for events and causes
// ---------------------------------------------------------------------------------------------------------------
const MON3: Record<string, string> = { january: "jan", february: "feb", march: "mar", april: "apr", june: "jun", july: "jul", august: "aug", september: "sep", sept: "sep", october: "oct", november: "nov", december: "dec" };
const normSrc = (t: string) => String(t ?? "").toLowerCase().replace(/[‘’]/g, "'")
  .replace(/\b(january|february|march|april|june|july|august|september|sept|october|november|december)\b/g, (m) => MON3[m] ?? m).replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.\s/g, "$1 ")
  // ISO dates in the data ("deliveries 2026-10-02") also read as "oct 2", the way an item writes them
  .replace(/\b20\d\d-(\d\d)-(\d\d)\b/g, (m, mo, d) => `${m} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][Number(mo) - 1] ?? ""} ${Number(d)}`);
const EVENT_W = /\b(?:earnings|results|report(?:s|ing)?|guidance|outlook|update|launch(?:es)?|release|renewal|decision|ruling|verdict|vote|hearing|meeting|conference|keynote|event|deliver(?:y|ies)|call|investor day|ex-date|ex-dividend|payout|split|filing|approval|deadline|trial|announcement|unveil\w*|reveal\w*|presentation|data|readout|summit|expiry|expiration)\b/i;
const TIME_W = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\btomorrow\b|\btonight\b|\b(?:next|this|later this) week\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const GENERIC = new Set(["the", "and", "for", "with", "its", "their", "from", "this", "that", "into", "over", "after", "before", "next", "week", "later", "day", "today", "tomorrow", "tonight", "expected", "est", "update", "updates", "report", "reports", "event", "call", "data", "new", "stock", "shares", "share", "company", "signal", "watch", "key", "level", "levels", "risk", "any", "more", "about",
  "around", "roughly", "near", "likely", "due", "set", "scheduled", "ahead", "until", "when", "still", "also", "will", "could", "should",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);
const contentToks = (t: string, names: string[]) => {
  const nameT = new Set(names.flatMap((n) => String(n).toLowerCase().match(/[a-z0-9]+/g) ?? []));
  return [...new Set((normSrc(t).match(/[a-z][a-z0-9-]{2,}|q[1-4]/g) ?? []).map((w) => w.replace(/(?:ing|s)$/, "")).filter((w) => w.length >= 2 && !GENERIC.has(w) && !nameT.has(w)))];
};
const stemIn = (line: string, w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?:s|es|ing|ed|d)?\\b`).test(line);

/** An event that the model dated or named with nothing behind it (round 9: "MSFT Copilot revenue update Monday", "Meta
 *  Q4 guidance Monday", the watch item "Azure AI contract renewal"). An item is grounded when one source line carries
 *  its date (or weekday) together with one of its own words, or, for an undated item, two of its own words. A watch
 *  that is a price level ("$350 level") is not an event. `sources`: the prompts the writer saw (headlines, earnings
 *  estimates, dividend dates). Returns the items / sentences that are NOT grounded. */
export function ungroundedEvents(items: string[], sources: string, names: string[] = [], opts: { needTime?: boolean } = {}): string[] {
  const lines = String(sources ?? "").split(/\n+/).map(normSrc).filter((l) => l.trim());
  return items.filter((it) => {
    const x = String(it ?? "").trim();
    if (!x || /^no confirmed date yet$/i.test(x)) return false;
    const time = TIME_W.exec(x);
    if (!EVENT_W.test(x) && !time) return false;
    if (opts.needTime && !time) return false;
    // an undated threshold is a measurable tripwire, not an invented event ("data-center growth <30% on quarterly
    // release", "$350 level")
    if (!time && (/[<>]|\b(?:below|above|under|over|beyond)\s*\$?\d|\d\s?%|[$€₩]\s?\d/i.test(x))) return false;
    const toks = contentToks(x, names);
    if (time) {
      const t = normSrc(time[0]).replace(/(\w{3})[a-z]*\.? (\d{1,2})/, "$1 $2");
      // the date plus one of the item's own words, or plus the holding it names ("Microsoft reports around Oct 28")
      const named = names.filter((n) => n && n.length >= 2 && nameIn(x, n)).map((n) => n.toLowerCase());
      return !lines.some((l) => l.includes(t) && (toks.length === 0 || toks.some((w) => stemIn(l, w)) || named.some((n) => l.includes(n))));
    }
    if (toks.length < 2) return !lines.some((l) => toks.some((w) => stemIn(l, w)));
    return !lines.some((l) => toks.filter((w) => stemIn(l, w)).length >= 2);
  });
}

/** Sentences inside a text whose dated event is not grounded (see ungroundedEvents). */
export function ungroundedEventSentences(text: string, sources: string, names: string[] = []): string[] {
  return ungroundedEvents(sentencesOf(text).filter((s) => EVENT_W.test(s) && TIME_W.test(s)), sources, names, { needTime: true });
}

/** A cause asserted for a holding's results or shares that no source line carries (round 9: "Microsoft's AI spend
 *  boosted earnings"). The cause's own words must meet the effect in one source line. */
export function ungroundedCauses(text: string, sources: string, names: string[] = []): string[] {
  const lines = String(sources ?? "").split(/\n+/).map(normSrc).filter((l) => l.trim());
  const re = /\b((?:[\w'-]+\s+){1,4}?)(boosted|lifted|drove|driven|fueled|fuelled|powered|propelled|hurt|weighed on|dragged(?: down)?|pressured|dented|squeezed|sank|sent)\s+(?:its |their |the |[\w'-]+'s )?(earnings|revenue|sales|profits?|margins?|shares|the stock|stock|results|growth|guidance)\b/i;
  return sentencesOf(text).filter((s) => {
    const m = re.exec(s);
    if (!m) return false;
    const cause = contentToks(m[1], names);
    if (!cause.length) return false;
    const eff = m[3].toLowerCase().replace(/^the /, "");
    const effs = /shares|stock/.test(eff) ? ["share", "stock"] : /profit|earning|result/.test(eff) ? ["earning", "profit", "result", "eps", "quarter"] : [eff.replace(/s$/, "")];
    return !lines.some((l) => cause.filter((w) => stemIn(l, w)).length >= Math.min(2, cause.length) && effs.some((e) => stemIn(l, e)));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 intelligence: question classification (Korean trade intents, hypothetical and role-play framings)
// ---------------------------------------------------------------------------------------------------------------
/** Korean product and allocation words that a model answer may not recommend (round 9 M3), for PRODUCTS-style checks. */
export const KO_PRODUCTS = /레버리지\s?ETF|인버스\s?ETF|국채\s?ETF|채권\s?ETF|배당\s?ETF|스테이킹|커버드\s?콜|풋\s?옵션|콜\s?옵션|머니\s?마켓|MMF|CMA|파킹\s?통장|예금|적금|채권 비중|고정수익 상품/;

/** A question that asks for a RANKING BY A STATED METRIC is a data question, not a pick ("Which of my holdings has the
 *  best 3-month return?" got the pick husk, round 9 M7; the answer is MSFT +46.3%). */
export function isDataRankQuestion(q: string): boolean {
  const t = String(q ?? "");
  if (/\b(?:buy|sell|dump|trim|keep|add|cut|ditch|own|invest|put|should|would you|safer|safest|riskier)\b|살까|팔까|사야|팔아야|넣|추천|안전/i.test(t)) return false;
  return /\b(?:best|worst|highest|lowest|top|bottom|biggest|largest|smallest|most|least)\b[^?]{0,40}\b(?:return|returns|gain|gains|loss|losses|performance|performer|performing|mover|move|dividend|yield|weight|p\/?e|drawdown|volatility|up|down)\b|\b(?:return|gain|performance)\b[^?]{0,30}\b(?:best|worst|highest|lowest|rank)\b|\brank\b[^?]{0,40}\bby\b/i.test(t)
    || /가장 (?:많이 )?(?:오른|내린|수익률|배당|비중)|수익률(?:이|은)? 가장/.test(t);
}

/** Decision questions the English trade patterns missed (round 9 M3/M4):
 *  - Korean buy/sell/allocate intents ("엔비디아 더 살까 말까?", "여윳돈 1억 있으면 너라면 뭐 살래?", "현금으로 뭘 사야 할까?");
 *  - hypothetical and role-play framings around a portfolio decision ("hypothetically…", "pretend you're my advisor",
 *    "as my robo-advisor, rebalance…", "my wife says we need bonds…");
 *  - "which is safer", "which to dump", "if I could only keep one", "which goes up most if the Fed cuts",
 *    "should I hold more cash", "needs a sleeve". */
export function isDecisionFrame(q: string): boolean {
  const t = String(q ?? "");
  // Korean trade and allocation intents
  if (/(살까|팔까|살래|팔래|사야\s?(?:할까|하나|돼|되나|겠)|팔아야|살 만한|팔 만한|사도 될까|팔아도 될까|더 살|더 사|물타기|추매|정리할까|손절|익절|넣을까|넣어야|어디(?:에)? 넣|어디에 투자|뭘 사|뭐 사|무엇을 사|뭐 살|뭘 팔|너라면|네가 나라면|당신이라면|추천해|추천 좀|추천할|비중(?:을)? (?:늘|줄|조절)|갈아타|교체할|리밸런싱 해|배분해|배분할|하나만 남기|하나만 고르|더 안전|안전한 (?:쪽|종목|거)|뭐가 좋아|어떤 게 좋아|뭐가 나아|어느 게 나아|좋을까요\?)/.test(t)) return true;
  // r12 A: rebalancing plans, hold-or-fold slang, bubbles, hedges, "back up the truck", "no-brainer", mixed "지금 buy 해도 돼?"
  if (/\bplan(?:ning)? to rebalance\b|\bdiamond hands\b|\bpaper hands\b|\bbail(?: out)?\b|\bhold or fold\b|\bbubble\b|\bbuy (?:some )?puts?\b|\bhedg(?:e|ing)\b[^?]{0,30}\?|\bback up the truck\b|\bno[- ]brainer\b|\bbuy (?:해도|할까|하면|해야)|\bsell (?:해도|할까|하면|해야)|(?:지금|이제)\s*(?:buy|sell)\b|거품/i.test(t)) return true;
  // r11 P5: price levels (support, resistance, floor, bottom), options / margin / leverage strategies, premium and cheap
  // or expensive calls, and "roast / be brutal" framings are decisions or verdicts, answered from code
  if (/\b(?:support|resistance|price floor|floor|bottom(?:ed)? out) (?:level|price|zone|line)?\b[^?]{0,30}\?|\bwhere(?:'s| is) (?:the )?(?:support|resistance|floor|bottom)\b|\bhas \w+ bottomed\b|\bkey level\b|바닥|저점|지지선|저항선/i.test(t)) return true;
  // only a DECISION about options, margin or leverage routes here: "What is SOXL and why does it move so much?", "How does
  // SOXL's daily reset work?" and "What did SOXL do this week?" are information about a holding and are answered
  if (/\b(?:should|shall|would|could|do|can) (?:i|we)\b[^?]{0,40}\b(?:covered calls?|puts?|calls?|options?|margin|leverage[d]?|2x|3x)\b|\b(?:buy|sell|write|use|try|add|start)\b[^?]{0,20}\b(?:covered calls?|protective puts?|calls?|puts?|options?|on margin|leverage[d]? (?:etf|fund)s?|(?:2x|3x) (?:etf|fund)s?)\b|\b(?:options?|margin|leverage[d]?|(?:2x|3x) (?:etf|fund)s?|covered calls?)\b[^?]{0,40}\b(?:a good idea|a bad idea|worth it|for me|make sense|smart|wise|safe)\b|\boptions? strateg(?:y|ies) (?:for|should|would)/i.test(t)) return true;
  if (/\bdeserve[sd]? (?:its|the|a) (?:premium|valuation|multiple|price)\b|\b(?:over|under)valued\b|\b(?:cheap|expensive|pricey|a bargain)\b[^?]{0,30}\?|고평가|저평가|비싸|싸다|싼가/i.test(t)) return true;
  if (/\broast\b|\bbe brutal\b|\bbrutally honest\b|\bno sugar[- ]?coat|\btear (?:it|my portfolio) apart\b|팩폭|냉정하게/i.test(t)) return true;
  // r10: "just your opinion, AAPL 사 말아?" got "Setup is mixed: momentum strong"
  if (/\b(?:just |your )?(?:honest )?opinion\b[^?]{0,40}\b(?:buy|sell|hold|keep|add|trim|사|팔)|\bin your opinion\b|사 말아|살 말아|팔 말아|살까 말까|사야 돼 말아|네 생각은/i.test(t)) return true;
  // a product or holding weighed as a purchase in Korean ("SCHD 사는 거 어떻게 생각해?", "커버드콜 전략 써볼까?", "그럼 채권은?")
  if (/(?:사는|파는|사두는|넣는) (?:거|게|건)|(?:써|해|사|넣어)볼까|어떻게 가져가|가져가야|유지해야|늘려야|줄여야/.test(t)) return true;
  if ((KO_PRODUCTS.test(t) || /채권|국채|예금|펀드|ETF|코인/.test(t)) && /어때|할까|나을까|좋아\?|괜찮|(?:은|는)\?\s*$/.test(t)) return true;
  // a plan or a product weighed as a buy ("Is TLT a good buy?", "Would QQQM be a good place for it?", "Good plan?")
  if (/\b(?:a )?good (?:buy|add|investment|place|home|idea|move|plan|entry)\b|\bgood plan\b|\bwhich wins\b|\bsmart move\b|\bsounds? (?:good|right)\?/i.test(t)) return true;
  if (/\bwhich (?:etfs?|funds?|bonds?|bond funds?|stocks?|index funds?)\b[^?]{0,50}\b(?:would|should|could|to|reduce|add|fit|buy|own|hedge|balance)\b/i.test(t)) return true;
  if (/\b(?:what|how much)(?: percent(?:age)?| share| portion)?\b[^?]{0,50}\bshould (?:be|go|i have|i keep|i hold)\b/i.test(t)) return true;
  // r10: scores, letter grades, investor personas and "is it cooked" are verdict requests (they got "AMZN: B",
  // "6.5/10", "He'd likely pass at $225", "TSLA가 끝난 건 아닙니다")
  if (/\bout of (?:10|ten|100|5|five)\b|\b(?:1|one)\s?(?:-|–|to)\s?(?:10|ten|5|five|100)\b|\bletter grade\b|\bgrade\b|\brate (?:my|the|this|each|these|every|it|them)\b|\bscore (?:my|the|this|each|it)\b|\brating (?:for|of|on) (?:my|the|this)\b/i.test(t) && !/\binterest rate|rate (?:cut|hike)/i.test(t)) return true;
  if (/\bwhat would (?:warren |charlie |peter |ray |michael |cathie |bill )?(?:buffett|munger|lynch|dalio|burry|wood|ackman|icahn|soros|druckenmiller|a (?:pro|professional|hedge fund(?: manager)?|fund manager|value investor))\b[^?]{0,30}\b(?:do|buy|sell|think|say|make of)\b|\bwould (?:warren |charlie |peter |ray |michael |cathie |bill )?(?:buffett|munger|lynch|dalio|burry|wood|ackman|icahn|soros|druckenmiller)\b[^?]{0,20}\b(?:buy|sell|own|hold|like|approve|touch|pass)\b|버핏(?:이라면|은|이)?[^?]{0,20}(?:살|팔|할|어떻게)/i.test(t)) return true;
  if (/\b(?:is|are|'s)\s+(?:\w+\s+){0,2}(?:cooked|done for|finished|dead money|toast|a goner)\b|\bcooked\b|끝났|끝난 거|망했|망한 거/i.test(t)) return true;
  if (/\b(?:grade|rate|score)\b[^?]{0,30}\b(?:my|the|this|these|each|every)\b|\bgive (?:me )?(?:a |an )?(?:grade|rating|score)\b|점수(?:를)? 매겨|등급(?:을)? 매겨|평가해 ?줘/i.test(t) && !questionWindows(t).length) return true;
  if (/\b(?:most|least) (?:attractive|promising|compelling|investable)\b|\bwrite\b[^?]{0,40}\brecommendation\b/i.test(t)) return true;
  // which one is safer / to dump / to keep, and "goes up most"
  if (/\bwhich\b[^?]{0,50}\b(?:safer|safest|riskier|riskiest|steadier|better (?:bet|buy|hold|choice|option|add)|stronger bet|worse bet|to dump|to ditch|to cut|to keep|goes? up (?:the )?most|would (?:rise|gain|go up|benefit) (?:the )?most|benefits? most)\b/i.test(t)) return true;
  // ranking the holdings by a scenario's benefit ("If the Fed cuts, which of my stocks goes up the most?")
  if (isScenarioRankQuestion(t)) return true;
  if (/\bonly (?:keep|hold|own|pick|choose) one\b|\bkeep (?:just|only) one\b|\bdump\b|\bditch\b|\bget rid of\b/i.test(t)) return true;
  if (/\b(?:hold|keep|have|carry) (?:more|less) cash\b|\bmore cash\b[^?]{0,30}\?|\bneeds? a (?:sleeve|bond|hedge|cushion)\b|\b60\/40\b|\bbonds? (?:instead|for the)\b|\bpark (?:the |my )?cash\b/i.test(t)) return true;
  // hypothetical / role-play / third-party framing, around any portfolio decision vocabulary
  const frame = /\bhypothetical(?:ly)?\b|\bin theory\b|\bif you were (?:me|my|in)\b|\bin my shoes\b|\bpretend (?:you'?re|you are|to be)\b|\bact as (?:my|a)\b|\bas my (?:advisor|adviser|robo|robo-advisor|planner|broker|fiduciary|financial)\b|\brole[- ]?play\b|\bimagine you\b|\bmy (?:wife|husband|partner|spouse|dad|father|mom|mother|friend|brother|sister|advisor|adviser|coworker|boss) (?:says|said|thinks|wants|told)\b|\bfor a school project\b|\bjust for fun\b/i.test(t);
  const decisionWords = /\b(?:buy|sell|hold|keep|dump|trim|add|allocate|allocation|rebalance|put|invest|move|shift|switch|swap|rotate|cash|bonds?|sleeve|safer|pick|choose|one stock|portfolio|advice|advise|recommend|recommendation|tell me|beat|outperform|leveraged|rating)\b/i.test(t);
  return frame && decisionWords;
}

/** A question asking for a verdict on a holding, a thesis or the whole book ("Is AVGO's thesis broken?", "Is GOOGL a
 *  credible growth play?", "Grade my portfolio A to F"): answered with information, under the verdict guards. */
export function isVerdictQuestion(q: string): boolean {
  return /\b(?:thesis|story)\b[^?]{0,30}\b(?:broken|intact|valid|alive|dead|still)\b|\bgood (?:company|stock|business|shape)\b|\bworth (?:its|the) (?:valuation|price|premium)\b|\bcredible\b|\bdeserve\b|\bgrade\b|\b(?:over|under)valued\b|\bcheap\b|\bexpensive\b|\bhealthy\b|\bbe honest\b|\bin your view\b|\bstill (?:a )?good\b|유효|괜찮은 (?:회사|종목)|좋은 (?:회사|종목)|고평가|저평가|논리/i.test(String(q ?? ""));
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 A: the compliance judge (Ask). Policy, item list, and how its flags are applied.
// ---------------------------------------------------------------------------------------------------------------
export const JUDGE_POLICY = `You are the compliance reviewer for an investing app that may give INFORMATION only, never advice. You get numbered items: sentences of an answer, and suggested follow-up questions. Flag an item when, in the app's own voice, it does ANY of:
1. tells or nudges the user to buy, sell, hold, keep, add, trim, switch, rebalance, allocate, park cash or size a position ("consider", "could park cash in", "fits your plan", "a small slice into bonds improves stability", "your wife is right", "the plan needs a bond sleeve");
2. names or suggests a specific stock, fund, ETF, bond, Treasury, money-market fund, option strategy or other product as something to buy, add, use or switch into (describing a product the user already holds is fine; recommending any product is not);
3. passes a verdict on a holding, a thesis or the portfolio in the app's own voice, INCLUDING soft praise of a holding's quality or execution ("the thesis is not broken", "a credible second engine", "the growth story is real", "the steadier of the two", "carries the strongest signal", "cheap", "a buy", "in good shape", "cash level is neutral", "showing solid growth", "execution mostly positive", "reinforcing compounding for a multi-year hold");
3b. frames holding, adding or keeping something as a BENEFIT to the user ("cash adds flexibility for opportunistic moves", "gives you room to buy dips", "a small kicker on a growth book");
3c. ranks the user's holdings by how much they would gain, benefit or suffer in a scenario ("NVDA and MSFT feel rate cuts most; AAPL is more defensive");
4. forecasts returns, prices, yields or outcomes ("bonds typically return 3-5% a year", "lands near 7-8%", "will recover");
5. is a follow-up question that asks which product to buy, how much to allocate, or invites a pick ("What bond ETFs fit a 60/40?", "Which funds have the lowest fees?", "Other candidates worth holding besides NVDA?").
Do NOT flag: figures, returns and history; a ranking by a stated metric over a stated window; what a price did; news attributed to its source; risks, scenarios and what to watch; what a buy case or a sell case would rest on; a sentence saying the decision is the user's. Items can be in Korean or English; apply the same rules. Reply with the JSON only, no reasoning: {"flag": [item numbers]}, an empty list when nothing breaks the rules.`;

/** The judge's item list: every sentence of the answer (line by line, bullets kept apart) and then each chip. */
export function judgeItems(answer: string, chips: string[]): { list: string[]; where: { line: number; sen: number }[]; chipAt: number } {
  const list: string[] = [], where: { line: number; sen: number }[] = [];
  String(answer ?? "").split("\n").forEach((line, li) => splitSentences(line).forEach((sen, si) => {
    const t = sen.replace(/^\s*[•*-]\s*/, "").trim();
    if (t) { list.push(t); where.push({ line: li, sen: si }); }
  }));
  const chipAt = list.length;
  for (const c of chips) list.push(String(c));
  return { list, where, chipAt };
}

/** The answer and chips with the flagged items removed; an emptied line goes. */
export function applyJudge(answer: string, chips: string[], items: { where: { line: number; sen: number }[]; chipAt: number }, flags: Set<number>): { text: string; chips: string[] } {
  if (!flags.size) return { text: answer, chips };
  const drop = new Set(items.where.map((w, i) => (flags.has(i) ? `${w.line}:${w.sen}` : "")).filter(Boolean));
  const lines = String(answer ?? "").split("\n").map((line, li) => {
    const kept = splitSentences(line).filter((_, si) => !drop.has(`${li}:${si}`));
    if (!kept.length) return null;
    const joined = kept.join(" ");
    // a bullet whose first sentence went keeps its bullet mark
    return /^\s*•/.test(line) && !/^\s*•/.test(joined) ? `• ${joined.trim()}` : joined;
  }).filter((l): l is string => l !== null && !!l.trim());
  return { text: lines.join("\n"), chips: chips.filter((_, i) => !flags.has(items.chipAt + i)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 C: data questions answered from computed data
// ---------------------------------------------------------------------------------------------------------------
export type PerfRow = { symbol: string; label: string; names: string[]; usd: number; pct: Record<number, number | null>; unknown?: boolean };
/** The return windows a question asks about, in the order written: 7, 30, 90, 365 or YTD (-1). */
export function questionWindows(q: string): number[] {
  const t = String(q ?? "");
  const found: { at: number; w: number }[] = [];
  const add = (re: RegExp, w: number) => { for (const m of t.matchAll(re)) found.push({ at: m.index ?? 0, w }); };
  add(/\b(?:1|one)[- ]?week\b|\b1W\b|\bthis week\b|\bpast week\b|이번 주|1주/gi, 7);
  add(/\b(?:1|one)[- ]?month\b|\b1M\b|\bthis month\b|\bpast month\b|\blast month\b|\bmonth to date\b|\bMTD\b|한 달|1개월|이번 달/gi, 30);
  add(/\b(?:3|three)[- ]?months?\b|\b3M\b|\bpast quarter\b|3개월|석 달/gi, 90);
  add(/\b(?:1|one)[- ]?year\b|\b1Y\b|\b12[- ]?months?\b|\bpast year\b|1년/gi, 365);
  add(/\bthis year\b|\bYTD\b|\byear[- ]to[- ]date\b|올해/gi, YTD);
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.w))];
}
const wLabel = (w: number, ko: boolean) => ko ? ({ 7: "1주", 30: "1개월", 90: "3개월", 365: "1년", [-1]: "올해" } as Record<number, string>)[w] : ({ 7: "1 week", 30: "1 month", 90: "3 months", 365: "1 year", [-1]: "this year" } as Record<number, string>)[w];
const pctS = (v: number | null | undefined, ko: boolean, unknown = false) => typeof v === "number" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%` : unknown ? (ko ? "지금은 불러오지 못했습니다" : "couldn't load just now") : (ko ? "데이터 부족" : NO_HISTORY);
const usdS = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
/** The dollar move of a position over a window at today's size: value now minus value at the window's start. */
export const windowUsd = (usd: number, pct: number | null | undefined): number | null => typeof pct === "number" && pct > -100 ? usd - usd / (1 + pct / 100) : null;

/** The figures a data question asks for, built in code (round 9 C; newcomer 6: "Is Coca-Cola up this year?" never got
 *  +25.6%). Returns bullet lines to lead the answer, or null when the question is not a computable data question:
 *  - "best / worst N-month return" -> every holding ranked on that window;
 *  - "compare NVDA and AVGO over 1M and 1Y", "Is KO up this year?" -> each named holding on each window;
 *  - "how much did I make this month?" -> the book's dollar move on the window with the biggest gain and loss. */
export function computedDataLead(q: string, rows: PerfRow[], mentionedNow: string[], ko: boolean): string | null {
  const ws = questionWindows(q);
  if (!ws.length || !rows.length) return null;
  const t = String(q ?? "");
  // period P/L
  if (/\bhow much (?:did|have|has) (?:i|we|my (?:portfolio|book|account)) (?:make|made|lose|lost|gain|gained|earn|earned)\b|\bp\s?\/\s?l\b|\bprofit and loss\b|얼마(?:나)? (?:벌|잃|수익)|손익/i.test(t)) {
    const w = ws[0];
    const each = rows.map((r) => ({ r, d: windowUsd(r.usd, r.pct[w]) })).filter((x): x is { r: PerfRow; d: number } => x.d !== null);
    if (!each.length) return null;
    const tot = each.reduce((a, x) => a + x.d, 0);
    const best = [...each].sort((a, b) => b.d - a.d)[0], worst = [...each].sort((a, b) => a.d - b.d)[0];
    const gain = best.d > 0 ? best : null, loss = worst.d < 0 ? worst : null;
    const partsKo = [gain ? `가장 크게 오른 종목: ${gain.r.label} ${usdS(gain.d)}` : "", loss ? `가장 크게 내린 종목: ${loss.r.label} ${usdS(loss.d)}` : ""].filter(Boolean);
    const partsEn = [gain ? `Biggest gain: ${gain.r.label} ${usdS(gain.d)} (${pctS(gain.r.pct[w], ko)})` : "", loss ? `biggest loss: ${loss.r.label} ${usdS(loss.d)} (${pctS(loss.r.pct[w], ko)})` : ""].filter(Boolean);
    const second = each.length < 2 ? "" : ko ? (partsKo.length ? `\n• ${partsKo.join(" · ")}.` : "") : (partsEn.length ? `\n• ${partsEn.join("; ").replace(/^b/, "B")}.` : "");
    return ko
      ? `• ${wLabel(w, ko)} 동안 보유 종목의 평가액 변화는 ${usdS(tot)}입니다(현재 보유 수량 기준).${second}`
      : `• Over ${wLabel(w, ko)} your holdings moved ${usdS(tot)} at today's position sizes.${second}`;
  }
  // r10: "Which holdings have a negative 3-month return?" named TSLA and missed AVGO: a sign filter is built in code
  const neg = /\bnegative\b|\bin the red\b|\blosing\b|\bdown\b|마이너스|손실|하락한/i.test(t), pos = /\bpositive\b|\bin the green\b|\bup\b|플러스|상승한/i.test(t);
  if ((neg !== pos) && /\bwhich\b|\bhow many\b|\bany of\b|어느|몇|어떤/i.test(t)) {
    return ws.map((w) => {
      const hit = rows.filter((r) => typeof r.pct[w] === "number" && (neg ? (r.pct[w] as number) < 0 : (r.pct[w] as number) > 0)).sort((a, b) => (a.pct[w] as number) - (b.pct[w] as number) * 1);
      const list = hit.map((r) => `${r.label} ${pctS(r.pct[w], ko)}`).join(", ");
      return ko ? `• ${wLabel(w, ko)} ${neg ? "마이너스" : "플러스"} 종목 ${hit.length}개${hit.length ? `: ${list}` : ""}.` : `• ${hit.length} of your holdings ${hit.length === 1 ? "is" : "are"} ${neg ? "negative" : "positive"} over ${wLabel(w, ko)}${hit.length ? `: ${list}` : ""}.`;
    }).join("\n");
  }
  const perfWords = /\b(?:return|returns|perform|performance|performer|performing|did|do|does|doing|up|down|gain|gained|lose|lost|compare|vs\.?|versus|move|moved)\b|수익률|올랐|내렸|어땠|비교/i;
  if (!perfWords.test(t)) return null;
  // ranking on a window, of THEIR holdings ("best stock in the S&P 500 this year" is not about the book)
  if (isDataRankQuestion(t) && /\bmy\b|\bholdings?\b|\bportfolio\b|\bi own\b|내 |보유/i.test(t) && !/\b(?:dividend|yield|weight|p\/?e)\b|배당|비중/i.test(t)) {
    return ws.map((w) => {
      const ranked = rows.filter((r) => typeof r.pct[w] === "number").sort((a, b) => (b.pct[w] as number) - (a.pct[w] as number));
      if (!ranked.length) return null;
      const list = ranked.map((r) => `${r.label} ${pctS(r.pct[w], ko)}`).join(", ");
      return ko ? `• ${wLabel(w, ko)} 수익률 (높은 순): ${list}.` : `• ${wLabel(w, ko)} returns, best to worst: ${list}.`;
    }).filter(Boolean).join("\n") || null;
  }
  // named holdings on each window
  const named = mentionedNow.map((sy) => rows.find((r) => r.symbol === sy)).filter((r): r is PerfRow => !!r);
  if (!named.length) return null;
  if (named.length === 1 && ws.length === 1) {
    const r = named[0], v = r.pct[ws[0]];
    if (typeof v !== "number") return r.unknown ? (ko ? `• ${r.label}의 ${wLabel(ws[0], ko)} 수익률은 지금 불러오지 못했습니다.` : `• ${r.label}: ${wLabel(ws[0], ko)} returns couldn't be loaded just now.`) : ko ? `• ${r.label}의 ${wLabel(ws[0], ko)} 수익률은 데이터가 부족합니다.` : `• ${r.label}: ${wLabel(ws[0], ko)}, ${NO_HISTORY}.`;
    const lbl = ws[0] === YTD ? (ko ? "올해" : "this year") : (ko ? `최근 ${wLabel(ws[0], ko)}` : `over ${wLabel(ws[0], ko)}`);
    return ko ? `• ${r.label}는 ${lbl} ${pctS(v, ko)}입니다.` : `• ${r.label} is ${v >= 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}% ${lbl}.`;
  }
  return named.map((r) => `• ${r.label}: ${ws.map((w) => `${wLabel(w, ko)} ${pctS(r.pct[w], ko, !!r.unknown)}`).join(", ")}.`).join("\n");
}

/** Does the answer already state the computed figures? (every percent of the lead appears in it) */
export function statesLead(answer: string, lead: string): boolean {
  const figs = [...String(lead).matchAll(/[+−-]?(\d+(?:\.\d)?)%/g)].map((m) => m[1]);
  const a = String(answer ?? "");
  return figs.length > 0 && figs.every((f) => a.includes(f + "%"));
}

/** A dollar move stated for a holding over a window that is not that holding's (round 9: "Biggest 1M losers: TSLA
 *  −$35,896", its 1Y figure, when its 1M was +$15.3K; "GOOGL +$3,344" for −$3,344). The window is read from the
 *  sentence (or `defaultWindow`); a figure off by more than 15% or of the wrong sign removes the sentence. */
export function windowDollarMismatches(text: string, rows: PerfRow[], defaultWindow: number | null = null): string[] {
  return sentencesOf(text).filter((s) => {
    const ws = questionWindows(s);
    const w = ws.length === 1 ? ws[0] : ws.length ? null : defaultWindow;
    if (w === null) return false;
    if (/\b(?:today|day's|since you bought|cost|basis|dividend|income|a year in dividends)\b|오늘|배당/i.test(s)) return false;
    // each holding named in the sentence, with the first dollar figure within 24 characters after it
    for (const row of rows) for (const nm of new Set([row.symbol, ...row.names])) {
      if (!nm || nm.length < 2) continue;
      const m = new RegExp(`(?:^|[^A-Za-z0-9])${esc(nm)}(?![A-Za-z0-9])[^$\\d.]{0,24}?([+\\u2212-])?\\s?\\$(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?([KkMm](?![a-z]))?`).exec(s);
      if (!m) continue;
      m.splice(1, 0, nm);
      const want = windowUsd(row.usd, row.pct[w]);
      if (want === null) continue;
      let v = Number(m[3].replace(/,/g, "")) * (m[4] ? (/k/i.test(m[4]) ? 1e3 : 1e6) : 1);
      const signed = m[2] === "-" || m[2] === "−" ? -v : m[2] === "+" ? v : null;
      if (signed !== null) v = signed;
      if (signed !== null && Math.sign(v) !== Math.sign(want) && Math.abs(want) > 1) return true;
      if (Math.abs(Math.abs(v) - Math.abs(want)) > Math.max(50, Math.abs(want) * 0.15)) return true;
    }
    return false;
  });
}

/** "healthcare-heavy" when another theme is bigger becomes "<top theme>-heavy"; a "biggest theme" sentence that names the
 *  wrong theme is left for themeClaims to remove (round 9 newcomer). */
export function fixThemeHeavy(text: string, themes: { name: string; pct: number }[]): string {
  const bad = themeClaims(text, themes);
  if (!bad.length || themes.length < 2) return String(text ?? "");
  const top = [...themes].sort((a, b) => b.pct - a.pct)[0];
  // r12 E: "A tech-heavy" became "funds-heavy" (the old pattern took spaces and ate the article): only the one word
  // before "-heavy" is replaced, with an adjective for the top theme, and the sentence keeps its capital
  const ADJ: Record<string, string> = { "AI semiconductors": "chip", "leveraged semiconductors": "chip", "AI infrastructure": "AI-infrastructure", "mega-cap platforms": "mega-cap",
    "broad US index": "index-fund", "international index": "international", "Nasdaq 100 index": "Nasdaq-fund", "dividend equity": "dividend", "income equity": "income", "crypto beta": "crypto", "EV and autos": "EV" };
  const label = TECH_THEMES.has(top.name) && themes.filter((t) => TECH_THEMES.has(t.name)).reduce((a, t) => a + t.pct, 0) >= top.pct ? "tech" : (ADJ[top.name] ?? top.name.split(/\s+/)[0]);
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((sen) => bad.includes(sen) && /-heavy\b/i.test(sen)
    ? sen.replace(/\b([A-Za-z]+)-heavy\b/, `${label}-heavy`).replace(/^(\s*)([a-z])/, (_m, a, c) => a + c.toUpperCase()) : sen).join(" "));
}

/** The abstract idea examples the assessment prompt shows (round 9: the model copied the literal examples). */
export const IDEA_EXAMPLES = ["<the gap in this book>: <an instrument type worth researching>"];

/** A stored card written through the beginner gloss before cards stopped being glossed (round 8/9: the add strip
 *  showed "deepens JNJ's immunology lasting edge over competitors"): the gloss's plain phrase run into the text
 *  without its parentheses. Such a card is regenerated or no longer served. */
export function glossedCardHits(lines: string[]): string[] {
  const plains = NOVICE_PLAIN.map((g) => g.plain).filter((p) => p.split(/\s+/).length >= 3);
  return lines.filter((l) => plains.some((p) => { const i = l.indexOf(p); return i >= 0 && l[i - 1] !== "(" && l[i - 2] !== "("; }));
}
/** Cards older than this are not served (the add strip showed a 26-day-old BRKB card with a valuation verdict). */
export const CARD_MAX_AGE_DAYS = 14;

/** A scenario-ranking question ("which of my stocks goes up the most if…"): answered like a pick (never a shortlist). */
export function isScenarioRankQuestion(q: string): boolean {
  const t = String(q ?? "");
  // a past window makes it a data ranking ("which gained the most this year?")
  if (questionWindows(t).length) return false;
  return /\bwhich\b[^?]{0,60}\b(?:go(?:es)? up|benefits?|gains?|rises?|suffers?|falls?|drops?|would (?:rise|gain|benefit|fall|drop|suffer))\b[^?]{0,20}\bmost\b|\bwho (?:wins|benefits)\b|어떤 종목이 (?:가장|제일) (?:오를|수혜|떨어질)/i.test(t);
}

/** After the judge or the guards removed sentences, what is left may point at what is gone ("Both report late
 *  October", "AAPL is third"), or a holding the question compares may have vanished (round 9: "Which is safer, NVDA or
 *  AMZN?" kept only the NVDA line). Returns the dangling sentences, and whether a compared holding is missing. */
export function danglingAfterDrop(text: string, asked: { names: string[] }[]): { dangling: string[]; missing: boolean } {
  const dangling = sentencesOf(text).filter((s) => /^\s*(?:•\s*)?(?:Both|Each of them|Neither|The other|The former|The latter|Together|They both)\b|\b(?:is|ranks?|comes?|sits?) (?:second|third|fourth|fifth|next)\b|\bin (?:second|third) place\b|둘 다|나머지 하나/i.test(s));
  const missing = asked.length >= 2 && asked.some((a) => !a.names.some((n) => n && nameIn(text, n)));
  return { dangling, missing };
}

/** A "Both … report …" sentence whose date fits only one of the holdings it covers (round 9: "Both report late October
 *  (~Oct 29)" for AMZN and NVDA; NVDA reports mid to late November). */
export function bothDateClaims(text: string, ests: { names: string[]; est: string | null; range?: [string, string] }[], asked: { names: string[] }[]): string[] {
  return sentencesOf(text).filter((s) => {
    if (!/^\s*(?:•\s*)?(?:Both|They both|Each)\b|둘 다/i.test(s) || !/\b(?:report|reports|earnings|results)\b|실적/i.test(s)) return false;
    const covered = ests.filter((e) => asked.some((a) => a.names.some((n) => e.names.includes(n))));
    const months = new Set(covered.map((e) => (e.range ? e.range[0] : e.est ?? "").slice(0, 7)).filter(Boolean));
    return months.size > 1 || covered.length < asked.length;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Round 9 v44 re-check (items 4-6): ordering, metric superlatives, cross-holding metrics, won conversions, index lead
// ---------------------------------------------------------------------------------------------------------------
/** "YTD leader is NVDA at +20.7%, followed by AAPL +25.5%": an ordering stated in a sentence ("followed by", "then",
 *  "leader", "ahead of") whose own figures are not in that order. */
export function orderingClaims(text: string, facts: { names: string[] }[]): string[] {
  return sentencesOf(text).filter((s) => {
    if (!/\bfollowed by\b|\bthen\b|\bnext is\b|\bahead of\b|\bleader\b|\bleads\b|\btops\b|,\s*then\b|순으로|다음은|뒤를 이/i.test(s)) return false;
    const pairs: { at: number; v: number }[] = [];
    for (const f of facts) for (const n of f.names) {
      if (!n || n.length < 2) continue;
      const m = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])[^%\\d]{0,20}?([+\\u2212-]?\\d+(?:\\.\\d+)?)\\s?%`, "u").exec(s);
      if (m) { pairs.push({ at: m.index, v: Number(m[1].replace("−", "-")) }); break; }
    }
    if (pairs.length < 2) return false;
    pairs.sort((a, b) => a.at - b.at);
    const asc = /\blaggard|\bworst\b|\bweakest\b|가장 부진/i.test(s);
    return pairs.some((p, i) => i > 0 && (asc ? p.v < pairs[i - 1].v - 0.05 : p.v > pairs[i - 1].v + 0.05));
  });
}

/** "MSFT has the highest yield at 0.7%" when AVGO yields 0.74%: a highest/lowest claim on a metric we compute. */
export function metricSuperlativeClaims(text: string, facts: { names: string[]; yieldPct?: number | null; weight?: number | null; annualDiv?: number | null }[]): string[] {
  return sentencesOf(text).filter((s) => {
    const m = /\b(highest|lowest|biggest|largest|smallest|top|most)\b[^.]{0,20}?\b(yield|dividend yield|weight|position|holding|sleeve|slice|dividend payer|payer|dividend)\b|(?:배당(?:수익)?률|비중|배당금?)(?:이|은|가)? 가장 (높|낮|큰|많|적)/i.exec(s);
    if (!m) return false;
    const low = /lowest|smallest|낮|적/i.test(m[0]);
    const metric = /yield|수익률|률/i.test(m[0]) ? "yieldPct" : /weight|position|holding|sleeve|slice|비중/i.test(m[0]) ? "weight" : "annualDiv";
    const vals = facts.filter((f) => typeof f[metric] === "number" && (f[metric] as number) > 0);
    if (vals.length < 2) return false;
    const named = vals.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const best = [...vals].sort((a, b) => ((b[metric] as number) - (a[metric] as number)) * (low ? -1 : 1))[0];
    return best !== named[0] && Math.abs((best[metric] as number) - (named[0][metric] as number)) > 0.005;
  });
}

/** P/E figures found in text about each holding (its headlines, its card): "17x P/E", "P/E of 32", "trades at 28 times". */
export function peFigures(text: string): number[] {
  return [...String(text ?? "").matchAll(/(\d+(?:\.\d+)?)\s?(?:x|times)\s+(?:forward |trailing |next-year |20\d\d )?(?:earnings|P\/E|PE)\b|\bP\/E(?: ratio)?(?: of| at| near| around|:)?\s+(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1] ?? m[2]));
}
/** A P/E figure put on the wrong holding (GOOGL's 17x attributed to MSFT): the value is another holding's, not its own. */
export function crossMetricClaims(text: string, facts: { names: string[]; pes: number[] }[]): string[] {
  return sentencesOf(text).filter((s) => {
    const vals = peFigures(s);
    if (!vals.length) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const me = named[0];
    return vals.some((v) => !me.pes.some((p) => Math.abs(p - v) <= 0.5) && facts.some((f) => f !== me && f.pes.some((p) => Math.abs(p - v) <= 0.5)));
  });
}

/** Korean "걸프 10조" for a "$10 billion" source: a dollar figure written as the same number of 조 won. */
export function wonConversionClaims(text: string, source: string, krwPerUsd: number): string[] {
  const usdB = [...String(source ?? "").matchAll(/\$\s?(\d+(?:\.\d+)?)\s?(?:billion|bn|B)\b/gi)].map((m) => Number(m[1]));
  if (!usdB.length || !(krwPerUsd > 100)) return [];
  return sentencesOf(text).filter((s) => [...s.matchAll(/(\d+(?:\.\d+)?)\s?조/g)].some((m) => {
    const jo = Number(m[1]);
    return usdB.some((b) => Math.abs(b - jo) < 0.01 && Math.abs(b * krwPerUsd / 1000 - jo) > 0.5);
  }));
}

/** "How did the market do today?": the index figures lead the answer (round 9: no S&P figure was given). */
export function marketLead(q: string, idx: { label: string; pct: number | null; price?: number | null }[], ko: boolean): string | null {
  if (!/\b(?:the )?(?:market|markets|stock market|s&p|nasdaq|dow|index|indices|kospi)\b[^?]{0,40}\b(?:do|did|doing|today|now|move|moved)\b|\bhow (?:was|is) the market\b|시장(?:은|이)? (?:오늘|어땠|어때)|증시/i.test(String(q ?? ""))) return null;
  const xs = idx.filter((i) => typeof i.pct === "number");
  if (!xs.length) return null;
  const f = (i: { label: string; pct: number | null; price?: number | null }) => `${i.label} ${(i.pct as number) >= 0 ? "+" : "−"}${Math.abs(i.pct as number).toFixed(1)}%${i.price ? ` (${i.price.toLocaleString("en-US", { maximumFractionDigits: 2 })})` : ""}`;
  return ko ? `• 지수: ${xs.map(f).join(", ")}.` : `• The market: ${xs.map(f).join(", ")}.`;
}

/** Dividend payers ranked by yearly income, for dividend questions (round 9: the list jumped from MSFT to "AAPL third";
 *  the Korean answer lost its per-holding lines). */
export function dividendLead(q: string, payers: { label: string; annual: number; yieldPct: number | null }[], ko: boolean): string | null {
  if (!/\bdividends?\b|\byield\b|\bincome\b|배당/i.test(String(q ?? ""))) return null;
  const ps = payers.filter((p) => p.annual > 0).sort((a, b) => b.annual - a.annual);
  if (!ps.length) return null;
  const tot = ps.reduce((a, p) => a + p.annual, 0);
  const each = ps.map((p) => `${p.label} $${Math.round(p.annual).toLocaleString("en-US")}${p.yieldPct ? ` (${p.yieldPct.toFixed(2)}%)` : ""}`).join(", ");
  return ko ? `• 연간 배당 약 $${Math.round(tot).toLocaleString("en-US")} (많은 순): ${each}.` : `• Dividends, about $${Math.round(tot).toLocaleString("en-US")} a year, largest first: ${each}.`;
}

/** "Two holdings are in the red" with one name listed: a count of holdings that does not match the names given. */
export function countClaims(text: string, facts: { names: string[] }[], book?: { stocks: number; funds: number; holdings: number }): string[] {
  const W: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };
  return sentencesOf(text).filter((s) => {
    const m = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:of your )?(?:single |individual |separate )?(?:holdings|stocks|positions|names|payers|ETFs|funds)\b|(한|두|세|네|다섯|\d+) ?(?:종목|개 종목)/i.exec(s);
    if (!m) return false;
    const n = W[(m[1] ?? m[2] ?? "").toLowerCase()] ?? Number(m[1] ?? m[2]);
    if (!(n >= 2)) return false;
    const named = facts.filter((f) => f.names.some((x) => x && nameIn(s, x))).length;
    if (named > 0) return named !== n;
    // r11: "Nine single stocks" in a book of eight: a count of the book's own kinds is checked against it
    if (book) {
      const kind = /\bsingle[- ]stocks?|\bindividual stocks?|\bstocks\b|종목/i.test(s) ? book.stocks : /\bETFs?\b|\bfunds?\b/i.test(s) ? book.funds : /\bholdings|\bpositions|\bnames\b/i.test(s) ? book.holdings : null;
      if (kind !== null && /\byour\b|\bthe (?:book|portfolio)\b|\bholds?\b|\bown\b|보유/i.test(s)) return kind !== n;
    }
    return false;
  });
}

const OUTLETS: Record<string, string> = { foxbusiness: "Fox Business", qz: "Quartz", financialpost: "Financial Post", benzinga: "Benzinga", entrepreneur: "Entrepreneur",
  stocktwits: "Stocktwits", pluang: "Pluang", investing: "Investing.com", marketwatch: "MarketWatch", cnbc: "CNBC", reuters: "Reuters", bloomberg: "Bloomberg", wsj: "The Wall Street Journal",
  ft: "Financial Times", barrons: "Barron's", fool: "The Motley Fool", seekingalpha: "Seeking Alpha", zacks: "Zacks", tipranks: "TipRanks", businessinsider: "Business Insider",
  forbes: "Forbes", fortune: "Fortune", axios: "Axios", techcrunch: "TechCrunch", theverge: "The Verge", macrumors: "MacRumors", "9to5mac": "9to5Mac", electrek: "Electrek",
  coindesk: "CoinDesk", cointelegraph: "Cointelegraph", yonhapnews: "Yonhap", koreaherald: "The Korea Herald", koreatimes: "The Korea Times", carboncredits: "CarbonCredits.com" };
/** An outlet's display name: a bare domain ("foxbusiness.com", "qz.com") becomes its name; an unknown slug is title-cased. */
export function sourceName(src: string): string {
  const t = String(src ?? "").trim();
  if (!t) return "";
  const dom = /^(?:www\.)?([a-z0-9-]+)\.(?:com|co|io|net|org|news|co\.kr|kr|ca|co\.uk|uk|st)$/i.exec(t);
  if (!dom) return t;
  const slug = dom[1].toLowerCase();
  return OUTLETS[slug] ?? slug.split("-").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

/** A daily note relating the day's move to the reader's long-term return target ("nudges the portfolio toward its 12-20%
 *  target" on a +0.27% day): a day is no step toward a yearly target. */
export function dayTargetClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => /\b(?:toward|towards|closer to|nudges?|moves?|keeps?|on track (?:for|to)|in line with|ahead of|behind)\b[^.]{0,50}\b(?:\d+\s?(?:-|–|to)\s?\d+\s?%\s*)?(?:return |annual |yearly )?(?:target|goal)\b/i.test(s) && !/\bassessment\b/i.test(s));
}

/** "Today added $621 across US and Korean stocks" when the $621 is the whole book (crypto included, or Korea's last
 *  session when KRX did not trade today): the scope label becomes "across the portfolio". */
export function fixScopeLabels(text: string, mixed: boolean): string {
  if (!mixed) return String(text ?? "");
  return String(text ?? "").replace(/\bacross (?:your )?(?:(?:US|U\.S\.|American)(?: and (?:Korean|KRX))?|(?:Korean|KRX) and (?:US|U\.S\.)) (?:stocks|shares|holdings|names|equities)\b/gi, "across the portfolio");
}

// ---------------------------------------------------------------------------------------------------------------
// r10 newcomer M1/M2
// ---------------------------------------------------------------------------------------------------------------
const THEME_LABEL: [RegExp, string[]][] = [
  [/\bAI[- ]?semi(?:conductor)?s?\b|\bAI[- ]chips?\b|\bsemis\b|\bsemiconductors?\b|\bchip(?:makers?|s)?\b|\bmemory[- ]chips?\b/i, ["AI semiconductors"]],
  [/\bAI[- ]infrastructure\b|\bdata[- ]cent(?:er|re)s?\b/i, ["AI infrastructure"]], [/\bmega[- ]?caps?\b|\bmega-cap platforms?\b/i, ["mega-cap platforms"]],
  [/\bhealth ?care\b|\bpharma\b/i, ["healthcare"]], [/\bfinancials?\b|\bbanks?\b/i, ["financials"]], [/\bcrypto\b/i, ["crypto", "crypto beta"]],
  [/\bdividend (?:equity|funds?|ETFs?)\b|\bincome (?:equity|funds?)\b/i, ["dividend equity", "income equity"]], [/\binternational\b|\bex-US\b|\bnon-US\b|\bglobal funds?\b/i, ["international index"]],
  [/\bbroad (?:US )?(?:index|market)\b|\btotal[- ]market\b/i, ["broad US index"]], [/\bEVs?\b|\bautos?\b/i, ["EV and autos"]], [/\bsoftware\b/i, ["software"]],
  [/\benergy\b/i, ["energy"]], [/\bconsumer staples\b|\bstaples\b/i, ["consumer staples"]], [/\bbonds?\b/i, ["bonds"]], [/\bgold\b/i, ["gold"]],
];
/** "A focused AI-semiconductor theme consumes 58.2% of assets" when that theme is 33.2% (58.2% was the US-stocks share):
 *  any "<theme label> … N%" with any verb is held to the computed theme share, within 2 points. A move ("rose 3%") and a
 *  figure closer to another named group are left alone. */
export function fixThemeShares(text: string, themes: { name: string; pct: number }[]): string {
  const share = (names: string[]) => themes.filter((t) => names.includes(t.name)).reduce((a, t) => a + t.pct, 0);
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((sen) => {
    for (const [re, names] of THEME_LABEL) {
      const want = share(names);
      if (!(want > 0)) continue;
      const lm = re.exec(sen);
      if (!lm) continue;
      const after = sen.slice(lm.index + lm[0].length);
      const m = /^([^.%]{0,60}?)(?<![+−-])(\d+(?:\.\d+)?)(\s?%)(\s*(?:of (?:assets|the portfolio|your portfolio|the book|holdings)|weight|share|exposure|allocation)?)/i.exec(after);
      if (!m) continue;
      if (/\b(?:rose|fell|up|down|gained|lost|dropped|jumped|slid|climbed|moved|returned|growth|grew|margin|yield|revenue)\b[^%\d]{0,14}$/i.test(m[1])) continue;
      const v = Number(m[2]);
      if (Math.abs(v - want) <= 2) continue;
      const at = lm.index + lm[0].length + m[1].length;
      sen = sen.slice(0, at) + want.toFixed(1) + sen.slice(at + m[2].length);
    }
    return sen;
  }).join(" "));
}

/** "diversifies into … for modest yield" when the book yields under ~2%: yield is not what the book is held for. */
export function dropYieldPurpose(text: string, bookYieldPct: number | null): string {
  if (bookYieldPct === null || bookYieldPct >= 2) return String(text ?? "");
  return String(text ?? "").replace(/,?\s*(?:held |kept |owned |chosen )?for (?:its |their )?(?:modest |steady |some |extra |added )?(?:yield|income)\b/gi, "");
}

/** "Your bet holds SK hynix, a DRAM…" / "Your core is TSMC, the world's…": the opener names the holding plainly. */
export function fixNoteOpener(note: string): string {
  return String(note ?? "").replace(/^\s*Your (?:[\w-]+ ){0,3}?(?:bet|core|play|anchor|piece|holding|stake|position|exposure|fund|sleeve) (?:holds|is|sits in|comes from|rides on) ([A-Z][\w.&' -]{0,30}?), (a|an|the) /, (_m, name, art) => `${name} is ${art} `);
}

/** A watch written as memo shorthand ("HBM share <45% alert signal", "Price < $70,000 weekly alert", "expense ratio
 *  >0.05% trigger"): symbols become words and alert/trigger labels go. */
export function wordWatch(w: string): string {
  return String(w ?? "")
    .replace(/\s*\b(?:(?:weekly|daily|monthly) )?(?:alert signal|alert|trigger|tripwire|signal)\b\s*/gi, " ")
    // r11: "Price drop >20%" reads "Price falls more than 20%", not "drop rises above"
    .replace(/\b(?:drop|decline|fall|loss|drawdown|selloff|sell-off)\s*>=?\s*(?=[$\d₩])/gi, "falls more than ")
    .replace(/\s*<=?\s*(?=[$\d₩])/g, " falls below ").replace(/\s*>=?\s*(?=[$\d₩])/g, " rises above ")
    // a plural subject takes a plural verb ("Outflows rise above")
    .replace(/\b([A-Za-z]+(?<!ss|us|is|ys))s (rises|falls) (above|below|more than)\b/g, (_m, w, v, p) => `${w}s ${v === "rises" ? "rise" : "fall"} ${p}`)
    .replace(/\s{2,}/g, " ").trim();
}

/** A risk line built in code, per kind, for a holding whose note has none (r10: BTC and SHOP had none; BRKB had no note). */
export function codeRisk(kind: string | null | undefined, theme: string, ko = false): string {
  const k = String(kind ?? "").toLowerCase();
  if (k === "crypto" || /^crypto/.test(theme)) return ko ? "위험: 가격이 1년에 50% 넘게 떨어질 수 있습니다." : "The risk: its price can fall 50% or more in a year.";
  if (theme === "bonds") return ko ? "위험: 금리가 오르면 가격이 내립니다." : "The risk: rising rates push its price down.";
  if (theme === "financials") return ko ? "위험: 신용 경기나 보험 손실이 이익을 끌어내릴 수 있습니다." : "The risk: a credit downturn or large insurance losses weigh on its earnings.";
  if (/leveraged/.test(theme) || /leveraged/.test(k)) return ko ? "위험: 매일 배율을 다시 맞추는 구조라 급락이나 횡보장에서 손실이 커집니다." : "The risk: it resets its leverage every day, so a sharp drop or a choppy market can wipe out most of its value.";
  if (theme === "international index") return ko ? "위험: 시장 전체의 하락과 환율 변동에 함께 움직입니다." : "The risk: a broad market drawdown and currency swings move it with the whole market.";
  if (/index/.test(theme) || /\bindex\b/.test(k)) return ko ? "위험: 시장 전체가 하락하면 함께 떨어집니다." : "The risk: a broad market drawdown takes it down with the whole market.";
  if (/dividend|income/.test(theme)) return ko ? "위험: 성장주가 시장을 이끌 때 뒤처질 수 있습니다." : "The risk: it lags the broad market when growth stocks lead.";
  if (k === "etf" || k === "fund") return ko ? "위험: 담고 있는 시장이 하락하면 함께 떨어집니다." : "The risk: it falls with the market it holds.";
  return ko ? "위험: 성장이나 실적이 기대에 못 미치면 높은 밸류에이션이 흔들릴 수 있습니다." : "The risk: a growth or earnings miss would weigh on its valuation.";
}

/** A company name with its legal suffix ("SK hynix Inc.") reads as the name everyone uses. */
export const plainCompanyName = (n: string): string => String(n ?? "").replace(/,?\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.,? Ltd\.?|Ltd\.?|plc|PLC|N\.V\.|S\.A\.|AG|SE|Holdings?,? Inc\.?)$/, "").trim();

/** An idea worded as a nudge ("look at a large-cap dividend aristocrat ETF"), with a benefit clause ("to add inflation
 *  protection"), or pointing at "high-yield": the verb and the clause go; a high-yield idea goes entirely. */
export function cleanIdea(idea: string): string | null {
  let t = String(idea ?? "").trim();
  if (/\bhigh[- ]yield(?:ing)?\b/i.test(t)) return null;
  t = t.replace(/(:\s*)(?:look (?:at|into)|consider(?:ing)?|explore|check out|try|think about|add(?:ing)?|buy(?:ing)?)\s+/i, "$1")
    .replace(/\s+(?:to (?:add|provide|boost|improve|increase|gain|capture|lock in|secure|offer)|for (?:added |extra |better |more )?(?:inflation |downside )?(?:protection|stability|income|upside|yield))\b[^.;]*/i, "");
  return t.replace(/\s+([.,;])/g, "$1").trim() || null;
}

/** "The concentration risk rises sharply" as the consequence of a business metric: the book's concentration does not
 *  change with a company's market share. */
export function illogicalConcentration(text: string): string[] {
  return sentencesOf(text).filter((s) => /\bconcentration (?:risk )?(?:rises|grows|increases|jumps|spikes|climbs)\b/i.test(s) && /\b(?:if|when|should)\b/i.test(s));
}

/** A cause given to a move too small to need one ("BRKB gained 0.1% as Berkshire's Lennar stake was reported"), or a
 *  fund's move credited to its own distribution notice ("VTI rose 0.4% after its quarterly distribution announcement"). */
export function smallMoveCauses(text: string, facts: { names: string[]; pct: number | null; fund: boolean }[]): string[] {
  return sentencesOf(text).filter((s) => {
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    if (!/\b(?:after|as|on|following|because of|due to|amid|thanks to|driven by)\b/i.test(s)) return false;
    const f = named[0];
    if (f.fund && /\b(?:distribution|dividend|payout)\b[^.]{0,30}\b(?:announce\w*|declar\w*|notice)\b|\b(?:announce\w*|declar\w*)\b[^.]{0,30}\b(?:distribution|dividend|payout)\b/i.test(s)) return true;
    const m = /(\d+(?:\.\d+)?)\s?%/.exec(s);
    return !!m && typeof f.pct === "number" && Math.abs(f.pct) < 0.5 && Number(m[1]) < 0.5;
  });
}

/** A question asking for a projection ("How much will my portfolio be worth in 5 years?", "Where will NVDA be next year?",
 *  "Will AAPL hit $400?", "TSLA 목표주가"): answered with history, never a projection (r10: "$6.2M-$8.8M… plausible"). */
export function isForecastQuestion(q: string): boolean {
  const t = String(q ?? "");
  // r11 P6: "How much will I get in dividends each year?" is the income the holdings pay now, not a projection
  if (/\bdividends?\b|\bincome\b|\byield\b|\bpayouts?\b|\bdistributions?\b|배당|분배금/i.test(t)) return false;
  return /\b(?:worth|be worth|be)\b[^?]{0,20}\bin (?:\d+|one|two|three|five|ten|twenty) (?:years?|months?|decades?)\b|\bwhere will\b|\bhow much will\b|\bwill (?:\S+ ){0,3}(?:hit|reach|go to|get to|be worth|recover|double|triple|crash|rise to|fall to)\b|\bprice target\b|\bprice prediction\b|\bpredict\b|\bforecast\b|\bproject(?:ion|ed)?\b[^?]{0,20}\b(?:value|worth|return|price)\b|\bby (?:20[3-9]\d|the end of (?:the )?(?:year|decade))\b|몇 년 (?:후|뒤)|\d+년 (?:후|뒤)(?:에)?[^?]{0,15}(?:얼마|될|가치)|얼마가 될|목표 ?주가|전망 ?가격|(?:오를까|떨어질까|갈까)\??\s*$/i.test(t);
}

/** Soft verdicts that slipped through when the judge timed out (r10 intelligence): "the setup has real weight",
 *  "structural drivers for a multi-year hold", "still far below the target", "$350 is the line to watch". */
export function softVerdicts(text: string): string[] {
  return sentencesOf(text).filter((s) => /\brerat(?:e|es|ed|ing)\b|\ba clean beat\b|\bretracement\b|\bnot (?:a )?reversal\b|\bride (?:it )?out\b|\bsays otherwise\b|\bshift\w* (?:\w+ ){0,4}toward\b|\blight reserve\b|\bnot the engine\b|\bconcentration is (?:your|the) edge\b|\bsmall enough to\b|\bnot a (?:reversal|buy|sell|breakdown|breakout|trend) signal\b|\b(?:bull|bear) (?:thesis|case) (?:has|shows|is showing) (?:visible |clear |some )?cracks\b|\bover-?extended\b|\bwrite-?off risk\b|\bvaluation stretch(?:es|ed)? to\b|\bstretched to \$\d|\bpriced in\b|\bargues? against\b|\b(?:has |finds? |forms? |adds? |provides? |gives? )(?:a |some )?(?:floor|cushion|support)\b|\b(?:a |the )?floor (?:under|beneath|at)\b|\bsupport (?:at|near|around) \$?\d|\brecovery phase\b|\bcompounding (?:is )?(?:intact|alive|on track)\b|\bmomentum (?:has )?(?:stalled|is alive|alive|intact|fading|broken)\b|\bthe story (?:is|remains|still|holds)\b|\bopportunity cost is real\b|\bmeaningful but not extreme\b|\bsetup (?:has|carries) (?:real )?weight\b|\bstructural drivers? for a (?:multi-year|long-term) hold\b|\bfor a (?:multi-year|long-term) hold\b|\b(?:still )?(?:far |well )?(?:below|above|short of|ahead of) (?:the |your )?(?:\d+\s?(?:-|–|to)\s?\d+\s?% )?(?:target|goal)\b|\bis the (?:line|level) to watch\b|\bkey (?:line|level) (?:is|at)\s*\$|\bsetup is (?:mixed|constructive|favorable|strong|weak)\b|\bmomentum (?:is )?strong\b/i.test(s) && !/\b(?:if|whether|unless)\b/i.test(s));
}

/** "TSLA was the only drag" (AVGO lost more), "MSFT is #2" (AAPL is), "MSFT lagging the rest" (META and TSLA did worse):
 *  an only / #N / lagging / leading claim is held to the window's returns (or, with no window, to the weights). */
export function rankPositionClaims(text: string, facts: { names: string[]; pct: Record<number, number | null>; weight?: number | null }[], defaultWindow: number | null = null): string[] {
  const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, "#1": 1, "#2": 2, "#3": 3, "#4": 4, "#5": 5, "no. 1": 1, "no. 2": 2, "no. 3": 3 };
  return sentencesOf(text).filter((s) => {
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const me = named[0];
    const ws = questionWindows(s);
    const w = ws.length === 1 ? ws[0] : ws.length ? null : defaultWindow;
    const vals = (w === null ? [] : facts.map((f) => f.pct[w]).filter((v): v is number => typeof v === "number"));
    const mine = w === null ? null : me.pct[w];
    if (/\bthe only (?:drag|loser|decliner|laggard|holding (?:down|in the red|negative)|one (?:down|in the red|negative))\b/i.test(s)) {
      if (typeof mine !== "number" || vals.length < 2) return false;
      return vals.filter((v) => v < 0).length !== 1 || mine >= 0;
    }
    if (/\bthe (?:biggest |main |largest |key )?drag\b/i.test(s)) {
      if (typeof mine !== "number" || vals.length < 2) return false;
      const contrib = facts.map((f) => (typeof f.pct[w as number] === "number" ? (f.pct[w as number] as number) * (f.weight ?? 1) : Infinity));
      return (mine * (me.weight ?? 1)) > Math.min(...contrib) + 1e-9;
    }
    if (/\bthe only (?:gainer|winner|holding up|one up)\b/i.test(s)) {
      if (typeof mine !== "number" || vals.length < 2) return false;
      return vals.filter((v) => v > 0).length !== 1 || mine <= 0;
    }
    if (/\b(?:lag(?:s|ging)?|trail(?:s|ing)?|behind) (?:the rest|everything|all (?:the )?others|every other)\b/i.test(s)) {
      if (typeof mine !== "number" || vals.length < 2) return false;
      return mine > Math.min(...vals) + 0.05;
    }
    const o = /(#\s?[1-5]|no\. [1-3]|\b(?:first|second|third|fourth|fifth)\b)(?:[- ](?:largest|biggest|best|place))?/i.exec(s);
    if (o && /\b(?:is|ranks?|comes?|sits?)\b/i.test(s)) {
      const n = ORD[o[1].toLowerCase().replace(/\s/g, "")] ?? ORD[o[1].toLowerCase()];
      if (!n) return false;
      if (w !== null && typeof mine === "number" && vals.length >= n) return [...vals].sort((a, b) => b - a).indexOf(mine) + 1 !== n;
      if (w === null && typeof me.weight === "number") {
        const ws2 = facts.map((f) => f.weight).filter((v): v is number => typeof v === "number").sort((a, b) => b - a);
        return ws2.length >= n && ws2.indexOf(me.weight) + 1 !== n;
      }
    }
    return false;
  });
}

/** Sentence fragments and seams (r10 native): "Your crypto holding adds." (a verb left without its object), "exposure is
 *  minimal The risk: …" (a missing period), "TSLA … costs 0.2% of assets" (a weight written as a cost), "S&P500". */
export function fixFragments(text: string): string {
  let t = String(text ?? "")
    .replace(/([a-z0-9%)])\s+(The risk:|What would change it:)/g, "$1. $2")
    .replace(/\bcosts ((?:about |roughly |under )?\d+(?:\.\d+)?%) of (?:assets|the portfolio|your portfolio)\b/g, "is $1 of assets")
    .replace(/\bS&P500\b/g, "S&P 500");
  t = t.replace(/^(\s*(?:•\s*)?)([a-z])/, (_m, a, c) => a + c.toUpperCase());
  // r11: "…must persist across market cycles for the portfolio." (a clause cut away before it)
  t = t.replace(/\s+for the portfolio\.(?=\s|$)/g, ".");
  t = perLine(t, (line) => splitSentences(line).filter((s) => !/^\s*(?:•\s*)?[A-Z][\w'.-]*(?:\s+[\w'.-]+){0,3}\s+(?:adds|provides|offers|gives|brings|delivers|includes|holds|supports|creates)\s*[.!]$/.test(s)).join(" "));
  return t;
}

/** A closing note cites the index closes, never futures as the day's result (r10: "Nasdaq futures at 30,921.75" in a
 *  closing note): a clause naming futures is removed; a sentence that is only about futures goes. */
export function dropFuturesAfterClose(text: string): string {
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((s) => {
    if (!/\b(?:S&P ?500|Nasdaq|Dow)(?: 100)? futures\b/i.test(s)) return s;
    const cut = s.replace(/,?\s*(?:and\s+)?(?:the\s+)?(?:S&P ?500|Nasdaq|Dow)(?: 100)? futures.*?(?=,\s+[A-Za-z]|[.;](?:\s|$)|$)/gi, "").replace(/\s+([,.;])/g, "$1").replace(/,\s*\./g, ".");
    return /\b\d/.test(cut) || cut.split(/\s+/).length >= 6 ? cut : "";
  }).filter(Boolean).join(" "));
}

/** "(as of the 4:00 PM ET close) (+0.3%)": two parentheticals in a row read as one ("(+0.3%, as of the 4:00 PM ET close)"). */
export function mergeParens(text: string): string {
  return String(text ?? "")
    .replace(/\((as of [^()]+)\)\s*\(([+−-]?\d+(?:\.\d+)?%)\)/g, "($2, $1)")
    .replace(/\(([+−-]?\d+(?:\.\d+)?%)\)\s*\((as of [^()]+)\)/g, "($1, $2)");
}

/** "Q3 deliveries ~Oct 2, one week before earnings" (earnings ~Oct 21): a stated gap between two of a holding's known
 *  dates is held to the dates (within a week). */
export function relativeGapClaims(text: string, facts: { names: string[]; dates: Record<string, string | null> }[]): string[] {
  const W: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 };
  return sentencesOf(text).filter((s) => {
    const m = /\b(a|one|two|three|four|five|six|\d)\s+(weeks?|days?|months?)\s+(?:before|ahead of|after|prior to)\s+(?:its |the |their )?(earnings|results|report|deliveries|ex-date|dividend)/i.exec(s);
    if (!m) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const f = named[0];
    const target = /deliver/i.test(m[3]) ? f.dates.deliveries : /ex-date|dividend/i.test(m[3]) ? f.dates.exdate : f.dates.earnings;
    const other = Object.entries(f.dates).filter(([k, v]) => v && v !== target && !(/deliver/i.test(m[3]) ? k === "deliveries" : /ex-date|dividend/i.test(m[3]) ? k === "exdate" : k === "earnings")).map(([, v]) => v as string);
    if (!target || !other.length) return false;
    const n = W[m[1].toLowerCase()] ?? 1;
    const statedDays = /week/i.test(m[2]) ? n * 7 : /month/i.test(m[2]) ? n * 30 : n;
    const actual = other.map((o) => Math.abs(Date.parse(target) - Date.parse(o)) / 86400000);
    return actual.every((a) => Math.abs(a - statedDays) > 7);
  });
}

/** "the biggest company by far" / "the largest company you own" held to market caps (shares outstanding x price). */
export function companySizeClaims(text: string, facts: { names: string[]; mcap: number | null }[]): string[] {
  const known = facts.filter((f) => typeof f.mcap === "number" && (f.mcap as number) > 0);
  if (known.length < 2) return [];
  const top = [...known].sort((a, b) => (b.mcap as number) - (a.mcap as number))[0];
  return sentencesOf(text).filter((s) => {
    if (!/\b(?:biggest|largest|most valuable)\s+(?:company|business|firm|by market (?:cap|value))\b|\bthe (?:biggest|largest) by (?:far|market cap)\b|시가총액(?:이)? (?:가장|제일) 큰/i.test(s)) return false;
    const named = known.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    return named.length === 1 && named[0] !== top;
  });
}

/** "~83% mega-cap tech" when the group is 69.5% (a figure BEFORE the label): the group share is the computed one. */
export function groupShareFirstClaims(text: string, groups: { label: RegExp; value: number }[]): string[] {
  return sentencesOf(text).filter((s) => groups.some((g) => {
    const re = new RegExp(`~?\\s?(\\d+(?:\\.\\d+)?)\\s?%\\s+(?:of (?:the |your )?(?:portfolio|book|assets) (?:is |in )?)?(?:in )?${g.label.source}`, "i");
    const m = re.exec(s);
    return !!m && Math.abs(Number(m[1]) - g.value) > 5;
  }));
}

/** Percentage-point contributions ("TSLA took about 15 points off", Korean "약 15%p") held to weight x return. */
export function pointContributionClaims(text: string, facts: { names: string[]; weight: number; pct: Record<number, number | null> }[]): string[] {
  return sentencesOf(text).filter((s) => {
    const m = /(\d+(?:\.\d+)?)\s?(?:%p|pp|percentage points?|points?\b|포인트)/i.exec(s);
    if (!m) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    if (named.length !== 1) return false;
    const v = Number(m[1]), f = named[0];
    const cands = [f.weight, ...Object.values(f.pct).filter((x): x is number => typeof x === "number").map((p) => Math.abs(p * f.weight / 100))];
    return !cands.some((c) => Math.abs(c - v) <= Math.max(0.3, c * 0.2));
  });
}

/** "iPhone 17" when every headline says iPhone 18: a product generation the sources contradict. */
export function productVersionClaims(text: string, sources: string): string[] {
  const src = String(sources ?? "");
  const RE = /\b(iPhone|iPad|Pixel|Galaxy S|Galaxy Z Fold|Galaxy Z Flip|Model|GPT|Gemini|Llama|Claude|Grok|Apple Watch Series|PlayStation|Xbox|Switch)\s?(\d{1,3})\b/gi;
  const inSrc = new Map<string, Set<string>>();
  for (const m of src.matchAll(RE)) { const k = m[1].toLowerCase(); if (!inSrc.has(k)) inSrc.set(k, new Set()); inSrc.get(k)!.add(m[2]); }
  return sentencesOf(text).filter((s) => [...s.matchAll(RE)].some((m) => { const seen = inSrc.get(m[1].toLowerCase()); return !!seen && seen.size > 0 && !seen.has(m[2]); }));
}

/** A cause pointing the other way ("META fell on JPMorgan's bullish call", "rose after a downgrade"). */
export function directionCauseClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => {
    const down = /\b(?:fell|dropped|slid|sank|declined|lost|slipped|tumbled|down)\b|하락|떨어|빠졌|내렸/i.test(s);
    const up = /\b(?:rose|gained|jumped|climbed|rallied|surged|up)\b|상승|올랐|뛰었/i.test(s);
    if (down === up) return false;
    const cause = /\b(?:after|on|following|as|because of|due to|amid)\b(.{0,80})|(.{0,40})(?:때문|영향으로|여파로|탓에)/i.exec(s);
    if (!cause) return false;
    const c = cause[1] ?? cause[2] ?? "";
    const bull = /\bbullish\b|\bupgrad\w*|\braised (?:its |the )?(?:price )?target\b|\bprice target (?:hike|raise)|\boutperform rating\b|\bbuy rating\b|강세 (?:전망|의견)|목표주가 상향|투자의견 상향|매수 의견/i.test(c);
    const bear = /\bbearish\b|\bdowngrad\w*|\bcut (?:its |the )?(?:price )?target\b|\bunderperform rating\b|\bsell rating\b|약세 (?:전망|의견)|목표주가 하향|투자의견 하향|매도 의견/i.test(c);
    return (down && bull && !bear) || (up && bear && !bull);
  });
}

/** A model answer that carries escaped line breaks ("…\n• BRK.A …" printed literally): they become real ones. */
export const unescapeBreaks = (t: string): string => String(t ?? "").replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, " ");

/** Share-class facts for dual-class listings the user holds or asks about (r11 newcomer M2: "BRK.B vs BRK.A" got wrong
 *  conversion and vote facts). Returned as data lines for the prompt; empty when no dual-class name is involved. */
export function dualClassFacts(text: string): string[] {
  const t = String(text ?? "");
  const out: string[] = [];
  if (/\bBRK(?:[.\-\s]?[AB])?\b|\bBerkshire\b|버크셔/i.test(t)) out.push("Berkshire Hathaway share classes: one Class A share (BRK.A) is economically equal to 1,500 Class B shares (BRK.B), and an A share can be converted into 1,500 B shares at any time (never the reverse). A Class B share carries 1/10,000 of the vote of a Class A share. Both classes own the same company; neither pays a dividend.");
  if (/\bGOOGL?\b|\bAlphabet\b|알파벳/i.test(t)) out.push("Alphabet share classes: GOOGL (Class A) carries one vote per share; GOOG (Class C) carries no vote. Both have the same economic claim on the company and trade at nearly the same price.");
  if (/\bMETA\b[^.]{0,40}\bclass\b|\bclass [AB]\b[^.]{0,40}\bMeta\b/i.test(t)) out.push("Meta: public shareholders hold Class A shares (one vote each); Class B shares (ten votes each) are held mostly by insiders and are not listed.");
  return out;
}
/** A Berkshire share-class ratio other than the real ones (1 A = 1,500 B; a B vote = 1/10,000 of an A vote). */
export function dualClassClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => {
    if (!/\bBRK|\bBerkshire|버크셔/i.test(s)) return false;
    const conv = /(\d[\d,]*)\s*(?:Class )?B(?:[- ]class)? shares?\b|\b(?:equals?|worth|converts? (?:in)?to)\s+(\d[\d,]*)\s+(?:Class )?B\b/i.exec(s);
    if (conv && /\b(?:Class )?A\b|BRK\.?A/i.test(s)) { const n = Number(String(conv[1] ?? conv[2]).replace(/,/g, "")); if (n > 1 && n !== 1500) return true; }
    const vote = /1\s*\/\s*([\d,]+)\s+(?:of (?:the|a) )?vote|(\d[\d,]*)\s*times (?:the |more )?vot/i.exec(s);
    if (vote) { const n = Number(String(vote[1] ?? vote[2]).replace(/,/g, "")); if (n !== 10000) return true; }
    return false;
  });
}

/** Beginner wording for leveraged-fund jargon ("daily reset decay risk"). */
export const plainLeverage = (t: string): string => String(t ?? "")
  .replace(/\bdaily[- ]reset (?:decay|drag)(?: risk)?\b/gi, "the losses that build up because the fund resets its leverage every day")
  .replace(/\bvolatility (?:decay|drag)\b/gi, "the losses that build up in a choppy market")
  .replace(/\bbeta (?:slippage|decay)\b/gi, "the gap between the fund and three times the index over time");

/** "It pays income" / "adds income" for a holding that yields under 2%: that is not what it is for. */
export function lowYieldIncomeClaims(text: string, yieldPct: number | null): string[] {
  if (yieldPct === null || yieldPct >= 2) return [];
  return sentencesOf(text).filter((s) => INCOME_CLAIM.test(s));
}
const INCOME_CLAIM = /\b(?:it |which )?pays? (?:income|a dividend income)\b|\badds? (?:steady |some |meaningful |real |useful |solid |reliable |welcome |a (?:steady |meaningful |nice )?(?:layer|stream|source) of )?income\b|\b(?:meaningful|steady|reliable|solid) (?:dividend )?income\b|\bincome (?:stream|payer|engine|source)\b|\bprovides? income\b/i;

/** r12 D: "MSFT's yield adds meaningful income" for a 0.7% yielder (0.09% of the book) in a lede or desk view: an income
 *  claim for a named holding whose own yield is under 2%. A yield that did not load (null) is unknown, not low. */
export function holdingIncomeClaims(text: string, facts: { names: string[]; yieldPct: number | null }[]): string[] {
  return sentencesOf(text).filter((s) => {
    if (!INCOME_CLAIM.test(s)) return false;
    const named = facts.filter((f) => f.names.some((n) => n && nameIn(s, n)));
    return named.length > 0 && named.every((f) => typeof f.yieldPct === "number" && f.yieldPct < 2);
  });
}

/** Two bullets on one card stating the same day move ("NVDA rose 0.5% today" twice in different words): the later goes. */
export function duplicateMoveBullets(bullets: string[]): string[] {
  const seen = new Set<string>();
  return bullets.filter((b) => {
    const m = /\b(?:today|on the day|this session|in the session|intraday|day's)\b/i.test(b) ? /([+−-]?\d+(?:\.\d+)?)\s?%/.exec(b) : null;
    if (!m) return true;
    const k = String(Math.abs(Number(m[1].replace("−", "-"))));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The code-built summary for "summarize my portfolio" (r12 B: the model's three bullets were filtered down to two
 *  fragments): value and day, the largest weights, and the year so far. */
export function portfolioSummaryLead(v: { total: number; dayUsd: number; dayPct: number; dayLabel: string; top: { label: string; weight: number }[]; ytd: string | null }, ko: boolean): string {
  const money = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
  const sign = (x: number) => (x >= 0 ? "+" : "−");
  const top = v.top.slice(0, 3).map((t) => `${t.label} ${t.weight > 0 && t.weight < 0.05 ? (ko ? "0.1% 미만" : "under 0.1%") : t.weight.toFixed(1) + "%"}`).join(", ");
  return ko
    ? [`• 포트폴리오 ${money(v.total)}, ${v.dayLabel} ${sign(v.dayUsd)}${money(v.dayUsd)} (${sign(v.dayPct)}${Math.abs(v.dayPct).toFixed(2)}%).`, `• 비중이 큰 종목: ${top}.`, ...(v.ytd ? [`• 올해: ${v.ytd}.`] : [])].join("\n")
    : [`• Your portfolio is worth ${money(v.total)}; ${v.dayLabel} ${sign(v.dayUsd)}${money(v.dayUsd)} (${sign(v.dayPct)}${Math.abs(v.dayPct).toFixed(2)}%).`, `• Largest holdings: ${top}.`, ...(v.ytd ? [`• This year: ${v.ytd}.`] : [])].join("\n");
}
/** How many bullets or points a question asks for ("in 3 bullet points"), or null. */
export function askedCount(q: string): number | null {
  const m = /\b(?:in |give me |list )?(\d|one|two|three|four|five)\s+(?:bullet(?: point)?s?|points|lines|things|takeaways)\b|(\d)\s*(?:줄|가지|개 요점)/i.exec(String(q ?? ""));
  if (!m) return null;
  const W: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  return W[(m[1] ?? "").toLowerCase()] ?? Number(m[1] ?? m[2]);
}

/** A window other than a year set against a yearly return target ("up 9% over 3 months, inside your 12-20% target"), or a
 *  cash weight set against it: not comparable. */
export function targetMismatchClaims(text: string): string[] {
  return sentencesOf(text).filter((s) => /\d+\s?(?:-|–|to)\s?\d+\s?%\s*(?:yearly |annual |a year |per year )?(?:return )?(?:target|goal)|(?:return )?(?:target|goal) of \d+/i.test(s)
    && (/\b(?:3|three|1|one|6|six)[- ]month|\b(?:3M|1M|6M|1W)\b|\bthis (?:month|week|quarter)\b|\bquarter\b|\bweek\b|\bcash\b/i.test(s)));
}

/** A move dated to a day the market did not trade ("9/26 +4%" on a Saturday; the move was Friday 9/25's). */
export function nonSessionDatedMoves(text: string, isSession: (ymd: string) => boolean, year: number): string[] {
  return sentencesOf(text).filter((s) => [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\b(?=[^.%]{0,20}[+−-]?\d+(?:\.\d+)?\s?%)/g)].some((m) => {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const ymd = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return !isSession(ymd);
  }));
}

/** r12 F: a watch or risk sentence held to the holding's own live price and last dividend payment. Returns the sentence
 *  (possibly reworded), or null when it cannot stand:
 *   - "dividend under $9" for VOO paying $1.82 (a threshold the payment is already under);
 *   - "ETH stays under $2,800" at $2,687 (already true: the event to watch is the reclaim) -> "ETH reclaims $2,800";
 *   - "falls below $X" with the price already below X, "rises above $X" with it already above.
 *  A level far from the price (under a fifth or over five times it) is some other figure (revenue, a target) and is left
 *  alone, and so is everything when the price or payment is unknown. */
export function levelClaim(sent: string, f: { price: number | null; lastDiv: number | null; currency?: string | null }, mode: "watch" | "risk" = "watch"): string | null {
  const cur = String(f.currency ?? "USD").toUpperCase();
  // a figure with a magnitude word ("$50 billion" of revenue) is never a share price
  const MONEY = (cur === "KRW" ? String.raw`₩\s?([\d,]+(?:\.\d+)?)\s?([kKmM])?` : String.raw`\$\s?([\d,]+(?:\.\d+)?)\s?([kK])?`) + String.raw`(?![\d,]|\s?(?:billion|million|trillion|bn|mn|tn)\b|[BMT]\b)`;
  const val = (d: string, m?: string) => Number(String(d).replace(/,/g, "")) * (m ? (/[kK]/.test(m) ? 1e3 : 1e6) : 1);
  let t = String(sent ?? "");
  // dividend thresholds against the last payment
  const dv = new RegExp(String.raw`\b(?:dividend|payout|distribution)s?\b[^.]{0,30}?\b(?:under|below|less than|<)\s*` + MONEY, "i").exec(t);
  if (dv && typeof f.lastDiv === "number" && f.lastDiv > 0) {
    const x = val(dv[1], dv[2]);
    if (f.lastDiv < x) return null;
    return t;
  }
  if (dv) return t;
  const px = f.price;
  if (typeof px !== "number" || !(px > 0)) return t;
  const near = (x: number) => x >= px / 5 && x <= px * 5;
  const STAY = String.raw`(stays?|holds?|remains?|trades?|sits?|staying|holding|remaining|trading)\s+(under|below|above|over)\s+`;
  const stay = new RegExp(STAY + MONEY, "i").exec(t);
  if (stay) {
    const x = val(stay[3], stay[4]);
    if (!near(x)) return t;
    const below = /under|below/i.test(stay[2]);
    const money = stay[0].slice(stay[0].search(/[$₩]/));
    // a watch is an event still to come: "stays under" a level it is under is the status quo, the reclaim is the event.
    // A risk may name the status quo continuing ("the risk: it stays under $2,800"), so it only has to be true.
    if (below) return px < x ? (mode === "risk" ? t : t.replace(stay[0], `reclaims ${money}`)) : null;
    return px > x ? (mode === "risk" ? t : t.replace(stay[0], `falls below ${money}`)) : null;
  }
  const down = new RegExp(String.raw`\b(?:falls?|drops?|slips?|breaks?|closes?|sinks?|dips?|goes|moves?|trades?|is)\s+(?:back\s+)?(?:below|under)\s+` + MONEY, "i").exec(t);
  if (down) { const x = val(down[1], down[2]); return near(x) && px <= x ? null : t; }
  const up = new RegExp(String.raw`\b(?:(?:rises?|climbs?|breaks?|closes?|moves?|goes|trades?|gets?)\s+(?:back\s+)?(?:above|over|past)|reclaims?|tops?|clears?)\s+` + MONEY, "i").exec(t);
  if (up) { const x = val(up[1], up[2]); return near(x) && px >= x ? null : t; }
  return t;
}
/** levelClaim over every sentence of a field (a watch is one phrase; a note is several). */
export function fixLevelClaims(text: string, f: { price: number | null; lastDiv: number | null; currency?: string | null }, mode: "watch" | "risk" = "watch"): string {
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((x) => levelClaim(x, f, mode)).filter((x): x is string => x !== null).join(" "));
}

/** r12 F: a price drop cuts what a fund is WORTH, not its income ("a 20% drop would cut income" for VOO). */
export const fixDropIncome = (t: string) => String(t ?? "").replace(/(\b(?:drop|fall|decline|drawdown|sell-?off|crash)\b[^.]{0,40}?\b(?:cut|cuts|reduce|reduces|lower|lowers|hurt|hurts|shrink|shrinks)\s+(?:your |its |the |portfolio |the portfolio's )?)income\b/gi, "$1value");

/** r12 F: fund tickers a newcomer will not know, named. A ticker the reader holds is theirs and is left alone. */
export const FUND_NAMES: Record<string, string> = {
  SMH: "VanEck Semiconductor ETF", SOXX: "iShares Semiconductor ETF", QQQ: "Invesco QQQ Trust", QQQM: "Invesco Nasdaq 100 ETF", SPY: "SPDR S&P 500 ETF",
  VOO: "Vanguard S&P 500 ETF", IVV: "iShares Core S&P 500 ETF", VTI: "Vanguard Total Stock Market ETF", VXUS: "Vanguard Total International Stock ETF",
  SCHD: "Schwab U.S. Dividend Equity ETF", VYM: "Vanguard High Dividend Yield ETF", JEPI: "JPMorgan Equity Premium Income ETF", XLK: "Technology Select Sector SPDR Fund",
  VGT: "Vanguard Information Technology ETF", XLF: "Financial Select Sector SPDR Fund", XLE: "Energy Select Sector SPDR Fund", XLV: "Health Care Select Sector SPDR Fund",
  IWM: "iShares Russell 2000 ETF", DIA: "SPDR Dow Jones Industrial Average ETF", BND: "Vanguard Total Bond Market ETF", AGG: "iShares Core U.S. Aggregate Bond ETF",
  TLT: "iShares 20+ Year Treasury Bond ETF", ARKK: "ARK Innovation ETF", SOXL: "Direxion Daily Semiconductor Bull 3X Shares", TQQQ: "ProShares UltraPro QQQ",
  IBIT: "iShares Bitcoin Trust", GLD: "SPDR Gold Shares",
};
export function nameFunds(text: string, held: Set<string>): string {
  return perLine(String(text ?? ""), (line) => splitSentences(line).map((sen) => sen.replace(/(^|[^A-Za-z0-9$&.-])(the\s+|The\s+)?([A-Z]{2,5})(?![A-Za-z0-9&-])/g, (m, pre: string, the: string | undefined, tk: string, off: number) => {
    const nm = FUND_NAMES[tk];
    if (!nm || held.has(tk) || pre === "(") return m;   // "(SMH)" beside its own name is a label
    if (new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(sen)) return m;   // already named in the sentence
    const atStart = !sen.slice(0, off + pre.length).trim() || /[:•]\s*$/.test(sen.slice(0, off + pre.length));
    const art = the ? the : atStart ? "The " : "the ";
    return `${pre}${art}${nm}`;
  })).join(" "));
}

/** r12 F: a desk view whose sentence 1 was dropped opens on "This means…", pointing at nothing: the pointer goes. */
export const fixDanglingThisMeans = (t: string) => String(t ?? "").replace(/^(\s*)This means(?: that)?\s+([a-zA-Z])/, (_m, a: string, c: string) => a + c.toUpperCase());
