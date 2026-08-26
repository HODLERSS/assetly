import { createClient } from "@supabase/supabase-js";
const c = createClient("https://hhdpthrfmsdmxdrfckxq.supabase.co", "sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE", { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "e2e-cloud@assetly.test", password: "Assetly-e2e-fixture-2026" });
for (let attempt = 1; attempt <= 3; attempt++) {
  await new Promise(r => setTimeout(r, attempt === 1 ? 25000 : 30000));   // let the redeploy roll out
  const i = await c.functions.invoke("insights-sync", { body: {} });
  const d = i.data ?? {};
  console.log(`attempt ${attempt}:`, i.error ? "ERR " + i.error.message : JSON.stringify(d));
  if ((d.portfolioWrote ?? 0) > 0) { console.log("PORTFOLIO INSIGHT WROTE OK"); break; }
}
