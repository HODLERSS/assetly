// Spoken-number and spoken-word helpers shared by the narrate handler and its tests.
// r12 D: the card said +3.7% and the script said "up 4 percent": under 10% the card's one decimal is spoken (the same
// line roundEar draws for spelled-out figures); from 10% up the whole number carries it
export const roundPct = (v: number) => (Math.abs(v) < 1 ? v.toFixed(1) : Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)));
const MON_ABBR: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", jun: "June", jul: "July", aug: "August", sep: "September", sept: "September", oct: "October", nov: "November", dec: "December" };
/** r12 D: marks a reader skims but a voice reads literally ("~Oct 28 (est)" was spoken as "tilde Oct 28 est"), and the
 *  possessive of a name ending in s ("Meta Platforms's"). Runs before the numbers and again after the names go in. */
export const earWords = (t: string) => String(t ?? "")
  .replace(/\s*\((?:est\.?|estimated|e)\)/gi, ", estimated")
  .replace(/(^|[\s(])~\s?(?=[$₩\d]|[A-Z][a-z]{2})/g, "$1around ")
  .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?(?=\s+\d{1,2}\b)/g, (_m, a: string) => MON_ABBR[a.toLowerCase()] ?? a)
  .replace(/\b([A-Z][A-Za-z]*s)['’]s\b/g, "$1'")
  .replace(/,\s*estimated\s*([.,;])/g, ", estimated$1").replace(/,\s*,/g, ",");

/** What a voice engine reads badly or a listener stumbles on. The harness and the tests use it; the
 *  speakable() pass below exists to drive this list to empty. Each entry names the problem and the text. */
export const EAR_PLAIN_WORDS = /\b(sleeve|dip|dips|drawdown|tilt|bleeding|book value|re-?rating|tape|unwind|canary|catalysts?|headwinds?|tailwinds?|bid|print|beta|alpha|EBITDA|FCF|EPS|capex|basis points|multiple compression|dry powder|megacap|cash drag|risk-off|risk-on|de-?risk|overweight|underweight|rotation|income book)\b/gi;
export function earAudit(t: string): string[] {
  const x = String(t ?? "").replace(/<[^>]*>/g, " ");
  const out: string[] = [];
  const hit = (label: string, re: RegExp) => { const m = x.match(re); if (m) out.push(`${label}: ${[...new Set(m)].slice(0, 4).join(", ")}`); };
  hit("digits", /\d[\d,.:]*/g);
  hit("symbols", /[$₩%&~()\[\]{}#@*_/\\|]/g);
  hit("odd dash or quote", /[‐-―−‘’“”]/g);
  hit("all-caps", /\b(?!AI\b|US\b|UK\b|EU\b|CEO\b|ETF\b|VIX\b|AMD\b|OK\b|TV\b|NVIDIA\b|SK\b|AM\b|PM\b|IBK\b|KOSPI\b|P\b|S\b|O\b|I\b)[A-Z]{2,}\b/g);
  hit("signed move", /\b(?:rose|fell|climbed|dropped|gained|slid|up|down|slipped)\s+(?:plus|minus)\b/gi);
  hit("jargon", EAR_PLAIN_WORDS);
  hit("doubled punctuation", /[.,]\s*[.,]/g);
  return out;
}

// ---- speakable(): the last pass before any voice reads a script -------------------------------------------
// Owner feedback 9/28: the voice read "1,300 won" and dates awkwardly and the scripts leaned on trade slang
// (dip, sleeve). Voice engines guess at digits, symbols and non-breaking hyphens; people don't. So the script
// that reaches a voice (ElevenLabs or the device's) carries NO digits and NO symbols: every figure is written
// out in words here, deterministically, from the same figure the guards already checked. It never invents a
// number: each conversion is a pure rewrite of the digits in front of it.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const under1000 = (n: number): string => {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? (r ? ONES[r] : "") : TENS[Math.floor(r / 10)] + (r % 10 ? "-" + ONES[r % 10] : "");
  return [h ? ONES[h] + " hundred" : "", rest].filter(Boolean).join(" ");
};
export const intWords = (n: number): string => {
  n = Math.round(Math.abs(n));
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [v, w] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as [number, string][]) {
    if (n >= v) { parts.push(under1000(Math.floor(n / v)) + " " + w); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(" ");
};
/** "1.75" -> "one point seven five"; digits after the point are read one by one, as people say them. */
export const numWords = (raw: string): string => {
  const s = String(raw).replace(/,/g, "");
  const [i, f] = s.split(".");
  const whole = intWords(Number(i || "0"));
  return f ? `${whole} point ${f.split("").map((d) => ONES[Number(d)]).join(" ")}` : whole;
};
const ORDW: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
export const ordinalWords = (n: number): string => {
  const w = intWords(n);
  const m = w.match(/(.*?)([a-z]+)$/)!;
  const last = m[2];
  const o = ORDW[last] ?? (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return m[1] + o;
};
const yearWords = (y: number) => (y >= 2000 && y < 2010 ? intWords(y) : `${intWords(Math.floor(y / 100))} ${y % 100 < 10 ? "oh " + ONES[y % 100] : intWords(y % 100)}`);
/** A figure with a magnitude, rounded the way a person says it: 1,761,000 -> "1.76 million", 45000 -> "45 thousand". */
const sayMagnitude = (v: number, unit: string): string => {
  const a = Math.abs(v);
  const fmt = (x: number) => numWords(x.toFixed(2).replace(/\.?0+$/, ""));
  if (a >= 1e12) return `${fmt(a / 1e12)} trillion ${unit}`;
  if (a >= 1e9) return `${fmt(a / 1e9)} billion ${unit}`;
  if (a >= 1e6) return `${fmt(a / 1e6)} million ${unit}`;
  if (a >= 10000) { const g = Math.pow(10, Math.floor(Math.log10(a)) - 3); return `${intWords(Math.round(a / g) * g)} ${unit}`; }
  if (a >= 1000) return `${intWords(Math.round(a))} ${unit}`;
  return `${numWords(String(Math.round(a * 100) / 100))} ${unit}`;
};
const MAGN: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

// Trade slang -> the plain word a listener already knows. Applied to every listener: the owner asked for plain
// English, and these words cost an experienced listener nothing when said plainly.
const PLAIN: [RegExp, string][] = [
  [/\bKorean sleeve\b/gi, "Korean holdings"], [/\bUS sleeve\b/gi, "US holdings"], [/\bcrypto sleeve\b/gi, "crypto holdings"],
  [/\b(?:the |your |this )?sleeve\b/gi, "that part of the portfolio"],
  [/\bdips\b/gi, "drops"], [/\bdip\b/gi, "drop"], [/\bdrawdowns?\b/gi, "decline"], [/\bis bleeding\b/gi, "keeps falling"], [/\bbleeding\b/gi, "falling"],
  [/\bbook value\b/gi, "value"], [/\bre-?rating\b/gi, "run-up"], [/\bthe tape\b/gi, "the market"], [/\bunwind\b/gi, "sell-off"],
  [/\bcanary\b/gi, "early warning sign"], [/\bcatalysts?\b/gi, "trigger"], [/\bheadwinds?\b/gi, "pressure"], [/\btailwinds?\b/gi, "boost"],
  [/\bincome book\b/gi, "dividend stocks"], [/\bequity tilt\b/gi, "lean toward stocks"], [/\btilt\b/gi, "lean"],
  [/\bAI-?capex\b/gi, "AI spending"], [/\bcapex\b/gi, "spending on equipment"], [/\bEPS\b/g, "earnings per share"], [/\bFCF\b/g, "free cash"],
  [/\bfree cash flow\b/gi, "cash left over"], [/\bEBITDA\b/g, "operating profit"], [/\bbasis points\b/gi, "hundredths of a percent"],
  [/\bbuyback bid\b/gi, "buyback"], [/\brisk-off\b/gi, "cautious"], [/\brisk-on\b/gi, "confident"], [/\bprint\b(?=\s+(?:expected|due|on|in|next))/gi, "report"],
  [/\bsentiment tell\b/gi, "mood signal"], [/\bvalue-income hold\b/gi, "steady dividend holding"],
  [/\bdownside exposure\b/gi, "risk of losses"], [/\bupside potential\b/gi, "room to grow"],
  [/\bSamsung Electronics \(?Pref\)?|\bSamsung Pref\b/g, "Samsung Electronics preferred shares"], [/\bPref\b/g, "preferred shares"],
  [/\b8-K filed\b/g, "A company filing on"], [/\ban 8-K\b/g, "a company filing"], [/\b8-K\b/g, "a company filing"], [/\bHBM\b/g, "high-bandwidth memory"], [/\bKRX\b/g, "the Korean market"], [/(?<!\bthe )\bKOSPI\b/g, "the KOSPI"],
  [/\bvs\.?\s/gi, "versus "], [/\bYoY\b/g, "from a year ago"], [/\bQoQ\b/g, "from last quarter"], [/\bIPO\b/g, "I P O"],
];
// Names for the ear. Owner 9/29: "MARA" was spelled out M-A-R-A (it is said "Mah-rah"), and a ticker left in a
// script is read letter by letter (G-O-O-G-L). A script names a company the way people say it. SAY_AS fixes names a
// voice gets wrong; TICKER_SAY is the backstop for a ticker that slipped past the model and the per-user name list.
const SAY_AS: [RegExp, string][] = [
  [/\bMARA Holdings\b/gi, "Mara"], [/\bMARA\b/g, "Mara"], [/\bAlphabet\b/g, "Google"], [/\bAmazon\.com\b/gi, "Amazon"],
  [/\bARM\b/g, "Arm"],
];
export const sayAs = (t: string) => SAY_AS.reduce((x, [re, w]) => x.replace(re, w), String(t ?? ""));
export const TICKER_SAY: Record<string, string> = {
  GOOGL: "Google", GOOG: "Google", NVDA: "NVIDIA", AMZN: "Amazon", AAPL: "Apple", MSFT: "Microsoft", META: "Meta", TSLA: "Tesla",
  AVGO: "Broadcom", INTC: "Intel", RDDT: "Reddit", MSTR: "Strategy", "BRK.B": "Berkshire Hathaway", "BRK-B": "Berkshire Hathaway",
  ABNB: "Airbnb", UBER: "Uber", NFLX: "Netflix", ADBE: "Adobe", FIG: "Figma", COIN: "Coinbase", PLTR: "Palantir", ORCL: "Oracle",
  CRM: "Salesforce", HOOD: "Robinhood", SPOT: "Spotify", SHOP: "Shopify", COF: "Capital One", IREN: "Iren", SPACEX: "SpaceX",
  QQQM: "the Nasdaq one hundred fund", QQQ: "the Nasdaq one hundred fund", SPY: "the S and P 500 fund", VOO: "the S and P 500 fund",
  FXAIX: "the Fidelity 500 index fund", BTC: "bitcoin", ETH: "ether",
  "000660.KS": "SK hynix", "005930.KS": "Samsung Electronics", "005935.KS": "Samsung Electronics preferred shares",
  "024110.KS": "Industrial Bank of Korea", "003690.KS": "Korean Reinsurance",
};
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Every ticker code becomes the company's spoken name: the user's own list first, then TICKER_SAY. */
export function sayTickers(t: string, names: [string, string][] = []): string {
  const map = new Map<string, string>(Object.entries(TICKER_SAY));
  for (const [sym, nm] of names) if (nm && nm.toUpperCase() !== sym) map.set(sym, sayAs(nm));
  for (const [sym, nm] of [...map.entries()]) { const bare = sym.replace(/\.(KS|KQ)$/, ""); if (bare !== sym && !map.has(bare)) map.set(bare, nm); }
  let x = String(t ?? "");
  for (const sym of [...map.keys()].sort((a, b) => b.length - a.length)) {
    x = x.replace(new RegExp("(^|[^A-Za-z0-9$.])" + esc(sym) + "(?![A-Za-z0-9])", "g"), `$1${map.get(sym)}`);
  }
  return sayAs(x);
}
const TZ: Record<string, string> = { ET: "Eastern Time", EST: "Eastern Time", EDT: "Eastern Time", CT: "Central Time", KST: "Korea time", PT: "Pacific Time" };

/** Tags (<break time="0.5s" />) are markup, not words: only the text between them is rewritten. */
export function speakable(input: string, names: [string, string][] = []): string {
  const parts = String(input ?? "").split(/(<[^>]*>)/);
  const out = parts.map((p) => (p.startsWith("<") ? p : speakText(sayTickers(p, names))));
  return out.join(" ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}
// money written for the eye: "$150B", "$3.5M", "₩1,761,000", ranges "$100-150B", "$200–$250" -> "<n> <magnitude> <unit>".
// Runs first, before dashes become commas, so a range stays a range ("one hundred to one hundred fifty billion dollars").
const MAG_ABBR: Record<string, string> = { k: "thousand", m: "million", mn: "million", b: "billion", bn: "billion", t: "trillion" };
const magWord = (m?: string) => (m ? MAG_ABBR[m.toLowerCase()] ?? m.toLowerCase() : "");
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`, MAG = String.raw`(K|M|B|T|bn|mn|k|thousand|million|billion|trillion)?`;
function money(t: string): string {
  return t
    .replace(new RegExp(NUM + String.raw`\s*dollars\s*[-–—]\s*` + NUM + String.raw`\s*(K|M|B|T|bn|mn)\b`, "g"), (_m, a, b, m) => `$${a}-${b}${m}`)
    .replace(new RegExp(String.raw`([$₩])` + NUM + String.raw`\s?` + MAG + String.raw`\s*(?:[-–—]|\bto\b)\s*[$₩]?` + NUM + String.raw`\s?` + MAG + String.raw`(?![A-Za-z])`, "g"),
      (_m, c, a, m1, b, m2) => { const hi = magWord(m2 || m1), lo = magWord(m1); return `${a}${lo && lo !== hi ? " " + lo : ""} to ${b}${hi ? " " + hi : ""} ${c === "₩" ? "won" : "dollars"}`; })
    .replace(new RegExp(String.raw`([$₩])` + NUM + String.raw`\s?` + MAG + String.raw`(?![A-Za-z])`, "g"),
      (_m, c, a, m) => `${a}${m ? " " + magWord(m) : ""} ${c === "₩" ? "won" : "dollars"}`);
}
// slashes and product codes a voice reads literally: "MI355/MI400", "H100", "9/29", "Q3/Q4", "24/7"
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function codes(t: string): string {
  return t
    .replace(/\b24\/7\b/g, "around the clock")
    .replace(/(?<![\d.])(\d+\.\d+)\/(5|10|100)\b|(?<![\d.])(\d+)\/(5|10|100)(?=\s+(?:rating|stars?|score))/g, (_m, a, b, c, d) => `${a ?? c} out of ${b ?? d}`)
    .replace(/(?<![\d.\/])\b(1[0-2]|[1-9])\/(3[01]|[12]\d|[1-9])\b(?!\/)/g, (_m, mo, d) => `${MONTHS[Number(mo)]} ${d}`)
    .replace(/\band\/or\b/gi, "or")
    .replace(/([A-Za-z0-9])\s*\/\s*(?=[A-Za-z0-9])/g, "$1 and ")
    .replace(/\b([A-Z]{1,3})(\d{2,4})\b/g, (_m, l: string, n) => `${l.split("").join(" ")} ${n}`);
}
function speakText(input: string): string {
  let t = codes(money(String(input ?? "")));
  // 1) characters voices misread: non-breaking and figure hyphens, dashes, curly quotes, stray spaces
  t = t.replace(/[‐‑‒]/g, "-").replace(/\s*[–—―]\s*/g, ", ").replace(/−/g, "-")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[  ]/g, " ");
  // 2) asides written for the eye: "(as of the 4:00 PM ET close)", "(Pref)", "(est)"
  t = t.replace(/\s*\([^)]*\)/g, "");
  t = t.replace(/(^|[\s(])~\s?/g, "$1around ").replace(/\bQ([1-4])\b/g, (_m, q) => `${["", "first", "second", "third", "fourth"][Number(q)]} quarter`)
    .replace(/\bYTD\b/g, "year to date").replace(/\b(\d+(?:\.\d+)?)x\b/g, "$1 times");
  t = t.replace(/\bU\.S\.(?=\s+[a-z])/g, "US").replace(/\bU\.S\.?/g, "US");
  // 3) symbols and names with symbols
  t = t.replace(/\bS&P\s?500\b/g, "the S and P 500").replace(/\bthe the S and P\b/gi, "the S and P").replace(/\s*&\s*/g, " and ").replace(/\bNasdaq[- ]100\b/g, "Nasdaq one hundred");
  // 4) plain English
  for (const [re, w] of PLAIN) t = t.replace(re, w);
  // 5) clock times: "4:00 PM ET" -> "four p.m. Eastern"
  t = t.replace(/\b(\d{1,2}):(\d{2})(?:\s*(AM|PM|a\.m\.|p\.m\.))?(?:\s+(ET|EST|EDT|CT|KST|PT)\b)?/gi, (_m, h, mi, ap, tz) =>
    [intWords(Number(h)) + (mi === "00" ? "" : " " + (Number(mi) < 10 ? "oh " + ONES[Number(mi)] : intWords(Number(mi)))),
      ap ? (ap.toLowerCase().startsWith("a") ? "AM" : "PM") : "", tz ? TZ[tz.toUpperCase()] : ""].filter(Boolean).join(" "));
  t = t.replace(/\b(ET|KST)\b/g, (m) => TZ[m]);
  // 6) signs next to a direction word: "rose plus 1.2 percent", "S and P 500 minus 0.8 percent"
  t = t.replace(/\b(rose|climbed|gained|jumped|added|up|advanced)\s+plus\s+/gi, "$1 ").replace(/\b(fell|dropped|slid|slipped|down|lost|declined|sank)\s+minus\s+/gi, "$1 ")
    .replace(/\bplus\s+(?=[\d.]+\s*percent)/gi, "up ").replace(/\bminus\s+(?=[\d.]+\s*percent)/gi, "down ");
  t = t.replace(/\b(Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?(?=\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/g, (d) => ({ Mon: "Monday", Tue: "Tuesday", Tues: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Thur: "Thursday", Thurs: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" } as Record<string, string>)[d.replace(".", "")] ?? d)
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?(?=\s+\d{1,2}\b)/g, (m) => MON_ABBR[m.replace(".", "").toLowerCase()] ?? m);
  // 7) dates: "September 23", "Nov 3rd" -> ordinal words; a bare year after it is read as a year
  t = t.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/g,
    (_m, mo, d, y) => `${mo} ${ordinalWords(Number(d))}${y ? ", " + yearWords(Number(y)) : ""}`);
  // 8) money and won with a magnitude word or plain digits: rounded the way people say it
  t = t.replace(/\b(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)?\s+(dollars|won)\b/gi, (_m, n, mag, unit) =>
    sayMagnitude(Number(String(n).replace(/,/g, "")) * (mag ? MAGN[mag.toLowerCase()] : 1), unit.toLowerCase()));
  // 9) percentages
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent").replace(/\b(\d+(?:\.\d+)?)\s*percent\b/gi, (_m, n) => `${numWords(n)} percent`);
  // 10) ordinals and years left in text, then every other figure
  t = t.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, (_m, n) => ordinalWords(Number(n)))
    .replace(/\b(19\d{2}|20\d{2})\b/g, (_m, y) => yearWords(Number(y)))
    .replace(/(\d)-(?=[a-z])/g, "$1 ")
    .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (n) => numWords(n));
  // 11) tidy what the rewrites leave behind
  t = t.replace(/\b(dollars|won)\s+(loss|gain|buyback|drop|decline|hit|swing|move|increase|decrease|authorization|stake|deal|investment|purchase|sale|position|bet|cushion)\b/gi, (_m, u, n) => `${u.toLowerCase() === "dollars" ? "dollar" : "won"} ${n}`);
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_m, a, c) => a + c.toUpperCase());
  return t.replace(/\s+([.,;:!?])/g, "$1").replace(/([.!?])\s*\.+/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}
