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
- **Reglas por área técnica** (motor, frontend, seguridad, costuras de prueba): `.claude/rules/
  {engine,web,security,testing-seams}.md`.
- **Narrativa de fases ya cerradas**: `docs/rules-archive/fase-N.md` (no hace falta leerla salvo
  que la tarea concreta lo pida).
- **Tabla de agentes y su modelo/rol/tools**: la tabla de `CLAUDE.md` — no se repite aquí para
  evitar un segundo conteo que se desactualice.
- **Formato del log de `journal.md`**: `CLAUDE.md`, sección "FORMATO DE LOG EN journal.md" — Codex
  no escribe en `journal.md` ni conoce las skills de este ecosistema (por diseño, ver `CLAUDE.md`
  tabla "HERRAMIENTA POR TAREA"), pero puede necesitar leer el formato al revisar un diff.

## Cómo correr las pruebas

El comando canónico es `bun run test` desde la raíz (nunca `bun test` a secas ahí — contamina los
tests del motor con el registrator global de `apps/web`, ver `invariantes.md`). El detalle completo
de comandos vive en `CLAUDE.md`, sección "COMANDOS ESENCIALES" — léela antes de asumir que un
comando de una sesión anterior sigue siendo el vigente.

## Reglas que sí valen para cualquier agente, incluido Codex

- **WIP = 1** por herramienta (`assigned_tool`) — no arranques una segunda tarea si ya hay una en
  `doing` asignada a Codex.
- **Prohibido refactorizar archivos no relacionados con la tarea.**
- Un `dependency` de producción nuevo exige pasar por el procedimiento canónico de dependencias
  (`CLAUDE.md`, "Política de dependencias por categoría") — nunca se agrega a ciegas.
- Los secretos viven únicamente en variables de entorno. Un literal sospechoso en el diff es motivo
  de rechazo, no un detalle a limpiar después.
