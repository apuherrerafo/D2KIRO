---
description: Costuras de prueba (S1-S6) — qué es real y qué se reemplaza en cada prueba, SPEC.md §1
globs: apps/engine/**/*.test.ts,apps/engine/**/*.spec.ts,apps/web/**/*.test.ts,apps/web/**/*.spec.ts
alwaysApply: false
---

Definidas **antes** que el comportamiento (regla de `/blueprint`). Si un componente no aparece
aquí, no está listo para implementarse — no se escribe una prueba que no respete su costura.

| Costura | Frontera | Real en la prueba | Se reemplaza |
|---|---|---|---|
| **S1** — Contrato de eventos de draft | Capturador → Motor | El reductor de estado completo | El capturador: `DraftEventEnvelope` grabados en fixtures |
| **S2** — `MetaProvider` | Motor → datos de meta | El motor de sugerencias completo | El proveedor: `FakeMetaProvider` en memoria. **Cero red en las pruebas del motor.** |
| **S3** — `SignalScorer` | Motor → cada señal | Nada más — cada scorer se prueba solo, como función pura | Nada. Entrada `(DraftState, HeroId, MetaSnapshot)`, salida `SignalContribution` |
| **S4** — `applyDraftEvent` | Reductor de estado | Función pura, sin I/O, sin reloj propio | El reloj y los ids se inyectan como parámetros |
| **S5** — Transporte WebSocket | Motor → Frontend | El store de Zustand y los componentes de la vista de draft | El socket: `FakeSocket` emitiendo `ServerMessage` tipados |
| **S6** — Sincronización de meta | OpenDota → SQLite | El mapeo y la escritura en SQLite | El cliente HTTP: respuestas de OpenDota grabadas en fixtures |
| **S7** — Cálculo del pool propuesto (fase 1b) | OpenDota → propuesta de pool | El filtro por mínimo, el suavizado, el orden por winrate y el corte en 5 — función pura | El cliente HTTP: respuestas de `/players/{id}/heroes` grabadas en fixtures. **Cero red en las pruebas.** |
| **S8** — Persistencia y edición del pool (fase 1b) | `apps/web` (configuración) → `apps/engine` → SQLite | La validación en el borde, el reemplazo transaccional y la lectura vía Drizzle, contra una SQLite en memoria | Nada más. `POST /calculate` no participa: leer/escribir el pool nunca llama a la red |

`hero_pool_fit` (fase 1b) no estrena costura propia — es un `SignalScorer` más, cae en **S3** tal
cual (función pura, su propio archivo de prueba, aislado de los otros cuatro).

## Reglas derivadas
- Ninguna prueba del motor de sugerencias (S2, S3) hace una llamada de red real — siempre
  `FakeMetaProvider` o fixtures.
- Las pruebas de `applyDraftEvent` (S4) nunca dependen de `Date.now()` real ni de un generador de
  ids no determinista — se inyectan valores fijos para que la prueba sea reproducible.
- Las pruebas de la vista de draft (S5) usan `FakeSocket`, nunca un WebSocket real contra
  `apps/engine` corriendo.
- Las pruebas de sincronización (S6) usan respuestas grabadas de OpenDota — nunca dependen de que
  la API esté arriba en el momento de correr `bun test`.
- Cada `SignalScorer` (S3) tiene su propio archivo de prueba, aislado de los otros tres — un
  cambio en `counter` nunca debe poder romper la prueba de `role_gap`. `hero_pool_fit` (fase 1b)
  sigue la misma regla frente a las otras cuatro.
- Las pruebas de S7 (fase 1b) usan respuestas grabadas de `/players/{id}/heroes` — nunca dependen
  de que OpenDota esté arriba, mismo principio que S6.
- La prueba de regresión cero de `mix.ts` (fase 1b, `SCORING_WEIGHTS_V2`) compara números exactos
  contra `SCORING_WEIGHTS_V1`, no solo "el comportamiento no cambió" a ojo.
