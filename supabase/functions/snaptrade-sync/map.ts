// Brokerage-agnostic position/balance normalization for SnapTrade's unified `/accounts/{id}/positions/all`
// (and the legacy `/positions` + `/holdings` shapes). Pure functions, no Deno/DB: unit-tested in
// web/snaptrade-map.test.mjs against synthetic payloads modelled on every brokerage family SnapTrade lists
// (US full-service, US app brokers with crypto + fractional, crypto exchanges, Canada, UK/EU, India, Australia,
// Hong Kong, IBKR multi-currency). Everything the importer writes comes through here.

export type Mapped = {
  sym: string;          // Assetly symbol (Yahoo-compatible: "SHOP.TO", "BRK.B", "BTC")
  desc: string;
  ccy: string;          // ISO-4217 (GBX normalised to GBP)
  exch: string;
  kind: "equity" | "etf" | "fund" | "crypto";
  yahoo: string | null; // only when it differs from sym (BRK.B -> BRK-B, BTC -> BTC-USD)
  units: number;
  avg: number | null;   // average cost PER UNIT in ccy (null when the brokerage gives none)
  price: number | null; // in ccy
};
export type Skipped = { skip: "option" | "future" | "cfd" | "cash" | "short" | "zero" | "nosymbol" | "unsupported" | "excluded" };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ISO = /^[A-Z]{3}$/;

// Crypto tickers are NOT normalised by SnapTrade (docs: Kraken returns XBT/XXBT). Map the known aliases and
// strip fiat pairs ("BTC-USD", "BTCUSD", "BTC/USDT", "ETHUSDC") down to the base asset.
const CRYPTO_ALIAS: Record<string, string> = { XBT: "BTC", XXBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC", XXLM: "XLM", XXDG: "DOGE", XDG: "DOGE", XZEC: "ZEC", XXMR: "XMR", XETC: "ETC", XREP: "REP", XMLN: "MLN" };
const FIAT_QUOTE = /(USDT|USDC|USD|EUR|GBP|CAD|AUD|KRW|JPY|CHF|BUSD|DAI)$/;
export function normalizeCrypto(raw: string): string {
  let s = raw.toUpperCase().trim().replace(/[\s]/g, "");
  s = s.replace(/[-/_]?(USDT|USDC|USD|EUR|GBP|CAD|AUD|KRW|JPY|CHF|BUSD|DAI)$/, (m) => (s.length - m.replace(/[-/_]/, "").length >= 2 ? "" : m));
  if (s.length >= 6 && FIAT_QUOTE.test(s)) s = s.replace(FIAT_QUOTE, "");   // "BTCUSD" with no separator
  if (CRYPTO_ALIAS[s]) return CRYPTO_ALIAS[s];
  if (/^X[A-Z]{3}$/.test(s) && CRYPTO_ALIAS["X" + s]) return CRYPTO_ALIAS["X" + s];
  if (/^Z(USD|EUR|GBP|CAD|AUD|JPY|KRW)$/.test(s)) return "";   // Kraken fiat balances masquerading as assets
  return s;
}

const KIND: Record<string, Mapped["kind"]> = { stock: "equity", etf: "etf", mutualfund: "fund", cef: "equity", adr: "equity", crypto: "crypto", other: "equity" };
const CASH_LIKE = /^(cash|spaxx|fdrxx|fcash|fzfxx|vmfxx|swvxx|snvxx|core|qacds|usd cash|cad cash|money market)$/i;

export function normalizePosition(p: Record<string, unknown>, excluded: Set<string> = new Set()): Mapped | Skipped {
  const inst = p.instrument as Record<string, unknown> | undefined;
  let kindRaw = String(inst?.kind ?? (p.symbol && typeof p.symbol === "object" && (p.symbol as { option_symbol?: unknown }).option_symbol ? "option" : "stock")).toLowerCase();
  if (kindRaw === "option" || kindRaw === "future" || kindRaw === "cfd") return { skip: kindRaw as Skipped["skip"] };
  if (kindRaw === "cash" || (p as { cash_equivalent?: boolean }).cash_equivalent === true) return { skip: "cash" };

  let sym = "", raw = "", desc = "", ccy = "USD", exch = "";
  if (inst) {
    sym = String(inst.symbol ?? inst.raw_symbol ?? "").trim();
    raw = String(inst.raw_symbol ?? sym).trim();
    desc = String(inst.description ?? sym).trim();
    ccy = String((p.currency as string | undefined) ?? (inst.currency as string | undefined) ?? "USD").toUpperCase();
    exch = String((inst.exchange as string | undefined) ?? "").trim();
  } else {
    // legacy: { symbol: { symbol: {symbol, raw_symbol, description, currency:{code}, exchange:{code,suffix}, type:{code}} } }
    const symObj = (p.symbol as Record<string, unknown> | undefined)?.symbol as Record<string, unknown> | string | undefined;
    const meta = typeof symObj === "object" && symObj ? symObj : {};
    sym = typeof symObj === "string" ? symObj : String((meta as { symbol?: string }).symbol ?? (meta as { raw_symbol?: string }).raw_symbol ?? "").trim();
    raw = String((meta as { raw_symbol?: string }).raw_symbol ?? sym).trim();
    desc = String((meta as { description?: string }).description ?? sym).trim();
    ccy = String((p.currency as { code?: string } | undefined)?.code ?? (meta as { currency?: { code?: string } }).currency?.code ?? "USD").toUpperCase();
    exch = String((meta as { exchange?: { code?: string } }).exchange?.code ?? "").trim();
    const tcode = String((meta as { type?: { code?: string } }).type?.code ?? "").toLowerCase();
    if (tcode === "et" || /\betf\b/i.test(desc)) kindRaw = "etf";
    else if (tcode === "mf" || /\bfund\b/i.test(desc) && !/\betf\b/i.test(desc)) kindRaw = "mutualfund";
    else if (tcode === "crypto" || (meta as { currency?: { code?: string } }).currency?.code === undefined && /^[A-Z]{3,5}$/.test(sym) && /coin|bitcoin|ether/i.test(desc)) kindRaw = "crypto";
  }
  if (!sym) return { skip: "nosymbol" };
  // sweep / money-market positions duplicate the balances endpoint
  if ((kindRaw === "other" || kindRaw === "mutualfund") && (CASH_LIKE.test(sym) || CASH_LIKE.test(raw) || /^cash$/i.test(desc))) return { skip: "cash" };
  if (kindRaw === "other" && /money market|cash reserve|sweep/i.test(desc)) return { skip: "cash" };
  // "other" with no ticker-like symbol (CUSIP bonds, structured notes): we cannot price or research it
  if (kindRaw === "other" && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return { skip: "unsupported" };

  const units = num(p.units) ?? num(p.fractional_units) ?? 0;
  if (units < 0) return { skip: "short" };
  if (!(units > 0)) return { skip: "zero" };

  // currency hygiene: pence quotes (LSE "GBX"/"GBp") become pounds; anything non-ISO falls back to USD
  let priceScale = 1;
  if (ccy === "GBX" || ccy === "GBP." || ccy === "GBP" && /\.L$/.test(sym) && (num(p.price) ?? 0) > 1000) { /* leave GBP prices > 1000 alone: could be a real price */ }
  if (ccy === "GBX") { ccy = "GBP"; priceScale = 0.01; }
  if (ccy === "ZAC") { ccy = "ZAR"; priceScale = 0.01; }
  if (!ISO.test(ccy)) ccy = "USD";

  const kind: Mapped["kind"] = KIND[kindRaw] ?? "equity";
  let yahoo: string | null = null;
  if (kind === "crypto") {
    const base = normalizeCrypto(sym) || normalizeCrypto(raw);
    if (!base) return { skip: "cash" };
    sym = base; yahoo = `${base}-USD`;
    if (ccy !== "USD") { /* crypto is priced in USD by our pipeline; brokerage value in local ccy still lands via price below */ }
  } else {
    // class shares: "BRKB" / "BRK B" -> "BRK.B" (Assetly symbol), Yahoo wants "BRK-B"
    const cls = sym.match(/^([A-Z]{2,})[ .]?([AB])$/);
    if (cls && /class [ab]/i.test(desc)) { sym = `${cls[1]}.${cls[2]}`; yahoo = `${cls[1]}-${cls[2]}`; }
    // SnapTrade's formatted symbol carries the Yahoo-compatible venue suffix (.TO .V .L .AX .HK .NS .DE .PA ...); keep it
  }
  if (excluded.has(sym)) return { skip: "excluded" };

  const price0 = num(p.price);
  const price = price0 === null ? null : price0 * priceScale;
  // cost_basis is documented as "book OR average purchase price": a brokerage that reports the whole book value
  // per position (IBKR, some legacy feeds) would make the per-share cost absurd. Detect and divide.
  let avg = num(p.cost_basis) ?? num(p.average_purchase_price);
  if (avg !== null) {
    avg = avg * priceScale;
    const ref = price ?? null;
    if (ref !== null && ref > 0 && units > 1 && avg > ref * 8 && Math.abs(avg / units / ref - 1) < 3) avg = avg / units;
    else if (ref === null && units > 1 && p.cost_basis !== undefined && (p as { book_value?: unknown }).book_value !== undefined) avg = avg / units;
    if (avg < 0) avg = null;
  }
  return { sym, desc: desc || sym, ccy, exch: exch || (kind === "crypto" ? "CRYPTO" : "US"), kind, yahoo, units, avg, price };
}

export type MappedCash = { sym: string; ccy: string; amount: number; debt: boolean };
// balances: one element per currency; negative cash = margin debt
export function normalizeBalance(b: Record<string, unknown>): MappedCash | null {
  const code = String((b.currency as { code?: string } | undefined)?.code ?? (b.currency as string | undefined) ?? "USD").toUpperCase();
  const ccy = ISO.test(code) ? code : "USD";
  const cash = num(b.cash);
  if (cash === null || cash === 0) return null;
  const debt = cash < 0;
  const sym = (debt ? "$DEBT" : "$CASH") + (ccy === "USD" ? "" : `.${ccy}`);
  return { sym, ccy, amount: Math.abs(cash), debt };
}

export const accountLabel = (a: Record<string, unknown>): string => {
  const inst = String(a.institution_name ?? a.brokerage_name ?? "Brokerage");
  const numDigits = String(a.number ?? "").replace(/\D/g, "");
  return inst + (numDigits ? ` …${numDigits.slice(-4)}` : "");
};
