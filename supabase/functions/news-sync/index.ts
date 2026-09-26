// Assetly news-sync — pulls per-symbol headlines from Yahoo Finance RSS and Google News RSS,
// dedupes on (symbol, url), and stores them in public.news. 15-minute schedule in production.
//
// Quality gate at ingest (audit 2026-09-25: about a third of "your holdings" stories were not about them):
//  - entities decoded ("&amp;" never reaches a title);
//  - quote pages, option chains, price listings and single-user social posts dropped;
//  - the holding must be CENTRAL: named in the title, or in the lead of a feed that is about that symbol
//    ("Is Ford Stock a Buy for Its Dividend?" was tagged NVDA);
//  - one story, one row: the same headline syndicated under different URLs or tickers is stored once, under
//    the holding it is most about, and never again once it is in the table;
//  - the byline is the real publisher (a Yahoo feed item linking to thestreet.com is TheStreet);
//  - a symbol-keyed feed item keeps its lead in `summary`, so the SAME gate can run again at read time
//    (_shared/news_rules.ts usableNews: every function that feeds headlines to a model, and the News tab)
//    and admit it on its lead exactly as ingest did.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { aliasesFor, centrality, decodeEntities, headlineOk, isJunkNews, newsRelevant, publisherFor, titleKey, urlDate } from "../_shared/intel.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type Item = { symbol: string; title: string; url: string; source: string; published_at: string | null; summary?: string | null };
type Parsed = Item & { lead: string; symbolFeed: boolean };

function parseRss(xml: string, symbol: string, source: string, symbolFeed = false): Parsed[] {
  const items: Parsed[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => {
      const x = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!x) return null;
      // entities decoded BEFORE tags are stripped: a description often arrives as escaped HTML
      return decodeEntities(x[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    };
    const title = pick("title");
    const link = pick("link");
    const pub = pick("pubDate");
    if (!title || !link) continue;
    let published: string | null = null;
    if (pub) { const d = new Date(pub); if (!isNaN(+d)) published = d.toISOString(); }
    // a feed that re-dates an old story ("TSLA Stock Jumps 3% Ahead Of Q2 Report", July, shown as 4h old in
    // round 4): the date in the article's own URL wins when it is more than a week earlier
    const ud = urlDate(link);
    if (ud && (!published || Date.parse(published) - Date.parse(ud + "T23:59:59Z") > 7 * 86400000)) published = ud + "T12:00:00.000Z";
    const [headline, publisher] = splitPublisher(title, source);
    items.push({ symbol, title: headline.slice(0, 500), url: link.slice(0, 1000), source: publisherFor(link, publisher), published_at: published, lead: (pick("description") ?? "").slice(0, 400), symbolFeed });
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

async function newsFor(symbol: string, yahoo: string, name: string): Promise<Parsed[]> {
  const out: Parsed[] = [];
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
  // Yahoo's headline feed and Seeking Alpha's combined feed are keyed to the symbol; Google News is a search
  if (y) out.push(...parseRss(y, symbol, "Yahoo Finance", true));
  if (g) out.push(...parseRss(g, symbol, "Google News").slice(0, 20));
  if (sa) out.push(...parseRss(sa, symbol, "Seeking Alpha", true).slice(0, 10));
  return out;
}

/** The ingest gate, pure so the fixture path runs it too: junk out, off-topic out, one row per story. */
function gate(items: Parsed[], aliasBy: Map<string, string[]>, knownKeys: Set<string>): { rows: Item[]; dropped: Record<string, number> } {
  const dropped = { junk: 0, offTopic: 0, duplicate: 0 };
  const kept: Parsed[] = [];
  for (const i of items) {
    if (isJunkNews(i.title, i.url, i.source)) { dropped.junk++; continue; }
    if (!newsRelevant(i.title, aliasBy.get(i.symbol) ?? [i.symbol], i.lead, i.symbolFeed)) { dropped.offTopic++; continue; }
    // r10 newcomer: the feed carried "82% Upside" pitches and a Hegseth story under BTC. Server-side gate (news_rules
    // stays the web's shared rule): buy-framed, listicle and forecast titles, and a title that does not name the holding
    // (a symbol feed's off-topic story), are not stored
    if (!headlineOk(i.title)) { dropped.junk++; continue; }
    if (!Number.isFinite(centrality(i.title, aliasBy.get(i.symbol) ?? [i.symbol]))) { dropped.offTopic++; continue; }
    kept.push(i);
  }
  // one row per story: the same headline under several tickers goes to the holding named earliest in it
  const best = new Map<string, Parsed>();
  for (const i of kept) {
    const k = titleKey(i.title);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur) { best.set(k, i); continue; }
    if (cur.symbol !== i.symbol && centrality(i.title, aliasBy.get(i.symbol) ?? []) < centrality(cur.title, aliasBy.get(cur.symbol) ?? [])) best.set(k, i);
  }
  const seenUrl = new Set<string>();
  const rows: Item[] = [];
  for (const i of kept) {
    const k = titleKey(i.title);
    if (best.get(k) !== i || knownKeys.has(k) || seenUrl.has(`${i.symbol}\u0000${i.url}`)) { dropped.duplicate++; continue; }
    seenUrl.add(`${i.symbol}\u0000${i.url}`);
    rows.push({ symbol: i.symbol, title: i.title, url: i.url, source: i.source, published_at: i.published_at, summary: i.symbolFeed && i.lead ? i.lead.slice(0, 300) : null });
  }
  return { rows, dropped };
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
  let items: Parsed[] = [];
  let targetCount = 0;
  const aliasBy = new Map<string, string[]>();
  const dry = url.searchParams.get("dry") === "1";
  if (url.searchParams.get("fixture") === "1") {
    // Test hook: parse caller-provided RSS bodies through the real parser and the real gate (no network,
    // and with dry=1 no database either — the gated rows come straight back). body.names maps symbol -> name.
    for (const f of body.feeds ?? []) items.push(...parseRss(f.xml, f.symbol, f.source ?? "fixture", f.symbolFeed === true));
    for (const sy of new Set(items.map((i) => i.symbol))) aliasBy.set(sy, aliasesFor(sy, body.names?.[sy] ?? null, body.names_kr?.[sy] ?? null));
    if (dry) { const g = gate(items, aliasBy, new Set()); return json({ ok: true, rows: g.rows, dropped: g.dropped, parsed: items.length }); }
  } else {
    // News only for symbols someone actually holds — the catalog is unbounded now.
    const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
    if (hErr) return json({ ok: false, error: hErr.message }, 500);
    const held = new Set((heldRows ?? []).map((h) => h.symbol));
    const { data: symbols, error } = await admin
      .from("symbols").select("symbol, yahoo, name, name_kr").eq("active", true).not("kind", "in", "(cash,debt)");
    if (error) return json({ ok: false, error: error.message }, 500);
    const only = url.searchParams.get("symbols")?.split(",") ??
      (Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(String).slice(0, 25) : undefined);   // a whole book on manual refresh
    const targets = (symbols ?? []).filter((s) => (only ? only.includes(s.symbol) : held.has(s.symbol)));
    targetCount = targets.length;
    for (const s of targets) aliasBy.set(s.symbol, aliasesFor(s.symbol, s.name, s.name_kr));
    // five symbols at a time (a whole new book took ~10s serially on the connect path; all at once would
    // hit the feeds with 75 requests in a burst)
    for (let i = 0; i < targets.length; i += 5) {
      const per = await Promise.all(targets.slice(i, i + 5).map((s) => newsFor(s.symbol, s.yahoo ?? s.symbol, s.name)));
      for (const p of per) items.push(...p);
    }
  }

  // Stories already stored under ANY symbol never repeat. Looked up by exact title (decoding at ingest keeps
  // titles stable), only for the rows that survived the gate, 20 titles per query and 8 queries at a time,
  // so the 15-minute lap over every held symbol stays a couple of seconds.
  const first = gate(items, aliasBy, new Set());
  const knownKeys = new Set<string>();
  const titles = [...new Set(first.rows.map((i) => i.title))];
  const since = new Date(Date.now() - 21 * 86400000).toISOString();
  const chunks: string[][] = [];
  for (let i = 0; i < titles.length; i += 20) chunks.push(titles.slice(i, i + 20));
  for (let i = 0; i < chunks.length; i += 8) {
    const res = await Promise.all(chunks.slice(i, i + 8).map((c) => admin.from("news").select("symbol,url,title").in("title", c).gte("fetched_at", since)));
    // the same row seen again (same symbol and url) is not a duplicate story: the upsert ignores it anyway
    for (const { data } of res) for (const r of data ?? []) knownKeys.add(titleKey(String(r.title)) + "\u0001" + r.symbol + "\u0001" + r.url);
  }
  const storedStory = new Set([...knownKeys].map((k) => k.split("\u0001")[0]));
  const rows = first.rows.filter((r) => !storedStory.has(titleKey(r.title)) || knownKeys.has(titleKey(r.title) + "\u0001" + r.symbol + "\u0001" + r.url));
  const dropped = { ...first.dropped, duplicate: first.dropped.duplicate + (first.rows.length - rows.length) };
  let wrote = 0;
  if (rows.length) {
    const { error: upErr, count } = await admin
      .from("news").upsert(rows, { onConflict: "symbol,url", ignoreDuplicates: true, count: "exact" });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);
    wrote = count ?? rows.length;
  }
  // the same gate over what is already stored (the last 14 days), a few hundred rows per run
  let pruned = 0;
  if (url.searchParams.get("fixture") !== "1" && !dry && new Date().getUTCMinutes() < 15) {   // r11 load: once an hour
    const { data: recent } = await admin.from("news").select("id, symbol, title").gte("published_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("published_at", { ascending: false }).limit(300);
    const bad = ((recent ?? []) as { id: number; symbol: string; title: string }[]).filter((r) => aliasBy.has(r.symbol) && (!headlineOk(String(r.title)) || !Number.isFinite(centrality(String(r.title), aliasBy.get(r.symbol)!)))).map((r) => r.id).slice(0, 50);   // r10 load: small batches
    if (bad.length) { const { error } = await admin.from("news").delete().in("id", bad); if (!error) pruned = bad.length; }
  }
  return json({ ok: true, symbols: targetCount, parsed: items.length, stored: wrote, dropped, ...(pruned ? { pruned } : {}) });
});
