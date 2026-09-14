#!/bin/bash
set -euo pipefail

ERRORS=0

echo "🦴 Verificando reglas del proyecto..."

# --- Toolchain: pin canónico de Bun (fail-fast, ANTES de correr cualquier código con Bun) ---
# R0/Task 31 (TOOLCHAIN_VERSION_DRIFT): la ÚNICA fuente manual de la versión de Bun es
# `package.json#packageManager` en la raíz, en formato cerrado `bun@<semver exacto>`. LOCAL, CI y
# Docker consumen ese mismo valor; acá se verifica que el binario `bun` que va a interpretar el
# resto del gate coincide EXACTAMENTE con ese pin. Sin red, sin escrituras, determinista. Falla
# cerrado ante ausencia, formato no exacto o mismatch -- no se avisa y se deja pasar.
PM_RAW=$(grep -E '"packageManager"[[:space:]]*:' package.json 2>/dev/null | head -n1) || true
EXPECTED_PM=$(printf '%s\n' "$PM_RAW" | sed -E 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
if ! printf '%s' "$EXPECTED_PM" | grep -qE '^bun@[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "❌ ERROR: package.json#packageManager ausente o no es 'bun@<semver exacto>' (valor leído: '${EXPECTED_PM:-<ausente>}')."
  exit 1
fi
EXPECTED_BUN_VERSION="${EXPECTED_PM#bun@}"

# Resolución del binario real de bun SIN red: `bun` en PATH, la ruta de instalación estándar, o
# el symlink de `bunx` como último recurso -- Windows/Git Bash confirmado con `bun` fuera de PATH
# pero `bunx` resolviendo por symlink a ~/.bun/bin/bun.
GUARD_BUN_BIN=""
if command -v bun >/dev/null 2>&1; then
  GUARD_BUN_BIN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  GUARD_BUN_BIN="$HOME/.bun/bin/bun"
elif command -v bunx >/dev/null 2>&1; then
  GUARD_BUNX_RESOLVED=$(readlink "$(command -v bunx)" 2>/dev/null) || true
  if [ -n "$GUARD_BUNX_RESOLVED" ] && [ -x "$GUARD_BUNX_RESOLVED" ]; then
    GUARD_BUN_BIN="$GUARD_BUNX_RESOLVED"
  fi
fi
if [ -z "$GUARD_BUN_BIN" ]; then
  echo "❌ ERROR: no se encontró el binario de bun para validar el pin de toolchain (package.json fija bun@${EXPECTED_BUN_VERSION})."
  exit 1
fi

ACTUAL_BUN_VERSION="$("$GUARD_BUN_BIN" --version 2>/dev/null | tr -d '[:space:]')" || true
if [ "$ACTUAL_BUN_VERSION" != "$EXPECTED_BUN_VERSION" ]; then
  echo "❌ ERROR: Bun toolchain drift -- package.json fija bun@${EXPECTED_BUN_VERSION} pero 'bun --version' dice '${ACTUAL_BUN_VERSION:-<desconocido>}'."
  echo "   Instalá la versión exacta antes de continuar: https://bun.sh/docs/installation#installing-older-versions"
  exit 1
fi
echo "🔒 Toolchain Bun OK: ${ACTUAL_BUN_VERSION} == package.json#packageManager (bun@${EXPECTED_BUN_VERSION})"

# --- Sincronización de contexto: acción EXPLÍCITA, ya no colateral de este gate ---
# R0.4/Task 27 (design.md §4.4 "Filosofía de hooks"): el nivel AFTER EDIT (este script, corrido
# desde PostToolUse/SubagentStop en .claude/settings.json) es escaneo estático barato y NO debe
# tener efectos secundarios -- regenerar docs/agents/hub.html en cada Edit/Write es exactamente el
# efecto secundario que el diseño pide eliminar de este nivel. `scripts/sync-context.ts` sigue
# existiendo tal cual y se invoca a mano cuando hace falta (`bun scripts/sync-context.ts`); este
# gate ya no lo llama por su cuenta.

# --- 0. Base de comparación adaptativa (local vs. CI) ---
# Repo sin ningún commit todavía (bootstrap): `git diff ... HEAD` no existe y aborta con
# set -e (exit 128). Se usa el árbol vacío de Git como base en ese caso — mismo resultado
# práctico (todo lo trackeado cuenta como "añadido"), sin depender de que exista HEAD.
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"

# Local (sesiones de Claude Code vía hooks PostToolUse/SubagentStop, o invocación manual): el
# gate siempre miró el diff sin commitear contra HEAD -- eso NO cambia acá. Cambiarlo a
# origin/master rompería el uso real que ya tiene (revisar cambios en curso antes de commitear),
# documentado en CLAUDE.md y usado en cada sesión de esta fase.
#
# CI (GITHUB_ACTIONS=true): un checkout de Actions no tiene diff sin commitear -- `git diff HEAD`
# siempre daría vacío y el gate pasaría en falso sin revisar nada del PR. Ahí la base correcta es
# el merge-base con la rama destino (GITHUB_BASE_REF, solo presente en eventos pull_request) o,
# en un push directo a la rama por defecto, el commit anterior (HEAD~1).
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    # fetch-depth:100 (ver .github/workflows/ci.yml) alcanza para un PR normal; si la rama base
    # se movió más de 100 commits desde que se abrió el PR, el fetch dirigido de abajo lo resuelve
    # igual sin depender de que ya esté en el checkout superficial.
    git fetch --no-tags --depth=100 origin "$GITHUB_BASE_REF" >/dev/null 2>&1 || true
    if git rev-parse --verify -q "origin/$GITHUB_BASE_REF" >/dev/null \
       && MERGE_BASE=$(git merge-base "origin/$GITHUB_BASE_REF" HEAD 2>/dev/null); then
      DIFF_BASE="$MERGE_BASE"
    elif git rev-parse --verify -q "HEAD~1" >/dev/null; then
      # El fetch dirigido falló (rama base inalcanzable, red caída) -- HEAD~1 es peor que un
      # merge-base real pero mejor que dejar pasar el gate en falso.
      DIFF_BASE="HEAD~1"
    else
      DIFF_BASE="$EMPTY_TREE"
    fi
  elif git rev-parse --verify -q "HEAD~1" >/dev/null; then
    DIFF_BASE="HEAD~1"
  else
    DIFF_BASE="$EMPTY_TREE"
  fi
elif git rev-parse --verify -q HEAD >/dev/null; then
  DIFF_BASE="HEAD"
else
  DIFF_BASE="$EMPTY_TREE"
fi

# --- 1. Dependencias nuevas de PRODUCCIÓN ("dependencies") ---
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

# --- 2. Secretos hardcodeados ---
# Git diff es ciego a archivos nunca trackeados. Un secreto real
# en un archivo nuevo pasaría inadvertido si solo se mira el diff de lo ya trackeado -- a
# aquí también debe bloquear aunque esté en documentación o un ticket.
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

# --- 3. WIP = 1 POR HERRAMIENTA (no global) — permite paralelismo real entre claude-code/codex/kiro-nativo/hermes-vps ---
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

# --- 4. journal*.md (incluidas particiones mensuales archivadas) y ledger.md deben ser append-only ---
for f in docs/agents/journal*.md docs/agents/ledger.md; do
  if [ -f "$f" ] && git diff "$DIFF_BASE" -- "$f" 2>/dev/null | grep -qE '^-[^-]'; then
    echo "❌ ERROR: $f tiene líneas eliminadas. Es append-only — nunca se reescribe."
    ERRORS=$((ERRORS + 1))
  fi
done

# --- 5. Invariantes de arquitectura (hallazgo de auditoría 2026-08-22, ver CLAUDE.md/security.md) ---
# A diferencia de los controles del diff, estos tres son invariantes absolutos
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

# TSK-214: código de apps/web que corre en el NAVEGADOR no puede apuntar a un loopback. El motor
# vive en 127.0.0.1 desde el punto de vista del SERVIDOR de Next, nunca del navegador del
# visitante -- en Railway ese loopback no existe y la llamada falla en silencio. Bug real: los
# eventos del simulador, el pick del bot y todos los reportes del DraftFeedbackBox se perdieron
# durante semanas por esto. `next.config.ts` y `app/healthz/` quedan fuera: corren en el servidor.
# Un default guardado por `process.env` en la misma línea sí se admite: es el escape para el WS,
# que Next rewrites no puede proxear y que en producción se fija con NEXT_PUBLIC_ENGINE_WS_URL.
LOOPBACK_HIT=$(git ls-files -- 'apps/web/features/*' 'apps/web/lib/*' 'apps/web/components/*' 2>/dev/null \
  | grep -v '\.test\.' \
  | xargs -r grep -nE '(127\.0\.0\.1|//localhost)' 2>/dev/null \
  | grep -v 'process\.env' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)') || true
if [ -n "$LOOPBACK_HIT" ]; then
  echo "❌ ERROR: literal de loopback (127.0.0.1 / localhost) bajo apps/web/{features,lib,components} -- ese código corre en el NAVEGADOR y debe ir por el proxy '/engine' (ENGINE_HTTP_BASE_URL)."
  echo "   Si es un default de desarrollo, guárdalo con 'process.env.<VAR> ?? ...' en la misma línea."
  printf '%s\n' "$LOOPBACK_HIT" | sed 's/^/   - /'
  ERRORS=$((ERRORS + 1))
fi

# --- 6. Compilación/tipos + suite de tests + eval pesado -- YA NO viven en este commit gate ---
# R0.4/Task 27 (design.md §3.2/§4.4, requisito 4.5 c3): `tsc` + las 3 suites completas + el
# backtest/`gate.ts --enforce` corrían acá bajo VERIFY_COMMIT_GATE=1 (fijado por
# scripts/hooks/pretooluse-guard.sh en git commit/push emitidos DENTRO de una sesión de Claude
# Code) -- cobertura parcial: un push desde otra terminal, IDE o cliente gráfico lo esquivaba por
# completo (docs/agents/r0-discovery/pre-push-gate.md). Ese trabajo pesado ahora vive en:
#   - PRE-PUSH real, local, para TODO `git push` sin importar el origen -- `.husky/pre-push`
#     (R0.1/Task 5, cableado vía `core.hooksPath` con `scripts/install-git-hooks.sh`): `bun run
#     test` + `tsc --noEmit` de apps/engine y apps/web.
#   - PR/CI -- job `test` de `.github/workflows/ci.yml` (matriz engine/web/root: tsc + lint + bun
#     test), en cada push/PR a `master`.
#   - INTELLIGENCE CI -- job `intelligence-ci` de `.github/workflows/ci.yml` (R0.2A/Task 10):
#     `bun run scripts/eval/gate.ts --enforce`, el eval pesado del motor.
# `VERIFY_COMMIT_GATE=1` queda sin efecto acá a propósito -- no se duplica lo ya cableado en 5/10.
# El commit dentro de una sesión de Claude Code sigue pagando las secciones 1-5 (baratas); el
# software correctness completo y el eval `--enforce` los exige el push real y CI, no este script.

# --- Resultado ---
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Verificación de simplicidad superada."
  exit 0
else
  echo "🔥 $ERRORS violación(es). Corrige antes de continuar."
  exit 1
fi
