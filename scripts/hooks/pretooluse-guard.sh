#!/bin/bash
# PreToolUse hook (matcher: Bash) — bloquea git commit/push si verify-simplicity.sh falla.
# Lee el payload JSON del hook desde stdin (formato documentado de Claude Code:
# hook_event_name, tool_name, tool_input.command). Exit 2 = bloqueante.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

if printf '%s' "$cmd" | grep -qE 'git (commit|push)'; then
  # Excepción de simplicidad (ver verify-simplicity.sh): si el mensaje del commit referencia un
  # ticket (TSK-XXX), se lo pasamos como contexto -- el script decide si ese ticket ya declaró
  # `simplicity_exception: true` de antemano en su frontmatter, esto solo lo hace disponible.
  # Se busca sobre "$input" crudo, no sobre "$cmd": un commit -m con heredoc (patrón recomendado
  # para mensajes multilínea) mete comillas dentro del propio comando, y la extracción de "$cmd" de
  # arriba (regex ingenua sobre JSON) corta en la primera comilla interna -- "$input" no tiene ese
  # problema porque un TSK-XXX nunca lleva comillas ni requiere unescapar nada.
  ticket=$(printf '%s' "$input" | grep -oE 'TSK-[0-9]+' | head -1) || true
  if ! COMMIT_TICKET="$ticket" bash scripts/verify-simplicity.sh; then
    echo "Bloqueado: scripts/verify-simplicity.sh falló. Corrige las violaciones antes de commitear/pushear." >&2
    exit 2
  fi
fi

exit 0
