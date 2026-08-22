#!/bin/bash
set -euo pipefail

ERRORS=0
MAX_FILES=3
MAX_LINES=200   # Fuente única del límite. CLAUDE.md y las skills deben referenciar esta constante, no repetirla.

echo "🦴 Verificando simplicidad..."

# --- Sincronización de contexto (informativo, nunca bloquea el gate) ---
# scripts/sync-context.ts avisa si AGENTS.md/.kiro/steering/ quedaron atrás del stack real, o si
# plan.md/MEMORY.md quedaron atrás del estado real de los tickets -- es mantenimiento de contexto,
# no un gate de seguridad/correctitud, así que nunca suma a $ERRORS ni aborta el script.
if command -v bun >/dev/null 2>&1 && [ -f scripts/sync-context.ts ]; then
  bun scripts/sync-context.ts || true
  echo ""
fi

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
# Mide lo que este commit va a contener realmente: `--cached` compara el índice (stage) contra
# $DIFF_BASE, no el árbol de trabajo completo. Antes usaba `git diff "$DIFF_BASE"` (ciego al
# stage, cuenta TODO lo no comiteado) más un escaneo aparte de `git ls-files --others` para
# archivos nunca trackeados -- eso rompía cualquier intento de dividir un backlog grande en varios
# commits lógicos: el gate seguía viendo el resto del árbol pendiente aunque solo un subconjunto
# estuviera en stage para ese commit puntual. Con `--cached`, un archivo nuevo cuenta en cuanto
# pasa por `git add` (entra al índice) y dejaba de listarse en `--others` de todas formas, así que
# el escaneo de untracked ya no hace falta -- lo que nunca se stagea nunca se comitea.
ALL_FILES=$(git diff --cached --name-only "$DIFF_BASE" 2>/dev/null | grep -Ev "$BOOKKEEPING_PATTERN") || true

FILES_TOUCHED=$(printf '%s\n' "$ALL_FILES" | grep -c '.') || true
FILES_TOUCHED=${FILES_TOUCHED:-0}
LINES_ADDED=$(git diff --cached --numstat "$DIFF_BASE" 2>/dev/null | awk -v pat="$BOOKKEEPING_PATTERN" '$3 !~ pat {sum += $1} END {print sum+0}')

# --- Excepción documentada de simplicidad ---
# CLAUDE.md permite declarar por adelantado, dentro del propio ticket, que su alcance real supera
# 3 archivos/200 líneas (ya usado en prosa en TSK-012/013/016 -- "excepción documentada por
# adelantado"). Antes esto solo existía como confianza/nota en el ticket, sin que el gate pudiera
# reconocerlo -- era todo o nada. `pretooluse-guard.sh` extrae un `TSK-XXX` del mensaje del commit
# (si hay) en `$COMMIT_TICKET`; si ese ticket existe y su frontmatter ya trae
# `simplicity_exception: true` ANTES de este commit, el exceso se avisa pero no bloquea.
SIMPLICITY_EXCEPTION=0
TICKET_FILE="docs/agents/tasks/${COMMIT_TICKET:-}.md"
if [ -n "${COMMIT_TICKET:-}" ] && [ -f "$TICKET_FILE" ] && grep -qE '^simplicity_exception:[[:space:]]*true[[:space:]]*$' "$TICKET_FILE"; then
  SIMPLICITY_EXCEPTION=1
fi

if [ "$FILES_TOUCHED" -gt "$MAX_FILES" ]; then
  if [ "$SIMPLICITY_EXCEPTION" -eq 1 ]; then
    echo "⚠️  $FILES_TOUCHED archivos modificados (máximo $MAX_FILES) -- excepción declarada en $TICKET_FILE, no bloquea."
    printf '%s\n' "$ALL_FILES" | sed 's/^/   - /'
  else
    echo "❌ ERROR: $FILES_TOUCHED archivos modificados. Máximo: $MAX_FILES."
    printf '%s\n' "$ALL_FILES" | sed 's/^/   - /'
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ "$LINES_ADDED" -gt "$MAX_LINES" ]; then
  if [ "$SIMPLICITY_EXCEPTION" -eq 1 ]; then
    echo "⚠️  $LINES_ADDED líneas añadidas (máximo $MAX_LINES) -- excepción declarada en $TICKET_FILE, no bloquea."
  else
    echo "❌ ERROR: $LINES_ADDED líneas añadidas. Máximo: $MAX_LINES."
    ERRORS=$((ERRORS + 1))
  fi
fi

# --- 3. Dependencias nuevas ---
# El check anterior solo detectaba la CLAVE "dependencies" siendo añadida.
# Este detecta cualquier línea nueva DENTRO de dependencies/devDependencies,
# que es el caso real: un paquete más en un bloque que ya existía.
# Monorepo: no hay package.json en la raíz del repo -- cada app tiene el suyo
# (apps/*/package.json). El check original apuntaba a la raíz y por eso nunca se disparó
# para ninguna dependencia añadida desde que existe el monorepo (TSK-001 en adelante).
PACKAGE_JSON_FILES=$(git ls-files -- '*/package.json' 'package.json' 2>/dev/null | grep -v node_modules) || true
for pkg in $PACKAGE_JSON_FILES; do
  if git diff --cached "$DIFF_BASE" -- "$pkg" 2>/dev/null | \
     awk '
       /^\+\+\+/ {next}
       /"(dependencies|devDependencies)"[[:space:]]*:/ {in_block=1; next}
       in_block && /^\+/ && /"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"/ {found=1}
       in_block && /^[^+-]*}/ {in_block=0}
       END {exit !found}
     '; then
    if ! git diff --cached "$DIFF_BASE" -- "$pkg" 2>/dev/null | grep -q '// ALLOWED'; then
      echo "❌ ERROR: Nueva(s) dependencia(s) detectada(s) en $pkg sin marcar // ALLOWED."
      echo "   Pasa por /gear-up o @depcheck antes de continuar."
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

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

# --- 7. Invariantes de arquitectura (hallazgo de auditoría 2026-08-22, ver CLAUDE.md/security.md) ---
# A diferencia de 1-4 (que gatean el diff de este commit), estos tres son invariantes absolutos
# del árbol completo -- no negociables por diseño, ninguno admite `simplicity_exception`. Se
# escanean sobre archivos TRACKEADOS actuales (git ls-files), no solo el diff de este commit,
# porque una violación ya presente (introducida antes de que este check existiera) también debe
# bloquear, no solo una nueva.

BIND_HIT=$(git ls-files -- 'apps/engine/src/*' 2>/dev/null | xargs -r grep -lF '0.0.0.0' 2>/dev/null) || true
if [ -n "$BIND_HIT" ]; then
  echo "❌ ERROR: '0.0.0.0' encontrado bajo apps/engine/src/ -- el motor solo puede atarse a 127.0.0.1."
  printf '%s\n' "$BIND_HIT" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

FETCH_HIT=$(git ls-files -- 'apps/engine/src/signals/*' 2>/dev/null | xargs -r grep -lF 'fetch(' 2>/dev/null) || true
if [ -n "$FETCH_HIT" ]; then
  echo "❌ ERROR: 'fetch(' encontrado bajo apps/engine/src/signals/ -- cero red en el camino caliente, ningún SignalScorer llama a la red."
  printf '%s\n' "$FETCH_HIT" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

DSIH_HIT=$(git ls-files -- 'apps/web/*' 2>/dev/null | xargs -r grep -lF 'dangerouslySetInnerHTML' 2>/dev/null) || true
if [ -n "$DSIH_HIT" ]; then
  echo "❌ ERROR: 'dangerouslySetInnerHTML' encontrado bajo apps/web/ -- prohibido en toda la app, React escapa por defecto."
  printf '%s\n' "$DSIH_HIT" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

# --- Resultado ---
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Verificación de simplicidad superada."
  exit 0
else
  echo "🔥 $ERRORS violación(es). Corrige antes de continuar."
  exit 1
fi
