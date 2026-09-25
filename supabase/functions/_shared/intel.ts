// Pure, deterministic helpers shared by the intelligence functions (ask, daily-brief, insights-sync,
// warmup, news-sync, price-sync). No I/O here, so every rule is unit-tested in intel_test.ts.
// Each helper exists because a model got a number, a date or a framing wrong in production; the
// comment on each names the failure it closes.

// ---------------------------------------------------------------------------------------------
// Returns over a window
// ---------------------------------------------------------------------------------------------
export type Pt = { ts: string; price: number };

/** Percent change over the trailing `days`, or null when the history does not reach back that far.
 *  The old version started the window at the FIRST point after the cutoff, so a symbol with 7 days of
 *  stored prices reported the same "+3.7%" for 1W and 1M (TSLA, 2026-09-25) and the model repeated it.
 *  Now the base is the last point AT OR BEFORE the cutoff; a first point that lands after the cutoff is
 *  accepted only within a small gap (a weekend or holiday before the window starts). */
export function pctOver(history: Pt[], days: number, now = Date.now()): number | null {
  if (history.length < 2) return null;
  const cutoff = now - days * 86400000;
  let base: Pt | null = null;
  for (const h of history) { if (+new Date(h.ts) <= cutoff) base = h; else break; }
  if (!base) {
    // a window that starts on a weekend or a holiday Monday legitimately has no price at its start
    const first = history[0];
    const graceDays = Math.min(7, Math.max(3.75, days * 0.08));
    if (+new Date(first.ts) - cutoff <= graceDays * 86400000) base = first;
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
const dayDiff = (a: string, b: string) => Math.round((+new Date(ymdOf(a) + "T12:00:00Z") - +new Date(ymdOf(b) + "T12:00:00Z")) / 86400000);

/** The date the company last REPORTED results, from the strongest evidence on file:
 *  1. an 8-K carrying item 2.02 (Results of Operations) is the earnings release itself;
 *  2. an 8-K filed on the day of, or up to 3 days before, a 10-Q/10-K is the same release (companies
 *     file both around the call; NVDA 8-K + 10-Q on Aug 26, MSFT 8-K + 10-K on Jul 29);
 *  3. an earnings-call transcript (never a conference talk), dated by publication.
 *  The fetch or publication date of anything else is NOT an earnings date. */
export function lastEarnings(filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string):
  { date: string; source: EarningsSource } | null {
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
  if (!past.length) return null;
  const top = past[0];
  // the same quarter seen twice (release filed Aug 26, transcript posted Aug 27): the filing date wins
  const best = past.filter((c) => Math.abs(dayDiff(c.date, top.date)) <= 10).sort((a, b) => a.rank - b.rank || (a.date < b.date ? 1 : -1))[0];
  return { date: best.date, source: best.source };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortDate = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "early / mid / late November": an estimate is spoken as a part of a month, never as a precise day. */
export const partOfMonth = (ymd: string): string => {
  const d = Number(ymd.slice(8, 10)), m = MONTHS[Number(ymd.slice(5, 7)) - 1];
  return `${d <= 10 ? "early" : d <= 20 ? "mid" : "late"} ${m}`;
};
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Next report ≈ last report + one quarter (91 days). When that date has just passed with nothing newer
 *  on file, the report is due, not a quarter away (filings land a day or so after the release). */
export function nextEarningsEstimate(lastYmd: string, todayYmd: string): { est: string; due: boolean } {
  let est = addDays(lastYmd, 91);
  if (est < todayYmd && dayDiff(todayYmd, est) <= 21) return { est, due: true };
  while (est < todayYmd) est = addDays(est, 91);
  return { est, due: false };
}

/** One line per holding for the NEXT EARNINGS block of every prompt: the real last report date and the
 *  labelled estimate. The "~Mon D (est)" token is kept so calendar items still pass the dated-item filter. */
export function earningsLine(name: string, filings: FilingLite[], transcripts: TranscriptLite[], todayYmd: string): string | null {
  const last = lastEarnings(filings, transcripts, todayYmd);
  if (!last) return null;
  const nx = nextEarningsEstimate(last.date, todayYmd);
  const when = nx.due ? `due any day now (was expected ~${shortDate(nx.est)} (est), not yet on file)`
    : `expected around ${partOfMonth(nx.est)}, ~${shortDate(nx.est)} (est, not confirmed)`;
  return `${name}: last reported ${shortDate(last.date)} (${last.source}); next report ${when}`;
}

// ---------------------------------------------------------------------------------------------
// Advice guard (Ask): information, never a trade instruction on the user's own book
// ---------------------------------------------------------------------------------------------
const TRADE = "buy|sell|hold|add|trim|swap|rotate|reduce|increase|dump|exit|accumulate|take profits?|lock in|double down|average down|rebalance|redeploy|deploy|allocate|put|move|shift|cut|keep|stay";
// a sentence that OPENS with one of these is an instruction ("Add to NVDA next.", "Skip AVGO and AMZN");
// nouns that happen to share the spelling ("Buy ratings dominate", "Increase in revenue") are not
const IMPERATIVE = new RegExp("^(?:(?:in|for|with|inside) your [^,]{1,30},\\s*)?(?:buy|sell|hold|add|trim|swap|rotate|reduce|dump|exit|accumulate|take profits?|lock in|double down|average down|rebalance|redeploy|deploy|allocate|cut|keep|stay|skip|avoid|sell off|get out|load up|pile in|consider (?:buying|selling|adding|trimming|swapping|rotating|reducing|taking|moving))\\b"
  + "(?!\\s*(?:ratings?|side|case|signals?|-side|backs?|volume|orders?|in mind|an eye|aware|informed|tuned|the course of)\\b)", "i");
// a sentence may end inside bold or a quote ("**Add to NVDA next.** Your cash...")
const sentencesOf = (t: string): string[] => String(t ?? "").split(/(?<=[.!?](?:\*\*|["'\u201d\u2019)\]])?)\s+(?=\S)|\n+/).map((s) => s.trim()).filter(Boolean);
const bare = (s: string) => s.replace(/^[\s•*\-–·\d.)]+/, "").replace(/\*\*/g, "").trim();
/** Sentences (or bullets) that tell the reader what to do with their money. Caught 2026-09-25 in Ask:
 *  "Verdict: hold", "Add to NVDA next. Your $120K cash sits idle", "Skip AVGO and AMZN", "In your 401k,
 *  swap QQQM to an international or bond fund". Scenario and conditional framing stays allowed ("a sell
 *  case would rest on...", "adding would lift the weight to 25%"): that is information. */
export function adviceHits(text: string): string[] {
  const hits: string[] = [];
  for (const raw of sentencesOf(text)) {
    const s = bare(raw);
    if (!s) continue;
    const verdict = /\b(verdict|recommendation|my (?:pick|call|take)|bottom line|action)\s*:\s*(?:\*\*)?\s*(buy|sell|hold|add|trim|keep|accumulate|avoid|skip|swap|reduce)\b/i.test(s);
    const imperative = IMPERATIVE.test(s);
    const second = new RegExp(`\\byou (?:should|must|need to|ought to|might want to|may want to|could consider|'d be wise to)\\s+(?:consider\\s+)?(?:${TRADE}|buying|selling|adding|trimming|swapping|taking)\\b`, "i").test(s);
    const first = new RegExp(`\\b(?:i(?:'d| would)|i recommend|i suggest|we recommend|i'm a)\\s+(?:be\\s+)?(?:${TRADE}|buying|selling|adding|trimming|a buyer|a seller)\\b`, "i").test(s);
    const rating = /\b(?:is|as|looks like|rate it)\s+an?\s+(?:strong\s+|clear\s+)?(buy|sell)\b(?!\s+(?:case|signal|side|rating|-side))|\b(?:top|best)\s+(?:pick|buy|add)\b|\bnow is (?:a|the) (?:good|great|right) (?:time|moment|entry) to\b/i.test(s);
    if (verdict || imperative || second || first || rating) hits.push(raw);
  }
  return hits;
}
/** Delete the offending sentences (deletion only: the figure-integrity rule of the brief scrubs). */
export function stripAdvice(text: string): string {
  const bad = new Set(adviceHits(text));
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
/** "should I sell NVDA", "buy or hold?", "which one should I add to", "is now a good time to buy". */
export function isTradeQuestion(q: string): boolean {
  return /\b(should|shall|do|would|must)\s+(i|we)\s+(?:still\s+|just\s+)?(buy|sell|hold|add|trim|keep|dump|exit|get out|take profits?|swap|rotate|double down|average down|cut|load up|rebalance|move|invest|put)\b/i.test(q)
    || /\b(buy|sell|hold|add|trim)\s*(or|\/)\s*(buy|sell|hold|add|trim|wait)\b/i.test(q)
    || /\b(is|it's)\s+(it|now|this)\s+(a\s+)?(good|right|bad|smart)\s+(time|moment|idea)\s+to\s+(buy|sell|add|trim)\b/i.test(q)
    || /\bhow much\b[^?]{0,40}\b(buy|sell|add|put|invest|allocate)\b/i.test(q)
    || /\bwhich\b[^?]{0,40}\b(should|to)\s+(i\s+)?(buy|sell|add|trim)\b/i.test(q)
    || /\bworth (buying|selling|adding)\b/i.test(q)
    || /(사야|팔아야|매수해야|매도해야|살까|팔까|사도 될까|팔아도 될까|추가 매수)/.test(q);
}
const NO_CALL = /\b(can'?t|cannot|won'?t|don'?t|isn'?t (?:mine|my place))\b[^.]{0,40}\b(tell you|say|make|pick|decide|call|recommend)\b|\b(not|isn'?t) my call\b|\byour call\b|제가 (정해|결정)/i;
/** A "should I sell X" answer opens with ONE short, natural line that the decision is theirs, then gives
 *  the considerations. Added in code when the model left it out; never a wall of disclaimer. */
export function withNoCallLine(answer: string, question: string): string {
  if (!isTradeQuestion(question) || NO_CALL.test(answer)) return answer;
  const ko = /[가-힣]/.test(question);
  return (ko ? "매매 여부는 제가 정해드릴 수 없지만, 판단의 근거는 이렇습니다." : "I can't tell you whether to trade it, but here's what the decision rests on.") + "\n" + answer;
}
/** Follow-up chips ask why / what / how, never "should I buy/sell/add". Caught: "Should I add to Meta on
 *  this dip?", "How much NVDA should I buy with the cash?", "Which holding should I add to next?". */
export function isTradeFollowup(f: string): boolean {
  return isTradeQuestion(f) || /^\s*(should|shall)\s+(i|we)\b/i.test(f) || /\bshould\s+(i|we)\b/i.test(f)
    || /\b(which|what)\b[^?]{0,40}\b(to|should)\s+(buy|sell|add|trim)\b/i.test(f)
    || /\b(time to|good entry|entry point|when to)\s+(buy|sell|add|trim|take)\b/i.test(f);
}
export function cleanFollowups(list: string[], fallbacks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...list, ...fallbacks]) {
    const t = String(f ?? "").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k) || isTradeFollowup(t)) continue;
    seen.add(k); out.push(/[?？]$/.test(t) ? t : t + "?");
    if (out.length >= 3) break;
  }
  return out;
}

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
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
// News quality
// ---------------------------------------------------------------------------------------------
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", trade: "™", reg: "®", copy: "©" };
/** Decode HTML entities, including double-encoded ones ("&amp;amp;"), so titles never show "&amp;". */
export function decodeEntities(s: string): string {
  let x = String(s ?? "");
  for (let i = 0; i < 3 && /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(x); i++) {
    x = x.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return x.replace(/\s+/g, " ").trim();
}
/** Quote pages, option chains, price listings and single-user posts are not news. Caught 2026-09-25:
 *  QQQM's feed was mostly "QQQM Nov 2026 260.000 call ... Historical Prices"; an AVGO insight read a
 *  Moomoo user's "Shorted 32 shares at $363.58" as "confirms support". */
export function isJunkNews(title: string, url: string, source = ""): boolean {
  const t = String(title ?? ""), u = String(url ?? "").toLowerCase(), src = String(source ?? "");
  if (/\b(historical prices|price history|stock price,? (?:news|quote|chart)|quote (?:&|and) (?:history|news|chart)|stock quote|option(?:s)? chain|options? prices?|real-?time quote|stock price today|live stock price|share price (?:today|live|chart))\b/i.test(t)) return true;
  if (/\b(?:call|put)s?\b[^.]{0,40}\b\d{1,5}\.\d{3}\b|\b\d{1,5}\.\d{3}\s+(?:call|put)\b/i.test(t)) return true;   // "Nov 2026 260.000 call"
  if (/^\s*[A-Z0-9.^=-]{1,10}\s*[:|-]?\s*(stock|quote|price|overview|summary|profile)s?\s*$/i.test(t)) return true;
  if (/\/quote\/|\/options?(?:[/?#]|$)|option-?chain|historical-?(?:prices|data)|\/history(?:[/?#]|$)|\/market-activity\/(?:stocks|funds-and-etfs)\/[^/]+\/?(?:option-chain|historical)?$/.test(u)) return true;
  // social posts: Moomoo's feed is user posts ("$Broadcom (AVGO.US)$ Shorted 32 shares at $363.58 ...") and option
  // chain pages, so Moomoo as a byline goes whole; Stocktwits runs a real newsroom, so only its message URLs go
  if (/(?:moomoo\.com|futunn\.com)|stocktwits\.com\/[^/]+\/message\/|reddit\.com|\/\/(?:www\.)?(?:x|twitter)\.com\/|threads\.net|facebook\.com|tiktok\.com|youtube\.com\/shorts/.test(u)) return true;
  if (/^(moomoo|moomoo\.com|futu|futubull|webull community|reddit)$|\br\/\w+/i.test(src.trim())) return true;
  if (/^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$/.test(t)) return true;   // the "$Name (TICKER.US)$" post format
  return false;
}
const CORP = /\b(incorporated|inc|corp(?:oration)?|co|company|companies|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|ag|se|lp|llc|class [a-c]|common stock|ordinary shares|adr|ads|the)\b\.?/gi;
const GENERIC_FIRST = /^(first|united|american|general|global|international|national|advanced|applied|digital|micro|energy|capital|financial|health|technolog\w*|systems|data|royal|pacific|southern|northern|western|eastern|super|smart|great|power|world|green|golden|trust|select|total|invesco|vanguard|ishares|schwab|spdr|proshares|direxion|fidelity|franklin|state|china|korea|japan|japanese|chinese|korean|texas|london|federal|mutual|standard|universal|public|premier|primary|summit|alpha|delta|atlas|apex|marathon|home|bank|best|blue|real|old|new|air|big|all|one|main|true|open|west|east|north|south|next|life|star|sun|gold|red|key|pure|core|fair|park|city|net|sea|oil|gas|car|bio|med|tech|data|cloud|global|ally|good|well|us|u\.s)$/i;
const ALIAS: Record<string, string[]> = {
  GOOGL: ["Google", "Alphabet", "YouTube", "Waymo"], GOOG: ["Google", "Alphabet", "YouTube", "Waymo"], META: ["Meta", "Facebook", "Instagram", "WhatsApp", "Zuckerberg"],
  BAC: ["Bank of America", "BofA"], WFC: ["Wells Fargo"], JPM: ["JPMorgan", "JP Morgan", "Chase"], GS: ["Goldman"], MS: ["Morgan Stanley"], COF: ["Capital One"],
  "BRK.B": ["Berkshire"], "BRK-B": ["Berkshire"], "BRK.A": ["Berkshire"], AMZN: ["Amazon", "AWS"], MSFT: ["Microsoft", "Azure", "OpenAI"], AAPL: ["Apple", "iPhone"],
  TSLA: ["Tesla", "Musk"], NVDA: ["Nvidia"], AVGO: ["Broadcom"], TSM: ["TSMC", "Taiwan Semiconductor"], "BTC": ["Bitcoin", "BTC"], "ETH": ["Ethereum", "Ether"],
  "BTC-USD": ["Bitcoin"], "ETH-USD": ["Ethereum", "Ether"], "SOL-USD": ["Solana"], SOL: ["Solana"],
  QQQ: ["Nasdaq-100", "Nasdaq 100", "Invesco QQQ"], QQQM: ["Nasdaq-100", "Nasdaq 100", "QQQ"], VOO: ["S&P 500", "Vanguard S&P"], SPY: ["S&P 500"], IVV: ["S&P 500"], VTI: ["total stock market", "Vanguard Total"],
  SCHD: ["Schwab U.S. Dividend", "Schwab US Dividend", "dividend ETF"],
};
/** The words that make a story ABOUT this holding: its ticker, its name without legal suffixes, known
 *  brands, and the Korean name for KRX listings. */
export function aliasesFor(symbol: string, name?: string | null, nameKr?: string | null): string[] {
  const out = new Set<string>();
  const tick = symbol.replace(/\.(KS|KQ)$/, "").replace(/-USD$/, "");
  if (!/^\d+$/.test(tick)) out.add(tick);
  for (const a of ALIAS[symbol] ?? []) out.add(a);
  let core = String(name ?? "").replace(/\(.*?\)/g, " ").replace(CORP, " ").replace(/[,.&]+/g, " ").replace(/\s+/g, " ").trim();
  // EDGAR-style names arrive in capitals ("VISA INC CLASS A", "CAPITAL ONE FINANCIAL CORP"): headlines write them
  // in title case, and a short name is matched as a proper noun, so normalise first
  if (core && core === core.toUpperCase() && /[A-Z]{2}/.test(core) && core.includes(" ") || core.length > 3 && core === core.toUpperCase() && core !== tick) {
    core = core.split(" ").map((w, i) => (i > 0 && /^(OF|AND|THE|FOR|DE)$/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
  }
  if (core && core !== tick) {   // "Arm" (Arm Holdings) is a name even though ARM is its ticker
    out.add(core);
    const first = core.split(" ")[0];
    // "Palantir Technologies" is written "Palantir" in headlines, "Arm Holdings" is "Arm"; "Advanced Micro
    // Devices" is never "Advanced" and "Home Depot" never "Home"
    if (first.length >= 3 && core.includes(" ") && /^[A-Z]/.test(first) && !GENERIC_FIRST.test(first)) out.add(first);
    // a generic first word needs its partner: "Capital One", "Wells Fargo"
    else if (core.split(" ").length >= 3 && GENERIC_FIRST.test(first) && !/^(of|and|the)$/i.test(core.split(" ")[1])) out.add(core.split(" ").slice(0, 2).join(" "));
  }
  if (nameKr) { out.add(nameKr); const k = nameKr.replace(/\s*(우|보통주|우선주)$/, ""); if (k) out.add(k); }
  return [...out].filter((a) => a.length >= 2);
}
/** Is the holding CENTRAL to the story (named in its title, or in the lead of a feed that is about this
 *  symbol), rather than a passing mention? Caught 2026-09-25: "Is Ford Stock a Buy for Its Dividend?" and
 *  "What mortgage rate surges mean for home improvement stocks" were tagged NVDA. */
export function newsRelevant(title: string, aliases: string[], lead = "", symbolFeed = false): boolean {
  const mentions = (hay: string) => aliases.some((a) => {
    if (/^[A-Z0-9.]{1,5}$/.test(a)) {
      // a ticker counts only as a TICKER (upper case, standalone, or $/parenthesised), never as a word
      const re = new RegExp(`(?:^|[^A-Za-z0-9])(?:\\$|\\()?${esc(a)}(?:\\))?(?=$|[^A-Za-z0-9])`);
      return re.test(hay) && (a.length >= 3 || new RegExp(`[$(]${esc(a)}\\b`).test(hay));
    }
    if (/[\uac00-\ud7a3]/.test(a)) return hay.includes(a);
    // a short name is matched as a proper noun ("Arm", "Visa"), never as the everyday word
    return new RegExp(`(?:^|[^\\p{L}])${esc(a)}(?=$|[^\\p{L}])`, a.length < 5 ? "u" : "iu").test(hay);
  });
  if (mentions(title)) return true;
  if (!symbolFeed) return false;
  const firstSentence = String(lead ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 220);
  return mentions(firstSentence);
}
/** Normalized title key: the same story syndicated under different URLs (and different tickers). */
export const titleKey = (title: string): string =>
  decodeEntities(title).toLowerCase().replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").replace(/[^a-z0-9가-힣]+/g, " ").trim().slice(0, 90);
/** Which of several held symbols a story is MOST about: the one named earliest in the title. */
export function centrality(title: string, aliases: string[]): number {
  const lower = title.toLowerCase();
  const idx = aliases.map((a) => lower.indexOf(a.toLowerCase())).filter((i) => i >= 0);
  return idx.length ? Math.min(...idx) : Number.POSITIVE_INFINITY;
}
const PUBLISHERS: Record<string, string> = {
  "thestreet.com": "TheStreet", "fool.com": "Motley Fool", "247wallst.com": "24/7 Wall St.", "supplychaindive.com": "Supply Chain Dive",
  "reuters.com": "Reuters", "bloomberg.com": "Bloomberg", "cnbc.com": "CNBC", "wsj.com": "WSJ", "barrons.com": "Barron's", "marketwatch.com": "MarketWatch",
  "investors.com": "Investor's Business Daily", "benzinga.com": "Benzinga", "zacks.com": "Zacks", "seekingalpha.com": "Seeking Alpha", "investopedia.com": "Investopedia",
  "businessinsider.com": "Business Insider", "ft.com": "Financial Times", "forbes.com": "Forbes", "techcrunch.com": "TechCrunch", "theverge.com": "The Verge",
  "gurufocus.com": "GuruFocus", "insidermonkey.com": "Insider Monkey", "investing.com": "Investing.com", "globenewswire.com": "GlobeNewswire", "prnewswire.com": "PR Newswire", "businesswire.com": "Business Wire",
};
/** The byline the reader should see: an aggregator feed (Yahoo) linking to thestreet.com is TheStreet. */
export function publisherFor(url: string, source: string): string {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return source; }
  if (!host || /(^|\.)yahoo\.com$/.test(host) || /news\.google\.com$/.test(host)) return source;
  const hit = Object.keys(PUBLISHERS).find((d) => host === d || host.endsWith("." + d));
  return hit ? PUBLISHERS[hit] : (source === "Yahoo Finance" ? host : source);
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
