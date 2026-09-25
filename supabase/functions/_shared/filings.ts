// The filings that date earnings (8-Ks and the 10-Q / 10-K they precede), for several symbols at once.
//
// Why a helper: each function read "the newest N filings of any form" (Ask 120 across 12 symbols, insights 20
// per symbol, the brief 200 across 8). filings-sync keeps 13 months now, and Alphabet alone files dozens of
// 424B5 prospectus supplements, so the year-ago quarter fell off the end of the page and the estimate fell
// back to "last + 91 days": GOOGL ~Oct 21 instead of ~Oct 28, AVGO ~Dec 2 instead of ~Dec 10 (round 3).
import type { FilingLite } from "./intel.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export async function earningsFilings(admin: Db, symbols: string[], now = Date.now()): Promise<(FilingLite & { symbol: string })[]> {
  const syms = [...new Set(symbols.filter(Boolean))];
  if (!syms.length) return [];
  const since = new Date(now - 420 * 86400000).toISOString().slice(0, 10);
  const q = (cols: string) => admin.from("filings").select(cols).in("symbol", syms).in("form", ["8-K", "10-Q", "10-K"])
    .gte("filed_at", since).order("filed_at", { ascending: false }).limit(1000);
  let r = await q("symbol,form,filed_at,items");
  if (r.error) r = await q("symbol,form,filed_at");   // before migration 35 (items) the column is not there
  return ((r.data ?? []) as (FilingLite & { symbol: string })[]);
}
