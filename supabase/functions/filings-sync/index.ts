// Assetly filings-sync — daily: ~13 months of SEC filings (8-K, 10-K, 10-Q, proxies)
// per held US company from EDGAR. Major forms float into news as "SEC Filing" (last 9 months only);
// the list feeds insights-sync and ASK.
// Coverage (round 2, 2026-09-25): the lap used to take the first 12 held symbols in table order, so 18 of 37
// held US names (TSLA, AVGO among them) had no filings at all and read "no earnings date on file". Every held
// symbol is now visited, the ones with no filings (or the stalest) first, four at a time inside a time budget.
// Window: 400 days, so the same quarter a year earlier is on file and dates the next report by the company's
// own yearly rhythm (Alphabet: Oct 29, 2025 -> ~Oct 28, 2026; "last + 91 days" said Oct 21).
// 8-K item numbers are kept (`items`, e.g. "2.02,9.01"): item 2.02 "Results of Operations" IS the earnings
// release, which dates the last report exactly and anchors every next-earnings estimate (see
// _shared/intel.ts lastEarnings). Until migration 35 adds the column, rows are written without it.
import { createClient } from "jsr:@supabase/supabase-js@2";

const UA = "Assetly/1.0 (contact: minjae.m.lee@gmail.com)";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const KEEP_FORMS = new Set(["8-K", "8-K/A", "10-K", "10-K/A", "10-Q", "10-Q/A", "DEF 14A", "S-3", "424B5"]);
const WINDOW_DAYS = 400;        // filings kept (the year-ago quarter anchors the next-earnings estimate)
const NEWS_WINDOW_DAYS = 270;   // filings surfaced as news rows
const BUDGET_MS = 100000;       // the lap stops starting new symbols after this (the platform wall clock is 150s)

/** Shares outstanding from XBRL: the cover-page count (dei:EntityCommonStockSharesOutstanding) when the company
 *  reports one total, else the latest weighted diluted count (multi-class companies such as Alphabet report the
 *  cover count per class). Round 3: Ask invented "TSLA has more shares than AVGO" with nothing to check it by. */
async function sharesOutstanding(cik: string): Promise<{ n: number; asOf: string } | null> {
  const concept = async (tax: string, name: string, unit = "shares") => {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${tax}/${name}.json`, { headers: { "User-Agent": UA } }).catch(() => null);
    if (!r || !r.ok) return null;
    const j = await r.json().catch(() => null) as { units?: Record<string, { end: string; val: number; form?: string; fp?: string }[]> } | null;
    const pts = (j?.units?.[unit] ?? []).filter((x) => x.val > 0 && /^10-[QK]/.test(String(x.form ?? "")));
    if (!pts.length) return null;
    const last = pts.reduce((a, b) => (b.end > a.end ? b : a));
    // (the concept API carries no class dimensions: one undimensioned total per filing, or none)
    return { n: last.val, asOf: last.end };
  };
  return await concept("dei", "EntityCommonStockSharesOutstanding") ?? await concept("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding");
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture") === "1";
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  const { data: heldRows, error: hErr } = await admin.from("holdings").select("symbol");
  if (hErr) return json({ ok: false, error: hErr.message }, 500);
  const held = [...new Set((heldRows ?? []).map((h) => h.symbol))]
    .filter((s) => !s.startsWith("$") && s !== "USDKRW" && !s.endsWith(".KS") && !s.endsWith(".KQ"));
  const only = url.searchParams.get("symbols")?.split(",") ??
    (Array.isArray(body.symbols) && body.symbols.length ? body.symbols.map(String) : undefined);
  let targets = held.filter((s) => !only || only.includes(s));
  if (!fixture && targets.length) {
    // least recently fetched first; a symbol with no filings at all goes to the front
    const { data: seen } = await admin.from("filings").select("symbol, fetched_at").in("symbol", targets).order("fetched_at", { ascending: false }).limit(5000);
    const lastFetch = new Map<string, number>();
    for (const r of seen ?? []) if (!lastFetch.has(r.symbol)) lastFetch.set(r.symbol, +new Date(r.fetched_at));
    targets = targets.sort((a, b) => (lastFetch.get(a) ?? 0) - (lastFetch.get(b) ?? 0));
  }
  const t0 = Date.now();

  let cikMap: Record<string, string> = {};
  if (!fixture && targets.length) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
    if (!r.ok) return json({ ok: false, error: "cik map " + r.status }, 502);
    const raw = await r.json() as Record<string, { cik_str: number; ticker: string }>;
    for (const v of Object.values(raw)) cikMap[v.ticker.toUpperCase()] = String(v.cik_str).padStart(10, "0");
  }

  let wrote = 0;
  const errors: string[] = [];
  let hasItems = true;   // flips off once if the column is not there yet
  const upsertFiling = async (row: Record<string, unknown>) => {
    if (hasItems) {
      const r = await admin.from("filings").upsert(row, { onConflict: "symbol,accession" });
      if (!r.error || !/items/.test(r.error.message)) return r;
      hasItems = false;
    }
    const { items: _drop, ...rest } = row;
    return await admin.from("filings").upsert(rest, { onConflict: "symbol,accession" });
  };
  const one = async (symbol: string) => {
    try {
      if (fixture) {
        const f = body.filing ?? { accession: "0001628280-26-000001", form: "10-Q", title: `${symbol} quarterly report`, filed: "2026-08-01", url: `https://www.sec.gov/fixture/${symbol}` };
        await upsertFiling({ symbol, accession: f.accession, form: f.form, title: f.title, filed_at: f.filed, url: f.url, items: f.items ?? null });
        await admin.from("news").upsert({ symbol, title: `${f.form}: ${f.title}`, url: f.url, source: "SEC Filing", published_at: f.filed + "T12:00:00Z" }, { onConflict: "symbol,url", ignoreDuplicates: true });
        wrote++; return;
      }
      const cik = cikMap[symbol.replace(".", "-").toUpperCase()] ?? cikMap[symbol.toUpperCase()];
      if (!cik) { errors.push(symbol + ": no CIK"); return; }
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA } });
      if (!r.ok) { errors.push(symbol + ": edgar " + r.status); return; }
      const sub = await r.json();
      const rec = sub?.filings?.recent;
      if (!rec?.form) return;
      const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const newsCutoff = new Date(Date.now() - NEWS_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      for (let i = 0; i < rec.form.length; i++) {
        const form = rec.form[i];
        const filed = rec.filingDate[i];
        if (!KEEP_FORMS.has(form) || filed < cutoff) continue;
        const accession = rec.accessionNumber[i];
        const doc = rec.primaryDocument?.[i] ?? "";
        const title = (rec.primaryDocDescription?.[i] || `${form} filing`).slice(0, 300);
        const furl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`;
        const items = String(rec.items?.[i] ?? "").trim() || null;
        const { error: fErr } = await upsertFiling({ symbol, accession, form, title, filed_at: filed, url: furl, items, fetched_at: new Date().toISOString() });
        if (fErr) { errors.push(symbol + ": " + fErr.message); break; }
        wrote++;
        if (["8-K", "10-K", "10-Q"].includes(form) && filed >= newsCutoff) {
          await admin.from("news").upsert({ symbol, title: `${form} filed: ${title}`.slice(0, 500), url: furl.slice(0, 1000), source: "SEC Filing", published_at: filed + "T12:00:00Z" }, { onConflict: "symbol,url", ignoreDuplicates: true });
        }
      }
      // company size for Ask's premise checks (migration 39; a missing column is ignored)
      const shares = await sharesOutstanding(cik);
      if (shares) await admin.from("symbols").update({ shares_outstanding: shares.n, shares_as_of: shares.asOf }).eq("symbol", symbol).then(() => {}, () => {});
    } catch (e) { errors.push(symbol + ": " + (e instanceof Error ? e.message : String(e))); }
  };
  // four at a time (EDGAR allows 10 requests a second), inside the budget; the rest lead the next lap
  let visited = 0;
  for (let i = 0; i < targets.length; i += 4) {
    if (!fixture && Date.now() - t0 > BUDGET_MS) break;
    await Promise.all(targets.slice(i, i + 4).map(one));
    visited = Math.min(targets.length, i + 4);
  }
  return json({ ok: true, targets: targets.length, visited, wrote, errors: errors.slice(0, 5) });
});
