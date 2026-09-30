#!/usr/bin/env bash
# © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
#
# Deployt den Worker zu Cloudflare – mit klarer Diagnose, wenn die Secrets
# fehlen. Wrangler bricht sonst mit einer Meldung ab, die nicht verrät, was zu
# tun ist; hier steht die Anleitung direkt am fehlgeschlagenen Check.
set -Eeuo pipefail

LOG="${LOG:-deploy.log}"

missing=0
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || missing=1
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || missing=1

if [ "${missing}" = "1" ]; then
  echo "::error::Cloudflare-Zugangsdaten fehlen – der Worker kann nicht deployt werden."
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || echo "::error::CLOUDFLARE_API_TOKEN ist leer (Repository-Secret anlegen)."
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || echo "::error::CLOUDFLARE_ACCOUNT_ID ist leer (Repository-Secret anlegen)."
  echo "::error::Anleitung: VEROEFFENTLICHEN.md §3b – Cloudflare → My Profile → API Tokens → Template „Edit Cloudflare Workers“; Account-ID steht rechts auf der Workers-&-Pages-Übersicht. Beide als Repository-Secrets unter Settings → Secrets and variables → Actions eintragen."
  {
    echo "### Deploy nicht möglich: Cloudflare-Secrets fehlen"
    echo
    echo "1. Cloudflare → **My Profile → API Tokens → Create Token** → Template **„Edit Cloudflare Workers“** → Create."
    echo "2. Account-ID: Workers & Pages → rechts oben (32 Zeichen)."
    echo "3. GitHub → **Settings → Secrets and variables → Actions → New repository secret**:"
    echo "   - \`CLOUDFLARE_API_TOKEN\`"
    echo "   - \`CLOUDFLARE_ACCOUNT_ID\`"
    echo
    echo "Danach diesen Lauf unter **Actions → Deploy to Cloudflare → Re-run jobs** wiederholen."
    echo "Details: VEROEFFENTLICHEN.md §3b."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  exit 1
fi

set +e
npx wrangler deploy 2>&1 | tee "${LOG}"
STATUS=${PIPESTATUS[0]}
set -e

if [ "${STATUS}" != "0" ]; then
  echo
  grep -nE "ERROR|Error|error|Invalid|not found|unauthor" "${LOG}" | head -20 | while IFS= read -r line; do
    echo "::error::${line}"
  done
  {
    echo "### Deploy fehlgeschlagen (Exitcode ${STATUS})"
    echo
    echo '```'
    tail -40 "${LOG}"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  exit "${STATUS}"
fi

echo "✔ Worker deployt"
