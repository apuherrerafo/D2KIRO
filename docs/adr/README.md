# Architecture Decision Records

Una decisión arquitectónica por archivo. **Inmutables**: una ADR no se edita para cambiar de
opinión — se escribe una ADR nueva que la supersede y se marca la vieja `Estado: superada por
ADR-NNN`.

Nivel **L1** en la jerarquía de autoridad (ver [ADR-001](ADR-001-jerarquia-de-autoridad.md)):
gana sobre `architecture.md`, `SPEC.md`, el código y la investigación; sólo la ceden los
contratos duros (L0: `verify-simplicity.sh`, hooks).

## Formato

```
# ADR-NNN — <título en una línea>

**Estado**: propuesto | aceptado | superada por ADR-MMM  (fecha, fase, ticket)
**Implementa**: <IDs Rx-y de docs/research/, si aplica>

## Contexto
## Decisión
## Alternativas consideradas
## Consecuencias
```

## Índice

| ADR | Título | Estado |
|---|---|---|
| [001](ADR-001-jerarquia-de-autoridad.md) | Jerarquía de autoridad de las fuentes de verdad (L0–L6) | aceptado |
| [002](ADR-002-el-pick-profesional-no-es-ground-truth.md) | El pick profesional no es ground truth; el backtest es comparativo | aceptado |
| [003](ADR-003-frontera-curated-generated.md) | Frontera `data/curated/` vs `data/generated/` | aceptado |
| [004](ADR-004-percentiles-empiricos-cutover-diferido.md) | Calibración por percentiles empíricos, cutover diferido al gate de 9.1 | aceptado |
| [005](ADR-005-etiquetado-del-golden-dataset-por-panel-de-llms.md) | El Golden Dataset v1 se etiqueta con un panel de LLMs, no con un experto humano | aceptado |
