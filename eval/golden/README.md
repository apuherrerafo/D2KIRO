# `eval/golden/` — Golden Dataset (Benchmark A, Engine Quality)

Casos de estado de draft **etiquetados a mano** por el experto de dominio. Es el benchmark
**principal** de calidad del motor (SPEC.md §15.4.3). Esquema:
[`data/schemas/golden.schema.json`](../../data/schemas/golden.schema.json). Loader validado:
`scripts/eval/golden.ts` (`loadGoldenDataset`).

## Cómo se etiqueta un caso

- **Multi-label, no "el pick correcto".** Para un estado dado, se marcan **varios** héroes como
  `excellent`, `acceptable` y `bad`, cada uno con un `why` **obligatorio** que explica el criterio.
- `excellent` nunca puede estar vacío. Un héroe no puede estar en dos listas a la vez.
- Un héroe **no etiquetado** es *desconocido*, no `bad` — el Benchmark A lo excluye del
  denominador de Bad Pick Rate.
- `strata` (≥1): a qué situación estratégica pertenece el caso — `hard_counter`, `flexibility`,
  `role_scarcity`, `team_needs`, `composition`, `punishability`, `historical_failure`.
- `reasoningTags`: etiquetas libres para agrupar casos por criterio de razonamiento.
- `source`: `replay` (viene de un draft pro real, con `matchId`/`turnIndex`) o `synthetic`
  (construido a mano para cubrir un estrato que el corpus no tiene).

## Cómo se construye

`scripts/eval/propose-golden-cases.ts` (TSK-204) **propone** los ~30 estados más informativos
(cobertura de estratos, desacuerdo entre baselines, fallos históricos de V6, escenarios
sintéticos). El humano **cura sobre esa propuesta** — no inventa estados de cero, y no acepta la
propuesta sin revisar. La curación final ocurre en TSK-206.

## Regla de test

**Ninguna prueba lee estos archivos.** El Golden Dataset se cura y crece; un test atado a su
contenido se rompería con cada ampliación. Los tests de `golden.ts` usan fixtures inline. La única
excepción (TSK-206) valida la *forma* del archivo real (`rejected.length === 0`,
`cases.length >= 30`, cobertura de estratos), nunca *qué* héroe está en *qué* lista.
