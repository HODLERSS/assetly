// News quality rules: what counts as a story about a holding, and whose byline it carries. Pure and
// dependency-free, used at INGEST (news-sync) and again at READ time by every function that feeds headlines
// to a model (the gate alone left two weeks of pre-gate junk in the table: the 2026-09-25 round-2 audit
// still saw QQQM option chains and "Is Ford Stock a Buy?" under NVDA after the gate shipped).
//
// web/src/lib/news.ts carries a port of these rules for the News tab (the client reads the table directly);
// both sides are pinned to the same vectors in news_cases.json, so a rule changed here and not there fails
// a test on one side.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
 *  Moomoo user's "Shorted 32 shares at $363.58" as "confirms support"; Moomoo's "NVDA Stock Price | Quotes &
 *  News" page sat in the NVDA feed. */
export function isJunkNews(title: string, url: string, source = ""): boolean {
  const t = decodeEntities(String(title ?? "")), u = String(url ?? "").toLowerCase(), src = String(source ?? "");
  if (/\b(historical prices|price history|stock price,? (?:news|quote|chart)|stock price\s*[|:–-]\s*(?:quotes?|news|chart)|quotes? (?:&|and) (?:history|news|chart)|stock quote|option(?:s)? chain|options? prices?|real-?time quote|stock price today|live stock price|share price (?:today|live|chart)|interactive stock chart|stock chart)\b/i.test(t)) return true;
  if (/\b(?:call|put)s?\b[^.]{0,40}\b\d{1,5}\.\d{3}\b|\b\d{1,5}\.\d{3}\s+(?:call|put)\b/i.test(t)) return true;   // "Nov 2026 260.000 call"
  if (/\b[A-Z]{1,6}\d{6}[CP]\d{6,8}\b/.test(t)) return true;                                                    // an OCC option symbol
  if (/^\s*[A-Z0-9.^=-]{1,10}\s*[:|-]?\s*(stock|quote|price|overview|summary|profile)s?\s*$/i.test(t)) return true;
  if (/\/quote\/|\/options?(?:[/?#]|$)|option-?chain|historical-?(?:prices|data)|\/history(?:[/?#]|$)|\/market-activity\/(?:stocks|funds-and-etfs)\/[^/]+\/?(?:option-chain|historical)?$/.test(u)) return true;
  // social posts: Moomoo's feed is user posts ("$Broadcom (AVGO.US)$ Shorted 32 shares at $363.58 ...") and option
  // chain pages, so Moomoo as a byline goes whole; Stocktwits runs a real newsroom, so only its message URLs go
  if (/(?:moomoo\.com|futunn\.com)|stocktwits\.com\/[^/]+\/message\/|reddit\.com|\/\/(?:www\.)?(?:x|twitter)\.com\/|threads\.net|facebook\.com|tiktok\.com|youtube\.com\/shorts/.test(u)) return true;
  if (/^(moomoo|moomoo\.com|futu|futubull|webull community|reddit|pluang)$|\br\/\w+/i.test(src.trim())) return true;
  if (/^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$/.test(t)) return true;
  // 13F holding notices and automated signal pages (round 3: MarketBeat "Shares Bought by Envestnet", GuruFocus
  // "... Holding History", Stock Traders Daily quant pages, Kavout "Should I Buy QQQM | AI Analysis", MEXC pages)
  // round 4: "Meta Platforms, Inc. $META Stock Bought by InTrack ...", market-report spam, options-strategy primers
  if (/\b(?:stock|shares|position|stake) (?:bought|sold|acquired|purchased|trimmed|increased|decreased|raised|lowered) by\b|\bmarket (?:outlook|report|size|forecast|analysis)\b[^|]{0,40}\b20\d{2}\s?[-–]\s?20\d{2}\b|\bfeaturing profiles\b|\b(?:tent|iron condor|butterfly|straddle|strangle|covered call|collar)[- ]?(?:shape )?options? strategy\b|\boptions strategy\b/i.test(t)) return true;
  if (/\b(shares (?:bought|sold|acquired|purchased) by|(?:stock )?holdings? (?:lifted|lowered|raised|trimmed|cut|boosted|increased|decreased) by|(?:position|stake|holdings?) in\b.{1,80}\b(?:raised|lowered|lifted|trimmed|increased|decreased|boosted|cut|reduced) by|acquires? (?:a )?new (?:stake|position)|(?:buys?|sells?|purchases?|acquires?) [\d,.]+ shares of|holding history|short interest (?:update|report|data)|sees (?:unusually )?(?:high|large) options volume|trading report|ai analysis|stock (?:price )?forecast|price prediction|technical analysis report)\b/i.test(t)) return true;
  if (/\([A-Za-z0-9]{8,}\)\s*$/.test(t) && /[a-z][A-Z]|[A-Z][a-z][A-Z]/.test((t.match(/\(([A-Za-z0-9]{8,})\)\s*$/) ?? ["", ""])[1])) return true;   // "... Raye (InTtzPzqpu)": a scraped page id
  if (/(^|\.)(mexc\.com|kavout\.com|stocktradersdaily\.com|unisbamedia\.com)\b/.test(u) || /^(stock traders daily|kavout|mexc|mexc\.com|unisba media)$/i.test(src.trim())) return true;   // the "$Name (TICKER.US)$" post format
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
    if (/[가-힣]/.test(a)) return hay.includes(a);
    // a short name is matched as a proper noun ("Arm", "Visa"), never as the everyday word
    return new RegExp(`(?:^|[^\\p{L}])${esc(a)}(?=$|[^\\p{L}])`, a.length < 5 ? "u" : "iu").test(hay);
  });
  if (mentions(title)) return true;
  if (!symbolFeed) return false;
  const firstSentence = String(lead ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 220);
  return mentions(firstSentence);
}

/** A stored row, judged at READ time with the same rules the ingest gate uses. news-sync keeps the lead of a
 *  symbol-keyed feed item in `summary` (only those), so a story admitted on its lead is admitted again here;
 *  a row from before the gate has no summary and must name the holding in its title. SEC filings and earnings
 *  calls are written by our own jobs and always belong to their symbol. */
export type NewsRow = { symbol?: string | null; title: string; url: string; source?: string | null; summary?: string | null };
/** The date a URL's path carries ("/2026/07/22/..."), when it has one. */
export function urlDate(url: string): string | null {
  const m = String(url ?? "").match(/\/(20\d{2})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?:\/|-|$)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** A story re-dated by a feed: its URL says it was published more than a week before the row's date (round 4:
 *  "TSLA Stock Jumps 3% Ahead Of Q2 Report", a July story, shown as 4 hours old). */
export function staleRedated(row: { url: string; published_at?: string | null }): boolean {
  const m = String(row.url ?? "").match(/\/(20\d{2})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?:\/|-|$)/);
  if (!m || !row.published_at) return false;
  return Date.parse(String(row.published_at)) - Date.parse(`${m[1]}-${m[2]}-${m[3]}T23:59:59Z`) > 7 * 86400000;
}
export function usableNews(row: NewsRow & { published_at?: string | null }, aliases: string[] | null | undefined): boolean {
  const src = String(row.source ?? "");
  if (src === "SEC Filing" || src === "Earnings Call") return true;
  if (isJunkNews(row.title, row.url, src) || staleRedated(row)) return false;
  if (!aliases || !aliases.length) return true;   // nothing to judge relevance by: junk rules only
  const lead = String(row.summary ?? "");
  return newsRelevant(decodeEntities(row.title), aliases, lead, lead.length > 0);
}

/** Normalized title key: the same story syndicated under different URLs (and different tickers). */
export const titleKey = (title: string): string =>
  decodeEntities(title).toLowerCase().replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").replace(/[^a-z0-9가-힣]+/g, " ")
    // "Nvidia Stock Tests Key Level" and "Nvidia Tests Key Level" are one story (round 3)
    .replace(/\b(?:stock|stocks|shares|inc|corp)\b/g, " ")
    // "I'm Riding Meta (NASDAQ:META)" and "I'm Riding Meta" are one story (round 4)
    .replace(/\b(?:nasdaq|nyse|nysearca|amex|otc|tsx|krx|kospi)\s+[a-z0-9.]{1,6}\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
/** Which of several held symbols a story is MOST about: the one named earliest in the title. */
export function centrality(title: string, aliases: string[]): number {
  const lower = title.toLowerCase();
  const idx = aliases.map((a) => lower.indexOf(a.toLowerCase())).filter((i) => i >= 0);
  return idx.length ? Math.min(...idx) : Number.POSITIVE_INFINITY;
}

const PUBLISHERS: Record<string, string> = {
  "thestreet.com": "TheStreet", "fool.com": "The Motley Fool", "247wallst.com": "24/7 Wall St.", "supplychaindive.com": "Supply Chain Dive",
  "manufacturingdive.com": "Manufacturing Dive", "trefis.com": "Trefis", "cryptoprowl.com": "CryptoProwl", "barchart.com": "Barchart",
  "marketbeat.com": "MarketBeat", "morningstar.com": "Morningstar", "nasdaq.com": "Nasdaq", "tipranks.com": "TipRanks", "simplywall.st": "Simply Wall St",
  "stocktitan.net": "Stock Titan", "fxleaders.com": "FXLeaders", "thefly.com": "The Fly", "coindesk.com": "CoinDesk", "cointelegraph.com": "Cointelegraph",
  "decrypt.co": "Decrypt", "theblock.co": "The Block", "axios.com": "Axios", "apnews.com": "AP", "nytimes.com": "The New York Times",
  "washingtonpost.com": "The Washington Post", "economist.com": "The Economist", "fortune.com": "Fortune", "finviz.com": "Finviz", "kiplinger.com": "Kiplinger",
  "reuters.com": "Reuters", "bloomberg.com": "Bloomberg", "cnbc.com": "CNBC", "wsj.com": "WSJ", "barrons.com": "Barron's", "marketwatch.com": "MarketWatch",
  "investors.com": "Investor's Business Daily", "benzinga.com": "Benzinga", "zacks.com": "Zacks", "seekingalpha.com": "Seeking Alpha", "investopedia.com": "Investopedia",
  "businessinsider.com": "Business Insider", "ft.com": "Financial Times", "forbes.com": "Forbes", "techcrunch.com": "TechCrunch", "theverge.com": "The Verge",
  "gurufocus.com": "GuruFocus", "insidermonkey.com": "Insider Monkey", "investing.com": "Investing.com", "globenewswire.com": "GlobeNewswire", "prnewswire.com": "PR Newswire", "businesswire.com": "Business Wire",
};
const AGGREGATOR_SOURCES = /^(yahoo finance|yahoo|google news)$/i;
/** The byline the reader should see: an aggregator feed (Yahoo) linking to fool.com is The Motley Fool, and a
 *  publisher we have no name for shows its real domain ("cryptoprowl.com"), never "Yahoo Finance". */
export function publisherFor(url: string, source: string): string {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return source; }
  if (!host || /(^|\.)yahoo\.com$/.test(host) || /news\.google\.com$/.test(host)) {
    // an aggregator item whose byline is a bare domain ("fxleaders.com" next to "FXLeaders") gets the name
    const bare = String(source ?? "").trim().toLowerCase().replace(/^www\./, "");
    const named = Object.keys(PUBLISHERS).find((d) => bare === d || bare.endsWith("." + d));
    return named ? PUBLISHERS[named] : source;
  }
  const hit = Object.keys(PUBLISHERS).find((d) => host === d || host.endsWith("." + d));
  if (hit) return PUBLISHERS[hit];
  return AGGREGATOR_SOURCES.test(String(source ?? "").trim()) ? host : source;
}
