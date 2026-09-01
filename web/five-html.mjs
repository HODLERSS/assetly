import { readFileSync, writeFileSync, existsSync } from "fs";
const D = JSON.parse(readFileSync("/tmp/five/data.json", "utf8"));
const esc = t => String(t ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const strip = t => String(t ?? "").replace(/<\/?[a-zA-Z][^>]*>/g," ").replace(/\s{2,}/g," ").trim();
const wc = t => strip(t).split(/\s+/).filter(Boolean).length;
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const b64 = f => existsSync(`/tmp/five/${f}`) ? readFileSync(`/tmp/five/${f}`).toString("base64") : null;
const secBlock = (s) => {
  if (!s) return `<p class="none">not generated</p>`;
  const notes = (s.positions ?? []).map(p => `<div class="pos"><b>${esc(p.name)}</b> ${esc(p.note)}${p.watch?`<span class="w">watch: ${esc(p.watch)}</span>`:""}</div>`).join("");
  return `<p class="lede">${esc(s.lede)}</p>
    ${s.overnight?`<p><span class="k">The tape</span>${esc(s.overnight)}</p>`:""}${notes}
    ${s.desk_view?`<p><span class="k">Desk view</span>${esc(s.desk_view)}</p>`:""}
    ${s.horizon?`<p><span class="k">Horizon</span>${esc(s.horizon)}</p>`:""}
    ${(s.ideas??[]).length?`<p><span class="k">Worth researching</span>${esc((s.ideas??[]).join(" · "))}</p>`:""}`;
};
const edBlock = (rec, ed, title) => {
  const s = rec[ed]?.sections;
  const readW = s ? wc([s.lede,s.overnight,...(s.positions??[]).flatMap(p=>[p.note,p.watch]),s.desk_view,s.horizon??"",...(s.ideas??[])].join(" ")) : 0;
  const audio = rec[`${ed}Audio`] ? b64(rec[`${ed}Audio`]) : null;
  return `<section class="ed"><h3>${title}<span class="m">${readW} words · ~${(readW/200).toFixed(1)} min read</span></h3>
    ${audio ? `<audio controls preload="none" src="data:audio/mpeg;base64,${audio}"></audio>` : `<p class="none">audio not generated</p>`}
    <div class="body">${secBlock(s)}</div></section>`;
};
const cards = D.map(rec => {
  const total = (rec.book ?? []).reduce((a,[,q,c]) => a + q*c, 0);
  const holdings = (rec.book ?? []).map(([sym,q,c]) => `<span class="chip">${esc(sym)} ${money(q*c)}</span>`).join("");
  const inv = rec.inv ?? {};
  const tags = [ (inv.level??[]).join("/"), (inv.styles??[]).join(" + "), inv.horizon, `target ${inv.target}` ].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join("");
  return `<article class="person"><header><h2>${esc(rec.name)}</h2><p class="blurb">${esc(rec.blurb)}</p>
      <div class="tags">${tags}</div><p class="total">${money(total)} <span>at cost · ${(rec.book??[]).length} positions</span></p>
      <div class="chips">${holdings}</div></header>
    ${edBlock(rec,"assessment","Portfolio assessment")}${edBlock(rec,"midday","Midday brief")}</article>`;
}).join("");
const html = `<title>Five Client Briefs</title><style>
:root{--bg:#faf9f6;--ink:#1a1a17;--mut:#6d6960;--line:#e3dfd6;--card:#fff;--accent:#1f4e46;--chip:#f0ede5}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#131310;--ink:#ecebe4;--mut:#9b968a;--line:#2e2d27;--card:#1a1a16;--accent:#8fd0c2;--chip:#232219}}
:root[data-theme=dark]{--bg:#131310;--ink:#ecebe4;--mut:#9b968a;--line:#2e2d27;--card:#1a1a16;--accent:#8fd0c2;--chip:#232219}
*{box-sizing:border-box}body{background:var(--bg);color:var(--ink);font:16px/1.62 ui-serif,Georgia,serif;margin:0;padding:34px 18px 70px}
.wrap{max-width:940px;margin:0 auto}h1{font-size:27px;margin:0 0 6px;letter-spacing:-.01em}
.sub{color:var(--mut);margin:0 0 30px;font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif}
.person{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:0 0 26px;overflow:hidden}
.person>header{padding:18px 20px;border-bottom:1px solid var(--line)}
h2{font:600 19px/1.2 ui-sans-serif,system-ui,sans-serif;margin:0 0 6px}
.blurb{margin:0 0 10px;color:var(--mut);font-size:14.5px}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tag{font:600 10.5px/1 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);border:1px solid currentColor;border-radius:20px;padding:5px 9px}
.total{font:600 22px/1 ui-sans-serif,system-ui,sans-serif;margin:0 0 10px;font-variant-numeric:tabular-nums}
.total span{font-weight:400;font-size:13px;color:var(--mut)}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{background:var(--chip);border-radius:5px;padding:4px 8px;font:12px/1.3 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:var(--mut)}
.ed{padding:16px 20px;border-top:1px solid var(--line)}
h3{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.09em;color:var(--accent);margin:0 0 11px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.m{font-weight:400;color:var(--mut);text-transform:none;letter-spacing:0}
audio{width:100%;margin:0 0 14px;height:38px}
p{margin:0 0 11px}.lede{font-size:17px}
.k{display:block;font:600 10px/1 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin-bottom:3px}
.pos{margin:0 0 10px;padding-left:12px;border-left:2px solid var(--line)}
.pos b{font-family:ui-sans-serif,system-ui,sans-serif;font-size:13.5px}
.w{display:block;font-size:13px;color:var(--mut);font-family:ui-sans-serif,system-ui,sans-serif}
.none{color:var(--mut);font-style:italic;font-size:14px}</style>
<div class="wrap"><h1>Five clients, five briefs</h1>
<p class="sub">Fictitious profiles, $5,000,000 each, run through the live pipeline. Portfolio assessment and today's midday brief — press play to hear what the client hears.</p>
${cards}</div>`;
writeFileSync("/tmp/five/five-client-briefs.html", html);
console.log(`HTML: ${Math.round(html.length/1024)} KB`);
