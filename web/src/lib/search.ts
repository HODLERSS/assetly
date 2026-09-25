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
const LEVERED = /\b(\d(\.\d)?x|ultra(pro)?|bull|bear|leveraged|inverse|short)\b/i;

/** Order and filter a merged result list for a query. Exact ticker, then exact name, then ticker prefix,
 *  then a name word starting with the query, then contains; leveraged/inverse products sink below
 *  plain listings at the same level; cash rows lead with the reader's own currency. Stable otherwise. */
export function rankSymbols(q: string, rows: SymbolRow[], preferCcy = "USD"): SymbolRow[] {
  const t = searchQuery(q).toLowerCase();
  const explicit = asksForMarketData(t);
  const krwAsked = /krw|won|₩|원/i.test(q);
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
    if (LEVERED.test(r.name ?? "")) s += 0.5;
    if (r.kind === "cash" || r.kind === "debt") {
      const want = krwAsked ? "KRW" : preferCcy;
      s += r.currency === want ? 0 : r.currency === "USD" ? 0.2 : 0.4;
    }
    return s;
  };
  return rows
    .filter((r) => explicit || !notHoldable(r))
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
