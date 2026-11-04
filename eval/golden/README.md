# `eval/golden/` — Golden Dataset (Benchmark A, Engine Quality)

> ## ⚠️ Golden v1 es HISTÓRICO — no es una medida absoluta de calidad estratégica
>
> Auditoría del 2026-11-03 (PR #110). Lo que hay que saber antes de usar este archivo:
>
> - **El etiquetador vio al motor antiguo.** El prompt de etiquetado
>   (`docs/research/tsk-206-golden-research-prompt.md`) mostraba en cada caso "Mi motor recomienda
>   hoy: …". 128 de los 150 héroes del top-5 del motor de septiembre coinciden con lo que vio el
>   etiquetador, y casi todo lo que se le mostró quedó etiquetado. Los casos miden, en buena parte,
>   qué tan parecido es un motor a aquel.
> - **Cobertura desigual.** Hay ~2 `excellent` y ~2 `acceptable` por caso. Un héroe sin etiquetar
>   cuenta 0 en NDCG@5: el motor de septiembre tiene ~91% de su top-5 etiquetado; el actual, ~45%.
> - **Etiquetas discutibles.** Una auditoría de 59 etiquetas (10 casos) halló ~42% QUESTIONABLE y
>   una razón con un error de habilidad (caso 02). Un solo LLM, sin validación humana.
> - **Uso correcto:** detector de **cambios** entre versiones del motor (comparar contra el baseline
>   de `eval/baselines/`), nunca "qué tan bueno es el motor" ni "cuál motor decide mejor". Una nota
>   baja aquí NO prueba una regresión; una nota alta NO prueba calidad.
> - Las etiquetas, las métricas, el dataset y el baseline **no se modificaron**. Un benchmark nuevo
>   (etiquetador que no vea ningún motor, 2+ jueces, unión de varios motores) es trabajo aparte.

Casos de estado de draft **etiquetados** con qué héroes serían `excellent` / `acceptable` / `bad`
en ese momento exacto, y por qué. Es el benchmark **principal** de calidad del motor
(SPEC.md §15.4.3). Esquema: [`data/schemas/golden.schema.json`](../../data/schemas/golden.schema.json).
Loader validado: `scripts/eval/golden.ts` (`loadGoldenDataset`).

## Procedencia — v1 (Fase 9.0, TSK-206)

- `dataset.json`: **30 casos**, `labeledBy: "llm-panel-2026-08/model-1"`.
- El desarrollador NO es jugador competitivo de Dota — las etiquetas vienen de un **panel de LLMs
  frontier** razonando cada estado, no de un experto humano. Ver
  [ADR-005](../../docs/adr/ADR-005-etiquetado-del-golden-dataset-por-panel-de-llms.md).
- **v1 es de un solo modelo.** Prompt: `docs/research/tsk-206-golden-research-prompt.md`. Fuente
  cruda: `docs/research/tsk-206-golden-model-1.txt`.
- Cobertura: los 4 contextos de decisión + 6 de los 7 estratos (`hard_counter` 12, `flexibility` 5,
  `team_needs` 5, `punishability` 4, `composition` 3, `role_scarcity` 1; `historical_failure` 0 —
  toda la muestra de replay ya es un fallo histórico de V6, el estrato es redundante acá).
- **Ampliación (9.1)**: escalar a 60–100 casos con 2+ modelos y reconciliación (coincidencia de
  2+ → firme; conflicto → conservador o disputado). Al re-etiquetar, se re-congela
  `eval/baselines/v6-measured.json` en el mismo cambio.

## Cómo se etiqueta un caso

- **Multi-label**: varios héroes `excellent`/`acceptable`/`bad`, cada uno con un `why` obligatorio
  (mecánica concreta). `excellent` nunca vacío. Un héroe no puede estar en dos listas.
- Un héroe **no etiquetado** es *desconocido*, no `bad` — el Benchmark A lo excluye del
  denominador de Bad Pick Rate.
- `strata` (≥1): `hard_counter`, `flexibility`, `role_scarcity`, `team_needs`, `composition`,
  `punishability`, `historical_failure`.
- `source`: `replay` (draft pro real, `matchId`/`turnIndex`) o `synthetic` (construido a mano).

## Regla de test

**Ninguna prueba lee el CONTENIDO de estos archivos.** Única excepción:
`scripts/eval/golden-dataset.smoke.test.ts` valida la **forma** del `dataset.json` real
(`rejected.length === 0`, `cases.length >= 30`, cobertura de contexto y estrato) — nunca *qué*
héroe está en *qué* lista.
