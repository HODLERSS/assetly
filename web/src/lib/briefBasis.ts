// Was a brief written for the book on screen? Every edition (not only the assessment) describes specific
// holdings, and a Midday Pulse opened a newcomer's first Home on "Your TSLA stake is doing most of today's
// damage" when they held only NVDA (r3 newcomer M1). An assessment from 1.0.0 led with "anchored by Pepsi",
// "$274,900 total", "$12,500 debt" for a book that held none of it (r3 power-user M3).
//
// Best source first:
//   1. sections.held (daily-brief, 2026-09-25): the symbols it was written for, compared as a set.
//   2. older rows: the holdings the text names. The "Your positions" / "Quality read" section lists one
//      holding per line, so each line's name must still be in the book (by ticker, company-name stem or
//      Korean name). An assessment also states its total; far off the live one means another book.
import type { DailyBrief, PortfolioRow } from "./api";
import { mentions } from "./heldIntel";

export type BookName = Pick<PortfolioRow, "symbol" | "kind"> & { name?: string | null; name_kr?: string | null };

/** Holdings only: cash and debt are balances, not what a brief's position lines are about. */
const holdingsOf = (book: BookName[]) => book.filter((r) => r.kind !== "cash" && r.kind !== "debt");

// Position-line names that are not a holding ("Your cash", "The book", "Index futures").
const GENERIC = /^(your |the |our )?(cash|debt|book|portfolio|market|markets|index|indexes|futures|overall|everything|rest|korea|us|crypto|other)\b/i;

/** Does a position line's name refer to something in the book? */
function inBook(label: string, book: BookName[]): boolean {
  const l = label.trim();
  if (!l || GENERIC.test(l)) return true;   // not a holding: nothing to contradict
  return holdingsOf(book).some((r) => mentions(l, r.symbol, r.name)
    || (!!r.name_kr && l.includes(r.name_kr))
    // the line may carry the full name ("Samsung Electronics") where the book stores it ("Samsung Electronics Co., Ltd.")
    || (!!r.name && r.name.toLowerCase().startsWith(l.toLowerCase()) && l.length >= 4));
}

/** "$274,900", "$274.9K", "$1.2M", "₩17,875,000" as a number (USD figures only; won totals are skipped). */
function readUsd(s: string): number | null {
  const m = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] ?? "").toLowerCase();
  return n * (u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "million" ? 1e6 : 1);
}

/** The total an assessment states ("Total assets $274,900", "a $26,600 book"), or null. */
export function statedTotal(brief: DailyBrief): number | null {
  const s = brief.sections ?? ({} as DailyBrief["sections"]);
  const text = [s.lede, s.overnight, s.desk_view, s.horizon].filter(Boolean).join(" ");
  const re = /\b(?:total(?:\s+(?:assets|value|portfolio|book))?|net worth|a|an)\s*(?:of|:|is|at|=)?\s*(\$\s?[\d,]+(?:\.\d+)?(?:\s?(?:k|m|thousand|million)\b)?)(?:\s+(?:book|portfolio|in total|total))?/gi;
  for (const m of text.matchAll(re)) {
    // "a $X" only counts when it is the book's size ("a $26,600 book"), not "a $5 move"
    if (/^(a|an)\b/i.test(m[0]) && !/(book|portfolio|in total|total)\s*$/i.test(m[0])) continue;
    const v = readUsd(m[1]);
    if (v !== null) return v;
  }
  return null;
}

export type Basis = { stale: boolean; why: "held" | "names" | "total" | null; unheld: string[] };

/** Whether `brief` was written for this book. `total` is the live gross assets in USD (null: not checked). */
export function briefBasis(brief: DailyBrief, book: BookName[] | null, total: number | null = null): Basis {
  const fresh: Basis = { stale: false, why: null, unheld: [] };
  if (!book) return fresh;
  const s = brief.sections ?? ({} as DailyBrief["sections"]);
  const now = new Set(holdingsOf(book).map((r) => r.symbol));
  if (Array.isArray(s.held)) {
    const was = new Set(s.held.filter((x) => !String(x).startsWith("$")));
    const same = was.size === now.size && [...was].every((x) => now.has(x));
    return same ? fresh : { stale: true, why: "held", unheld: [...was].filter((x) => !now.has(x)) };
  }
  // an older row: read what it names
  const unheld = (s.positions ?? []).map((p) => p?.name ?? "").filter((n) => n && !inBook(n, book));
  if (unheld.length) return { stale: true, why: "names", unheld };
  if (brief.edition === "assessment" && total !== null && total > 0) {
    const said = statedTotal(brief);
    if (said !== null && Math.abs(said - total) / total > 0.25) return { stale: true, why: "total", unheld: [] };
  }
  return fresh;
}
