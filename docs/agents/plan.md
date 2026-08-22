# plan.md — vista derivada, generada por /helm

**No se edita a mano.** Fuente de verdad: frontmatter YAML de `docs/agents/tasks/TSK-XXX.md`.
Regenerar con `/helm` cada vez que cambie el estado de un ticket.

**Los 66 tickets del repo (TSK-001 a TSK-066) están `done`.** Cero tareas en `backlog` o `ready` —
no hay top 3 Must-have que mostrar. Fases 1, 1b, el bloque de feedback (TSK-027 a TSK-033), Fase 2
("Draft en equipo" + Fase C caminos de draft + Random Draft Simulator, TSK-034 a TSK-036, TSK-063),
el bloque de deploy (TSK-037 a TSK-041), Fase 3 completa (posiciones reales,
`docs/specs/SPEC.md` §10, TSK-043 a TSK-047, TSK-054) y la auditoría de arquitectura + recalibración
de pesos (TSK-055 a TSK-066, `SCORING_WEIGHTS_V5` activa) están todos cerrados. Ver
`docs/agents/PROGRESS.md` § SIGUIENTE PASO para la decisión de producto abierta.

## Top 3 Must-have (backlog)
Ninguno — backlog en cero.

## Should-have (no bloquea, se atiende después)
Ninguno en backlog actualmente.

## WIP actual (por assigned_tool)
Ninguna tarea en `doing` — libre para abrir cualquier trabajo nuevo vía `/dispatch`.

## Caminos identificados, sin fecha ni ticket (decisión de producto pendiente, no bloquean nada)
- El spike de Overwolf (único capturador de fase 1 nunca validado contra una partida real).
- El adaptador OCR (contrato ya especificado en `architecture.md`, nunca construido).
- Predicción de rol/posición del rival (dependencia condicional de STRATZ, documentada desde
  fase 1b, nunca priorizada).
- El sistema combinatorial completo de caminos de draft (eje de timing, forma de recursos, win
  conditions primaria+secundaria) — la v1 (TSK-036) solo cubrió el eje de plan macro, a propósito.

Cualquiera de ellos arranca con `/kickoff` cuando el usuario lo decida — ver
`docs/agents/PROGRESS.md` para el detalle completo de cada uno.
