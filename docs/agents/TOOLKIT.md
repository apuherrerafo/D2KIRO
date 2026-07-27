# TOOLKIT — Inventario del entorno (generado por /launchpad)

## Entorno IDE real (confirmado por el usuario)
- **Editor**: Kiro IDE — es donde el usuario trabaja realmente sobre este repo.
- **Agente de código**: extensión Claude Code dentro de Kiro (soy yo, en este contexto).
- **Codex CLI**: disponible en terminal (`codex-cli 0.144.6` detectado en PATH) — opción real para `assigned_tool: codex` en tareas acotadas y autocontenidas.
- Cursor (`.cursor/`): no está en uso.

Como Kiro es el editor real, generé `.kiro/steering/{product,structure,tech}.md` y
`.kiro/hooks/verify-simplicity.md` (mismo contenido que produce `scripts/install.sh` al detectar
`.kiro/`) para que Kiro pueda leer las reglas del proyecto de forma nativa, en espejo con `CLAUDE.md`.
Esto habilita el flujo multi-herramienta descrito en `CLAUDE.md` ("HERRAMIENTA POR TAREA"): Kiro
para planificación/navegación rápida, Claude Code para skills/memoria/gates de seguridad, Codex para
features acotadas y autocontenidas.

## Runtime y herramientas de desarrollo
| Herramienta | Estado | Nota |
|---|---|---|
| Git | ✅ 2.52.0 | Repo ya inicializado (`git`, rama `master`). |
| Node.js | ✅ v22.22.3 | Disponible. |
| Bun | ⚠️ No instalado | `CLAUDE.md` declara Bun como runtime del stack, pero no está instalado en esta máquina todavía. Instalar antes de `/gear-up` si Bun se confirma como runtime. |
| Codex CLI | ✅ 0.144.6 | Disponible para tareas con `assigned_tool: codex`. |
| GitHub CLI (`gh`) | ⚠️ No instalado | Necesario si el flujo de trabajo usa PRs vía `gh`. |
| Docker | No instalado | No requerido salvo que el stack final lo necesite. |

## Ecosistema Caveman instalado
- `.claude/agents/`: warden, artisan, chronicle, tracer, sentinel.
- `.claude/skills/`: 27 skills core (kickoff, pre-flight, blueprint, build, redteam, castoff, etc.)
- `.claude/commands/`: alias de comandos (`/start`, `/ship`, `/fix`, `/plan`, `/review`, etc.)
- `skills-extra/`: utilidades opcionales (clean-sweep, skillmap, teach-me, transcript-grab) — no cargadas por defecto.
- `scripts/`: `install.sh`, `verify-simplicity.sh`, `hub.ts`, `analisis-arquitectura.sh`.

## Estado de memoria del proyecto
- `docs/agents/journal.md`, `ledger.md`, `MEMORY.md`, `USER.md`: vacíos — proyecto recién arrancado, sin historial todavía.
- `docs/agents/PROGRESS.md`: fase actual `kickoff`, sin fases completadas.
- No hay tareas en `docs/agents/tasks/` ni ninguna en estado `doing` (WIP=1 libre).

## Modo de trabajo declarado por el usuario
- Fase actual: **solo** — un único desarrollador validando el MVP.
- Fase futura (post-validación): **equipo** — cuando el proyecto escale a más usuarios, se planea incorporar colaboradores. Revisar entonces las convenciones de equipo (branch protection, revisión de PRs, permisos) que hoy no aplican.
