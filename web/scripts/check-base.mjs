// Refuses a dist/ built for the wrong base. deploy.sh writes /assetly/-based output into the same dist/
// that Capacitor copies into the app; a stale one renders a blank webview with every asset 404ing.
import { readFileSync } from "fs";
const want = process.argv[2] ?? "./";
const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const m = html.match(/src="([^"]*?)assets\/index-[^"]+\.js"/);
const got = m ? m[1] : "(no index script)";
if (got !== want) { console.error(`dist/index.html is built for base "${got}", expected "${want}". Rebuild with VITE_BASE=${want}.`); process.exit(1); }
console.log(`dist base ok: ${got}`);
