#!/bin/bash
# PreToolUse hook (matcher: Edit|Write|MultiEdit) — Fase 9, TSK-194.
# Encadena los dos guardias de escritura. Cualquiera que devuelva 2 bloquea la operación.
#   1. data-boundary-guard  — protege data/curated/ (ADR-003)
#   2. write-scope-guard     — encierra cada ticket en su write_scope declarado
# El payload JSON del hook llega por stdin; se lo pasamos a cada guardia por separado.
set -uo pipefail

payload=$(cat)
here="$(cd "$(dirname "$0")" && pwd)"

for guard in data-boundary-guard write-scope-guard; do
  if ! printf '%s' "$payload" | python3 "$here/$guard.py"; then
    exit 2
  fi
done

exit 0
