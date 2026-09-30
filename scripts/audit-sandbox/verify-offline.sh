#!/usr/bin/env bash
# © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
#
# `npm run verify` OHNE Internet – gleiche Prüfungen, gleiche Reihenfolge wie im
# Deploy-Gate (.github/workflows/deploy.yml), nur mit gefixtem Börsen-Feed.
# Live-Provider-Prüfungen (On-Chain, Derivate, Options, Screener) melden SKIP,
# alles andere muss grün sein. Voraussetzung: ein laufender Server auf :3000
# (`npm start`) und ein Build in `.next` (`npm run build`).
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "── typecheck ──";        npm run typecheck
echo "── lint ──";             npm run lint
echo "── i18n ──";             npm run check:i18n
echo "── SEO ──";              node scripts/seo-check.mjs
echo "── CWV ──";              node scripts/cwv-check.mjs
echo "── Fit (Fixture-Feed) ──";     node scripts/audit-sandbox/run-with-fixtures.mjs scripts/fit-check.mjs
echo "── Features (Fixture-Feed) ──"; node scripts/audit-sandbox/run-with-fixtures.mjs scripts/qa-features.mjs
echo "── Browser (Fixture-Feed) ──";  node scripts/audit-sandbox/run-with-fixtures.mjs scripts/browser-check.mjs
echo
echo "✔ verify (offline) abgeschlossen"
