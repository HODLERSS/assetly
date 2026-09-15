// Sign-in screen layout, in its densest state (password field revealed), on the smallest phone we
// support and the largest, light and dark. Same thresholds as e2e/iphone-audit.mjs: no x-overflow,
// every control >= 44pt, no text under 11px, no input under 16px (iOS zooms below that), and the
// wordmark still on screen without scrolling.
//   node e2e/auth-layout.mjs            # AUTH_URL=... to point elsewhere
import { chromium } from "playwright";
const URL_ = process.env.AUTH_URL ?? "https://hodlerss.github.io/assetly/";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const fails = [];
for (const [name, w, h] of [["se", 375, 667], ["15pm", 430, 932]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
    const p = await ctx.newPage();
    await p.goto(URL_);
    await p.getByTestId("email-form").waitFor({ timeout: 30000 });
    await p.getByTestId("toggle-password").tap();
    await p.getByTestId("password-field").waitFor();
    const r = await p.evaluate(() => {
      const bad = [];
      const docW = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > docW + 1) bad.push(`x-overflow ${document.documentElement.scrollWidth}>${docW}`);
      for (const el of document.querySelectorAll("button, input, a")) {
        const q = el.getBoundingClientRect();
        if (q.width === 0 && q.height === 0) continue;
        const label = (el.textContent || el.id || el.tagName).trim().slice(0, 28);
        if (q.height < 44) bad.push(`small target '${label}' h=${q.height.toFixed(1)}`);
        if (q.right > docW + 1 || q.left < -1) bad.push(`off-screen '${label}'`);
      }
      for (const el of document.querySelectorAll("button, label, p, h1")) {
        if (parseFloat(getComputedStyle(el).fontSize) < 11) bad.push(`tiny type '${(el.textContent || "").trim().slice(0, 24)}'`);
      }
      for (const el of document.querySelectorAll("input")) {
        if (parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(`input would zoom: ${el.id}`);
      }
      const mark = document.querySelector('[data-testid="auth-wordmark"]').getBoundingClientRect();
      if (mark.top < 0) bad.push(`wordmark scrolled off the top (${mark.top.toFixed(0)}px)`);
      return { bad, bodyH: document.body.scrollHeight, vh: window.innerHeight };
    });
    await p.screenshot({ path: `${SHOTS}/auth-${name}-${theme}.png` });
    const ok = r.bad.length === 0;
    if (!ok) fails.push(`${name}/${theme}`);
    console.log(`${ok ? "PASS " : "FAIL "}${name}/${theme} (content ${r.bodyH}px, viewport ${r.vh}px)${ok ? "" : " " + JSON.stringify(r.bad)}`);
    await ctx.close();
  }
}
await b.close();
console.log(fails.length ? `AUTH LAYOUT: ${fails.length} FAIL` : "AUTH LAYOUT: PASS");
process.exit(fails.length ? 1 : 0);
