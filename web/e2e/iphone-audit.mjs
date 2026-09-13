// iPhone layout audit: ten measurable metrics across the iPhone sizes people actually run, on every screen.
//   npm run build && npx vite preview --port 4177   # then:
//   node e2e/iphone-audit.mjs                        # AUDIT_URL=... to point at the deployed build
// Signs in as the cloud fixture (its book should be seeded), walks Home, Home with the brief open, the
// mini player, a position, News, Ask and Settings, and prints one PASS/FAIL line per metric per device
// plus the offending elements. Screenshots land in e2e-shots/audit-<device>-<screen>.png.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "fs";

const URL_ = process.env.AUDIT_URL ?? "http://localhost:4177/";
const OUT = new URL("../../e2e-shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
// CSS viewport sizes with Safari's chrome already subtracted (minimal-UI / standalone PWA shows the full height)
const DEVICES = [
  ["iphone-se", 375, 667],
  ["iphone-13-mini", 375, 812],
  ["iphone-14", 390, 844],
  ["iphone-15-pro", 393, 852],
  ["iphone-15-pro-max", 430, 932],
];
const ONLY = process.env.DEVICES ? process.env.DEVICES.split(",") : null;

const sb = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: process.env.ASSETLY_FIXTURE_PW ?? "Assetly-e2e-fixture-2026" });
if (error) throw error;

// ---- the ten metrics, evaluated in the page ----
const METRICS = () => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tag = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " “" + (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28) + "”";
  const out = {};
  // M1 no horizontal overflow anywhere
  const xo = [];
  const scroller = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  for (const e of document.querySelectorAll("body *")) { if (!vis(e) || e.closest(".sr-only") || scroller(e)) continue; const r = e.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) xo.push(tag(e) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`); }
  out.M1_no_x_overflow = { pass: document.documentElement.scrollWidth <= vw && xo.length === 0, detail: xo.slice(0, 6).concat(document.documentElement.scrollWidth > vw ? [`docScrollWidth ${document.documentElement.scrollWidth} > ${vw}`] : []) };
  // M2 single-line UI labels stay on one line (chips, tab labels, card headers, buttons, pills, mini player)
  const oneLine = ".chip, .tabbar button span, .tabbar button, .insights-brand, .mp-title, .mp-sub, .edit-pill, .btn, .row .sym, .field label, .h1, .brand, .insights-toggle, .status-line, .nw-more, .mp-rate, .mp-time";
  const wrapped = [];
  for (const e of document.querySelectorAll(oneLine)) {
    if (!vis(e) || e.closest(".chips.wrap")) continue;
    const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const rects = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()]; });
    const lines = new Set(rects.map((r) => Math.round(r.top)));
    if (lines.size > 1 || (e.matches(".chip, .btn, .edit-pill, .insights-brand, .mp-title, .mp-sub, .h1") && e.getBoundingClientRect().height > lh * 1.6 + 26)) wrapped.push(tag(e) + ` lines=${lines.size}`);
  }
  out.M2_labels_one_line = { pass: wrapped.length === 0, detail: wrapped.slice(0, 8) };
  // M3 tap targets: every interactive element at least 44 tall and 44 wide (Apple HIG), inline text links excepted
  const small = [];
  for (const e of document.querySelectorAll("button, a[href], [role=button], input:not([type=range]), select, [role=tab]")) {
    if (!vis(e) || e.closest(".sr-only")) continue;
    const r = e.getBoundingClientRect();
    if (e.tagName === "A" && getComputedStyle(e).display === "inline") continue;
    if (r.height < 43.5 || r.width < 43.5) small.push(tag(e) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  out.M3_tap_targets_44 = { pass: small.length === 0, detail: small.slice(0, 10) };
  // M4 legible type: no rendered text under 11px; inputs at 16px+ (Safari zooms on focus below that)
  const tiny = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue; const e = n.parentElement; if (!e || !vis(e) || e.closest(".sr-only")) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 11) tiny.push(tag(e) + ` ${fs}px`);
  }
  for (const e of document.querySelectorAll("input, select, textarea")) { if (vis(e) && parseFloat(getComputedStyle(e).fontSize) < 16) tiny.push(tag(e) + ` input ${getComputedStyle(e).fontSize}`); }
  out.M4_legible_type = { pass: tiny.length === 0, detail: [...new Set(tiny)].slice(0, 8) };
  // M5 safe areas and docking: tab bar sits on the bottom edge; nothing fixed overlaps it; last content clears it
  const tb = document.querySelector(".tabbar"); const tbr = tb?.getBoundingClientRect();
  const dock = [];
  if (!tbr) dock.push("no tab bar");
  else {
    if (Math.abs(tbr.bottom - vh) > 1) dock.push(`tab bar bottom ${Math.round(tbr.bottom)} vs viewport ${vh}`);
    for (const e of document.querySelectorAll("body *")) { if (!vis(e) || e === tb || tb.contains(e)) continue; const cs = getComputedStyle(e); if (cs.position !== "fixed") continue; const r = e.getBoundingClientRect(); if (r.bottom > tbr.top + 0.5 && r.top < tbr.top) dock.push("fixed over tab bar: " + tag(e)); }
    const main = document.querySelector("main") || document.querySelector(".screen");
    if (main) {
      const y0 = scrollY; window.scrollTo(0, 1e6);
      const dockTop = Math.min(...[".miniplayer", ".ask-composer", ".tabbar"].map((q) => { const el = document.querySelector(q); return el && vis(el) ? el.getBoundingClientRect().top : Infinity; }));
      const inFixed = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) if (getComputedStyle(x).position === "fixed") return true; return false; };
      const last = [...main.querySelectorAll("*")].filter((e) => vis(e) && !inFixed(e)).reduce((a, e) => Math.max(a, e.getBoundingClientRect().bottom), 0);
      if (last > dockTop + 1) dock.push(`last content bottom ${Math.round(last)} under the dock at ${Math.round(dockTop)} (scrolled to the end)`);
      window.scrollTo(0, y0);
    }
  }
  out.M5_safe_dock = { pass: dock.length === 0, detail: dock.slice(0, 6) };
  // M6 numbers are tabular wherever they line up
  const nonTab = [];
  for (const e of document.querySelectorAll(".num, .net, .day, .mp-time, .mp-sub, .status-line, .row .right")) { if (!vis(e)) continue; const cs = getComputedStyle(e); if (!/tabular/.test(cs.fontVariantNumeric) && !/tnum/.test(cs.fontFeatureSettings)) nonTab.push(tag(e)); }
  out.M6_tabular_numbers = { pass: nonTab.length === 0, detail: nonTab.slice(0, 6) };
  // M7 no clipped text: anything scrolling inside a hidden box must be an intended ellipsis
  const clipped = [];
  for (const e of document.querySelectorAll("body *")) { if (!vis(e)) continue; const cs = getComputedStyle(e); if ((cs.overflowX === "hidden" || cs.overflow === "hidden") && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== "ellipsis" && !e.matches(".chips, .mp-track, input, .chart, canvas, svg")) clipped.push(tag(e) + ` ${e.scrollWidth}>${e.clientWidth}`); }
  out.M7_no_clipped_text = { pass: clipped.length === 0, detail: clipped.slice(0, 6) };
  // M8 header rows keep their shape: brand + actions on one row, holding rows keep name and value on one row
  const rows = [];
  for (const e of document.querySelectorAll(".insights-head, .topbar, .mp-line")) { if (!vis(e)) continue; const kids = [...e.children].filter(vis); const mids = kids.map((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2; }); if (Math.max(...mids) - Math.min(...mids) > 8) rows.push("header wrapped: " + tag(e)); }
  for (const e of document.querySelectorAll(".row")) { if (!vis(e)) continue; const r = e.getBoundingClientRect(); const kids = [...e.children].filter(vis); if (kids.length >= 2 && r.height > 84) rows.push("tall row: " + tag(e) + ` ${Math.round(r.height)}px`); }
  out.M8_rows_keep_shape = { pass: rows.length === 0, detail: rows.slice(0, 6) };
  // M9 contrast: text against its effective background, 4.5:1 body / 3:1 large
  const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b, a] = m.map(Number); if (a === 0) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return { l: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b), a: a ?? 1 }; };
  const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { for (const pseudo of [null, "::before"]) { const c = getComputedStyle(x, pseudo).backgroundColor; const L = lum(c); if (L && L.a > 0.9) return L.l; } } return lum(getComputedStyle(document.body).backgroundColor)?.l ?? 1; };
  const low = []; const seen = new Set();
  const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w2.nextNode(); n; n = w2.nextNode()) {
    if (!n.textContent.trim()) continue; const e = n.parentElement; if (!e || !vis(e) || e.closest(".sr-only") || getComputedStyle(e).opacity === "0") continue;
    const key = e.className + "|" + getComputedStyle(e).color; if (seen.has(key)) continue; seen.add(key);
    const fg = lum(getComputedStyle(e).color); if (!fg) continue; const bg = bgOf(e);
    const ratio = (Math.max(fg.l, bg) + 0.05) / (Math.min(fg.l, bg) + 0.05);
    const fs = parseFloat(getComputedStyle(e).fontSize); const bold = parseInt(getComputedStyle(e).fontWeight) >= 700;
    const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need && !e.disabled && !e.closest("[disabled], .skel-line")) low.push(tag(e) + ` ${ratio.toFixed(2)}:1`);
  }
  out.M9_contrast = { pass: low.length === 0, detail: low.slice(0, 8) };
  // M10 stability and metadata: no layout shift after load, viewport-fit=cover, theme-color, no double-tap zoom delay
  const meta = [];
  const vp = document.querySelector('meta[name="viewport"]')?.content ?? ""; if (!/viewport-fit=cover/.test(vp)) meta.push("viewport meta lacks viewport-fit=cover");
  if (!document.querySelector('meta[name="theme-color"]')) meta.push("no theme-color meta");
  const ta = getComputedStyle(document.body).touchAction; if (!/manipulation/.test(ta)) meta.push("touch-action manipulation not set on body");
  if (window.__cls > 0.1) meta.push(`CLS ${window.__cls.toFixed(3)} from ${window.__clsSrc.slice(-4).join(" | ")}`);
  window.__cls = 0; window.__clsSrc = [];   // per screen: the next screen starts from zero
  out.M10_stable_and_meta = { pass: meta.length === 0, detail: meta };
  return out;
};

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const summary = {};
for (const [name, w, h] of DEVICES) {
  if (ONLY && !ONLY.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, locale: "en-US", colorScheme: process.env.DARK ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__cls = 0; window.__clsSrc = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; if (e.value > 0.01) window.__clsSrc.push(e.value.toFixed(3) + ":" + (e.sources || []).map((x) => x.node && x.node.nodeType === 1 ? x.node.tagName.toLowerCase() + "." + String(x.node.className).split(" ").slice(0, 2).join(".") : "?").join(",")); } }).observe({ type: "layout-shift", buffered: true }); } catch {} });
  await page.goto(URL_);
  await page.evaluate((s) => localStorage.setItem("sb-hhdpthrfmsdmxdrfckxq-auth-token", JSON.stringify(s)), auth.session);
  await page.goto(URL_);
  await page.getByTestId("net-worth").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const results = {};
  const shot = async (screen) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}audit-${name}-${screen}${process.env.DARK ? "-dark" : ""}.png` }); const m = await page.evaluate(METRICS); results[screen] = m; };
  await shot("home");
  // the brief open, then the device voice player
  const card = page.getByTestId("brief-card");
  if (await card.count()) {
    await card.getByRole("button", { name: /read · 2 min/i }).click(); await shot("home-brief");
    const listen = card.getByTestId("brief-listen"); if (await listen.count()) { await listen.click(); await page.waitForTimeout(800); await shot("home-player"); await page.getByRole("button", { name: /stop and close the player/i }).click().catch(() => {}); }
    await card.getByRole("button", { name: /close the brief/i }).click().catch(() => {});
  }
  // a position screen
  const row = page.locator("main .row").first(); if (await row.count()) { await row.click(); await page.waitForTimeout(1500); await shot("position"); const back = page.getByRole("button", { name: /holdings/i }).first(); if (await back.count()) await back.click(); await page.waitForTimeout(800); }
  for (const t of ["News", "Ask", "Settings"]) { await page.getByRole("button", { name: new RegExp("^" + t + "$") }).click(); await page.waitForTimeout(1500); await shot(t.toLowerCase()); }
  await ctx.close();
  // roll up per metric across screens
  const roll = {};
  for (const [screen, m] of Object.entries(results)) for (const [k, v] of Object.entries(m)) { roll[k] ??= { pass: true, fails: [] }; if (!v.pass) { roll[k].pass = false; roll[k].fails.push({ screen, detail: v.detail }); } }
  summary[name] = roll;
  console.log(`\n=== ${name} (${w}x${h}) ===`);
  for (const [k, v] of Object.entries(roll)) { console.log(`${v.pass ? "PASS" : "FAIL"} ${k}`); for (const f of v.fails) console.log(`     ${f.screen}: ${f.detail.join(" | ")}`); }
}
await browser.close();
const allPass = Object.values(summary).every((r) => Object.values(r).every((v) => v.pass));
console.log("\n" + (allPass ? "ALL METRICS PASS ON ALL DEVICES" : "SOME METRICS FAIL"));
process.exit(allPass ? 0 : 1);
