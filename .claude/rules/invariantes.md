Reglas que son verdad en **toda** fase del proyecto, pasada o futura. Si algo de acá choca con la
regla de una fase concreta, gana esto.

Existe porque hasta `TSK-218` estas reglas estaban repartidas dentro de diez narrativas de fase
(`REGLAS DE FASE 1`, `1b`, `3`, `4`, …) que se inyectaban enteras en cada turno: lo vinculante
quedaba enterrado bajo el relato de cómo se llegó ahí. Los resúmenes de fase cerrada viven ahora en
`docs/rules-archive/` — se leen cuando hacen falta, no siempre.

## Motor

- **Cero red en el camino caliente.** Nada bajo `apps/engine/src/signals/` llama a la red.
  `verify-simplicity.sh` bloquea cualquier `fetch(` ahí. Todo lo que el motor necesita ya está en
  SQLite antes del primer pick.
- **`apps/engine` escucha sólo en `127.0.0.1`.** Un binding a `0.0.0.0` es FAIL automático.
- **`raw: null` es sagrado**: significa "sin datos suficientes". Nunca es `0`, `0.5` ni `50`.
- **`applicable: false` ≠ `raw: null`.** El primero es "función que el usuario no configuró"
  (`hero_pool_fit`, `archetype_fit` sin intención); el segundo es un hueco de datos. Nunca se
  muestran con el mismo texto.
- **Una señal rota nunca tira el motor.** Un scorer que lanza cuenta como `raw: null`; las demás se
  calculan igual. Corte duro a 500 ms (presupuesto normal 300 ms).
- **Las versiones de pesos se congelan por nombre.** `SCORING_WEIGHTS_V1`…`V6` no se editan ni se
  borran jamás; una fase nueva acuña la siguiente. Prueba obligatoria en toda versión: los pesos
  suman exactamente `1.0`. **La activa hoy es `SCORING_WEIGHTS_V6`.**
- **Todo cambio de mecanismo de scoring necesita su candado de regresión cero**, con números
  concretos, no "no cambió a ojo".
- **`roles[]` de OpenDota NO son posiciones.** Para posición existe `hero-positions.json`.
- **Los datos curados se validan en el borde al cargarlos** (`loadHeroPositions`,
  `loadHeroCapabilities`, `loadHeroCounters`, `loadCalibration`). Archivo corrupto o ausente →
  degrada, **nunca lanza**, nunca inyecta magnitudes arbitrarias.
- **`applyDraftEvent` es pura**: sin I/O, sin reloj ni ids propios — se inyectan.

## Frontera `apps/engine` ↔ `apps/web`

- Los dos procesos son independientes: `apps/web` **nunca** importa tipos de `apps/engine`. Hay
  espejos a mano — `features/draft/types.ts` (`SignalId`, `SignalContribution`, `Suggestion`),
  `features/draft/validation.ts`, `features/random-draft-simulator/bot-drafter.ts`
  (`MetaSnapshot` angosto), `features/pro-drafter/types.ts`. **Se mueven en el mismo cambio que el
  motor** o `tsc` de `apps/web` rompe.
- **Código de `apps/web` que corre en el navegador nunca apunta a un loopback.** Va por el proxy
  `/engine` (`ENGINE_HTTP_BASE_URL`), cuya allowlist vive en `next.config.ts`. Verificado
  mecánicamente en `verify-simplicity.sh`. (`TSK-214`: seis call sites a `127.0.0.1:4000` fallaban
  en silencio en Railway — el motor local del desarrollador los hacía funcionar sólo en su máquina.)

## Frontend

- TypeScript estricto, prohibido `any`. Sin ternarios para render condicional, sin funciones
  anónimas inline como handlers.
- **Ningún estado silencioso.** Los 6 estados de la vista de draft existen en pantalla; una
  sugerencia de confianza baja se muestra marcada. Un fallo de transporte se ve
  (`<EngineUnreachableBanner>`), nunca es sólo un `console.error`.
- **Color por rol semántico y escala de 4 px.** Ni un hex ni un px suelto en un componente.
- **`dangerouslySetInnerHTML` prohibido** en toda la app. `img_url` de héroe: host validado contra
  la allowlist del CDN de Valve.
- Régimen de datos: RTK Query para páginas normales; WebSocket + Zustand **sólo** para el draft en
  vivo.

## Seguridad (gate, no checklist)

- **Todo input externo se valida en el borde** antes de tocar lógica de negocio — incluidos los
  JSON curados del repo y las respuestas de OpenDota.
- **Toda query pasa por Drizzle**, parametrizada. Cero SQL concatenado.
- **Los secretos viven sólo en `process.env`.** Un literal sospechoso en el diff es FAIL automático.
- **El Steam32/`accountId` es dato personal**: nunca en logs, `journal.md`, tickets, mensajes de
  error ni `/api/health`. Sale exclusivamente de un token verificado, jamás del body o el query.
- **`@redteam` es obligatorio** en cualquier cambio que toque scoring activo, auth, o abra una
  frontera de confianza.

## Pruebas

- **Ninguna prueba lee un dato curado real** (`capabilities.json`, `hero-positions.json`,
  `hero-counters.json`, `percentiles.json`, las SQLite, el Golden Dataset): fixtures inline. Esos
  archivos se regeneran por parche — un test atado a su contenido no falla al romperse el código,
  falla al cambiar el meta.
- **Cero red real** en cualquier prueba. Fixtures grabados.
- Cada `SignalScorer` tiene su archivo de prueba propio, aislado de los demás.
- **Un candado se verifica en rojo antes de darlo por bueno.** Si la prueba pasa con y sin el
  arreglo, no es un candado.
- **El comando de pruebas es `bun run test`** (las tres raíces por separado). `bun test` en la raíz
  **miente**: `@happy-dom/global-registrator` parchea el `fetch` global y contamina los tests de
  servidor del motor, produciendo ~55 fallos que no existen.
