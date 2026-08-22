# plan.md — vista derivada, generada por /helm

**No se edita a mano.** Fuente de verdad: frontmatter YAML de `docs/agents/tasks/TSK-XXX.md`.
Regenerar con `/helm` cada vez que cambie el estado de un ticket.

Fases 1, 1b, el bloque de feedback (TSK-027 a TSK-033), Fase 2 completa ("Draft en equipo" +
Fase C caminos de draft, TSK-034 a TSK-036) y el bloque de deploy (TSK-037 a TSK-041) están
completos — `done`, fuera de este plan. TSK-042 (simulador en la nube) también `done`. Todo lo
que queda en `backlog` es **Fase 3** (posiciones reales en el motor de sugerencias,
`docs/specs/SPEC.md` §10.11).

## Top 3 Must-have (backlog, orden de dependencia de SPEC §10.11)

| # | Ticket | Título | moscow | preferred_tool | state |
|---|---|---|---|---|---|
| 1 | [TSK-043](tasks/TSK-043.md) | hero-positions.json + cargador con validación de borde (S10) | must | claude-code | backlog |
| 2 | [TSK-044](tasks/TSK-044.md) | SignalScorer position_fit (fusiona role_gap + role_safety) | must | claude-code | backlog |
| 3 | [TSK-045](tasks/TSK-045.md) | SCORING_WEIGHTS_V4 + integración en mix.ts + candado de regresión | must | claude-code | backlog |

TSK-043 es el único candidato real para pasar a `doing` ahora mismo (WIP=1, ningún ticket está en
`doing`). Depende estrictamente en cadena: 043 → 044 → 045 → 046 → 047 — ninguno puede arrancar
antes de que el anterior esté `done`, a diferencia de fase 1b donde algunos tickets podían
paralelizarse. Esta cadena no admite ese atajo (cada uno consume el archivo que produce el
anterior).

## Resto del backlog Must-have (orden de dependencia)
| Ticket | Título | preferred_tool |
|---|---|---|
| [TSK-046](tasks/TSK-046.md) | Espejo de SignalId + etiqueta de position_fit en apps/web | codex |
| [TSK-047](tasks/TSK-047.md) | Baja de role-gap.ts y role-safety.ts (último, cuando nada los referencie) | claude-code |

## Should-have (no bloquea, se atiende después)
Ninguno en backlog actualmente.

## WIP actual (por assigned_tool)
Ninguna tarea en `doing` — libre para promover TSK-043 vía `/dispatch`.

## Fuera del plan, no bloquea nada de lo de arriba

- **Hilo 1, pausado (no descartado)**: el Random Draft Simulator (spec nativo de Kiro, sin
  tickets `TSK-XXX` propios) está implementado y verificado en navegador, pero **sin commitear y
  sin pasar por `@redteam`** — pendiente, se retoma cuando el usuario lo pida (decisión explícita
  suya de ir paso a paso). Ver `docs/agents/PROGRESS.md`.
- El spike de Overwolf, el adaptador OCR, la predicción de rol/posición del rival (STRATZ), y el
  sistema combinatorial completo de caminos de draft (ejes de timing/forma de recursos) siguen
  sin fecha ni ticket — decisión de producto pendiente, no bloquean Fase 3.
