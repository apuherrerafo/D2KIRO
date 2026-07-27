#!/bin/bash
# PreToolUse hook (matcher: Bash) — bloquea git commit/push si verify-simplicity.sh falla.
# Lee el payload JSON del hook desde stdin (formato documentado de Claude Code:
# hook_event_name, tool_name, tool_input.command). Exit 2 = bloqueante.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

if printf '%s' "$cmd" | grep -qE 'git (commit|push)'; then
  if ! bash scripts/verify-simplicity.sh; then
    echo "Bloqueado: scripts/verify-simplicity.sh falló. Corrige las violaciones antes de commitear/pushear." >&2
    exit 2
  fi
fi

exit 0
