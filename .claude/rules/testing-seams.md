---
description: Costuras de prueba (S1-S19)
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
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
| **S9** — `HeroCapabilities` (Fase 2, caminos de draft) | `capabilities.json` (borrador curado a mano) → `draft-paths/build-paths.ts` | La lógica de detección de gaps y scoring por arquetipo — función pura | El archivo real: `heroCapabilities` inyectable en `AppDeps` (mismo patrón que `db`/`openDotaClient`), con un fixture propio y determinístico en las pruebas de integración. `capabilities.json` real sigue siendo un borrador editable — ninguna prueba puede depender de su contenido exacto sin romperse en silencio con cada corrección |
| **S10** — `HeroPositions` (Fase 3, `position_fit`) | `hero-positions.json` (dato curado por parche) → `signals/position-fit.ts` | La lógica de cobertura, necesidad, timing y mezcla — función pura | El archivo real: `heroPositions` inyectado vía `createPositionFitScorer(positions)` y vía `BuildSuggestionsOptions.heroPositions` para las pruebas de integración. **Ninguna prueba puede depender del contenido real de `hero-positions.json`** — ese archivo se regenera con cada parche grande, un test atado a su contenido se rompería en silencio con cada actualización (mismo criterio literal que S9, y misma razón) |
| **S11** — Identidad Steam (Fase 5, login OpenID) | Steam (`check_authentication`) → `apps/web` (`lib/steam-openid.ts`) | La lógica de verificación de firma, anclaje de host, y conversión SteamID64→Steam32 — funciones puras dado un payload `openid.*` | Steam mismo: fixtures **grabados** de respuestas reales de `check_authentication` (`is_valid:true`/`is_valid:false`, malformadas, con host distinto). **Cero red real en las pruebas** — mismo principio que S6/S7 |
| **S13** — Token interno de cuenta (Fase 5, `x-account-token`) | `apps/web` (acuñado) → `apps/engine` (`server/account-token.ts`, verificado) | La verificación completa: forma, firma, ventana, rango de `accountId`, nonce — función pura | El reloj y el store de nonces se inyectan como parámetros (mismo principio que S4 con `applyDraftEvent`) — ninguna prueba depende de `Date.now()` real ni de un store de nonces compartido entre tests. Costura **S12 salteada a propósito**: ya reservada por Fase 4 (§11.10) para el RNG de diversificación |

`hero_pool_fit` (fase 1b) no estrena costura propia — es un `SignalScorer` más, cae en **S3** tal
cual (función pura, su propio archivo de prueba, aislado de los otros cuatro). Los "caminos de
draft" (Fase 2, `apps/engine/src/draft-paths/`) tampoco son un `SignalScorer` — son un módulo
aparte con sus propias pruebas puras (`gaps.ts`, `build-paths.ts`, cada uno aislado), consumiendo
S9 en vez de S2.

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
- Las pruebas de S9 (Fase 2, caminos de draft) nunca dependen del contenido real de
  `capabilities.json` — usan `heroCapabilities` inyectado con un fixture propio, mismo criterio
  que S2/S6/S7 (nunca datos reales/mutables en una prueba). Un test que prueba la detección de un
  gap (`detectDraftGaps`) no prueba automáticamente que ese gap se resuelva bien
  (`filledGaps`/`scoreCandidate`) — son responsabilidades separadas, cada una necesita su propia
  prueba dedicada (hallazgo real de `@redteam` en TSK-036: un test bien nombrado sobre la función
  equivocada dejó pasar un bug real).

> Historia por fase (1b–9.1, cerradas): `docs/rules-archive/rules-testing-seams-fases-cerradas.md`. No se carga sola.

## Fase 5 — Auth & Personal Hero Pool multi-usuario (SPEC.md §12.14)

- Las pruebas de S11 nunca hacen una llamada de red real a Steam — fixtures grabados de
  `check_authentication`, incluido el caso `is_valid:false` (un callback fabricado no debe crear
  sesión, criterio 5 de SPEC.md §12.14). Misma razón que S6/S7: no depender de que Steam esté arriba
  para que `bun test` pase.
- Las pruebas de S13 inyectan reloj y nonce — **dos pruebas de replay, no una** (criterio 6): un
  token reenviado dentro de su ventana de 60 s se rechaza como `replayed_account_token`; uno
  reenviado fuera de la ventana, como `expired_account_token`. Un solo test de "token vencido"
  pasaría igual con anti-replay inexistente — mismo tipo de hallazgo que ya costó TSK-036.
- **Prueba dedicada obligatoria para la conversión SteamID64→Steam32 con `BigInt`** (criterio 10):
  documenta, en el mismo test, el valor que daría la conversión ingenua con `Number()` junto al
  valor correcto — sin este contraste explícito, un refactor futuro puede reintroducir el bug sin
  que ningún test lo note (la aritmética con `Number` no lanza, solo da un resultado distinto).
- **El vector de prueba de `x-account-token` (SPEC.md §12.6) es un candado compartido, no una
  prueba más**: la misma firma HMAC debe reproducirse en `apps/web` (donde se acuña) y en
  `apps/engine` (donde se verifica) — criterio 9, mismo tipo de candado que ya usa el proyecto para
  el espejo de `SignalId` entre procesos.
- El aislamiento entre cuentas (criterio 2) se prueba contra `buildSuggestions`/`buildMetaSnapshot`
  completos, **con dos cuentas cacheadas a la vez** — nunca solo contra la query aislada. Mismo
  principio que ya exige el candado de regresión de Fase 3 contra el pipeline completo, no la señal
  sola.
- Ninguna prueba de esta fase depende de `capabilities.json`/`hero-positions.json` real ni cambia
  ninguna fórmula de scoring existente (SPEC.md §12.15-F) — Fase 5 no reabre S9/S10.

