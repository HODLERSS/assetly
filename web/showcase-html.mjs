// Packages /tmp/showcase/{data.json,*.mp3} into ONE self-contained HTML: five investor profiles, each with the
// assessment, the daily brief, portfolio intelligence, and the narrated audio embedded as a data URI.
import { readFileSync, writeFileSync, existsSync } from "fs";
const D = JSON.parse(readFileSync("/tmp/showcase/data.json", "utf8"));
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const chip = (t) => `<span class="chip">${esc(t)}</span>`;
const sec = (title, body) => body ? `<h4>${title}</h4>${body}` : "";
const briefHtml = (b, isAssess) => {
  if (!b) return `<p class="miss">not generated in this run</p>`;
  const s = b.sections;
  const pos = (s.positions ?? []).map((p) => `<p><strong>${esc(p.name)}</strong> — ${esc(p.note)} <span class="sub">${isAssess ? "Tripwire" : "Watch"}: ${esc(p.watch)}</span></p>`).join("");
  return `<p class="lede">${esc(s.lede)}</p>` +
    sec(isAssess ? "Your book" : "The tape", `<p>${esc(s.overnight)}</p>`) +
    sec(isAssess ? "Quality read" : "Positions", pos) +
    sec(isAssess ? "Structure &amp; risk" : "Desk view", `<p>${esc(s.desk_view)}</p>`) +
    (isAssess && s.horizon ? sec("Horizons", `<p>${esc(s.horizon)}</p>`) : "") +
    (isAssess && s.ideas?.length ? sec("Gaps &amp; ideas", s.ideas.map((x) => `<p>· ${esc(x)}</p>`).join("")) : "") +
    (!isAssess && s.calendar?.length ? sec("Calendar", s.calendar.map((x) => `<p class="sub">${esc(x)}</p>`).join("")) : "");
};
const insightHtml = (r) => {
  if (!r) return `<p class="miss">not generated in this run</p>`;
  return (r.bullets ?? []).map((b) => `<p>• ${esc(b)}</p>`).join("") +
    (r.news5?.length ? sec("Top signals this week", r.news5.map((n) => `<p class="sub">${esc(n)}</p>`).join("")) : "");
};
const cards = Object.entries(D).map(([tag, rec], i) => {
  const inv = rec.investor;
  const audio = rec.audioFile && existsSync(`/tmp/showcase/${rec.audioFile}`)
    ? `<audio controls preload="none" src="data:audio/mpeg;base64,${readFileSync(`/tmp/showcase/${rec.audioFile}`).toString("base64")}"></audio>`
    : `<p class="miss">narration pending</p>`;
  return `<details class="card" ${i === 0 ? "open" : ""}><summary><strong>${i + 1}. ${esc(rec.label)}</strong></summary>
  <p class="chips">${[inv.styles.join(" + "), inv.purpose, inv.horizon, inv.target + "/yr", inv.risk, inv.level].map(chip).join(" ")}</p>
  <h3>▶ 2-minute audio briefing</h3>${audio}
  <h3>Portfolio Assessment</h3>${briefHtml(rec.assessment, true)}
  <h3>Daily brief (${esc(rec.daily?.edition ?? "—")})</h3>${briefHtml(rec.daily, false)}
  <h3>Portfolio intelligence &amp; news</h3>${insightHtml(rec.insight)}
  </details>`;
}).join("\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assetly Persona Showcase</title><style>
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:0 auto;padding:20px;background:#fafbfd;color:#16233b;line-height:1.5}
h1{font-size:22px}h3{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#2A3F92;margin:18px 0 6px}
h4{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7690;margin:12px 0 2px}
.card{background:#fff;border:1px solid #e3e8f2;border-radius:14px;padding:6px 18px 18px;margin:14px 0;box-shadow:0 1px 4px rgba(22,35,59,.05)}
summary{cursor:pointer;padding:12px 0;font-size:16px}
.chip{display:inline-block;background:#eef1f9;border-radius:99px;padding:3px 10px;font-size:12px;margin:2px}
.lede{font-weight:600}.sub{color:#6b7690;font-size:13px}.miss{color:#b06060;font-style:italic}
audio{width:100%}p{margin:6px 0;font-size:14px}
.note{font-size:12.5px;color:#6b7690}
</style></head><body>
<h1>Assetly · one portfolio, five investors</h1>
<p class="note">The same real portfolio (minjae.m.lee@gmail.com, ${new Date().toISOString().slice(0, 10)}), run through the live Assetly pipeline five times — once per investor profile. Everything below (assessments, briefs, intelligence, narration) was generated and narrated by the production system; only the reader profile changed between runs. Not financial advice.</p>
${cards}
<p class="note">Your own profile (Advanced · Growth + AI · stay on top) was restored after the run and your live in-app artifacts were regenerated with it.</p>
</body></html>`;
writeFileSync("/tmp/showcase/assetly-persona-showcase.html", html);
console.log("HTML:", Math.round(html.length / 1024), "KB ->", "/tmp/showcase/assetly-persona-showcase.html");
