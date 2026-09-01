// Small-phone layout audit. The iPhone SE is the tightest screen anyone runs this on (375x667,
// and no home-indicator inset, so every `env(safe-area-inset-bottom)` resolves to 0) — which is
// exactly where a hardcoded bottom offset shows up as content clipped behind the tab bar.
// Walks every tab and reports horizontal overflow plus anything fixed that collides with the tabs.
//   npx vite preview --port 4177   # then:
//   node e2e/se-check.mjs          # SE_URL=... to point at the deployed build instead
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
const URL_ = process.env.SE_URL ?? "http://localhost:4177/";
const SB = "https://hhdpthrfmsdmxdrfckxq.supabase.co";
const KEY = "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE";
const OUT = new URL("../../e2e-shots/", import.meta.url).pathname;
const sb = createClient(SB, KEY, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026" });
if (error) throw error;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
const page = await ctx.newPage();
await page.goto(URL_);
await page.evaluate((s) => localStorage.setItem("sb-hhdpthrfmsdmxdrfckxq-auth-token", JSON.stringify(s)), auth.session);
await page.goto(URL_);
await page.waitForTimeout(6000);
await page.screenshot({ path: OUT + "se-home.png" });
await page.getByRole("button", { name: /^Ask$/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "se-ask.png" });

// sweep every tab for horizontal overflow and tab-bar collisions
const audit = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "se-" + name + ".png" });
  const o = await page.evaluate(() => {
    const tb = document.querySelector(".tabbar").getBoundingClientRect();
    const bad = [];
    for (const e of document.querySelectorAll("main *, .tabbar *")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const tag = e.tagName.toLowerCase() + "." + (e.className && typeof e.className === "string" ? e.className.split(" ")[0] : "");
      if (r.right > innerWidth + 0.5 || r.left < -0.5) bad.push(["x-overflow", tag, Math.round(r.left), Math.round(r.right), (e.textContent||"").trim().slice(0,30)]);
      else if (getComputedStyle(e).position === "fixed" && r.bottom > tb.top + 0.5 && r.top < tb.top) bad.push(["over-tabbar", tag, Math.round(r.bottom)]);
    }
    return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, bad: bad.slice(0, 8) };
  });
  console.log(name, JSON.stringify(o));
};
await audit("ask");
for (const t of ["News", "Settings", "Home"]) { await page.getByRole("button", { name: new RegExp("^" + t + "$") }).click(); await audit(t.toLowerCase()); }

// geometry: does anything overlap the tab bar?
await page.getByRole("button", { name: /^Ask$/ }).click();
await page.waitForTimeout(800);
const g = await page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().toJSON() : null; };
  const chips = [...document.querySelectorAll(".chips .chip")].map((c) => ({ t: c.textContent.slice(0, 28), right: Math.round(c.getBoundingClientRect().right), w: Math.round(c.getBoundingClientRect().width) }));
  return { vw: innerWidth, vh: innerHeight, tabbar: r(".tabbar"), composer: r(".ask-composer"), send: r(".ask-composer .btn"), chips,
           docScrollW: document.documentElement.scrollWidth };
});
console.log(JSON.stringify(g, null, 1));
await browser.close();
