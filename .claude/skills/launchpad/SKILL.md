---
name: launchpad
description: Recepción, bootstrap del proyecto, mapeo de herramientas, handoff y principio Caveman. Actívala al iniciar un nuevo proyecto o sesión.
---

# /launchpad — Recepción y Arranque

## PROPÓSITO
Iniciar un proyecto nuevo o retomar uno existente, mapear el entorno y configurar el espacio de trabajo.

## REGLAS
- Saluda y pregunta: "¿Nuevo proyecto o retomando uno existente?"
- Si existe: lee `docs/agents/ledger.md`, `docs/agents/journal.md` y `docs/agents/MEMORY.md`.
- Pregunta: "¿Trabajas solo, en equipo o harás handoff?"
- Detecta el entorno automáticamente (Kiro IDE, Cursor, Claude Code) — usa la misma lógica de `scripts/install.sh`.
- Genera `docs/agents/TOOLKIT.md` con el inventario de herramientas.
- Si es nuevo: crea `docs/agents/` y `CONTEXT.md` vacío.
- Comprueba si hay una tarea en estado `doing` (WIP=1). Si la hay, retómala antes de abrir otra.

## OUTPUT
"Proyecto preparado. Siguiente paso recomendado: /pre-flight para investigar el dominio."

## LÍMITES
- No escribas código en esta fase.
- No hagas suposiciones sobre el stack.
