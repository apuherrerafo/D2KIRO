#!/bin/bash
set -euo pipefail

ERRORS=0
MAX_FILES=3
MAX_LINES=200   # Fuente única del límite. CLAUDE.md y las skills deben referenciar esta constante, no repetirla.

echo "🦴 Verificando simplicidad..."

# --- 0. Base de comparación ---
# Repo sin ningún commit todavía (bootstrap): `git diff ... HEAD` no existe y aborta con
# set -e (exit 128). Se usa el árbol vacío de Git como base en ese caso — mismo resultado
# práctico (todo lo trackeado cuenta como "añadido"), sin depender de que exista HEAD.
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
if git rev-parse --verify -q HEAD >/dev/null; then
  DIFF_BASE="HEAD"
else
  DIFF_BASE="$EMPTY_TREE"
fi

# --- Rutas de bookkeeping, excluidas del límite de archivos/líneas ---
# journal.md (y sus particiones mensuales), el .md del propio ticket, plan.md, ledger.md y
# PROGRESS.md los toca CASI cualquier tarea (registro de actividad, estado del ticket) — no son
# el "código" que el límite de 3 archivos/200 líneas busca acotar. Sin esta exclusión, el gate
# fallaría en casi todo ticket por bookkeeping de rutina en cuanto existe al menos un commit
# (dejan de ser "nuevos" y sus ediciones sí cuentan en el diff).
BOOKKEEPING_PATTERN='^docs/agents/(journal[^/]*[.]md|plan[.]md|ledger[.]md|PROGRESS[.]md|tasks/TSK-[0-9]+[.]md)$'

# --- 1 y 2. Archivos tocados y líneas añadidas ---
# `git diff` es ciego a archivos nunca trackeados (nunca pasaron por `git add`) — el código nuevo
# de una tarea normalmente son archivos nuevos, así que sin esto el conteo da 0 aunque la tarea
# haya creado docenas de archivos. Se suman ambos universos: diff de lo ya trackeado + archivos
# untracked reales (vía `git ls-files --others --exclude-standard`), cada uno con la exclusión de
# bookkeeping aplicada por igual.
TRACKED_FILES=$(git diff --name-only "$DIFF_BASE" 2>/dev/null | grep -Ev "$BOOKKEEPING_PATTERN") || true
UNTRACKED_FILES=$(git ls-files --others --exclude-standard 2>/dev/null | grep -Ev "$BOOKKEEPING_PATTERN") || true
ALL_FILES=$(printf '%s\n%s\n' "$TRACKED_FILES" "$UNTRACKED_FILES" | grep -v '^$') || true

FILES_TOUCHED=$(printf '%s\n' "$ALL_FILES" | grep -c '.') || true
FILES_TOUCHED=${FILES_TOUCHED:-0}
if [ "$FILES_TOUCHED" -gt "$MAX_FILES" ]; then
  echo "❌ ERROR: $FILES_TOUCHED archivos modificados. Máximo: $MAX_FILES."
  printf '%s\n' "$ALL_FILES" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

TRACKED_LINES=$(git diff --numstat "$DIFF_BASE" 2>/dev/null | awk -v pat="$BOOKKEEPING_PATTERN" '$3 !~ pat {sum += $1} END {print sum+0}')
UNTRACKED_LINES=0
if [ -n "$UNTRACKED_FILES" ]; then
  while IFS= read -r f; do
    [ -f "$f" ] && UNTRACKED_LINES=$((UNTRACKED_LINES + $(wc -l < "$f" | tr -d ' ')))
  done <<< "$UNTRACKED_FILES"
fi
LINES_ADDED=$((TRACKED_LINES + UNTRACKED_LINES))
if [ "$LINES_ADDED" -gt "$MAX_LINES" ]; then
  echo "❌ ERROR: $LINES_ADDED líneas añadidas. Máximo: $MAX_LINES."
  ERRORS=$((ERRORS + 1))
fi

# --- 3. Dependencias nuevas ---
# El check anterior solo detectaba la CLAVE "dependencies" siendo añadida.
# Este detecta cualquier línea nueva DENTRO de dependencies/devDependencies,
# que es el caso real: un paquete más en un bloque que ya existía.
if git diff "$DIFF_BASE" -- package.json 2>/dev/null | \
   awk '
     /^\+\+\+/ {next}
     /"(dependencies|devDependencies)"[[:space:]]*:/ {in_block=1; next}
     in_block && /^\+/ && /"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"/ {found=1}
     in_block && /^[^+-]*}/ {in_block=0}
     END {exit !found}
   '; then
  if ! git diff "$DIFF_BASE" -- package.json 2>/dev/null | grep -q '// ALLOWED'; then
    echo "❌ ERROR: Nueva(s) dependencia(s) detectada(s) en package.json sin marcar // ALLOWED."
    echo "   Pasa por /gear-up o @depcheck antes de continuar."
    ERRORS=$((ERRORS + 1))
  fi
fi

# --- 4. Secretos hardcodeados ---
# Igual que 1/2 (archivos/líneas): git diff es ciego a archivos nunca trackeados. Un secreto real
# en un archivo nuevo pasaría inadvertido si solo se mira el diff de lo ya trackeado -- a
# diferencia del límite de archivos/líneas, aquí NO se excluye bookkeeping (journal.md/ledger.md/
# TSK-*.md): un secreto pegado ahí también debe bloquear.
SECRET_PATTERN='(api[_-]?key|password|secret|token)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{8,}'
TRACKED_SECRET_HIT=$(git diff "$DIFF_BASE" 2>/dev/null | grep -E '^\+' | grep -Eio "$SECRET_PATTERN") || true
UNTRACKED_ALL_FILES=$(git ls-files --others --exclude-standard 2>/dev/null) || true
UNTRACKED_SECRET_FILES=""
if [ -n "$UNTRACKED_ALL_FILES" ]; then
  UNTRACKED_SECRET_FILES=$(printf '%s\n' "$UNTRACKED_ALL_FILES" | xargs -r grep -ilE "$SECRET_PATTERN" 2>/dev/null) || true
fi

if [ -n "$TRACKED_SECRET_HIT" ] || [ -n "$UNTRACKED_SECRET_FILES" ]; then
  echo "❌ ERROR: Posibles secretos hardcodeados en el diff."
  [ -n "$UNTRACKED_SECRET_FILES" ] && printf '%s\n' "$UNTRACKED_SECRET_FILES" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

# --- 5. WIP = 1 POR HERRAMIENTA (no global) — permite paralelismo real entre claude-code/codex/kiro-nativo/hermes-vps ---
# Tanto el primer grep (sin tickets en 'doing') como el segundo (ninguno de ese tool_val) pueden
# legítimamente no encontrar nada y salir con status 1 — bajo `set -euo pipefail` cualquiera de
# los dos aborta el script entero en silencio. `|| true` sobre la asignación completa (no solo
# sobre un comando suelto del pipe) neutraliza esto sin importar cuál de los greps fue el que no
# encontró coincidencias; `${DOING_COUNT:-0}` cubre el caso borde de que la sustitución quede vacía.
for tool_val in claude-code codex kiro-nativo hermes-vps; do
  DOING_COUNT=$(grep -rl "^state: doing" docs/agents/tasks/ 2>/dev/null | xargs -r grep -l "^assigned_tool: $tool_val" 2>/dev/null | wc -l | tr -d ' ') || true
  DOING_COUNT=${DOING_COUNT:-0}
  if [ "$DOING_COUNT" -gt 1 ]; then
    echo "❌ ERROR: $DOING_COUNT tareas en 'doing' asignadas a '$tool_val'. Máximo permitido: 1 por herramienta (regla WIP=1 por ejecutor)."
    ERRORS=$((ERRORS + 1))
  fi
done

# --- 6. journal*.md (incluidas particiones mensuales archivadas) y ledger.md deben ser append-only ---
for f in docs/agents/journal*.md docs/agents/ledger.md; do
  if [ -f "$f" ] && git diff "$DIFF_BASE" -- "$f" 2>/dev/null | grep -qE '^-[^-]'; then
    echo "❌ ERROR: $f tiene líneas eliminadas. Es append-only — nunca se reescribe."
    ERRORS=$((ERRORS + 1))
  fi
done

# --- Resultado ---
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Verificación de simplicidad superada."
  exit 0
else
  echo "🔥 $ERRORS violación(es). Corrige antes de continuar."
  exit 1
fi
