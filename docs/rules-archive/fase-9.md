## REGLAS DE FASE 9 (V6-medido → V6-contextual: evaluación offline, calibración empírica, inteligencia contextual) — desde `docs/specs/SPEC.md` §15

Generadas por `/rulebook`, décima ejecución del proyecto. `/blueprint` corrido en **Opus** (gatillo
documentado: cambia el mecanismo de normalización de señales + el contrato `SignalContribution` +
estrena `SCORING_WEIGHTS_V7`). Origen: 3 informes externos consolidados en
`docs/research/fase9-research-consolidation.md` (48 ideas, IDs `R1-1`…`R3-15`, trazabilidad
mecánica §8). Detalle completo en `.claude/rules/` (secciones "Fase 9" en `engine.md`, `web.md`,
`security.md`, `testing-seams.md`) — resumen de lo no negociable:

- **Programa 9.0→9.5. Sólo 9.0 está especificada a nivel ejecutable** (§15.0); 9.1 tiene el
  mecanismo fijado con números diferidos a su gate; 9.2–9.5 son conceptuales y cada una abre su
  `/blueprint` angosto. Fijar hoy un `P05`/`P95` sería inventarlo — mismo precedente que Fase 4
  §11.10.
- **9.0 no cambia una línea de `apps/engine/src/**` ni `apps/web/src/**`** — criterio de aceptación
  verificable con `git diff --name-only`. No toca `signals/`, `weights.ts`, `mix.ts`, `RAW_RANGE`,
  `SignalId`, `SCORING_WEIGHTS_V6`. `ENABLE_PRO_DRAFTER` y el comportamiento de producción quedan
  idénticos durante toda la fase.
- **Dos benchmarks separados** (§15.4.3): **Engine Quality** (principal, Golden Dataset graduado,
  titular **NDCG@5** + Bad Pick Rate@5 + Pairwise Accuracy) y **Professional Pick Agreement**
  (secundario, Recall@1/3/5/10 + MRR sobre 2.164 replays). El pick profesional **no es ground
  truth**; el benchmark secundario **nunca** se llama "accuracy" ni "qué tan bueno es el motor".
  Ambos **segmentados por contexto de decisión y por `tier`**.
- **`ConstraintViolationRate = 0` es un gate duro**, no una métrica ponderada: una recomendación de
  héroe baneado/pickeado/inexistente invalida la corrida entera.
- **No existe snapshot de meta point-in-time** (§15.1 C4): el backtest es **comparativo, nunca
  predictivo**; el valor absoluto de cualquier métrica no significa nada sin sus baselines.
- **`raw: null` sigue siendo sagrado** — nunca 0, 0.5 ni 50. 9.1 cambia cómo se propaga su
  ausencia (fin de la redistribución candidate-specific), no que se rellene.
- **Harness (paquete completo, R3)**: `eval/` + `data/{curated,generated,schemas,metadata}/` +
  `docs/adr/` + hook de frontera de datos + `write_scope` por ticket + su hook PreToolUse + regla
  de paralelismo (`writeScope(A) ∩ writeScope(B) = ∅` ∧ sin `blocked_by` ⇒ `isolation: worktree`) +
  2 agentes nuevos (`data-stat-engineer`, `evaluation-engineer`, sin `mcp__context7`) + partir
  `CLAUDE.md` a **< 200 líneas** moviendo los bloques `## REGLAS DE FASE X` **verbatim** a
  `.claude/rules/fase-N.md`.
- **Descartado con motivo escrito** (§15.2 D10, §15.4.9): RL, DL, minimax, predicción del siguiente
  pick, counterfactual winrate, MCMC/Stan en prod, LangGraph/CrewAI/AutoGen, Memory MCP, Firecrawl,
  `work/{active,done}/`. **Diferido**: `PlayerHeroReliability`, Branch Survival, V3 secuencial, SDK
  en `tools/ai-harness/`, harness V3–V4/CI, migración de los 3 JSON curados a `data/curated/`.
- **Sin dependencia nueva, sin secreto de runtime, sin variable de entorno nueva, cero PII, cero
  red en el camino caliente.** `scripts/eval/**` y `scripts/stats/**` nunca se importan desde
  `apps/`. Las SQLite se abren `readonly: true`.
- **`TSK-174`/`TSK-179` deja de ser dependencia de Fase 9** (§15.1 C2): los slots Dire no
  participan de ninguna métrica.
- **Precondición para arrancar el bloque A**: commitear Fase 8 (`TSK-183`→`TSK-192` + el fix de
  `apps/web/features/draft/validation.ts`). El baseline "V6-medido" tiene que corresponder a un
  commit identificable.
- **14 tickets, `TSK-193`→`TSK-206`, sólo de 9.0**, en 5 bloques por dependencia (A harness →
  B replay+métricas puras → C runners → D diagnóstico → E cierre del gate). Cada ticket declara
  `write_scope` y cita el ID `Rx-y` que implementa.

