// App Store screenshots: iPhone 6.7"/6.9" class at 440x956 CSS px @3x = 1320x2868 (accepted for the 6.9" display set).
// Signs in as the App Review demo account (or SHOTS_EMAIL/SHOTS_PW), walks Home, the open brief, a position,
// News, Ask and Settings, and writes PNGs to e2e/store/. Run against the deployed build by default.
//   node e2e/store-shots.mjs            # SHOTS_URL=... to point elsewhere, DARK=1 for the dark set
import { webkit, chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const URL_ = process.env.SHOTS_URL ?? "https://hodlerss.github.io/assetly/";
const OUT = new URL("./store/", import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const cred = Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-reviewer.txt`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const email = process.env.SHOTS_EMAIL ?? cred.email, password = process.env.SHOTS_PW ?? cred.password;
const sb = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email, password });
if (error) { console.error("sign-in failed:", error.message); process.exit(1); }
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const browser = process.env.PW_ENGINE === "chromium" ? await chromium.launch() : await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, locale: "en-US", colorScheme: process.env.DARK ? "dark" : "light" });
const page = await ctx.newPage();
await page.goto(URL_);
await page.evaluate((s) => localStorage.setItem("sb-hhdpthrfmsdmxdrfckxq-auth-token", JSON.stringify(s)), auth.session);
await page.goto(URL_);
await page.getByTestId("net-worth").waitFor({ timeout: 45000 });
await page.waitForTimeout(3500);
const sfx = process.env.DARK ? "-dark" : "";
let n = 0;
const shot = async (name) => { await page.waitForTimeout(700); const p = `${OUT}${String(++n).padStart(2, "0")}-${name}${sfx}.png`; await page.screenshot({ path: p }); console.log("wrote", p); };
await shot("home");
const card = page.getByTestId("brief-card");
if (await card.count()) {
  const read = card.getByRole("button", { name: /read · \d+ min/i });
  if (await read.count()) { await read.click(); await page.waitForTimeout(800); await shot("brief"); }
  const listen = card.getByTestId("brief-listen");
  if (await listen.count()) { await listen.click(); await page.waitForTimeout(1200); await shot("player"); await page.getByRole("button", { name: /stop and close the player/i }).click().catch(() => {}); }
  await card.getByRole("button", { name: /close the brief/i }).click().catch(() => {});
}
const row = page.locator("main .row").first();
if (await row.count()) { await row.click(); await page.waitForTimeout(2500); await shot("position"); const back = page.getByRole("button", { name: /holdings/i }).first(); if (await back.count()) await back.click(); await page.waitForTimeout(800); }
for (const t of ["News", "Ask", "Settings"]) { await page.getByRole("button", { name: new RegExp("^" + t + "$") }).click(); await page.waitForTimeout(2000); await shot(t.toLowerCase()); }
await browser.close();
console.log(`done: ${n} screenshots in ${OUT}`);
