// The News tab's read-time gate is a port of supabase/functions/_shared/news_rules.ts; both must pass the same
// vectors (supabase/functions/_shared/news_cases.json), so the two copies cannot drift apart silently.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aliasesFor, cleanNews, dedupeNews, isJunkNews, publisherFor, usableNews } from "../lib/news";
import type { NewsItem } from "../lib/api";

type Cases = {
  junk: { title: string; url: string; source: string; junk: boolean }[];
  usable: { symbol: string; name: string; name_kr?: string; title: string; url: string; source: string; summary?: string; usable: boolean }[];
  publisher: { url: string; source: string; publisher: string }[];
};
// vitest runs from web/ (jsdom gives import.meta.url an http scheme, so the path is resolved from the cwd)
const cases = JSON.parse(readFileSync(resolve(process.cwd(), "../supabase/functions/_shared/news_cases.json"), "utf8")) as Cases;

describe("news rules (shared vectors with the server)", () => {
  it("junk", () => { for (const c of cases.junk) expect(isJunkNews(c.title, c.url, c.source), c.title).toBe(c.junk); });
  it("read-time usability", () => {
    for (const c of cases.usable) expect(usableNews(c, aliasesFor(c.symbol, c.name, c.name_kr)), `${c.symbol}: ${c.title}`).toBe(c.usable);
  });
  it("publisher", () => { for (const c of cases.publisher) expect(publisherFor(c.url, c.source), c.url).toBe(c.publisher); });
});

describe("News tab read-time gate", () => {
  const row = (id: string, symbol: string, title: string, url: string, source: string, summary?: string): NewsItem =>
    ({ id, symbol, title, url, source, published_at: null, ...(summary ? { summary } : {}) });
  it("drops option chains and stories about other companies, keeps the holding's own, fixes the byline", () => {
    const out = cleanNews([
      row("1", "QQQM", "QQQM Nov 2026 260.000 call (QQQM261120C00260000) Stock Historical Prices & Data", "https://news.google.com/x", "Yahoo Finance"),
      row("2", "NVDA", "Is Ford Stock a Buy for Its Dividend?", "https://www.fool.com/a", "Yahoo Finance"),
      row("3", "NVDA", "Nvidia Tests Key Level Amid Trump-Xi Talks", "https://www.fool.com/b", "Yahoo Finance"),
      row("4", "QQQM", "Big Tech leads the Nasdaq 100 higher", "https://247wallst.com/c", "Yahoo Finance"),
    ], { NVDA: { name: "NVIDIA Corp" }, QQQM: { name: "Invesco NASDAQ 100 ETF" } });
    expect(out.map((x) => x.id)).toEqual(["3", "4"]);
    expect(out.map((x) => x.source)).toEqual(["The Motley Fool", "24/7 Wall St."]);
  });
  it("a symbol missing from the catalog still gets the junk rules", () => {
    expect(cleanNews([row("1", "ZZZ", "ZZZ Oct 2026 12.500 call (ZZZ261016C00012500) quote", "https://x/1", "y"), row("2", "ZZZ", "Anything", "https://x/2", "y")], {}).map((x) => x.id)).toEqual(["2"]);
  });
  it("dedupeNews drops a junk page even when the caller skipped the gate", () => {
    expect(dedupeNews([row("1", "AVGO", "$Broadcom (AVGO.US)$ Shorted 32 shares at $363.58", "https://news.google.com/x", "Moomoo")])).toEqual([]);
  });
});
