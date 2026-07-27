# plan.md — vista derivada, generada por /helm

**No se edita a mano.** Fuente de verdad: frontmatter YAML de `docs/agents/tasks/TSK-XXX.md`.
Regenerar con `/helm` cada vez que cambie el estado de un ticket.

## Top 3 Must-have (backlog/ready, orden de dependencia de SPEC §8)

| # | Ticket | Título | moscow | preferred_tool | state |
|---|---|---|---|---|---|
| 1 | [TSK-001](tasks/TSK-001.md) | Esqueleto del monorepo (apps/web, apps/engine) + Bun instalado | must | claude-code | backlog |
| 2 | [TSK-002](tasks/TSK-002.md) | Esquema SQLite/Drizzle (C4) | must | codex | backlog |
| 3 | [TSK-003](tasks/TSK-003.md) | OpenDotaClient + sincronización de meta (S6) | must | codex | backlog |

TSK-001 bloquea todo lo demás — es el único candidato real para pasar a `doing` ahora mismo
(WIP=1, y ningún ticket está en `doing` en este momento).

## Resto del backlog Must-have (orden de dependencia)
| Ticket | Título | preferred_tool |
|---|---|---|
| [TSK-004](tasks/TSK-004.md) | applyDraftEvent puro + contrato de eventos (S1, S4) | codex |
| [TSK-005](tasks/TSK-005.md) | SignalScorer: counter | codex |
| [TSK-006](tasks/TSK-006.md) | SignalScorer: patch_meta | codex |
| [TSK-007](tasks/TSK-007.md) | SignalScorer: team_synergy | codex |
| [TSK-008](tasks/TSK-008.md) | SignalScorer: role_gap | codex |
| [TSK-009](tasks/TSK-009.md) | Mezcla, orden y explicación del motor (§C3) | claude-code |
| [TSK-010](tasks/TSK-010.md) | Servidor Bun: ingreso HTTP + WebSocket + seguridad (§5) | claude-code |
| [TSK-011](tasks/TSK-011.md) | Simulador de draft + guiones de prueba | codex |
| [TSK-012](tasks/TSK-012.md) | Vista de draft en Next.js (S5), 6 estados | claude-code |
| [TSK-013](tasks/TSK-013.md) | Entrada manual y camino de degradación | claude-code |

## Should-have (no bloquea, se atiende después)
| Ticket | Título | preferred_tool |
|---|---|---|
| [TSK-014](tasks/TSK-014.md) | Páginas del sitio (meta, héroes, configuración) con RTK Query | codex |

## WIP actual (por assigned_tool)
Ninguna tarea en `doing` — libre para promover TSK-001 vía `/dispatch`.
