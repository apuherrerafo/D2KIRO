#!/bin/bash
set -euo pipefail

SETUP_VERSION="1.1.0"
VERSION_FILE=".setup-version"

echo "🦴 Instalando ecosistema Caveman v${SETUP_VERSION}..."

# --- 0. Idempotencia: detectar instalación previa ---
if [ -f "$VERSION_FILE" ]; then
  INSTALLED=$(cat "$VERSION_FILE")
  if [ "$INSTALLED" = "$SETUP_VERSION" ]; then
    echo "ℹ️  Ya está instalada la versión $SETUP_VERSION. Nada que hacer."
    exit 0
  fi
  echo "⬆️  Actualizando de v${INSTALLED} a v${SETUP_VERSION}."
  read -p "¿Sobrescribir CLAUDE.md, .claude/ y docs/agents/*.md de plantilla? [y/N] " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Instalación cancelada. Los archivos existentes no se tocaron."
    exit 0
  fi
fi

# --- 1. Detectar entorno(s) presentes (pueden ser varios a la vez) ---
ENVS=()
[ -d ".kiro" ] && ENVS+=("kiro")
[ -d ".cursor" ] && ENVS+=("cursor")
command -v claude &> /dev/null && ENVS+=("claude-code")
[ ${#ENVS[@]} -eq 0 ] && ENVS+=("claude-code")  # default: siempre generamos .claude/

echo "✅ Entorno(s) detectado(s): ${ENVS[*]}"

# --- 2. Git ---
if [ ! -d ".git" ]; then
  git init -q
  echo "✅ Repositorio Git inicializado."
fi

# --- 3. Estructura base (no destructiva si ya existe contenido de usuario) ---
mkdir -p docs/agents/tasks docs/specs docs/guides .claude/agents .claude/skills

touch docs/agents/journal.md docs/agents/ledger.md
[ -f docs/agents/MEMORY.md ] || echo "# MEMORIA DEL PROYECTO" > docs/agents/MEMORY.md
[ -f docs/agents/USER.md ] || echo "# PERFIL DEL DISEÑADOR" > docs/agents/USER.md

# --- 3.5. AGENTS.md — espejo portable, pero no universal: Kiro lo lee nativo, Claude Code parcial (retrocompat), Codex necesita config explícita ---
if [ -f "CLAUDE.md" ] && [ ! -f "AGENTS.md" ]; then
  cp CLAUDE.md AGENTS.md
  echo "✅ Generado AGENTS.md — Kiro lo lee automático. Claude Code lo reconoce parcialmente (su formato nativo es .claude/). Si usas Codex CLI, puede necesitar que lo referencies explícitamente en tu configuración."
fi

# --- 4. Generar configuración específica por IDE a partir de la misma fuente ---
# .claude/ ya viene con el paquete y es la fuente canónica de skills/agentes.

for env in "${ENVS[@]}"; do
  case "$env" in
    cursor)
      mkdir -p .cursor/rules
      cat > .cursor/rules/caveman.mdc <<'EOF'
---
description: Reglas del ecosistema Caveman (espejo de CLAUDE.md)
alwaysApply: true
---
Ver CLAUDE.md en la raíz del proyecto para el contrato completo.
Reglas clave: máx. 3 archivos por tarea, máx. 200 líneas nuevas, sin dependencias sin autorización.
EOF
      echo "✅ Generado .cursor/rules/caveman.mdc"
      ;;
    kiro)
      mkdir -p .kiro/steering .kiro/hooks
      for f in product structure tech; do
        [ -f ".kiro/steering/$f.md" ] || echo "# $f — ver CLAUDE.md como fuente canónica" > ".kiro/steering/$f.md"
      done
      echo "✅ Generado .kiro/steering/{product,structure,tech}.md"
      # Hook opcional: dos investigaciones independientes coinciden en que exit code 2
      # bloquea en PreToolUse — pero una de las fuentes citadas es inusual (docs.rs para
      # una feature de Kiro), así que verifica en tu propia instalación antes de confiar del todo.
      if [ ! -f ".kiro/hooks/verify-simplicity.md" ]; then
        cat > .kiro/hooks/verify-simplicity.md <<'HOOKEOF'
# Hook sugerido — exit code 2 debería bloquear en PreToolUse (verificado en dos fuentes,
# una de ellas inusual — confírmalo en tu versión antes de confiar del todo)
Trigger: al guardar archivo / antes de acción crítica
Comando: bash scripts/verify-simplicity.sh
Nota: el script actual devuelve exit 1 en fallo, no 2. Si tu Kiro exige exactamente 2
para bloquear, cambia el "exit 1" final de verify-simplicity.sh por "exit 2".
HOOKEOF
        echo "ℹ️  Sugerido .kiro/hooks/verify-simplicity.md — verificado en dos fuentes independientes, con un matiz de confianza en una de ellas."
      fi
      ;;
    claude-code)
      echo "✅ .claude/ ya presente (nativo)."
      ;;
  esac
done

# --- 5. Permisos ---
chmod +x scripts/verify-simplicity.sh 2>/dev/null || true
chmod +x scripts/hub.ts 2>/dev/null || true

# --- 6. Marcar versión instalada ---
echo "$SETUP_VERSION" > "$VERSION_FILE"

echo ""
echo "🎉 ¡Setup v${SETUP_VERSION} completado!"
echo ""
echo "Para empezar, escribe: /launchpad"
echo ""
echo "📁 Archivos gestionados:"
echo "   - CLAUDE.md (contrato del proyecto)"
echo "   - .claude/agents/ (4 sub-agentes)"
echo "   - .claude/skills/ (skills)"
echo "   - docs/agents/journal.md (fuente de verdad, append-only)"
echo "   - $VERSION_FILE (control de versión del ecosistema)"
