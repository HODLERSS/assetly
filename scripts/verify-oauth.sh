#!/usr/bin/env bash
# Shows which external providers the production Supabase project reports enabled, checks the
# public URL, then runs the cloud battery. No secrets required.
set -euo pipefail
REF=hhdpthrfmsdmxdrfckxq; KEY=sb_publishable_MKb_6rBvHA6JJ4UYxhg9Cw_BIrKkICE
echo "== auth providers (Supabase /auth/v1/settings)"
curl -s "https://$REF.supabase.co/auth/v1/settings" -H "apikey: $KEY" | python3 -c '
import json,sys; s=json.load(sys.stdin)["external"]
for p in ("email","github","google"): print("  %-7s %s" % (p, "ENABLED" if s.get(p) else "off"))'
echo "== public app: HTTP $(curl -s -o /dev/null -w '%{http_code}' https://hodlerss.github.io/assetly/)"
echo "== cloud battery"; cd "$(dirname "$0")/../web" && ASSETLY_CLOUD=1 npx vitest run src/test/cloud.test.ts 2>&1 | grep -E "Tests |×"
