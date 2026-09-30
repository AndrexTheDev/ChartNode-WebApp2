#!/usr/bin/env bash
# © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
#
# Deploy-Gate in der CI: Build ist bereits passiert (npm ci + npm run build in
# den Workflows), hier kommen Serverstart und `npm run verify`.
#
# Warum als Skript: Am 2026-09-15 und am 2026-09-29 ist der Job in der
# Guard-Suite gescheitert, ohne dass die Ausgabe nachvollziehbar war
# (Log-Download der Actions-Ergebnisse schlug fehl). Dieses Skript
#   • bricht bei JEDEM Fehler ab (set -e + pipefail – kein maskierter Exitcode),
#   • schreibt das komplette Protokoll nach `verify.log` (Artefakt-Upload),
#   • setzt jede FAIL-Zeile als GitHub-Annotation (`::error::`) ab, die über die
#     Checks-API lesbar ist,
#   • fasst den Befund in der Job-Zusammenfassung zusammen.
set -Eeuo pipefail

PORT="${PORT:-3000}"
LOG="${LOG:-verify.log}"
HOST="127.0.0.1"

echo "── Server starten (next start, ${HOST}:${PORT}) ──"
npx next start -H "${HOST}" -p "${PORT}" > server.log 2>&1 &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT

READY=0
for attempt in $(seq 1 90); do
  if curl -sf -o /dev/null "http://${HOST}:${PORT}/de"; then
    echo "Server bereit nach ${attempt}s"
    READY=1
    break
  fi
  sleep 1
done
if [ "${READY}" != "1" ]; then
  echo "::error::Server nach 90s nicht erreichbar"
  echo "── server.log ──"
  tail -40 server.log || true
  exit 1
fi

echo "── Gate: npm run verify ──"
set +e
BASE_URL="http://${HOST}:${PORT}" npm run verify 2>&1 | tee "${LOG}"
STATUS=${PIPESTATUS[0]}
set -e

if [ "${STATUS}" != "0" ]; then
  echo
  echo "── Fehlerbefund ──"
  # Zeilen mit FAIL/✖ als Annotationen – sichtbar im PR-Check und per API.
  grep -E "✖|FAIL|Failure|failure" "${LOG}" | head -60 | while IFS= read -r line; do
    echo "::error::${line}"
  done
  {
    echo "### Gate rot (Exitcode ${STATUS})"
    echo
    echo '```'
    grep -E "✖|FAIL|Failure|failure" "${LOG}" | head -60 || echo "(keine FAIL-Zeile gefunden – vollständiges Protokoll im Artefakt)"
    echo '```'
    echo
    echo "Vollständig: Artefakt \`${LOG}\` dieses Laufs."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  exit "${STATUS}"
fi

echo "✔ Gate grün"
{
  echo "### Gate grün"
  echo
  grep -E "✔ .*OK|PASS · |PASS / " "${LOG}" | tail -20 || true
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
