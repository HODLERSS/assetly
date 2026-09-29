// Price-fidelity helpers shared by the brief writers.
/** "to ₩1,300" for a stock at ₩1,761,000 (its USD price was $1,295): correct a currency mix-up to the real local
 *  price, drop any other quoted price more than 3% off. Only the "to/at <price>" clause is touched. */
export function fixQuotedPrices(note: string, localPx: number, currency: string, usdPx: number): string {
  const fmtLocal = currency === "KRW" ? `₩${Math.round(localPx).toLocaleString("en-US")}` : `$${localPx >= 1000 ? Math.round(localPx).toLocaleString("en-US") : localPx.toFixed(2)}`;
  const near = (a: number, b: number) => b > 0 && Math.abs(a / b - 1) <= 0.03;
  return String(note ?? "").replace(/\s(to|at|near|around)\s(₩|\$)(\d[\d,]*(?:\.\d+)?)/g, (m, prep, sym, num) => {
    const v = Number(String(num).replace(/,/g, ""));
    const labelLocal = (sym === "₩") === (currency === "KRW");
    if (labelLocal && near(v, localPx)) return m;
    if (!labelLocal && sym === "$" && near(v, usdPx) && currency === "USD") return m;
    if (near(v, usdPx) || near(v, localPx)) return ` ${prep} ${fmtLocal}`;
    return "";
  }).replace(/\s+([.,;])/g, "$1");
}
