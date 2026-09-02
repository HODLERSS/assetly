// Assetly news-sync — pulls per-symbol headlines from Yahoo Finance RSS and Google News RSS,
// dedupes on (symbol, url), and stores them in public.news. 15-minute schedule in production.
import { createClient } from "jsr:@supabase/supabase-js@2";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type Item = { symbol: string; title: string; url: string; source: string; published_at: string | null };

function parseRss(xml: string, symbol: string, source: string): Item[] {
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => {
      const x = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!x) return null;
      return x[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
    };
    const title = pick("title");
    const link = pick("link");
    const pub = pick("pubDate");
    if (!title || !link) continue;
    let published: string | null = null;
    if (pub) { const d = new Date(pub); if (!isNaN(+d)) published = d.toISOString(); }
    const [head, pub] = splitPublisher(title, source);
    items.push({ symbol, title: head.slice(0, 500), url: link.slice(0, 1000), source: pub, published_at: published });
  }
  return items;
}

// Google News (and its Korean edition) is an aggregator: every title arrives as
// "<headline> - <publisher>", and the publisher is the byline the reader actually wants. Split on the
// LAST " - " so a headline that contains a dash keeps it; leave the title alone when the tail does not
// look like a publisher name (too long, empty, or the whole title).
const AGGREGATORS = new Set(["Google News", "K-News"]);
export function splitPublisher(title: string, source: string): [string, string] {
  if (!AGGREGATORS.has(source)) return [title, source];
  const i = title.lastIndexOf(" - ");
  if (i < 8) return [title, source];
  const head = title.slice(0, i).trim(), pub = title.slice(i + 3).trim();
  if (!head || !pub || pub.length > 60) return [title, source];
  return [head, pub];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml,text/xml,*/*" } });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

async function newsFor(symbol: string, yahoo: string, name: string): Promise<Item[]> {
  const out: Item[] = [];
  // Korean listings: pull the Korean press (Naver News and friends) via Google News KR.
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
    const kr = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" 주가 OR 실적`)}&hl=ko&gl=KR&ceid=KR:ko`);
    if (kr) out.push(...parseRss(kr, symbol, "K-News").slice(0, 15));
  }
  const [y, g, sa] = await Promise.all([
    fetchText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahoo)}&region=US&lang=en-US`),
    fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" OR ${yahoo} stock`)}&hl=en-US&gl=US&ceid=US:en`),
    /^[A-Z.]+$/.test(yahoo) ? fetchText(`https://seekingalpha.com/api/sa/combined/${encodeURIComponent(yahoo.replace(".", "-"))}.xml`) : Promise.resolve(null),
  ]);
  if (y) out.push(...parseRss(y, symbol, "Yahoo Finance"));
  if (g) out.push(...parseRss(g, symbol, "Google News").slice(0, 20));
  if (sa) out.push(...parseRss(sa, symbol, "Seeking Alpha").slice(0, 10));
  return out;
}

// Same story syndicated at different URLs: collapse by normalized title per symbol.
function titleKey(symbol: string, title: string): string {
  return symbol + "\u0000" + title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim().slice(0, 80);
}

// Browser-called for instant per-symbol pulls (right after a position is added).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  // News only for symbols someone actually holds — the catalog is unbounded now.
  const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
  if (hErr) return json({ ok: false, error: hErr.message }, 500);
  const held = new Set((heldRows ?? []).map((h) => h.symbol));
  const { data: symbols, error } = await admin
    .from("symbols").select("symbol, yahoo, name").eq("active", true).not("kind", "in", "(cash,debt)");
  if (error) return json({ ok: false, error: error.message }, 500);
  const only = url.searchParams.get("symbols")?.split(",") ??
    (Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(String).slice(0, 25) : undefined);   // a whole book on manual refresh
  const targets = (symbols ?? []).filter((s) => (only ? only.includes(s.symbol) : held.has(s.symbol)));

  let items: Item[] = [];
  if (url.searchParams.get("fixture") === "1") {
    // Test hook: parse caller-provided RSS bodies through the real parser (no network).
    for (const f of body.feeds ?? []) items.push(...parseRss(f.xml, f.symbol, f.source ?? "fixture"));
    if (url.searchParams.get("dry") === "1") return json({ ok: true, rows: items });   // parse only, write nothing
  } else {
    for (const s of targets) items.push(...await newsFor(s.symbol, s.yahoo ?? s.symbol, s.name));
  }

  // in-batch dedupe, then upsert with DB-level (symbol,url) dedupe
  const seen = new Set<string>();
  const seenTitle = new Set<string>();
  const rows = items.filter((i) => {
    const k = `${i.symbol}\u0000${i.url}`;
    const t = titleKey(i.symbol, i.title);
    if (seen.has(k) || seenTitle.has(t)) return false;
    seen.add(k); seenTitle.add(t); return true;
  });
  let wrote = 0;
  if (rows.length) {
    const { error: upErr, count } = await admin
      .from("news").upsert(rows, { onConflict: "symbol,url", ignoreDuplicates: true, count: "exact" });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);
    wrote = count ?? rows.length;
  }
  return json({ ok: true, symbols: targets.length, parsed: items.length, stored: wrote });
});
