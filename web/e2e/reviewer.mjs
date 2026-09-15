// App Review path on the live PWA: visible email form -> "Use a password instead" -> sign in -> Home shows the
// seeded book -> Settings shows Delete account + legal links + the not-advice line.
// Creds from ~/.private_keys/assetly-reviewer.txt.
//   node e2e/reviewer.mjs           # REVIEWER_URL=... to point elsewhere; PW_ENGINE=webkit for Safari's engine
import { chromium, webkit } from "playwright";
import fs from "node:fs";
const URL_ = process.env.REVIEWER_URL ?? "https://hodlerss.github.io/assetly/";
const cred = Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-reviewer.txt`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const browser = process.env.PW_ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" });
const page = await ctx.newPage();
const fails = [];
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails.push(what); };
await page.goto(URL_);
await page.getByRole("button", { name: /continue with github/i }).waitFor({ timeout: 30000 });
check((await page.getByTestId("email-form").count()) === 1, "the email form is visible with no gesture");
check((await page.locator('input[type="password"]').count()) === 0, "link sign-in is the default, no password shown");
const mark = page.getByTestId("auth-wordmark");
for (let i = 0; i < 5; i++) await mark.tap();
check((await page.locator('input[type="password"]').count()) === 0, "the wordmark is inert (no hidden gesture left)");
await page.getByTestId("toggle-password").tap();
await page.getByTestId("password-field").waitFor({ timeout: 5000 });
check(true, "Use a password instead reveals the password field");
await page.getByLabel(/^email$/i).fill(cred.email);
await page.getByLabel(/^password$/i).fill(cred.password);
await page.getByRole("button", { name: /^sign in$/i }).tap();
await page.getByTestId("net-worth").waitFor({ timeout: 45000 });
await page.waitForTimeout(2500);
const nw = (await page.getByTestId("net-worth").textContent()) ?? "";
check(/\$[\d,]+/.test(nw), `Home shows a net worth (${nw.trim()})`);
check((await page.locator("main .row").count()) >= 5, "Home lists the seeded holdings");
check((await page.getByTestId("brief-card").count()) === 1, "a brief card is on Home");
await page.getByRole("button", { name: /^Settings$/ }).tap();
await page.waitForTimeout(1500);
check((await page.getByTestId("delete-account").count()) === 1, "Settings has Delete account");
const legal = (await page.getByTestId("legal-card").textContent()) ?? "";
check(/privacy policy/i.test(legal), "Settings has the legal card");
check(/not investment advice/i.test(legal), "Settings states it is not investment advice");
await page.getByTestId("delete-account").tap();
const dlg = page.getByRole("dialog", { name: /delete account/i });
await dlg.waitFor({ timeout: 5000 });
check(/cannot be undone/i.test((await dlg.textContent()) ?? ""), "delete sheet warns and asks to confirm");
await dlg.getByRole("button", { name: /keep my account/i }).tap();
await browser.close();
console.log(fails.length ? `REVIEWER E2E: ${fails.length} FAIL` : "REVIEWER E2E: PASS");
process.exit(fails.length ? 1 : 0);
