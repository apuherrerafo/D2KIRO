#!/bin/bash
# PreToolUse hook (matcher: Bash) — bloquea git commit/push si verify-simplicity.sh falla.
# Lee el payload JSON del hook desde stdin (formato documentado de Claude Code:
# hook_event_name, tool_name, tool_input.command). Exit 2 = bloqueante.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

if printf '%s' "$cmd" | grep -qE 'git (commit|push)'; then
  # Governance 2.0 (2026-08-24): VERIFY_COMMIT_GATE=1 activa el hard gate real de este camino
  # (compilación/tipos + bun test) -- ver verify-simplicity.sh, sección 8. Los hooks
  # PostToolUse/SubagentStop de .claude/settings.json llaman al mismo script sin este flag, así
  # que solo el commit/push paga el costo de tsc+bun test completos.
  if ! VERIFY_COMMIT_GATE=1 bash scripts/verify-simplicity.sh; then
    echo "Bloqueado: scripts/verify-simplicity.sh falló. Corrige las violaciones antes de commitear/pushear." >&2
    exit 2
  fi
fi

exit 0
