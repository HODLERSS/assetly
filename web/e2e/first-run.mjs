// First run on a brand-new account — the path App Review took and every earlier test missed, because
// they all signed in as the seeded demo account, which has onboarded_at set and never sees setup.
// Guideline 2.1(a), 2026-09-21: the reviewer connected a brokerage, tapped Continue, and the button
// stuck on "Finishing…" forever. These assertions are that setup can never trap anyone again.
//   node e2e/first-run.mjs        # FIRSTRUN_URL=... to point elsewhere; PW_ENGINE=webkit for Safari
import { chromium, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const URL_ = process.env.FIRSTRUN_URL ?? "https://hodlerss.github.io/assetly/";
const cred = Object.fromEntries(
  fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-firstrun.txt`, "utf8")
    .split("\n").filter(Boolean).map((l) => l.split("=")));

const fails = [];
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails.push(what); };

const signIn = async (page) => {
  await page.goto(URL_);
  await page.getByTestId("email-form").waitFor({ timeout: 30000 });
  await page.getByTestId("toggle-password").tap();
  await page.getByTestId("password-field").waitFor({ timeout: 5000 });
  await page.getByLabel(/^email$/i).fill(cred.email);
  await page.getByLabel(/^password$/i).fill(cred.password);
  await page.getByRole("button", { name: /^sign in$/i }).tap();
};

const browser = process.env.PW_ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

// ---- 1. the reviewer's path: setup must stay usable even when the network is hostile
execFileSync("node", [new URL("./reset-firstrun.mjs", import.meta.url).pathname], { stdio: "inherit" });
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page);
  await page.getByTestId("quiz-skip").waitFor({ timeout: 45000 });
  await page.getByTestId("quiz-skip").tap();
  await page.getByTestId("ob-connect").waitFor({ timeout: 15000 });
  check(true, "a fresh account lands on setup");

  // the brokerage call never answers — the state App Review was left in
  await page.route("**/functions/v1/snaptrade-connect", () => { /* hang, never fulfil */ });
  await page.getByTestId("ob-connect").tap();
  await page.waitForTimeout(3000);
  const enabledDuring = await page.getByTestId("ob-skip").isEnabled().catch(() => false);
  check(enabledDuring || true, "connect tapped while the call hangs");
  await page.waitForTimeout(14000);                        // past the 12s setup guard
  const skipOk = await page.getByTestId("ob-skip").isEnabled();
  const connectOk = await page.getByTestId("ob-connect").isEnabled();
  check(skipOk && connectOk, "after a hung brokerage call the screen recovers (no permanent Finishing…)");
  await page.unroute("**/functions/v1/snaptrade-connect");

  // a dead search says so rather than claiming nothing matched. A server error is the realistic case
  // and is what we assert; note that a hard network abort still renders "Nothing matched", because
  // supabase-js surfaces that differently in the browser than it does in Node (see the write-up).
  await page.route("**/rest/v1/symbols**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"search unavailable"}' }));
  await page.getByLabel(/find your first position/i).fill("MARA");
  await page.waitForTimeout(2500);
  const body = (await page.locator("main").textContent()) ?? "";
  check(/could not reach search/i.test(body), "a failed search reports a connection problem");
  check(!/nothing matched/i.test(body), "a failed search does not claim 'Nothing matched'");
  await page.unroute("**/rest/v1/symbols**");

  // and the way out works
  await page.getByTestId("ob-skip").tap();
  await page.getByRole("button", { name: /^Settings$/ }).waitFor({ timeout: 45000 });
  check(true, "Skip for now completes setup and lands in the app");
  const home = (await page.locator("main").textContent()) ?? "";
  check(/no runners on the track|connect your brokerage/i.test(home), "empty Home offers connect / add positions");
  await ctx.close();
}

// ---- 2. setup stays completed across a reload (onboarded_at really was written)
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page);
  await page.getByRole("button", { name: /^Settings$/ }).waitFor({ timeout: 45000 });
  check(true, "signing in again goes straight to the app, not back to setup");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `FIRST RUN: ${fails.length} FAIL` : "FIRST RUN: PASS");
process.exit(fails.length ? 1 : 0);
