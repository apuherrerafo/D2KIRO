#!/bin/bash
# PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit) — Fase 9, TSK-194.
# Encadena los dos guardias de escritura. Ambos resuelven primero el worktree de la sesión
# (payload "cwd") y bloquean cualquier archivo fuera de él antes de mirar tickets.
#   1. data-boundary-guard  — protege data/curated/ (ADR-003)
#   2. write-scope-guard     — encierra cada ticket en su write_scope declarado
# El payload JSON del hook llega por stdin; se lo pasamos a cada guardia por separado.
# Fail-closed: Claude Code 2.1.270 sólo bloquea con exit 2 — cualquier salida distinta de 0
# (python3 ausente, excepción no capturada) se traduce a 2, nunca se deja pasar.
set -uo pipefail

payload=$(cat) || exit 2
here="$(cd "$(dirname "$0")" && pwd)" || exit 2

for guard in data-boundary-guard write-scope-guard; do
  if ! printf '%s' "$payload" | python3 "$here/$guard.py"; then
    exit 2
  fi
done

exit 0
