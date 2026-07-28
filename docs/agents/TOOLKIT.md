# TOOLKIT — Inventario del entorno (regenerado por /launchpad)

## Entorno IDE real (confirmado por el usuario)
- **Editor**: Kiro IDE — es donde el usuario trabaja realmente sobre este repo.
- **Agente de código**: extensión Claude Code dentro de Kiro (soy yo, en este contexto).
- **Codex CLI**: disponible en terminal (`codex-cli` detectado en PATH en la sesión de arranque) — opción real para `assigned_tool: codex` en tareas acotadas y autocontenidas.
- Cursor (`.cursor/`): no está en uso.

Como Kiro es el editor real, `.kiro/steering/{product,structure,tech}.md` y
`.kiro/hooks/verify-simplicity.md` ya existen (generados en el arranque del proyecto), en espejo
con `CLAUDE.md`.

## Runtime y herramientas de desarrollo
| Herramienta | Estado | Nota |
|---|---|---|
| Git | ✅ | Repo activo, rama `master`. |
| Node.js | ✅ v22.22.3 | Disponible. |
| Bun | ✅ 1.3.14 | Instalado — ya no es un bloqueante (lo era al arranque del proyecto). Runtime real de `apps/engine`. |
| Codex CLI | ✅ | Disponible para tareas con `assigned_tool: codex`. |
| GitHub CLI (`gh`) | ⚠️ No instalado | Sigue faltando. Necesario solo si el flujo pasa a usar PRs vía `gh`. |
| Docker | No instalado | No requerido por el stack actual. |

## Ecosistema Caveman instalado
- `.claude/agents/`: warden, artisan, chronicle, tracer, sentinel.
- `.claude/skills/`: skills core (kickoff, pre-flight, blueprint, build, redteam, castoff, helm, dispatch, etc.)
- `.claude/commands/`: alias de comandos (`/start`, `/ship`, `/fix`, `/plan`, `/review`, etc.)
- `skills-extra/`: utilidades opcionales — no cargadas por defecto.
- `scripts/`: `install.sh`, `verify-simplicity.sh`, `hub.ts`, `analisis-arquitectura.sh`.

## Estado de memoria y tareas del proyecto (al regenerar este toolkit)
- `docs/agents/journal.md`, `ledger.md`, `MEMORY.md`: con historial completo — **fase 1 (TSK-001 a
  TSK-015) 100% completada**, camino verificado de punta a punta (captura → reductor → motor de
  sugerencias → servidor Bun → vista de draft en vivo + páginas del sitio).
- `docs/agents/USER.md`: vacío — pendiente de poblar con el perfil del diseñador de producto.
- `docs/agents/plan.md`: **desactualizado** — sigue mostrando el backlog de fase 1 como
  `backlog`/`ready` cuando en realidad todo está `done`. Regenerar con `/helm` antes de confiar en
  él para priorización.
- Ninguna tarea en estado `doing` — WIP=1 libre para abrir la siguiente fase.

## Modo de trabajo declarado por el usuario
- Fase actual: **solo** — un único desarrollador, hasta que el proyecto escale y requiera más gente.
- Fase futura (post-validación/escala): **equipo** — cuando eso pase, revisar convenciones de
  equipo (branch protection, revisión de PRs, permisos) que hoy no aplican.
