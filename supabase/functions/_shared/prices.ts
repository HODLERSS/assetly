// Price-fidelity helpers shared by the brief writers.
/** "to ₩1,300" for a stock at ₩1,761,000 (its USD price was $1,295): correct a currency mix-up to the real local
 *  price, drop any other quoted price more than 3% off. Only the "to/at <price>" clause is touched. */
export function fixQuotedPrices(note: string, localPx: number, currency: string, usdPx: number): string {
  const fmtLocal = currency === "KRW" ? `₩${Math.round(localPx).toLocaleString("en-US")}` : `$${localPx >= 1000 ? Math.round(localPx).toLocaleString("en-US") : localPx.toFixed(2)}`;
  const near = (a: number, b: number) => b > 0 && Math.abs(a / b - 1) <= 0.03;
  // 10/1: a figure with a scale ("at $150B", "$8.2 billion") or a range ("at $100-150B", "$100 to $150 billion") is a
  // deal size or a valuation, never a share price: dropping it as a "wrong price" left "Solidigm IPO talk-150B" and
  // "SolidigmB". The lookahead spans the WHOLE number, so the digits cannot backtrack out of it.
  return String(note ?? "").replace(/\s(to|at|near|around)\s(₩|\$)(?![\d,]*(?:\.\d+)?\s?(?:[KMBTkmbt]\b|bn\b|thousand\b|million\b|billion\b|trillion\b|%|[-–]\s?[₩$]?\d|to\s[₩$]?\d))(\d[\d,]*(?:\.\d+)?)/g, (m, prep, sym, num) => {
    const v = Number(String(num).replace(/,/g, ""));
    const labelLocal = (sym === "₩") === (currency === "KRW");
    if (labelLocal && near(v, localPx)) return m;
    if (!labelLocal && sym === "$" && near(v, usdPx) && currency === "USD") return m;
    if (near(v, usdPx) || near(v, localPx)) return ` ${prep} ${fmtLocal}`;
    return "";
  }).replace(/\s+([.,;])/g, "$1");
}

// ---- Money-figure fidelity (owner, 10/1: "Portfolio sits at $1.37 M" when the app showed $1.25 M, and "MARA's -5.5%
// slide reduces portfolio value by $177,500" when $177,515 was MARA's loss SINCE PURCHASE, not the day's move).
// Both are fixed in the prompt data first; these two passes are the backstop over every written field.
const MONEY = /\$(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?)(K|M|B|thousand|million|billion)?\b/gi;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const moneyOf = (num: string, unit?: string) => Number(num.replace(/,/g, "")) * (unit ? SCALE[unit.toLowerCase()] : 1);
/** the same written style as the figure it replaces: "$1.25 M", "$27K", "$27,000" */
function fmtLike(v: number, unit: string | undefined, num: string, sep = ""): string {
  const a = Math.abs(v);
  if (unit) {
    const s = SCALE[unit.toLowerCase()], dec = (num.split(".")[1] ?? "").length;
    return `$${(a / s).toFixed(Math.max(dec, a / s < 10 ? 2 : 1)).replace(/\.0+$/, "")}${sep}${unit}`;
  }
  const r = a >= 100000 ? Math.round(a / 100) * 100 : a >= 10000 ? Math.round(a / 100) * 100 : Math.round(a);
  return `$${r.toLocaleString("en-US")}`;
}
const near = (a: number, b: number, tol: number) => b !== 0 && Math.abs(a / b - 1) <= tol;

/** A sentence that tells a holding's DAY move with its since-purchase gain/loss: swap the figure for the day's $. */
export function fixGainAsDayMove(text: string, holds: { names: string[]; dayUsd: number; totalGlUsd: number }[]): string {
  const DAY = /\b(today|slide|slid|slip|slipped|drop|dropped|fell|falls|rose|rises|jump|jumped|gain|gained|adds?|added|reduc\w*|contribut\w*|lift\w*|drag\w*|cost|sank|climb\w*|up|down)\b|[+\-−]\d+(?:\.\d+)?%/i;
  const LIFETIME = /\b(since (?:you )?(?:bought|purchase|buying)|all[- ]time|overall|unrealized|total (?:gain|loss|return)|cost basis|paper (?:gain|loss))\b/i;
  return String(text ?? "").split(/(?<=[.!?])\s+/).map((sent) => {
    if (LIFETIME.test(sent) || !DAY.test(sent)) return sent;
    const low = sent.toLowerCase();
    const h = holds.find((x) => x.names.some((n) => n && low.includes(n.toLowerCase())));
    if (!h || !h.totalGlUsd || near(Math.abs(h.dayUsd), Math.abs(h.totalGlUsd), 0.25)) return sent;
    return sent.replace(MONEY, (m, num: string, sep: string, unit?: string) =>
      unit && !/^[KMB]$/i.test(unit) && !sep ? m : near(moneyOf(num, unit), Math.abs(h.totalGlUsd), 0.03) ? fmtLike(h.dayUsd, unit, num, unit ? sep : "") + (unit ? "" : sep) : m);
  }).join(" ");
}

/** The portfolio's value is NET worth (assets minus debt), what the app shows. A gross-assets figure is corrected. */
export function fixGrossAsNet(text: string, gross: number, net: number): string {
  if (!(gross > 0) || near(net, gross, 0.03)) return String(text ?? "");
  return String(text ?? "").split(/(?<=[.!?])\s+/).map((sent) => {
    if (/\b(total assets|before (?:the )?(?:debt|loan)|gross)\b/i.test(sent)) return sent;
    return sent.replace(MONEY, (m, num: string, sep: string, unit?: string) =>
      near(moneyOf(num, unit), gross, 0.015) ? fmtLike(net, unit, num, unit ? sep : "") + (unit ? "" : sep) : m);
  }).join(" ");
}
