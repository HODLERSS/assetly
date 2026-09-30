// The internal push tool against PRODUCTION: admin-push, and the separate Assetly Admin site (app/admin). Never uses the owner's account:
// the reviewer demo account is the non-admin, and the showcase demo account is allowlisted as a TEST admin for the
// length of the run (Vault admin_emails), then removed.
//   node e2e/admin-push.mjs                     # API contract + the deployed admin site (ADMIN_URL)
//   SEND=1 node e2e/admin-push.mjs              # also a REAL "test to me" + a single send to the reviewer's devices
//                                                 (needs the APNs key; the showcase account has no devices, so the
//                                                 real single send targets the reviewer, the simulator device)
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.env.production", import.meta.url), "utf8").split("\n").filter((l) => /^VITE_/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const ADMIN_URL = process.env.ADMIN_URL ?? "https://assetly-admin.vercel.app/";
const ADMIN_ORIGIN = new URL(ADMIN_URL).origin;
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
  return { token: data.session.access_token, id: data.user.id, session: data.session };
};
const call = async (token, body, origin = null) => {
  const r = await fetch(`${URL_}/functions/v1/admin-push`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "content-type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
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
  const fromConsumer = await call(rv.token, { action: "whoami" }, "https://hodlerss.github.io");
  check(fromConsumer.status === 403 && fromConsumer.body.error === "origin not allowed", "a browser call from the consumer site's origin is refused (403 origin not allowed)");

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

  // ---- the deployed admin site (a session is injected under the admin app's own storage key: no password form ships) ----
  const html = await (await fetch(ADMIN_URL)).text();
  check(/<meta name="robots" content="noindex/.test(html), "admin site: robots noindex meta");
  const hdr = await fetch(ADMIN_URL, { method: "HEAD" });
  check(/noindex/.test(hdr.headers.get("x-robots-tag") ?? "") && hdr.headers.get("x-frame-options") === "DENY", "admin site: X-Robots-Tag noindex + X-Frame-Options DENY");
  const browser = await chromium.launch();
  const open = async (s) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-US" });
    if (s) await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ["assetly-admin-auth", JSON.stringify(s)]);
    const page = await ctx.newPage();
    await page.goto(ADMIN_URL);
    return { ctx, page };
  };
  {
    const { ctx, page } = await open(null);
    await page.getByTestId("admin-signin").waitFor({ timeout: 20000 });
    check((await page.getByTestId("signin-github").count()) === 1 && (await page.getByTestId("admin-title").count()) === 0, "admin site signed out: GitHub/Google sign-in only, no form");
    await page.screenshot({ path: `${SHOTS}/admin-site-signin.png` });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(rv.session);
    await page.getByTestId("admin-denied").waitFor({ timeout: 20000 });
    check((await page.getByTestId("admin-title").count()) === 0, "admin site, non-admin (reviewer): refused, no form");
    await page.screenshot({ path: `${SHOTS}/admin-site-nonadmin.png` });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(ad.session);
    await page.getByTestId("admin-title").waitFor({ timeout: 20000 });
    check(true, "admin site, admin: the form loads (CORS from the admin origin works)");
    await page.getByTestId("admin-recipient").selectOption(rv.id);
    await page.getByTestId("admin-title").fill(draft.title);
    await page.getByTestId("admin-body").fill(draft.body);
    check((await page.getByTestId("admin-title-count").textContent()) === `${draft.title.length}/60`, "live title count");
    check((await page.getByTestId("admin-send-one").isDisabled()), "sending to someone else is locked until a test of these words");
    await page.getByTestId("admin-dry-run").click();
    const res = page.getByTestId("admin-result");
    await res.waitFor({ timeout: 20000 });
    const txt = (await res.textContent()) ?? "";
    check(/Dry run: valid, would reach \d+ device/.test(txt), `admin site dry run: "${txt.trim()}"`);
    await page.getByTestId("admin-history").waitFor();
    await page.screenshot({ path: `${SHOTS}/admin-site-dry-run.png` });
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  check(false, `run aborted: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (allowlisted) { sql(`delete from vault.secrets where name = 'admin_emails'`); console.log("test admin removed from the allowlist"); }
}
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
