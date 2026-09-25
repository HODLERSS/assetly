// News list hygiene. Feeds repeat one story under several tickers and URLs ("Qualcomm's CMO reveals…"
// twice), and some titles arrive with HTML entities still encoded ("AT&amp;T").
//
// The News tab reads public.news directly, and rows stored before the server's ingest gate (1.0.1) still hold
// option-chain pages, social posts and stories about other companies ("Is Ford Stock a Buy?" under NVDA,
// round-2 audit 2026-09-25). So the gate runs again here, at read time: a PORT of
// supabase/functions/_shared/news_rules.ts (isJunkNews, aliasesFor, newsRelevant, usableNews, publisherFor).
// Both sides are pinned to the same vectors in supabase/functions/_shared/news_cases.json
// (web: src/test/news-rules.test.ts; server: news_rules_test.ts), so a rule changed on one side only fails a test.
import type { NewsItem } from "./api";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", middot: "·", bull: "•", trade: "™", reg: "®", copy: "©",
};

/** Decode HTML entities for display (text only; nothing is ever injected as HTML). Unknown names stay as written. */
export function decodeEntities(s: string): string {
  // twice: feeds sometimes double-encode ("&amp;amp;")
  let out = s;
  for (let i = 0; i < 2 && out.includes("&"); i++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return out;
}

/** Two headlines are the same story when they match ignoring case, punctuation, quotes and spacing. */
export function titleKey(t: string): string {
  // "Nvidia Stock Tests Key Level" and "Nvidia Tests Key Level" are one story (round 3)
  return decodeEntities(t).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(^| )(?:stock|stocks|shares|inc|corp)(?= |$)/g, " ").replace(/\s+/g, " ").trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quote pages, option chains, price listings and single-user posts are not news (port of the server rule). */
export function isJunkNews(title: string, url: string, source = ""): boolean {
  const t = decodeEntities(String(title ?? "")).replace(/\s+/g, " ").trim(), u = String(url ?? "").toLowerCase(), src = String(source ?? "");
  if (/\b(historical prices|price history|stock price,? (?:news|quote|chart)|stock price\s*[|:–-]\s*(?:quotes?|news|chart)|quotes? (?:&|and) (?:history|news|chart)|stock quote|option(?:s)? chain|options? prices?|real-?time quote|stock price today|live stock price|share price (?:today|live|chart)|interactive stock chart|stock chart)\b/i.test(t)) return true;
  if (/\b(?:call|put)s?\b[^.]{0,40}\b\d{1,5}\.\d{3}\b|\b\d{1,5}\.\d{3}\s+(?:call|put)\b/i.test(t)) return true;
  if (/\b[A-Z]{1,6}\d{6}[CP]\d{6,8}\b/.test(t)) return true;
  if (/^\s*[A-Z0-9.^=-]{1,10}\s*[:|-]?\s*(stock|quote|price|overview|summary|profile)s?\s*$/i.test(t)) return true;
  if (/\/quote\/|\/options?(?:[/?#]|$)|option-?chain|historical-?(?:prices|data)|\/history(?:[/?#]|$)|\/market-activity\/(?:stocks|funds-and-etfs)\/[^/]+\/?(?:option-chain|historical)?$/.test(u)) return true;
  if (/(?:moomoo\.com|futunn\.com)|stocktwits\.com\/[^/]+\/message\/|reddit\.com|\/\/(?:www\.)?(?:x|twitter)\.com\/|threads\.net|facebook\.com|tiktok\.com|youtube\.com\/shorts/.test(u)) return true;
  if (/^(moomoo|moomoo\.com|futu|futubull|webull community|reddit|pluang)$|\br\/\w+/i.test(src.trim())) return true;
  if (/^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$/.test(t)) return true;
  // 13F holding notices and automated signal pages (round 3: MarketBeat "Shares Bought by Envestnet", GuruFocus
  // "... Holding History", Stock Traders Daily quant pages, Kavout "Should I Buy QQQM | AI Analysis", MEXC pages)
  if (/\b(shares (?:bought|sold|acquired|purchased) by|(?:stock )?holdings? (?:lifted|lowered|raised|trimmed|cut|boosted|increased|decreased) by|(?:position|stake|holdings?) in\b.{1,80}\b(?:raised|lowered|lifted|trimmed|increased|decreased|boosted|cut|reduced) by|acquires? (?:a )?new (?:stake|position)|(?:buys?|sells?|purchases?|acquires?) [\d,.]+ shares of|holding history|short interest (?:update|report|data)|sees (?:unusually )?(?:high|large) options volume|trading report|ai analysis|stock (?:price )?forecast|price prediction|technical analysis report)\b/i.test(t)) return true;
  if (/\([A-Za-z0-9]{8,}\)\s*$/.test(t) && /[a-z][A-Z]|[A-Z][a-z][A-Z]/.test((t.match(/\(([A-Za-z0-9]{8,})\)\s*$/) ?? ["", ""])[1])) return true;   // "... Raye (InTtzPzqpu)": a scraped page id
  if (/(^|\.)(mexc\.com|kavout\.com|stocktradersdaily\.com|unisbamedia\.com)\b/.test(u) || /^(stock traders daily|kavout|mexc|mexc\.com|unisba media)$/i.test(src.trim())) return true;
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
/** The words that make a story ABOUT a holding: ticker, name without legal suffixes, brands, Korean name. */
export function aliasesFor(symbol: string, name?: string | null, nameKr?: string | null): string[] {
  const out = new Set<string>();
  const tick = symbol.replace(/\.(KS|KQ)$/, "").replace(/-USD$/, "");
  if (!/^\d+$/.test(tick)) out.add(tick);
  for (const a of ALIAS[symbol] ?? []) out.add(a);
  let core = String(name ?? "").replace(/\(.*?\)/g, " ").replace(CORP, " ").replace(/[,.&]+/g, " ").replace(/\s+/g, " ").trim();
  if ((core && core === core.toUpperCase() && /[A-Z]{2}/.test(core) && core.includes(" ")) || (core.length > 3 && core === core.toUpperCase() && core !== tick)) {
    core = core.split(" ").map((w, i) => (i > 0 && /^(OF|AND|THE|FOR|DE)$/.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
  }
  if (core && core !== tick) {
    out.add(core);
    const first = core.split(" ")[0];
    if (first.length >= 3 && core.includes(" ") && /^[A-Z]/.test(first) && !GENERIC_FIRST.test(first)) out.add(first);
    else if (core.split(" ").length >= 3 && GENERIC_FIRST.test(first) && !/^(of|and|the)$/i.test(core.split(" ")[1])) out.add(core.split(" ").slice(0, 2).join(" "));
  }
  if (nameKr) { out.add(nameKr); const k = nameKr.replace(/\s*(우|보통주|우선주)$/, ""); if (k) out.add(k); }
  return [...out].filter((a) => a.length >= 2);
}

/** Is the holding central to the story: named in the title, or in the lead of a feed keyed to that symbol? */
export function newsRelevant(title: string, aliases: string[], lead = "", symbolFeed = false): boolean {
  const mentions = (hay: string) => aliases.some((a) => {
    if (/^[A-Z0-9.]{1,5}$/.test(a)) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9])(?:\\$|\\()?${esc(a)}(?:\\))?(?=$|[^A-Za-z0-9])`);
      return re.test(hay) && (a.length >= 3 || new RegExp(`[$(]${esc(a)}\\b`).test(hay));
    }
    if (/[가-힣]/.test(a)) return hay.includes(a);
    return new RegExp(`(?:^|[^\\p{L}])${esc(a)}(?=$|[^\\p{L}])`, a.length < 5 ? "u" : "iu").test(hay);
  });
  if (mentions(title)) return true;
  if (!symbolFeed) return false;
  const firstSentence = String(lead ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 220);
  return mentions(firstSentence);
}

type NewsRow = { symbol?: string | null; title: string; url: string; source?: string | null; summary?: string | null };
/** A stored row judged at read time: never junk, and about its holding (a stored lead admits it as at ingest). */
export function usableNews(row: NewsRow, aliases: string[] | null | undefined): boolean {
  const src = String(row.source ?? "");
  if (src === "SEC Filing" || src === "Earnings Call") return true;
  if (isJunkNews(row.title, row.url, src)) return false;
  if (!aliases || !aliases.length) return true;
  const lead = String(row.summary ?? "");
  return newsRelevant(decodeEntities(row.title).replace(/\s+/g, " ").trim(), aliases, lead, lead.length > 0);
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
/** The byline the reader should see: a Yahoo feed item linking to fool.com is The Motley Fool; an unnamed
 *  publisher shows its domain, never "Yahoo Finance". */
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
  return /^(yahoo finance|yahoo|google news)$/i.test(String(source ?? "").trim()) ? host : source;
}

/** Read-time gate for a page of rows: junk out, stories not about their holding out (names = symbol -> company
 *  name, from the catalog), the real publisher as byline. Order is kept. */
export function cleanNews<T extends NewsRow>(items: T[], names: Record<string, { name?: string | null; name_kr?: string | null }>): T[] {
  const aka = new Map<string, string[]>();
  // a symbol the catalog lookup did not return (a failed query, an unknown row) gets the junk rules only:
  // judging relevance by the bare ticker would empty the feed
  const aliasOf = (sy: string) => {
    if (!names[sy]) return null;
    if (!aka.has(sy)) aka.set(sy, aliasesFor(sy, names[sy]?.name ?? null, names[sy]?.name_kr ?? null));
    return aka.get(sy)!;
  };
  return items.filter((n) => usableNews(n, n.symbol ? aliasOf(n.symbol) : null))
    .map((n) => ({ ...n, source: publisherFor(n.url, decodeEntities(String(n.source ?? ""))) }));
}

/** Keep the first (newest) copy of each story, by URL and by normalized title. Titles come back decoded;
 *  junk pages never reach the list and the byline is the real publisher. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const urls = new Set<string>(), titles = new Set<string>();
  const out: NewsItem[] = [];
  for (const n of items) {
    if (isJunkNews(n.title, n.url, n.source ?? "")) continue;
    const k = titleKey(n.title);
    if (urls.has(n.url) || (k && titles.has(k))) continue;
    urls.add(n.url); if (k) titles.add(k);
    out.push({ ...n, title: decodeEntities(n.title), source: publisherFor(n.url, decodeEntities(n.source ?? "")) });
  }
  return out;
}
