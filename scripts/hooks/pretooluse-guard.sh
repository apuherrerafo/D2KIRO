#!/bin/bash
# PreToolUse hook (matcher: Bash) — bloquea git commit/push si verify-simplicity.sh falla.
# Lee el payload JSON del hook desde stdin (formato documentado de Claude Code:
# hook_event_name, tool_name, tool_input.command). Exit 2 = bloqueante.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Directorio al que apunta la operación git. Por defecto, el cwd de la sesión (comportamiento
# original). Sólo se redirige a OTRO worktree cuando es inequívoco: exactamente un `git commit|push`
# y exactamente una directiva de directorio (`cd <dir> &&` al inicio, o `git -C <dir> commit|push`),
# sin --git-dir/--work-tree/GIT_DIR/GIT_WORK_TREE, y el directorio existe y es un repo git.
# Cualquier duda -> cwd de la sesión (estricto). Nunca se relaja el gate: sólo se elige a qué
# árbol se le aplica, y es el verify-simplicity.sh de ESE árbol el que corre.
resolve_target_dir() {
  local c="$1" dir="" ops dirs
  ops=$(printf '%s' "$c" | grep -oE 'git( +-C +[^ ]+)? +(commit|push)' | wc -l)
  [ "$ops" -eq 1 ] || return 1
  if printf '%s' "$c" | grep -qE -- '--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE='; then return 1; fi
  dirs=$(( $(printf '%s' "$c" | grep -oE '(^|[;&| ])cd +' | wc -l) + $(printf '%s' "$c" | grep -oE 'git +-C +' | wc -l) ))
  [ "$dirs" -eq 1 ] || return 1
  local re_cd='^[[:space:]]*cd[[:space:]]+([^][:space:];&|"]+)[[:space:]]*&&'
  local re_c='git[[:space:]]+-C[[:space:]]+([^][:space:];&|"]+)[[:space:]]+(commit|push)'
  if [[ "$c" =~ $re_cd ]]; then
    dir="${BASH_REMATCH[1]}"
  elif [[ "$c" =~ $re_c ]]; then
    dir="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  [ -d "$dir" ] || return 1
  git -C "$dir" rev-parse --show-toplevel 2>/dev/null
}

if printf '%s' "$cmd" | grep -qE 'git (commit|push)|git +-C +[^ ]+ +(commit|push)'; then
  target=$(resolve_target_dir "$cmd") || target="$(pwd)"
  # Governance 2.0 (2026-08-24): VERIFY_COMMIT_GATE=1 activa el hard gate real de este camino
  # (compilación/tipos + bun test) -- ver verify-simplicity.sh, sección 8. Los hooks
  # PostToolUse/SubagentStop de .claude/settings.json llaman al mismo script sin este flag, así
  # que solo el commit/push paga el costo de tsc+bun test completos.
  if ! (cd "$target" && VERIFY_COMMIT_GATE=1 bash scripts/verify-simplicity.sh); then
    echo "Bloqueado: scripts/verify-simplicity.sh falló. Corrige las violaciones antes de commitear/pushear." >&2
    exit 2
  fi
fi

exit 0
