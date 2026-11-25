#!/bin/bash
# PreToolUse hook (matcher: Bash|PowerShell). Encadena dos guardias; el payload JSON llega por stdin y se lo
# pasamos a cada uno por separado (mismo patrón que pretooluse-edit-guard.sh):
#   1. readonly-agent-guard — warden/sentinel/tracer no ejecutan ningún comando (TSK-261). Se mira PRIMERO: un agente
#      de solo lectura no llega a commit-gate.
#   2. commit-gate           — bloquea git commit/push si verify-simplicity.sh del worktree de la SESIÓN falla, o si
#      el commit/push apunta a otro worktree o a un destino que no se puede determinar (parseo JSON real + análisis
#      del comando en commit-gate.py).
# Claude Code 2.1.270 sólo bloquea con exit 2: cualquier otra salida distinta de 0 (python3 ausente, excepción no
# capturada) se traduce a 2 — un gate que no puede correr no deja pasar.
set -uo pipefail

payload=$(cat) || exit 2
here="$(cd "$(dirname "$0")" && pwd)" || exit 2

# bash con el que commit-gate.py corre verify-simplicity.sh. En Git Bash, $BASH es una ruta MSYS
# que un python nativo de Windows no entiende, y `bash` en PATH puede ser el lanzador de WSL.
D2K_HOOK_BASH="$BASH"
if command -v cygpath >/dev/null 2>&1; then
  D2K_HOOK_BASH="$(cygpath -w "$BASH")"
fi
export D2K_HOOK_BASH

for guard in readonly-agent-guard commit-gate; do
  if ! printf '%s' "$payload" | python3 "$here/$guard.py"; then
    exit 2
  fi
done

exit 0
