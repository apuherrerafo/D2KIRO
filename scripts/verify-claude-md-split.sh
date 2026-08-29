#!/bin/bash
# TSK-196 — verifica que el split de CLAUDE.md (bloques "## REGLAS DE FASE X" movidos a
# .claude/rules/fase-N.md) no perdió ni alteró una sola línea.
#
# scripts/verify-claude-md-split.expected es el contenido verbatim de los 10 bloques tal como
# estaban en CLAUDE.md justo antes del split. Este script comprueba que cada línea no vacía de
# ese fixture sigue presente, byte por byte, en la concatenación de .claude/rules/fase-*.md.
#
# Además exige CLAUDE.md < 200 líneas. Exit != 0 si algo falla.
set -uo pipefail
cd "$(dirname "$0")/.."

expected="scripts/verify-claude-md-split.expected"
[ -f "$expected" ] || { echo "FALTA: $expected" >&2; exit 1; }

concat="$(cat .claude/rules/fase-*.md 2>/dev/null)"
[ -n "$concat" ] || { echo "FALTA: .claude/rules/fase-*.md" >&2; exit 1; }

missing=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # grep -F: literal, línea completa
  if ! printf '%s\n' "$concat" | grep -qxF -- "$line"; then
    echo "LÍNEA PERDIDA O ALTERADA: $line" >&2
    missing=$((missing + 1))
  fi
done < "$expected"

lc="$(wc -l < CLAUDE.md | tr -d ' ')"
if [ "$lc" -ge 200 ]; then
  echo "CLAUDE.md tiene $lc líneas (>= 200). El split debe dejarlo por debajo." >&2
  missing=$((missing + 1))
fi

if [ "$missing" -ne 0 ]; then
  echo "verify-claude-md-split: FAIL ($missing problema(s))." >&2
  exit 1
fi

echo "verify-claude-md-split: OK — CLAUDE.md $lc líneas, los 10 bloques de fase intactos en .claude/rules/fase-*.md."
