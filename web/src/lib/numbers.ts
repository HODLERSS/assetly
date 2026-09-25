// Typed amounts: shares, cost per share, cash and debt balances. People paste numbers from
// brokerage statements ("1,000", "$1,250.50", "₩1,500,000"), and parseFloat("1,000") is 1 —
// a book silently wrong by 1000x (launch audit, 2026-09-25). Every number field reads through
// here: a clean number comes back, anything else becomes a plain, field-specific error.
import { ccySymbol, moneyExact } from "./format";

export type AmountField = "shares" | "units" | "cost" | "cash" | "debt";
export type Parsed = { ok: true; value: number } | { ok: false; reason: "empty" | "invalid" | "negative" };

// Currency marks a person might type in front of an amount: "$", "US$", "C$", "₩", "€", "£", "¥", "USD", "KRW"
const LEAD_CCY = /^(?:USD|KRW|[A-Z]{0,2}\$|₩|€|£|¥|₹)/i;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;   // 1,000 · 12,345.67 · 1,000,000.
const PLAIN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;          // 1000 · 1000.5 · .5 · 5.

/** Read a typed amount. Accepts thousands commas (properly grouped), spaces, and a leading currency
 *  mark; rejects anything that is not one clean number ("1.2.3", "abc", "1,2", "1e3"). The sign is
 *  reported separately so the caller can say "can't be negative" rather than "not a number". */
export function parseAmount(raw: string): Parsed {
  let s = raw.replace(/[\s   ]/g, "");   // spaces, incl. no-break and thin spaces
  if (!s) return { ok: false, reason: "empty" };
  let negative = false;
  if (/^[-−]/.test(s)) { negative = true; s = s.slice(1); }
  s = s.replace(LEAD_CCY, "");
  if (!negative && /^[-−]/.test(s)) { negative = true; s = s.slice(1); }   // "$-5"
  if (!s) return { ok: false, reason: "invalid" };
  let digits: string;
  if (s.includes(",")) {
    if (!GROUPED.test(s)) return { ok: false, reason: "invalid" };   // "1,2" or "1000,50" is not a thousands comma
    digits = s.replace(/,/g, "");
  } else if (PLAIN.test(s)) digits = s;
  else return { ok: false, reason: "invalid" };
  const value = Number(digits);
  if (!Number.isFinite(value)) return { ok: false, reason: "invalid" };
  if (negative && value !== 0) return { ok: false, reason: "negative" };
  return { ok: true, value };
}

const MSG: Record<AmountField, { empty: string; invalid: string; low: string }> = {
  shares: { empty: "Enter how many shares you own.", invalid: "Shares must be a number, like 10 or 1,250.5.", low: "Shares must be more than zero." },
  units: { empty: "Enter how much you own.", invalid: "Quantity must be a number, like 0.5 or 1,250.", low: "Quantity must be more than zero." },
  cost: { empty: "Enter what you paid per share.", invalid: "Cost must be a number, like 150 or 1,250.50.", low: "Cost can't be negative." },
  cash: { empty: "Enter the amount.", invalid: "Amount must be a number, like 1,500 or 250.75.", low: "Amount must be more than zero." },
  debt: { empty: "Enter the amount owed.", invalid: "Amount must be a number, like 1,500 or 250.75.", low: "Amount owed must be more than zero." },
};

// The currency a typed mark names, when it names one unambiguously. A bare "$" fits any dollar currency.
const MARKS: [RegExp, string][] = [[/^(?:KRW|₩)/i, "KRW"], [/^(?:USD|US\$)/i, "USD"], [/^€/, "EUR"], [/^£/, "GBP"], [/^¥/, "JPY"], [/^₹/, "INR"]];
export function typedCurrency(raw: string): string | "$" | null {
  const s = raw.replace(/[\s\u00a0\u2009\u202f]/g, "").replace(/^[-−]/, "");
  for (const [re, c] of MARKS) if (re.test(s)) return c;
  return /^[A-Z]{0,2}\$/i.test(s) ? "$" : null;
}

/** Parse one form field. Quantities must be > 0; a cost may be 0 (gifted or granted shares) but never negative.
 *  With `currency`, an amount typed with another currency's mark ("₩1,000" on a dollar stock) is refused:
 *  it used to save as $1,000 without a word (r2 power-user audit). */
export function readAmount(raw: string, field: AmountField, currency?: string): { value: number; error: null } | { value: null; error: string } {
  const p = parseAmount(raw);
  const m = MSG[field];
  const typed = currency && field !== "shares" && field !== "units" ? typedCurrency(raw) : null;
  if (typed && currency) {
    const fits = typed === "$" ? ccySymbol(currency).includes("$") : typed === currency;
    const mark = (c: string) => ccySymbol(c).trim();
    if (!fits) return { value: null, error: `That's a ${typed === "$" ? "$" : mark(typed)} amount, but this is priced in ${currency}. Enter it in ${mark(currency)}.` };
  }
  if (!p.ok) return { value: null, error: p.reason === "empty" ? m.empty : p.reason === "invalid" ? m.invalid : m.low };
  if (field !== "cost" && p.value <= 0) return { value: null, error: m.low };
  return { value: p.value, error: null };
}

/** A stored number put back into a field the way it would have been typed: 3000 -> "3,000", 12.5 -> "12.5". */
export function formatAmountInput(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: true });
}

/** "Use today's price": the quote as the cost field takes it, exactly the figure the button shows. It filled the
 *  raw quote, 922.765 under a button that said $922.77, and saved a cost basis nobody typed (r5 designer m-2):
 *  rounded to the currency's minor unit (cents; whole won). */
export function quoteInput(price: number, currency: string): string {
  return moneyExact(price, currency).slice(ccySymbol(currency).length);
}

/** Today on the reader's own calendar, as a date field holds it (YYYY-MM-DD). */
export const todayYmd = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Quantities as people write them: 1,000 · 0.0123 · 12.5 (no float noise, no forced decimals). */
export function formatQty(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** The echo shown under the fields before saving, so a slip ("1,000" read as 1) is visible before it lands.
 *  Returns null until the fields it needs parse. */
export function entryPreview(opts: { kind: string; qty: string; cost?: string; currency: string; unit?: string }): string | null {
  const cashish = opts.kind === "cash" || opts.kind === "debt";
  const q = parseAmount(opts.qty);
  if (!q.ok || q.value <= 0) return null;
  // an amount typed in another currency ("\u20a91,000" on a dollar stock) is refused on save; the echo never
  // restates it as "$1,000.00" beside that error (r3 power-user)
  const foreign = (raw: string) => readAmount(raw, cashish ? "cash" : "cost", opts.currency).error !== null && typedCurrency(raw) !== null;
  if (cashish) return foreign(opts.qty) ? null : `${opts.kind === "debt" ? "Amount owed" : "Amount"}: ${moneyExact(q.value, opts.currency)}`;
  if (foreign(opts.cost ?? "")) return null;
  const c = parseAmount(opts.cost ?? "");
  const unit = opts.unit ?? (q.value === 1 ? "share" : "shares");
  if (!c.ok) return `${formatQty(q.value)} ${unit}`;
  return `${formatQty(q.value)} ${unit} × ${moneyExact(c.value, opts.currency)} = ${moneyExact(q.value * c.value, opts.currency)}`;
}

