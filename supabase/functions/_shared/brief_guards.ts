// Deterministic backstops for the daily brief (10/1 owner regenerations). Each one fixes a class of error the model
// keeps making after the data it sees was corrected: a weight given to the wrong holding, "recovers only part" of a
// smaller drop, a figure mangled by an earlier scrub, and an empty lede. Every rewrite uses a figure from the book
// or deletes one; none invents a number.
import { splitSentences } from "./intel.ts";

export type WeightFact = { names: string[]; weight: number };

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRe = (n: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, "giu");

// A percent right after these is a move, a return, a yield or a stake in something else, never the holding's weight.
const NOT_WEIGHT_AFTER = /^\s*(?:lower|higher|down|up|below|above|off|under|over|cheaper|more|less|from|since|this|in\b|year|yield|dividend|return|gain|loss|rally|drop|decline|rebound|slide|move|jump|surge|fall|rise|one-year|1-year|annual|a year|weekly|monthly|ytd|year-to-date|today|so far|on the day|premium|discount|stake in|owned|ownership|of (?:its|the company|shares)|swing|pullback|selloff|sell-off)/i;
// a group's share ("Korean stocks are 28.9%", "crypto at 1.5%"): the group word heads the noun phrase the figure belongs to
const GROUP_BEFORE = /\b(?:Korean|Korea|US|U\.S\.|American|crypto|cash|tech|chips?|bonds?|theme|sector|rest|others|remaining|smaller)(?:\s+(?:stocks?|holdings|names|equities|exposure|assets|shares?|slices?|positions|funds?))?\s+(?:(?:is|are|was|were|at|makes? up|accounts? for|now|sits?|stands?|a|an|the|of|share|weight)\s+){0,3}$/i;
const notWeightAfter = (after: string) => NOT_WEIGHT_AFTER.test(after) || /^\s*of [A-Z]/.test(after);   // "of Solidigm": a stake in something else
const MOVE_BEFORE = /\b(?:rose|fell|dropped|drops?|climbed|climbs?|gained|gains?|slipped|slips?|jumped|jumps?|surged|sank|tumbled|rallied|declined|lost|added|adds|(?<!\b(?:make|makes|made|making|add|adds|added|sum|sums|summed|end|ends|ended|take|takes|took) )up|down|higher|lower|advanced|eased|dipped|slid|soared|plunged|moved|rebound(?:ed|s)?|yield(?:s|ing)?)\b[^.%\d]{0,14}$|[+\-−]\s?$/i;

/** Holdings named in a sentence, longest name first at each position (so "Samsung Pref" is not also "Samsung"). */
function namedIn(s: string, facts: WeightFact[]): { f: WeightFact; at: number; end: number }[] {
  const hits: { f: WeightFact; at: number; end: number }[] = [];
  for (const f of facts) for (const n of [...f.names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const m of s.matchAll(nameRe(n))) {
      const at = m.index!, end = at + m[0].length;
      if (hits.some((h) => at < h.end && end > h.at)) continue;
      hits.push({ f, at, end });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}
const distinct = (hits: { f: WeightFact }[]) => [...new Set(hits.map((h) => h.f))];
const tolFor = (num: string, tol: number) => (num.includes(".") ? tol : Math.max(tol, 0.5));

/** "<holding> at / is X%" and "<holding>'s X% weight" must be that holding's own weight (within `tol` points), else
 *  the true weight is written. 10/1: "MARA at 33.7% and SK hynix at 55.1% means 21.4% of the portfolio rides two
 *  single-name bets" (SK hynix 21.4%, the pair 55.1%). A combined claim ("together", "two single-name bets", "the
 *  pair") must equal the sum of the holdings the sentence names. */
export function fixNamedWeights(text: string, facts: WeightFact[], tol = 0.15): string {
  const src = String(text ?? "");
  if (!facts.length || !/\d\s?%/.test(src)) return src;
  let changed = false;
  const out = splitSentences(src).map((s0) => {
    let s = s0;
    const hits = namedIn(s, facts);
    if (!hits.length) return s;
    // 1. per-name weights
    const owned: [number, number][] = [];   // spans of figures that belong to a name
    const repl: { at: number; len: number; to: string }[] = [];
    for (const h of hits) {
      const tail = s.slice(h.end);
      const m = /^((?:['’]s)?\s*(?:\(\s*|,?\s+(?:(?:is|was|sits|stands|now|still|alone|weighs|makes up|accounts for|represents|holds|at|of)\s+){1,3}))(\d+(?:\.\d+)?)\s?%(\s*\))?/i.exec(tail)
        ?? /^(['’]s\s+)(\d+(?:\.\d+)?)\s?%(?=\s+(?:portfolio\s+)?(?:weight|weighting|stake|position|share|allocation|concentration|of (?:assets|the portfolio|your portfolio)))/i.exec(tail);
      if (!m) continue;
      // "of" is a connector only in "X of assets" shapes reached through "makes up"/"accounts for"; a bare "MARA of 5%" is not a weight
      if (/\bof\s+$/i.test(m[1]) && !/\b(?:makes up|accounts for|represents)\b/i.test(m[1])) continue;
      const numAt = h.end + m[1].length, num = m[2];
      const after = s.slice(numAt + num.length).replace(/^\s?%/, "");
      if (notWeightAfter(after)) continue;
      owned.push([numAt, numAt + num.length]);
      const v = Number(num), w = h.f.weight;
      if (Math.abs(v - w) <= tolFor(num, tol)) continue;
      repl.push({ at: numAt, len: num.length, to: w.toFixed(1) });
    }
    // 2. a combined figure in a sentence that names two or more holdings
    const named = distinct(hits);
    const COMBINED = /\b(?:together|combined|between them|the pair|two (?:single[- ](?:name|stock) |big |large |concentrated |largest |biggest )?(?:bets|stocks|holdings|names|positions)|top two|in two)\b/i;
    if (named.length >= 2 && named.length <= 4 && COMBINED.test(s) && !(/\b(?:two|pair|both|top two)\b/i.test(s.match(COMBINED)![0]) && named.length !== 2)) {
      const sum = named.reduce((a, f) => a + f.weight, 0);
      const sumR = named.reduce((a, f) => a + Number(f.weight.toFixed(1)), 0);
      for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
        const at = m.index!, num = m[1];
        if (owned.some(([a, b]) => at >= a && at < b)) continue;
        const before = s.slice(Math.max(0, at - 30), at), after = s.slice(at + m[0].length);
        if (MOVE_BEFORE.test(before) || notWeightAfter(after)) continue;
        // a group's share ("Korean stocks are 28.9%") is not the named pair's
        if (GROUP_BEFORE.test(before)) continue;
        // the figure must read as a share of the portfolio
        if (!/^\s*(?:of (?:the |your )?(?:portfolio|assets|holdings)|combined|together|in (?:two|both|the two))/i.test(after) && !/\b(?:together|combined|both|pair)\b[^.%\d]{0,20}$/i.test(before)) continue;
        const v = Number(num), t = tolFor(num, tol);
        if (Math.abs(v - sum) <= t || Math.abs(v - sumR) <= t) continue;
        repl.push({ at, len: num.length, to: sumR.toFixed(1) });   // the sum of the weights as written, so the sentence adds up
      }
    }
    if (!repl.length) return s;
    for (const r of repl.sort((a, b) => b.at - a.at)) s = s.slice(0, r.at) + r.to + s.slice(r.at + r.len);
    if (s !== s0) changed = true;
    return s;
  });
  return changed ? out.join(" ") : src;
}

/** A position note is about ITS holding: a bare "X% weight / stake / concentration / of assets" in it, in a sentence that
 *  names no other holding and no group, is that holding's weight. 10/1 full regeneration: SK hynix's note said "35.0%
 *  concentration" at a 21.4% weight. */
export function fixNoteWeight(note: string, own: WeightFact | undefined, facts: WeightFact[], tol = 0.15): string {
  const src = String(note ?? "");
  if (!own || !/\d\s?%/.test(src)) return src;
  let changed = false;
  const out = splitSentences(src).map((s) => {
    if (namedIn(s, facts.filter((f) => f !== own)).length) return s;
    const x = s.replace(/(\d+(?:\.\d+)?)\s?%(?=\s+(?:(?:portfolio|Korean|US|AI|crypto|chip|memory|core|biggest|largest|single-name)[- ]?\s*)?(?:weight|weighting|stake|concentration|allocation|position|holding|anchor|bet|of (?:assets|the portfolio|your portfolio))\b)/g, (m: string, num: string, at: number) => {
      const before = s.slice(Math.max(0, at - 30), at);
      if (MOVE_BEFORE.test(before) || GROUP_BEFORE.test(before) || /\b(?:top|two|combined|together)\b[^.%\d]{0,30}$/i.test(before)) return m;
      return Math.abs(Number(num) - own.weight) <= tolFor(num, tol) ? m : m.replace(num, own.weight.toFixed(1));
    });
    if (x !== s) changed = true;
    return x;
  });
  return changed ? out.join(" ") : src;
}

const DOWN_W = /\b(?:drop|drops|dropped|fall|falls|fell|decline|declines|declined|loss|losses|slide|slid|slump|selloff|sell-off|dip|plunge|tumble|sank|slip|slipped|retreat)\b/i;
const UP_W = /\b(?:rebound|rebounds|rebounded|bounce|bounced|gain|gains|gained|rise|rises|rose|rally|rallied|recovery|jump|jumped|surge|surged|advance|advanced|climb|climbed|pop|lift)\b/i;
const PARTIAL = /\b(?:only\s+)?(?:partly|partially|part of|some of|a fraction of|a portion of|a piece of|half of)\b/i;
const FULL = /\b(?:more than (?:erases?|erased|erasing|recovers?|recovered|recovering|offsets?|offset|offsetting|makes? up for|made up for|wipes? out|wiped out|reverses?|reversed)|fully (?:erases?|erased|recovers?|recovered|offsets?|reverses?|reversed)|erases? all of|erased all of|wipes? out all of|all of)\b/i;
const VERB = /\b(recover(?:s|ed|ing)?|recoup(?:s|ed|ing)?|eras(?:es|ed|ing|e)|offset(?:s|ting)?|revers(?:es|ed|ing|e)|wip(?:es|ed|ing|e) out|ma(?:kes|de|king|ke) up for|giv(?:es|ing|e) back|gave back|claw(?:s|ed|ing)? back|wins? back|won back|retrac(?:es|ed|ing|e))\b/i;

/** "Samsung Pref's 4.8% rebound recovers only part of Wednesday's 4.3% drop": after a 4.3% drop a 4.49% gain is the
 *  full way back (4.3 / 95.7), so 4.8% more than erases it. A partial-recovery claim the arithmetic contradicts is
 *  rewritten to "more than erases" ("fully erases" at par); a full-recovery claim the move cannot reach becomes
 *  "recovers only part of". The test is compounding, not the bare comparison: a 4.4% gain after a 4.3% drop really is
 *  still short. Wording only; both figures stay. */
export function fixRecoveryClaims(text: string): string {
  const src = String(text ?? "");
  if (!VERB.test(src)) return src;
  let changed = false;
  const out = splitSentences(src).map((s) => {
    const vm = VERB.exec(s);
    if (!vm) return s;
    const pre = s.slice(0, vm.index), post = s.slice(vm.index);
    const a = [...pre.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].pop();
    const b = /(\d+(?:\.\d+)?)\s?%\s*(\w+(?:-\w+)?)?/.exec(post);
    if (!a || !b) return s;
    const A = Number(a[1]), B = Number(b[1]);
    const ctxA = pre.slice(Math.max(0, a.index! - 24), a.index! + a[0].length + 24);
    const ctxB = post.slice(Math.max(0, b.index! - 24), b.index! + b[0].length + 24);
    const bDown = DOWN_W.test(ctxB) && !UP_W.test(b[2] ?? ""), bUp = !bDown && UP_W.test(ctxB);
    const aUp = UP_W.test(ctxA), aDown = DOWN_W.test(ctxA);
    if (!((bDown && aUp) || (bUp && aDown))) return s;
    // the size of the opposite move that takes the price all the way back
    const needed = bDown ? B / (100 - B) * 100 : B / (100 + B) * 100;
    const full = A >= needed - 1e-9;
    const span = post.slice(0, b.index!);   // verb ... up to the second figure
    const tense = (v: string) => /ed$|gave|made|won|wiped|clawed|offset$/i.test(v) && !/^offsets?$/i.test(v) ? "past" : /ing$/i.test(v) ? "ing" : "now";
    const t = tense(vm[1]);
    const erases = t === "past" ? "erased" : t === "ing" ? "erasing" : "erases";
    const recovers = t === "past" ? "recovered" : t === "ing" ? "recovering" : "recovers";
    // a modifier written before the verb ("only partly recovers", "more than erases") belongs to the claim
    const preTail = /\b(?:only\s+)?(?:partly|partially|more than|fully)\s+$/i.exec(pre);
    const head = preTail ? pre.slice(0, preTail.index) : pre;
    const claim = (preTail?.[0] ?? "") + span;
    // what stays in front of the second figure: its possessive or article ("Wednesday's 4.3% drop")
    const keep = span.replace(VERB, "").replace(/^\s*(?:only\s+)?(?:partly|partially|part of|some of|a fraction of|a portion of|a piece of|half of|all of)\s*/i, "").trimStart();
    if (full && PARTIAL.test(claim)) {
      changed = true;
      return `${head}${A - needed > 0.05 ? `more than ${erases}` : `fully ${erases}`} ${keep}${post.slice(b.index!)}`.replace(/\s{2,}/g, " ");
    }
    if (!full && FULL.test(claim)) {
      changed = true;
      return `${head}${recovers} only part of ${keep}${post.slice(b.index!)}`.replace(/\s{2,}/g, " ");
    }
    return s;
  });
  return changed ? out.join(" ") : src;
}

// Camel-cased brands that legitimately end in a capital letter after lower-case letters; none ends in B/M/K/T today,
// but a name added here is never treated as a mangled figure.
const CAMEL_OK = new Set<string>([]);
/** A figure eaten by an earlier scrub leaves a scale letter glued to a word: "Solidigm IPO talk-150B" (from "talk at
 *  $100-150B") and "SolidigmB" (from "Solidigm at $150B"). The lost figure cannot be rebuilt, so the stray
 *  fragment goes and the sentence stays readable: "Solidigm IPO talk is unfiled speculation". */
export function repairMangledFigures(text: string): string {
  return String(text ?? "")
    .replace(/\b([A-Za-z]{2,})-\d[\d,.]*\s?(?:[KMBT]|bn|billion|million|trillion)\b/g, "$1")
    .replace(/\b([A-Za-z][a-z]{3,})([BMKT])\b/g, (m, stem: string) => (CAMEL_OK.has(m) ? m : stem));
}
/** True when a field still carries a mangled-figure token (for tests and the regeneration check). */
export const mangledFigureHits = (text: string): string[] =>
  [...String(text ?? "").matchAll(/\b[A-Za-z]{2,}-\d[\d,.]*\s?(?:[KMBT]|bn|billion|million|trillion)\b|\b[A-Za-z][a-z]{3,}[BMKT]\b/g)].map((m) => m[0]).filter((m) => !CAMEL_OK.has(m));

/** The lede is the one line every reader sees first, and the push notification. When the guards have left it empty
 *  (10/1: one forced regeneration shipped a blank lede), it is rebuilt from verified figures only. */
export function ledeFallback(netWorth: number, top: { name: string; weight: number }[]): string {
  const nw = netWorth >= 1e6 ? `$${(netWorth / 1e6).toFixed(2)} million` : `$${(Math.round(netWorth / 100) * 100).toLocaleString("en-US")}`;
  const [a, b] = top;
  if (!a) return `Your portfolio is worth ${nw}.`;
  const pair = b ? `, and with ${b.name} at ${b.weight.toFixed(1)}% the two make up ${(Number(a.weight.toFixed(1)) + Number(b.weight.toFixed(1))).toFixed(1)}% of it` : "";
  return `Your portfolio is worth ${nw}. ${a.name} is the largest holding at ${a.weight.toFixed(1)}% of assets${pair}.`;
}

/** Plain words, told to the writer up front (the scrub in PORTFOLIO_PLAIN is the backstop). */
export const PLAIN_WORDS_RULE = `PLAIN WORDS (every reader, every section, the lede included): never trading-desk slang. Write "buying" or "demand", never "bid"; "the top of the cycle", never "cycle peak"; "too small to matter", never "rounding error"; "a lower price relative to earnings", never "multiple compression"; "warning sign", never "yellow flag" or "tripwire"; "Korean holdings" or "Korean stocks", never "sleeve"; "sold" or "selling" for an insider sale, never "dumped" or "dumping"; "price swings", never "vol"; "price target", never "PT"; "cautious", never "risk-off".
RECOVERY ARITHMETIC: a rebound at least as big as the drop it follows erases it, so never call it partial; only a smaller one recovers "part" of it.
WEIGHTS: each weight goes beside its OWN holding, exactly as LARGEST HOLDINGS gives it; a combined figure is the pair's, labelled as the pair.`;
