// Persona simulator — compressed "30 days" of realistic usage against the LOCAL stack
// (vite dev @ localhost:5173 + supabase start). Usage: node e2e/persona-sim.mjs --id p03
// Never throws: every friction/bug lands in the JSON report for the persona agent to review.
import { chromium, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const id = process.argv[process.argv.indexOf("--id") + 1];
const persona = JSON.parse(fs.readFileSync(new URL("./personas.json", import.meta.url))).find((p) => p.id === id);
if (!persona) { console.error("unknown persona", id); process.exit(2); }

const URL_ = "http://localhost:5173/";
const SB = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const OUT = "/tmp/persona-reports";

const report = { persona: persona.id, name: persona.name, goal: persona.goal, daysDone: 0,
  actions: 0, bugs: [], frictions: [], notes: [], consoleErrors: [], slowOps: [] };
let page, shotN = 0;
const shot = async (tag) => { const f = `${OUT}/shots/${id}-${String(++shotN).padStart(2, "0")}-${tag}.png`; try { await page.screenshot({ path: f }); } catch {} return f; };
const bug = async (sev, what, detail) => report.bugs.push({ severity: sev, what, detail: String(detail).split("\n")[0].slice(0, 300), shot: await shot("bug") });
const friction = (what, detail = "") => report.frictions.push({ what, detail: String(detail).slice(0, 200) });

const sb = createClient(SB, ANON, { auth: { persistSession: false } });
const { data: auth, error: aErr } = await sb.auth.signInWithPassword({ email: persona.email, password: "Persona-sim-2026" });
if (aErr) { console.error("login failed", aErr.message); process.exit(2); }
const uid = auth.session.user.id;
{ const { data: rows } = await sb.from("portfolio").select("holding_id"); for (const r of rows ?? []) await sb.from("holdings").delete().eq("id", r.holding_id); }
await sb.from("profiles").update({ onboarded_at: null }).eq("id", uid);

const timed = async (label, fn, budgetMs = 6000) => {
  const t0 = Date.now(); await fn(); const ms = Date.now() - t0;
  if (ms > budgetMs) report.slowOps.push({ label, ms });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 200)); });
page.setDefaultTimeout(12000);



const ensureSymbolApi = async (sym) => {   // catalog membership so API-seeded holds work
  const { data } = await sb.from("symbols").select("symbol").eq("symbol", sym).maybeSingle();
  if (!data) {
    const r = await fetch(`${SB}/functions/v1/symbol-search`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ q: sym }) });
    const found = (await r.json()).results?.find((x) => x.symbol === sym || x.yahoo === sym);
    if (!found) return false;
    await fetch(`${SB}/functions/v1/symbol-search`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ ensure: found }) });
  }
  return true;
};

// ---------- onboarding through the real UI ----------
try {
  await page.goto(URL_);
  await page.evaluate((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), auth.session);
  await page.goto(URL_);
  await page.getByText(/set up assetly/i).waitFor();
  for (const m of persona.markets) if (m !== "US") await page.getByRole("button", { name: m === "KR" ? /Korea/ : new RegExp(m, "i") }).tap();
  await page.getByRole("button", { name: /^next$/i }).tap();
  const [sym, qty, cost] = persona.portfolio[0];
  await page.locator("#ob-q").fill(sym.replace(".KS", ""));
  await timed("onboarding search+pick", async () => {
    await page.getByRole("button", { name: new RegExp(sym.replace(".", "\\."), "i") }).first().tap({ timeout: 25000 });
    await page.getByLabel(/^shares$/i).waitFor({ timeout: 25000 });
  }, 9000);
  await page.getByLabel(/^shares$/i).fill(String(qty));
  await page.getByLabel(/cost per share/i).fill(String(cost));
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.getByTestId("net-worth").waitFor({ timeout: 20000 });
  await shot("onboarded");
} catch (e) {
  await bug("high", "onboarding failed", e.message);
  // fall back to the data layer so the remaining 30 days still gather UI intel
  try {
    const [sym, qty, cost] = persona.portfolio[0];
    await ensureSymbolApi(sym);
    const { data: h } = await sb.from("holdings").upsert({ user_id: uid, symbol: sym }, { onConflict: "user_id,symbol" }).select("id").single();
    if (h) await sb.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
    await sb.from("profiles").update({ markets: persona.markets, base_currency: persona.base, onboarded_at: new Date().toISOString() }).eq("id", uid);
    await page.goto(URL_);
  } catch {}
}

// seed the rest of the book via the same data layer the screens use
for (const [sym, qty, cost] of persona.portfolio.slice(1)) {
  try {
    if (!(await ensureSymbolApi(sym))) { friction("portfolio symbol unresolvable", sym); continue; }
    const { data: h, error } = await sb.from("holdings").upsert({ user_id: uid, symbol: sym }, { onConflict: "user_id,symbol" }).select("id").single();
    if (error) throw new Error(sym + ": " + error.message);
    await sb.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
  } catch (e) { await bug("med", "seeding holding failed", e.message); }
}

const rand = (() => { let s = 42 + id.charCodeAt(2); return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const held = async () => (await sb.from("portfolio").select("symbol,holding_id")).data ?? [];

const openPosition = async (sym) => {
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  await page.getByRole("button", { name: new RegExp(sym.replace(".", "\\."), "i") }).first().tap();
  await page.getByRole("heading", { name: /^lots$/i }).waitFor();
};
const backHome = async () => { await page.getByRole("button", { name: /^home$/i }).tap(); await page.getByTestId("net-worth").waitFor(); };

const addViaUi = async (query) => {
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.getByLabel(/ticker or name/i).fill(query);
  await page.waitForTimeout(1800);
  const rows = await page.locator(".card button.row").count();
  if (rows === 0) { friction("universal search: no results", query); await page.getByRole("button", { name: /cancel/i }).tap(); return false; }
  await page.locator(".card button.row").first().tap();
  try { await page.getByLabel(/^shares$/i).waitFor({ timeout: 25000 }); } catch (e) { await bug("med", "ticker could not be added (ensure failed)", query); return false; }
  await page.getByLabel(/^shares$/i).fill(String(1 + Math.floor(rand() * 20)));
  await page.getByLabel(/cost per share/i).fill(String((5 + rand() * 300).toFixed(2)));
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.waitForTimeout(1200);
  return true;
};

// ---------- 30 compressed days ----------
for (let day = 1; day <= 30; day++) {
  try {
    if (day % 6 === 0) {  // pipelines tick (cron stand-in)
      await fetch(`${SB}/functions/v1/price-sync`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE}` } });
      if (day % 12 === 0) await fetch(`${SB}/functions/v1/news-sync`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE}` } });
    }
    await page.goto(URL_);
    await timed("home load", () => page.getByTestId("net-worth").waitFor(), 5000);
    const nw = await page.getByTestId("net-worth").textContent();
    if (!/[$₩][\d,]+/.test(nw ?? "")) await bug("high", "net worth not a money value", nw);

    const book = await held();
    if (book.length) {
      const sym = pick(book).symbol;
      await openPosition(sym);
      const skel = page.getByTestId("price-chart");
      for (const r of persona.chartRanges) {
        await page.getByRole("tab", { name: r }).tap();
        await page.waitForTimeout(900);
        const hasChart = await skel.count();
        const hasEmpty = await page.getByText(/not enough history/i).count();
        if (!hasChart && !hasEmpty) await bug("med", `chart ${r} rendered neither line nor empty state`, sym);
        if (hasEmpty && ["1M", "3M", "1Y", "5Y"].includes(r)) friction(`no ${r} history for ${sym}`, "backfill gap?");
      }
      if (day === 2) await shot("chart-" + sym.replace(/\W/g, ""));
    }

    if (day % Math.max(1, Math.floor(7 / persona.newsFreq)) === 0) {
      await page.getByRole("button", { name: /^news$/i }).tap();
      await page.waitForTimeout(2500);
      const stories = await page.locator("a.row").count();
      const pulling = await page.getByText(/pulling the latest/i).count();
      if (!stories && !pulling) {
        const emptyOk = await page.getByText(/nothing fresh|add a position/i).count();
        if (!emptyOk) await bug("med", "news screen: no stories, no state message", "");
        else friction("news empty for whole book", "");
      }
      if (book.length && day % 10 === 0) {
        await page.getByRole("button", { name: new RegExp("^" + book[0].symbol.replace(".", "\\.") + "$") }).tap();
        await page.waitForTimeout(2500);
      }
    }

    const churnScore = { none: 0, low: 0.1, medium: 0.25, high: 0.45, extreme: 0.8 }[persona.churn];
    if (rand() < churnScore && persona.watch.length) await addViaUi(pick(persona.watch));
    if (rand() < churnScore && book.length > 1) {         // remove one
      const victim = pick(book).symbol;
      try {
        await openPosition(victim);
        await page.getByRole("button", { name: /remove position/i }).tap();
        await page.getByRole("dialog").getByRole("button", { name: /remove position/i }).tap();
        await page.waitForTimeout(1500);
      } catch (e) { await bug("med", "remove flow failed", victim + ": " + e.message); }
    }
    if ((persona.lotHeavy || rand() < churnScore) && book.length) {  // add a lot
      try {
        await openPosition(pick(book).symbol);
        await page.getByRole("button", { name: /\+ lot/i }).tap();
        await page.getByLabel(/^shares$/i).fill(String(1 + Math.floor(rand() * 10)));
        await page.getByLabel(/cost per share/i).fill(String((10 + rand() * 200).toFixed(2)));
        await page.getByRole("button", { name: /^add lot$/i }).tap();
        await page.waitForTimeout(800);
      } catch (e) { await bug("med", "add lot failed", e.message); }
    }

    if (persona.clumsy && day % 7 === 3) {
      try {
        await openPosition((await held())[0].symbol);
        await page.getByRole("button", { name: /\+ lot/i }).tap();
        await page.getByLabel(/^shares$/i).fill("-5");
        await page.getByRole("button", { name: /^add lot$/i }).tap();
        const alerted = await page.getByRole("alert").count();
        if (!alerted) await bug("high", "negative shares accepted silently", "");
        await page.getByRole("button", { name: /cancel/i }).tap();
      } catch (e) { friction("clumsy path hiccup", e.message); }
    }
    if (persona.auditsStates && day % 10 === 5) {
      await page.getByRole("button", { name: /^settings$/i }).tap();
      const cadence = await page.getByText(/signed in as/i).count();
      if (!cadence) await bug("med", "settings missing account line", "");
      await backHome();
    }
    report.daysDone = day; report.actions += 4;
  } catch (e) {
    await bug("med", `day ${day} loop broke`, e.message);
    report._consecFails = (report._consecFails ?? 0) + 1;
    if (report._consecFails >= 3) { report.notes.push("aborted: 3 consecutive day failures"); break; }
    try { await page.goto(URL_); } catch {}
    continue;
  }
  report._consecFails = 0;
}

report.consoleErrors = [...new Set(report.consoleErrors)].slice(0, 12);
await browser.close();
fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ persona: id, days: report.daysDone, bugs: report.bugs.length, frictions: report.frictions.length, consoleErrors: report.consoleErrors.length, slow: report.slowOps.length }));
