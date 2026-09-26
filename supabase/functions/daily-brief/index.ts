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
import { TZ, zonedParts, ymdShift, nextTradingDay, marketState, editionWindow, clockEdition, strandedEdition, dayName, weekdayOf, spanText, isLiveTape, sessionLine, dayTag, marketOf, type MarketState } from "../_shared/calendar.ts";
import {
  fixBookMove, fixWhatItMeans, fixThemeHeavy, themeClaims, ideaContradictions, cleanNote, ungroundedEvents, ungroundedEventSentences, ungroundedCauses, aliasesFor, booksKorean, brokenSentences, repairDrops, liveEditions, themeOf, buildPortfolioParagraph, fixWeights, splitSentences, fixAgreement, promoClaims, returnForecasts, offRiskIdea, fixExposure, type Exposure, deDirect, dropEcho, earningsEstimate, earningsLine, EVIDENCE_LAW, fixArticles, fixGlossArticles, liveNotYesterday, offLensIdea,
  canonicalCalendar, datesIn, dedupePhrases, historicalClaims, wrongEarningsMonths, deliveriesEstimate, noviceGloss, strengthAsRisk, tidyNumbers,
  sanitize, glossParenthetical, stripVerdictTails, unicodeMinus, fixGroupShares, targetBandClaims, perLine, assessmentReader, capNoteKeepRisk, dividendShareClaims, fixProperCase, promoCharacterisations, stripStrayEst, targetPaceClaims, fixFractions, mergeChecked, weightAsMoveHits, wrongYieldClaims, labelLiveFigures, liveNotYesterday as liveNotYesterday2, capSentenceStarts, circularCauses, digitsForWritten, dividendContradictions, dropInstructionEcho, noteDividendClaims, spelledNumbers,
  weekendDated, wrongDeliveriesDates, wrongDividendAmounts, overlap, pctText, plainScrub, PORTFOLIO_PLAIN, unsupportedCauses, unsupportedDated, usableNews, valuationHits, wrongEarningsDates, type FilingLite,
  readerLevel,
} from "../_shared/intel.ts";
import { dividendLine, dividendRows, windowReturns } from "../_shared/history.ts";
import { userIdFrom } from "../_shared/auth.ts";
import { earningsFilings } from "../_shared/filings.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const LEADERS = ["NVDA", "AAPL", "MSFT", "TSLA", "META", "AMZN", "GOOGL"];

// a dash glued to a digit is a MINUS SIGN (−32.8%, –5%): normalize it before the dash-to-comma rewrite, or the sign is lost
// A dash is a MINUS only when it is glued to the digit ("\u201332.8%"). With a space it is punctuation
// ("15.5% \u2014 51.2% of assets"), and treating that as a minus flipped a positive weight negative.
const deDash = (v: string) => v.replace(/[\u2212\u2013\u2014](?=\d)/g, "-").replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");
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

// ---- trading calendar: ../_shared/calendar.ts (shared with insights-sync and ask) ----

// Bumped whenever the brief's guards change enough that today's earlier rows should be rewritten (see "outdated").
// 7 (round 5): a live edition (today's current or previous clock edition) from an older version is REGENERATED
// from current data; older editions are patched with the full sentence chain (repairDrops) and re-narrated.
// 8 (round 7): today's rows carried a weight read as a move ("META dropped 12.8%"), a live move called "yesterday"
// and a 0.5% yield; they are patched (past-window) or regenerated (the current edition).
// 9 (round 7 newcomer): theme weights, gloss grammar, "(est)" on non-dates, promo characterisations, 6-holding reads
// 10 (round 8): verdict tails, close-time labels, true minus signs, tech share and target-band checks
const GEN_VERSION = 10;   // 4: calendar lines from the estimates, the round-4 guards; today's older rows are repaired
// What the writers were given, per user: a dated claim in the finished brief must trace to a date in here
// (drafts handed back to a fact-checker are not sources).
let SOURCES: string[] = [];
// TRANSFORM TRACE (local diagnosis only, BRIEF_TRACE=1): every stage that changes a field is recorded with the
// text before and after, so a garbled sentence can be traced to the transform that produced it (round 6).
type TraceRow = { stage: string; field: string; before: string; after: string };
let TRACE: TraceRow[] | null = null;
let TRACE_LAST = new Map<string, string>();
function flatSections(o: unknown): Map<string, string> {
  const m = new Map<string, string>();
  const s = (o ?? {}) as { lede?: string; overnight?: string; desk_view?: string; horizon?: string; ideas?: string[]; calendar?: string[]; positions?: { name: string; note: string; watch: string }[] };
  for (const k of ["lede", "overnight", "desk_view", "horizon"] as const) if (typeof s[k] === "string") m.set(k, s[k]!);
  (s.ideas ?? []).forEach((x, i) => m.set(`idea${i}`, String(x)));
  (s.calendar ?? []).forEach((x, i) => m.set(`cal${i}`, String(x)));
  (s.positions ?? []).forEach((p) => { m.set(`${p.name}.note`, String(p.note)); m.set(`${p.name}.watch`, String(p.watch)); });
  return m;
}
function snap(stage: string, o: unknown) {
  if (!TRACE) return;
  const cur = flatSections(o);
  for (const [k, v] of cur) { const b = TRACE_LAST.get(k); if (b !== v) TRACE.push({ stage, field: k, before: b ?? "", after: v }); }
  for (const [k, b] of TRACE_LAST) if (!cur.has(k)) TRACE.push({ stage, field: k, before: b, after: "(removed)" });
  TRACE_LAST = cur;
}
async function askModel(key: string, system: string, prompt: string, maxTokens: number, timeoutMs = 30000, model?: string): Promise<Record<string, unknown> | null> {
  if (!/^(Draft (brief|assessment):|This assessment is too thin)/.test(prompt)) SOURCES.push(prompt);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch(`${Deno.env.get("MARA_BASE_URL") ?? "https://api.cloud.mara.com"}/v1/chat/completions`, {   // base overridable for local fixture runs
    signal: ac.signal,
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model ?? Deno.env.get("MARA_MODEL") ?? "MiniMax-M3",
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
type Investor = { styles?: string[] | string; purpose?: string[] | string; horizon?: string[] | string; target?: string[] | string; risk?: string[] | string; level?: string[] | string; defaulted?: string[] };
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
    novice: "BEGINNER reader: plain words, short sentences. Sentences of at most 14 words. NO bare acronyms or jargon ANYWHERE, including watch items and bullets. Banned for this reader: EVERY financial acronym and term of art, including ROE, ROIC, EBITDA, FCF, P/E, EPS, AUM, NIM, capex, basis points, net flows, net interest margin (say: profit on lending), tilt (say: focus), cash drag (say: idle cash), growth premium and valuation (say: price tag), an economic print (say: report), P&L (say: gain or loss), VIX (say: the market\u2019s fear gauge), and the bare word moat (say: a lasting edge over competitors). Use the plain phrase instead: profit growth not ROE, cash flow not FCF, operating profit not EBITDA. Ticker symbols with weights (like QQQM 25.6%) are fine, they are names, not jargon. If a term is unavoidable, gloss it in-line (like: free cash flow, the cash left after all expenses). Never condescend.",
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
  // round 2: a newcomer who skipped the quiz was told about "its 8-12% annual return goal", the quiz default.
  // A client that marks skipped answers (investor.defaulted) gets no target at all; either way the figure is a
  // lens, never quoted back as the reader's own goal.
  const targetSet = raw.target !== undefined && !(Array.isArray(raw.defaulted) && raw.defaulted.includes("target"));
  return `READER PROFILE (personalize EMPHASIS, VOCABULARY and FRAMING for this one reader; facts and numbers stay identical):
- ${lvlG[v.level] ?? lvlG.novice}
- Lens: ${st || styleG.value}. Apply the lens TO this book in EVERY position note and the structure section: the first judgment in each comes through this lens (value: what it is worth versus its price and the downside; income: state in EVERY position note whether and roughly how well that holding pays the owner, dividend or yield posture included, and in the structure section how much income the whole book actually produces), even when the book does not match the lens. Even the one-line verdict must carry the lens: name what kind of book it is AND what that means through this lens (for income: what the book pays its owner; for value: what it costs versus what it earns).
- ${pp || purpG.watch}
- ${hz}; ${targetSet ? `target return ${v.target.join(" or ")}/yr (a lens for judging fit; never quote it back as "your X% goal")` : "no return target stated: never mention a return goal or target"}; ${rk || riskG.hold}.`;
}

const krName = (sy: string, nick?: string | null, nm?: string | null) =>
  (nick || ((sy.endsWith(".KS") || sy.endsWith(".KQ")) && nm ? nm : sy));

/** "+4.1%" over the trailing window, or "not enough price history yet": read point by point (see
 *  _shared/history.ts), never by reusing a shorter window when the stored history is thin. */
// deno-lint-ignore no-explicit-any
const windowsText = async (admin: any, symbol: string, days: number[], mkt?: "US" | "KR" | null): Promise<Record<number, string>> => {
  const wr = await windowReturns(admin, symbol, days, Date.now(), mkt);
  return Object.fromEntries(days.map((d) => [d, pctText(wr.pct[d] ?? null)]));
};

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
// THEMES / themeOf live in _shared/intel.ts (Ask's code-built answer states the theme mix too)
const geoOf = (sym: string, kind: string | null) => kind === "crypto" || sym.endsWith("-USD") ? "crypto" : (sym.endsWith(".KS") || sym.endsWith(".KQ")) ? "Korea" : "US";

// deterministic plain-language pass for BEGINNER readers: the recurring terms the model keeps leaking, mapped in code
const noviceScrub = (t: string, keep: string[] = []): string => {
  // plainScrub never doubles a gloss the model already wrote: "VIX, the market's fear gauge, fell" used to
  // come out "The market's fear gauge, the market's fear gauge, fell" (2026-09-25)
  // a gloss dropped after a modifier keeps no stray article ("on sustained a shrinking price tag", round 3)
  // one shared map, glossed in context: "AI capex scrutiny" became "AI spending on equipment and buildout scrutiny"
  // (round 4); a term used as a modifier now reads "scrutiny of the spending on equipment and buildout"
  // round 8 newcomer: substituted glosses broke grammar ("Amazon's retail lasting edge over competitors"); the term now
  // stays and its plain meaning follows once in parentheses, which cannot break a sentence
  let x = glossParenthetical(t, keep);
  // A replacement that begins with a possessive collides with any article in front of the term it
  // replaced: "a CET1 ratio below 12%" became "A its safety cushion of capital below twelve percent".
  // Drop the stranded article - deletion only, and it cannot touch text the map did not rewrite.
  x = x.replace(/\b([Aa]n?|[Tt]he)\s+(its|their|his|her)\b/g, (_m, art, poss) => (/^[A-Z]/.test(art) ? poss.charAt(0).toUpperCase() + poss.slice(1) : poss));
  // a lowercase replacement can land at a sentence start; the guard on the preceding character keeps
  // abbreviations ("U.S. stocks") from being re-capitalised
  return capSentenceStarts(x);
};

// word-cap enforcement, boundary aware; hoisted so it can also run LAST, after the vocabulary
// substitution that lengthens text ("moat" becomes "lasting edge over competitors")
const fitCap = (t: string, cap: number, mustKeep?: RegExp): string => {
  const wcT = (x: string) => x.split(/\s+/).filter(Boolean).length;
  let out = t.trim();
  // whole sentences first, split the abbreviation-aware way: the old "[^.!?]+$" tail took "Treasury and corporate
  // bonds." off "a bond fund holding U.S. Treasury and corporate bonds." and left "holding U.S." (round 5)
  for (let sents = splitSentences(out); wcT(out) > cap && sents.length > 1; sents = splitSentences(out)) {
    const shorter = sents.slice(0, -1).join(" ").trim();
    if (mustKeep && !mustKeep.test(shorter)) break;
    out = shorter;
  }
  if (wcT(out) > cap) {
    // a raw word-slice leaves a dangling fragment ("...on the same driver, so."); end on a real boundary
    let cut = out.split(/\s+/).slice(0, cap).join(" ");
    // a period only ENDS a sentence when whitespace or the end follows it: the decimal point inside
    // "25.6%" was being read as a terminator, which is how "so 25." reached the reader
    const ends = [...cut.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index ?? -1)
      .filter((i) => !/\b(?:U\.S|U\.K|Inc|Co|Corp|Ltd|e\.g|i\.e|etc|vs|No|St)$/.test(cut.slice(0, i)));
    const stop = ends.length ? ends[ends.length - 1] : -1;
    // any sentence end wins over a mid-sentence cut: a shorter complete sentence beats a fragment ending on
    // "relative." (round 3 newcomer assessment)
    if (stop > 0) cut = cut.slice(0, stop + 1);
    else {
      // likewise here: only a comma OUTSIDE a number is a clause boundary
      const commas = [...cut.matchAll(/(?<!\d),(?!\d)/g)].map((m) => m.index ?? -1);
      const comma = commas.length ? commas[commas.length - 1] : -1;
      if (comma > cut.length * 0.4) cut = cut.slice(0, comma);
      let prev = "";
      while (prev !== cut) { prev = cut; cut = cut.replace(/[\s,;:]+(?:so|and|but|or|which|that|with|for|to|at|in|on|of|as|while|because|if|when|from|by|than|after|before|into|over|under|about|its|their|the|a|an|relative|sustained|continued|further|ongoing|more|less|very|such|each|every|any|some|no|not|also|still|just|even|only|is|are|was|were|be|been|has|have|had|will|would|could|should|can|may|might|between|against|toward|towards|through|across|amid|per|via|versus|vs|plus|including|this|these|those|our|your|his|her)\.?$/i, ""); }
      cut = cut.replace(/[,;:]+$/, "") + ".";
    }
    if (!mustKeep || mustKeep.test(cut)) out = cut;   // last resort: a hard cut, but never one that loses the required clause
  }
  return out;
};

// A call's age, spelled out for the memo writers: a quarter-old transcript otherwise reads as this week's news.
const callAgeLine = (publishedAt: unknown, briefDate: string): string => {
  const t = +new Date(String(publishedAt ?? "")), d = +new Date(briefDate + "T00:00:00Z");
  if (!Number.isFinite(t)) return "date unknown";
  const age = Math.max(0, Math.floor((d - t) / 86400000));
  return age <= 7 ? `${age} days ago, fresh` : `${age} days ago, BACKGROUND not news: nothing in it was just reported`;
};
const STYLE_RULES = `BLUF LAW: every section opens with its CONCLUSION in the first sentence; evidence and numbers come after. Never open any section with a chain of ticker-and-percent moves; say what it all means first, then the one or two moves that prove it. This applies to EVERY position note as well: open with what the move MEANS for this owner ("Your biggest holding barely moved"), then give the move and its number in the next sentence. A note that opens "TICKER fell 0.7% today" is a failure.
NUMBER DIET: numbers are seasoning, not the meal. Use the ONE number that carries each point; never two numbers in one sentence unless comparing them; a section never needs more than three.
OPINION: have a view. One confident, fact-backed judgment per section is expected ("this is the book's real risk", "this print matters more than the headline"); never wishy-washy, never hedged into mush. Opinions about quality and risk, never buy/sell instructions.
CONSTRUCTIVE FRAME: straightforward and data-driven, but framed positively: a risk comes with what would manage it or what to check next, never bare doom; strengths get real airtime; every section leaves the reader knowing what to DO next (a thing to check, read, or watch).
CONCENTRATION LAW: a big position is NOT automatically a fault. Concentration is how conviction pays, and most wealth is built by holding something large for a long time. When a concentrated holding FITS the owner's stated risk appetite, style and return target, lead with what it is EARNING them - the exposure they deliberately wanted, the upside it captures, the fees or dilution it avoids - and only then name the single condition that would turn it into a problem. Never call a chosen concentration a mistake, a warning, or something to fix; call it a deliberate bet with a named payoff and a named tripwire. When the concentration does NOT fit the owner's goal (a cautious or income-focused owner), still open with what it has delivered for them before what it puts at risk, and frame the fix as a choice, not a correction.
BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as \u20a9 (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.
${EVIDENCE_LAW}`;
/** The assessment's YOUR PORTFOLIO paragraph, from the book itself (exported for tests via the shared helper). */
function yourPortfolio(holdings: { name: string; usd: number }[], cashUsd: number, total: number, exp: Exposure, modelText: string): string {
  return buildPortfolioParagraph(holdings, cashUsd, total, exp, modelText);
}

/** Patch in code every row of `briefDate` for one user written by an older GEN_VERSION, except the LIVE editions
 *  (`live`: those are regenerated from current data, never patched). Returns the editions it patched, whose
 *  script and audio were cleared, so the caller can have them re-narrated. */
// deno-lint-ignore no-explicit-any
type RepairCtx = { facts: { symbol: string; names: string[]; weight: number; pct: number | null }[]; yields: number[] };
async function repairToday(admin: any, uid: string, rows: { symbol: string; kind: string; nickname?: string | null; name?: string | null }[], briefDate: string, live: string[], ctx?: RepairCtx): Promise<{ edition: string; date: string }[]> {
  // Round 9 designer: the rows a reader SEES are the latest ones, not only today's. Over a weekend (or before the first
  // edition of a day) Home shows the last trading day's rows, and a repair keyed to today's date never reached them: the
  // App Review showcase still read "(as of 7:31 PM ET)" and "META -3.3%" after GEN 10 shipped. Each user's latest brief
  // date (within the last week) is repaired along with today's, eagerly, on the next run.
  const r = await admin.from("daily_briefs").select("id, edition, sections, gen_version, brief_date, generated_at").eq("user_id", uid)
    .lte("brief_date", briefDate).gte("brief_date", ymdShift(briefDate, -7)).order("brief_date", { ascending: false }).limit(20);
  if (r.error) return [];   // before migration 39
  let all = (r.data ?? []) as { id: number; edition: string; sections: unknown; gen_version: number | null; brief_date: string; generated_at?: string | null }[];
  const latestPast = all.map((o) => String(o.brief_date)).filter((d) => d < briefDate).sort().pop();
  // Round 9 intelligence: a row written outside its window (the showcase's "Morning brief · Written at 7:32 PM", a
  // compact backfill after the Close) is DELETED, so Home falls back to the edition that belongs there. New ones
  // cannot be written (editionWindow); this clears the ones already stored.
  const stranded = all.filter((o) => (o.brief_date === briefDate || o.brief_date === latestPast)
    && strandedEdition(o.edition, String(o.brief_date), o.generated_at ?? null, all.filter((x) => x.brief_date === o.brief_date)));
  for (const o of stranded) await admin.from("daily_briefs").delete().eq("id", o.id).then(() => {}, () => {});
  if (stranded.length) all = all.filter((o) => !stranded.includes(o));
  const stale = all.filter((o) => (o.brief_date === briefDate || o.brief_date === latestPast)
    // a live edition of TODAY is regenerated, never patched; the latest past day's rows are all past-window
    && !(o.brief_date === briefDate && live.includes(o.edition)) && Number(o.gen_version ?? 0) < GEN_VERSION && validSections(o.sections));
  if (!stale.length) return [];
  const patched: { edition: string; date: string }[] = [];
  const syms = rows.filter((x) => !x.symbol.startsWith("$") && x.kind !== "cash" && x.kind !== "debt").map((x) => x.symbol).slice(0, 12);
  const [fl, { data: tr }] = await Promise.all([
    earningsFilings(admin, syms),
    admin.from("transcripts").select("symbol, title, published_at").in("symbol", syms).order("published_at", { ascending: false }).limit(60),
  ]);
  const ests = syms.map((sy) => {
    const h = rows.find((x) => x.symbol === sy)!;
    const e = earningsEstimate(fl.filter((f) => f.symbol === sy), ((tr ?? []) as { symbol: string; title: string; published_at: string | null }[]).filter((t) => t.symbol === sy), briefDate);
    const names = [krName(sy, h.nickname, h.name), ...aliasesFor(sy, h.name)];
    return { names, label: names[0], est: e?.est ?? null, ...(e?.range ? { range: e.range } : {}), dlv: deliveriesEstimate(sy, briefDate)?.est ?? null };
  });
  for (const o of stale) {
    const fixed = repairSections(o.sections as Sections, ests, String(o.brief_date ?? briefDate), ctx, o.edition);
    // Round 8 native: every GEN bump nulled the audio and script of every repaired row, and re-narration is throttled,
    // so no brief had narration. The spoken text is cleared ONLY when the repair actually changed the text.
    const changed = spokenText(fixed) !== spokenText(o.sections as Sections);
    await admin.from("daily_briefs").update(changed ? { sections: fixed, gen_version: GEN_VERSION, audio_path: null, script: null } : { gen_version: GEN_VERSION }).eq("id", o.id).then(() => {}, () => {});
    if (changed) patched.push({ edition: o.edition, date: String(o.brief_date ?? briefDate) });
  }
  // the latest edition of the latest day first: that is the one the reader opens
  const ORDER = ["close", "kr_close", "midday", "kr_open", "morning", "weekend", "assessment"];
  return patched.sort((a, b) => b.date.localeCompare(a.date) || ORDER.indexOf(a.edition) - ORDER.indexOf(b.edition));
}

/** Code-only repair of a stored brief (no model, no new facts): doubled phrases and glosses collapse, "directly"
 *  loses its unsupported intensity, articles and plain words are fixed, a sentence dating a holding's report
 *  away from its estimate is deleted, and calendar / watch lines are rebuilt from the estimates. */
/** The text a script is built from: when this is unchanged, the stored narration still matches it. */
function spokenText(o: Sections): string {
  return JSON.stringify([o.lede, o.overnight, o.desk_view, o.horizon ?? "", o.ideas ?? [], (o.positions ?? []).map((p) => [p.name, p.note, p.watch]), o.calendar ?? []]);
}
function repairSections(src: Sections, ests: { names: string[]; label: string; est: string | null; range?: [string, string]; dlv?: string | null }[], today: string, ctx?: RepairCtx, edition = ""): Sections {
  // round 7: a morning written after the open called live moves "yesterday": with the row's own basis (its as_of and
  // the day moves it was written against), a figure that IS that day's move is relabelled "so far today"
  const basis = src as unknown as { as_of?: string; day_by_symbol?: Record<string, number> };
  const asOf = basis.as_of ? new Date(basis.as_of) : null;
  const wasLive = edition === "morning" && !!asOf && (() => { const z = zonedParts(asOf, TZ.US); return z.ymd === today && z.minutes >= 9 * 60 + 30 && z.minutes < 16 * 60; })();
  const liveFacts = wasLive && ctx ? ctx.facts.filter((f) => typeof basis.day_by_symbol?.[f.symbol] === "number").map((f) => ({ names: f.names, pct: basis.day_by_symbol![f.symbol] })) : [];
  // a collapsed appositive can leave a comma between a subject and its verb ("The market's fear gauge, fell 3.3%")
  const unComma = (t: string) => t.replace(/(^|[.!?]\s+)([A-Z][^,.!?]{2,50}),\s+(fell|rose|jumped|slipped|climbed|dropped|gained|lost|added|edged|dipped|sank|rallied)\b/g, "$1$2 $3");
  // round 9: a figure fixed at the 4:00 PM close carried the clock time it was read ("(as of 7:31 PM ET)")
  const closeLabel = (t: string) => t.replace(/\(as of (\d{1,2}):(\d{2}) (AM|PM) ET\)/g, (m, h, mi, ap) => {
    const mins = (Number(h) % 12 + (ap === "PM" ? 12 : 0)) * 60 + Number(mi);
    return edition === "close" || edition === "kr_close" || mins >= 16 * 60 ? "(as of the 4:00 PM ET close)" : m;
  });
  const bookPct = typeof (src as unknown as { day_pct?: number }).day_pct === "number" && edition !== "assessment" && edition !== "weekend" ? (src as unknown as { day_pct: number }).day_pct : null;
  const text = (t: string) => fixBookMove(fixWhatItMeans(closeLabel(unicodeMinus(fixProperCase(tidyNumbers(fixArticles(plainScrub(fixGlossArticles(deDirect(unComma(dedupePhrases(stripVerdictTails(String(t ?? "")))))), PORTFOLIO_PLAIN))))))), bookPct);
  const dlvFacts = ests.map((e) => ({ names: e.names, est: e.dlv ?? null }));
  const dropWrong = (t: string) => {
    const x = liveFacts.length ? liveNotYesterday2(text(t), liveFacts) : text(t);
    const parts = splitSentences(x);
    // round 5: the full sentence chain too (broken and verbless fragments, advice, valuation, promo, forecasts):
    // "...Nasdaq futures (+0.7%), and one smaller position." survived a repair that ran only the calendar checks
    const bad = new Set([...wrongEarningsDates(parts, ests, today), ...wrongEarningsMonths(x, ests), ...wrongDeliveriesDates(x, dlvFacts, today), ...parts.filter((p) => strengthAsRisk(p)), ...repairDrops(x),
      // round 7: a weight printed as a move ("META dropped 12.8%"), a yield we never computed ("near 0.5%")
      ...(ctx ? [...weightAsMoveHits(x, ctx.facts), ...(ctx.yields.length ? wrongYieldClaims(x, ctx.yields) : [])] : []),
      ...promoCharacterisations(x), ...targetPaceClaims(x)]);
    const kept = parts.filter((p) => !bad.has(p) && ![...bad].some((b) => b.includes(p) || p.includes(b)));
    return kept.length ? kept.join(" ") : x;
  };
  const s: Sections = { ...src, lede: dropWrong(src.lede), overnight: dropWrong(src.overnight), desk_view: dropWrong(src.desk_view) };
  if (src.horizon) s.horizon = dropWrong(src.horizon);
  s.positions = (src.positions ?? []).map((p) => {
    const canon = canonicalCalendar([p.watch], ests, "", today);
    const earn = /\b(earnings|results|reports?|call|print|preview)\b/i.test(p.watch) && ests.some((e) => e.names.some((n) => n && String(p.watch).toLowerCase().includes(n.toLowerCase())));
    const dated = datesIn(p.watch, today).length > 0 || weekendDated([p.watch], today).length > 0;
    return { ...p, note: dropWrong(p.note), watch: earn ? canon[0] ?? "No confirmed date yet" : dated ? "No confirmed date yet" : stripStrayEst(text(p.watch)) };
  });
  s.calendar = canonicalCalendar(src.calendar ?? [], ests, "", today).filter((c) => !weekendDated([c], today).length);
  if (src.ideas) s.ideas = src.ideas.map(text).filter((i) => !repairDrops(i).length);
  return s;
}

function validSections(o: unknown): o is Sections {
  const s = o as Sections;
  return !!s && typeof s.lede === "string" && !!s.lede.trim() && typeof s.overnight === "string"
    && Array.isArray(s.positions) && s.positions.length >= 1 && s.positions.length <= 6
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
      // a caller may only target themself: refuse outright rather than silently widening to everyone. The token
      // is verified by signature and expiry (_shared/auth.ts), like every other user-facing function: GoTrue's
      // getUser refused tokens whose session a sign-out elsewhere had revoked.
      if (await userIdFrom(admin, bearerJwt) !== onlyUserId) return json({ ok: false, error: "forbidden target" }, 403);
    }
  }
  const noAudio = body.noAudio === true;   // battery/test runs must not spend TTS quota
  type Edition = "morning" | "midday" | "close" | "assessment" | "weekend" | "kr_open" | "kr_close";
  const validEd = (x: unknown): x is Edition => x === "morning" || x === "midday" || x === "close" || x === "assessment" || x === "weekend" || x === "kr_open" || x === "kr_close";
  const edRaw = url.searchParams.get("edition") ?? (body as { edition?: unknown }).edition;
  // "assessment" is never chosen by the clock: it is requested explicitly (orchestrator / brief-retry) and always forced
  const clockResolved = !validEd(edRaw);
  // Round 9: the clock runs in ET (it ran on UTC minutes) and every edition has a window (_shared/calendar.ts
  // editionWindow): a Midday was written at 5:32 PM ET and a Morning at 8:02 PM ET, and Home opened on them instead of
  // the Close. An explicit edition (brief-retry, the regeneration dispatch, operators) obeys the same window; only an
  // internal-token caller passing outOfWindow (batteries) or a fixture run may write outside it.
  const clockEd = clockEdition();
  if (clockResolved && clockEd === null) return json({ ok: true, users: 0, wrote: 0, reason: "between edition windows (ET)" });
  let edition: Edition = validEd(edRaw) ? edRaw : clockEd!;
  if (clockResolved && edition === "weekend" && zonedParts(new Date(), TZ.US).minutes < 9 * 60) return json({ ok: true, users: 0, wrote: 0, reason: "weekend read waits for 9 AM ET" });
  {
    const w = editionWindow(edition);
    let overrideOk = false;
    if (body.outOfWindow === true) {
      let t = Deno.env.get("INTERNAL_TOKEN") ?? "";
      if (!t) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); t = data ?? ""; }
      overrideOk = !!t && (req.headers.get("x-internal-token") ?? "") === t;
    }
    if (!w.ok && !fixture && !overrideOk) return json({ ok: true, users: 0, wrote: 0, reason: w.reason });
  }
  // Korea editions ride the KRX clock, not the US one: written on KRX trading days (KST) for users holding Korean
  // names. A Sunday 8 PM Central for the reader is Monday 10 AM in Korea, and their Korean sleeve is already moving.
  const krEdition = edition === "kr_open" || edition === "kr_close";
  if (krEdition && !force && !marketState("KR").tradingToday) return json({ ok: true, users: 0, wrote: 0, reason: "KRX is not trading today (KST)" });
  if (edition === "assessment" && !force && !fixture) return json({ ok: false, error: "assessment requires force" }, 400);

  let key = "";
  if (!fixture) {
    key = Deno.env.get("MARA_API_KEY") ?? "";
    if (!key) { const { data } = await admin.rpc("get_secret", { secret_name: "mara_api_key" }); key = data ?? ""; }
    if (!key) return json({ ok: false, error: "not configured" }, 500);
  }
  const model = Deno.env.get("MARA_MODEL") ?? "MiniMax-M3";

  // Brief date = US Eastern trading day.
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const briefDate = krEdition ? zonedParts(new Date(), TZ.KR).ymd : etParts;   // YYYY-MM-DD; Korea editions carry the KST date

  // ---- shared market context (deterministic) ----
  const ctxSyms = ["ES=F", "NQ=F", "^VIX", "^KS11", "^GSPC", "USDKRW"];
  const { data: ctxPrices } = await admin.from("prices").select("symbol,price,change_pct").in("symbol", [...ctxSyms, ...LEADERS]);
  const px = new Map((ctxPrices ?? []).map((p) => [p.symbol, { price: Number(p.price), chg: p.change_pct === null ? null : Number(p.change_pct) }]));
  const fmtCtx = (sy: string, label: string) => {
    const p = px.get(sy);
    return p ? `${label} ${p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${p.chg !== null ? ` (${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%)` : ""}` : null;
  };
  // KOSPI and the won rate only reach books that hold something Korean: a USD-only reader never sees won
  const krCtx = (korean: boolean) => korean ? [fmtCtx("^KS11", "KOSPI"), fmtCtx("USDKRW", "USDKRW")] : [];
  const marketLinesFor = (korean: boolean) => [
    fmtCtx("ES=F", "S&P500 futures"), fmtCtx("NQ=F", "Nasdaq futures"), fmtCtx("^GSPC", "S&P500 close"),
    fmtCtx("^VIX", "VIX"), ...krCtx(korean),
  ].filter(Boolean).join(" · ");
  const mktLiveFor = (korean: boolean) => [
    fmtCtx("^GSPC", "S&P500 index"), fmtCtx("NQ=F", "Nasdaq futures"), fmtCtx("^VIX", "VIX"), ...krCtx(korean),
  ].filter(Boolean).join(" · ");
  const leaderLines = LEADERS.map((sy) => { const p = px.get(sy); return p && p.chg !== null ? `${sy} ${p.chg >= 0 ? "+" : ""}${p.chg.toFixed(1)}%` : null; }).filter(Boolean).join(" · ");
  const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: leaderNews } = await admin.from("news").select("symbol,title,url,source,summary").in("symbol", LEADERS)
    .gte("published_at", since24h).order("published_at", { ascending: false }).limit(20);
  const leaderHeads = (leaderNews ?? []).filter((n) => usableNews(n, aliasesFor(n.symbol))).slice(0, 7).map((n) => `- ${n.symbol}: ${String(n.title).slice(0, 90)}`).join("\n");

  // ---- users ----
  const { data: pf } = await admin.from("portfolio").select("user_id, symbol, kind, account, currency, qty, price, value, change_pct, nickname, name, cost_basis, total_gl");
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
  // REPAIR PASS, every user, before any generation: today's rows written by an older daily-brief are fixed in
  // code (deletion and relabelling only, a few hundred milliseconds each). Round 4 poweruser: a midday row with
  // gen_version null still carried "Copilot earnings preview Sep 27" hours after the fix, because the
  // regenerate-once path reaches only the one or two users a run has wall-clock time to rewrite.
  // Round 5/6: a LIVE edition (the one this run writes, and the one the clock is on; never a past-window edition) is never
  // patched: a patched morning kept "...Nasdaq futures (+0.7%), and one smaller position." and called live
  // moves "yesterday". It is REGENERATED from current data by a forced self-invocation (so a morning rewritten
  // after 9:30 ET takes the opening-read path); only older editions are patched, and those are re-narrated
  // because the patch clears the script.
  const isRegen = body.regen === true;   // a regeneration run never repairs or dispatches (no cascades)
  const usClock: Edition | null = clockEd;
  const live: string[] = [...new Set([...liveEditions(edition), ...(usClock ? liveEditions(usClock) : [])])];
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let itokShared = Deno.env.get("INTERNAL_TOKEN") ?? "";
  const handOff = async (fn: string, payload: Record<string, unknown>) => {
    if (!itokShared) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itokShared = data ?? ""; }
    const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
      method: "POST", headers: { Authorization: `Bearer ${svcKey}`, apikey: svcKey, "Content-Type": "application/json", "x-internal-token": itokShared },
      body: JSON.stringify(payload),
    }).then((r) => r.text().catch(() => "")).catch(() => null);
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ }
  };
  // the book's facts a stored brief is checked against: each holding's weight and day move, and the yields we computed
  const repairCtxOf = async (uid: string): Promise<RepairCtx> => {
    const rows = byUser.get(uid) ?? [];
    const toUsd = (v: number, c: string) => v / (fxMap.get(c) ?? 1);
    const tot = rows.filter((r) => r.kind !== "debt").reduce((a, r) => a + toUsd(Number(r.value ?? 0), r.currency), 0) || 1;
    const hs = rows.filter((r) => !r.symbol.startsWith("$") && r.kind !== "cash" && r.kind !== "debt");
    const dv = await dividendRows(admin, hs.map((r) => r.symbol)).catch(() => new Map());
    let cur = 0, ttm = 0;
    const each: number[] = [];
    for (const r of hs) {
      const d = dv.get(r.symbol);
      if (!d || !(Number(d.div_last) > 0)) continue;
      const line = dividendLine(r.symbol, d, Number(r.qty ?? 0), r.currency ?? "USD", fxMap.get(r.currency ?? "USD") ?? 1);
      cur += line.annual; ttm += Number(r.qty ?? 0) * Number(d.div_ttm ?? 0) / (fxMap.get(r.currency ?? "USD") ?? 1);
      if (d.div_yield) each.push(Number(d.div_yield));
    }
    return {
      facts: hs.map((r) => ({ symbol: r.symbol, names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], weight: toUsd(Number(r.value ?? 0), r.currency) / tot * 100, pct: r.change_pct === null ? null : Number(r.change_pct) })),
      yields: cur > 0 ? [cur / tot * 100, ttm / tot * 100, ...each].map((v) => Number(v.toFixed(2))) : [],
    };
  };
  const loopIds = new Set(userIds.slice(0, 10));
  let dispatched = 0, renarrated = 0;
  if (!isRegen) {
    const repairStart = Date.now();
    for (const uid of userIds) {
      if (Date.now() - repairStart > 30000) break;
      const patched = await repairToday(admin, uid, byUser.get(uid) ?? [], briefDate, live, await repairCtxOf(uid).catch(() => undefined)).catch(() => [] as { edition: string; date: string }[]);
      // the patch cleared the script: re-script and re-voice it now (narrate's sweep catches any beyond 8)
      // every row whose text changed is re-narrated (round 8: 8 hand-offs per run left most rows silent)
      for (const pt of patched) if (!fixture && !noAudio && renarrated < 40) { renarrated++; await handOff("narrate", { user_id: uid, brief_date: pt.date, edition: pt.edition }); }
    }
    if (!fixture) {
      const staleLive = await admin.from("daily_briefs").select("user_id, edition, gen_version, generated_at").eq("brief_date", briefDate).in("edition", live).in("user_id", userIds);
      for (const o of (staleLive.error ? [] : staleLive.data ?? []) as { user_id: string; edition: string; gen_version: number | null; generated_at: string | null }[]) {
        if (dispatched >= 8) break;
        if (Number(o.gen_version ?? 0) >= GEN_VERSION || !validEd(o.edition) || o.edition === "assessment" || !editionWindow(o.edition).ok) continue;
        if (Date.now() - +new Date(String(o.generated_at ?? 0)) < 15 * 60000) continue;   // its narration may still be running
        // the edition this run writes is regenerated inline for the users the loop reaches
        if (o.edition === edition && loopIds.has(o.user_id)) continue;
        dispatched++;
        await handOff("daily-brief", { force: true, regen: true, user_id: o.user_id, edition: o.edition, ...(noAudio ? { noAudio: true } : {}) });
      }
    }
  }
  // Round 7: one run wrote about ONE user's brief before its wall clock ran out, so the close edition reached 6 of 10
  // users by 23:00 UTC (the showcase not at all). A clock run (no user target) now fans out: every user who still
  // needs this edition gets their own invocation, with its own wall clock.
  if (!onlyUserId && !onlyEmail && !fixture && !isRegen && edition !== "assessment" && userIds.length > 1 && body.fanout !== false) {
    const have = await admin.from("daily_briefs").select("user_id, gen_version, generated_at, model").eq("brief_date", briefDate).eq("edition", edition).in("user_id", userIds);
    const byU = new Map(((have.error ? [] : have.data ?? []) as { user_id: string; gen_version: number | null; generated_at: string | null; model: string | null }[]).map((r) => [r.user_id, r]));
    let fanned = 0;
    for (const uid of userIds) {
      const h = byU.get(uid);
      const fresh = !!h && Number(h.gen_version ?? 0) >= GEN_VERSION && !String(h.model ?? "").includes("compact");
      const young = !!h && Date.now() - +new Date(String(h.generated_at ?? 0)) < 15 * 60000;
      if (fresh || young || fanned >= 12) continue;
      fanned++;
      await handOff("daily-brief", { user_id: uid, edition, ...(noAudio ? { noAudio: true } : {}), ...(force ? { force: true } : {}) });
    }
    return json({ ok: true, users: userIds.length, fannedOut: fanned, briefDate, edition, ...(dispatched ? { regenerating: dispatched } : {}), ...(renarrated ? { renarrated } : {}) });
  }
  userIds = userIds.slice(0, 10);

  let wrote = 0;
  let superseded = false;
  const errors: string[] = [];
  for (const uid of userIds) {
    SOURCES = [];
    TRACE = Deno.env.get("BRIEF_TRACE") === "1" ? [] : null; TRACE_LAST = new Map();
    const tStart = Date.now();
    const elapsed = () => (Date.now() - tStart) / 1000;
    try {
      const rows = byUser.get(uid)!;
      const usd = (v: number, c: string) => v / (fxMap.get(c) ?? 1);
      const assets = rows.filter((r) => r.kind !== "debt");
      const total = assets.reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0);
      if (total < 100) continue;
      // Today's OTHER editions written by an older version are repaired in code (the pass above normally got them)
      if (!isRegen) await repairToday(admin, uid, rows, briefDate, live, await repairCtxOf(uid).catch(() => undefined)).catch(() => null);
      let backfillOnly: Sections | null = null;
      if (!force) {
        const haveQ = (cols: string) => admin.from("daily_briefs").select(cols).eq("user_id", uid).eq("brief_date", briefDate).eq("edition", edition).maybeSingle();
        let haveR = await haveQ("id, model, audio_path, sections, generated_at, gen_version");
        if (haveR.error) haveR = await haveQ("id, model, audio_path, sections, generated_at");   // before migration 39
        const have = haveR.data as { model?: string; audio_path?: string | null; sections?: unknown; generated_at?: string; gen_version?: number | null } | null;
        // A row written by an older daily-brief is rewritten ONCE by the next sweep for the same edition and date
        // (round 3: the day's pre-fix midday, "Microsoft earnings call Sep 28", stayed up all afternoon because
        // a row existed). Only the edition the clock is on, never an assessment, never while its narration may
        // still be running (written in the last 15 minutes), and only when the column exists to record the rewrite.
        const outdated = !!have && !haveR.error && Number(have.gen_version ?? 0) < GEN_VERSION && edition !== "assessment"
          && Date.now() - +new Date(String(have.generated_at ?? 0)) > 15 * 60000;
        if (have && outdated) { /* fall through: regenerate below */ }
        else if (have && !String(have.model ?? "").includes("compact")) {
          // self-heal: the text exists but narration is missing -> regenerate audio only
          if (!fixture && !noAudio && !have.audio_path && validSections(have.sections)) backfillOnly = have.sections as Sections;
          else continue;
        }
      }
      const READER = readerBlock(invBy.get(uid));
      // Round 6 decision: the ASSESSMENT loosens the beginner squeeze (20-word sentences, well-known names such as
      // S&P 500 / ETF / P/E allowed if explained once). gpt-oss dropped words to fit 14-word sentences and the
      // acronym bans ("has sheet", "Standard Poor's 500", "38% tilt and fee gone"). Daily editions keep the old rule.
      const READER_A = assessmentReader(READER);
      // a 30-word note and a 14-word-sentence rule for beginners contradict each other; for those readers the
      // note is TWO short sentences, so both rules can hold at once
      const beginner = ["novice", "intermediate"].includes(topLevel(toArr((invBy.get(uid) as Investor | null | undefined)?.level, ["novice"])));
      const noteSplit = beginner ? " Write the note as TWO sentences of at most 14 words each (about 20 to 26 words in total), never one long sentence and never a single short one." : "";
      const [HZ1, HZ2] = HZ_LABELS[longestHz(toArr((invBy.get(uid) as Investor | null | undefined)?.horizon, ["3-10y"]))] ?? HZ_LABELS["3-10y"];
      if (krEdition && !assets.some((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ"))) continue;   // no Korean sleeve, no Korea edition
      const holdings = assets.filter((r) => !r.symbol.startsWith("$"))
        .sort((a, b) => usd(Number(b.value ?? 0), b.currency) - usd(Number(a.value ?? 0), a.currency));
      const korean = booksKorean(rows);
      // headlines are judged again at read time (rows stored before news-sync's gate still hold option chains
      // and stories about other companies): these are the names that make a story about each holding
      const akaOf = (sy: string) => { const h = holdings.find((x) => x.symbol === sy); return aliasesFor(sy, h?.name); };
      // Every figure carries its label: POSITION VALUE (the whole holding) apart from SHARE PRICE (one share),
      // and every day move stamped with the session it belongs to, in every edition. A morning brief written
      // 31 minutes after the open called Microsoft's live +3.7% "yesterday" (2026-09-25); on a Korea edition the
      // same tag keeps "AMD rose 2.5%" from reading as live.
      // DIVIDENDS, keyed by symbol (round 4 newcomer, an income investor, was told nothing about SCHD's payouts)
      const divRows = await dividendRows(admin, holdings.map((r) => r.symbol));
      const divData = holdings.map((r) => ({ r, d: r.kind === "crypto" || /-USD$/.test(r.symbol) ? { line: `${krName(r.symbol, r.nickname, r.name)}: a coin, pays no dividend`, amounts: [] as number[], annual: 0, current: false } : dividendLine(krName(r.symbol, r.nickname, r.name), divRows.get(r.symbol), Number(r.qty ?? 0), r.currency ?? "USD", fxMap.get(r.currency ?? "USD") ?? 1) }));
      const divIncome = divData.reduce((a, x) => a + x.d.annual, 0);
      const divBlock = divData.some((x) => x.d.amounts.length)
        ? `DIVIDENDS (per holding; the ONLY dividend figures you may state):\n${divData.filter((x) => x.d.amounts.length).map((x) => "- " + x.d.line).join("\n")}\nPortfolio dividend income ≈ $${Math.round(divIncome).toLocaleString("en-US")} a year (${(divIncome / total * 100).toFixed(2)}% of assets).`
        : "DIVIDENDS: none of the holdings pays a dividend on record.";
      const divFacts = divData.map((x) => ({ names: [krName(x.r.symbol, x.r.nickname, x.r.name), ...aliasesFor(x.r.symbol, x.r.name)], amounts: x.d.amounts }));
      const statsLines0 = rows.map((r) => {
        const v = usd(Number(r.value ?? 0), r.currency);
        const nm = krName(r.symbol, r.nickname, r.name);
        if (r.kind === "debt") return `${nm}: debt owed $${Math.round(v)}`;
        if (r.symbol.startsWith("$") || r.kind === "cash") return `${nm}: cash balance $${Math.round(v)} (${(v / total * 100).toFixed(1)}% of assets)`;
        const px = r.price === null || r.price === undefined ? null : usd(Number(r.price), r.currency);
        const pxT = px === null ? "n/a" : "$" + (px >= 1000 ? Math.round(px).toLocaleString("en-US") : px.toFixed(2));
        const chg = r.change_pct === null ? "n/a" : (Number(r.change_pct) >= 0 ? "+" : "") + Number(r.change_pct).toFixed(1) + "%";
        return `${nm}: position value $${Math.round(v)} (${(v / total * 100).toFixed(1)}% of assets), share price ${pxT}, day ${chg} [${dayTag(marketOf(r.symbol, r.kind, r.currency))}], total G/L $${Math.round(usd(Number(r.total_gl ?? 0), r.currency))}`;
      }).join("\n");
      // EXPOSURE by type, computed in code (round 5: a lede called VOO's 46.4% "US equity exposure"; US equity was
      // VOO + AAPL + KO = 69.2%). Every stated exposure figure is checked against these.
      const shareOf = (pred: (r: (typeof assets)[number]) => boolean) => assets.filter(pred).reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / total * 100;
      const isCash = (r: (typeof assets)[number]) => r.symbol.startsWith("$") || r.kind === "cash";
      const isCrypto = (r: (typeof assets)[number]) => r.kind === "crypto" || r.symbol.endsWith("-USD");
      const isKr = (r: (typeof assets)[number]) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ");
      const isBond = (r: (typeof assets)[number]) => themeOf(r.symbol, r.kind) === "bonds";
      const exposure: Exposure = {
        usEquity: Number(shareOf((r) => !isCash(r) && !isCrypto(r) && !isKr(r) && !isBond(r)).toFixed(1)), krEquity: Number(shareOf(isKr).toFixed(1)),
        crypto: Number(shareOf(isCrypto).toFixed(1)), bonds: Number(shareOf(isBond).toFixed(1)), cash: Number(shareOf(isCash).toFixed(1)),
      };
      const exposureLine = `EXPOSURE BY TYPE (share of total assets; the ONLY exposure figures you may state): US stocks and stock funds ${exposure.usEquity}%, Korean stocks ${exposure.krEquity}%, bonds ${exposure.bonds}%, crypto ${exposure.crypto}%, cash ${exposure.cash}%.`;
      const statsLines = `${statsLines0}\n${divBlock}\n${exposureLine}`;
      const marketLines = marketLinesFor(korean), mktLive = mktLiveFor(korean);
      // A morning edition that starts after the bell (a late cron, a retry through an API wave) is an OPENING
      // READ: its US day figures are today's early moves, and it says so, never "yesterday".
      const usNow = marketState("US");
      const openingRead = edition === "morning" && usNow.phase === "open";

      // deterministic earnings dates, the ONLY ones the model may use: the last REPORT date from SEC filings (an
      // 8-K with item 2.02, or the 8-K filed with the 10-Q/10-K), else an earnings-call transcript, never a
      // conference talk; next = last + ~91 days, labelled as an estimate. The old estimate ran from the newest
      // transcript of any kind, so Nvidia's Sep 10 Goldman Sachs talk became "last call" and every brief said
      // "profit report around December 10" (it reported Aug 26; next is about Nov 25).
      const earnSyms = holdings.slice(0, 8).map((r) => r.symbol);
      const [{ data: trDates }, { data: filDates }] = await Promise.all([
        admin.from("transcripts").select("symbol, title, published_at").in("symbol", earnSyms).order("published_at", { ascending: false }).limit(60),
        earningsFilings(admin, earnSyms).then((data) => ({ data })),
      ]);
      const nextEarn = earnSyms.map((sy) => {
        const h = holdings.find((x) => x.symbol === sy)!;
        return earningsLine(krName(sy, h.nickname, h.name), ((filDates ?? []) as (FilingLite & { symbol: string })[]).filter((f) => f.symbol === sy),
          (trDates ?? []).filter((t) => t.symbol === sy), briefDate);
      }).filter(Boolean);
      const earnLine = nextEarn.length ? "\n" + nextEarn.map((x) => "- " + x).join("\n") : "(none on file)";
      // the same estimates as data, so a calendar or watch item that dates a holding's report elsewhere is dropped
      const earnEsts = holdings.map((h) => {
        const e = earnSyms.includes(h.symbol) ? earningsEstimate(((filDates ?? []) as (FilingLite & { symbol: string })[]).filter((f) => f.symbol === h.symbol), (trDates ?? []).filter((t) => t.symbol === h.symbol), briefDate) : null;
        return { names: [krName(h.symbol, h.nickname, h.name), ...aliasesFor(h.symbol, h.name)], est: e?.est ?? null, ...(e?.range ? { range: e.range } : {}) };
      });
      const dateLaw = `TODAY is ${briefDate}. Anything dated before today is the PAST and must NOT appear in calendar or watch. Earnings dates may come ONLY from NEXT EARNINGS ESTIMATES: a "last reported" date is history, and a next date is an ESTIMATE: in prose say "expected around late November", in calendar write it as "~Nov 25 (est)"; never state an estimate as a confirmed day and never invent a date.`;
      const krHeldAny = holdings.some((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ"));
      const sessionLaw = `SESSIONS (deterministic; obey over any instinct):\n${sessionLine("US")}${krHeldAny ? "\n" + sessionLine("KR") : ""}\nDAY-CHANGE LAW: a holding's "day" figure belongs to ITS market's session above. Only a market that is OPEN or closed under 3 hours ago is today's tape. Anything older is past tense with the session named ("in Friday's Korean session"), mentioned at most once, and never in the lede unless it moved over 3% or has fresh news. Never add a "today" gain or loss across markets whose sessions ended more than 3 hours apart: keep them apart ("US names +$X in today's session; the Korean names were flat in Friday's").`;

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
      // a watch with no usable date falls back to that holding's own tripwire, never a placeholder (round 6: "What
      // would change it: No confirmed date yet")
      // A risk sentence for a note, from that holding's memo (round 6 trace: the old clause came out as "valuation is
      // extreme and ... story. Profitable." (a sentence end inside the segment) and "s&P 500 tech weight above 40% or
      // VOO expense ratio above." (lower-cased, then a hard 8-word slice)). Whole clauses only, each inside its own
      // sentence, 3-14 words, case kept, and never one that repeats the watch printed under the note.
      const RISKY = /\b(risk|below|declin|slow|cut|weak|loss|debt|leverage|competit|dependen|concentrat|regulat|cyclical|volatil|stretched|expensive|valuation|uncertain|pressure|margin (compression|squeeze)|dilut|custody|export|top-heavy|extreme|overstat|undercut|no cash flows?|selling)\w*/i;
      const memoRisk = (name: string, watch: string, note = ""): string => {
        const m = memosOut.find((x) => String(x.name).toLowerCase() === name.toLowerCase() || String(x.symbol).toLowerCase() === name.toLowerCase());
        const clauses = splitSentences(String(m?.quality ?? "")).flatMap((sen) => sen.split(/;\s*|,?\s+\bbut\b\s+|,?\s+\byet\b\s+|,?\s+\bthough\b\s+|,?\s+\bwhile\b\s+/i))
          .flatMap((c) => RISKY.test(c) && c.split(/\s+/).length > 14 ? c.split(/,\s*|\s+and\s+/) : [c])
          .map((c) => c.trim().replace(/[.\s]+$/, "")).filter((c) => { const n = c.split(/\s+/).length; return n >= 3 && n <= 14 && RISKY.test(c); });
        const trip = String(m?.tripwire ?? "").trim().replace(/[.\s]+$/, "");
        const phrase = [...clauses.reverse(), ...(trip && trip.split(/\s+/).length <= 16 ? [trip] : [])].find((c) => c && overlap(c, watch) < 0.7 && !note.toLowerCase().includes(c.toLowerCase().slice(0, 24))) ?? "";   // nor one the note already says
        if (!phrase) return "";
        // a lead word is lowered only when it is an ordinary word: never an acronym, a name, "S&P" or "Nasdaq-100"
        const PROPER = /^(?:[A-Z][A-Z0-9&.-]+|[A-Z][a-z]+-\d+|Nasdaq|Treasury|Fed|US|U\.S\.|AI|S&P|Nvidia|Palantir|Apple|Microsoft|Google|Alphabet|Amazon|Meta|Tesla|Vanguard|Invesco|Bitcoin|Ethereum|Ether)\b/;
        const names = [name, String(m?.name ?? ""), String(m?.symbol ?? "")].filter(Boolean);
        // only an ordinary opening word is lowered (round 7: "december quarter", "siri settlement")
        const firstWord = phrase.split(/\s+/)[0] ?? "";
        const ordinary = /^(?:[A-Z][a-z]+)$/.test(firstWord) && !/^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Siri|Azure|Copilot|Windows|Office|Android|Google|Apple|Amazon|Tesla|Samsung|Bitcoin|Ethereum|Vanguard|Schwab|Chinese|China|Korean|Korea|European|Europe|US|American)$/.test(firstWord);
        const lead = PROPER.test(phrase) || names.some((n) => phrase.startsWith(n)) || !ordinary ? phrase : phrase[0].toLowerCase() + phrase.slice(1);
        return `The risk: ${lead}.`;
      };
      const watchFallback = (name: string): string => {
        const m = memosOut.find((x) => String(x.name).toLowerCase() === name.toLowerCase() || String(x.symbol).toLowerCase() === name.toLowerCase());
        const trip = String(m?.tripwire ?? "").trim().replace(/[.\s]+$/, "");
        return trip && trip.split(/\s+/).length <= 14 && !datesIn(trip, briefDate).length ? trip : "No confirmed date yet";
      };
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
        const memoTargets = holdings.slice(0, 6);   // round 7: the read covers up to 6 holdings, each needs its memo
        const perf: string[] = [];
        const memos = await Promise.all(memoTargets.map(async (r) => {
          try {
            const dispN = krName(r.symbol, r.nickname, r.name);
            const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
            const [{ data: news }, { data: fils }, { data: tr }, hist, { data: ins }] = await Promise.all([
              admin.from("news").select("title,url,source,summary,published_at").eq("symbol", r.symbol).gte("published_at", since14).order("published_at", { ascending: false }).limit(16)
                .then((q) => ({ data: (q.data ?? []).filter((n) => usableNews(n, aliasesFor(r.symbol, r.name))).slice(0, 8) })),
              admin.from("filings").select("form,filed_at").eq("symbol", r.symbol).order("filed_at", { ascending: false }).limit(4),
              admin.from("transcripts").select("title,content,published_at").eq("symbol", r.symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(1),
              windowsText(admin, r.symbol, [30, 365], marketOf(r.symbol, r.kind, r.currency)),
              admin.from("insights").select("bullets").eq("symbol", r.symbol).order("generated_at", { ascending: false }).limit(1),
            ]);
            perf.push(`${dispN} 30d ${hist[30]}, 1y ${hist[365]}`);
            const memoPrompt = `Quality memo on ${dispN} (${r.symbol}), ${w(r).toFixed(1)}% of a private investor's assets. Performance: 30d ${hist[30]}, 1y ${hist[365]} ("not enough price history yet" means no figure exists: never estimate one).
${tr?.[0] ? `Latest earnings call ("${String(tr[0].title).slice(0, 100)}", ${String(tr[0].published_at).slice(0, 10)}, ${callAgeLine(tr[0].published_at, briefDate)}):\n${String(tr[0].content).slice(0, 4000)}` : "No earnings call on file."}
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
${divBlock}
${exposureLine}
THEME EXPOSURE (deterministic): ${themeLine}
GEOGRAPHY (share of total assets; cash and debt excluded, so it sums to the invested share): ${geoLine}
PERFORMANCE (30d = trailing 30 days, 1y = trailing 12 months; never call either "YTD"): ${perfLine}
NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}

QUALITY MEMOS:
${memosOut.slice(0, 6).map((m) => `- ${m.name}: business: ${m.business}. quality: ${m.quality}. role: ${m.role}. long case: ${m.long_case}. tripwire: ${m.tripwire}. near: ${m.near}`).join("\n")}
STRUCTURE FACT (deterministic): ${skStructure || "none"}
GAPS (deterministic hints; refine with judgment): ${skMissing || "none"}`;
        const styles = toArr((invBy.get(uid) as Investor | null | undefined)?.styles, ["value"]);
        const incomeLens = styles.some((x) => x === "income" || x === "value" || x === "index");
        const shapeA = `Return STRICT JSON:\n{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "horizon": str, "ideas": [str], "calendar": []}`;
        const editorPrompt = `Write the ${briefDate} PORTFOLIO ASSESSMENT for ONE investor who just put these positions into Assetly. It is a first look at the QUALITY and STRUCTURE of what they own, over the next quarter and the next few years. It is NOT a daily brief: no overnight tape, no day moves, no futures, no session talk.

${dataBlock}

${shapeA}
lede: the verdict on this book in one breath: what kind of bet it is, and the single structural fact that matters most. <= 30 words.
overnight: YOUR BOOK: what they own. Total, the top holdings BY NAME with their weights, the concentration figure, the theme and geography mix, and cash or debt if present. At least THREE numbers copied from PORTFOLIO or THEME EXPOSURE, quoted EXACTLY as given: never add themes together into a new percentage, never relabel a theme (MARA-style miners and MSTR are "crypto beta" equities, not "crypto"); never state the same weight twice (if a theme is one holding, name it once). Three or four short sentences, none over 20 words. No performance figures here (they belong in the notes). <= 60 words.
positions: EVERY equity, fund, or crypto holding, largest first (the 6 largest when the book has more than 6), so the quality read covers the whole portfolio; every such holding above 20% of assets MUST appear; cash and debt are NEVER positions (they belong in YOUR BOOK and STRUCTURE only). note 28-38 words of flowing prose: what the business is, the quality verdict (for a company: moat, growth, balance sheet; for a fund: what it holds, concentration, cost; for a coin: adoption, supply, custody), and its role in this book; a strength AND a risk or condition, written as sentences, NEVER as "Strength:" / "Risk:" labels: the LAST sentence of every note must be the risk, and must start with "The risk:" or "But" (never a positive clause after "while"); at most two numbers, from the data only, and NEVER state a holding's size twice: give its WEIGHT (25.6% of book) or its DOLLAR VALUE ($5,900), never both, because they are one fact and the weight is the more useful half. If the note also carries a threshold, that threshold is one of the two. watch 5-10 words, no padding words: the thesis TRIPWIRE, MEASURABLE (a metric with a threshold, a guidance item, or a dated event); vague words like "significantly", "sharply", "weakens" are forbidden; NEVER verbs like monitor, watch, track, keep an eye.
desk_view: STRUCTURE, exactly two or three sentences. Sentence 1: the ONE concentration, correlation, currency or leverage fact that most shapes this book, with its percentage from the data - a single fact, NEVER a list of holdings with their moves. THE WHOLE desk_view MAY CONTAIN AT MOST THREE FIGURES: one weight in sentence 1 and at most two more anywhere after it. Naming several holdings with a percentage each is the laundry list this section exists to replace; say "the rest is spread across five smaller positions" instead of listing them. Sentence 2 MUST start with "This means" and say what that structure does FOR them: if the concentration fits their stated risk appetite, style and target, name the upside it is buying (the exposure they wanted, the compounding it allows, the cost it avoids); if it does not fit, name what it has delivered for them so far. Sentence 3 (optional): the single condition that would turn it into a problem. No performance figures here (they belong in the notes), no list of returns, no single-day numbers. <= 50 words. Never invent a hypothetical loss or drawdown percentage.
horizon: exactly two labeled clauses in this shape: "${HZ1}: ... ${HZ2}: ..." The first names what actually decides the ${HZ1.toLowerCase()} for THIS book (a print, a cycle, a macro number); any date you write must be AFTER today and come from NEXT EARNINGS ESTIMATES, otherwise say "the next earnings print" without a date. The second names what must be true over the ${HZ2.toLowerCase()} for this book to deliver. 36-46 words total.
ideas: 2-3 items, <= 14 words each, each about a GAP in this book (not about the names already held): name the gap, then the specific theme or instrument type worth researching to fill it (shape: "<the gap in THIS book>: <an instrument type worth researching>"; the gap must be TRUE of this book: never "All-US" when it holds any non-US stock, never an income or dividend gap when it holds a dividend or income fund, never a category it already holds). The gaps must fit THIS reader's lens and purpose (READER PROFILE)${incomeLens ? "" : `: this reader invests for growth, so never propose dividend, income or bond products; a missing asset class may be named only as a diversification FACT ("No bond or international exposure: one driver moves everything"), never as a product to research`}. Never write a return target or goal as a figure. Never start with Add, Buy, Consider, or Allocate (write "<gap>: <instrument type>"; after the colon name the instrument type directly, never a verb); never a price target.
LENGTH TARGET: ${holdings.length <= 2 ? `220-320 words in total. This book has only ${holdings.length} holding${holdings.length > 1 ? "s" : ""}: give each note a deeper quality read of 36-48 words, and use the full budgets for the book, structure and horizon.` : (holdings.length > 4 ? "340-460 words in total, a three-minute read." : "280-360 words in total, a two-minute read.")} Use the budget: lede 18-28 words, book 34-48, ${holdings.length <= 2 ? "each note 36-48" : holdings.length > 4 ? "each note 24-32" : "each note 28-38"}, structure 32-44, horizon 32-42, each idea 8-13. Shorter than the floors reads thin; longer than the caps gets cut.
ADVICE LAW: never tell them to buy, sell, trim, add, or take profits. You describe, you judge quality, you point at what to research.
HORIZON LAW: forbidden words and phrases: today, tonight, overnight, yesterday, this morning, premarket, after-hours, after market close, at the bell, futures, session, intraday. Timeframes are weeks, months, quarters, years.
BALANCE LAW: the book's strengths and its risks both get real words; no hype, no doom.
SENTENCE LAW: short sentences everywhere, at most 22 words each; split any list of holdings or numbers into two sentences.
${STYLE_RULES}\n${READER_A}`;
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
${memosOut.slice(0, 6).map((m) => `- ${m.name}: ${m.business}. ${m.quality}. tripwire: ${m.tripwire}`).join("\n")}
${shapeA}
lede 20-30 words (the verdict on this book); overnight 40-60 words naming the top holdings with weights and the concentration figure (>= 3 numbers from the data); 2-6 positions largest first (every holding, up to 6), note 26-34 words of prose with a strength and a risk (no "Strength:" labels), watch <= 12 words naming a MEASURABLE tripwire (a metric with a threshold or a dated event; NEVER monitor/watch/track, never "significantly"); desk_view 36-50 words on concentration or correlation with its percentage, no invented loss figures; horizon "${HZ1}: ... ${HZ2}: ..." 36-50 words; ideas: 2-3 gaps worth researching, 8-14 words each, never buy or sell instructions. Aim for 340 words in total. Forbidden words: today, overnight, yesterday, session, futures. A total G/L figure may only be phrased as "up/down $X since purchase", never as a move or a delivery. No filler, no em dashes, Korean companies by name, won as ₩.\n${READER_A}`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compact, 8000, Math.max(20000, Math.min(30000, (146 - elapsed()) * 1000)), FAST_MODEL);
          if (draft && validAssessment(draft)) usedCompact = true;
        }
        if (!draft || !validAssessment(draft)) { errors.push(uid.slice(0, 8) + ": assessment editor failed [" + meta1 + " | " + lastMeta + "]"); continue; }
        snap("editor draft (MODEL)", draft);
        // BALANCE LAW guaranteed in code: a note with no risk clause gets the memo's own risk (from its quality verdict, else its tripwire)
        const RISK = /\b(but|though|although|yet|risk|risks|however|unless|could|downside|threat|pressure|stretched|uncertain|concern|exposed|depends|if)\b/i;
        const NEG = /\b(risk|below|declin|slow|cut|weak|loss|debt|leverage|competit|dependen|concentrat|regulat|cyclical|volatil|stretched|expensive|valuation|uncertain|pressure|margin (compression|squeeze)|dilut|custody|export)\w*/i;
        const ensureRisk = (o: Sections): Sections => ({ ...o, positions: o.positions.map((p) => {
          if (RISK.test(p.note)) return p;
          const risk = memoRisk(p.name, p.watch, p.note);
          return risk ? { ...p, note: p.note.replace(/[.\s]+$/, "") + ` ${risk}` } : p;
        }) });
        draft = ensureRisk(draft as Sections);   // before the fact-check, so a lengthened note gets tightened to its cap
        snap("ensureRisk (draft)", draft);
        const checked = elapsed() > 112 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims. Think briefly.",
          `Draft assessment:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\n${bookLine}\n${structLines}\n${divBlock}\nTHEME EXPOSURE: ${themeLine}\nGEOGRAPHY: ${geoLine}\nPERFORMANCE: ${perfLine}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape (keep horizon and ideas). FIGURES STAY DIGITS exactly as the draft writes them ("40%", never "forty percent"; "0.03%", never "zero point three"). DIVIDENDS: never add a dividend statement the draft does not make; a dividend statement that contradicts DIVIDENDS above is corrected from it (a holding listed there DOES pay one). Fix any number that contradicts the data; delete any claim you cannot trace to it; if a position note has no risk or condition, append one short clause taken from that memo's quality or tripwire; enforce the word caps (lede 30, overnight 60, note ${holdings.length <= 2 ? 56 : 38}, watch 12, desk_view 50, horizon 50, each idea 14) by tightening, not by losing substance, and never shorten a section that is already within its cap. Also: in desk_view delete any hypothetical loss or drawdown percentage (only weights and performance figures from the data may appear); rewrite any "Strength:" / "Risk:" labels into prose; replace any vague watch ("drops significantly", "weakens") with a measurable threshold or dated event from the memos, or the memo's own tripwire; delete any sentence containing today, tonight, overnight, yesterday, this morning, premarket, after-hours, after market close, at the bell, futures, session, or intraday; delete any instruction to buy, sell, trim, add, or take profits, and rewrite any idea that starts with Add/Buy/Consider adding as a research gap; horizon must keep the literal labels "${HZ1}:" and "${HZ2}:"; replace any numeric KRX code with the company name; write won as ₩ never "KRW"; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains. Finally enforce the reader profile below, especially its vocabulary rules (for a beginner, replace every banned acronym with its plain phrase everywhere, watch items included).\n${READER_A}`, 8000, 30000, FAST_MODEL);
        sections = (checked && validAssessment(checked)) ? mergeChecked(draft as Sections, checked as Sections, [bookLine, structLines, divBlock, themeLine, geoLine, perfLine].join("\n")) : draft as Sections;
        snap("fact-checker (MODEL, merged field by field)", sections);
        // LENGTH floor guaranteed by a pass AFTER the fact-check (so the checker cannot shrink it back): elaborate, never add numbers or claims
        const wcA = (o: Sections) => [o.lede, o.overnight, o.desk_view, o.horizon ?? "", ...(o.ideas ?? []), ...o.positions.flatMap((p) => [p.name, p.note, p.watch])].join(" ").split(/\s+/).filter(Boolean).length;
        const floor = holdings.length <= 2 ? 200 : 250;
        for (let ga = 0; ga < 2 && wcA(sections) < floor && elapsed() < 118; ga++) {
          const grown = await askModel(key, "You are the editor. Keep every fact and number exactly as given; add depth, not new claims.",
            `This assessment is too thin at ${wcA(sections)} words; it must reach ${floor + 25}-360 words. Expand it toward these floors WITHOUT adding any number, number-word, or new factual claim that is not already in it: keep every existing number verbatim, never describe a hypothetical loss or drawdown; elaborate on what the existing facts mean for the owner (shared drivers, what must hold, what the tripwires signal): each position note ${holdings.length <= 2 ? "38-46" : "28-38"} words (business, quality verdict, role, ending with the risk sentence), desk_view 34-42 words, horizon 34-40 words ("${HZ1}: ... ${HZ2}: ..."), overnight 48-58 words. Keep lede, watch items and ideas as they are. Keep every figure in digits ("40%", never "forty percent"), and add no dividend statement. Sentences of at most 22 words. Never use the words today, overnight, yesterday, session, futures. Never em dashes.\n${READER_A}\n\n${JSON.stringify(sections)}\n\nReturn the SAME JSON shape.`, 8000, 25000, FAST_MODEL);
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
            const noteCapX = holdings.length <= 2 ? 55 : 40;
            const withinCaps = wcS(g.overnight) <= 60 && wcS(g.desk_view) <= 50 && wcS(g.horizon ?? "") <= 50 && g.positions.every((p) => wcS(p.note) <= noteCapX && wcS(p.watch) <= 12);
            if (kept && noNew && !lossy && withinCaps) sections = ensureRisk(g);
          }
        }
        snap("expansion (MODEL)", sections);
        // STRUCTURE must say what the fact MEANS (guaranteed in code): a bare data dump gets the deterministic consequence sentence
        const MEANS = /\b(means|meaning|implies|leaves|makes|exposes|depends|lockstep|same driver|shared driver|single point|one bet|at once|together|amplif\w*|so the book|which is why)\b/i;
        if (!MEANS.test(sections.desk_view) && topTheme) {
          const wcD = (t: string) => t.split(/\s+/).filter(Boolean).length;
          const consequence = `This means ${topTheme[1].names.slice(0, 3).join(", ")} rise and fall on the same driver, so ${topTheme[1].pct.toFixed(1)}% of the book moves at once.`;
          let base = sections.desk_view.trim().replace(/\s*(recent )?(30|1)[- ]?(day|year) returns?:[^.]*\.?/gi, "").trim();   // returns belong in the notes
          while (wcD(base) + wcD(consequence) > 50 && /[.!?]\s+[^.!?]+[.!?]?$/.test(base)) base = base.replace(/\s+[^.!?]+[.!?]?$/, "").trim();
          sections.desk_view = `${base} ${consequence}`.trim();
        }
        // round 8 newcomer: STRUCTURE left out a 24.6% single-stock NVDA position. The largest single STOCK over 15% of assets
        // is always named in it (a fund is diversified inside; a stock is not)
        {
          const big = holdings.filter((r) => r.kind === "stock" || r.kind === "equity").map((r) => ({ r, w: w(r) })).sort((a, b) => b.w - a.w)[0];
          const nm = big ? krName(big.r.symbol, big.r.nickname, big.r.name) : "";
          if (big && big.w > 15 && ![nm, big.r.symbol, ...aliasesFor(big.r.symbol, big.r.name)].some((n) => n && sections!.desk_view.includes(n))) {
            sections.desk_view = `${sections.desk_view.trim().replace(/[.\s]*$/, ".")} ${nm} alone is ${big.w.toFixed(1)}% of assets, the largest single-stock position.`;
          }
        }
        // STRUCTURE must carry its percentage (guaranteed in code): a desk_view that lost it gets the deterministic structure fact up front
        if (!/\d+(?:\.\d+)?\s?%/.test(sections.desk_view) && skStructure) {
          const wcS2 = (t: string) => t.split(/\s+/).filter(Boolean).length;
          let rest = sections.desk_view.trim();
          while (wcS2(skStructure) + wcS2(rest) > 50 && /[.!?]\s+[^.!?]+[.!?]?$/.test(rest)) rest = rest.replace(/\s+[^.!?]+[.!?]?$/, "").trim();   // drop trailing sentences to fit
          if (wcS2(skStructure) + wcS2(rest) > 50) rest = rest.split(/\s+/).slice(0, Math.max(0, 50 - wcS2(skStructure))).join(" ").replace(/[,;:]?$/, ".");   // last resort: a hard cut
          sections.desk_view = `${skStructure} ${rest}`.trim();
        }
        snap("structure guarantees", sections);
        // section caps guaranteed in code: trailing sentences go first, a hard cut only as the last resort
        sections.lede = fitCap(sections.lede, 30);
        sections.overnight = fitCap(sections.overnight, 52);
        sections.desk_view = fitCap(sections.desk_view, 48);
        sections.horizon = fitCap(sections.horizon ?? "", 46, /next [^:]{1,14}:[\s\S]*next [^:]{1,14}:/i);   // the spec the battery enforces
        // notes were the one field with no deterministic cap, so the beginner two-sentence rule could push
        // them past the length the brief is specified for
        // the writers are told "note <= 34 words": a 33-word cap cut every compliant note (round 6 trace)
        const noteWordCap = holdings.length <= 2 ? 56 : 40;
        sections.positions = sections.positions.map((p) => ({ ...p, note: capNoteKeepRisk(p.note, noteWordCap, fitCap) }));
        snap("fitCap (first)", sections);
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
        snap("deFill", sections);
        // horizon law, guaranteed in code for the two words the fast model still slips in
        const deTape = (t: string) => t.replace(/\btoday's\b/gi, "current").replace(/\btoday\b/gi, "now").replace(/\btonight\b/gi, "soon");
        sections.lede = deTape(sections.lede); sections.overnight = deTape(sections.overnight); sections.desk_view = deTape(sections.desk_view);
        sections.horizon = deTape(sections.horizon ?? ""); sections.positions = sections.positions.map((p) => ({ ...p, note: deTape(p.note), watch: deTape(p.watch) }));
        sections.ideas = (sections.ideas ?? []).map(deTape);   // ideas were the one field the tape scrub missed
        snap("deTape", sections);
        // ideas are research gaps, never instructions (guaranteed in code): strip a leading Add/Buy/Consider/Allocate
        const VERB = /(add|buy|consider|allocate|explore|introduce|include|hold|own|put|use|pair|layer)(ing)?\s+(adding\s+|an?\s+|some\s+|the\s+)?/i;
        sections.ideas = sections.ideas.map((x) => {
          let y = x.replace(new RegExp("^" + VERB.source, "i"), "").trim();
          y = y.replace(new RegExp("(:\\s*)" + VERB.source, "i"), "$1");   // "...: add a global index fund" -> "...: global index fund"
          return y ? y[0].toUpperCase() + y.slice(1) : x;
        });
        snap("ideas verb strip", sections);
        sections = ensureRisk(sections);
        snap("ensureRisk", sections);
        // note cap guaranteed in code: an over-long note loses its second sentence if a risk clause survives
        const noteCapF = holdings.length <= 2 ? 56 : 40;
        sections.positions = sections.positions.map((p) => {
          const wcN = (t: string) => t.split(/\s+/).filter(Boolean).length;
          if (wcN(p.note) <= noteCapF) return p;
          const sents = splitSentences(p.note);
          if (sents.length >= 3) {
            const trimmed = [sents[0], ...sents.slice(2)].join(" ");
            if (RISK.test(trimmed) && wcN(trimmed) >= 22 && wcN(trimmed) <= noteCapF) return { ...p, note: trimmed };
          }
          // two long sentences: keep the first (business + quality) and let ensureRisk re-attach a short risk clause
          if (sents.length >= 2 && wcN(sents[0]) <= noteCapF - 9 && wcN(sents[0]) >= 14) return { ...p, note: sents[0] };
          const cutN = p.note.split(/\s+/).slice(0, noteCapF - 11).join(" ").replace(/[,;:]?$/, ".");   // room for the re-attached risk clause
          return { ...p, note: cutN };
        });
        snap("note cap", sections);
        sections = ensureRisk(sections);   // re-attach a short risk clause where the trim removed it
        snap("ensureRisk (after note cap)", sections);
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
        snap("watch cleanup / cash filter", sections);
        if (!sections.positions.length) { errors.push(uid.slice(0, 8) + ": assessment had no equity positions"); continue; }
      } else if (edition === "weekend") {
        // ---- WEEKEND / HOLIDAY READ: no US session today. Direction and developments, never a tape. ----
        const krHeldW = holdings.some((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ"));
        const usS = marketState("US"), krS = marketState("KR");
        const sinceClose = new Date(Math.min(usS.lastCloseEpoch, krHeldW ? krS.lastCloseEpoch : usS.lastCloseEpoch)).toISOString();
        const { data: prevWeekend } = await admin.from("daily_briefs").select("generated_at, sections").eq("user_id", uid).eq("edition", "weekend")
          .gte("brief_date", ymdShift(briefDate, -3)).lt("brief_date", briefDate).order("generated_at", { ascending: false }).limit(1).maybeSingle();
        const newsSince = prevWeekend ? String(prevWeekend.generated_at) : sinceClose;
        const { data: newNewsRaw } = await admin.from("news").select("symbol,title,url,source,summary,published_at").in("symbol", holdings.slice(0, 12).map((r) => r.symbol))
          .gte("published_at", newsSince).order("published_at", { ascending: false }).limit(60);
        const newNews = (newNewsRaw ?? []).filter((n) => usableNews(n, akaOf(n.symbol))).slice(0, 40);
        // Sunday's (or a second holiday's) read only earns its place with new information since the previous one
        if (prevWeekend && !force && !(newNews ?? []).length) { errors.push(uid.slice(0, 8) + ": weekend read skipped, nothing new since the last one"); continue; }
        const nameBy = new Map(holdings.map((r) => [r.symbol, krName(r.symbol, r.nickname, r.name)]));
        const weekLines: string[] = [];
        const weekOf = await Promise.all(holdings.slice(0, 10).map((r) => windowsText(admin, r.symbol, [7], marketOf(r.symbol, r.kind, r.currency))));
        holdings.slice(0, 10).forEach((r, i) => weekLines.push(`${nameBy.get(r.symbol)}: week ${weekOf[i][7]}, ${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of assets`));
        const newsLines = (newNews ?? []).slice(0, 24).map((n) => `- ${nameBy.get(n.symbol) ?? n.symbol} [${n.source}, ${String(n.published_at).slice(0, 10)}]: ${String(n.title).slice(0, 110)}`).join("\n");
        // the positions list is decided in code: only companies with something new since the close may appear
        const newsSyms = [...new Set((newNews ?? []).map((n) => n.symbol))].filter((sy) => nameBy.has(sy));
        const eligible = newsSyms.length ? newsSyms.map((sy) => nameBy.get(sy)).join(", ") : `${nameBy.get(holdings[0]?.symbol ?? "") ?? "the largest holding"} only (nothing new anywhere)`;
        const statsNoDay = statsLines.replace(/, day [^,[]*(?:\[[^\]]*\])?/g, "");
        const prevCtx = prevWeekend ? `PREVIOUS READ (never repeat a sentence from it; cover only what is NEW since): lede "${(prevWeekend.sections as Sections).lede}" · direction "${(prevWeekend.sections as Sections).desk_view}"`
          : (prev ? `LAST DAILY NOTE (for continuity): lede "${(prev.sections as { lede?: string })?.lede ?? ""}"` : "");
        const kind = usS.holidayToday ? "HOLIDAY" : "WEEKEND";
        const writerPrompt = `Write the ${briefDate} ${kind} READ (${dayName(briefDate)}) for ONE investor. No market they hold is trading today, so this is NOT a daily note: there is no tape, no "today's move", nothing "this morning". Its job is direction and developments: (1) where the book stands after the week and what it is exposed to going into the next sessions, (2) what actually happened at the companies they own since the last close, (3) the calendar: the next session for every market they hold, any market holiday ahead, and dated events.

SESSIONS (deterministic; obey over any instinct):
${sessionLine("US")}${krHeldW ? "\n" + sessionLine("KR") : ""}

PORTFOLIO (deterministic; the ONLY source of portfolio numbers):
Total assets $${Math.round(total)}.
${statsNoDay}
WEEK MOVES (deterministic; the ONLY move numbers allowed, and they are WEEK numbers):
${weekLines.join("\n") || "- none"}
NEWS SINCE THE LAST CLOSE (${(newNews ?? []).length} items):
${newsLines || "- none: say so plainly and lean on structure and the calendar"}
NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}
${prevCtx}

Return STRICT JSON:
{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": [str]}
lede: the one thing this ${kind.toLowerCase()} changes or confirms about the book, stated as a consequence for the reader. <= 30 words.
overnight: THE WEEK THAT WAS: the book's direction over the week and the two or three holdings that drove it, with their WEEK numbers from WEEK MOVES (never a day number). <= 55 words.
positions: ONLY from this list, 1-4 of them: ${eligible}. Each note <= 32 words that OPENS WITH WHAT IT MEANS for this owner and then gives the NEW fact from NEWS SINCE THE LAST CLOSE (the story, the filing, the call), never a restated week move; watch <= 10 words naming the next concrete event, date or level. A holding not on the list must not appear.
desk_view: DIRECTION into the next sessions: the one structural exposure or catalyst that decides the next five trading days for this book. No single-day numbers. <= 40 words.
calendar: first the next session date for each market they hold (name any market holiday ahead), then up to 2 dated events from NEXT EARNINGS ESTIMATES or dated headlines. <= 10 words each.
FORBIDDEN WORDS: today, tonight, this morning, overnight, live, and any day move presented as current.
${STYLE_RULES}\n${READER}`;
        let draft = await askModel(key, "You are the editor of a one-reader research desk writing the weekend read. Direction and developments, never a tape. Think briefly, then write.", writerPrompt, 16000, 60000);
        if ((!draft || !validSections(draft)) && elapsed() < 100) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Think briefly. Output the exact JSON shape requested.", writerPrompt, 16000, 40000, FAST_MODEL);
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": weekend writer failed [" + lastMeta + "]"); continue; }
        // no session today: the words that only belong to a live tape are removed in code
        const nowWord = kind === "HOLIDAY" ? "over the holiday" : "this weekend";
        const deDay = (t: string) => String(t ?? "").replace(/\btoday's\b/gi, "the latest").replace(/\btoday\b/gi, nowWord).replace(/\btonight\b/gi, "at the next open").replace(/\bthis morning\b/gi, nowWord);
        draft.lede = deDay(draft.lede); draft.overnight = deDay(draft.overnight); draft.desk_view = deDay(draft.desk_view);
        draft.positions = draft.positions.map((p) => ({ ...p, note: deDay(p.note), watch: deDay(p.watch) }));
        sections = draft;
      } else if (edition === "morning") {
        // ---- stage 1: analyst memos, parallel over top holdings ----
        const memoTargets = holdings.slice(0, 5);
        const memos = await Promise.all(memoTargets.map(async (r) => {
          try {
            const dispN = krName(r.symbol, r.nickname, r.name);
            const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
            const [{ data: news }, { data: fils }, { data: tr }, hist] = await Promise.all([
              admin.from("news").select("title,url,source,summary,published_at").eq("symbol", r.symbol).gte("published_at", since14).order("published_at", { ascending: false }).limit(20)
                .then((q) => ({ data: (q.data ?? []).filter((n) => usableNews(n, aliasesFor(r.symbol, r.name))).slice(0, 10) })),
              admin.from("filings").select("form,filed_at").eq("symbol", r.symbol).order("filed_at", { ascending: false }).limit(5),
              admin.from("transcripts").select("title,content,published_at").eq("symbol", r.symbol).order("published_at", { ascending: false, nullsFirst: false }).limit(1),
              windowsText(admin, r.symbol, [30, 365], marketOf(r.symbol, r.kind, r.currency)),
            ]);
            const memoPrompt = `Internal analyst memo on ${dispN} (${r.symbol}) for a portfolio where it is ${(usd(Number(r.value ?? 0), r.currency) / total * 100).toFixed(1)}% of assets. Day ${r.change_pct === null ? "n/a" : Number(r.change_pct).toFixed(1) + "%"} [${dayTag(marketOf(r.symbol, r.kind, r.currency))}], 30d ${hist[30]}, 1y ${hist[365]} ("not enough price history yet" means no figure exists).
${tr?.[0] ? `Latest earnings call ("${String(tr[0].title).slice(0, 100)}", ${String(tr[0].published_at).slice(0, 10)}, ${callAgeLine(tr[0].published_at, briefDate)}):\n${String(tr[0].content).slice(0, 4000)}` : "No earnings call on file."}
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
        const openingLaw = openingRead
          ? `\nOPENING READ: the US market opened ${usNow.minutesIn} minutes ago, so this morning brief is written AFTER the bell. Every US holding's "day" figure is TODAY's early move (write "so far today" or "in early trading"), never "yesterday" and never "overnight". Futures and pre-market framing no longer apply to US names.`
          : "";
        const editorPrompt = `Write today's ${briefDate} morning brief for ONE investor. You are their personal research desk; this is your ${prev ? "ongoing coverage (yesterday's brief below)" : "first note to them"}.${openingLaw}

MARKET: ${marketLines || "(no market data)"}
LEADERS: ${leaderLines || "(none tracked)"}
LEADER HEADLINES (24h):\n${leaderHeads || "- none"}

PORTFOLIO (deterministic; the ONLY source of portfolio numbers):
Total assets $${Math.round(total)}.
${statsLines}
NEXT EARNINGS ESTIMATES (the only allowed earnings dates): ${earnLine}
${dateLaw}
${sessionLaw}

ANALYST MEMOS:
${memosOut.slice(0, 4).map((m) => `- ${m.name}: changed: ${m.changed}. promises: ${m.promise_check}. bull: ${m.bull}. bear: ${m.bear}. watch: ${m.watch}`).join("\n")}
SKEPTIC PUSHBACK:
${pushback.slice(0, 3).map((pb) => `- ${(pb as { name?: string }).name}: ${(pb as { point?: string }).point}`).join("\n") || "- none"}
${prev ? `YESTERDAY'S NOTE (for continuity): lede "${(prev.sections as { lede?: string })?.lede ?? ""}" · desk view "${(prev.sections as { desk_view?: string })?.desk_view ?? ""}"` : ""}

Return STRICT JSON:
{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": [str]}
lede: the ONE thing that matters for THIS portfolio today. <= 2 sentences, <= 34 words. Earn the reader's next 3 minutes.
${EVIDENCE_LAW}
overnight: the tape that touches them. MUST contain at least THREE literal numbers copied from the MARKET line (futures, VIX, index, FX) using their EXACT labels (never call futures "the S&P"; never merge two instruments), then one clause on what it means for their largest exposures BY NAME. <= 55 words.
positions: the 1-4 holdings that EARNED coverage today (news, calls, filings, breaks). Not just the biggest. note <= 32 words with at least one number; incorporate the skeptic where it sharpens. Each note must OPEN WITH WHAT IT MEANS for this holding, never with the move: "Your biggest holding barely moved, which is the point" not "QQQM rose 0.1% today, representing 25.6% of assets". A run of notes that each begin with a price move is the laundry list this brief exists to replace, and the move belongs AFTER the judgement, if at all.${noteSplit} watch <= 10 words and must be a CONCRETE event, date, or level (e.g. "Q3 guidance Sep 4", "HBM pricing at Goldman conf"). NEVER verbs like monitor, watch, track, keep an eye.
desk_view: one STRUCTURAL observation only: valuation, correlation, concentration, or rotation. It may not contain ANY overnight or single-day number; multi-week, valuation, or weight numbers only, and AT MOST THREE figures in total. Builds on yesterday when given. <= 40 words.
calendar: 0-3 items <= 10 words each; EVERY item must carry an explicit FUTURE date (from NEXT EARNINGS ESTIMATES or dated headlines); undated or past items are forbidden.
BANNED PHRASES (never write these or variants): "investors should", "keep an eye", "monitor closely", "time will tell", "stay tuned", "it's important", "as always", "remains to be seen", "worth watching", "demands scrutiny", "warrants attention".
NEVER mention internal process words: "skeptic", "memo", "pushback", "analyst notes". The reader sees only conclusions.
NUMBER STYLE: dollar amounts >= 1,000 rounded to the nearest hundred with commas ($107,300 not $107299); percentages to one decimal; state at most TWO numbers per position note.
RULES: every word must earn its place; no filler, no hedging, no generic advice. Numbers ONLY from the data above; if a number is not in the data, it does not exist. Korean companies by NAME with won as ₩ (never the letters KRW before a number). Never numeric KRX codes. Never use em dashes or semicolons. Opinionated but honest.
BLUF LAW: every section opens with its CONCLUSION first; never a chain of ticker-and-percent moves. NUMBER DIET: one number per point, never more than three per section. OPINION: one confident, fact-backed judgment per section; never hedged into mush. CONSTRUCTIVE FRAME: risks come with what to check or manage next, never bare doom; every section leaves the reader knowing what to DO.\n${READER}`;
        let draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly, then write.", editorPrompt, 24000, 75000);
        const meta1 = lastMeta;
        if ((!draft || !validSections(draft)) && elapsed() < 85) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly. Output the exact JSON shape requested.", editorPrompt, 24000, 45000, FAST_MODEL);
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
lede <= 34 words; overnight <= 55 words with >= 3 market numbers tied to their holdings; 1-3 positions, note <= 32 words with a number, each OPENING WITH WHAT IT MEANS and never with the price move,${noteSplit} watch <= 10 words naming a concrete event (NEVER the words monitor, watch, track, keep an eye); desk_view <= 40 words, structural only: no day moves, no overnight numbers. Banned: investors should, keep an eye, monitor, worth watching, remains to be seen. No filler, no em dashes, Korean companies by name, won as ₩.`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compactPrompt, 12000, Math.max(18000, Math.min(40000, (150 - elapsed()) * 1000)), FAST_MODEL);
          if (draft && validSections(draft)) usedCompact = true;
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": editor failed [" + meta1 + " | " + lastMeta + "]"); continue; }

        // ---- stage 4: fact-check (skipped when the wall clock is tight; scrub still runs) ----
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET: ${marketLines}\nLEADERS: ${leaderLines}\nPORTFOLIO:\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (lede 34, overnight 55, note 32, watch 10, desk_view 40) by tightening, not by losing substance. Also: replace any numeric KRX code (like 005930.KS) with the company name; write won as ₩ never "KRW"; delete any calendar or watch item whose date is before today (${briefDate}) and any undated calendar item; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains; if desk_view recaps today's prices, rewrite it as a structural point; overnight must keep at least three market numbers; delete any instruction to buy, sell, trim, add, reduce, or rotate a position and state the risk or setup instead; delete any figure credited to a company when the headline gives it to an industry, a market or another company (an industry-wide "$200 billion" is never one company's cut), and any claim that a story hits or helps a holding "directly" unless a headline names that holding; a day move tagged LIVE is today's, never "yesterday".`, 10000, 30000);
        sections = (checked && validSections(checked)) ? checked as Sections : draft as Sections;
      } else {
        // ---- intraday editions (midday pulse / closing note): reuse the morning desk work, focus on the live tape ----
        memosOut = Array.isArray(morningRow?.memos) ? (morningRow?.memos as Record<string, unknown>[]) : [];
        if (!memosOut.length) {
          const quick = await Promise.all(holdings.slice(0, 4).map(async (r) => {
            try {
              const dispN = krName(r.symbol, r.nickname, r.name);
              const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
              const { data: newsRaw } = await admin.from("news").select("title,url,source,summary").eq("symbol", r.symbol).gte("published_at", since7).order("published_at", { ascending: false }).limit(12);
              const news = (newsRaw ?? []).filter((n) => usableNews(n, aliasesFor(r.symbol, r.name))).slice(0, 6);
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
        const { data: freshNewsRaw } = await admin.from("news").select("symbol,title,url,source,summary").in("symbol", holdings.slice(0, 8).map((r) => r.symbol))
          .gte("published_at", since8h).order("published_at", { ascending: false }).limit(12);
        const freshNews = (freshNewsRaw ?? []).filter((n) => usableNews(n, akaOf(n.symbol))).slice(0, 12);
        const freshHeads = freshNews.map((n) => `- ${nameBy.get(n.symbol) ?? n.symbol}: ${String(n.title).slice(0, 90)}`).join("\n");
        const pnlOf = (rs: typeof assets) => rs.reduce((a, r) => r.change_pct === null ? a : a + usd(Number(r.value ?? 0), r.currency) * (Number(r.change_pct) / 100) / (1 + Number(r.change_pct) / 100), 0);
        const dayPnl = pnlOf(assets);
        const dayPct = total > 0 ? (dayPnl / (total - dayPnl) * 100) : 0;
        const fmtP = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
        const krRows = assets.filter((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ"));
        const usS = marketState("US"), krS = marketState("KR");
        const sessTag = (st: MarketState, seoul: boolean) => isLiveTape(st) ? `today's ${seoul ? "Korean " : ""}session` : `${weekdayOf(st.lastSessionDate)}'s ${seoul ? "Korean " : ""}session, closed ${spanText(st.hoursSinceClose)} ago`;
        // two markets, two sessions: a Friday 3:30 PM CT note must not fold a Korea close from 14 hours earlier into "today"
        const pnlLine = krRows.length
          ? `DAY P&L, US and crypto names (${sessTag(usS, false)}): ${fmtP(pnlOf(assets.filter((r) => !krRows.includes(r))))}; Korean names (${sessTag(krS, true)}): ${fmtP(pnlOf(krRows))}`
          : `DAY P&L: ${fmtP(dayPnl)} (${dayPnl >= 0 ? "+" : ""}${dayPct.toFixed(1)}%)`;
        const mSec = morningRow ? morningRow.sections as Sections : null;
        const morningCtx = mSec ? `THIS MORNING'S BRIEF (build on it, never repeat a sentence from it): lede "${mSec.lede}" \u00b7 tape "${mSec.overnight}" \u00b7 desk view "${mSec.desk_view}" \u00b7 watches: ${mSec.positions.map((p) => `${p.name}: ${p.watch}`).join("; ")}` : "(no morning brief today; write standalone, no references to an earlier note)";
        const nextUS = nextTradingDay("US", briefDate);
        const isFri = Math.round((+new Date(nextUS + "T12:00:00Z") - +new Date(briefDate + "T12:00:00Z")) / 86400000) > 1;   // a gap before the next session (weekend OR holiday), not literally Friday
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
${sessionLaw}
DESK CONTEXT (from the morning work):
${memosOut.slice(0, 4).map((m) => `- ${m.name}: ${m.changed ?? ""}${m.bull ? `. bull: ${m.bull}` : ""}${m.bear ? `. bear: ${m.bear}` : ""}. watch: ${m.watch ?? ""}`).join("\n") || "- none"}
${morningCtx}`;
        const shape = `Return STRICT JSON:\n{"lede": str, "overnight": str, "positions": [{"name": str, "note": str, "watch": str}], "desk_view": str, "calendar": [str]}`;
        const usOpensIn = spanText(usS.hoursToNextOpen);   // usS / krS come from the DAY P&L split above
        const writerPrompt = edition === "kr_open"
          ? `Write the ${briefDate} KOREA OPEN PULSE (published about 20 minutes into the KRX session, 9:20 AM Korea time on ${dayName(briefDate)}) for ONE investor who holds Korean names alongside a US book. Tell them how their Korean names opened, what news is moving them, and how the last US session frames the day. The US market opens in ${usOpensIn}.

${dataBlock}

${shape}
lede: the ONE thing the Korea open changes for THIS portfolio, stated as a consequence for the reader. <= 28 words.
overnight: the Korean tape RIGHT NOW: KOSPI and USDKRW copied from MARKET NOW with their EXACT labels and numbers, then the biggest Korean day move BY NAME with its number. US names appear only through their last session, past tense. <= 50 words.
positions: the Korean names FIRST (each with its day number and current weight, largest first), then at most ONE US name and only if it has fresh news; note <= 30 words that OPENS WITH WHAT IT MEANS for this owner. watch <= 10 words naming a level or event inside the Korean session or at the next US open.
desk_view: what the Korea open changes about the book's direction; the Korean sleeve's weight and its shared driver with the US names. AT MOST THREE figures. <= 36 words.
calendar: 0-3 items: the KRX close (3:30 PM KST) if a Korean catalyst lands today, the next US session with its date, dated earnings from NEXT EARNINGS ESTIMATES.
KR-SESSION LAW: "today" means the Korean session. Every US figure belongs to the US session named in SESSIONS and is past tense ("in Friday's session"), never "today".
QUIET-BOOK LAW: if no Korean name moved more than 1.5% and there is no fresh news, SAY the open is quiet in one clause and make the next catalyst the centerpiece. Never invent levels.
${STYLE_RULES}\n${READER}`
          : edition === "kr_close"
          ? `Write the ${briefDate} KOREA CLOSING NOTE (published after the 3:30 PM KST close on ${dayName(briefDate)}; the US market opens in ${usOpensIn}) for ONE investor who holds Korean names alongside a US book. Settle what the Korean session meant for the Korean sleeve and arm them for the US open.

${dataBlock}

${shape}
lede: the Korean session's story for THIS portfolio in one breath: the Korean names' day result, then a consequence clause. <= 30 words.
overnight: OPEN WITH THE CONCLUSION (what the session did to the Korean sleeve, plain words), THEN KOSPI and USDKRW copied from MARKET NOW with their EXACT labels and numbers, plus the Korean day P&L from PORTFOLIO. <= 55 words.
positions: the Korean names that defined the session, largest first, each with its day number and weight; then at most ONE US name with a catalyst at the coming US open. note <= 30 words: what happened AND what it means beyond today. watch <= 10 words naming the next concrete catalyst, level or event (the US open, a print, a KRX event tomorrow).
desk_view: the setup for the US session that opens in ${usOpensIn}: the one structural risk or opportunity that carries over from Korea. No single-day numbers. <= 40 words.
calendar: 0-3 items: the US open with its date and time, tomorrow's KRX session (or the next one if a holiday intervenes, name it), dated earnings.
KR-SESSION LAW: "today" means the Korean session that just closed. Every US figure is from the US session named in SESSIONS, past tense, never "today".
${STYLE_RULES}\n${READER}`
          : edition === "midday"
          ? `Write the ${briefDate} MIDDAY PULSE (11:00 AM Central, about 2.5 hours into the US session) for ONE investor. You wrote this morning's brief; now tell them what the session is ACTUALLY doing versus what was expected.

${dataBlock}

${shape}
lede: the ONE thing that changed since the open for THIS portfolio, stated as a CONSEQUENCE for the reader (what it does to their risk, concentration, or plan), never a bare move recap. <= 28 words.
overnight: the tape RIGHT NOW: at least THREE literal numbers copied from MARKET NOW with their EXACT labels, then the single biggest portfolio day move BY NAME with its number. <= 50 words.
positions: the 1-4 holdings actually moving or with fresh news since the open, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and current weight, before smaller names. The largest holding gets the MOST substantive note; spend both its allowed numbers there. note <= 28 words with the day number and WHY it moves, AT MOST TWO numbers in the note;${noteSplit} if the driver is unknown write "no clear driver yet" rather than inventing one. watch <= 10 words: a concrete afternoon or tonight event, level, or time; any date must be a REAL FUTURE date (after ${briefDate}), never past. For crypto assets: a price level, ETF flow print, protocol event, or dated macro print. NEVER verbs like monitor, watch, track.
desk_view: what today's action changes about the morning view, or the specific level or event this afternoon that would change it. Structural; never repeat the morning desk view. AT MOST THREE figures in total, and never a run of holdings each with its move. <= 36 words.
QUIET-BOOK LAW: if no holding moved more than 1.5% and there is no fresh news, SAY the session is quiet in one clause and make the afternoon catalyst the centerpiece. Never manufacture drama, never invent price levels: any level you cite must be within 20% of a price that appears in the data above.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it with new evidence from today's session; restating it in different words is a failure. Cover what the morning could not know.
calendar: 0-3 items for this afternoon or tonight, <= 10 words each.
${STYLE_RULES}\n${READER}`
          : `Write the ${briefDate} CLOSING NOTE (published minutes after the 4:00 PM Eastern close${isFri ? "; the next US session is ${dayName(nextUS)}, so set up the SESSIONS AHEAD" : ""}) for ONE investor. Your job: settle what today meant for their money and arm them for the next session.

${dataBlock}

${shape}
lede: the day's story for THIS portfolio in one breath: the DAY P&L number, then a consequence clause ("which leaves...", "which means...") saying what it changes about their position. A move recap with no consequence is a failure. <= 30 words.
overnight: OPEN WITH THE CONCLUSION in a short clause (what the session did to this book: "A quiet day left the book barely changed" - plain words, never trading-desk slang like "tape"), THEN at least THREE literal numbers copied from MARKET NOW with their EXACT labels, plus the portfolio day P&L. Never open this section with a bare list of levels. <= 55 words.
positions: the 1-4 holdings that defined the day, ordered by importance to THIS portfolio: any holding above 35% of assets MUST appear, with its day number and weight, before smaller names. The largest holding gets the MOST substantive note; spend both its allowed numbers there. note <= 30 words: what happened AND what it means beyond today, with the day number. AT MOST TWO numbers in the note.${noteSplit} watch <= 10 words naming a concrete ${isFri ? "next-session" : "tonight-or-tomorrow"} catalyst, level, or event (after-hours earnings, data time, KRX open); any date must be a REAL FUTURE date (after ${briefDate}), never past. For crypto assets: a price level, ETF flow print, protocol event, or dated macro print. NEVER verbs like monitor, watch, track.
desk_view: the setup for ${isFri ? dayName(nextUS) : "tomorrow"}: the one structural risk or opportunity to sleep on. No single-day numbers. <= 40 words.
CONTINUITY LAW: a claim already made in the morning brief may only reappear if you ADVANCE it (resolved, worsened, confirmed by the close); restating it in different words is a failure.
calendar: 0-3 items: tonight's after-hours reports, ${isFri ? dayName(nextUS) + "'s" : "tomorrow's"} data or earnings. <= 10 words each.${krHeld ? (marketState("KR").nextSessionDate === ymdShift(briefDate, 1) ? `\nTheir Korean holdings trade TONIGHT (KRX opens 9:00 PM Eastern). If a Korean name has a catalyst, put it in positions or calendar.` : `\nTheir Korean holdings next trade on ${dayName(marketState("KR").nextSessionDate)} (KRX is closed before that). If a Korean name has a catalyst, put it in positions or calendar.`) : ""}
${STYLE_RULES}\n${READER}`;
        let draft = await askModel(key, "You are the editor of a one-reader research desk. Dense, precise, every word counts. Think briefly, then write.", writerPrompt, 20000, 60000);
        // Retrying M2.7 after it already timed out just burns the budget again (two aborts = 105s, which used
        // to close the compact gate below and lose the brief entirely). gpt-oss writes this shape in ~20s.
        if ((!draft || !validSections(draft)) && elapsed() < 85) {
          draft = await askModel(key, "You are the editor of a one-reader research desk. Think briefly. Output the exact JSON shape requested.", writerPrompt, 20000, 40000, FAST_MODEL);
        }
        if ((!draft || !validSections(draft)) && elapsed() < 125) {
          // API slow-wave degradation: a compact intraday note beats no note
          const compact = `Write the ${briefDate} ${edition === "midday" ? "MIDDAY session pulse (11 AM Central)" : edition === "kr_open" ? "KOREA OPEN pulse (9:20 AM KST; Korean names first, US names past tense)" : edition === "kr_close" ? "KOREA CLOSING note (after the 3:30 PM KST close; Korean names first, US names past tense)" : "post-close note"} for ONE investor. Dense; every word counts.
MARKET NOW: ${mktLive || "(none)"}
PORTFOLIO (only source of numbers): Total $${Math.round(total)}. ${pnlLine}
${statsLines}
DESK CONTEXT:
${memosOut.slice(0, 4).map((m) => `- ${m.name}: ${m.changed ?? ""}. watch: ${m.watch ?? ""}`).join("\n") || "- none"}
${shape}
lede <= 28 words as a consequence for the reader; overnight <= 50 words with >= 3 MARKET NOW numbers and exact labels; 1-3 positions ordered by weight, note <= 28 words with a number,${noteSplit} watch <= 10 words taken from DESK CONTEXT or "next session open", NEVER an invented level or date (and NEVER monitor/watch/track); desk_view <= 36 words structural only; calendar []. The day G/L figures in PORTFOLIO are the only loss/gain numbers allowed. No filler, no em dashes, Korean companies by name, won as \u20a9.`;
          draft = await askModel(key, "Think very briefly. Output only the JSON.", compact, 12000, Math.max(18000, Math.min(35000, (150 - elapsed()) * 1000)), FAST_MODEL);
          if (draft && validSections(draft)) usedCompact = true;
        }
        if (!draft || !validSections(draft)) { errors.push(uid.slice(0, 8) + ": writer failed [" + lastMeta + "]"); continue; }
        const caps = edition === "midday" || edition === "kr_open" ? "lede 28, overnight 50, note 28, watch 10, desk_view 36" : "lede 30, overnight 55, note 30, watch 10, desk_view 40";
        const checked = elapsed() > 115 ? null : await askModel(key, "You are the fact-checker. You may only remove or correct, never add claims.",
          `Draft brief:\n${JSON.stringify(draft)}\n\nVerified data (the only allowed sources of numbers):\nMARKET NOW: ${mktLive}\nLEADERS: ${leaderLines}\nPORTFOLIO: Total $${Math.round(total)}. ${pnlLine}\n${statsLines}\nMEMOS: ${JSON.stringify(memosOut)}\n\nReturn the SAME JSON shape. Fix any number that contradicts the data; delete any claim you cannot trace to it; enforce the word caps (${caps}) by tightening, not by losing substance. Also: replace any numeric KRX code with the company name; write won as \u20a9 never "KRW"; delete any calendar or watch item whose date is before today (${briefDate}) and any undated calendar item; delete filler phrases (investors should, keep an eye, monitor closely, time will tell, worth watching); rewrite any sentence that mentions internal process words (skeptic, memo, pushback, analyst notes) so only the conclusion remains; overnight must keep at least three market numbers; delete any instruction to buy, sell, trim, add, reduce, or rotate a position and state the risk or setup instead; delete any figure credited to a company when the headline gives it to an industry, a market or another company (an industry-wide "$200 billion" is never one company's cut), and any claim that a story hits or helps a holding "directly" unless a headline names that holding; a day move tagged LIVE is today's, never "yesterday".`, 10000, 30000);
        sections = (checked && validSections(checked)) ? checked as Sections : draft as Sections;
      }
      if (!sections || !validSections(sections)) { errors.push(uid.slice(0, 8) + ": invalid sections"); continue; }
      sections.calendar = (sections.calendar ?? []).filter((c) => futureDated(String(c), briefDate)).slice(0, 3);
      sections.positions = sections.positions.slice(0, edition === "assessment" ? 6 : 4)
        .map((p) => ({ ...p, watch: p.watch.replace(/[,;\s]*\b(watch(ing)?|monitor(ing)?|track(ing)?)\b[.\s]*$/i, "").trim() }));
      snap("(start of shared chain)", sections);
      sections = deepDeDash(sections);
      snap("deepDeDash", sections);
      // Session wording and causal links, guaranteed in code (relabel or delete only, never a new figure):
      // an opening read's live US moves are "so far today", and "hits your X directly" loses the "directly"
      // no headline supports. Both shipped in the 2026-09-25 morning brief.
      const liveMoves = openingRead ? holdings.filter((r) => marketOf(r.symbol, r.kind, r.currency) === "US" && r.change_pct !== null)
        .map((r) => ({ names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], pct: Number(r.change_pct) })) : [];
      const guardWords = (t: string) => deDirect(liveMoves.length ? liveNotYesterday(t, liveMoves) : t);
      sections = { ...sections, lede: guardWords(sections.lede), overnight: guardWords(sections.overnight), desk_view: guardWords(sections.desk_view),
        positions: sections.positions.map((p) => ({ ...p, note: guardWords(p.note), watch: guardWords(p.watch) })),
        ...(sections.horizon !== undefined ? { horizon: guardWords(sections.horizon) } : {}) };
      snap("guardWords (deDirect)", sections);
      // deterministic style guarantees: KRX codes -> names, KRW-prefix -> ₩
      const codeToName = new Map(holdings.map((r) => [r.symbol, krName(r.symbol, r.nickname, r.name)] as [string, string]));
      const scrub = (t: string) => {
        let x = t;
        for (const [code, nm] of codeToName) if (code.endsWith(".KS") || code.endsWith(".KQ")) x = x.split(code).join(nm);
        x = x.replace(/KRW\s?(?=[0-9₩])/g, "₩").replace(/₩\s+(?=[0-9])/g, "₩").replace(/\u2011/g, "-");   // non-breaking hyphens read badly in TTS
        // NUMBER STYLE is guaranteed in code: dollar amounts >= 1,000 rounded to the nearest hundred, comma-grouped
        // round 6 trace: "[\d,]+" swallowed the comma AFTER a figure ("Cash sits at $8,000, about 15%" lost its comma)
        return x.replace(/\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g, (m, d, dec) => {
          const v = Number(String(d).replace(/,/g, "") + (dec ?? ""));
          return v >= 1000 ? "$" + (Math.round(v / 100) * 100).toLocaleString("en-US") : m;
        });
      };
      const scrubDeep = (v: unknown): unknown => typeof v === "string" ? scrub(v)
        : Array.isArray(v) ? v.map(scrubDeep)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubDeep(x)])) : v;
      sections = scrubDeep(sections) as Sections;
      snap("scrubDeep", sections);
      // The diet runs AFTER the expansion loop that enforces the length floor, so an aggressive trim can
      // starve a brief back below it. Snapshot first and keep the trim only if the brief stays long enough.
      // A daily edition written on a day the US market did not trade (operator-forced, or a holiday tick): the
      // day figures are the last session's, and the words that would claim otherwise are fixed in code.
      if (sections && krEdition) {
        const krNames = new Set(holdings.filter((r) => r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ")).map((r) => krName(r.symbol, r.nickname, r.name).toLowerCase()));
        const isKr = (p: { name: string }) => { const n = String(p.name ?? "").toLowerCase(); return [...krNames].some((k) => n.includes(k) || k.includes(n)) || /hynix|samsung|kospi|하이닉스|삼성|korean|korea/i.test(n); };
        const kr = sections.positions.filter(isKr), us = sections.positions.filter((p) => !isKr(p));
        sections.positions = [...kr, ...us.slice(0, 1)];
      }
      const scrubMkt: "US" | "KR" = krEdition ? "KR" : "US";
      if (sections && edition !== "weekend" && edition !== "assessment" && !marketState(scrubMkt).tradingToday) {
        const last = weekdayOf(marketState(scrubMkt).lastSessionDate);
        const fix = (t: string) => String(t ?? "").replace(/\btoday's\b/gi, `${last}'s`).replace(/\btoday\b/gi, `on ${last}`)
          .replace(/\b(on the day|this session|the session|today's session)\b/gi, `${last}'s session`).replace(/\btonight\b/gi, "before the next open");
        sections.lede = fix(sections.lede); sections.overnight = fix(sections.overnight); sections.desk_view = fix(sections.desk_view);
        sections.positions = sections.positions.map((p) => ({ ...p, note: fix(p.note), watch: fix(p.watch) }));
      }
      const wcAll = (o: Sections) => [o.lede, o.overnight, o.desk_view, o.horizon ?? "", ...(o.ideas ?? []), ...o.positions.flatMap((q) => [q.name, q.note, q.watch])].join(" ").split(/\s+/).filter(Boolean).length;
      const preDiet = JSON.parse(JSON.stringify(sections)) as Sections;
      // POST-PROCESSING SAFETY NET. Every number-corrupting bug in this pipeline shared one signature: the
      // text came out carrying a figure the model never wrote ($23,000 -> $23, +51.2% -> -51.2%). Removing a
      // figure is legitimate (that is what the diet does); INVENTING or ALTERING one never is. If the scrubs
      // produce a figure that was not in the text they started from, the scrubs lose and the original stands.
      const figSet = (o: unknown) => new Set((JSON.stringify(o ?? "").match(/-?\d[\d,]*(?:\.\d+)?%?/g) ?? []));
      // per-field: a scrub that alters a figure loses THAT field, not the whole diet
      const safeField = (before: string, after: string) => {
        const b = figSet(before);
        return [...figSet(after)].some((f) => !b.has(f)) ? before : after;
      };
      const dietFloor = edition === "assessment" ? (holdings.length <= 2 ? 180 : 240) : 120;
      // ---- NUMBER DIET (deterministic): weight enumerations are the exact anti-BLUF pattern the reader
      // objected to ("this stock -2.3%, that stock -4.4%"). Narrative sections state the conclusion and name
      // at most two figures; the book/overnight section stays the one place a full stat line is welcome.
      const numWord = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
      // the same laundry list also comes percent-first ("25.6% in a fund, 15.5% in a bank, 10.1% in ...")
      // ONLY an allocation list collapses. A percent-first run can just as easily be a RETURNS list
      // ("30-day returns are 24.4% for Bitcoin, 33.5% for Ethereum"), where collapsing deletes real figures
      // and leaves weight-language nonsense.
      // A bare chain of name-and-move ("Recent moves: QQQM up 1.5%, JPM down 0.5%, BLK down 1.0%") is the
      // exact laundry list the BLUF law forbids. It is not collapsed (that would rewrite real figures) but
      // DROPPED whole, which the figure-integrity net permits because deletion never invents a number.
      const NAME_MOVE = /\b[A-Z][A-Za-z.]{1,6}\b\s*(?:up|down|rose|fell|gained|lost)?\s*[+-]?\d[\d.]*\s?%/g;
      const dropMoveChain = (t: string, minWords = 12) => {   // dropping a pure move chain is always a gain
        const sents = String(t ?? "").split(/(?<=[.;])\s+/).filter(Boolean);
        if (sents.length <= 1) return t;
        const keep = sents.filter((x) => (x.match(NAME_MOVE) ?? []).length < 3);
        const words = (a: string[]) => a.join(" ").split(/\s+/).filter(Boolean).length;
        return keep.length && words(keep) >= minWords ? keep.join(" ") : sents.join(" ");
      };
      // A run of 3+ comma-separated segments each carrying a percentage is an enumeration whatever the
      // vocabulary ("QQQM holds $5,900 (25.6%), JPM $3,600 (15.5%), ..."). Keep two and name the rest.
      // The comma inside "$5,900" is a THOUSANDS SEPARATOR, so segmentation must not split on it.
      const collapseList = (t: string) => String(t ?? "").split(/(?<=[.;])\s+/).map((sent) => {
        if (RETURNY.test(sent)) return sent;
        const m = sent.match(/[.;]\s*$/); const end = m ? m[0] : "";
        const body = end ? sent.slice(0, -end.length) : sent;
        const segs = body.split(/(?<!\d),\s*/);
        let start = -1, len = 0, bStart = -1, bLen = 0;
        segs.forEach((sg, i) => {
          if (/\d\s?%/.test(sg)) { if (start < 0) { start = i; len = 0; } len++; if (len > bLen) { bLen = len; bStart = start; } }
          else { start = -1; len = 0; }
        });
        if (bLen < 3) return sent;
        const dropped = bLen - 2;
        return [...segs.slice(0, bStart + 2), `and ${numWord(dropped)} smaller position${dropped === 1 ? "" : "s"}`, ...segs.slice(bStart + bLen)].join(", ") + end;
      }).join(" ");
      const RETURNY = /\b(return|returns|gain|gains|loss|losses|performance|rose|fell|climbed|dropped|up|down|yield|yields)\b/i;
      const ALLOCY = /\b(assets|book|portfolio|weight|allocation|holdings|exposure)\b/i;
      const collapsePctFirst = (t: string) => String(t ?? "").split(/(?<=[.;])\s+/).map((sent) =>
        (RETURNY.test(sent) || !ALLOCY.test(sent)) ? sent : sent.replace(
          /(-?\d[\d.]*%[^,.;]{0,44})(?:,\s*(?:and\s+)?-?\d[\d.]*%[^,.;]{0,44}){2,}/g,
          (run) => { const items = run.split(/,\s*/); const n = items.length - 2; return items.slice(0, 2).join(", ") + `, and ${numWord(n)} smaller slice${n === 1 ? "" : "s"}`; })
      ).join(" ");
      const collapseRun = (t: string) => (t ?? "").replace(
        /(?:[A-Z][A-Za-z0-9.$]{0,6}\s+(?:is\s+|at\s+)?-?\d[\d.]*%)(?:,\s*[A-Z][A-Za-z0-9.$]{0,6}\s+(?:is\s+|at\s+)?-?\d[\d.]*%){2,}/g,
        (run) => { const items = run.split(/,\s*/); const n = items.length - 2; return items.slice(0, 2).join(", ") + `, and ${numWord(n)} smaller position${n === 1 ? "" : "s"}`; });
      // parenthetical weight tags are decoration: keep at most `keep` of them
      const deWeightParens = (t: string, keep: number) => { let seen = 0; return (t ?? "").replace(/\s*\(\s*[~≈]?\s*-?\d[\d.]*%(?:\s*weight)?(?:,[^)]*)?\)/g, (m) => (++seen <= keep ? m : "")); };
      // dates and durations are scaffolding, not statistics; a range is one figure
      const statCount = (t: string) => ((t ?? "")
        .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b|\b\d+\s*[-\s]?(?:week|month|year|day|quarter)s?\b/gi, " ")
        .replace(/-?\d[\d.]*\s*(?:-|to)\s*-?\d[\d.]*\s?%/g, "0%")
        .match(/-?\d[\d,]*(?:\.\d+)?\s?%|\$\s?[\d,]+/g) ?? []).filter((x) => !/^(19|20)\d\d$/.test(x.trim())).length;
      // enumerations come in too many phrasings to pattern-match one by one; enforce the cap structurally.
      // The opening states the shape of the book; a later sentence that re-states weights is what goes.
      const figuresIn = (t: string) => (String(t ?? "").match(/-?\d[\d,]*(?:\.\d+)?\s?%|\$\s?[\d,]+/g) ?? []).map((x) => x.trim());
      // never trim a section into a stub: losing the substance is worse than carrying one extra figure
      const RISK_CLAUSE = /\bthe risk:/i;
      // A move stated as a percent and then restated in dollars is ONE fact wearing two hats:
      // "gained 1.5% today, adding $16 to the position now up $104 total" is four figures for one event.
      // Drop the dollar echo, never the move and never the judgement. Deletion only, and it fires ONLY
      // when the field is already over its cap, so a compliant note is never touched.
      const dropDollarEcho = (t: string, cap: number) => {
        const text = String(t ?? "");
        if (statCount(text) <= cap) return text;
        const out = text.split(/(?<=[.;])\s+/).map((sent) => {
          if (!/\d\s?%/.test(sent) || RISK_CLAUSE.test(sent)) return sent;   // no move here, or it is the risk
          const end = (sent.match(/[.;]\s*$/) ?? [""])[0];
          const body = end ? sent.slice(0, -end.length) : sent;
          const segs = body.split(/(?<!\d),\s*/);
          if (segs.length < 2) return sent;
          // keep the first segment and anything carrying a percent or no figure at all;
          // drop a trailing clause whose only content is dollar amounts
          const kept = segs.filter((sg, i) => i === 0 || !/\$\s?[\d,]/.test(sg) || /\d\s?%/.test(sg));
          return kept.length === segs.length ? sent : kept.join(", ") + end;
        }).join(" ");
        return statCount(out) < statCount(text) ? out : text;   // only accept a real reduction
      };
      // "Recent 30-day returns: QQQM +1.5%, Nvidia +5.7%, Marathon +3.2%, JPMorgan -0.4%, BlackRock -0.8%."
      // is the exact laundry list this brief exists to replace, and desk_view's own spec already forbids
      // performance figures there. Sentence-level trimming could not reach it: dropping it left 17 words
      // against an 18-word floor. So drop it BY SHAPE instead, and only ever by deletion.
      // A period is a sentence end ONLY when whitespace follows it; inside 2.6 it is a decimal.
      // Using [^.] as the gap meant the pattern could not span "+2.6%" to "-30.2%", so the densest
      // laundry list of the night - nineteen figures, every holding with weight and two returns -
      // matched nothing. Third time a decimal point has broken one of these regexes.
      const GAP = "(?:[^.]|\\.(?=\\d))*?";
      const RETURNS_LIST = new RegExp(
        `(?:returns?|performance)\\b${GAP}[-+\\u2212]?\\d[\\d.]*\\s?%${GAP}[-+\\u2212]?\\d[\\d.]*\\s?%${GAP}[-+\\u2212]?\\d[\\d.]*\\s?%`
        + `|(?:[-+\\u2212]\\d[\\d.]*\\s?%${GAP}){3,}`);
      const dropReturnsList = (t: string) => {
        const sents = String(t ?? "").split(/(?<=[.;])\s+/).filter(Boolean);
        if (sents.length <= 1) return t;
        const kept = sents.filter((x) => !RETURNS_LIST.test(x));
        if (kept.length) return kept.join(" ");
        // Every sentence is an enumeration. The old guard returned the section UNTOUCHED to avoid
        // emptying it, which let the worst case through intact: a single sentence carrying nineteen
        // figures, every holding with its weight and two returns. Truncate to the opening claim
        // instead - parentheticals stripped, first clause kept - which is a concentration statement,
        // exactly what this section is for. Deletion only.
        const one = String(sents[0] ?? t).replace(/\s*\([^)]*\)/g, "");
        const head = one.split(/(?<!\d),\s*/)[0].replace(/[\s,;]+$/, "");
        return head ? head + "." : t;
      };
      const trimStats = (t: string, cap: number, minWords = 26) => {
        const wcS = (x: string) => String(x).split(/\s+/).filter(Boolean).length;
        const sents = String(t ?? "").split(/(?<=[.;])\s+/).filter(Boolean);
        if (sents.length <= 1) return t;
        const out = sents.slice();
        while (out.length > 1 && out.reduce((a, x) => a + statCount(x), 0) > cap
               && out.reduce((a, x) => a + wcS(x), 0) > minWords) {
          // drop what REPEATS figures already stated before it; only then fall back to the later sentence
          // Prefer what REPEATS figures already stated. With no repeats the old rule fell through to
          // "the last sentence", which is usually the short summarising one - so a book line would shed a
          // five-word tail and then hit the word floor with a 8-figure enumeration untouched. Tie-break on
          // FIGURE COUNT instead: the densest sentence IS the laundry list this diet exists to remove.
          let idx = -1, bestDup = -1, bestStats = -1;
          for (let i = 1; i < out.length; i++) {
            const n = statCount(out[i]);
            if (n === 0) continue;
            if (RISK_CLAUSE.test(out[i])) continue;   // a note's risk clause is required; never trim it away
            const earlier = new Set(out.slice(0, i).flatMap(figuresIn));
            const dup = figuresIn(out[i]).filter((f) => earlier.has(f)).length;
            if (dup > bestDup || (dup === bestDup && n > bestStats)) { bestDup = dup; bestStats = n; idx = i; }
          }
          if (idx < 0) break;
          if (out.reduce((a, x) => a + wcS(x), 0) - wcS(out[idx]) < minWords) break;
          out.splice(idx, 1);
        }
        return out.join(" ");
      };
      // last guard: no dangling clause reaches the reader, whichever stage truncated it
      const undangle = (t: string) => {
        let out = (t ?? "").trim(), prev = "";
        while (prev !== out) { prev = out; out = out.replace(/[\s,;:]+(?:so|and|but|or|which|that|with|for|to|at|in|on|of|as|while|because|if|when|from|by|than|its|their|the|a|an)\s*\.?$/i, ""); }
        // a truncation can also end on a bare figure ("..., so 25."): that is a fragment, not a sentence
        // the comma must not be a THOUSANDS SEPARATOR: "$23,000." is one figure, not a clause plus "000"
        out = out.replace(/(?<!\d)[,;]\s+(?:so|and|but|which|that)?\s*-?\d[\d,.]*%?\s*\.?$/i, "");
        return out.replace(/[,;:]+$/, "").replace(/([^.!?])$/, "$1.");
      };
      // Telling the reader what to do with their money is not ours to say, and it has recurred twice
      // ("Reducing MARA and adding stable dividend payers", "the main overnight task is to redeploy idle
      // cash"), so it stops being a prompt line and becomes a guarantee. Research gaps in `ideas` are a
      // different thing by design and are left alone.
      const TRADE_VERB = /\b(redeploy\w*|reallocat\w*|rotat\w*|deploy\w*|trimm?\w*|buy\w*|sell\w*|add|adding|reduc\w*|increas\w*|shift\w*|swap\w*)\b/i;
      const ADVICE_FRAME = /\b(should|consider|needs? to|ought to|task is to|we(?:'|\u2019)?ll|you (?:could|might|can|should)|worth (?:adding|buying|selling|trimming)|would (?:improve|help|boost|lift|strengthen|protect))\b/i;
      const deAdvice = (t: string) => {
        let out = String(t ?? "");
        out = out.replace(/[,;]\s*(?:so\s+|and\s+)?[^.;]*\b(?:should|consider|task is to|we(?:'|\u2019)?ll|you (?:could|might|can))\b[^.]*?(?=\.|$)/gi, "");
        out = splitSentences(out).filter((x) => !(TRADE_VERB.test(x) && ADVICE_FRAME.test(x))).join(" ");
        return out;
      };
      // The style rules already ban semicolons and the model keeps using them to weld two clauses into one
      // 26-word sentence. Splitting them enforces the rule that exists and halves sentence length.
      const deSemi = (t: string) => capSentenceStarts(String(t ?? "").replace(/;\s+/g, ". "));
      const tidy = (t: string) => undangle((t ?? "").replace(/\s+([,.;])/g, "$1").replace(/\s{2,}/g, " ").trim());
      // the close/morning tape line is instructed to carry three market quotes plus the day P&L, so it gets 8
      const bookCap = 7;   // the diet spec caps the book section at 7 figures on assessment and 8 on close; 7 satisfies both
      snap("(before number diet)", sections);
      sections.overnight = safeField(sections.overnight, tidy(deSemi(deAdvice(trimStats(collapseList(collapsePctFirst(collapseRun(dropMoveChain(deWeightParens(sections.overnight, 1))))), bookCap, 16)))));
      // the model sometimes writes the section label into the field itself
      sections.desk_view = String(sections.desk_view ?? "").replace(/^\s*(desk\s*view|structure\s*(?:&|and)\s*risk|the\s*desk\s*view)\s*[:\u2014-]\s*/i, "");
      sections.desk_view = safeField(sections.desk_view, tidy(deSemi(deAdvice(trimStats(dropReturnsList(collapsePctFirst(collapseRun(dropMoveChain(deWeightParens(sections.desk_view, 0))))), edition === "assessment" ? 5 : 3, 18)))));   // structural section; the floor is 18, not 30, because at 30 a four-sentence desk view could not shed a single sentence without breaching it, so the figure cap never bit
      sections.lede = safeField(sections.lede, tidy(deSemi(deAdvice(deWeightParens(sections.lede, 1)))));
      // in a DAILY note the weight is structural, not news, and the book line already states it: dropping the
      // "on a 9.3% weight" clause leaves the move and its dollar impact, which is what the day is about
      const deWeightClause = (t: string) => edition === "assessment" ? t
        : (t ?? "").replace(/,?\s*(?:on|at|with|representing)\s+an?\s+(?:\w+\s+){0,2}-?[\d.]+%\s*(?:weight|stake|position|holding|slice)\b/gi, "");
      sections.positions = sections.positions.map((p) => ({ ...p, note: safeField(p.note, tidy(deSemi(deAdvice(trimStats(dropDollarEcho(deWeightClause(collapseRun(deWeightParens(p.note, 1))), 3), 3, 18))))) }));
      // a diet that starves the brief is worse than the redundancy it removed
      if (wcAll(sections) < dietFloor && wcAll(preDiet) >= wcAll(sections)) sections = preDiet;
      snap("number diet (deWeightParens/collapse/trimStats/deAdvice/deSemi/tidy)", sections);
      // BEGINNER readers get the plain-language map applied in code, everywhere including tripwires
      // round 7 newcomer: the beginner glosses ran for "Intermediate" readers too, and most assessment garbles came
      // from them ("ETF new money turn negative", "Its ecosystem lasting edge over competitors"): beginners only
      if (topLevel(toArr((invBy.get(uid) as Investor | null | undefined)?.level, ["novice"])) === "novice") {
        sections = JSON.parse(noviceScrub(JSON.stringify(sections), edition === "assessment" ? ["P/E"] : [])) as Sections;
      }
      snap("noviceScrub (glosses)", sections);
      // CAPS LAST: the beginner vocabulary map lengthens text ("moat" -> "lasting edge over competitors"),
      // so a cap applied before it can be exceeded by the substitution itself
      const capNote = holdings.length <= 2 ? 56 : edition === "assessment" ? 40 : 33;
      sections.lede = fitCap(sections.lede, edition === "assessment" ? 30 : 34);
      sections.overnight = fitCap(sections.overnight, 52);
      sections.desk_view = fitCap(sections.desk_view, 48);
      if (edition === "assessment") sections.horizon = fitCap(sections.horizon ?? "", 46, /next [^:]{1,14}:[\s\S]*next [^:]{1,14}:/i);
      // a watch item that says nothing ("No catalyst") reads as a fragment; make it a real clause
      const fixWatch = (w: string) => /^\s*(no catalyst|none|n\/a|nothing)\b/i.test(String(w ?? ""))
        ? "No dated catalyst before the next open" : String(w ?? "");
      // "The risk: NII pressure. The risk: high concentration." reads as a template seam; keep the first
      const oneRisk = (note: string) => {
        const t = String(note ?? "");
        const first = t.indexOf(". The risk:");
        if (first < 0) return t;
        const second = t.indexOf(". The risk:", first + 5);
        return second < 0 ? t : t.slice(0, second) + ".";
      };
      sections.positions = sections.positions.map((p) => ({ ...p, note: capNoteKeepRisk(oneRisk(p.note), capNote, fitCap), watch: fitCap(fixWatch(p.watch), 14) }));
      sections.ideas = (sections.ideas ?? []).map((x) => fitCap(String(x), 16));
      // The per-field integrity net replaced the global revert, and the LENGTH floor went with it: a brief
      // trimmed to 100 words is worse than a slightly redundant one. Restore it alongside.
      if (wcAll(sections) < dietFloor && wcAll(preDiet) > wcAll(sections)) sections = preDiet;
      snap("caps last (fitCap/oneRisk/fixWatch)", sections);

      if (!backfillOnly) {
        // earnings dates only from the computed estimates (round 2: "Microsoft earnings call Sep 28")
        const wrongDates = new Set(wrongEarningsDates([...(sections.calendar ?? []), ...sections.positions.map((p) => p.watch)], earnEsts, briefDate));
        // ...and any future date that appears nowhere in what the writers were given ("Meta AI spend guidance Sep 30")
        const srcText = [...SOURCES, JSON.stringify(memosOut)].join("\n");
        const estYmds = earnEsts.map((e) => e.est).filter((x): x is string => !!x);
        for (const d of unsupportedDated([...(sections.calendar ?? []), ...sections.positions.map((p) => p.watch)], srcText, briefDate, estYmds)) wrongDates.add(d);
        const dropDated = (t: string) => { const bad = unsupportedDated(splitSentences(String(t ?? "")), srcText, briefDate, estYmds); return bad.length ? splitSentences(String(t)).filter((x) => !bad.includes(x)).join(" ") || t : t; };
        sections.lede = dropDated(sections.lede); sections.overnight = dropDated(sections.overnight); sections.desk_view = dropDated(sections.desk_view);
        sections.positions = sections.positions.map((p) => ({ ...p, note: dropDated(p.note) }));
        // Calendar lines are rebuilt from the estimates, labelled as estimates, with the same span text as Ask
        // (round 4: "Oct 28 earnings call MSFT", "Oct 29 earnings preview AAPL", an invented "Oct 28 AI spend
        // update META"); any other dated item must be backed by a dated line in the sources
        const labelled = earnEsts.map((e) => ({ ...e, label: e.names[0] }));
        sections.calendar = canonicalCalendar((sections.calendar ?? []).filter((c) => !wrongDates.has(c) || /\b(earnings|results|report)/i.test(c)), labelled, srcText, briefDate);
        sections.positions = sections.positions.map((p) => {
          const canon = canonicalCalendar([p.watch], labelled, srcText, briefDate);
          const earningsWatch = /\b(earnings|results|reports?|call|print|preview)\b/i.test(p.watch) && labelled.some((e) => e.names.some((n) => n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(p.watch)));
          if (earningsWatch) return { ...p, watch: canon[0] ?? watchFallback(p.name) };
          return wrongDates.has(p.watch) ? { ...p, watch: watchFallback(p.name) } : p;
        });
        // a valuation call ("looks cheap", "a bargain") is a verdict: the sentence goes, the rest of the note stays
        const deValue = (t: string) => { const bad = valuationHits(t); if (!bad.length) return t; const kept = splitSentences(t).filter((x) => !bad.some((b) => b.includes(x.trim()) || x.includes(b))); return kept.length ? kept.join(" ") : t; };
        sections.positions = sections.positions.map((p) => {
          const note = dropEcho(deValue(p.note), p.watch);
          // round 6: NVDA's "The risk:" repeated its watch, dropEcho took it, and the note shipped with no risk
          if (edition === "assessment" && note !== p.note && !/\bthe risk:|\bbut\b/i.test(note)) {
            const r = memoRisk(p.name, p.watch, note);
            return { ...p, note: r ? `${note.replace(/[.\s]+$/, "")}. ${r}` : note };
          }
          return { ...p, note };
        });
        // round 9 newcomer: KO's "The risk:" listed strengths, ">consensus tripwire" leaked the field name, SCHD's risk came
        // twice, JNJ and BRKB had none. Every note is cleaned; an assessment note left without a risk gets one from the
        // memo, or none at all.
        sections.positions = sections.positions.map((p) => {
          const c = cleanNote(p.note);
          let note = c.note || p.note;
          if (edition === "assessment" && c.needsRisk) { const r = memoRisk(p.name, p.watch, note); if (r) note = cleanNote(`${note.replace(/[.\s]+$/, "")}. ${r}`).note || note; }
          return { ...p, note, watch: String(p.watch ?? "").replace(/\s*\btripwire\b\s*/gi, " ").replace(/\s*([<>])\s*consensus/gi, (_m, s) => s === ">" ? " above consensus" : " below consensus").replace(/\s{2,}/g, " ").trim() };
        });
        if (edition === "assessment") {
          const styles = toArr((invBy.get(uid) as Investor | null | undefined)?.styles, ["value"]);
          // round 5: a stability / income reader was told to "improve the modest Bitcoin position"
          // round 9 newcomer: "All-US book" beside a 12.6% Korean holding, "dividend-growth ETFs beyond SCHD" for a SCHD
          // holder: an idea that contradicts the book, names a holding, or copies the prompt's example goes
          const bookInfo = holdings.map((r) => ({ names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], theme: themeOf(r.symbol, r.kind),
            pct: usd(Number(r.value ?? 0), r.currency) / total * 100, region: (r.kind === "crypto" ? "crypto" : /\.(?:KS|KQ)$/.test(r.symbol) ? "KR" : "US") as "US" | "KR" | "crypto" }));
          const EXAMPLES = ["No income sleeve: dividend-growth ETFs", "All-US book: developed-market ex-US index funds", "One-theme book: AI software and infrastructure beyond chips"];
          const fit = (sections.ideas ?? []).map(deValue).filter((x) => !offLensIdea(x, styles) && !offRiskIdea(x, styles) && !ideaContradictions(x, bookInfo, EXAMPLES));
          // every idea pushed a product this reader does not invest in: the gap itself stays, as a fact (when it is true)
          const fallbackIdea = "No bond or income exposure: one growth driver moves the whole book";
          sections.ideas = fit.length ? fit : (sections.ideas ?? []).length && !ideaContradictions(fallbackIdea, bookInfo) ? [fallbackIdea] : [];
        }
        // "A ultra-concentrated book" (round 2): articles fixed in code, English editions only
        const art = (t: string) => fixArticles(t);
        sections.lede = art(sections.lede); sections.overnight = art(sections.overnight); sections.desk_view = art(sections.desk_view);
        if (sections.horizon) sections.horizon = art(sections.horizon);
        sections.positions = sections.positions.map((p) => ({ ...p, note: art(p.note), watch: art(p.watch) }));
        sections.ideas = (sections.ideas ?? []).map(art); sections.calendar = (sections.calendar ?? []).map(art);
      }
      snap("dates/calendar/deValue/articles", sections);
      // THE BASIS: what the brief was written against, so a client can tell when its premise has gone stale
      // (round 2: a Midday Pulse said Microsoft's jump "limits today's loss" under a +$5,842 day, because it
      // was written at 11:31 when the book was red). Contract (all optional for readers):
      //   as_of          ISO time the prices were read       day_sign  -1 | 0 | 1 (0 under 0.05%)
      //   day_pct        the book's day move, %               day_usd   the book's day move, USD
      //   held           symbols in the book                  day_by_symbol  { SYMBOL: day % } for the 12 largest
      const dayUsd = assets.reduce((a, r) => r.change_pct === null || r.symbol.startsWith("$") ? a : a + usd(Number(r.value ?? 0), r.currency) * (Number(r.change_pct) / 100) / (1 + Number(r.change_pct) / 100), 0);
      const dayPctB = total - dayUsd > 0 ? dayUsd / (total - dayUsd) * 100 : 0;
      const basis = {
        as_of: new Date().toISOString(), day_sign: Math.abs(dayPctB) < 0.05 ? 0 : Math.sign(dayPctB), day_pct: Number(dayPctB.toFixed(2)), day_usd: Math.round(dayUsd),
        held: holdings.map((r) => r.symbol),
        day_by_symbol: Object.fromEntries(holdings.slice(0, 12).filter((r) => r.change_pct !== null).map((r) => [r.symbol, Number(Number(r.change_pct).toFixed(2))])),
      };
      if (!backfillOnly) Object.assign(sections, basis);

      // A superseded PORTFOLIO ASSESSMENT is not written: when the user added more while this run was writing,
      // a newer run (assessment_status.started_at) owns the row, and a one-stock verdict must not land in front
      // of the whole book (round 2 newcomer: "every dollar tied to Nvidia" above a 99% VOO book).
      if (edition === "assessment" && typeof body.run === "string" && !backfillOnly) {
        const { data: st } = await admin.from("assessment_status").select("started_at").eq("user_id", uid).maybeSingle().then((r) => r, () => ({ data: null }));
        if (st?.started_at && +new Date(String(st.started_at)) > +new Date(body.run) + 1000) { superseded = true; continue; }
      }

      // PLAIN WORDS AND NO INVENTED HISTORY (round-3 native review): "your book" -> "your portfolio", "tape" ->
      // "market", "names" -> "stocks" for every reader; a sentence comparing with a past year or an all-time /
      // record level the writers were never given ("Tech concentration at 1965 highs") is dropped.
      if (!backfillOnly) {
        const hsrc = [...SOURCES, JSON.stringify(memosOut)].join("\n");
        const dlvFacts = holdings.map((r) => ({ names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], est: deliveriesEstimate(r.symbol, briefDate)?.est ?? null }));
        // "30.1% Bitcoin weight" when Bitcoin is 25.2% (30.1% = Bitcoin + Ether, round 5): a holding's weight is its
        // own; a group share must be labelled as the group
        const weightFacts = holdings.map((r) => ({ names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], weight: usd(Number(r.value ?? 0), r.currency) / total * 100 }));
        const bookNamesAll = weightFacts.flatMap((w) => w.names);
        // round 9 intelligence: events and causes are grounded in DATA only (headlines, earnings estimates, dividend and
        // deliveries dates), never in model text: the memos are model output and would ground their own inventions
        const { data: gNews } = fixture ? { data: [] } : await admin.from("news").select("title, summary").in("symbol", holdings.map((r) => r.symbol).slice(0, 25))
          .gte("published_at", new Date(Date.now() - 10 * 86400000).toISOString()).limit(400);
        const groundSrc = [...nextEarn, ...divData.map((x) => x.d.line), ...dlvFacts.filter((d) => d.est).map((d) => `${d.names[0]} deliveries ${d.est}`),
          ...((gNews ?? []) as { title: string; summary?: string | null }[]).map((n) => `${n.title} ${n.summary ?? ""}`)].join("\n");
        const weightGroups = [{ label: /\bcrypto\b/i, value: exposure.crypto }, { label: /\bbonds?\b/i, value: exposure.bonds }, { label: /\bKorea(?:n)?\b/i, value: exposure.krEquity },
          { label: /\b(?:US|U\.S\.) (?:stocks?|equit)/i, value: exposure.usEquity }, { label: /\bcash\b/i, value: exposure.cash }, { label: /\b(?:top (?:three|3|five|5)|together|combined)\b/i, value: -1 }];
        const moveWeightFacts = holdings.map((r) => ({ names: [krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)], weight: usd(Number(r.value ?? 0), r.currency) / total * 100, pct: r.change_pct === null ? null : Number(r.change_pct) }));
        const ttmIncome = divData.reduce((a, x) => a + Number(x.r.qty ?? 0) * Number(divRows.get(x.r.symbol)?.div_ttm ?? 0) / (fxMap.get(x.r.currency ?? "USD") ?? 1), 0);
        const allowedYields = divIncome > 0 ? [divIncome / total * 100, ttmIncome / total * 100, ...divData.map((x) => Number(divRows.get(x.r.symbol)?.div_yield ?? 0)).filter((v) => v > 0)].map((v) => Number(v.toFixed(2))) : [];
        const divShares = divData.filter((x) => x.d.annual > 0).map((x) => ({ names: [krName(x.r.symbol, x.r.nickname, x.r.name), ...aliasesFor(x.r.symbol, x.r.name)], share: divIncome > 0 ? x.d.annual / divIncome * 100 : 0 }));
        const payerNames = divData.filter((x) => x.d.amounts.length).map((x) => ({ names: [krName(x.r.symbol, x.r.nickname, x.r.name), ...aliasesFor(x.r.symbol, x.r.name)] }));
        const paysOf = (name: string): boolean | null => {
          const h = holdings.find((r) => [r.symbol, krName(r.symbol, r.nickname, r.name), ...aliasesFor(r.symbol, r.name)].some((n) => n && n.toLowerCase() === name.toLowerCase()));
          if (!h) return null;
          const d = divRows.get(h.symbol);
          if (h.kind === "crypto") return false;
          return !d?.div_as_of ? null : Number(d.div_last) > 0;
        };
        // round 6e: a fraction word is checked against the share it names ("one-third of the book tied to a single
        // theme" when the top theme is 21.1%)
        const themeShare = new Map<string, number>();
        for (const r of holdings) { const th = themeOf(r.symbol, r.kind); themeShare.set(th, (themeShare.get(th) ?? 0) + usd(Number(r.value ?? 0), r.currency) / total * 100); }
        const escR = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fracGroups = [
          { label: /\b(?:single|one|top|biggest|largest|dominant|main) theme\b/i, value: Math.max(0, ...[...themeShare].filter(([th]) => th !== "other").map(([, v]) => v)) },
          ...[...themeShare].filter(([th]) => th !== "other").map(([th, v]) => ({ label: new RegExp(`\\b${escR(th)}\\b`, "i"), value: v })),
          { label: /\btop (?:three|3)\b/i, value: holdings.slice(0, 3).reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0) / total * 100 },
          { label: /\bcrypto\b/i, value: exposure.crypto }, { label: /\bcash\b/i, value: exposure.cash }, { label: /\bbonds?\b/i, value: exposure.bonds },
          { label: /\b(?:US|U\.S\.) (?:stocks?|equit)/i, value: exposure.usEquity },
        ];
        const TECH_T = new Set(["AI semiconductors", "AI infrastructure", "mega-cap platforms", "software", "consumer internet", "Nasdaq 100 index"]);
        const themesArr = [...themeShare].filter(([th]) => th !== "other").map(([name, pct]) => ({ name, pct }));
        const techGroup = [{ label: /\b(?:tech|technology)(?: stocks| names| holdings| exposure| share)?/i, value: [...themeShare].filter(([th]) => TECH_T.has(th)).reduce((a, [, v]) => a + v, 0) }];
        const clean = (t: string) => {
          // round 8: a verdict TAIL leaves a one-sentence lede as a clause ("…, keeping the portfolio on track"), and a
          // tech share is held to the computed one ("Tech makes up about 57%" at ~97%)
          // round 9: the compact morning read "Portfolio up 0.5%" (+0.27%) and "What it means the AI chip rally adds..."
          const x0 = fixGroupShares(fixWeights(fixAgreement(fixExposure(fixFractions(fixProperCase(tidyNumbers(digitsForWritten(dropInstructionEcho(plainScrub(stripVerdictTails(String(t ?? "")), PORTFOLIO_PLAIN))))), weightFacts, fracGroups), exposure)), weightFacts, [...weightGroups, ...fracGroups]), techGroup);
          const x = fixThemeHeavy(fixBookMove(fixWhatItMeans(x0), edition === "assessment" || edition === "weekend" ? null : dayPctB), themesArr);
          // a cause for a move that no headline states ("Meta's dip signals weaker AI spend", round 4) goes too, and
          // so does a report month or date off its estimate ("Microsoft earnings in late November", round 4
          // assessment), another holding's dividend, and a deliveries date that is not the known one
          const parts = splitSentences(x);
          const bad = [...historicalClaims(x, hsrc, briefDate), ...unsupportedCauses(x, hsrc), ...wrongEarningsMonths(x, earnEsts),
            ...wrongEarningsDates(parts, earnEsts, briefDate), ...wrongDividendAmounts(x, divFacts), ...wrongDeliveriesDates(x, dlvFacts, briefDate),
            // round 5: "captures the full S&P 500 upside while avoiding individual stock fees", "support a 4-8% annual return"
            ...promoClaims(x), ...returnForecasts(x), ...themeClaims(x, themesArr),
            // round 9 intelligence: a dated event or a cause no source line carries ("MSFT Copilot revenue update
            // Monday", "Microsoft's AI spend boosted earnings")
            ...(fixture ? [] : [...ungroundedEventSentences(x, groundSrc, bookNamesAll), ...ungroundedCauses(x, groundSrc, bookNamesAll)]),
            // round 6: "NVDA and QQQ pay no dividend" (both do), "SoFi fell after an article noted its drop"
            ...dividendContradictions(x, payerNames), ...circularCauses(x),
            // round 7: "META dropped 12.8%" (its weight), "a yield near 0.5%" (the book yields 0.30% / 0.34%)
            ...weightAsMoveHits(x, moveWeightFacts), ...(allowedYields.length ? wrongYieldClaims(x, allowedYields) : []),
            // round 7 newcomer: "while cushioning volatility", "crypto hedge", "delivering most of its dividend yield"
            // (AAPL + MSFT pay 26% of it), "+7.2% this month, on pace with your 8-12% annual target"
            ...promoCharacterisations(x), ...dividendShareClaims(x, divShares), ...targetPaceClaims(x), ...targetBandClaims(x),
            // a two-word fragment left by an earlier deletion ("It adds.", round 5) goes without a model call
            ...brokenSentences(x).filter((b) => b.split(/\s+/).length <= 2)];
          if (!bad.length) return x;
          // line by line, so a multi-line field keeps its newlines (round 7: the join(" ") flattened bullets)
          const kept = perLine(x, (line) => splitSentences(line).filter((s) => !bad.some((b) => b.includes(s.trim()) || s.includes(b))).join(" "));
          return kept.trim() ? kept : x;
        };
        sections.lede = clean(sections.lede); sections.overnight = clean(sections.overnight); sections.desk_view = clean(sections.desk_view);
        if (sections.horizon) sections.horizon = clean(sections.horizon);
        // round 7: the book's live day gain and total, stated in a daily note, carry the time they were read (the header
        // above the note moves on: "$211 gain … $116,500" under +$319 / $116,620)
        if (edition !== "assessment" && edition !== "weekend") {
          const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
          // round 8: a close edition read "gained $9,400 (as of 7:31 PM ET)" for a figure fixed at the 4:00 PM close,
          // and a fresh close lede whose $211 was the stats block's figure (not today's recomputed $319) got no label
          const closed = edition === "close" || marketState("US").phase === "post" || marketState("US").phase === "closed";
          const lbl = closed ? "as of the 4:00 PM ET close" : `as of ${at} ET`;
          const stated = [...String(sections.lede ?? "").matchAll(/\b(?:gain(?:ed|s)?|los(?:s|t|es)|lifts?|lifted|up|down|adds?|added|to)\s+(?:about\s+|roughly\s+)?[+\-−]?\$(\d{1,3}(?:,\d{3})+|\d+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
          const figsLive = [Math.round(dayUsd), Math.round(total), ...stated];
          sections.lede = labelLiveFigures(sections.lede, figsLive, lbl); sections.overnight = labelLiveFigures(sections.overnight, figsLive, lbl); sections.desk_view = labelLiveFigures(sections.desk_view, figsLive, lbl);
        }
        // "The risk: net cash balance sheet." labels a strength as the risk (round 4): that clause goes, and the
        // memo's tripwire (or nothing) stands in
        const noStrengthRisk = (note: string, name: string) => {
          if (!strengthAsRisk(note)) return note;
          const kept = splitSentences(note).filter((x) => !strengthAsRisk(x));
          const m = memosOut.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
          const trip = m?.tripwire ? ` The risk: ${String(m.tripwire).replace(/[.\s]+$/, "")}.` : "";
          return (kept.join(" ") + trip).trim() || note;
        };
        // a note's dividend sentence must match that holding's record ("It does not pay a dividend" under NVDA)
        const deDiv = (note: string, name: string) => {
          const bad = noteDividendClaims(note, paysOf(name));
          if (!bad.length) return note;
          const kept = splitSentences(note).filter((x) => !bad.includes(x));
          return kept.length ? kept.join(" ") : note;
        };
        sections.positions = sections.positions.map((p) => ({ ...p, note: noStrengthRisk(deDiv(clean(p.note), p.name), p.name), watch: stripStrayEst(fixProperCase(tidyNumbers(digitsForWritten(plainScrub(p.watch, PORTFOLIO_PLAIN))))) }));
        sections.ideas = (sections.ideas ?? []).map(clean);
        // a weekend-dated item is no event (round 4: "Copilot earnings preview Sep 27", a Sunday), nor is a
        // deliveries date that is not the estimate ("Tesla delivery numbers Sep 28"; the report is Oct 2)
        const offCal = new Set([...weekendDated(sections.calendar ?? [], briefDate), ...wrongDeliveriesDates((sections.calendar ?? []).join("\n"), dlvFacts, briefDate),
          // round 9 intelligence: an event no source line carries ("Meta Q4 guidance Monday")
          ...(fixture ? [] : ungroundedEvents(sections.calendar ?? [], groundSrc, bookNamesAll))]);
        sections.calendar = (sections.calendar ?? []).filter((c) => !offCal.has(c)).map((c) => tidyNumbers(plainScrub(c, PORTFOLIO_PLAIN)));
        sections.positions = sections.positions.map((p) => weekendDated([p.watch], briefDate).length || wrongDeliveriesDates(p.watch, dlvFacts, briefDate).length
          || (!fixture && ungroundedEvents([p.watch], groundSrc, bookNamesAll).length)
          ? { ...p, watch: ((w) => !fixture && ungroundedEvents([w], groundSrc, bookNamesAll).length ? "No confirmed date yet" : w)(watchFallback(p.name)) } : p);
      }
      snap("clean (plain words/exposure/weights/claims)", sections);
      // GRAMMAR PASS (round 3 newcomer: "Watch QQQ on sustained a shrinking price tag relative.", "Total assets
      // $26,600 cash $2,500"): broken sentences get one rewrite on the fast model; a sentence still broken
      // after it is dropped, unless it is all its field holds.
      if (!backfillOnly && !fixture) {
        const fields: [string, () => string, (v: string) => void][] = [
          ["lede", () => sections!.lede, (v) => { sections!.lede = v; }], ["overnight", () => sections!.overnight, (v) => { sections!.overnight = v; }],
          ["desk_view", () => sections!.desk_view, (v) => { sections!.desk_view = v; }], ["horizon", () => sections!.horizon ?? "", (v) => { sections!.horizon = v; }],
          ...sections.positions.map((_, i) => [`note${i}`, () => sections!.positions[i].note, (v: string) => { sections!.positions[i] = { ...sections!.positions[i], note: v }; }] as [string, () => string, (v: string) => void]),
          ...sections.positions.map((_, i) => [`watch${i}`, () => sections!.positions[i].watch, (v: string) => { sections!.positions[i] = { ...sections!.positions[i], watch: v }; }] as [string, () => string, (v: string) => void]),
        ];
        const broken = [...new Set(fields.flatMap(([, get]) => brokenSentences(get())))];
        if (broken.length) {
          const fixedMap = new Map<string, string>();
          if (elapsed() < 125) {
            const res = await askModel(key, "You fix grammar only. Respond with JSON only.", `Each sentence below is broken (a dangling ending, a stray article, a list with no verb). Rewrite each into one clean, complete sentence, keeping every fact and number exactly and adding nothing new. Return STRICT JSON {"fixed": [str, ...]} in the same order.\n${broken.map((b, i) => `${i + 1}. ${b}`).join("\n")}`, 2000, 12000, FAST_MODEL).catch(() => null);
            const out = Array.isArray((res as { fixed?: unknown } | null)?.fixed) ? ((res as { fixed: unknown[] }).fixed).map(String) : [];
            broken.forEach((b, i) => {
              const f = (out[i] ?? "").trim();
              const numsKept = (b.match(/\d[\d,.]*/g) ?? []).every((n) => f.includes(n));
              if (f && !brokenSentences(f).length && numsKept && f.split(/\s+/).length <= b.split(/\s+/).length + 8) fixedMap.set(b, f);
            });
          }
          for (const [, get, set] of fields) {
            let v = get();
            for (const b of broken) if (v.includes(b)) v = fixedMap.has(b) ? v.replace(b, fixedMap.get(b)!) : (v.replace(b, "").replace(/\s{2,}/g, " ").trim() || v);
            set(v);
          }
        }
      }
      // YOUR PORTFOLIO for the assessment, built in code LAST: every holding of 2% or more with its dollars and share,
      // cash, the smaller holdings counted, and the exposure by type, then at most two of the model's qualitative
      // sentences. Round 5: the r4b rebuild ran BEFORE the grammar pass, which deleted it as a verbless list, and
      // the model's "80.6% United States, 7.2% crypto, and one smaller position" went out again.
      snap("grammar pass (MODEL)", sections);
      if (edition === "assessment" && !backfillOnly) {
        sections.overnight = yourPortfolio(holdings.map((r) => ({ name: krName(r.symbol, r.nickname, r.name), usd: usd(Number(r.value ?? 0), r.currency) })),
          assets.filter((r) => r.symbol.startsWith("$") || r.kind === "cash").reduce((a, r) => a + usd(Number(r.value ?? 0), r.currency), 0), total, exposure, sections.overnight);
      }
      // round 8 newcomer: the same sanitize() as every other surface, over EVERY field (ideas and watch items included:
      // "Crypto risk: hedge with stablecoin yield platforms to smooth volatility" shipped in GAPS & IDEAS)
      if (!backfillOnly) {
        const keepOr = (t: string, fallback: string) => sanitize(t) || fallback;
        sections.lede = keepOr(sections.lede, stripVerdictTails(sections.lede));
        sections.overnight = keepOr(sections.overnight, sections.overnight);
        sections.desk_view = keepOr(sections.desk_view, stripVerdictTails(sections.desk_view));
        if (sections.horizon) sections.horizon = keepOr(sections.horizon, sections.horizon);
        sections.ideas = (sections.ideas ?? []).map((i) => sanitize(i, { ideaSurface: true })).filter(Boolean);
        sections.positions = sections.positions.map((p) => ({ ...p, note: keepOr(p.note, p.note), watch: sanitize(p.watch) || "No confirmed date yet" }));
        sections.calendar = (sections.calendar ?? []).map((c) => sanitize(c)).filter(Boolean);
      }
      // round 8: signed figures use the true minus sign, as the client renders them
      { const um = (v: unknown): unknown => typeof v === "string" ? unicodeMinus(v) : Array.isArray(v) ? v.map(um) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === "day_by_symbol" || k === "held" || k === "as_of" ? x : um(x)])) : v;
        sections = um(sections) as Sections; }
      snap("YOUR PORTFOLIO (code)", sections);
      if (TRACE) { const tf = Deno.env.get("BRIEF_TRACE_FILE"); if (tf) Deno.writeTextFileSync(tf, JSON.stringify(TRACE)); else console.log("TRACE_JSON " + JSON.stringify(TRACE)); }
      // round 9 native: a regeneration (or the rewrite of an outdated row) must not bump generated_at: the client opens
      // on the latest generated_at, and a night-time regen of the morning put it in front of the Close
      let keepAt: string | null = null;
      if (!backfillOnly && edition !== "assessment") {
        const { data: prior } = await admin.from("daily_briefs").select("generated_at, gen_version").eq("user_id", uid).eq("brief_date", briefDate).eq("edition", edition).maybeSingle()
          .then((x: { data: unknown }) => x, () => ({ data: null })) as { data: { generated_at?: string | null; gen_version?: number | null } | null };
        if (prior?.generated_at && (isRegen || Number(prior.gen_version ?? 0) < GEN_VERSION)) keepAt = String(prior.generated_at);
      }
      const briefRow = {
        user_id: uid, brief_date: briefDate, edition, sections, memos: memosOut.slice(0, 8), generated_at: keepAt ?? new Date().toISOString(), model: fixture ? "fixture" : usedCompact ? model + " compact" : model,
        audio_path: null,   // new text => stale audio; narrate re-runs for this row
        script: null,       // ...and re-composes the spoken script
      };
      let { error: upErr } = backfillOnly ? { error: null } : await admin.from("daily_briefs").upsert({ ...briefRow, gen_version: GEN_VERSION }, { onConflict: "user_id,brief_date,edition" });
      // before migration 39 the version column is not there: write the row without it
      if (upErr && /gen_version/.test(String((upErr as { message?: string }).message ?? ""))) ({ error: upErr } = await admin.from("daily_briefs").upsert(briefRow, { onConflict: "user_id,brief_date,edition" }));
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

        // The notification IS the shortest brief: push the lede, which has already been through BLUF,
        // the number diet and the tier vocabulary. Fire-and-forget on the same waitUntil pattern, and
        // inert until the APNs credentials exist, so a missing Apple account never costs anyone a brief.
        // A regeneration of an edition the reader was already notified about is not pushed again.
        if (!isRegen) {
        const pushed = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/push-send`, {
          method: "POST", headers: { Authorization: `Bearer ${svcK}`, apikey: svcK, "Content-Type": "application/json", "x-internal-token": itok },
          body: JSON.stringify({ user_id: uid, edition, lede: sections.lede }),
        }).then((r) => r.text().catch(() => "")).catch(() => null);
        try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(pushed); } catch { /* ignore */ }
        }
      }
    } catch (e) { errors.push(uid.slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, users: userIds.length, wrote, briefDate, ...(dispatched ? { regenerating: dispatched } : {}), ...(renarrated ? { renarrated } : {}), ...(superseded ? { superseded: true } : {}), errors: errors.slice(0, 5) });
});
