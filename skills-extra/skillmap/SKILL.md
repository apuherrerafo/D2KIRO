---
name: skillmap
description: Generar grafo Mermaid del ecosistema de skills. SKILL EXTRA — diagnóstico ocasional, no se ejecuta en el flujo normal.
---

# /skillmap — Pensadero

## PROPÓSITO
Visualizar las conexiones entre todas las skills y agentes.

## REGLAS
- Lee todas las skills en `.claude/skills/` y `skills-extra/`.
- Identifica relaciones (invocaciones, dependencias).
- Genera `docs/agents/skillmap.md` con diagrama Mermaid.

## OUTPUT
"Grafo actualizado en docs/agents/skillmap.md"
