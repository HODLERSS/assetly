#!/bin/bash
# Assetly Admin: build and deploy to its own Vercel project (assetly-admin), apart from the consumer app.
# The deploy is the prebuilt dist/ (no remote build: it reads ../web's env and theme). See RUNBOOK "Admin app".
set -e
cd "$(dirname "$0")"
npm run build
cp vercel.json dist/vercel.json
grep -q 'noindex' dist/index.html || { echo "FATAL: robots meta missing"; exit 1; }
cd dist
[ -d .vercel ] || npx --yes vercel link --yes --project assetly-admin
npx --yes vercel deploy --prod --yes
