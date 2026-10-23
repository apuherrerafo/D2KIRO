# Archivo — secciones de fase de `.claude/rules/web.md` (verbatim)

Movidas fuera de la carga automática (Etapa 2/3 de instrucciones). Narrativa de cómo se llegó a cada
regla; lo vinculante vigente vive en `.claude/rules/invariantes.md` y en el SPEC. Se leen cuando hacen falta.

## Fase 1b — Hero pool (SPEC.md §9.6)
- Configuración del pool y pantalla de propuesta/confirmación: régimen RTK Query ("páginas
  normales del sitio"), nunca WebSocket/Zustand — el hero pool no es parte de la vista de draft en
  vivo.
- La propuesta de "calcular desde mis partidas" **nunca se auto-aplica**: confirmar, editar antes
  de confirmar, o descartar son las tres únicas acciones. Descartar nunca dispara una escritura.
- `SignalBreakdown` muestra **5** señales, no 4. `applicable: false` en `hero_pool_fit` es una fila
  distinta de una señal con `raw: null` — mensajes distintos, nunca el mismo texto de "sin datos".
- Estados vacíos/de error del flujo de propuesta ("aún no calculaste nada", "ningún héroe pasa el
  mínimo", "OpenDota no respondió") explicados en llano — mismo estándar que los 6 estados de la
  vista de draft de fase 1, ninguno es un error genérico silencioso.

## Fase 2 — Draft en equipo (construida vía `/kickoff` + Codex, sin número de sección de `SPEC.md`
— documentado aquí, no ahí)
- Gestión de equipos guardados (`/team-groups`, `TeamGroupsConfig.tsx`): régimen RTK Query
  ("página normal"), mismo patrón que `HeroPoolConfig.tsx` — nunca WebSocket/Zustand.
- `partyContext` (qué equipo/tamaño de party está activo en la sesión actual) sí vive en Zustand,
  pero **no llega por WebSocket** — lo fija `DraftSetupPanel` localmente al arrancar un draft.
  Matiza la "única excepción" de arriba: Zustand es para estado de sesión de draft en vivo en
  general, no exclusivamente para datos empujados por WS.
- **Panel exploratorio + costoso de calcular → cerrado por defecto, RTK Query con `skip`**: el
  patrón de `DraftPathsCoverFlow` (Fase C) es el de referencia — `useGetDraftPathsQuery(sessionId,
  { skip: !isOpen })`, nunca se dispara la consulta hasta que el usuario abre el panel. Aplicar el
  mismo patrón a cualquier función futura que sea opcional y no forme parte del camino principal
  de "ver mi próxima sugerencia".
- Terminología de "caminos de draft": usar "le falta al draft", "win condition", "prioridades del
  equipo" — **nunca** "needs-based drafting" (no es el término real que usa la comunidad
  competitiva de Dota 2, confirmado por investigación antes de diseñar la función).

## Fase 3 — `position_fit` (SPEC.md §10.7)

- **`SignalId` en `apps/web/features/draft/types.ts` es un espejo a mano del contrato del motor**,
  no un import — los dos procesos son independientes (ya está documentado así en ese archivo).
  Cuando el motor cambia el set de señales, este espejo cambia en el **mismo** cambio o el tipado
  se rompe. Fase 3: quita `role_gap` y `role_safety`, agrega `position_fit`. **No es el único
  espejo** — `bot-drafter.ts` (Random Draft Simulator) también espeja su propia versión angosta
  de `MetaSnapshot`/`MetaHeroEntry`/`HeroPatchStat`, documentado en `engine.md` (sección Random
  Draft Simulator, hallazgo TSK-062). Un rename de campo en el motor toca los dos.
- `SignalBreakdown` pasa a mostrar **5 señales, no 6**. `SIGNAL_LABELS` pierde `"Solapamiento de
  rol"` y `"Seguridad del pick temprano"`, gana `position_fit` → **"Posición y momento del pick"**.
- La distinción entre `raw: null` y `applicable: false` que 1b introdujo se mantiene sin cambios.
  `position_fit` **solo** usa `raw: null` — nunca debe renderizarse con el texto de "función no
  configurada", que es exclusivo de `hero_pool_fit`.
- Terminología de posiciones, en castellano y consistente con cómo las nombra el usuario:
  **hard support, support, offlane, midlane, carry**. Nunca "pos 1/2/3/4/5" a secas en texto
  visible sin el nombre al lado — el número solo se usa internamente en el dato.

## Fase 4.2 — espejo de `archetype_fit` en `apps/web` (SPEC.md §11.13.6)

El motor amplía `SignalId`; `apps/web` lo espeja **en el mismo cambio** o `tsc` de `apps/web`
rompe (mismo criterio que el espejo de Fase 3). Cuatro archivos, ninguno opcional:

- **`features/draft/types.ts`**: `SignalId` += `"archetype_fit"` — espejo a mano del contrato del
  motor, nunca un import (los dos procesos son independientes).
- **`features/draft/validation.ts`**: el type guard `isSignalId` (cadena `value === …`) gana
  `|| value === "archetype_fit"`.
- **`features/draft/constants.tsx`**: `SIGNAL_DISPLAY_PRIORITY` gana `"archetype_fit"` **al
  final** — señal gruesa (3-4 niveles), menor densidad que las tácticas.
- **`components/signal-breakdown/SignalBreakdown.tsx`**: `SIGNAL_LABELS: Record<SignalId, string>`
  gana `archetype_fit: "Intención de draft"` — es un `Record` total, no compila sin la clave.
- **`SignalBreakdown` pasa a mostrar 6 filas.** Sin intención elegida, la sexta cae en la fila
  `SignalBreakdownRowNotApplicable` (TSK-026) con el `explanation` del motor ("Elegí una intención
  de draft para activar esta señal") — **nunca** el texto de "Sin datos suficientes" (exclusivo
  de `raw: null`).
- **Nada más de `apps/web` cambia en 4.2.** Sin selector de intención, sin estado en Zustand, sin
  tocar el request de sugerencias — eso es 4.3. Terminología en castellano: "intención de draft",
  nunca "arquetipo" a secas en texto visible.

## Fase 4.3 — selector de intención de draft (SPEC.md §11.14)

- **`<DraftIntentSelector>`** (nuevo, `components/draft-intent-selector/`): 4 chips
  (`Push`/`Teamfight`/`Pickoff`/`Scaling`) + affordance "Sin intención" para limpiar. Handlers
  **nombrados**, sin funciones anónimas inline, sin ternario para render condicional (early return
  o subcomponente). Color por rol semántico (`--surface-*`/`--content-*`/`--accent-*`), escala de
  4 px, `text-caption`/`text-body` — **ni un hex ni un px suelto** (gate de `@redteam` pasada 1).
- **Etiquetas en `features/draft/constants.tsx`** (`ARCHETYPE_LABELS`), mismo vocabulario que las
  `explanation` del motor ("tu draft de Push") — no se inventa terminología nueva.
- **`useDraftStore` (`store.ts`)** gana `archetypeIntent: DraftArchetype | null` (default `null`) y
  la acción `setArchetypeIntent(intent)` que: (1) fija el estado local, (2) manda
  `{ schema:"draft-ws/v1", type:"set_intent", sessionId, archetypeIntent: intent }` por el socket.
  En `connect()`, **tras el `hello`**, si `archetypeIntent !== null` se re-envía el `set_intent`
  (el motor lo mantiene en `SessionStore`, pero un reinicio del motor lo pierde).
- **`features/draft/types.ts`**: `type DraftArchetype = "push"|"teamfight"|"pickoff"|"scaling"` —
  **espejo a mano** de `draft-paths/types.ts` (frontera `apps/engine ↔ apps/web`), con el
  comentario de espejo. El mirror de `ClientMessage` gana `"set_intent"` + `archetypeIntent`.
- **`DraftView.tsx`**: monta `<DraftIntentSelector>` en `WaitingForDraftState` (`esperando_draft`)
  **y** en `ActiveDraftState`/`DegradedDraftState`, cerca de `modeSelector`/`extraTopBar`. El
  usuario puede fijar la dirección **antes** del pick #1 y persiste al arrancar.
- **Régimen de datos**: la intención es estado de sesión de draft en vivo → Zustand + WebSocket,
  **nunca RTK Query**. Es la misma excepción que ya cubre el resto de la vista de draft en vivo.
- **Nada de RTK Query nuevo, sin pantallas nuevas fuera del selector.** El request de
  `/api/suggestions/preview` gana `archetypeIntent?` sólo en el contrato del motor — `apps/web`
  no lo usa en 4.3 (ese endpoint lo consume el bot del simulador y el panel Pro-Drafter, no la
  vista en vivo).

## Fase 6 — Formalizar Pro-Drafter: apertura de equipo consciente de bans (SPEC.md §13.10)

- **`apps/web/features/pro-drafter/types.ts` tiene 2 espejos a mano que se ensanchan en el mismo
  cambio que el motor**: `ProSuggestion.rank` y `LegacySuggestionSetResponse.suggestions[].rank`
  pasan de `1|2|3` a `1|2|3|4|5` — deben cambiar en el mismo PR que `server/routes/pro-drafter.ts`,
  o el tipado miente (mismo criterio que el espejo de `SignalId` en Fase 3).
- **`LegacySuggestionSetResponse` ya estaba mal antes de esta fase** — hallazgo real, no
  hipotético: con `ENABLE_PRO_DRAFTER` apagado (el default) y `teamOpening: true`, esa ruta ya
  responde con el `SuggestionSet` de v5, que trae ranks 4 y 5. Esta fase lo corrige de paso porque
  toca esa misma línea.
- **Nada más de `apps/web` cambia.** Sin pantallas nuevas, sin `ProDrafterPanel` reescrito, sin
  tocar `bot-drafter.ts` — 5 elementos en vez de 3 no exigen ningún cambio de componente.

## Fase 8 — higiene de superficie: nav 7 → 4 (SPEC.md §14.8)

- **`components/nav-bar/NavBar.tsx`**: el array de links pasa de 7 a **4**: `Simulador de Draft`
  (`/simulator`), `Mi pool` (`/hero-pool`), `Meta` (`/meta`), `Configuración` (`/settings`). Se
  quitan `Draft en vivo` (`/live-draft`), `Equipos` (`/team-groups`), `Héroes` (`/heroes`).
- **Rutas, componentes y tests de las 3 páginas quitadas NO se tocan.** Siguen alcanzables por URL
  directa. `/live-draft` ya renderiza `DraftUnavailablePage` con `DRAFT_LIVE_ENABLED` apagado
  (default) — sin cambio de comportamiento. Redirects legacy (`/draft`, `/random-draft`) quedan.
- La prop `draftLiveEnabled` de `NavBar` queda sin uso → se puede retirar de la firma o dejar
  (ambas válidas; retirarla es más limpio).
- **8B no cambia comportamiento** — sólo visibilidad. Ninguna prueba existente de `apps/web`
  cambia de resultado. Prueba nueva: `NavBar` renderiza 4 links; humo de que
  `/team-groups`/`/heroes`/`/live-draft` siguen resolviendo por URL.
- Fase 8 **no toca ninguna otra cosa de `apps/web`**: el selector de intención de Fase 4.3, el
  Simulador, el hero pool — todo queda igual. Overwolf/OCR: stand-by documentado, no se tocan.

## Fase 9 — V6-medido → V6-contextual (SPEC.md §15)

- **9.0 no toca `apps/web/**`.** Criterio de aceptación #2, verificable con `git diff --name-only`.
- **9.1**: cuando `SignalContribution` gane `normalized` / `evidenceConfidence`, el espejo a mano de
  `apps/web` (`features/draft/types.ts` + `features/draft/validation.ts`) se actualiza **en el mismo
  cambio** o `tsc` de `apps/web` rompe — mismo criterio que Fase 3 (`SignalId`) y Fase 4.2
  (`archetype_fit`).
- **`GuessingIndex` / `EvidenceCoverage` en la UI = follow-up post-QA** (decisión D4 del
  `/pre-flight`). No se construye ningún elemento de UI para esto en 9.x; la métrica vive interna
  (backtest + logs) hasta que un QA con datos reales decida si se muestra y cómo.
- Fase 9 **no toca ninguna otra cosa de `apps/web`**: selector de intención, Simulador, hero pool,
  nav — todo queda igual.

## Fase 9.1 — espejo de `SignalContribution` v2 (SPEC.md §16.9)

El motor amplía `SignalContribution`; `apps/web` lo espeja **en el mismo cambio** o `tsc` de
`apps/web` rompe (mismo criterio que Fase 3 y Fase 4.2). Archivos:

- **`features/draft/types.ts`**: `SignalContribution` gana `normalized: number | null` y
  `evidenceConfidence: number`. `Suggestion` gana `evidenceCoverage: number` y
  `guessingIndex: number`. Espejo a mano, con el comentario de espejo — nunca un import (los dos
  procesos son independientes).
- **`features/draft/validation.ts`**: `isSignalContribution` valida
  `(value.normalized === null || isFiniteNumber(value.normalized))` **y**
  `isFiniteNumber(value.evidenceConfidence)`. `isSuggestion` valida `evidenceCoverage` y
  `guessingIndex` como `isFiniteNumber` en `[0, 1]`.
- **`SignalBreakdown.tsx`**: **sin cambio visual en 9.1**. Sigue mostrando `raw`/`weighted`.
  `normalized` y `guessingIndex` quedan disponibles en el tipo para la UI de un follow-up (D4).
- **`bot-drafter.ts`** (Random Draft Simulator): no consume `SignalContribution` — **no cambia**.
- Fase 9.1 **no toca ninguna otra cosa de `apps/web`**: sin pantallas nuevas, sin estado nuevo,
  sin RTK Query nuevo. Sólo el espejo de tipos + su validación.
