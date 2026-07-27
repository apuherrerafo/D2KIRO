# Ecosistema Caveman — Documentación Interna (v1.2.0)

## Filosofía
Minimalismo extremo. Cero dependencias innecesarias. Cada skill y agente tiene UNA sola responsabilidad.
La seguridad es un gate, no una sugerencia. Opus solo al inicio, Sonnet para sostener. Ante la duda, simplificar.

## Agentes (5) — todos en Sonnet salvo Chronicle
| Agente | Modelo | Responsabilidad | Rol |
|---|---|---|---|
| **Warden** (ex QA Tester) | `claude-sonnet-5` | Pruebas, linters, verificación de límites | Revisa |
| **Artisan** (ex UI/UX Builder) | `claude-sonnet-5` | Interfaces y sistema de diseño | Ejecuta |
| **Chronicle** (ex Spec Archivist) | `claude-haiku-4-5-20251001` | Memoria, specs, ledger | Documenta |
| **Tracer** (ex Engineering Debugger) | `claude-sonnet-5` | Fallos repetidos, alternativas | Analiza |
| **Sentinel** (ex Security Auditor) | `claude-sonnet-5` | Gate de seguridad pre-deploy | Revisa (bloqueante) |

## Skills core (25)
### Cadena de planificación inicial (única con Opus recomendado)
`/kickoff` → `/pre-flight` → `/blueprint` → `/rulebook`

### Producto
`/brainstorm` · `/grill-me` · `/helm`

### Ejecución técnica
`/dispatch` · `/prototype` · `@build` · `@root-cause` · `@redteam` · `@shipcheck` · `@depcheck` · `@loop`

### Deploy, evolución y arquitectura continua
`/castoff` · `/evolve` · `/foundation-check` · `/onboarding` · `/design-forge` · `/gear-up`

### Guía
`/compass` — mapa interactivo del ecosistema completo, para cuando no te acuerdas qué usar.
`/nightwatch` — detector conservador de trabajo apto para dejarse corriendo desatendido de noche en el VPS de Hermes. Nunca por defecto.

## Skills extra (4) — en `skills-extra/`, no se cargan por defecto
`/teach-me` · `/transcript-grab` (ex youtube-full) · `@clean-sweep` (ex limpiar-web) · `/skillmap` (ex skill-graph)

## Removido
- `/mission-control` — duplicaba `bun scripts/hub.ts` y prometía costes de tokens que no puede conocer.
- `@router` — fusionado dentro de `/dispatch`.

## Política de modelos
Opus **solo** en `/blueprint` (una vez, la síntesis final — `/kickoff` y `/pre-flight` son Sonnet, solo recolectan). Todo lo demás en Sonnet, sin excepción salvo un gatillo de riesgo verificable documentado (cambio de trust boundary, migración irreversible, auth/permisos, motor de DB, 2 fallos de dominio en `@root-cause`, o pivote de dominio real). Chronicle en Haiku por volumen. Ver tabla y checklist completo en `CLAUDE.md`. Regla simétrica aplicada también al lado de Codex/GPT.

## Gestión de tareas
- Fuente de verdad: frontmatter YAML en `docs/agents/tasks/TSK-XXX.md`, con `preferred_tool` (intención de `/grill-me`) y `assigned_tool` (decisión real de `/dispatch` justo antes de ejecutar).
- Vistas derivadas: `plan.md`, `ledger.md`, `docs/agents/hub.html` (muestra `assigned_tool` como tag por ticket).
- **WIP=1 por `assigned_tool`**, no global — permite paralelismo real entre Claude Code, Codex, Kiro nativo y Hermes. Verificado por `scripts/verify-simplicity.sh`, junto con append-only de `journal*.md`/`ledger.md`.

## Los 6 alias (la superficie que el usuario necesita recordar)
`/start` · `/plan` · `/build` · `/fix` · `/review` · `/ship` — `/dispatch` decide internamente cuál de las 25 skills específicas corresponde según la fase. Los nombres técnicos siguen funcionando, los alias no los reemplazan.

## Portabilidad multi-herramienta (Kiro + Claude Code + Codex)
- `AGENTS.md` se genera como espejo de `CLAUDE.md` — estándar reconocido por múltiples herramientas.
- `.kiro/steering/` y `.cursor/rules/` se generan como espejo de las reglas duras.
- Patrón "Handoff" en `/dispatch`: si cambias de herramienta por falta de créditos, `journal.md` lleva el registro para no perder el hilo.
- Hook sugerido (no confirmado al 100%) en `.kiro/hooks/` para disparar `verify-simplicity.sh` nativamente.

## Memoria
`docs/agents/journal.md` (fuente de verdad, append-only) · `docs/agents/MEMORY.md` (vista comprimida) · `docs/agents/USER.md` · `docs/agents/ledger.md` (append-only).

## MCPs — adoptados y rechazados (con razón)
**Adoptados:**
- Context7 — vigencia de dependencias (`@depcheck`).
- Firecrawl (confirmado) — crw-mcp también confirmado en npm (v0.28.0, AGPL-3.0, activo, vía `npx crw-mcp`); "crw-cli" vía cargo NO existe, ese comando específico era incorrecto — vía patrón CLI+archivo, nunca crudo al contexto (`/scout`).
- Railway MCP (modo local, `railway mcp`) — chequeo post-deploy en `/castoff`, hereda credenciales de la CLI, sin infraestructura nueva.

**Condicional (no por defecto — solo si el proyecto lo demuestra):**
- Graphify + code-review-graph — grafo de código local vía tree-sitter. El propio ecosistema de esa herramienta admite que en repos pequeños (nuestro caso por diseño: 3 archivos/200 líneas por tarea) es redundante. Gatillo: solo si `/foundation-check` muestra crecimiento sostenido de hot spots. Si se instala: acotar a 5-8 tools vía `CRG_TOOLS` (no las ~25 por defecto), revisar qué hooks escribe en la config de Claude Code antes de aceptarlos, y dejar apagado el etiquetado semántico con LLM salvo que se pida explícitamente.

**Rechazados explícitamente:**
- Filesystem MCP / Git MCP — redundantes con las tools nativas de Claude Code (Read/Write/Bash). No añaden nada, sí mantenimiento.
- Memoria como grafo de conocimiento (Sequential Thinking MCP y similares) — compite con `journal.md` + Chronicle + HUB, que ya resuelven esto sin depender de un servidor externo.
- Linear MCP / GitHub MCP para sincronizar `tasks.md` — no hay necesidad planteada hoy; `/rulebook` ya importa `tasks.md` de Kiro a nuestro propio formato.
- Sentry/Datadog — opcionales, no core. Railway MCP cubre lo básico para un desarrollador independiente.

## Frameworks
Guía completa en `docs/guides/frameworks.md`. Stack por defecto: Bun + HTMX + SQLite + Drizzle. Solo cambia si `/pre-flight` lo justifica.
