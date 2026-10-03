#!/usr/bin/env bash
# © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
#
# Produktionsbuild im Gate – mit Selbstdiagnose.
#
# Warum: Der Build ist am 2026-09-30 in der CI gescheitert, und die Logs der
# Actions-Ergebnisse sind aus der Entwicklungsumgebung nicht abrufbar
# (Blob-Storage-EOF). Dieses Skript macht den Fehlschlag selbst erklärend:
#   • komplette Ausgabe nach `build.log` (wird als Artefakt hochgeladen),
#   • relevante Zeilen als `::error::`-Annotation (per Checks-API lesbar),
#   • großzügiger Heap für `next build --webpack` (Warnung statt Absturz).
set -Eeuo pipefail

LOG="${LOG:-build.log}"
# Next baut mit vielen Worker-Prozessen; ein knapper Heap endet in
# "JavaScript heap out of memory" ohne erkennbaren Bezug zum Code.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
# next/font/google normally fetches a mutable Google Fonts response at build
# time. Use the checked-in deterministic mock backed by the real @fontsource
# font files so CI and Cloudflare builds do not depend on that network request.
if [[ -z "${NEXT_FONT_GOOGLE_MOCKED_RESPONSES:-}" ]]; then
  FONT_MOCK="${PWD}/scripts/audit-sandbox/font-mock.cjs"
  if [[ -f "${FONT_MOCK}" ]]; then
    export NEXT_FONT_GOOGLE_MOCKED_RESPONSES="${FONT_MOCK}"
  fi
fi
export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"

set +e
npm run build 2>&1 | tee "${LOG}"
STATUS=${PIPESTATUS[0]}
set -e

if [ "${STATUS}" != "0" ]; then
  echo
  echo "── Build rot (Exitcode ${STATUS}) ──"
  # 1) Klassische Fehlerzeilen einzeln annotieren
  grep -nE "Failed to compile|Type error|Module not found|Error:|ERR_|heap out of memory|Cannot find|Unhandled" "${LOG}" \
    | head -30 | while IFS= read -r line; do
      echo "::error::${line}"
    done
  # 2) Zusätzlich die letzten Zeilen – die Ursache steht bei Next meist am Ende
  tail -25 "${LOG}" | while IFS= read -r line; do
    [ -n "${line}" ] && echo "::error::(Ende) ${line}"
  done
  {
    echo "### Build rot (Exitcode ${STATUS})"
    echo
    echo '```'
    tail -60 "${LOG}"
    echo '```'
    echo
    echo "Vollständig: Artefakt \`${LOG}\` dieses Laufs."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  exit "${STATUS}"
fi

echo "✔ Build grün"
