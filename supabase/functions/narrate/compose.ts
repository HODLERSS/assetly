// Script composition for narration, separated from the HTTP handler so it can run on stored briefs locally
// (scripts/narrate_harness.ts) with no TTS and no database writes. index.ts calls exactly this.
import { earWords, replaceTicker, roundPct, sayAs, speakable } from "./ear.ts";
import { scriptProblems, sanitize, ungroundedEventSentences } from "../_shared/intel.ts";
import { callJudge } from "../_shared/judge.ts";
import { chat } from "../_shared/llm.ts";

export type Sections = { lede: string; overnight: string; positions: { name: string; note: string; watch: string }[]; desk_view: string; calendar?: string[]; horizon?: string; ideas?: string[] };
/** The text a script may be made from. daily-brief also stores its BASIS on the row (as_of, day_sign, day_pct,
 *  day_usd, held, day_by_symbol) for the client's staleness check; those are not brief content and must never
 *  be spoken or offered as allowed figures. */
const realWatch = (w: unknown): boolean => !!String(w ?? "").trim() && !/^\s*no confirmed date yet\.?\s*$|^\s*(?:none|n\/a|tbd)\s*$/i.test(String(w ?? ""));

export function parseJsonBlock(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{"); if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) { if (cleaned[i] === "{") depth++; else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } } }
  if (end < 0) return null;
  try { return JSON.parse(cleaned.slice(start, end)); } catch { return null; }
}
export let lastModelErr = "";
async function askModel(key: string, system: string, prompt: string, maxTokens: number, timeoutMs: number, model?: string): Promise<Record<string, unknown> | null> {
  // shared client (10/1): MARA, then SambaNova on a provider failure (no hedge: narration is not interactive)
  const res = await chat({ model: model ?? Deno.env.get("MARA_MODEL") ?? "MiniMax-M3", temperature: 0.25, max_tokens: maxTokens, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system + " Respond with the JSON object ONLY, first character '{'." }, { role: "user", content: prompt }] },
    { caller: "narrate.compose", maraKey: key, timeoutMs });
  if (!res.ok) { lastModelErr = res.reason === "timeout" ? `timeout ${timeoutMs}ms` : res.reason === "network" ? "network" : `${res.reason} ${res.status ?? ""} ${res.detail}`.slice(0, 160); return null; }
  const c = res.content;
  if (!c.trim()) { lastModelErr = `empty content (finish ${res.finish})`; return null; }
  const parsed = parseJsonBlock(String(c));
  if (!parsed) lastModelErr = `unparseable: ${String(c).slice(0, 80)}`;
  return parsed;
}
// ---- spoken-figure fidelity -------------------------------------------------------------------
// The numeral guard only sees ARABIC digits, and a script written FOR THE EAR spells its numbers out.
// That gap is where the real fabrications lived: "twenty-six point six percent" against a book that
// says 25.6%, and a spoken total that disagreed with the written one. Rounding for the ear is REQUIRED,
// so this never demands an exact match - it asks that every spoken quantity round to something the brief
// actually contains. Like every other guard here it only REJECTS, so it can never alter a figure.
const NUM_U: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const NUM_T: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM_S: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
const isNumWord = (w: string) => w in NUM_U || w in NUM_T || w in NUM_S || w === "point" || w === "and" || w === "a";
const wordsToNumber = (toks: string[]): number | null => {
  let total = 0, cur = 0, seen = false, frac: number | null = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w === "and") continue;
    if (w === "a") { if (toks[i + 1] in NUM_S) cur = cur || 1; continue; }
    if (w === "point") {
      const d: number[] = []; let j = i + 1;
      while (j < toks.length && toks[j] in NUM_U && NUM_U[toks[j]] < 10) { d.push(NUM_U[toks[j]]); j++; }
      if (d.length) { frac = Number("0." + d.join("")); i = j - 1; seen = true; }
      continue;
    }
    if (w in NUM_U) { cur += NUM_U[w]; seen = true; continue; }
    if (w in NUM_T) { cur += NUM_T[w]; seen = true; continue; }
    if (w in NUM_S) { const m = NUM_S[w]; seen = true; if (m === 100) cur = (cur || 1) * 100; else { total += (cur || 1) * m; cur = 0; } continue; }
  }
  return seen ? total + cur + (frac ?? 0) : null;
};
/** "twenty-three point four percent" -> "twenty-three percent". Below TEN percent the decimal stays:
 *  rounding 34.3 to 34 loses nothing, rounding 1.5 to 2 is a third of the figure. */
const NW = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and";
// the group must START and END on a number word, or it eats the space in front of it ("a twenty-three
// point four percent" came back as "atwenty-three percent")
const EAR_RE = new RegExp(`((?:${NW})(?:[\\s-]+(?:${NW}))*)\\s+point\\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)\\s+percent\\b`, "gi");
const roundEar = (t: string) => String(t ?? "").replace(EAR_RE,
  (whole, intPart: string) => {
    const v = wordsToNumber(String(intPart).toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean));
    return v !== null && v >= 10 ? `${String(intPart).trim()} percent` : whole;   // under 10% the decimal carries real weight
  });

const spokenQuantities = (text: string): { value: number; unit: "pct" | "usd" }[] => {
  const toks = String(text).toLowerCase().replace(/<[^>]*>/g, " ").replace(/-/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const out: { value: number; unit: "pct" | "usd" }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!isNumWord(toks[i]) || toks[i] === "and" || toks[i] === "a") continue;
    let j = i;
    while (j < toks.length && isNumWord(toks[j])) j++;
    const unit = toks[j];
    if (unit === "percent" || unit === "dollar" || unit === "dollars") {
      const v = wordsToNumber(toks.slice(i, j));
      if (v !== null) out.push({ value: v, unit: unit === "percent" ? "pct" : "usd" });
    }
    i = j;
  }
  return out;
};
/** true when a spoken quantity matches no figure in the brief, allowing the rounding the script is told to do. */
const spokenFigureUnsupported = (script: string, allowed: string[]): boolean => {
  const pcts = allowed.filter((a) => a.includes("%")).map((a) => Number(a.replace(/[^0-9.]/g, ""))).filter((n) => Number.isFinite(n));
  const usds = allowed.filter((a) => a.includes("$")).map((a) => Number(a.replace(/[^0-9.]/g, ""))).filter((n) => Number.isFinite(n));
  return spokenQuantities(script).some(({ value, unit }) => {
    const pool = unit === "pct" ? pcts : usds;
    if (!pool.length) return false;                       // nothing of that unit to check against
    return !pool.some((a) => {
      // at 10% and up, rounding to the nearest whole number is the REQUIRED ear-rounding; below that the
      // spoken figure must essentially match, because "two percent" for 1.5% misstates it by a third
      if (unit === "pct") return a >= 10 ? Math.abs(a - value) <= 0.5 : Math.abs(a - value) < 0.05;
      // dollars are rounded hard for the ear: 43,224 may be spoken as 43,000 or 43 thousand
      const grains = [1, 100, 1000, 10000];
      return grains.some((g) => Math.round(a / g) * g === Math.round(value / g) * g);
    });
  });
};

// A sentence that ends on a preposition or conjunction is a truncated thought, and it is read ALOUD
// to the listener: "keep JPMorgan Chase's dividend reliable and sustainable over." Two independent
// judges flagged this before I did - the acceptance gates only ever checked that the script ENDS with
// punctuation, never that the sentences inside it finish.
// NARROWED after it degraded production. The first version banned every sentence-final preposition,
// but that is standard English - "the fund you rely on.", "what the cash buffer is for." - so it
// rejected good drafts, drove six sequential model calls per brief, and pushed narration to 573s or to
// no script at all. Far worse than the defect it was chasing. Only words that CANNOT end an English
// sentence remain; a truncation ending in a preposition is now missed, which is the right trade.
const DANGLING = /\b(and|or|but|which|than|into|between|during|the|an?)\s*[.!?]/i;
const hasDanglingSentence = (t: string) => DANGLING.test(String(t ?? "").replace(/<[^>]*>/g, " "));

const EAR_JARGON = /\b(beta|alpha|ROE|ROIC|ROTCE|EBITDA|FCF|EPS|AUM|NII|NIM|CET\s?1|capex|basis points|multiple compression|valuation multiple|net interest (?:margin|income)|drawdown|Sharpe|duration|convexity|dry powder|megacap|tilt|cash drag|hash ?rate|free cash flow)\b/i;

export const speechName = (name: string) => {
  let n = name.trim();
  for (let i = 0; i < 3; i++) n = n.replace(/[,\s]*\b(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|PLC|N\.V\.|S\.A\.|AG|SE|Holdings?|Group|Trust|Fund|ETF|Class [A-C]( Shares)?|Common Stock|Ordinary Shares|ADR|\(.*?\))\s*$/i, "").trim();
  // "JPMORGAN CHASE & CO" loses "CO" above and is left ending in a bare ampersand, which is then SPOKEN
  n = n.replace(/[\s,]*&\s*$/, "").trim();
  return sayAs(n || name);
};
const sayNames = (t: string, names: [string, string][]) => {
  let x = t;
  for (const [sym, nm] of names) {
    if (nm.toUpperCase() === sym) continue;   // the company IS called by its ticker (MARA): nothing to say differently
    const bare = sym.replace(/\.(KS|KQ)$/, "");
    x = replaceTicker(x, sym, nm);
    if (bare !== sym && /^[A-Z]{2,5}$/.test(bare)) x = replaceTicker(x, bare, nm);
  }
  return x;
};
// numbers for the ear: $107,300 -> "a hundred and seven thousand three hundred dollars" is model work; the
// fallback keeps digits but spaces them so TTS reads them cleanly ("107,300 dollars", "5.8 percent")
// verbal rounding: nobody says "thirty-four point three percent" or "forty-three thousand two hundred twenty-four dollars"

const roundUsd = (v: number) => {
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + " billion dollars";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + " million dollars";
  if (v >= 1000) { const m = Math.pow(10, String(Math.round(v)).length - 2); return Math.round(v / m) * m + " dollars"; }
  return Math.round(v) + " dollars";
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];
const MAG: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, mn: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const SIGN = (s: string) => (s === "-" || s === "−" ? "minus " : s === "+" ? "plus " : "");
const QTR = ["", "first", "second", "third", "fourth"];
// Everything ElevenLabs will hear passes through here, model script and fallback alike. The rule of the
// road: the currency word comes AFTER the magnitude, never before it. A listener heard "three dollar
// million" on 2026-09-02 because "$3 million" fell through to the bare "$N" rule, which wrote "3 dollars
// million". Every form the writer might produce is handled BEFORE that catch-all fires.
const earNumbers = (t: string) => earWords(t)
  // an ISO date read aloud is "two thousand twenty six dash zero nine"; say it like a person
  .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, _y, m, d) => `${MONTHS[Number(m) - 1] ?? ""} ${ORD[Number(d)] ?? Number(d)}`.trim())
  // "$3 million", "$3.2 billion", "$85k", "$1.1bn", "USD 3 million", "-$706", "+$48": magnitude first, currency last
  .replace(/([+\-−]?)(?:\$|USD\s?|US\$)\s?([\d,]+(?:\.\d+)?)\s?(thousand|million|billion|trillion|mm|mn|bn|tn|[kKmMbBtT])\b(?:\s+dollars)?/g, (_, sg, d, suf) =>
    SIGN(sg) + roundUsd(Number(String(d).replace(/,/g, "")) * (MAG[String(suf).toLowerCase()] ?? 1)))
  .replace(/([+\-−]?)(?:\$|USD\s?|US\$)\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s+dollars)?/g, (_, sg, d) => SIGN(sg) + roundUsd(Number(String(d).replace(/,/g, ""))))
  // "8%-12%", "8-12%", "8% to 12%": one range, one unit, no dash read aloud
  .replace(/([+\-−]?)(\d+(?:\.\d+)?)\s?%?\s?(?:-|–|—|to)\s?(\d+(?:\.\d+)?)\s?%/g, (_, sg, a, b) => `${SIGN(sg)}${roundPct(Number(a))} to ${roundPct(Number(b))} percent`)
  .replace(/([+\-−]?)(\d+(?:\.\d+)?)\s?(?:%|percent\b)/g, (_, sg, n) => SIGN(sg) + roundPct(Number(n)) + " percent")
  // won: same law, magnitude then currency
  .replace(/₩\s?([\d,]+(?:\.\d+)?)\s?(thousand|million|billion|trillion|[kKmMbB])\b/g, (_, d, suf) => `${d} ${String(suf).length === 1 ? { k: "thousand", m: "million", b: "billion" }[String(suf).toLowerCase()] : String(suf).toLowerCase()} won`)
  .replace(/₩\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/g, "$1 won")   // a comma AFTER the figure is punctuation, not a digit group
  // "Q3" is "third quarter"; "YTD" is "year to date"; a bare ratio "2x" is "2 times"
  .replace(/\bQ([1-4])\b/g, (_, q) => `${QTR[Number(q)]} quarter`)
  .replace(/\bYTD\b/g, "year to date")
  .replace(/\b(\d+(?:\.\d+)?)x\b/g, "$1 times")
  .replace(/\s+&(?=[.,]|\s|$)/g, "");   // a truncated legal name ("JPMORGAN CHASE &") must not be spoken
// The fallback ships to a real listener whenever the model wanes, so it obeys the same laws as the written
// script: bottom line first, only the two positions that matter, no stat line read aloud, no laundry list.
function fallbackScript(s: Sections, dayLine: string, edition: string): string {
  const greet = edition === "kr_open" ? `Korea is open. Here's your Korea open pulse for ${dayLine}.` : edition === "kr_close" ? `Korea has closed. Here's your Korea closing note for ${dayLine}.` : edition === "weekend" ? `Hi, it's ${dayLine}. Here's your weekend read.` : edition === "assessment" ? `Hi, it's ${dayLine}. Here's your portfolio assessment.` : edition === "close" ? `Good evening, it's ${dayLine}. Here's your closing note.` : edition === "midday" ? `It's ${dayLine}, midday. Here's your pulse.` : `Good morning, it's ${dayLine}. Here's your brief.`;
  const say = (t: string) => earNumbers(String(t ?? "").trim());
  const firstSentence = (t: string) => (String(t ?? "").split(/(?<=[.!?])\s+/)[0] ?? "").trim();
  const top = (s.positions ?? []).slice(0, 2);   // two names, not a walkthrough
  const parts = [
    greet,
    say(s.lede),
    // the two names that matter, each in ONE sentence, with the ampersand of a truncated legal name removed
    // do not announce the name and then repeat it, and never speak a stray ampersand from a legal name
    ...top.map((p, i) => {
      const nm = say(String(p.name).replace(/\s*&\s*/g, " ").trim());
      const note = say(String(p.note ?? "").trim());   // the FULL note: its first sentence is a BLUF one-liner, and three of those made a 33-second brief
      return new RegExp(`^${nm.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(note) ? note : `${i === 0 ? "First" : "Next"}, ${nm}. ${note}`;
    }),
    say(s.desk_view),
    // the fallback must still clear the spoken-length floor, or a listener gets a 90-word stub
    ...(s.horizon ? [say(firstSentence(s.horizon))] : []),
    ...((s.ideas ?? []).length ? [`One thing worth looking into: ${say(firstSentence(String((s.ideas ?? [])[0])))}`] : []),
    // a DAILY brief has no horizon and no research ideas, so without its catalysts the fallback runs ~35
    // seconds against an intended 75-90; the watch items are the useful content that belongs there
    // r11 P3: a placeholder is not something to watch ("What to watch next: No confirmed date yet.")
    ...(edition !== "assessment" && top.some((p) => realWatch(p.watch))
      ? [`What to watch next: ${[...new Set(top.filter((p) => realWatch(p.watch)).map((p) => say(String(p.watch ?? "").trim())).filter(Boolean))].slice(0, 2).join(", and ")}.`]
      : []),
    edition === "assessment" ? "That's your assessment. Talk soon." : "That's your brief. Talk soon."];
  return parts.filter(Boolean).join(' <break time="0.7s" /> ');
}

export type ComposeInput = { s: Sections; briefDate: string; edition: string; key: string; names: [string, string][]; voiceLine: string; savedScript: string | null };
export type ComposeResult = { spoken: string; usedFallback: boolean; savedChanged: boolean; log: string[] };
export async function composeScript(p: ComposeInput): Promise<ComposeResult> {
  const { s, key, names, savedScript } = p;
  const row = { brief_date: p.briefDate, edition: p.edition };
  const log: string[] = []; const note = (m: string) => { log.push(m); console.log(m); };
  let savedChanged = false;
    const dayLine = new Date(String(row.brief_date) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    const ed = String(row.edition);
    // every edition speaks BLUF in at most ~90 seconds at a NORMAL pace: bottom line first, then only what matters
    const spec = ed === "midday" ? { len: "a 60-to-80 second (150-190 word)", who: "midday-desk", floor: 110 }
      : ed === "close" ? { len: "a 75-to-90 second (170-210 word)", who: "end-of-day", floor: 130 }
      : ed === "assessment" ? { len: "a 75-to-90 second (170-215 word)", who: "portfolio-strategist", floor: 130 }
      : ed === "weekend" ? { len: "a 75-to-90 second (170-210 word)", who: "weekend-desk (direction and company news, no tape)", floor: 130 }
      : ed === "kr_open" ? { len: "a 60-to-80 second (150-190 word)", who: "Korea-open desk (Korean names first, US names past tense)", floor: 110 }
      : ed === "kr_close" ? { len: "a 75-to-90 second (170-210 word)", who: "Korea-close desk (Korean names first, then the US open)", floor: 130 }
      : { len: "a 75-to-90 second (170-210 word)", who: "morning-desk", floor: 130 };
    // The FIDELITY law alone did not stop an invented threshold ("below seventy thousand dollars" with no
    // such figure anywhere in the brief), so the allowed figures are handed over explicitly.
    const figuresOf = (obj: unknown): string[] => {
      const t = JSON.stringify(obj ?? "");
      return [...new Set((t.match(/-?\d[\d,]*(?:\.\d+)?\s?%|\$\s?[\d,]+(?:\.\d+)?[kKmMbB]?|₩\s?[\d,]+(?:\.\d+)?/g) ?? []).map((x) => x.trim()))].slice(0, 24);
    };
    const allowed = figuresOf(s);
    const figureLine = allowed.length
      ? `\nALLOWED FIGURES (the ONLY numbers you may speak, rounded for the ear): ${allowed.join(", ")}. Any other number is a fabrication: if a threshold or level is not in this list, describe it in words instead ("below its trigger level").`
      : "\nThe brief carries no figures: speak none.";
    const isAssess = ed === "assessment";
    const nameLine = names.length ? `\nSPEECH NAMES (say these, never spell a ticker letter by letter): ${names.map(([k, v]) => `${k} = ${v}`).join("; ")}` : "";
    // ---- script: tight-budget model call, else deterministic fallback ----
    let spoken: string | null = null;
    // A saved script (this row already ran once, TTS was the part that failed) is reused as-is: it was
    // normalized when it was written, and re-composing it every 10-minute sweep would spend a model call.
    if (savedScript) spoken = savedScript;
    // ---- RESTATE (preferred, 9/28): say the verified card aloud in plain English --------------------------
    // The card already passed every written-brief guard and the compliance judge. Asking a model to invent fresh
    // verdicts for the ear produced stilted, padded prose and new errors ("its recent low of two point four
    // percent"); asking the stronger model to RESTATE the card naturally keeps the facts and fixes the tone.
    // The greeting is fixed by edition so the time of day is never wrong. Old paths below remain as backups.
    let restated = false;
    if (!spoken && key) {
      const wk = dayLine.split(",")[0];
      const greetR = ed === "kr_open" ? `Good morning. Korea just opened, and it's ${wk} there.` : ed === "kr_close" ? `Korea has closed for ${wk}. Here's how your Korean stocks did.`
        : ed === "weekend" ? `Hi, it's ${wk}. Here's your weekend read.` : ed === "assessment" ? `Hi. Here's a first look at your portfolio.`
        : ed === "close" ? `Good evening, it's ${wk}. Here's how the day ended.` : ed === "midday" ? `Good afternoon, it's ${wk}. Here's your midday check.` : `Good morning, it's ${wk}. Here's your brief.`;
      const restatePrompt = `Here is today's ${isAssess ? "portfolio assessment" : "portfolio brief"} card, already checked for accuracy:\n${JSON.stringify(s)}\n
Write what a warm, clear personal financial reporter would SAY reading this card aloud to its owner. Return STRICT JSON {"spoken": str}.
- It is spoken right after this greeting, so do NOT greet or introduce it: "${greetR}"
- ORDER: (1) the bottom line for their money, from the card's first line, in one or two sentences; (2) the ${isAssess ? "two or three" : "one or two"} holdings that mattered most and WHY, one or two sentences each; (3) the one risk or thing to watch next, from the card; then stop. Do not add a sign-off.
- About 45 to 75 seconds of speech: 100 to 170 words. Short, natural sentences, the way people talk. Contractions are good.
- FACTS: use ONLY what is on the card. Do not add numbers, dates, prices, levels, reasons or predictions that are not on the card. At most FOUR figures in total. Keep each figure exactly as the card has it; you may drop the decimal only at ten percent and above.
- Write figures in digits exactly as on the card ("3.5%", "$44,900", "₩1,300", "Nov 3"); they are converted for the voice afterwards.
- No predictions: never say what a stock "will" or "will likely" do, "is set to", or "is poised to". Describe what happened and what to watch, not what comes next.
- Never describe a size as a fraction ("half", "a third", "almost half", "a quarter"): say the percent from the card.
- Never tell them to buy, sell, trim, add, rotate or "consider" anything; never say "keep an eye on"; never speak as "we".
${p.voiceLine} Company names only, never ticker codes.${nameLine}${figureLine}
PLAIN ENGLISH for every listener: talk like you would to a smart friend who does not work in finance. No trading slang or shorthand: no "dip", "sleeve", "tilt", "drawdown", "bleeding", "re-rating", "the tape", "bid", "unwind", "catalyst", "print", "canary", "rotation", "headwind", "tailwind", "book value", "yield noise", "discount to common", "concentration risk". Say it plainly: "a drop", "your Korean stocks", "the reason", "the earnings report", "having so much riding on one stock". No parentheses and no abbreviations like ET, KST, YoY or Q3.`;
      const FRACR = /\b(half|a third|one third|two thirds|a quarter|one quarter|three quarters|a fifth)\b/i;
      const allowedR = new Set([...allowed.map((x) => x.replace(/[$₩,%\s]/g, "")), ...((JSON.stringify(s) + " " + names.map(([, v]) => v).join(" ")).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""))]);
      const strayR = (x: string) => (x.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).some((n) => !allowedR.has(n.replace(/,/g, "")) && !/^(?:[12]?\d|3[01])$/.test(n));
      const avoid: string[] = [];
      for (let a = 0; a < 3 && !spoken; a++) {
        const model = a < 2 ? "MiniMax-M3" : "gpt-oss-120b";
        const promptNow = avoid.length ? `${restatePrompt}\nA previous draft had sentences that broke the rules (advice, forecast, a figure for the wrong subject, or an unsupported claim). Do NOT say anything like: ${avoid.map((x) => `"${x}"`).join("; ")}` : restatePrompt;
        const out = await askModel(key, "You turn a written portfolio card into a natural spoken script. Output only the JSON.", promptNow, model === "MiniMax-M3" ? 20000 : 6000, a === 0 ? 50000 : 40000, model);
        const sp = out && typeof (out as { spoken?: unknown }).spoken === "string" ? String((out as { spoken: string }).spoken).replace(/\s+/g, " ").trim() : "";
        if (!sp) { note(`narrate: restate attempt ${a + 1} (${model}) produced nothing: ${lastModelErr}`); continue; }
        const w = sp.split(/\s+/).length;
        const why = [w < 70 ? `short ${w}w` : "", w > 210 ? `long ${w}w` : "", !/[.!?]$/.test(sp) ? "unfinished" : "", FRACR.test(sp) ? "fraction" : "",
          strayR(sp) ? "figure not on card" : "", spokenFigureUnsupported(sp, allowed) ? "spoken figure not on card" : "", hasDanglingSentence(sp) ? "dangling" : "",
          /\bwe(?:'|\u2019)?(?:ll|'re|\s)/i.test(sp) ? "we-voice" : "", /\b(consider|keep an eye on)\b/i.test(sp) ? "advice word" : "", /\bwill (?:likely |probably )?(?:keep|continue|rise|fall|drop|climb|hurt|help|recover|rebound)\b|\bis (?:set|poised) to\b/i.test(sp) ? "prediction" : ""].filter(Boolean);
        if (why.length) { note(`narrate: restate attempt ${a + 1} rejected: ${why.join(", ")}${why.includes("figure not on card") ? ` [${(sp.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).filter((n) => !allowedR.has(n.replace(/,/g, "")) && !/^(?:[12]?\d|3[01])$/.test(n)).join(" ")}] allowed=${[...allowedR].join(" ")}` : ""}`); continue; }
        // the model sometimes opens with the greeting it was told not to repeat: drop any copy of it
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
        let body = sp;
        for (const g of greetR.split(/(?<=[.!?])\s+/)) if (norm(body).startsWith(norm(g))) body = body.slice(body.toLowerCase().indexOf(g.slice(-6).toLowerCase()) + 6).trim();
        // run the script guards and the compliance judge HERE, so a flagged sentence gets a clean rewrite instead
        // of being cut out later (a cut once removed the bottom line and left "also took a hit" dangling)
        if (a < 2) {
          const flaggedG = scriptProblems(body, JSON.stringify(s), String(row.brief_date), names);
          const sentsJ = body.split(/(?<=[.!?])\s+/).filter(Boolean);
          const jj = await callJudge(key, sentsJ, 8000);
          const flaggedJ = jj.status === "ok" && jj.flags ? [...jj.flags].map((i) => sentsJ[i]).filter(Boolean) : [];
          const flagged = [...new Set([...flaggedG, ...flaggedJ])];
          if (flagged.length) {
            note(`narrate: restate attempt ${a + 1} had flagged sentence(s), rewriting: ${flagged.map((f) => JSON.stringify(f.slice(0, 80))).join(" | ")}`);
            avoid.push(...flagged);
            continue;
          }
        }
        spoken = `${greetR} <break time="0.5s" /> ${body}`; restated = true;
      }
    }
    if (!spoken && key) {
      // ---- SLOT COMPOSITION (preferred) ----------------------------------------------------
      // Free composition scored after the fact plateaus: the model buries the verdict and pads,
      // so BLUF and understandability sat at 92 no matter how the prompt was worded. Here the MODEL
      // still writes every sentence, but the CODE fixes the running order and the caps, which makes
      // bottom-line-first structural instead of hoped-for. If anything about the slots looks wrong we
      // fall through to the original free-composition loop untouched, so the worst case is the old behaviour.
      const nPoints = isAssess ? 3 : 2;
      const allowedDigits = new Set(allowed.map((x) => x.replace(/[$,%\s]/g, "")));
      const strayDigitFigure = (x: string) => (x.replace(/<[^>]*>/g, " ").match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
        .some((n) => !allowedDigits.has(n.replace(/,/g, "")));
      const voiceLine = p.voiceLine;
      const beginner = /BEGINNER/.test(voiceLine);
      const earBan = beginner
        ? " BANNED WORDS for this listener, no exceptions: beta, alpha, ROE, ROIC, EBITDA, FCF, EPS, AUM, NII, NIM, CET1, capex, basis points, drawdown, Sharpe, duration, tilt, cash drag, hash rate, free cash flow, multiple compression, valuation multiple. Say what the word MEANS in ordinary English instead: for beta say how sharply it moves compared with the market, for free cash flow say the cash left after the bills."
        : "";
      const slotPrompt = `${isAssess ? "Assessment" : "Brief"}:\n${JSON.stringify(s)}\n\nReturn STRICT JSON:
{"bottom_line": str, "because": str, "points": [{"name": str, "point": str}], "risk": str, "next": str}

You are a sharp, warm ${spec.who} talking to ONE client. Short sentences. Contractions. Opinionated where the facts back it, never wishy-washy. Write each field as COMPLETE SENTENCES that can be read aloud back to back.
bottom_line: the ONE thing this means for their money, stated as a VERDICT, not a summary. 14-24 words. Never open with a greeting, never announce what this is, never start with "Today" or "This".
because: why that verdict is true, with the structural fact behind it. 16-26 words. AT MOST ONE figure.
points: the ${nPoints === 3 ? "two or three" : "one or two"} things that actually changed the picture. name = the company in plain words. point 16-28 words, AT MOST ONE figure each, and say why it matters rather than how it moved. NEVER walk through the holdings in turn.
risk: ONE COMPLETE SENTENCE with a subject and a verb, never a fragment: name the single thing that would make this worse, AND the CHECKABLE condition that would confirm it - a level, a date, a print, or a percentage the listener could actually look up. 16-26 words. "If markets fall" is not a tripwire; "if it closes below its summer low" is. Constructive, never bare doom.
next: the one concrete thing ahead, as a COMPLETE SENTENCE. 10-18 words. Never start a field with If, Unless, When or Because unless the same sentence also carries the main clause after a comma.\nThe assembled script must run 120 to 190 spoken words in total: write full sentences, not clipped notes.

NUMBER RULES: Money is spoken with the currency LAST and never as a symbol ("three million dollars", never "$3 million", "3 dollar million" or "$3M"); a percentage is the number followed by "percent". at most FIVE figures across ALL fields combined. Round for the ear ONLY where rounding is harmless: at ten percent and above drop the decimal (34.3% is "thirty-four percent"), and BELOW ten percent keep it (1.5% is "one point five percent", never "two percent"; 0.2% is "zero point two percent"). $43,224 is "forty-three thousand dollars". Never describe a holding's size as a fraction (half, a third, a quarter): say the rounded percent.
Never tell them to buy, sell, trim, add or rotate. Never say "keep an eye on". Never speak as "we" about acting on their money. ${voiceLine}${earBan} No ticker codes, company names only. PLAIN ENGLISH, for every listener: talk the way you would explain it to a smart friend who does not work in finance. Never use trading slang or shorthand: no "dip", "sleeve", "tilt", "drawdown", "bleeding", "re-rating", "the tape", "bid", "unwind", "catalyst", "print", "canary", "rotation", "headwind", "tailwind", "book value", "concentration risk". Say it plainly instead: "a drop", "your Korean stocks", "a decline", "the reason", "the earnings report", "having so much in one stock". Never use parentheses, abbreviations (ET, KST, YoY, Q3) or symbols; say dates as a person would ("October twenty-ninth").${nameLine}${figureLine}`;

      type Slots = { bottom_line: string; because: string; points: { name: string; point: string }[]; risk: string; next: string };
      const oneSentence = (x: unknown) => String(x ?? "").replace(/\s+/g, " ").trim();
      const FRAGMENT = /^(if|unless|when|because|while|although|though)\b[^,]*$/i;   // opener with no main clause
      let lastTry = false;
      const okSlots = (o: unknown): o is Slots => {
        const v = o as Slots;
        if (!v || !oneSentence(v.bottom_line) || !oneSentence(v.because) || !oneSentence(v.risk)) return false;
        if (!Array.isArray(v.points) || v.points.length < 1 || v.points.length > nPoints) return false;
        if (!v.points.every((p) => p && !!oneSentence(p.point))) return false;
        const fields = [v.bottom_line, v.because, v.risk, v.next ?? "", ...v.points.map((p) => p.point)];
        return lastTry ? true : !fields.some((f) => FRAGMENT.test(oneSentence(f).replace(/[.!?]+$/, "")));
      };
      const period = (x: string) => (/[.!?]$/.test(x) ? x : x + ".");
      const weekday = dayLine.split(",")[0];
      const greet = ed === "kr_open" ? `Korea is open, it's ${weekday} there. Here's your Korea open pulse.` : ed === "kr_close" ? `Korea has closed for ${weekday}. Here's your Korea closing note.` : ed === "weekend" ? `Hi, it's ${weekday}. Here's your weekend read.` : ed === "morning" ? `Good morning, it's ${weekday}.` : `Good afternoon, it's ${weekday}.`;
      for (let a = 0; a < 3 && !spoken; a++) {
        lastTry = a === 2;
        const raw = await askModel(key, "You write the parts of a spoken investment brief. Output only the JSON.", slotPrompt, 6000, a === 0 ? 45000 : 40000, "gpt-oss-120b");
        if (!okSlots(raw)) continue;
        const body = [
          period(oneSentence(raw.bottom_line)), period(oneSentence(raw.because)),
          '<break time="0.6s" />',
          ...raw.points.slice(0, nPoints).map((p) => period(oneSentence(p.point))),
          '<break time="0.6s" />',
          period(oneSentence(raw.risk)), period(oneSentence(raw.next)),
        ].filter((x) => x && x !== ".").join(" ");
        const draft = `${greet} <break time="0.5s" /> ${body}`;
        const heardW = draft.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
        // the same accept-only-never-edit checks the free path uses, plus the figure budget
        const FRACW0 = /\b(half|a third|one third|two thirds|a quarter|one quarter|three quarters|a fifth)\b/i;
        const figs = (draft.replace(/<[^>]*>/g, " ").match(/-?\d[\d,]*(?:\.\d+)?\s?%|\$\s?[\d,]+|(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w%])/g) ?? []).length;
        const unsupported = spokenFigureUnsupported(draft, allowed);
        const heardFigs = figs + spokenQuantities(draft).length;   // the diet counts what the EAR receives, spelled or not
        const jargon = beginner && EAR_JARGON.test(draft.replace(/<[^>]*>/g, " "));
        // a figure written in DIGITS must be in the brief too, not just the spelled ones
        const strayDigits = strayDigitFigure(draft);
        // ESCALATING LENIENCY, the same lesson the free path already learned: seven gates applied at
        // full strength on every attempt reject so often that generation falls through to the
        // deterministic template, which is a holdings walkthrough - worse than anything these gates
        // were protecting against. The last attempt therefore enforces only what changes MEANING
        // (a figure the brief does not support, or jargon aimed at a beginner) and forgives the
        // cosmetic caps. A slightly long script beats the template every time.
        // The guard stack kept growing and the escalation did not keep pace: on novice/assessment every
        // attempt failed SOMETHING, so narration fell through to the deterministic template - a holdings
        // walkthrough, the single worst output this brief can produce, and it drags B2, B3 and B8 down
        // together. Ranking matters: a FABRICATED FIGURE is the only defect worse than the template.
        // Everything else (a jargon word, a stray digit, a fraction, a clipped sentence) is a blemish on
        // a script that still beats reciting the holdings.
        const fabricated = unsupported || strayDigits;
        const meaningBad = fabricated || jargon || FRACW0.test(draft) || hasDanglingSentence(draft);
        const tidyBad = heardFigs > 6;
        const ok = a === 2 ? !fabricated : a === 1 ? !meaningBad : !(meaningBad || tidyBad);
        if (heardW >= 104 && heardW <= 205 && ok) spoken = draft;   // 104 + the appended sign-off clears the 100-word length bar
        if (unsupported && a === 1) note("narrate: slot script spoke a figure the brief does not support");
      }
      if (!spoken) note("narrate: slot composition did not land, falling back to free composition");
      const prompt = isAssess
        ? `Assessment:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken script of this portfolio assessment, BOTTOM LINE UP FRONT, at a normal unhurried pace. It is the FIRST look at a client's newly added portfolio. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} speaking to ONE client they are just getting to know; confident and OPINIONATED where the facts back it, never wishy-washy; straightforward and data-driven but constructive: a risk always comes with what to watch or do about it, never bare doom. Short sentences. Contractions. STRUCTURE - exactly these beats and NOTHING more: (1) a quick greeting, never introducing yourself or announcing what this is; (2) the VERDDICT and single most important structural fact in the first two sentences, then only the TWO OR THREE things that matter most (not every position), one clear risk, one thing worth looking into, and the sign-off ("That's your assessment. Talk soon."), which the script MUST end with. NUMBER RULES: Money is spoken with the currency LAST and never as a symbol ("three million dollars", never "$3 million", "3 dollar million" or "$3M"); a percentage is the number followed by "percent". at most FIVE numbers in the whole script; round everything for the ear (34.3% becomes thirty-four percent; $43,224 becomes forty-three thousand dollars); never read decimals aloud ABOVE one percent; a figure UNDER one percent keeps its decimal ("zero point two percent"), because rounding 0.2% to "two percent" changes the fact tenfold. NEVER describe a holding's size as a fraction (half, a third, a quarter): say the rounded percent instead, because a fraction that misses changes the fact. FIDELITY: every figure you speak must trace to the assessment. Rounding for the ear is required, changing the fact is not: never turn a percentage into a fraction word that does not match it (a quarter is 25%, a third is 33%, half is 50%); if the fraction is not a clean match, say the rounded percent instead. AT MOST TWELVE SENTENCES IN TOTAL. Every sentence must carry a fact or a judgement the listener did not already have: never restate a point in different words, never add generic market commentary to fill time, and never speak as "we" about acting on their money ("we'll monitor", "we'll adjust"). A short script that says three things well beats a long one that lists ten. Insert <break time="0.6s" /> between beats. Use ONLY facts from the assessment. Never tell them to buy or sell. ${p.voiceLine} No ticker codes, company names only. PLAIN ENGLISH, for every listener: talk the way you would explain it to a smart friend who does not work in finance. Never use trading slang or shorthand: no "dip", "sleeve", "tilt", "drawdown", "bleeding", "re-rating", "the tape", "bid", "unwind", "catalyst", "print", "canary", "rotation", "headwind", "tailwind", "book value", "concentration risk". Say it plainly instead: "a drop", "your Korean stocks", "a decline", "the reason", "the earnings report", "having so much in one stock". Never use parentheses, abbreviations (ET, KST, YoY, Q3) or symbols; say dates as a person would ("October twenty-ninth").${nameLine}${figureLine} Never mention that this is generated.`
        : `Brief:\n${JSON.stringify(s)}\n\nReturn STRICT JSON {"spoken": str}.
spoken: ${spec.len} spoken radio script of this brief, BOTTOM LINE UP FRONT, at a normal unhurried pace. Today is ${dayLine}; use it in the greeting and never guess a different weekday. Voice: a sharp, warm ${spec.who} analyst speaking to ONE client they know well; confident and opinionated where the facts back it; constructive: a risk always comes with what to watch or do about it, never bare doom. Short sentences. Contractions. STRUCTURE - exactly these beats and NOTHING more: (1) a quick greeting, never introducing yourself or announcing what this is; (2) WHAT TODAY MEANS for their money in the first two sentences (never a list of moves), then the two or three things that actually matter with why, one look-ahead, and the sign-off ("That's your brief. Talk soon."), which the script MUST end with. NUMBER RULES: Money is spoken with the currency LAST and never as a symbol ("three million dollars", never "$3 million", "3 dollar million" or "$3M"); a percentage is the number followed by "percent". at most FIVE numbers in the whole script; round for the ear (down 2.3% becomes down two percent; $43,224 becomes forty-three thousand dollars); never read a stock-by-stock percentage list, and never walk through the holdings ONE BY ONE even without numbers: naming each position in turn with how it moved ("X slipped a fraction, Y fell a little, Z dropped two percent") is the very pattern this brief exists to replace. Name AT MOST TWO holdings, the ones that actually changed the picture, and say why they matter. NEVER DROP A DECIMAL: 0.2% is "zero point two percent" and 0.4% is "zero point four percent", never "two percent" or "four percent"; a figure under one percent keeps its decimal or is spoken as "a fraction of a percent". Never tell them to buy, sell, trim, add, or rotate, and never say "keep an eye on": name the risk and what would confirm it instead. NEVER describe a holding's size as a fraction (half, a third, a quarter): say the rounded percent instead, because a fraction that misses changes the fact. FIDELITY: every figure you speak must trace to the brief. Rounding for the ear is required, changing the fact is not: never turn a percentage into a fraction word that does not match it (a quarter is 25%, a third is 33%, half is 50%); if the fraction is not a clean match, say the rounded percent instead. AT MOST TWELVE SENTENCES IN TOTAL. Every sentence must carry a fact or a judgement the listener did not already have: never restate a point in different words, never add generic market commentary to fill time, and never speak as "we" about acting on their money ("we'll monitor", "we'll adjust"). A short script that says three things well beats a long one that lists ten. Insert <break time="0.6s" /> between beats. Insert <break time="0.7s" /> between sections. Use ONLY facts from the brief. ${p.voiceLine} No ticker codes, company names only. PLAIN ENGLISH, for every listener: talk the way you would explain it to a smart friend who does not work in finance. Never use trading slang or shorthand: no "dip", "sleeve", "tilt", "drawdown", "bleeding", "re-rating", "the tape", "bid", "unwind", "catalyst", "print", "canary", "rotation", "headwind", "tailwind", "book value", "concentration risk". Say it plainly instead: "a drop", "your Korean stocks", "a decline", "the reason", "the earnings report", "having so much in one stock". Never use parentheses, abbreviations (ET, KST, YoY, Q3) or symbols; say dates as a person would ("October twenty-ninth").${nameLine}${figureLine} Never mention that this is generated.`;
      for (let a = 0; a < 3 && !spoken; a++) {
        // every edition is written by the fast model: M2.7 over-thinks these shapes and times out, and the
        // deterministic fallback recites every position in turn, which is the laundry list BLUF forbids
        // 35s was too tight on a slow model wave, and every timeout costs a WRITTEN script and hands the
        // listener the deterministic template instead. A template read is always worse than a late script.
        const out = await askModel(key, "You turn a written investment brief into a vivid spoken radio script. Output only the JSON.", prompt, 9000, a === 0 ? 55000 : 45000, "gpt-oss-120b");
        if (!out) note(`narrate: script attempt ${a + 1} produced nothing (model timeout or error)`);
        const sp = out && typeof (out as { spoken?: unknown }).spoken === "string" ? String((out as { spoken: string }).spoken) : null;
        // on the last attempt a slightly short model script is still far better than the template
        const floorNow = a === 2 ? Math.round(spec.floor * 0.75) : spec.floor;
        // a fraction word describing a weight is a rule violation we can see: regenerate rather than ship it
        const FRACW = /\b(half|a third|one third|two thirds|a quarter|one quarter|three quarters|a fifth)\b/i;
        // a holdings walkthrough is the pattern this brief exists to replace, and three prompt versions have
        // not reliably stopped it: detect it and regenerate, the way a stray fraction is handled
        const MOVEV = /\b(slipped|fell|dropped|rose|gained|climbed|declined|advanced|sank|jumped|edged|ticked)\b/i;
        const MKTS = /\b(market|S&P|SPX|futures|volatility|VIX|the index|indices|portfolio|your book|the book|dow)\b/i;
        const walkthrough = (x: string) => x.split(/(?<=[.!?])\s+/).filter((y) => MOVEV.test(y) && !MKTS.test(y)).length >= 3;
        if (sp) {
          const t = sp.replace(/(?:\s*<break[^>]*\/>\s*)+$/g, "").trim();
          // beat cap: a 90-second script is ~12 sentences. More than that and the model is padding with
        // restatement and generic commentary, which is what makes the back half of a brief worthless.
        const beats = t.replace(/<[^>]*>/g, " ").split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3).length;
        const padded = beats > 14 || /\bwe(?:'|\u2019)?ll\b/i.test(t);
        // Escalating leniency: the first attempt must be tight, the second need only avoid the two errors
        // that change meaning, the last takes what it can get. Being strict on every attempt pushed the
        // narration into the deterministic template, which reads far worse than a slightly long script.
        // A spoken script spells numbers for the ear, so a stray ARABIC NUMERAL is either a figure the
        // model failed to spell or one it invented. Either way it is checkable against the allowed set
        // with no word-number parser: "It climbed 1 percent adding roughly 15 dollars" and a "50%" that
        // appears nowhere in the brief were both caught this way. A miss only regenerates - it never
        // edits the script - so this cannot corrupt a figure the way a rewriting scrub can.
        const allowedNums = new Set(allowed.map((x) => x.replace(/[$,%\s]/g, "")));
        const strayFigure = (x: string) => (x.replace(/<[^>]*>/g, " ").match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
          .some((n) => !allowedNums.has(n.replace(/,/g, "")));
        const meaningOk = !FRACW.test(t) && !walkthrough(t) && !strayFigure(t) && !spokenFigureUnsupported(t, allowed) && !hasDanglingSentence(t)
          && !(beginner && EAR_JARGON.test(t.replace(/<[^>]*>/g, " ")));
        const accept = a === 2 ? true : a === 1 ? meaningOk : (meaningOk && !padded);
        // count SPOKEN words: the SSML tags are never heard, and counting them let a 90-word script
        // clear a 97-word floor
        const heardWords = t.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
        if (heardWords >= floorNow && /[.!?]$/.test(t) && accept) spoken = t;
        }
      }
    }
    let usedFallback = false;
    // The SAME guards as the written brief, on what will be SPOKEN (round 4: the midday script promised
    // "boosting future returns", read Microsoft's 3.7% rise as "added three point seven percent weight", and
    // said "if NVIDIA falls below zero point two percent"). The script may only restate the guarded sections:
    // an offending sentence is deleted; a script that loses too much becomes the template built from them.
    if (spoken) {
      const bad = scriptProblems(spoken, JSON.stringify(s), String(row.brief_date), names);
      if (bad.length) {
        const kept = spoken.split(/(?<=[.!?])\s+/).filter((x) => !bad.some((b) => x.replace(/<break[^>]*\/>/g, " ").includes(b)));
        const heard = kept.join(" ").replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
        note(`narrate: ${bad.length} script sentence(s) failed the brief guards; ${heard} words left :: ${bad.map((b) => JSON.stringify(b.slice(0, 90))).join(" | ")}`);
        spoken = heard >= (restated ? 60 : Math.round(spec.floor * 0.7)) ? kept.join(" ") : null;
        if (savedScript && spoken) savedChanged = true;
      }
    }
    // r10 intelligence: the v11 close's script said "no immediate upside or downside to worry about", "reinforcing
    // confidence in Azure's growth trajectory" and "Watch for Microsoft earnings next week" (MSFT reports ~Oct 28), none
    // of it on the card. The spoken script now passes the same gates as the written card: sanitize() on each sentence,
    // every dated event must appear on the card, and the compliance judge reads it. A script the judge cannot read is
    // not used: the listener gets the deterministic script built from the card itself.
    if (spoken) {
      const plain = (x: string) => x.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const card = [s.lede, s.overnight, s.desk_view, s.horizon ?? "", ...(s.positions ?? []).flatMap((p) => [p.name, p.note, p.watch]), ...(s.calendar ?? [])].join("\n");
      const nm = [...new Set((s.positions ?? []).map((p) => p.name))];
      const sents = spoken.split(/(?<=[.!?])\s+/);
      const events = new Set(ungroundedEventSentences(plain(spoken), card, nm));
      const j = key ? await callJudge(key, sents.map(plain), 6000) : { flags: null, status: "skipped" as const };
      if (j.status !== "ok" || !j.flags) { note(`narrate: script judge ${j.status}${j.detail ? ` (${j.detail})` : ""}; the card-built script is used`); spoken = null; }
      else {
        const kept = sents.filter((x, i) => {
          const t = plain(x);
          if (!t || /^(?:that'?s your|talk soon|good (?:morning|afternoon|evening))/i.test(t)) return true;
          return !j.flags!.has(i) && !events.has(t) && ![...events].some((e) => e.includes(t) || t.includes(e)) && sanitize(t).trim().length > 0;
        });
        const heard = kept.join(" ").replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
        if (kept.length !== sents.length) note(`narrate: ${sents.length - kept.length} script sentence(s) failed the card gates; ${heard} words left :: ${sents.filter((x) => !kept.includes(x)).map((x) => JSON.stringify(plain(x).slice(0, 90)) + (j.flags!.has(sents.indexOf(x)) ? "[judge]" : "[event/sanitize]")).join(" | ")}`);
        spoken = heard >= (restated ? 60 : Math.round(spec.floor * 0.7)) ? kept.join(" ") : null;
      }
    }
    if (!spoken) { spoken = fallbackScript(s, dayLine, ed); usedFallback = true; }
    if (!savedScript || usedFallback) {
      spoken = roundEar(spoken);
      spoken = earWords(sayNames(earNumbers(spoken.replace(/(\d+(?:\.\d+)?)\s?percent/gi, "$1%").replace(/(\d[\d,]*(?:\.\d+)?)\s?dollars/gi, "$$$1")), names));   // normalize then round: every spoken number comes out rounded, tickers come out as company names
      if (!/(talk soon|see you|that's your|that’s your)/i.test(spoken.slice(-120))) spoken += ` <break time="0.6s" /> ${isAssess ? "That's your assessment." : "That's your brief."} Talk soon.`;
  }
  // the voice (ElevenLabs or the device's) reads only words: figures, dates, times and symbols are spelled out and
  // trade slang is said plainly. Deterministic and idempotent, so a saved script passes through unchanged.
  const heard = speakable(spoken, names);
  if (savedScript && heard !== spoken) savedChanged = true;
  spoken = heard;
  return { spoken, usedFallback, savedChanged, log };
}
