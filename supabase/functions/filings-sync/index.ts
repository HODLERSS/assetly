// Assetly filings-sync — daily: ~9 months of SEC filings (8-K, 10-K, 10-Q, proxies)
// per held US company from EDGAR. Major forms float into news as "SEC Filing";
// the list feeds insights-sync and ASK.
import { createClient } from "jsr:@supabase/supabase-js@2";

const UA = "Assetly/1.0 (contact: minjae.m.lee@gmail.com)";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const KEEP_FORMS = new Set(["8-K", "8-K/A", "10-K", "10-K/A", "10-Q", "10-Q/A", "DEF 14A", "S-3", "424B5"]);
const WINDOW_DAYS = 270;

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
  if (!fixture) targets = targets.slice(0, 12);

  let cikMap: Record<string, string> = {};
  if (!fixture && targets.length) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
    if (!r.ok) return json({ ok: false, error: "cik map " + r.status }, 502);
    const raw = await r.json() as Record<string, { cik_str: number; ticker: string }>;
    for (const v of Object.values(raw)) cikMap[v.ticker.toUpperCase()] = String(v.cik_str).padStart(10, "0");
  }

  let wrote = 0;
  const errors: string[] = [];
  for (const symbol of targets) {
    try {
      if (fixture) {
        const f = body.filing ?? { accession: "0001628280-26-000001", form: "10-Q", title: `${symbol} quarterly report`, filed: "2026-08-01", url: `https://www.sec.gov/fixture/${symbol}` };
        await admin.from("filings").upsert({ symbol, accession: f.accession, form: f.form, title: f.title, filed_at: f.filed, url: f.url }, { onConflict: "symbol,accession" });
        await admin.from("news").upsert({ symbol, title: `${f.form}: ${f.title}`, url: f.url, source: "SEC Filing", published_at: f.filed + "T12:00:00Z" }, { onConflict: "symbol,url", ignoreDuplicates: true });
        wrote++; continue;
      }
      const cik = cikMap[symbol.replace(".", "-").toUpperCase()] ?? cikMap[symbol.toUpperCase()];
      if (!cik) { errors.push(symbol + ": no CIK"); continue; }
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA } });
      if (!r.ok) { errors.push(symbol + ": edgar " + r.status); continue; }
      const sub = await r.json();
      const rec = sub?.filings?.recent;
      if (!rec?.form) continue;
      const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      for (let i = 0; i < rec.form.length; i++) {
        const form = rec.form[i];
        const filed = rec.filingDate[i];
        if (!KEEP_FORMS.has(form) || filed < cutoff) continue;
        const accession = rec.accessionNumber[i];
        const doc = rec.primaryDocument?.[i] ?? "";
        const title = (rec.primaryDocDescription?.[i] || `${form} filing`).slice(0, 300);
        const furl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`;
        const { error: fErr } = await admin.from("filings").upsert({ symbol, accession, form, title, filed_at: filed, url: furl }, { onConflict: "symbol,accession" });
        if (fErr) { errors.push(symbol + ": " + fErr.message); break; }
        wrote++;
        if (["8-K", "10-K", "10-Q"].includes(form)) {
          await admin.from("news").upsert({ symbol, title: `${form} filed: ${title}`.slice(0, 500), url: furl.slice(0, 1000), source: "SEC Filing", published_at: filed + "T12:00:00Z" }, { onConflict: "symbol,url", ignoreDuplicates: true });
        }
      }
    } catch (e) { errors.push(symbol + ": " + (e instanceof Error ? e.message : String(e))); }
  }
  return json({ ok: true, targets: targets.length, wrote, errors: errors.slice(0, 5) });
});
