#!/bin/bash
set -euo pipefail

ERRORS=0
MAX_FILES=3
MAX_LINES=200        # Producción. Fuente única del límite. CLAUDE.md y las skills deben referenciar esta constante, no repetirla.
MAX_TEST_LINES=350   # Test/spec (.test.ts/.spec.ts/.test.tsx/.spec.tsx) -- presupuesto propio, no el de producción.
                      # Fixtures y mocks estáticos (p.ej. DraftState) cuestan más líneas por diseño; mezclarlos con el
                      # límite de producción castigaba el rigor de testing. Sigue siendo un límite real: si se supera,
                      # sigue pasando por la misma excepción declarada de abajo -- nunca deja de preguntar en silencio
                      # (ver journal.md TSK-067: una sesión de Kiro ya reescribió esta regla para dejar de preguntar
                      # por adelantado y se revirtió como hallazgo real, no cosmético).

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

# Producción vs. test: mismo diff --cached, partido por nombre de archivo. Un .test.ts que además
# cambiara una firma de producción seguiría siendo detectado como violación aparte si esa firma
# vive en su propio archivo .ts -- este split nunca decide qué es "producción" por contenido, solo
# por convención de nombre (igual de estricto que el resto del script).
TEST_FILE_PATTERN='[.](test|spec)[.]tsx?$'
PROD_LINES_ADDED=$(git diff --cached --numstat "$DIFF_BASE" 2>/dev/null | awk -v pat="$BOOKKEEPING_PATTERN" -v tpat="$TEST_FILE_PATTERN" '$3 !~ pat && $3 !~ tpat {sum += $1} END {print sum+0}')
TEST_LINES_ADDED=$(git diff --cached --numstat "$DIFF_BASE" 2>/dev/null | awk -v pat="$BOOKKEEPING_PATTERN" -v tpat="$TEST_FILE_PATTERN" '$3 !~ pat && $3 ~ tpat {sum += $1} END {print sum+0}')

# --- Governance 2.0 (2026-08-24): límites de archivos/líneas dejan de bloquear ---
# TSK-067 ya había intentado exactamente esto (bajar estos tres checks de bloqueo a aviso) y se
# revirtió como hallazgo real -- no cosmético (ver comentario de MAX_TEST_LINES arriba). Esta vez
# es una decisión explícita del usuario, confirmada por pregunta directa antes de tocar el
# archivo, no un cambio silencioso de otra herramienta -- documentada en journal.md (TSK-092).
# Los tres siguen siendo señal real ("¿es este commit atómico?"), pero ya no bloquean: lo que
# sigue como bloqueo duro sin excepción posible es seguridad/arquitectura (secretos, invariantes,
# WIP, journal append-only, tipos, tests) -- ver secciones de abajo.
if [ "$FILES_TOUCHED" -gt "$MAX_FILES" ]; then
  echo "⚠️  Commit grande: $FILES_TOUCHED archivos modificados (máximo sugerido $MAX_FILES). Verifica si es atómico."
  printf '%s\n' "$ALL_FILES" | sed 's/^/   - /'
fi

if [ "$PROD_LINES_ADDED" -gt "$MAX_LINES" ]; then
  echo "⚠️  Commit grande: $PROD_LINES_ADDED líneas de producción añadidas (máximo sugerido $MAX_LINES). Verifica si es atómico."
fi

if [ "$TEST_LINES_ADDED" -gt "$MAX_TEST_LINES" ]; then
  echo "⚠️  Commit grande: $TEST_LINES_ADDED líneas de test añadidas (máximo sugerido $MAX_TEST_LINES). Verifica si es atómico."
fi

# --- 3. Dependencias nuevas de PRODUCCIÓN ("dependencies") ---
# Governance 2.0 (2026-08-24): devDependencies queda con bypass total (tooling de infraestructura
# rutinaria del stack Bun -- typescript, better-sqlite3, etc. -- no exige /gear-up/@depcheck ni
# marca // ALLOWED). Solo dependencies de producción sigue exigiendo la ceremonia -- es lo que
# termina en el bundle/runtime real, no una herramienta de desarrollo. El awk distingue la clave
# exacta que abrió el bloque (`is_prod`) en vez de tratar ambas claves igual.
# Monorepo: no hay package.json único en la raíz del repo -- cada app tiene el suyo
# (apps/*/package.json), más el root nuevo (better-sqlite3/scripts del pipeline pro-drafter).
PACKAGE_JSON_FILES=$(git ls-files -- '*/package.json' 'package.json' 2>/dev/null | grep -v node_modules) || true
for pkg in $PACKAGE_JSON_FILES; do
  if git diff --cached "$DIFF_BASE" -- "$pkg" 2>/dev/null | \
     awk '
       /^\+\+\+/ {next}
       /"devDependencies"[[:space:]]*:/ {in_block=1; is_prod=0; next}
       /"dependencies"[[:space:]]*:/ {in_block=1; is_prod=1; next}
       in_block && is_prod && /^\+/ && /"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"/ {found=1}
       in_block && /^[^+-]*}/ {in_block=0}
       END {exit !found}
     '; then
    if ! git diff --cached "$DIFF_BASE" -- "$pkg" 2>/dev/null | grep -q '// ALLOWED'; then
      echo "❌ ERROR: Nueva(s) dependencia(s) de PRODUCCIÓN detectada(s) en $pkg sin marcar // ALLOWED."
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

# --- 8. Governance 2.0: compilación/tipos + suite de tests -- solo en el camino de commit ---
# Corre únicamente cuando VERIFY_COMMIT_GATE=1 (fijado por pretooluse-guard.sh en git commit/
# push). Los hooks PostToolUse/SubagentStop de .claude/settings.json llaman a este mismo script en
# caliente después de cada Edit/Write -- correr tsc+bun test completos ahí sería demasiado lento
# para ese camino y no aporta nada que el commit gate no vaya a repetir de todas formas. Sin
# excepción de ticket posible: a diferencia de 1-2, esto nunca se avisa y se deja pasar.
if [ "${VERIFY_COMMIT_GATE:-0}" = "1" ]; then
  echo ""
  echo "🔎 Gate de commit: compilación/tipos + suite de tests (hard gate, sin excepción)"

  # Resolución agnóstica al entorno: el binario real de bun no siempre está en $PATH en el
  # contexto en que corre este hook (confirmado en esta máquina -- `bun` no resuelve pero
  # `bunx`, symlink a ~/.bun/bin/bun, sí). BUN_BIN siempre termina apuntando al binario real de
  # `bun` (nunca al wrapper `bunx`, que ya implica modo "x" y no sirve para `bun test`) -- se
  # prueba `bun` en PATH, la ruta estándar de instalación, y resolver el symlink de `bunx` como
  # último recurso. Sin esto, el gate fallaría por "command not found" en vez de por una razón
  # real, exactamente el tipo de fragilidad entre entornos que se pidió evitar.
  BUN_BIN=""
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
  elif [ -x "$HOME/.bun/bin/bun" ]; then
    BUN_BIN="$HOME/.bun/bin/bun"
  elif command -v bunx >/dev/null 2>&1; then
    BUNX_RESOLVED=$(readlink "$(command -v bunx)" 2>/dev/null) || true
    if [ -n "$BUNX_RESOLVED" ] && [ -x "$BUNX_RESOLVED" ]; then
      BUN_BIN="$BUNX_RESOLVED"
    fi
  fi

  if [ -z "$BUN_BIN" ]; then
    echo "❌ ERROR: no se encontró el binario de bun (ni 'bun' ni 'bunx' en PATH, ni ~/.bun/bin/bun)."
    ERRORS=$((ERRORS + 1))
  else
    if [ -f apps/engine/tsconfig.json ]; then
      if ! (cd apps/engine && "$BUN_BIN" x tsc --noEmit -p tsconfig.json); then
        echo "❌ ERROR: apps/engine no compila (tsc --noEmit)."
        ERRORS=$((ERRORS + 1))
      fi
    fi

    if [ -f apps/web/tsconfig.json ]; then
      if ! (cd apps/web && "$BUN_BIN" x tsc --noEmit -p tsconfig.json); then
        echo "❌ ERROR: apps/web no compila (tsc --noEmit)."
        ERRORS=$((ERRORS + 1))
      fi
    fi

    if [ -f apps/engine/package.json ]; then
      if ! (cd apps/engine && "$BUN_BIN" test); then
        echo "❌ ERROR: suite de tests de apps/engine falló (bun test)."
        ERRORS=$((ERRORS + 1))
      fi
    fi

    if [ -f apps/web/package.json ]; then
      if ! (cd apps/web && "$BUN_BIN" test); then
        echo "❌ ERROR: suite de tests de apps/web falló (bun test)."
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
fi

# --- Resultado ---
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Verificación de simplicidad superada."
  exit 0
else
  echo "🔥 $ERRORS violación(es). Corrige antes de continuar."
  exit 1
fi
