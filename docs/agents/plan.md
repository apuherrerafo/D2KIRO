# plan.md — vista derivada, generada por /helm

**No se edita a mano.** Fuente de verdad: frontmatter YAML de `docs/agents/tasks/TSK-XXX.md`.
Regenerar con `/helm` cada vez que cambie el estado de un ticket.

Fase 1 (TSK-001 a TSK-016) está completa — `done`, fuera de este plan. Todo lo que queda en
`backlog`/`ready` es fase 1b (personalización de hero pool, `docs/specs/SPEC.md` §9.10).

## Top 3 Must-have (backlog/ready, orden de dependencia de SPEC §9.10)

| # | Ticket | Título | moscow | preferred_tool | state |
|---|---|---|---|---|---|
| 1 | [TSK-017](tasks/TSK-017.md) | Migración hero_pool + claves de settings (§9.4) | must | codex | backlog |
| 2 | [TSK-018](tasks/TSK-018.md) | OpenDotaClient.getPlayerHeroes + validación en el borde (S7) | must | codex | backlog |
| 3 | [TSK-019](tasks/TSK-019.md) | Cálculo puro del pool propuesto (S7) | must | codex | backlog |

TSK-017 es el único candidato real para pasar a `doing` ahora mismo (WIP=1, ningún ticket está en
`doing`). TSK-018 no depende de TSK-017 y podría arrancar en paralelo si se usa otra herramienta
(`assigned_tool` distinto), pero dentro de una misma herramienta el orden de arriba es el más
seguro.

## Resto del backlog Must-have (orden de dependencia)
| Ticket | Título | preferred_tool |
|---|---|---|
| [TSK-020](tasks/TSK-020.md) | Endpoints GET/PUT /api/hero-pool + escritura transaccional (S8) | claude-code |
| [TSK-021](tasks/TSK-021.md) | Endpoint POST /api/hero-pool/calculate + sus errores | claude-code |
| [TSK-022](tasks/TSK-022.md) | SignalScorer: hero_pool_fit (S3) | codex |
| [TSK-023](tasks/TSK-023.md) | SCORING_WEIGHTS_V2 + applicable en mix.ts (candado de regresión cero) | claude-code |
| [TSK-024](tasks/TSK-024.md) | Pantalla de configuración: Mi pool de héroes (RTK Query) | codex |
| [TSK-025](tasks/TSK-025.md) | Pantalla de propuesta/confirmación del pool calculado | claude-code |
| [TSK-026](tasks/TSK-026.md) | SignalBreakdown con las 5 señales + textos de hero_pool_fit | codex |

## Should-have (no bloquea, se atiende después)
Ninguno en backlog actualmente.

## WIP actual (por assigned_tool)
Ninguna tarea en `doing` — libre para promover TSK-017 vía `/dispatch`.

## Fuera del plan, no bloquea nada de lo de arriba
El spike de Overwolf (`scripts/spikes/overwolf-draft-probe/`, Paso 0 del capturador real) no tiene
ticket todavía — es un script desechable que corre el propio usuario en una partida real, sin
pasar por `@build`/`@redteam`. Avanza en paralelo, sin dependencia con fase 1b.
