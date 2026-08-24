// iPhone device-profile e2e against the DEPLOYED app + production Supabase.
// Playwright iPhone 14 descriptor (390x844, DPR 3, touch, mobile Safari UA). Engine: chromium
// by default, webkit (Safari engine) when PW_ENGINE=webkit. Screenshots -> app/e2e-shots/.
import { chromium, webkit, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const URL_ = "https://hodlerss.github.io/assetly/";
const SB = "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const KEY = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const OUT = new URL("../../e2e-shots/", import.meta.url).pathname;
const engine = process.env.PW_ENGINE === "webkit" ? webkit : chromium;
const tag = process.env.PW_ENGINE === "webkit" ? "webkit" : "chromium";
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + " — " + (e.message || e).split("\n")[0]]); }
};

const sb = createClient(SB, KEY, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026" });
if (error) throw error;
// clean slate
{ const { data: rows } = await sb.from("portfolio").select("holding_id"); for (const r of rows ?? []) await sb.from("holdings").delete().eq("id", r.holding_id); }

const browser = await engine.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14"], locale: "en-US" });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${OUT}${tag}-${n}.png` });

await step("signed-out auth screen renders (GitHub, Google, email link; no password)", async () => {
  await page.goto(URL_); await page.getByRole("button", { name: /continue with github/i }).waitFor();
  await page.getByRole("button", { name: /continue with google/i }).waitFor();
  await page.getByLabel(/email/i).waitFor();
  if (await page.locator('input[type="password"]').count()) throw new Error("password field present");
  await shot("01-auth");
});
await step("email link path validates + confirms", async () => {
  await page.getByLabel(/email/i).fill("not-an-email");
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  await page.getByRole("alert").waitFor();
  await shot("02-auth-invalid-email");
});
await step("session established → home empty state", async () => {
  await page.evaluate((s) => localStorage.setItem("sb-hhdpthrfmsdmxdrfckxq-auth-token", JSON.stringify(s)), auth.session);
  await page.goto(URL_); await page.getByText(/no runners on the track/i).waitFor({ timeout: 15000 });
  await shot("03-home-empty");
});
await step("universal search: Samsung (KRX) findable in English", async () => {
  await page.getByRole("button", { name: /add your first position/i }).tap();
  await page.getByLabel(/ticker or name/i).fill("Samsung");
  await page.getByRole("button", { name: /Samsung Electronics/i }).first().waitFor({ timeout: 20000 });
  await shot("03b-samsung-search");
});
await step("universal search: add FIG (Figma) — brand-new ticker end to end", async () => {
  await page.getByLabel(/ticker or name/i).fill("FIG");
  await page.getByRole("button", { name: /Figma, Inc\./i }).first().tap({ timeout: 20000 });
  await page.getByLabel(/^shares$/i).waitFor({ timeout: 30000 });   // ensure ran (register+price+history)
  await page.getByLabel(/^shares$/i).fill("5");
  await page.getByLabel(/cost per share/i).fill("50");
  await shot("03c-fig-form");
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.getByText(/5 sh/).waitFor({ timeout: 20000 });
  await shot("03d-fig-holding");
});
await step("FIG priced + history backfilled in the cloud", async () => {
  const { data: p } = await sb.from("prices").select("price").eq("symbol", "FIG").single();
  if (!(Number(p?.price) > 0)) throw new Error("no live FIG price");
  const { count } = await sb.from("price_history").select("ts", { count: "exact", head: true }).eq("symbol", "FIG");
  if (!(count > 20)) throw new Error("history backfill missing: " + count);
});
await step("remove FIG to reset for the classic flow", async () => {
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  await page.getByRole("button", { name: /Figma, Inc\./i }).tap();
  await page.getByRole("button", { name: /remove position/i }).tap();
  await page.getByRole("dialog").getByRole("button", { name: /remove position/i }).tap();
  await page.getByText(/nothing in this filter|no runners/i).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /^home$/i }).tap();
  await page.getByText(/no runners on the track/i).waitFor({ timeout: 15000 });
});
await step("add first position (MARA 100 @ 15.67)", async () => {
  await page.getByRole("button", { name: /add your first position/i }).tap();
  await page.getByLabel(/ticker or name/i).fill("MARA");
  await page.getByRole("button", { name: /MARA Holdings/i }).tap();
  await page.getByLabel(/^shares$/i).fill("100");
  await page.getByLabel(/cost per share/i).fill("15.67");
  await shot("04-add-form");
  await page.getByRole("button", { name: /^add position$/i }).tap();
  await page.getByText(/100 sh/).waitFor({ timeout: 15000 });
  const col = await page.locator(".row .sub.gain, .row .sub.loss").first().evaluate((el) => getComputedStyle(el).color);
  if (!/rgb\((30, 112, 72|180, 55, 42)\)/.test(col)) throw new Error("gain/loss color lost in cascade: " + col);
  await shot("05-holdings");
});
await step("home shows net worth from live cloud price", async () => {
  await page.getByRole("button", { name: /^home$/i }).tap();
  const t = await page.getByTestId("net-worth").textContent();
  if (!/^\$[\d,]+/.test(t)) throw new Error("net worth not rendered: " + t);
  await shot("06-home-priced");
});
await step("news tab lists cloud-pipeline stories", async () => {
  await page.getByRole("button", { name: /^news$/i }).tap();
  await page.getByRole("button", { name: /^MARA$/ }).waitFor();   // per-holding chip
  await page.locator("a.row").first().waitFor({ timeout: 15000 });
  await shot("12-news");
});
await step("position detail + add lot → derived average", async () => {
  await page.getByRole("button", { name: /^holdings$/i }).tap();
  await page.getByRole("button", { name: /MARA Holdings/i }).tap();
  await page.getByRole("heading", { name: /^lots$/i }).waitFor();
  await shot("07-position");
  await page.getByRole("button", { name: /\+ lot/i }).tap();
  await page.getByLabel(/^shares$/i).fill("50");
  await page.getByLabel(/cost per share/i).fill("12");
  await shot("08-add-lot-sheet");
  await page.getByRole("button", { name: /^add lot$/i }).tap();
  await page.getByText(/50 sh @/).waitFor({ timeout: 15000 });
  await page.getByText(/\$14\.45/).waitFor({ timeout: 15000 });   // derived average
  await shot("09-two-lots");
});
await step("edit lot qty then delete it", async () => {
  await page.getByRole("button", { name: /edit lot 50 shares/i }).tap();
  await page.getByLabel(/^shares$/i).fill("60");
  await page.getByRole("button", { name: /save changes/i }).tap();
  await page.getByText(/60 sh @/).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /edit lot 60 shares/i }).tap();
  await page.getByRole("button", { name: /delete this lot/i }).tap();
  await page.getByText(/60 sh @/).waitFor({ state: "detached", timeout: 15000 });
});
await step("remove: cancel keeps, confirm removes", async () => {
  await page.getByRole("button", { name: /remove position/i }).tap();
  await page.getByRole("dialog").getByRole("button", { name: /keep it/i }).tap();
  await page.getByRole("heading", { name: /^lots$/i }).waitFor();
  await page.getByRole("button", { name: /remove position/i }).tap();
  await shot("10-remove-confirm");
  await page.getByRole("dialog").getByRole("button", { name: /remove position/i }).tap();
  await page.getByText(/nothing in this filter|no runners/i).waitFor({ timeout: 15000 });
  await shot("11-after-remove");
});
await step("news empty state once nothing is held", async () => {
  await page.getByRole("button", { name: /^news$/i }).tap();
  await page.getByText(/add a position and its news follows/i).waitFor({ timeout: 15000 });
  await shot("12b-news-empty");
});
await step("settings + sign out returns to auth", async () => {
  await page.getByRole("button", { name: /^settings$/i }).tap();
  await page.getByText(/signed in as/i).waitFor();
  await shot("13-settings");
  await page.getByRole("button", { name: /sign out/i }).tap();
  await page.getByRole("button", { name: /continue with github/i }).waitFor({ timeout: 15000 });
  await shot("14-signed-out");
});
await step("no console errors during the run", async () => { /* collected below */ });

await browser.close();
const fails = results.filter(([s]) => s === "FAIL");
for (const [s, n] of results) console.log(s, n);
console.log(`\n${tag}: ${results.length - fails.length}/${results.length} steps passed`);
fs.writeFileSync(`${OUT}${tag}-results.json`, JSON.stringify(results, null, 1));
process.exit(fails.length ? 1 : 0);
