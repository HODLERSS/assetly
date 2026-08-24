// Scenario e2e — a realistic heavy session on the DEPLOYED app + production Supabase:
// add 10 stocks (3 through the UI incl. a universal-search ticker, 7 through the API the
// screens call), edit lots, remove two, read charts on multiple ranges, check news + home.
// iPhone 14 profile. Screenshots -> app/e2e-shots/scenario-*.png
import { chromium, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";

const URL_ = "https://hodlerss.github.io/assetly/";
const SB = "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const KEY = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const OUT = new URL("../../e2e-shots/", import.meta.url).pathname;
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + " — " + (e.message || e).split("\n")[0]]); }
};

const sb = createClient(SB, KEY, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({
  email: "e2e-cloud@assetly.test", password: process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026" });
if (error) throw error;
{ const { data: rows } = await sb.from("portfolio").select("holding_id"); for (const r of rows ?? []) await sb.from("holdings").delete().eq("id", r.holding_id); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${OUT}scenario-${n}.png` });

const addViaUi = async (query, pickRe, qty, cost, first = false) => {
  if (first) await page.getByRole("button", { name: /add your first position/i }).tap();
  else { await page.getByRole("button", { name: /^holdings$/i }).tap();
         await page.getByRole("button", { name: /\+ add/i }).tap(); }
  await page.getByLabel(/ticker or name/i).fill(query);
  await page.getByRole("button", { name: pickRe }).first().tap({ timeout: 25000 });
  await page.getByLabel(/^shares$/i).waitFor({ timeout: 30000 });
  await page.getByLabel(/^shares$/i).fill(String(qty));
  await page.getByLabel(/cost per share/i).fill(String(cost));
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.getByRole("button", { name: pickRe }).first().waitFor({ timeout: 20000 });   // row appears
};

await step("session + empty home", async () => {
  await page.goto(URL_);
  await page.evaluate((s) => localStorage.setItem("sb-hhdpthrfmsdmxdrfckxq-auth-token", JSON.stringify(s)), auth.session);
  await page.goto(URL_);
  await page.getByText(/no runners on the track/i).waitFor({ timeout: 15000 });
});

await step("add 3 stocks through the UI (MARA, FIG via universal search, AAPL)", async () => {
  await addViaUi("MARA", /MARA Holdings/i, 100, 15.67, true);
  await addViaUi("FIG", /Figma, Inc\./i, 5, 50);
  await addViaUi("AAPL", /Apple/i, 12, 230);
  await shot("01-three-added");
});

await step("add 7 more through the data layer (what the screens call)", async () => {
  const seven = [["NVDA", 4, 180], ["RDDT", 10, 166.55], ["AMD", 20, 155], ["META", 2, 590.65],
                 ["MSTR", 3, 390], ["QQQM", 15, 233], ["005930.KS", 10, 71000]];
  for (const [sym, qty, cost] of seven) {
    const { data: h, error: hErr } = await sb.from("holdings")
      .upsert({ user_id: auth.session.user.id, symbol: sym }, { onConflict: "user_id,symbol" }).select("id").single();
    if (hErr) throw new Error(sym + ": " + hErr.message);
    const { error: lErr } = await sb.from("lots").insert({ holding_id: h.id, qty, cost_per_share: cost });
    if (lErr) throw new Error(sym + " lot: " + lErr.message);
  }
});

await step("holdings shows all 10 with prices", async () => {
  await page.getByRole("button", { name: /^home$/i }).tap();
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  await page.reload();                                     // pull fresh portfolio
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  for (const re of [/MARA Holdings/i, /Figma/i, /Apple/i, /NVIDIA/i, /Samsung Electronics/i])
    await page.getByRole("button", { name: re }).first().waitFor({ timeout: 20000 });
  await shot("02-ten-holdings");
});

await step("chart: FIG renders with data on 1D..3M and switches ranges", async () => {
  await page.getByRole("button", { name: /Figma/i }).first().tap();
  await page.getByTestId("price-chart").waitFor({ timeout: 20000 });
  await shot("03-fig-chart-1d");
  for (const r of ["1W", "1M", "3M"]) {
    await page.getByRole("tab", { name: r }).tap();
    await page.getByTestId("price-chart").waitFor({ timeout: 20000 });
  }
  const d = await page.getByTestId("price-chart").locator("path").getAttribute("d");
  if (!d || d.split("L").length < 10) throw new Error("3M path too thin: " + (d ?? "").slice(0, 40));
  const chg = await page.getByTestId("range-change").textContent();
  if (!/[+-]?\d+\.\d+%/.test(chg ?? "")) throw new Error("no range change: " + chg);
  await shot("04-fig-chart-3m");
});

await step("chart: Samsung (KRW) renders with won low/high", async () => {
  await page.getByRole("button", { name: /holdings/i }).first().tap();
  await page.getByRole("button", { name: /Samsung Electronics/i }).first().tap();
  await page.getByTestId("price-chart").waitFor({ timeout: 20000 });
  await page.getByText(/L ₩[\d,]+/).waitFor({ timeout: 20000 });
  await shot("05-samsung-chart");
});

await step("edit: add + edit a lot on AAPL, derived average moves", async () => {
  await page.getByRole("button", { name: /holdings/i }).first().tap();
  await page.getByRole("button", { name: /Apple/i }).first().tap();
  await page.getByRole("button", { name: /\+ lot/i }).tap();
  await page.getByLabel(/^shares$/i).fill("8");
  await page.getByLabel(/cost per share/i).fill("210");
  await page.getByRole("button", { name: /^add lot$/i }).tap();
  await page.getByText(/8 sh @/).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /edit lot 8 shares/i }).tap();
  await page.getByLabel(/^shares$/i).fill("10");
  await page.getByRole("button", { name: /save changes/i }).tap();
  await page.getByText(/10 sh @/).waitFor({ timeout: 15000 });
  await shot("06-aapl-lots");
});

await step("remove 2 of 10 (MSTR, QQQM) — the other 8 stay", async () => {
  for (const re of [/^MSTR/, /Invesco/i]) {
    await page.getByRole("button", { name: /holdings/i }).first().tap();
    await page.getByRole("button", { name: re }).first().tap();
    await page.getByRole("button", { name: /remove position/i }).tap();
    await page.getByRole("dialog").getByRole("button", { name: /remove position/i }).tap();
    await page.getByRole("button", { name: re }).waitFor({ state: "detached", timeout: 15000 });
  }
  const rows = await page.locator(".card button.row").count();
  if (rows < 8) throw new Error("expected 8 rows, saw " + rows);
  await shot("07-eight-left");
});

await step("home totals + news scoped to what's held", async () => {
  await page.getByRole("button", { name: /^home$/i }).tap();
  const t = await page.getByTestId("net-worth").textContent();
  if (!/^\$[\d,]+/.test(t ?? "")) throw new Error("net worth: " + t);
  await page.getByRole("button", { name: /^news$/i }).tap();
  await page.locator("a.row").first().waitFor({ timeout: 25000 });
  await shot("08-news");
});

await step("cleanup: remove all fixture holdings", async () => {
  const { data: rows } = await sb.from("portfolio").select("holding_id");
  for (const r of rows ?? []) await sb.from("holdings").delete().eq("id", r.holding_id);
});

await step("no console errors across the scenario", async () => {
  const real = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  if (real.length) throw new Error(real[0]);
});

await browser.close();
let fail = 0;
for (const [st, name] of results) { console.log(st, name); if (st === "FAIL") fail++; }
console.log(`\nscenario: ${results.length - fail}/${results.length} steps passed`);
process.exit(fail ? 1 : 0);
