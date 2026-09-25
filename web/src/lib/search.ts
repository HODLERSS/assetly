// Ticker search as people type it: debounced, never showing an older answer over a newer one, exact
// hits first, no FX pairs or indices unless asked for, the usual misspellings forgiven, and one name per
// exchange ("XNAS", "NMS", "NasdaqGS" are all NASDAQ).
import { useEffect, useRef, useState } from "react";
import type { Api, SymbolRow } from "./api";

/** Misspellings common enough to be worth a table (a fuzzy matcher would cost more than it saves). */
const ALIASES: Record<string, string> = {
  nvidea: "nvidia", nvida: "nvidia", nvdia: "nvidia", nividia: "nvidia", nvidai: "nvidia",
  telsa: "tesla", tesle: "tesla", tsela: "tesla",
  amazone: "amazon", amzon: "amazon", amazom: "amazon",
  googel: "google", gogle: "google", alphabett: "alphabet",
  microsft: "microsoft", mircosoft: "microsoft", micorsoft: "microsoft", microsoftt: "microsoft",
  appel: "apple", aple: "apple",
  facebook: "meta", netfilx: "netflix", netflex: "netflix", palantri: "palantir", plantir: "palantir",
  bitcon: "bitcoin", bitcoing: "bitcoin", etherium: "ethereum", etherum: "ethereum",
  berkshire: "berkshire hathaway", samsng: "samsung", samsumg: "samsung",
};

/** The query actually sent: trimmed, a known misspelling replaced. */
export function searchQuery(q: string): string {
  const t = q.trim();
  return ALIASES[t.toLowerCase()] ?? t;
}

const EXCH: Record<string, string> = {
  XNAS: "NASDAQ", NMS: "NASDAQ", NGM: "NASDAQ", NGS: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NASDAQGS: "NASDAQ", NASDAQGM: "NASDAQ", NASDAQCM: "NASDAQ", NASDAQ: "NASDAQ",
  XNYS: "NYSE", NYQ: "NYSE", NYSE: "NYSE",
  ARCX: "NYSE Arca", PCX: "NYSE Arca", NYSEARCA: "NYSE Arca", "NYSE ARCA": "NYSE Arca",
  XASE: "NYSE American", ASE: "NYSE American", AMEX: "NYSE American", "NYSE AMERICAN": "NYSE American", NYSEAMERICAN: "NYSE American",
  BATS: "Cboe", "BATS TRADING": "Cboe", BZX: "Cboe", "CBOE BZX": "Cboe", CBOE: "Cboe", BTS: "Cboe", CXI: "Cboe",
  PNK: "OTC", OTC: "OTC", "OTC MARKETS": "OTC", OTCMKTS: "OTC",
  KRX: "KRX", KSC: "KOSPI", KOSPI: "KOSPI", KOE: "KOSDAQ", KOSDAQ: "KOSDAQ",
  CRYPTO: "Crypto", CCC: "Crypto", CASH: "Cash", DEBT: "Debt",
};
/** One display name per venue. Unknown codes pass through unchanged. */
export function exchangeLabel(code: string | null | undefined): string {
  if (!code) return "";
  return EXCH[code.trim().toUpperCase()] ?? code;
}

/** Things you can't hold: indices (^VIX), futures (ES=F), FX pairs (USDKRW, KRW=X). */
function notHoldable(r: SymbolRow): boolean {
  return r.symbol.startsWith("^") || r.symbol.includes("=") || /^(FX|CME)$/i.test(r.exchange) || (r.yahoo ?? "").includes("=");
}
/** The query itself asks for an index or an FX pair: "^vix", "usdkrw", "usd/krw", "es=f". */
function asksForMarketData(q: string): boolean {
  return /^\^/.test(q) || q.includes("=") || /^usd\s*\/?\s*[a-z]{3}$/i.test(q);
}
/** A crypto token posing as a stock: Yahoo lists "005930 Samsung Electronics Co Ltd (Derivatives)" as a coin,
 *  and it came second for "005930", where a new user could add it for Samsung (r6 power-user m5). Named
 *  "(Derivatives)", or a coin whose ticker is a KRX stock code. */
const stockToken = (r: SymbolRow) =>
  (r.kind === "crypto" || /^(CCC|CRYPTO)$/i.test(r.exchange ?? "")) && (/\(derivatives?\)/i.test(r.name ?? "") || /^\d{6}(-[A-Z]{3,4})?$/i.test(r.symbol));
/** The query asks for crypto by name: "samsung token", "005930 crypto", "005930-usd". */
const asksForCrypto = (q: string) => /\b(crypto|coin|token)\b|-usd\b/i.test(q);
/** Names shared by several listings, where the one people mean is not the first alphabetically:
 *  "coca-cola" matched COKE, KOF and CCEP before KO; "vanguard s&p" put a London UCITS line above VOO. */
const MEANT: Record<string, string> = {
  "coca-cola": "KO", "coca cola": "KO", "coke": "KO",
  "vanguard s&p": "VOO", "vanguard s&p 500": "VOO", "vanguard 500": "VOO",
  "google": "GOOGL", "alphabet": "GOOGL", "berkshire hathaway": "BRK-B", "s&p 500": "SPY",
};
/** A listing abroad (VUSA.L, SHOP.TO): below the home listing at the same match level. Korean lines are home. */
const foreignLine = (sym: string) => /\.[A-Z]{1,3}$/i.test(sym) && !/\.(KS|KQ)$/i.test(sym) && !sym.startsWith("$");
// Leveraged, inverse and single-stock derivative products ("Direxion Daily NVDA Bull 2X", "ProShares
// UltraShort QQQ", "T-Rex 2X Long NVIDIA Daily Target ETF", "YieldMax NVDA Option Income").
// A short-term bond fund ("Vanguard Short-Term Bond") is not a short product.
const LEVERED = /\b(-?\d(\.\d+)?x|ultra\w*|bull|bear|leveraged|inverse|short(?![- ](term|duration|treasury|maturity))|daily target|option income|yieldmax|covered call)\b/i;
/** The query itself names such a product ("tqqq", "nvda 2x", "bear", "ultrapro"): then it ranks normally. */
const asksForLevered = (q: string) => LEVERED.test(q);

/** Order and filter a merged result list for a query. Exact ticker, then exact name, then ticker prefix,
 *  then a name word starting with the query, then contains; leveraged/inverse products sink below
 *  plain listings at the same level; cash rows lead with the reader's own currency. Stable otherwise. */
export function rankSymbols(q: string, rows: SymbolRow[], preferCcy = "USD"): SymbolRow[] {
  const t = searchQuery(q).toLowerCase();
  const explicit = asksForMarketData(t);
  const krwAsked = /krw|won|₩|원/i.test(q);
  const levered = asksForLevered(q);
  const score = (r: SymbolRow): number => {
    const sym = r.symbol.toLowerCase(), name = (r.name ?? "").toLowerCase();
    const bare = sym.replace(/^\$/, "").split(".")[0];
    let s: number;
    if (sym === t || bare === t) s = 0;
    else if (name === t) s = 1;
    else if (bare.startsWith(t)) s = 2;
    else if (name.startsWith(t) || name.split(/[\s,.&()-]+/).some((w) => w && w.startsWith(t))) s = 3;
    else if (sym.includes(t)) s = 4;
    else if (name.includes(t)) s = 5;
    else s = 6;   // the remote search matched it on something we can't see (e.g. a former name)
    // below every plain listing, not only the ones at the same match level: "sofi" or "nvidia" filled rows
    // 2-5 with SOFA, NVDL, NVD (r3 newcomer)
    if (!levered && LEVERED.test(r.name ?? "") && s > 0) s += 10;
    if (foreignLine(r.symbol)) s += 0.3;
    if (MEANT[t] && r.symbol.toUpperCase() === MEANT[t]) s = Math.min(s, 0.5);
    if (r.kind === "cash" || r.kind === "debt") {
      const want = krwAsked ? "KRW" : preferCcy;
      s += r.currency === want ? 0 : r.currency === "USD" ? 0.2 : 0.4;
    }
    return s;
  };
  const tokens = asksForCrypto(q);
  return rows
    .filter((r) => explicit || !notHoldable(r))
    .filter((r) => tokens || !stockToken(r))
    .map((r, i) => ({ r: { ...r, exchange: exchangeLabel(r.exchange) }, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.r);
}

/** Debounced search with out-of-order protection: only the latest query's answer is ever shown. */
export function useSymbolSearch(api: Api, { debounceMs = 200, filter, preferCcy = "USD" }: { debounceMs?: number; filter?: (r: SymbolRow) => boolean; preferCcy?: string } = {}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    const id = ++seq.current;
    const text = q.trim();
    if (!text) { setResults([]); setError(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.searchSymbols(text, preferCcy);
        if (id !== seq.current) return;              // a newer keystroke owns the list now
        const f = filterRef.current;
        setResults(f ? rows.filter(f) : rows); setError(null);
      } catch {
        if (id !== seq.current) return;
        // an empty list means "no match"; a thrown error means the search never ran, and saying so is the
        // difference between a user who retries and one who thinks the app is broken
        setResults([]); setError("Could not reach search. Check your connection and try again.");
      } finally { if (id === seq.current) setSearching(false); }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [api, q, debounceMs, preferCcy]);

  const reset = () => { seq.current++; setQ(""); setResults([]); setError(null); setSearching(false); };
  return { q, setQ, results, error, searching, reset };
}
