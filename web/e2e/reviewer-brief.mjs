// Force one brief edition for the App Review demo account (creds from ~/.private_keys/assetly-reviewer.txt).
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const edition = process.argv[2] ?? "close";
const cred = Object.fromEntries(fs.readFileSync(`${process.env.HOME}/.private_keys/assetly-reviewer.txt`, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const c = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
const { error } = await c.auth.signInWithPassword({ email: cred.email, password: cred.password });
if (error) { console.log("login failed", error.message); process.exit(1); }
const { data: u } = await c.auth.getUser();
const t0 = Date.now();
const { data, error: e2 } = await c.functions.invoke("daily-brief", { body: { user_id: u.user.id, edition, force: true } });
console.log(`daily-brief ${edition}: ${Math.round((Date.now() - t0) / 1000)}s`, e2 ? "ERROR " + e2.message : JSON.stringify(data).slice(0, 200));
const { data: rows } = await c.from("daily_briefs").select("brief_date,edition,model,generated_at,sections,script").eq("edition", edition).order("generated_at", { ascending: false }).limit(1);
const r = rows?.[0]; if (r) console.log("row:", r.brief_date, r.edition, r.model, "script=" + (r.script ? r.script.length : 0), "lede:", String(r.sections?.lede ?? "").slice(0, 160));
