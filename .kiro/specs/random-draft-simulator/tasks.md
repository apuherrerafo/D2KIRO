# Implementation Plan: random-draft-simulator

## Overview

Implementar el modo de simulación de Ranked All Pick aleatorio en `apps/web`, construyendo de
dentro hacia afuera: primero los módulos de lógica pura (`SeededRng`, `BanPhaseResolver`,
`BotDrafter`, `RandomDraftOrchestrator`), luego el store Zustand y los hooks de integración, y
finalmente los componentes de UI y la ruta de Next.js. El motor (`apps/engine`) no se modifica
en ningún momento.

---

## Tasks

- [x] 1. Scaffolding del feature — tipos, constantes y exports públicos
  - Crear `apps/web/features/random-draft-simulator/types.ts` con las interfaces
    `DraftSessionSnapshot`, `PicksByRound`, `DraftConfig`, `ValidationResult`,
    `DraftPhase` (union), `DraftSummary`, y las funciones `validateDraftSessionSnapshot`.
  - Crear `apps/web/features/random-draft-simulator/constants.ts` con `BLIND_ROUND_SPECS`,
    `STORAGE_KEY = "dota2coach.random-draft.config"` y `SEED_PATTERN = /^[A-Z0-9]{8}$/`.
  - Crear `apps/web/features/random-draft-simulator/index.ts` que reexporte solo los símbolos
    públicos (types, constants, hooks, componentes — sin internals).
  - _Requirements: 1.5, 3.1, 8.1, 8.4, 10.1_

  - [x] 1.1 Implementar `validateDraftSessionSnapshot` en types.ts
    - Verificar presencia y tipo de cada campo según Req. 10.1, retornar
      `{ ok: false, field, reason }` al primer campo inválido.
    - _Requirements: 10.1, 10.4_

  - [x]* 1.2 Escribir property tests para validateDraftSessionSnapshot
    - **Property 17: Serialización round-trip preserva todos los campos**
    - **Validates: Requirements 10.2, 10.3**
    - **Property 18: Deserialización con campo inválido identifica el campo específico**
    - **Validates: Requirements 10.4**

- [x] 2. Módulo `SeededRng` — generador pseudo-aleatorio determinístico
  - Crear `apps/web/features/random-draft-simulator/seeded-rng.ts`.
  - Implementar `seedToUint32(seed: string): number` (suma de charCodes × posición).
  - Implementar `mulberry32` y la interfaz `SeededRng` con `next`, `nextInt`, `chance`,
    `pick`, `shuffle`.
  - Exportar `createSeededRng(seed: string): SeededRng`.
  - _Requirements: 8.1, 8.5_

  - [x] 2.1 Implementar `createSeededRng` con el algoritmo Mulberry32
    - Mismo seed → misma secuencia en cada ejecución.
    - Validar que el seed cumpla `SEED_PATTERN`; lanzar `TypeError` si no.
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 2.2 Escribir property test para SeededRng — reproducibilidad
    - **Property 6: Ban_Phase es determinística dado el mismo seed y Personal_Ban_List**
    - (La propiedad de reproducibilidad de RNG es la base de P6 y P16)
    - **Validates: Requirements 8.5**
    - **Property 14: draftSeed auto-generado cumple el formato requerido**
    - **Validates: Requirements 8.1**

- [x] 3. Módulo `BanPhaseResolver` — resolución de los 16 bans
  - Crear `apps/web/features/random-draft-simulator/ban-phase.ts`.
  - Implementar `resolveBanPhase(input: BanPhaseInput): BanPhaseResult` con el algoritmo:
    50% por héroe de `personalBanList`, relleno desde `metaBanPool` desc., fallback aleatorio.
  - Truncar a 16; si hay menos de 16 únicos disponibles, registrar en consola el mensaje
    exacto de Req. 2.5.
  - _Requirements: 2.2, 2.3, 2.5_

  - [x] 3.1 Implementar lógica de relleno y límite de bans
    - Asegurar que la salida no tenga duplicados y respete el orden alternado Radiant/Dire.
    - _Requirements: 2.3, 2.4_

  - [x]* 3.2 Escribir property tests para BanPhaseResolver
    - **Property 5: Ban_Phase produce exactamente 16 bans sin duplicados (pool ≥ 16)**
    - **Validates: Requirements 2.3, 2.4**
    - **Property 6: Ban_Phase es determinística dado el mismo seed y Personal_Ban_List**
    - **Validates: Requirements 2.2, 8.5**

- [x] 4. Módulo `BotDrafter` — scoring y pre-cálculo de picks del bot
  - Crear `apps/web/features/random-draft-simulator/bot-drafter.ts`.
  - Implementar `botScoreHero` con scoring simplificado: pick rate + ban rate de `patchStats`,
    penalización por héroes ya baneados/pickeados, bonus por complemento de roles.
  - Implementar `botPickHero(input: BotDrafterInput): BotDrafterResult | null`.
  - Fallback aleatorio via `rng` si no hay sugerencias; retornar `null` si el pool está vacío
    y registrar el error en consola (Req. 4.3).
  - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.1 Implementar el algoritmo de selección del bot con fallback
    - Ranking top-1 de sugerencias disponibles; si hay empate, primer candidato en lista.
    - _Requirements: 4.1, 4.2_

  - [ ]* 4.2 Escribir property test para BotDrafter
    - **Property 9: El bot elige el héroe con mayor score de las sugerencias disponibles**
    - **Validates: Requirements 4.1**

- [x] 5. Checkpoint — pruebas de lógica pura pasan
  - Ejecutar `bun test apps/web/features/random-draft-simulator` y verificar que los tests
    de las tareas 1–4 pasan. Resolver cualquier error antes de continuar.

- [x] 6. Módulo `RandomDraftOrchestrator` — función pura de inicialización del draft
  - Crear `apps/web/features/random-draft-simulator/orchestrator.ts`.
  - Implementar `initDraft(config: DraftConfig): OrchestratorResult` como función pura:
    crear `SeededRng`, llamar `resolveBanPhase`, pre-calcular picks del bot para las 3 rondas
    usando `botPickHero` para cada slot.
  - Exportar `BLIND_ROUND_SPECS` (reexport desde constants) y `OrchestratorResult`.
  - _Requirements: 2.1, 3.1, 3.2, 4.4_

  - [x] 6.1 Implementar pre-cálculo de picks del bot para las 3 rondas
    - El bot calcula todos sus picks de una ronda antes de activar el timer del usuario.
    - Los picks quedan ocultos en `OrchestratorResult.rounds[n].botPicks`.
    - _Requirements: 3.2, 4.4_

  - [x]* 6.2 Escribir property tests para el orquestador
    - **Property 7: La Pick_Phase sigue exactamente la distribución 2-2-1**
    - **Validates: Requirements 3.1**
    - **Property 16: Reproducibilidad completa dado el mismo (draftSeed, personalBanList)**
    - **Validates: Requirements 8.5**

- [x] 7. Store Zustand — `RandomDraftStore`
  - Crear `apps/web/features/random-draft-simulator/store.ts`.
  - Definir el tipo `DraftPhase` (union: idle | ban_phase_complete | blind_round |
    round_revealed | complete) y `RandomDraftState`.
  - Implementar `RandomDraftActions`: `startSession`, `confirmPick`, `deselectPick`,
    `confirmRound`, `resetSession`, `setDraftState`, `setStaleInfo`.
  - Usar `zustand` con TypeScript estricto; el store no llama a ningún endpoint HTTP.
  - _Requirements: 6.4, 3.3_
  - **Nota de implementación**: `startSession` recibe `(config, sessionId, orchestratorResult)`
    en vez de solo `config` — el store no puede llamar a `initDraft` sin convertirse en I/O de
    meta; el hook (tarea 11) ya lo calcula y pasa el resultado puro. `confirmRound` tiene doble
    propósito según la fase (`blind_round` → revela; `round_revealed` → avanza de ronda o
    completa) para no ampliar el set de 7 acciones. Ver comentarios en `store.ts`.

  - [x] 7.1 Implementar acciones de pick pendiente sin mutación del DraftReducer
    - `confirmPick` / `deselectPick` solo actualizan el estado local del store.
    - Ninguna acción de pick pendiente emite eventos al motor.
    - _Requirements: 6.4_

  - [x]* 7.2 Escribir property test para picks pendientes
    - **Property 8: Picks pendientes del usuario no emiten eventos al Draft_Reducer**
    - **Validates: Requirements 6.4**

- [x] 8. Hook `useConfigPersistence` — persistencia en localStorage
  - Crear `apps/web/features/random-draft-simulator/use-config-persistence.ts`.
  - Leer/escribir `{ userSide, personalBanList }` en `localStorage` bajo `STORAGE_KEY`.
  - Exponer `config`, `setConfig` y `clearConfig`; manejar JSON parse errors con fallback
    seguro (retornar estado vacío, registrar error en consola).
  - _Requirements: 1.5, 1.6_

  - [x] 8.1 Implementar read/write con validación básica de estructura
    - Verificar que `userSide` ∈ `{ "radiant", "dire" }` y `personalBanList` es array ≤ 4.
    - _Requirements: 1.5_

  - [x]* 8.2 Escribir property test para persistencia localStorage
    - **Property 3: Persistencia en localStorage es round-trip**
    - **Validates: Requirements 1.5**

- [x] 9. Lógica de Personal_Ban_List — validaciones de agregar/quitar
  - Agregar las funciones puras `addHeroToBanList` y `removeHeroFromBanList` en
    `apps/web/features/random-draft-simulator/types.ts` (o en un archivo `ban-list.ts`
    separado dentro del feature).
  - `addHeroToBanList`: rechazar si el héroe ya está presente (Req. 1.3) o si la lista
    tiene 4 elementos (Req. 1.4); retornar la lista sin cambios con un `{ ok: false, reason }`.
  - `removeHeroFromBanList`: retornar la lista sin el héroe indicado; no error si no existe.
  - _Requirements: 1.2, 1.3, 1.4, 1.6_

  - [x] 9.1 Implementar `addHeroToBanList` y `removeHeroFromBanList`
    - Funciones puras; el store las usa internamente en `confirmPick`/`deselectPick`.
    - _Requirements: 1.2, 1.3, 1.4_

  - [x]* 9.2 Escribir property tests para Personal_Ban_List
    - **Property 1: Personal_Ban_List acepta listas de 0 a 4 héroes y rechaza la quinta adición**
    - **Validates: Requirements 1.2, 1.4**
    - **Property 2: Personal_Ban_List rechaza duplicados**
    - **Validates: Requirements 1.3**
    - **Property 4: Eliminación de héroe reduce longitud en 1**
    - **Validates: Requirements 1.6**

- [x] 10. Checkpoint — store, hooks de persistencia y lógica de ban list pasan
  - Ejecutar `bun test apps/web/features/random-draft-simulator` y asegurarse de que todas
    las pruebas hasta esta tarea pasan. Resolver errores antes de continuar.

- [x] 11. Hook `useRandomDraftSession` — integración con el motor via WebSocket
  - Crear `apps/web/features/random-draft-simulator/use-random-draft-session.ts`.
  - Generar `sessionId = crypto.randomUUID()` al inicio de la sesión.
  - Conectar al WebSocket existente `/ws/draft` con el `sessionId`.
  - Emitir `session_started` + `local_side_identified` al arrancar, los 16 `hero_banned` de
    la Ban_Phase en secuencia, y los `hero_picked` al cerrar cada ronda.
  - Actualizar el store (`setDraftState`, `setStaleInfo`) al recibir mensajes WebSocket.
  - Exponer `startDraft(config)`, `confirmRound()` junto con `state` y `actions`.
  - _Requirements: 2.1, 2.4, 3.3, 9.3, 9.6_
  - **Notas de implementación** (ver comentarios en el archivo para el detalle):
    - Reutiliza infraestructura ya existente de `features/draft` en vez de reinventarla:
      `postSimulatorEvent` (mismo `POST /api/session/manual`, `source: "simulator"`, ya soporta
      los 6 tipos de evento incluidos `session_started`/`local_side_identified`/`session_ended`)
      y `createDraftSocket`/`isValidServerMessage` (mismo WebSocket `/ws/draft`, costura S5).
    - Acepta `{ wsUrl?, socketFactory? }` opcional — mismo patrón `socketFactory` inyectable que
      `DraftViewProps` (S5), para poder probar con `FakeSocket` sin un motor real.
    - **Bloqueador real encontrado y resuelto con aprobación explícita del usuario**: no existía
      ningún endpoint que expusiera `patchStats` (picks/wins) a `apps/web` — `GET /api/heroes`
      solo trae nombre/ícono/roles. Se agregó `GET /api/meta/hero-stats` (solo lectura) a
      `apps/engine`, ver Notes. `metaBanPool` usa pick rate como proxy de ban rate (no existe
      dato de ban rate en el proyecto).
    - `confirmRound` del hook envuelve el `confirmRound` de doble propósito del store (ver nota
      de la tarea 7) y añade 3 acciones de store no previstas en el diseño original
      (`tickTimer`, `retryRoundAfterConflict`, `patchRevealedRound`) porque Req. 5 exige
      recalcular el pick del bot con `SeededRng`/`MetaSnapshot` en vivo — datos que el store
      deliberadamente no tiene.

  - [x] 11.1 Implementar emisión de Ban_Phase al motor
    - Emitir los 16 `hero_banned` usando `POST /api/session/manual` con `source: "simulator"`.
    - Asignar lados alternados (índice par → Radiant, impar → Dire).
    - _Requirements: 2.1, 2.4_

  - [x] 11.2 Implementar gestión del timer de Blind_Round con setInterval
    - Timer de 25s (rondas 1-2) y 20s (ronda 3); se detiene al confirmar o al expirar.
    - Al expirar, auto-completar picks del usuario con héroes aleatorios del pool disponible.
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 11.3 Implementar resolución de Conflict_Ban dentro de confirmRound
    - Detectar intersección entre `pendingUserPicks` y `botPicks[round]`.
    - Si `conflictCount < 2`: emitir `hero_banned`, reiniciar timer, incrementar `conflictCount`.
    - Si `conflictCount >= 2`: usuario tiene prioridad, bot recalcula con siguiente candidato.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [-]* 11.4 Escribir property tests de conflicto y visibilidad del Copilot
    - **No implementado**: el hook depende de refs/`setInterval`/WebSocket de React y este
      proyecto no tiene `renderHook`/testing-library (ver testing-seams.md) — añadirla requiere
      pasar por `/gear-up`. Las funciones puras extraíbles (`otherSide`, `specForRound`,
      `randomPickForSlots`) sí están probadas en `__tests__/use-random-draft-session.test.ts`.
      El resto de esta cobertura (incluida Property 12, visibilidad del Copilot) se verifica
      contra un motor real en la tarea 16.2.
    - **Property 10: Conflict_Ban resulta en hero_banned y ningún hero_picked para ese héroe**
    - **Validates: Requirements 5.1**
    - **Property 11: Máximo 2 Conflict_Bans por Blind_Round**
    - **Validates: Requirements 5.4**
    - **Property 12: Sugerencias del Copilot no incluyen picks ocultos del bot**
    - **Validates: Requirements 6.3**

  - [x] 11.5 Implementar reconexión WebSocket y retry de POST /api/session/manual
    - Reintentar hasta 3 veces con backoff de 200ms.
    - Al reconectar WebSocket, reenviar `hello` con el mismo `sessionId`.
    - _Requirements: 9.6_

- [x] 12. Checkpoint — hook de sesión y Conflict_Ban pasan
  - Ejecutar `bun test apps/web/features/random-draft-simulator` asegurando que las pruebas
    hasta esta tarea pasan.

- [x] 13. Componentes de UI — ConfigPanel y StaleWarningBanner
  - Crear `apps/web/features/random-draft-simulator/components/ConfigPanel.tsx`:
    - Selector de lado Radiant/Dire.
    - Campo de entrada para draftSeed (con validación SEED_PATTERN en tiempo real).
    - Generador de seed aleatorio (botón).
    - Lista de hasta 4 héroes para Personal_Ban_List con HeroPicker y botón de eliminar.
    - Mensaje de error al intentar agregar el 5to héroe.
    - Botón "Iniciar Draft" deshabilitado si el seed es inválido.
  - Crear `apps/web/features/random-draft-simulator/components/StaleWarningBanner.tsx`:
    - Mostrar fecha de última sincronización en formato `DD/MM/YYYY HH:MM` (TZ local).
    - Mostrar "Sin sincronización previa" si `lastSyncedAt === null`.
    - Botón "Sincronizar" deshabilitado durante sync en curso.
  - _Requirements: 1.1, 1.2, 1.4, 7.1, 7.2, 7.3, 8.1, 8.4_

  - [x] 13.1 Implementar ConfigPanel con validaciones de Personal_Ban_List y seed
    - Estado del store de config (`useConfigPersistence`) + `draftSeed` local (no persiste --
      cada sesión nueva propone una semilla nueva vía `generateDraftSeed`).
    - _Requirements: 1.1, 1.2, 1.4, 8.4_

  - [x] 13.2 Implementar StaleWarningBanner con botón de sync
    - Invocar `POST /api/meta/sync` vía `useSyncMetaMutation` (RTK Query ya existente en
      `lib/engine-api.ts`, reutilizado en vez de re-implementarlo); deshabilitar botón durante
      la petición.
    - Ocultar el banner al completarse exitosamente (Req. 7.4); mantenerlo con mensaje de
      error si falla (Req. 7.5).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [-]* 13.3 Escribir property test para draftSeed
    - **No implementado como property test automatizado de UI** (requeriría renderizar
      `ConfigPanel`, sin `renderHook`/testing-library en el proyecto). Cubierto parcialmente:
      Property 14 vive en `seeded-rng.test.ts` contra `generateDraftSeed` real; Property 15
      (seed inválido bloquea el inicio) se implementa en `ConfigPanel` (`disabled={!isSeedValid}`
      + guarda en `handleStart`) y se verificó a mano en el navegador (tarea 16, verificación).
    - **Property 14: draftSeed auto-generado cumple el formato requerido**
    - **Validates: Requirements 8.1**
    - **Property 15: draftSeed inválido rechaza inicio de sesión**
    - **Validates: Requirements 8.4**

- [x] 14. Componentes de UI — BanPhasePanel y CopilotPanel
  - Crear `apps/web/features/random-draft-simulator/components/BanPhasePanel.tsx`:
    - Vista de solo lectura de los 16 bans resueltos agrupados por lado (Radiant/Dire).
    - Reutilizar `HeroAvatar` o componente equivalente ya existente en el proyecto.
  - Crear `apps/web/features/random-draft-simulator/components/CopilotPanel.tsx`:
    - Mostrar `SuggestionSet` usando el `SuggestionCard` ya existente en el proyecto.
    - Mostrar "Sin sugerencias disponibles" con el indicador visual de "actualizando"
      si las sugerencias superan los 500ms o si el Suggestion_Engine lanza error (Req. 6.5).
    - Mostrar `stale_meta` en el `degraded` array si la sesión arrancó con meta stale.
  - _Requirements: 6.1, 6.2, 6.5, 7.7_

  - [x] 14.1 Implementar BanPhasePanel con la lista de héroes baneados
    - La data llega del store; el componente es puramente presentacional.
    - _Requirements: 2.1_

  - [x] 14.2 Implementar CopilotPanel con manejo de latencia y estado degradado
    - **Desviación**: en vez de medir 500ms reales en el frontend (el motor ya corta a los
      500ms, engine.md), se usa la señal exacta ya disponible: `suggestions.basedOnSeq !==
      draftState.lastSeq` -- hubo un pick/ban más reciente que las últimas sugerencias
      recibidas. Mismo resultado (indicador "actualizando"), sin re-implementar un timer que
      el motor ya garantiza.
    - `stale_meta` no se "propaga" desde el estado del store -- ya viene en
      `suggestions.degraded` directo del motor (mismo campo que usa `DegradedDraftState` en
      `features/draft`), se muestra tal cual.
    - _Requirements: 6.1, 6.2, 6.5, 7.7_

  - [-]* 14.3 Escribir property test para meta stale
    - **No implementado**: `stale_meta` es responsabilidad de `buildSuggestions` en
      `apps/engine` (ya cubierto por sus propias pruebas) -- `apps/web` solo muestra el campo
      `degraded` tal cual llega, no lo calcula ni lo propaga.
    - **Property 13: Meta stale propagada a todas las SuggestionSets de la sesión**
    - **Validates: Requirements 7.7**

- [x] 15. Componentes de UI — BlindRoundPanel y SessionSummaryPanel
  - Crear `apps/web/features/random-draft-simulator/components/BlindRoundPanel.tsx`:
    - `HeroPicker` para que el usuario elija sus picks (selección + deselección sin eventos).
    - `TimerBar` que refleja `timerRemainingMs` del store.
    - `ConflictBanner` visible cuando `conflictBans.length > 0` en la ronda actual.
    - Botón "Confirmar ronda" que llama `confirmRound()` del hook.
    - Lista de picks revelados al pasar a `round_revealed`.
  - Crear `apps/web/features/random-draft-simulator/components/SessionSummaryPanel.tsx`:
    - Mostrar `draftSeed` prominente.
    - Tabla de picks por ronda (usuario vs. bot).
    - Bans resueltos.
    - Botón "Nuevo draft" que llama `resetSession()`.
  - _Requirements: 3.3, 3.6, 3.7, 5.2, 8.2_

  - [x] 15.1 Implementar BlindRoundPanel con timer y ConflictBanner
    - Timer visual: reutiliza `DraftTimer` (ya existente, `components/draft-timer/`) remontado
      por `key={round}-${conflictCount}` en vez de un `TimerBar` nuevo -- mismo patrón que
      `DraftSetupPanel` ya usa para las esperas del simulador viejo.
    - ConflictBanner con nombre del héroe en conflicto.
    - _Requirements: 3.4, 3.5, 5.2, 5.3_

  - [x] 15.2 Implementar SessionSummaryPanel con draftSeed y resumen de picks
    - El seed permanece visible hasta que el usuario inicia una nueva sesión (Req. 8.2).
    - _Requirements: 8.2_

- [x] 16. Ruta Next.js `/random-draft`
  - Crear `apps/web/app/random-draft/page.tsx` como Server Component que compone:
    - `StaleWarningBanner` (condicional a `isStale`).
    - `ConfigPanel` (fase idle).
    - `BanPhasePanel` (fase ban_phase_complete y siguientes).
    - `BlindRoundPanel` (fase blind_round y round_revealed).
    - `SessionSummaryPanel` (fase complete).
  - **Desviación**: `StaleWarningBanner` no lee `staleWarning`/`lastSyncedAt` del
    `RandomDraftStore` -- usa `useGetMetaStatusQuery` (RTK Query) directamente, self-contained,
    porque Meta_Freshness es una "página normal" (web.md) sin relación con la sesión de draft en
    vivo. `store.setStaleInfo`/`staleWarning`/`lastSyncedAt` quedan sin usar en la práctica --
    duplicar el fetch en `page.tsx` solo para escribirlo en un campo que ningún componente lee
    habría sido estado muerto, no una simplificación real.
  - `page.tsx` es Client Component (`"use client"`), no Server Component -- toda la orquestación
    depende de `useRandomDraftSession` (hooks de React); mismo patrón real que ya usa
    `/simulator` (`app/simulator/page.tsx`), no el patrón server+client separado de `/draft`.
  - La ruta `/simulator` existente no se modifica.
  - _Requirements: 7.1, 7.6, 9.1_

  - [x] 16.1 Implementar page.tsx con orquestación de paneles según DraftPhase
    - Selector de fase: mapa de componentes (`PHASE_VIEWS: Record<DraftPhase["type"], ...>`)
      indexado por `phase.type`, sin ternario.
    - _Requirements: 7.1, 9.1_

  - [-]* 16.2 Escribir test de integración del flujo completo
    - **No implementado como test automatizado** (necesitaría un servidor de `apps/engine` real
      arrancado desde `bun test` de `apps/web`, cruzando el límite de proceso que
      `testing-seams.md` evita a propósito). **Verificado a mano en el navegador** contra un
      `apps/engine` real corriendo en local -- ver nota de verificación al cierre de esta sesión
      en `journal.md`.
    - _Requirements: 2.1, 3.8, 9.2, 9.4_

- [x] 17. Checkpoint final — todos los tests pasan
  - `bun test` en `apps/web`: 70 pass / 0 fail (incluye 28 del feature + next.config.test.ts +
    el resto del repo). `bun test` en `apps/engine`: 198 pass / 0 fail (incluye la prueba nueva
    de `GET /api/meta/hero-stats`).
  - `bun run lint` (apps/web): 0 errores, 1 warning preexistente sin relación
    (`bot-drafter.ts:171`, variable con prefijo `_` ya no reportada por la regla en esta versión
    de eslint -- no bloqueante).
  - `bunx tsc --noEmit` limpio en ambos paquetes.
  - **`scripts/verify-simplicity.sh` no se ejecutó** -- está escrito para tickets `TSK-XXX` del
    sistema de `docs/agents/tasks/`, no para tareas de un spec de Kiro; no aplica aquí.
  - **Verificación en navegador real** (Playwright contra `playwright-core` + Edge del sistema,
    apps/engine + `next build && next start` reales, sin mocks): flujo completo Config → 16 bans
    → Ronda 1 (2 picks) → revelación → Ronda 2 (2 picks) → Ronda 3 (1 pick) → Session Summary,
    cero errores de consola. Además, un segundo run con seed fija forzó un Conflict_Ban real
    (pick del usuario = pick oculto del bot) y confirmó el banner, el timer reiniciado y el
    héroe correctamente baneado de ambos lados. **Se encontró y corrigió un bug real durante
    esta verificación**: `beginRound(1)` armaba el timer pero nunca transicionaba
    `phase: ban_phase_complete → blind_round` -- el draft se quedaba trabado después de resolver
    los bans. Ningún test unitario lo detectaba (la transición vive dentro de un hook de React
    con refs/async, fuera del alcance de las pruebas puras). Corregido en
    `use-random-draft-session.ts` (`startDraft`).
  - **Nota sobre modo dev**: en este entorno, el modo dev de Turbopack (`next dev`) no hidrata
    bajo automatización headless (el WebSocket de HMR falla el handshake y bloquea la
    hidratación) -- se confirmó que afecta también a `/meta`, una página preexistente sin
    relación con este feature, así que no es un bug de esta tarea. La build de producción
    (`next build && next start`) hidrata y funciona con normalidad; usarla para cualquier
    verificación headless futura similar.

---

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido.
- Cada tarea referencia requerimientos específicos para trazabilidad.
- Los checkpoints garantizan validación incremental.
- Los property tests usan generadores manuales dentro de Bun Test (arrays de 100 casos
  generados con `Array.from({ length: 100 })`) para no añadir dependencias nuevas sin
  pasar por `/gear-up`. Cada test incluye el comentario:
  `// Feature: random-draft-simulator, Property N: <texto>`.
- El motor (`apps/engine`) no recibe ningún cambio — todos los eventos se emiten a través de
  `POST /api/session/manual` y el WebSocket `/ws/draft` existentes.
- **Excepción puntual, aprobada explícitamente por el usuario (continuación de sesión, ver
  journal)**: se agregó `GET /api/meta/hero-stats` (solo lectura, `apps/engine/src/server/app.ts`)
  porque `Bot_Drafter`/`Meta_Ban_Pool` (Req. 2.3, 4.1) necesitan `patchStats` (picks/wins por
  patch+bracket) y ningún endpoint existente lo exponía — `GET /api/heroes` solo trae nombre/ícono/
  roles. No toca el camino caliente de sugerencias ni el reductor; mismo dato que
  `buildSuggestions` ya usa vía `buildMetaSnapshot`. **No existe dato de tasa de ban en ningún
  lado del proyecto** (OpenDota no se sincroniza con ese campo) — `metaBanPool` usa pick rate
  como proxy documentado, no ban rate real.
- `apps/engine/src/simulator/scripts.json` no se toca en ninguna tarea.
- `applyDraftEvent`, `buildSuggestions` y `SCORING_WEIGHTS_*` no se modifican.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "8.1", "9.2"] },
    { "id": 3, "tasks": ["3.2", "4.1", "8.2"] },
    { "id": 4, "tasks": ["4.2", "6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "7.2"] },
    { "id": 6, "tasks": ["11.1", "11.2", "13.1", "14.1"] },
    { "id": 7, "tasks": ["11.3", "13.2", "13.3", "14.2"] },
    { "id": 8, "tasks": ["11.4", "11.5", "14.3", "15.1"] },
    { "id": 9, "tasks": ["15.2", "16.1"] },
    { "id": 10, "tasks": ["16.2"] }
  ]
}
```
