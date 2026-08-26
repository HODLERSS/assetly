#!/bin/bash
# Assetly gh-pages deploy — ALWAYS builds with the /assetly/ base.
# A bare `npm run build` produces a broken gh-pages bundle (assets 404 → blank page).
set -e
cd "$(dirname "$0")/web"
VITE_BASE=/assetly/ npm run build
grep -q 'src="/assetly/assets/' dist/index.html || { echo "FATAL: base missing from dist"; exit 1; }
cd ..
git worktree prune
git worktree add /tmp/assetly-pages gh-pages
rsync -ac --delete --exclude .git web/dist/ /tmp/assetly-pages/
cp /tmp/assetly-pages/index.html /tmp/assetly-pages/404.html
cd /tmp/assetly-pages
git add -A
git commit -m "deploy: $(date -u +%Y-%m-%dT%H:%MZ)" || echo "nothing to deploy"
git push origin gh-pages
gh api -X POST repos/HODLERSS/assetly/pages/builds >/dev/null || true
git -C "$OLDPWD" worktree remove /tmp/assetly-pages --force
echo "Deployed. Poll: curl -s https://hodlerss.github.io/assetly/ | grep -o 'index-[^\"]*.js'"
