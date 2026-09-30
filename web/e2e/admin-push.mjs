// The internal push tool against PRODUCTION (admin-push + the web page). Never uses the owner's account:
// the reviewer demo account is the non-admin, and the showcase demo account is allowlisted as a TEST admin for the
// length of the run (Vault admin_emails), then removed.
//   node e2e/admin-push.mjs                     # API contract + web page (APP_URL, default the local dev server)
//   SEND=1 node e2e/admin-push.mjs              # also a REAL "test to me" + a single send to the reviewer's devices
//                                                 (needs the APNs key; the showcase account has no devices, so the
//                                                 real single send targets the reviewer, the simulator device)
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8").split("\n").filter((l) => /^VITE_/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? "http://127.0.0.1:5173/";
const SHOTS = process.env.SHOTS ?? "/tmp/assetly-admin-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const creds = (f) => Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/${f}`, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const reviewer = creds("assetly-reviewer.txt"), admin = creds("assetly-showcase.txt");
const ADMIN_LIST = `minjae.m.lee@gmail.com,${admin.email}`;
const root = new URL("../..", import.meta.url).pathname;
const sql = (q) => execFileSync("npx", ["--no-install", "supabase", "db", "query", "--linked", "--project-ref", "hhdpthrfmsdmxdrfckxq", q], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();

const fails = [];
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) fails.push(what); };
const session = async (c) => {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: c.email, password: c.password });
  if (error) throw new Error(`sign-in failed for a test account: ${error.message}`);
  return { token: data.session.access_token, id: data.user.id };
};
const call = async (token, body) => {
  const r = await fetch(`${URL_}/functions/v1/admin-push`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const draft = { title: "Assetly test", body: "An internal test of brief notifications. Nothing to do here.", link: "/brief/latest" };
let allowlisted = false;
try {
  const rv = await session(reviewer), ad = await session(admin);

  // ---- API contract ----
  check((await call("not.a.jwt", { action: "whoami" })).status === 401, "a malformed token is 401");
  const forged = rv.token.split(".").slice(0, 2).join(".") + ".AAAA";
  check((await call(forged, { action: "whoami" })).status === 401, "a token with a forged signature is 401");
  const nonAdmin = await call(rv.token, { action: "recipients" });
  check(nonAdmin.status === 403 && !nonAdmin.body.recipients, "a signed-in non-admin is 403 and sees no recipients");
  check((await call(ad.token, { action: "whoami" })).status === 403, "the test admin is refused before it is allowlisted");

  sql(`select vault.create_secret('${ADMIN_LIST}', 'admin_emails')`);
  allowlisted = true;
  const who = await call(ad.token, { action: "whoami" });
  check(who.status === 200 && who.body.admin === true, "allowlisted: whoami says admin");
  const rec = await call(ad.token, { action: "recipients" });
  const rvRow = (rec.body.recipients ?? []).find((r) => r.user_id === rv.id);
  check(rec.status === 200 && !!rvRow, `recipients lists the reviewer's device (${rec.body.count} opted in)`);
  const bad = await call(ad.token, { action: "send", user_id: rv.id, title: "x".repeat(61), body: "", link: "https://evil.example" });
  check(bad.status === 400 && bad.body.errors?.title && bad.body.errors?.body && bad.body.errors?.link, "validation: long title, empty body, outside link are all refused");
  const pv = await call(ad.token, { action: "preview", ...draft });
  check(pv.status === 200 && pv.body.payload?.aps?.alert?.title === draft.title && pv.body.payload?.link === "/brief/latest", "preview returns the APNs payload");
  const dry = await call(ad.token, { action: "send", user_id: rv.id, dry_run: true, ...draft });
  check(dry.status === 200 && dry.body.dry_run === true && dry.body.devices >= 1, `dry run to the reviewer: ${dry.body.devices} device(s), nothing sent`);
  const wrong = await call(ad.token, { action: "broadcast", confirm_count: 99999, dry_run: true, ...draft });
  check(wrong.status === 409 && typeof wrong.body.expected === "number", "broadcast with the wrong count is 409");
  const bdry = await call(ad.token, { action: "broadcast", confirm_count: wrong.body.expected, dry_run: true, ...draft });
  check(bdry.status === 200 && bdry.body.dry_run === true, `broadcast dry run with the right count (${wrong.body.expected})`);
  const hist = await call(ad.token, { action: "history" });
  check(hist.status === 200 && Array.isArray(hist.body.history), "history reads push_log");
  const audit = sql(`select count(*) n from admin_audit where created_at > now() - interval '5 minutes' and action in ('send:dry','broadcast:dry','recipients')`);
  check(/"n": [1-9]/.test(audit), "every call is in admin_audit");

  if (process.env.SEND === "1") {
    const one = await call(ad.token, { action: "send", user_id: rv.id, ...draft, title: "Assetly admin test" });
    check(one.status === 200 && one.body.sent >= 1 && !!one.body.apns_id, `REAL single send delivered (apns-id ${one.body.apns_id ?? "none"})`);
  }

  // ---- the web page ----
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-US" });
  const page = await ctx.newPage();
  const signIn = async (c) => {
    await page.goto(APP);
    await page.getByTestId("toggle-password").click({ timeout: 30000 });
    await page.getByLabel(/^email$/i).fill(c.email);
    await page.getByLabel(/^password$/i).fill(c.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: /^Settings$/ }).waitFor({ timeout: 45000 });
  };
  const signOut = async () => { await page.getByRole("button", { name: /^Settings$/ }).click(); await page.getByRole("button", { name: /^Sign out$/ }).click(); await page.getByTestId("toggle-password").waitFor({ timeout: 20000 }); };

  await signIn(reviewer);
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.waitForTimeout(2500);
  check((await page.getByTestId("admin-card").count()) === 0, "web, non-admin: no Internal tools row in Settings");
  await page.evaluate(() => { window.location.hash = "#admin"; });
  await page.getByTestId("admin-denied").waitFor({ timeout: 15000 });
  check((await page.getByTestId("admin-title").count()) === 0, "web, non-admin at #admin: refused, no form");
  await page.screenshot({ path: `${SHOTS}/web-nonadmin-denied.png` });
  await page.evaluate(() => { window.history.replaceState(null, "", window.location.pathname); });
  await page.getByRole("button", { name: /^Back$/ }).click();
  await signOut();

  await signIn(admin);
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.getByTestId("admin-card").waitFor({ timeout: 15000 });
  check(true, "web, admin: Internal tools row shows");
  await page.getByTestId("open-admin-push").click();
  await page.getByTestId("admin-title").waitFor({ timeout: 15000 });
  await page.getByTestId("admin-recipient").selectOption(rv.id);
  await page.getByTestId("admin-title").fill(draft.title);
  await page.getByTestId("admin-body").fill(draft.body);
  check((await page.getByTestId("admin-title-count").textContent()) === `${draft.title.length}/60`, "live title count");
  check((await page.getByTestId("admin-send-one").isDisabled()), "sending to someone else is locked until a test of these words");
  await page.getByTestId("admin-dry-run").click();
  const res = page.getByTestId("admin-result");
  await res.waitFor({ timeout: 20000 });
  const txt = (await res.textContent()) ?? "";
  check(/Dry run: valid, would reach \d+ device/.test(txt), `web dry run: "${txt.trim()}"`);
  await page.getByTestId("admin-history").waitFor();
  await page.screenshot({ path: `${SHOTS}/web-admin-dry-run.png`, fullPage: true });
  await signOut();
  await browser.close();
} catch (e) {
  check(false, `run aborted: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (allowlisted) { sql(`delete from vault.secrets where name = 'admin_emails'`); console.log("test admin removed from the allowlist"); }
}
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
