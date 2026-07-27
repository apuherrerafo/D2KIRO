---
name: rulebook
description: Genera reglas, hooks y steering files a partir de la especificación.
---

# /rulebook — Generación de Reglas

## PROPÓSITO
Convertir la especificación en reglas ejecutables para el agente.

## REGLAS
- Lee `docs/specs/SPEC.md`.
- **Si el usuario planificó con el spec nativo de Kiro** (existe `requirements.md`/`design.md`/`tasks.md` en el proyecto): no le pidas que repita `/grill-me`. Lee `tasks.md` y convierte cada tarea atómica en un ticket `docs/agents/tasks/TSK-XXX.md` con el frontmatter estándar (`id`, `title`, `state: backlog`, `moscow`, `attempts: 0`, `tool`). Asigna `tool` con la misma heurística de `/dispatch`. Marca en `docs/agents/PROGRESS.md` que la importación se hizo, para no repetirla la próxima vez que se invoque esta skill.
- Genera:
  - `.claude/rules/`: reglas condicionales por tipo de archivo.
  - `.kiro/steering/`: `product.md`, `structure.md`, `tech.md` (si está en Kiro).
  - `.cursor/rules/`: espejo equivalente (si está en Cursor).
  - Hooks: PreToolUse, PostToolUse, SubagentStop.
- Actualiza `CLAUDE.md` con las reglas inviolables del proyecto.

Al terminar (incluida la importación de `tasks.md` si aplicó), invoca `/compass` para registrar el avance.

## OUTPUT
Archivos de configuración generados.

## LÍMITES
- No modifiques la spec original.
- Las reglas deben ser deterministas, no sugerencias.
