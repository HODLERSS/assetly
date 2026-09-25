// Money and percent formatting. Sign always travels with color (never color alone).
// Negatives use the true minus (U+2212): it is as wide as "+" in the tabular number face, so a column
// of gains and losses keeps one right edge. The ASCII hyphen was 7.0px against 9.4px (r2 design audit).
export const MINUS = "\u2212";
export type FxRates = Record<string, number>;   // units of currency per USD (USD: 1, KRW: 1380, CAD: 1.36 ...)
const SYM: Record<string, string> = { USD: "$", KRW: "₩", CAD: "C$", GBP: "£", EUR: "€", JPY: "¥", AUD: "A$", HKD: "HK$", INR: "₹", CHF: "CHF ", SGD: "S$", NZD: "NZ$", SEK: "kr ", NOK: "kr ", DKK: "kr ", MXN: "MX$", BRL: "R$", ZAR: "R ", TWD: "NT$", CNY: "¥" };
const ZERO_DP = new Set(["KRW", "JPY", "TWD"]);   // currencies quoted without decimals
export const ccySymbol = (c: string) => SYM[c] ?? c + " ";
export function money(v: number | null | undefined, currency: string = "USD", compactKrw = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.round(v) === 0) v = 0;   // -0.3 prints as "$0", never "-$0"
  if (currency === "KRW") {
    const n = Math.round(v);
    if (compactKrw && Math.abs(n) >= 1e8) return `₩${(n / 1e8).toFixed(1)}억`;
    return `₩${n.toLocaleString("en-US")}`;
  }
  const dp = ZERO_DP.has(currency) ? 0 : 0;
  return `${ccySymbol(currency)}${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** Per-share amounts (price, avg cost, lot cost): always 2 decimals in USD, whole won in KRW. */
export function moneyExact(v: number | null | undefined, currency: string = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (ZERO_DP.has(currency)) return `${ccySymbol(currency)}${Math.round(v).toLocaleString("en-US")}`;
  return `${ccySymbol(currency)}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Signed whole-unit amount. Anything that rounds to zero is a neutral "$0": a 3-cent move on a starter
 *  position printed as a red "-$0" (launch audit, 2026-09-25). */
export function signedMoney(v: number | null | undefined, currency: string = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.round(Math.abs(v)) === 0) return money(0, currency);
  const sign = v > 0 ? "+" : MINUS;
  return sign + money(Math.abs(v), currency);
}

export function signedPct(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Number(v.toFixed(dp)) === 0) return `${(0).toFixed(dp)}%`;   // never "-0.00%"
  return `${v > 0 ? "+" : MINUS}${Math.abs(v).toFixed(dp)}%`;
}

export function glClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "mutedc";
  return v > 0 ? "gain" : "loss";
}

/** Colour for a whole-unit money figure: what prints as "$0" reads neutral, not red or green. */
export function moneyClass(v: number | null | undefined): string {
  return glClass(v === null || v === undefined ? v : Math.round(v) === 0 ? 0 : v);
}

export function priceAsOf(iso: string | null): string {
  if (!iso) return "no print yet";
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return "live";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 6 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} close`;   // market closed since
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Convert v between USD and KRW using the won-per-dollar rate; null rate = no conversion possible. */
/** Convert through USD with a rates map (units per USD). A bare number is accepted as the legacy won-per-dollar rate. */
export function convertCcy(v: number, from_: string, base: string, rates: FxRates | number | null): number | null {
  if (from_ === base) return v;
  const map: FxRates = typeof rates === "number" ? { USD: 1, KRW: rates } : { USD: 1, ...(rates ?? {}) };
  const rf = map[from_], rb = map[base];
  if (!rf || rf <= 0 || !rb || rb <= 0) return null;   // unknown pair: caller shows "awaiting FX rate", never a wrong number
  return (v / rf) * rb;
}

/** Dollar (or won) change implied by today's percent move on the current value. */
export function dayChangeAmount(value: number | null, changePct: number | null): number | null {
  if (value === null || changePct === null) return null;
  const f = 1 + changePct / 100;
  if (f <= 0) return null;
  return value - value / f;
}

/** Cash and debt rows are stored under internal symbols ("$CASH", "$CASH.KRW", "$DEBT"). People never see
 *  those: "Cash", "Cash (KRW)", "Debt". Anything else is returned as is. */
export function cashName(symbol: string): string | null {
  const m = /^\$(CASH|DEBT)(?:\.([A-Z]{3}))?$/.exec(symbol);
  if (!m) return null;
  const base = m[1] === "CASH" ? "Cash" : "Debt";
  return m[2] && m[2] !== "USD" ? `${base} (${m[2]})` : base;
}

/** The one name for a holding in sentences ("Remove Cash (KRW)?", "Remove NVDA?"). */
export function displayName(r: { symbol: string; nickname?: string | null }): string {
  const c = cashName(r.symbol);
  if (c) return r.nickname ? `${c} · ${r.nickname}` : c;
  return r.symbol;
}

/** What one unit of a holding is called next to a quantity: "sh" for shares, the coin's own ticker for
 *  crypto ("0.85 ETH", not "0.85 sh"; r3 newcomer), "coins" when the symbol is not a plain ticker. */
export function qtyUnit(r: { symbol: string; kind: string }): string {
  if (r.kind !== "crypto") return "sh";
  const t = r.symbol.replace(/[-/](USD|USDT|USDC|KRW|EUR)$/i, "").toUpperCase();
  return /^[A-Z0-9]{2,6}$/.test(t) ? t : "coins";
}

/** A calendar date as people write it: "Jun 14, 2024". The ISO day is a date, not an instant: read it at noon UTC. */
export function formatDate(isoDay: string): string {
  const d = new Date(`${isoDay.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(+d)) return isoDay;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** KR tickers are opaque numbers (000660.KS); people know the company name.
 *  main = what to show big, sub = the secondary line. US keeps ticker-first. */
export function labelParts(r: { symbol: string; name?: string | null; name_kr?: string | null; nickname?: string | null }, korean = false): { main: string; sub: string } {
  const cash = cashName(r.symbol);
  if (cash) return { main: cash, sub: r.nickname || "" };   // "$CASH Cash (USD)" was a raw key and a repeat
  const kr = r.symbol.endsWith(".KS") || r.symbol.endsWith(".KQ");
  // a name that only repeats the ticker ("AVGO AVGO") is dropped
  if (!kr) {
    const nm = companyName(r.name);
    return { main: r.symbol, sub: r.nickname || (nm && nm.toUpperCase() !== r.symbol.toUpperCase() ? nm : "") };
  }
  if (r.nickname) return { main: r.nickname, sub: r.symbol };
  if (korean && r.name_kr) return { main: r.name_kr, sub: r.symbol };
  const nm = (r.name || r.symbol)
    .replace(/\s*(Co\.?,?\s*Ltd\.?|Inc\.?|Corp(?:oration)?\.?|Company|Ltd\.?)\s*$/i, "").trim();
  return { main: nm || r.symbol, sub: r.symbol };
}

/** Compact signed money for tight row lines: +$28.1K, \u2212\u20a99.3M. One rule for every row: under 1,000
 *  whole units, from 1,000 always one decimal. "(\u2212$16K)" sat next to "(+$17.9K)" because 16.0K dropped
 *  its zero (r3 design audit). */
export function signedMoneyCompact(v: number | null, ccy: string): string {
  if (v === null) return "\u2014";
  const sym = ccySymbol(ccy);
  if (Math.round(Math.abs(v)) === 0) return `${sym}0`;
  const sign = v > 0 ? "+" : MINUS;
  const big = Math.abs(v) >= 999.5;
  const num = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: big ? 1 : 0, maximumFractionDigits: big ? 1 : 0 }).format(Math.abs(v));
  return `${sign}${sym}${num}`;
}

/** A per-unit price in the fewest characters (narrow rows): \u20a91.86M, \u20a9285.5K, $339.91. */
export function priceCompact(v: number | null | undefined, ccy: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "\u2014";
  if (Math.abs(v) < 10_000) return moneyExact(v, ccy);
  const num = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(v) >= 1e6 ? 2 : 1 }).format(v);
  return `${ccySymbol(ccy)}${num}`;
}

/** A company's name as people say it: "Microsoft Corporation" -> "Microsoft", "Tesla, Inc." -> "Tesla",
 *  "Amazon.com Inc" -> "Amazon", "Alphabet Inc. Class A" -> "Alphabet". Legal suffixes, share classes and
 *  ".com" go; fund names ("Vanguard S&P 500 ETF") and anything that would end up empty are left alone.
 *  For display only: the legal name stays in the data. */
export function companyName(name: string | null | undefined): string {
  let s = (name ?? "").trim();
  if (!s) return "";
  const SUFFIX = /[\s,]+(?:(?:Class|Cl\.?|Series)\s+[A-Z]\b|Common Stock|Ordinary Shares|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.?|Holdings?|Group Holdings|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|SE|AG|L\.P\.|LP|LLC)\s*[.,]?$/i;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(SUFFIX, "").trim();
    if (!next || next === s) break;
    s = next;
  }
  s = s.replace(/\.com$/i, "").replace(/[\s,]+$/, "");
  return s || (name ?? "").trim();
}
