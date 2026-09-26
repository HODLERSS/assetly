// Intelligence about what you hold NOW. The portfolio card is written by the hourly chain, so for up to an
// hour after a removal it still led with the stock you just removed ("Pepsi near yearly lows…" two minutes
// after PEP was deleted; r2 power-user audit). The client hides every bullet about a holding that is no
// longer in the book and says the card is catching up.
//
// What a bullet is about, best source first:
//   1. `bullet_symbols` / `news5_symbols` (server, migration 38): the holdings each bullet was written about.
//   2. `held_symbols`: the book at generation; the ones since removed are searched for in the text.
//   3. neither (a row from before the migration): the removals this device made, searched for in the text.
import type { Insight, PortfolioRow } from "./api";

type Removal = { symbol: string; name: string | null; at: string };
const KEY = (uid: string) => `assetly-removed:${uid}`;
const KEEP_MS = 7 * 86400_000;   // the hourly chain has long caught up by then

export function readRemovals(uid: string | null): Removal[] {
  if (!uid) return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY(uid)) ?? "[]") as Removal[];
    return Array.isArray(v) ? v.filter((r) => r && r.symbol && Date.now() - +new Date(r.at) < KEEP_MS) : [];
  } catch { return []; }
}
/** Remember a removal on this device (fallback 3 above). */
export function noteRemoval(uid: string | null, row: Pick<PortfolioRow, "symbol" | "name">) {
  if (!uid || row.symbol.startsWith("$")) return;
  const next = [...readRemovals(uid).filter((r) => r.symbol !== row.symbol), { symbol: row.symbol, name: row.name ?? null, at: new Date().toISOString() }];
  try { localStorage.setItem(KEY(uid), JSON.stringify(next)); } catch { /* private mode */ }
}
export function clearRemovals(uid: string) { try { localStorage.removeItem(KEY(uid)); } catch { /* ignore */ } }

/** The word people use for a company: "PepsiCo, Inc." -> "PepsiCo", "Ford Motor Company" -> "Ford". */
function nameStem(name: string | null | undefined): string | null {
  const w = (name ?? "").replace(/[,.]/g, " ").trim().split(/\s+/)[0] ?? "";
  return w.length >= 4 ? w : null;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does this text talk about `symbol` (by ticker, or by the company's name)? One-letter tickers ("F") only
 *  count as "$F" or "(F)": a bare capital F is an ordinary word. */
export function mentions(text: string, symbol: string, name?: string | null): boolean {
  const bare = symbol.replace(/\.(KS|KQ)$/i, "").replace(/-USD$/i, "");
  const tick = bare.length >= 2
    ? new RegExp(`(^|[^A-Za-z0-9])\\$?${esc(bare)}(?![A-Za-z0-9])`)
    : new RegExp(`(\\$${esc(bare)}|\\(${esc(bare)}\\))(?![A-Za-z0-9])`);
  if (tick.test(text)) return true;
  const stem = nameStem(name);
  // "Pepsi" is how a sentence says PepsiCo: a word the stem starts with (4+ letters) counts too
  if (stem) {
    const words = text.split(/[^\p{L}\p{N}'-]+/u).map((w) => w.replace(/'s$/i, ""));
    const lower = stem.toLowerCase();
    if (words.some((w) => w.length >= 4 && (w.toLowerCase() === lower || lower.startsWith(w.toLowerCase())))) return true;
  }
  return false;
}

export type HeldIntel = { bullets: string[]; news5: { text: string; source: string | null }[]; hidden: number };

/** The insight's bullets minus the ones about holdings that are gone. */
export function heldOnly(ins: Insight, rows: PortfolioRow[], removals: Removal[] = []): HeldIntel {
  const held = new Set(rows.filter((r) => r.kind !== "cash" && r.kind !== "debt").map((r) => r.symbol));
  const gone: { symbol: string; name: string | null }[] = ins.held_symbols?.length
    ? ins.held_symbols.filter((s) => !held.has(s)).map((s) => ({ symbol: s, name: removals.find((r) => r.symbol === s)?.name ?? null }))
    : removals.filter((r) => !held.has(r.symbol));
  let hidden = 0;
  const keepIdx = (list: string[], tags: string[][] | null | undefined) => list.map((_, i) => i).filter((i) => {
    const t = tags?.[i];
    const ok = Array.isArray(t) ? t.every((s) => held.has(s)) : !gone.some((g) => mentions(list[i], g.symbol, g.name));
    if (!ok) hidden++;
    return ok;
  });
  const bullets = ins.bullets ?? [], news = ins.news5 ?? [];
  return {
    bullets: keepIdx(bullets, ins.bullet_symbols).map((i) => bullets[i]),
    news5: keepIdx(news, ins.news5_symbols).map((i) => ({ text: news[i], source: ins.news5_sources?.[i] ?? null })),
    hidden,
  };
}
