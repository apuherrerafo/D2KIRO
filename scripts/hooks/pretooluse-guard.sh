#!/bin/bash
# PreToolUse hook (matcher: Bash|PowerShell) — bloquea git commit/push si verify-simplicity.sh
# del worktree de la SESIÓN falla, o si el commit/push apunta a otro worktree o a un destino que
# no se puede determinar. La lógica vive en commit-gate.py (parseo JSON real + análisis del
# comando); este archivo sólo garantiza el fallo cerrado.
# Claude Code 2.1.270 sólo bloquea con exit 2: cualquier otra salida distinta de 0 (python3
# ausente, excepción no capturada) se traduce a 2 — un gate que no puede correr no deja pasar.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)" || exit 2

# bash con el que commit-gate.py corre verify-simplicity.sh. En Git Bash, $BASH es una ruta MSYS
# que un python nativo de Windows no entiende, y `bash` en PATH puede ser el lanzador de WSL.
D2K_HOOK_BASH="$BASH"
if command -v cygpath >/dev/null 2>&1; then
  D2K_HOOK_BASH="$(cygpath -w "$BASH")"
fi
export D2K_HOOK_BASH

python3 "$here/commit-gate.py"
rc=$?
if [ "$rc" -eq 0 ]; then
  exit 0
fi
exit 2
