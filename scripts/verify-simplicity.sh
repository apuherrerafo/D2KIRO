#!/bin/bash
set -euo pipefail

ERRORS=0

echo "🦴 Verificando reglas del proyecto..."

# --- Sincronización de contexto (informativo, nunca bloquea el gate) ---
# scripts/sync-context.ts avisa si AGENTS.md/.kiro/steering/ quedaron atrás del stack real, o si
# plan.md/MEMORY.md quedaron atrás del estado real de los tickets -- es mantenimiento de contexto,
# no un gate de seguridad/correctitud, así que nunca suma a $ERRORS ni aborta el script.
if command -v bun >/dev/null 2>&1 && [ -f scripts/sync-context.ts ]; then
  bun scripts/sync-context.ts || true
  echo ""
fi

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

# --- 6. Compilación/tipos + suite de tests -- solo en el camino de commit ---
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

    # Gobernanza 2.0 (evt-111 -> evt-112): scripts/ (fetch-daily-pro-drafts.ts y su .test.ts) no
    # es un workspace con su propio package.json como apps/engine/apps/web -- usa el package.json
    # de la raíz, así que el guard de arriba (`-f .../package.json`) no aplica igual. `-d scripts`
    # es el equivalente real: existe siempre en este repo, y `bun test` corrido desde ahí ya
    # resuelve los imports relativos a apps/engine/src sin problema (verificado antes de este
    # cambio). Antes de esto, los 9 tests de fetch-daily-pro-drafts.test.ts pasaban solo si
    # alguien los corría a mano -- el gate automatizado nunca los tocaba.
    if [ -d scripts ]; then
      if ! (cd scripts && "$BUN_BIN" test); then
        echo "❌ ERROR: suite de tests de scripts/ falló (bun test)."
        ERRORS=$((ERRORS + 1))
      fi
    fi

    # TSK-212 (Fase 9.1, SPEC.md §16.10): gate de calidad del motor. Corre el backtest completo y
    # lo compara --enforce contra el v6-measured.json de REFERENCIA (congelado + validado, nunca se
    # sobrescribe acá -- la corrida actual va a un temporal). Falla el commit si un cambio degrada
    # NDCG@5 / Bad Pick Rate@5 más que la tolerancia de null-perturbation. Sólo en el camino de
    # commit: el backtest tarda demasiado para el hot path (mismo criterio que tsc+bun test).
    # Se omite -- sin fallar -- si falta alguna SQLite o el baseline (ej. checkout de CI sin datos).
    EVAL_ENGINE_DB="${ENGINE_DB_PATH:-apps/engine/data/dota2coach.sqlite}"
    EVAL_PRO_DB="${D2K_PRO_DB:-apps/engine/data/pro-drafts.sqlite}"
    if [ -f "$EVAL_ENGINE_DB" ] && [ -f "$EVAL_PRO_DB" ] && [ -f eval/baselines/v6-measured.json ]; then
      EVAL_TMP_DIR="$(mktemp -d)"
      if D2K_BASELINE_OUT="$EVAL_TMP_DIR/v6-current.json" D2K_REPORTS_DIR="$EVAL_TMP_DIR/reports" "$BUN_BIN" run scripts/eval/run.ts \
        && D2K_BASELINE_OUT=eval/baselines/v6-measured.json D2K_GATE_CURRENT="$EVAL_TMP_DIR/v6-current.json" "$BUN_BIN" run scripts/eval/gate.ts --enforce; then
        :
      else
        echo "❌ ERROR: gate de evaluación del motor falló (bun run eval + gate.ts --enforce)."
        ERRORS=$((ERRORS + 1))
      fi
      rm -rf "$EVAL_TMP_DIR"
    else
      echo "⚠️  gate de evaluación (§16.10) omitido: falta una SQLite del motor o el baseline de referencia."
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
