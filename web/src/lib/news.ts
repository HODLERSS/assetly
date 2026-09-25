// News list hygiene. Feeds repeat one story under several tickers and URLs ("Qualcomm's CMO reveals…"
// twice), and some titles arrive with HTML entities still encoded ("AT&amp;T").
import type { NewsItem } from "./api";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", middot: "·", bull: "•", trade: "™", reg: "®", copy: "©",
};

/** Decode HTML entities for display (text only; nothing is ever injected as HTML). Unknown names stay as written. */
export function decodeEntities(s: string): string {
  // twice: feeds sometimes double-encode ("&amp;amp;")
  let out = s;
  for (let i = 0; i < 2 && out.includes("&"); i++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return out;
}

/** Two headlines are the same story when they match ignoring case, punctuation, quotes and spacing. */
export function titleKey(t: string): string {
  return decodeEntities(t).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Keep the first (newest) copy of each story, by URL and by normalized title. Titles come back decoded. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const urls = new Set<string>(), titles = new Set<string>();
  const out: NewsItem[] = [];
  for (const n of items) {
    const k = titleKey(n.title);
    if (urls.has(n.url) || (k && titles.has(k))) continue;
    urls.add(n.url); if (k) titles.add(k);
    out.push({ ...n, title: decodeEntities(n.title), source: decodeEntities(n.source ?? "") });
  }
  return out;
}
