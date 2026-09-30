// Store (or rotate) the APNs credentials in the Supabase Vault without ever printing the key.
//   node scripts/set-apns-secrets.mjs <KEY_ID> [path/to/AuthKey.p8]      # default ~/.private_keys/AuthKey_APNS_<KEY_ID>.p8
// Creates apns_key_id / apns_team_id / apns_private_key, or updates them if they exist, and clears the cached
// provider token so the next send signs with the new key. Prints names and lengths only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [keyId, file = path.join(os.homedir(), ".private_keys", `AuthKey_APNS_${process.argv[2]}.p8`)] = process.argv.slice(2);
if (!/^[A-Z0-9]{10}$/.test(keyId ?? "")) { console.error("usage: set-apns-secrets.mjs <10-char KEY_ID> [p8 path]"); process.exit(2); }
const pem = fs.readFileSync(file, "utf8").trim();
if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(pem)) { console.error("not a PKCS#8 .p8 file"); process.exit(2); }
const TEAM = "5RCPL9J3UX";
const tag = "$apns$";
if ([pem, keyId].some((v) => v.includes(tag))) process.exit(2);
const lit = (v) => `${tag}${v}${tag}`;
const upsert = (name, value) => `do $do$ begin
  if exists (select 1 from vault.secrets where name = '${name}') then
    perform vault.update_secret((select id from vault.secrets where name = '${name}'), ${lit(value)});
  else perform vault.create_secret(${lit(value)}, '${name}'); end if; end $do$;`;
const sql = [upsert("apns_key_id", keyId), upsert("apns_team_id", TEAM), upsert("apns_private_key", pem),
  "delete from public.apns_provider_token;",
  "select name, length(decrypted_secret) as len from vault.decrypted_secrets where name like 'apns_%' order by name;"].join("\n");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apns-")), "q.sql");
fs.writeFileSync(tmp, sql, { mode: 0o600 });
try {
  const out = execFileSync("npx", ["--no-install", "supabase", "db", "query", "--linked", "--project-ref", "hhdpthrfmsdmxdrfckxq", "-f", tmp],
    { cwd: path.dirname(new URL(import.meta.url).pathname) + "/..", stdio: ["ignore", "pipe", "pipe"] }).toString();
  const rows = (out.match(/"len":\s*\d+|"name":\s*"apns_[a-z_]+"/g) ?? []).join(" ");
  console.log("stored:", rows);
} finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
