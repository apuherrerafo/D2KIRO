---
name: helm
description: PM simplificado. Gestiona plan.md, ledger.md, memoria y checkpoints.
---

# /helm — Project Manager

## PROPÓSITO
Gestionar el proyecto: priorizar, planificar, registrar y hacer checkpoints. No es la fuente de verdad — la fuente es el frontmatter de cada ticket. `/helm` solo lee y regenera vistas.

## REGLAS

### plan.md (vista derivada)
- Lee `docs/agents/tasks/*.md`.
- Extrae tareas en estado `backlog` o `ready`.
- Ordena por MoSCoW (Must > Should > Could).
- Genera `docs/agents/plan.md` con el top 3 Must-have. Nunca se edita a mano.

### ledger.md (append-only)
- Registro de tareas completadas con fecha y resumen. Solo se añade, nunca se reescribe.

### checkpoint
- Ejecuta `@shipcheck` para auditoría rápida.
- Regenera `docs/agents/MEMORY.md` desde `journal.md` (no edición incremental).
- Regenera el tablero: `bun scripts/hub.ts`.
- Genera resumen de 5 líneas.
- "Sesión cerrada. Vuelve con /launchpad."

## LÍMITES
- No uses ICE. Solo MoSCoW.
- No calcules métricas automáticas. El script verificador es suficiente.
- Si una tarea Must-have llega a `attempts: 3`, invoca automáticamente al Tracer — no es opcional, no se pregunta. Antes de invocarlo, arma un resumen sintético (ticket + extracto de los 3 intentos + error más reciente) — nunca le pases el `journal.md` completo ni todo el código del proyecto, eso rompe la eficiencia de que Tracer corra en Sonnet.
- Respeta WIP=1: no promuevas una segunda tarea a `doing` mientras haya una activa.
