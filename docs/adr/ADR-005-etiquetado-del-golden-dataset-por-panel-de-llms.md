# ADR-005 — El Golden Dataset v1 se etiqueta con un panel de LLMs, no con un experto humano

**Estado**: aceptado (2026-08-30, Fase 9.0, `TSK-206`)
**Implementa**: `D8`, `R2-13` (`docs/specs/SPEC.md` §15.4.4)
**Relacionado**: [ADR-002](ADR-002-el-pick-profesional-no-es-ground-truth.md)

## Contexto

El Benchmark A (Engine Quality) necesita una CLAVE DE RESPUESTAS: para ~30 estados de draft,
qué héroes son `excellent` / `acceptable` / `bad` y por qué. El SPEC asumía que la etiquetaba el
"experto de dominio" (el desarrollador). El desarrollador **no es jugador competitivo de Dota** —
justamente por eso construye el coach. Pedirle que etiquete de memoria produciría una clave de
respuestas peor que ninguna.

## Decisión

- El Golden Dataset **v1** se etiqueta con un **panel de LLMs frontier** razonando cada estado de
  draft (bans, picks, contexto, y la recomendación actual del motor como referencia), guiados por
  un prompt estructurado (`docs/research/tsk-206-golden-research-prompt.md`).
- **v1 es de un solo modelo** (`docs/research/tsk-206-golden-model-1.txt`), por decisión explícita
  del usuario tras revisar la calidad de la primera pasada. `labeledBy` en el dataset lo declara:
  `"llm-panel-2026-08/model-1"`.
- Cuando se amplíe (9.1 prevé escalar a 60–100 casos, SPEC §15.4.4), se suman 2+ modelos y se
  reconcilia: coincidencia de 2+ → etiqueta firme; conflicto → opción conservadora o el caso se
  marca disputado / se descarta.
- La fuente cruda (`docs/research/tsk-206-golden-model-1.txt`) y el compilador
  (`scratchpad`, no versionado) quedan como registro auditable. El `dataset.json` es el artefacto,
  la fuente cruda es la evidencia.

## Alternativas consideradas

- **Etiquetado por el desarrollador.** Rechazada: no tiene el conocimiento de dominio, y el SPEC
  lo asumía por error.
- **Derivar las etiquetas del pick profesional del corpus.** Rechazada por [ADR-002](ADR-002-el-pick-profesional-no-es-ground-truth.md):
  el pick pro no es ground truth y ya se mide aparte (Benchmark B).
- **Contratar/consultar un analista de Dota humano.** Válido a futuro, pero fuera del alcance y el
  timing de 9.0. El panel de LLMs es una aproximación razonable para un baseline v1.
- **Esperar a tener 3 modelos antes de congelar.** El usuario decidió congelar con 1 tras ver que
  las 30 respuestas eran de alta calidad, internas consistentes, y validaron sin rechazos. La
  reconciliación multi-modelo se hace al ampliar en 9.1.

## Consecuencias

- El `v6-measured.json` de Fase 9.0 es el baseline "V6-medido" real, **con la salvedad de que su
  Benchmark A depende de una clave de respuestas de un solo modelo**. Cualquier lectura de
  NDCG@5 / Bad Pick Rate@5 la arrastra.
- El `gate.ts` de 9.1+ compara contra este baseline; si 9.1 re-etiqueta el Golden con un panel,
  re-congela `v6-measured.json` en el mismo cambio (el `commit`/`splitHash` del baseline lo hacen
  rastreable).
- Ninguna prueba lee el `dataset.json` real salvo un smoke test de **forma** (nunca de contenido):
  `rejected.length === 0`, `cases.length >= 30`, cobertura de contexto/estrato. Excepción
  explícita a la regla S17.
