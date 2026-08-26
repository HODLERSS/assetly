// Assetly transcripts-sync — daily: finds the latest earnings-call transcripts (Motley
// Fool via Google News), stores full text (latest 4 per symbol), and floats each one
// into the news feed as source "Earnings Call". Fixture mode for tests.
import { createClient } from "jsr:@supabase/supabase-js@2";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function parseItems(xml: string): { title: string; url: string; pub: string | null }[] {
  const out: { title: string; url: string; pub: string | null }[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => {
      const x = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return x ? x[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim() : null;
    };
    const title = pick("title"), url = pick("link"), pub = pick("pubDate");
    if (title && url) out.push({ title, url, pub: pub ? new Date(pub).toISOString() : null });
  }
  return out;
}

function extractText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, " ").replace(/\s+/g, " ").trim();
  const i = body.search(/prepared remarks|operator[:.]|earnings call/i);
  return body.slice(Math.max(0, i), Math.max(0, i) + 80000);
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
  if (hErr) return json({ ok: false, error: hErr.message }, 500);
  const held = [...new Set((heldRows ?? []).map((h) => h.symbol))].filter((s) => !s.startsWith("$") && s !== "USDKRW" && !s.endsWith(".KS") && !s.endsWith(".KQ"));
  const only = url.searchParams.get("symbols")?.split(",") ??
    (Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(String) : undefined);
  let targets = held.filter((s) => !only || only.includes(s));
  if (!fixture) targets = targets.slice(0, 8);

  let wrote = 0;
  const errors: string[] = [];
  for (const symbol of targets) {
    try {
      if (fixture) {
        const t = body.transcript ?? { title: `${symbol} Q2 2026 Earnings Call Transcript`, url: `https://fixture.test/${symbol}-q2`, content: "Prepared remarks: revenue grew strongly. Q&A: margins discussed.", pub: new Date().toISOString() };
        await admin.from("transcripts").upsert({ symbol, url: t.url, title: t.title, content: t.content, published_at: t.pub }, { onConflict: "symbol,url" });
        await admin.from("news").upsert({ symbol, title: t.title, url: t.url, source: "Earnings Call", published_at: t.pub }, { onConflict: "symbol,url", ignoreDuplicates: true });
        wrote++; continue;
      }
      const { data: srow } = await admin.from("symbols").select("name").eq("symbol", symbol).single();
      const q = encodeURIComponent(`"${srow?.name ?? symbol}" earnings call transcript site:fool.com`);
      const r = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, { headers: { "User-Agent": UA } });
      if (!r.ok) { errors.push(symbol + ": rss " + r.status); continue; }
      const items = parseItems(await r.text()).filter((i) => /transcript/i.test(i.title)).slice(0, 4);
      const { data: have } = await admin.from("transcripts").select("url").eq("symbol", symbol);
      const known = new Set((have ?? []).map((x) => x.url));
      for (const it of items) {
        if (known.has(it.url)) continue;
        const page = await fetch(it.url, { headers: { "User-Agent": UA }, redirect: "follow" }).catch(() => null);
        if (!page?.ok) continue;
        const content = extractText(await page.text());
        if (content.length < 2000) continue;                     // not a real transcript page
        await admin.from("transcripts").upsert({ symbol, url: it.url, title: it.title.slice(0, 400), content, published_at: it.pub }, { onConflict: "symbol,url" });
        await admin.from("news").upsert({ symbol, title: it.title.slice(0, 500), url: it.url.slice(0, 1000), source: "Earnings Call", published_at: it.pub }, { onConflict: "symbol,url", ignoreDuplicates: true });
        wrote++;
      }
      // retention: newest 4 per symbol
      const { data: all } = await admin.from("transcripts").select("url,published_at").eq("symbol", symbol).order("published_at", { ascending: false, nullsFirst: false });
      for (const extra of (all ?? []).slice(4)) await admin.from("transcripts").delete().eq("symbol", symbol).eq("url", extra.url);
    } catch (e) { errors.push(symbol + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, errors: errors.slice(0, 5) });
});
