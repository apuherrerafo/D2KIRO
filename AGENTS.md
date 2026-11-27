# PROYECTO: dota2coach (Draft Coach) — espejo delgado para Codex

`CLAUDE.md` es la fuente canónica de este proyecto — este archivo es su puntero para Codex, que no
lee `CLAUDE.md` por convención de herramienta. Codex actúa aquí como **reviewer independiente**
(rol confirmado — no como writer principal), y este espejo no duplica ningún hecho que cambie con
el código: cifras (versión de scoring activa, conteo de agentes, fase en curso) y comandos exactos
viven en un solo lugar cada uno, listados abajo por referencia, no por copia.

**Regenerado por R0.4 Task 24 (2026-09-13)** — la versión anterior de este archivo se había
congelado en el estado de Fase 3 (`SCORING_WEIGHTS_V5`, 5 agentes, comandos `dev`/`lint` de raíz
inexistentes) y llevaba varias fases divergiendo de `CLAUDE.md` en silencio. Este archivo no vuelve
a copiar esos hechos — apunta a donde viven, para no volver a desactualizarse igual.

## Dónde está cada cosa (no la copies aquí)

- **Estado real del proyecto / fase en curso**: `docs/agents/PROGRESS.md`.
- **Stack, comandos canónicos, política de dependencias, gates de seguridad**: `CLAUDE.md`.
- **Invariantes que valen en toda fase** (versión de scoring activa, comando de test canónico,
  `raw: null` sagrado, etc.): `.claude/rules/invariantes.md`.
- **Reglas siempre vigentes**: `.claude/rules/invariantes.md` y `.claude/rules/security.md` (sin `paths:`).
- **Reglas por ruta** (frontmatter `paths:`): `.claude/rules/` → `engine.md`, `web.md`, `testing-seams.md`, `context7.md`. Claude Code las carga solo al tocar esas rutas; Codex y Gemini no lo hacen — léelas a mano según el área que cambies.
- **Narrativa de fases ya cerradas**: `docs/rules-archive/` (no hace falta leerla salvo que la
  tarea concreta lo pida).
- **Tabla de agentes, modelos, herramienta por tarea**: `docs/agents/process.md` — no se repite aquí
  para evitar un segundo conteo que se desactualice.
- **Formato del log de `journal.md`**: `CLAUDE.md` (resumen) y `docs/agents/process.md` (detalle) — Codex
  no escribe en `journal.md` ni conoce las skills de este ecosistema (por diseño, ver `CLAUDE.md`
  tabla "HERRAMIENTA POR TAREA"), pero puede necesitar leer el formato al revisar un diff.

## Quién lee qué (entrada compartida: este archivo)

| Proveedor | Instrucciones | Skills / agentes / hooks de `.claude/` |
|---|---|---|
| Claude Code | `CLAUDE.md` + `.claude/rules/` | Sí (hooks de `.claude/settings.json` sólo gobiernan a Claude) |
| Codex | `AGENTS.md` (probado: lo carga; no carga `.claude/skills`, sólo `.agents/skills`, que no existe aquí) | No |
| Gemini CLI | `.gemini/settings.json` (`context.fileName: ["AGENTS.md"]`, unidades A+B, PR #172). **NOT_TESTED** | No |

Lo común a los tres vive en git y GitHub: `ci.yml` y la protección de rama de `release/mvp-beta`.
`.husky/pre-push` es además una barrera **local**: sólo corre si ese clon o worktree tiene los hooks activos
(`sh scripts/install-git-hooks.sh` una vez por clon, o el `prepare` de husky al instalar dependencias en la raíz;
con husky, un worktree nuevo no los tiene hasta instalar) y se puede saltar (`git push --no-verify`).
Son capas complementarias; los hooks de Claude son una capa extra.

**La protección de rama NO está en el repo**: es configuración de GitHub y puede cambiar sin dejar
rastro en un commit. No la des por hecha; mídela antes de apoyarte en ella con
`gh api repos/apuherrerafo/D2KIRO/branches/release%2Fmvp-beta/protection`.

## Cómo correr las pruebas

El comando canónico es `bun run test` desde la raíz (nunca `bun test` a secas ahí — contamina los
tests del motor con el registrator global de `apps/web`, ver `invariantes.md`). El detalle completo
de comandos vive en `CLAUDE.md`, sección "Comandos" — léela antes de asumir que un
comando de una sesión anterior sigue siendo el vigente.

## Reglas que sí valen para cualquier agente, incluido Codex

- **WIP = 1** por herramienta (`assigned_tool`) — no arranques una segunda tarea si ya hay una en
  `doing` asignada a Codex.
- **Prohibido refactorizar archivos no relacionados con la tarea.**
- Un `dependency` de producción nuevo exige pasar por el procedimiento canónico de dependencias
  (`CLAUDE.md`, "Reglas inviolables → Dependencias") — nunca se agrega a ciegas.
- Los secretos viven únicamente en variables de entorno. Un literal sospechoso en el diff es motivo
  de rechazo, no un detalle a limpiar después.
