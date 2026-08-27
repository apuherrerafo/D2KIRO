---
description: Reglas del motor de sugerencias y el servidor Bun (apps/engine) — SPEC.md §C2-C4, §3, §5
globs: apps/engine/**/*.ts
alwaysApply: false
---

Fuente: `docs/specs/SPEC.md` (contrato de desarrollo, gana sobre cualquier otra interpretación).

## Motor de sugerencias (C3) — nunca red en el camino caliente
- Ningún código bajo `apps/engine/src/suggestions/` (o carpeta equivalente del motor) hace
  `fetch`/HTTP. Todo lo que el motor necesita ya está en SQLite antes del primer pick.
- Un `SignalScorer` (S3) es una función pura: entrada `(DraftState, HeroId, MetaSnapshot)`, salida
  `SignalContribution`. Nunca I/O, nunca lanza sin ser capturado por el llamador.
- `raw: null` significa "sin datos suficientes" — nunca se traduce a `0` ni `0.5`. Su peso se
  redistribuye proporcionalmente entre las señales con dato.
- Si un scorer lanza una excepción, esa señal cuenta como `raw: null`; las otras tres se calculan
  igual. Una señal rota nunca tira el motor completo.
- El cálculo completo se corta a los 500 ms duros (presupuesto normal: 300 ms). Si se corta, se
  devuelve lo que haya con `degraded: 'partial_signals'` — nunca se bloquea el push.
- Sin candidatos válidos → `suggestions: []` + flag explícito, no una excepción.
- `SCORING_WEIGHTS_V1` vive en un único archivo, versionado por nombre. Debe existir una prueba
  unitaria que verifique que los 4 pesos suman exactamente `1.0`.

## Reductor de estado (C2) — `applyDraftEvent`
- Firma pura: `(state: DraftState, envelope: DraftEventEnvelope) => { state, rejected? }`. Sin
  `Date.now()`, `crypto.randomUUID()` ni ningún reloj/generador propio dentro — se inyectan como
  parámetros si la función los necesita.
- `eventId` repetido → se descarta en silencio (`duplicate_event`), nunca se re-aplica.
- `seq <= lastSeq` → se rechaza (`stale_seq`), **salvo** `pick_reverted`, que siempre se evalúa.
- Un evento rechazado nunca lanza ni corrompe el estado — se devuelve `RejectionReason` y el
  estado anterior sigue siendo válido.
- `format: 'unknown'` es un estado legítimo — el motor sigue sugiriendo igual, nunca lo bloquea.
- No se modela la tabla de turnos de Valve (orden exacto de bans de All Pick 7.35d) como lógica
  del reductor — vive como datos (`DraftFormat`), nunca como código que la adivine.

## Persistencia (C4) — SQLite/Drizzle
- Toda query pasa por Drizzle. Cero SQL concatenado, cero `db.execute()` con strings interpolados
  desde input externo.
- Toda respuesta de OpenDota se valida en el borde antes de escribir en SQLite — es input externo,
  igual que un formulario.
- La sincronización de cada tabla (S6) es transaccional: una escritura parcial nunca deja el cache
  a medias.
- 429 de OpenDota → reintento con espera creciente (1s, 4s, 16s), máximo 3 intentos. Si falla,
  `meta_sync.status = 'failed'` y se sigue sirviendo el cache viejo — un draft nunca se queda sin
  sugerencias por una API de terceros caída.

## Fase 1b — Hero pool (`hero_pool_fit`, S7, S8) — SPEC.md §9

- `hero_pool_fit` es un `SignalScorer` más (S3), mismo contrato que las otras cuatro. `applicable:
  false` (pool nunca configurado) es distinto de `raw: null` (hueco de datos) — no se confunden en
  ningún punto del pipeline: `applicable: false` no cuenta para `computeConfidence` ni dispara
  `degraded: partial_signals`, pero sí se muestra en el desglose de la UI.
- `SCORING_WEIGHTS_V1` **no se edita ni se borra** — sigue versionado por nombre. `hero_pool_fit`
  vive en `SCORING_WEIGHTS_V2` (5 pesos, suman `1.0`, prueba unitaria obligatoria). Con el pool sin
  configurar, la redistribución proporcional de `mix.ts` debe reproducir exactamente los pesos de
  v1 — hay una prueba dedicada a esto (candado de regresión cero), no es una promesa.
- El cálculo del pool propuesto (S7: filtro de mínimo, `baseline`, suavizado `K=10`, orden, corte
  en 5) es una función pura, sin I/O, igual que un `SignalScorer` — se prueba con fixtures de
  `/players/{id}/heroes`, nunca con red real.
- `POST /api/hero-pool/calculate` toca la red (OpenDota), pero vive en el flujo de configuración,
  **nunca en el camino caliente del draft** — la regla "cero red en el camino caliente" sigue
  intacta para el pipeline de `buildSuggestions`.
- `PUT /api/hero-pool` reemplaza el pool completo en una sola transacción de Drizzle — nunca queda
  un pool a medio reemplazar, mismo principio que la sincronización de meta (S6).
- `account_id` (Steam32): validado en el borde (solo dígitos, `1`–`4294967295`) antes de construir
  cualquier URL o tocar SQLite. Es el primer dato personal del proyecto — nunca se loguea, nunca se
  eco en un error, nunca aparece en `journal.md`/tickets/`meta_sync.error`/`/api/health`.

## Servidor Bun — HTTP + WebSocket
- `apps/engine` escucha únicamente en `127.0.0.1`. Un binding a `0.0.0.0` es FAIL automático.
- `POST /ingest/draft-event` exige la cabecera `x-capture-token` (generada en runtime, leída de
  `process.env`, nunca hardcodeada) y limita a 20 eventos/segundo por sesión — el exceso se
  descarta con `429`.
- Tras cada evento aplicado, el orden de push por WebSocket es siempre `draft_state` primero,
  `suggestions` después — el tablero nunca espera al motor para reflejar el estado real. Ningún
  otro tipo de mensaje se suma a este push automático sin una decisión explícita (ver `draft_paths`
  abajo, que deliberadamente queda afuera).
- Al reconectar (`hello`), el servidor responde siempre con una instantánea completa
  (`snapshot`), nunca con deltas.

## Fase 2 — Draft en equipo (construida vía `/kickoff` + Codex, sin `/blueprint` propio — sin
número de sección de `SPEC.md`, documentado aquí como fuente de verdad)

### Modo de equipo (`team_groups`/`team_members`)
- `partySize` acepta únicamente `1 | 2 | 3 | 5` — **4 nunca es válido** (restricción real de la
  cola de Dota 2, no una limitación técnica del proyecto). Validado en el borde en las dos capas
  (`isPartySize` del servidor y las opciones del selector en `apps/web`).
- El pool de héroes de cada compañero es dato manual (nombre + lista de hasta 5 héroes) — **nunca**
  una cuenta de Steam de un tercero. Decisión explícita para no abrir el tema de datos personales
  de más de una persona en esta fase (ver `security.md`).
- `createTeamGroup`/`replaceTeamGroup`/`deleteTeamGroup` son transaccionales — grupo y miembros se
  escriben o se borran juntos, nunca a medias, mismo principio que `replaceHeroPool` (S8).

### Caminos de draft (`apps/engine/src/draft-paths/`) — capa paralela, no una señal más
- **No es un `SignalScorer`**: no participa de `SCORING_WEIGHTS_V1/V2/V3`, no aparece en
  `Suggestion.signals`, no afecta el ranking de `buildSuggestions`. Es un módulo aparte que
  consume el mismo `DraftState`/`MetaSnapshot` pero produce una salida distinta (`DraftPath[]`).
- **Cálculo bajo demanda, nunca por WebSocket automático**: `GET /api/session/:id/draft-paths` se
  calcula solo cuando se pide — no se empuja en cada evento de draft como `suggestions`. Esto es
  deliberado: calcular 3-4 caminos completos en cada pick/ban, cuando el usuario puede ni estar
  mirando esa pantalla, sería gastar cómputo en algo exploratorio. La regla de orden de push
  (`draft_state` → `suggestions`) sigue intacta, sin extenderse a un tercer paso.
- `capabilities.json` (dato curado a mano por héroe: `hasInitiation`, `hasCatch`, `hasWaveclear`,
  `structuralDamage`, `teamfight`, `scaling`, `damageType`) vive como archivo estático versionado
  en el repo, **no en SQLite** — es dato de producto, no meta remota ni preferencia de usuario. Un
  héroe sin entrada nunca rompe el cálculo: simplemente no participa como candidato (mismo espíritu
  que `applicable: false` en el resto del motor).
- Los gaps del draft propio (`initiation`, `catch`, `waveclear`, `structural_damage`, `teamfight`,
  `scaling`, `damage_mix`) se calculan con umbrales exactos y numéricos (`LEVEL_SCORE`,
  `GAP_THRESHOLD`) — nunca "pocas partidas" o "bajo conteo" sin definir el número.
- `damage_mix` nunca asume que el equipo está desbalanceado hacia un tipo de daño fijo — compara
  contra el tipo dominante real del equipo propio (`ownDamageTypes`), no un valor hardcodeado.
  Corregido por hallazgo de `@redteam` en TSK-036: la primera versión asumía "physical" siempre.

### Random Draft Simulator (`apps/web/features/random-draft-simulator/`) — spec nativo de Kiro,
sin `/blueprint` propio, documentado aquí como fuente de verdad (mismo criterio que "Draft en
equipo" arriba)
- **`GET /api/meta/hero-stats`** (solo lectura, sin auth, mismo criterio que `/api/heroes` y
  `/api/meta/status`): expone `patchStats` (picks/wins por héroe, patch y bracket) ya calculado
  por `buildMetaSnapshot`, agregado porque ningún endpoint existente lo exponía a `apps/web` —
  `GET /api/heroes` solo trae nombre/ícono/roles. **No toca el camino caliente de sugerencias ni
  el reductor** — nadie lo llama durante un draft en curso, solo al arrancar una sesión del
  simulador. Debe estar en la allowlist de `apps/web/next.config.ts` (`ENGINE_REWRITE_SOURCES`).
- El bot del simulador **no usa `buildSuggestions`** — tiene su propio scoring simplificado
  (`apps/web/features/random-draft-simulator/bot-drafter.ts`, pick rate + ban rate de
  `patchStats`) para que el pre-cálculo sea síncrono y determinístico sin depender de la
  disponibilidad del motor. **Consecuencia real, no solo teórica**: el bot y el Copilot son dos
  cerebros distintos — lo que se ve draftear al bot no refleja el motor de sugerencias real.
  Confirmado como causa de una queja real de producto (QA manual, 2026-08-20) que disparó la
  investigación de Fase 3 (posiciones reales) — ver `PROGRESS.md`. Sigue así hasta que se decida
  explícitamente lo contrario (fuera de alcance del `/kickoff` de Fase 3 a propósito).
- `metaBanPool` (orden de baneo del `BanPhaseResolver`) usa pick rate como proxy de tasa de ban —
  **no existe dato de ban rate en ningún lado del proyecto** (OpenDota no lo expone, nunca se
  sincronizó). No es un placeholder temporal sin justificar: es la mejor aproximación disponible
  con los datos reales que hay.
- **Segundo espejo de tipos, documentado a partir de TSK-062** (hallazgo 2.5 de "Radiografía de
  dota2coach", auditoría de arquitectura 2026-08-21): `bot-drafter.ts:14-31` define su propia
  versión angosta de `HeroPatchStat`/`MetaHeroEntry`/`MetaSnapshot` (sin `matchups` ni
  `heroPool` — solo lo que el scoring del bot necesita), en vez de importar los tipos reales de
  `apps/engine/src/signals/types.ts`. Es el mismo criterio que ya justifica el espejo de
  `SignalId` en `apps/web/features/draft/types.ts` (web.md, §Fase 3) — los dos procesos son
  independientes a propósito, `apps/web` nunca importa tipos de `apps/engine` — pero hasta este
  ticket nadie lo había nombrado como espejo deliberado. Si el motor renombra un campo de
  `MetaSnapshot`, hay dos lugares a corregir en el mismo cambio, no uno: `apps/web/features/
  draft/types.ts` (ya documentado) y `apps/web/features/random-draft-simulator/bot-drafter.ts`
  (documentado acá, ahora).

## Fase 3 — `position_fit` (S3 + S10) — SPEC.md §10

- **`roles[]` de OpenDota NO son posiciones.** Es la regla que originó toda esta fase: 57% de los
  héroes están etiquetados `"Carry"` (Zeus, Axe, Tidehunter incluidos) y 38% `"Support"`. Son
  etiquetas temáticas, no roles de línea. **Prohibido usar `roles[]` para razonar sobre posición,
  cobertura de rol o solapamiento de farm** — para eso existe `hero-positions.json`. `roles[]`
  sigue siendo válido para lo que sí describe (`team-synergy.ts` lo usa como heurística de
  capacidades, eso no cambia).
- **`role_gap` y `role_safety` dejan de existir.** Se fusionan en `position_fit` — las dos
  respondían la misma pregunta de fondo ("qué posición me falta y es buen momento de revelarla") y
  separadas competían entre sí dentro del mismo score. La intención de producto de `role_safety`
  (support primero, revelar el core después, TSK-027) **se conserva completa** dentro de la señal
  nueva; lo que se descarta es su implementación sobre etiquetas y su ventana dura de 2 picks.
- **`SCORING_WEIGHTS_V4` es la constante activa.** V1/V2/V3 quedan congeladas por nombre, nunca se
  editan ni se borran (mismo patrón de siempre). Prueba unitaria obligatoria: los 5 pesos suman
  exactamente `1.0`. **El candado de regresión cero de V2/V3 no aplica acá** — V4 reemplaza dos
  señales por una en vez de agregar una sexta, no existe un estado "sin configurar" que reproducir.
  Si alguien lo busca y no lo encuentra, es deliberado, no un olvido.
- **`position_fit` es señal ponderada, nunca filtro duro.** El único filtro duro del motor
  (`candidatePool`) descarta por hechos binarios (baneado/pickeado), jamás por juicio de calidad.
  Un héroe que repite rol puntúa `raw: 0`, **no** se elimina de la lista de candidatos.
- **El contrato `SignalScorer.score(state, candidate, meta)` no se modifica.** El dato de posición
  entra por fábrica (`createPositionFitScorer(positions)`) y por `BuildSuggestionsOptions
  .heroPositions?` (ausente → carga el archivo real). Mismo patrón que `now?`/`metaIsStale?` ya
  usan ahí — los llamadores existentes no cambian.
- **Los dos únicos casos de `raw: null`**: candidato sin entrada en `hero-positions.json` (hoy:
  Chen), y `state.localSide === "unknown"`. Este segundo es un **cambio de comportamiento
  deliberado** respecto a `role_gap`/`role_safety`, que lo trataban como "sin picks propios" y
  afirmaban implícitamente "te falta todo" sin base para hacerlo.
- **Nunca `applicable: false` en `position_fit`.** Ese campo significa "función que el usuario no
  configuró" (solo `hero_pool_fit` lo usa). Un héroe sin dato de posición es un hueco de datos:
  `raw: null`.
- `hero-positions.json` vive en `apps/engine/src/signals/`, archivo estático versionado en el
  repo, **no en SQLite** — mismo criterio que `capabilities.json`. Se valida en el borde al
  cargarlo (`loadHeroPositions()`): descarta entradas malformadas, `position` fuera de `1..5`,
  `matches` no entero o `< 200`, y héroes duplicados. **Un archivo corrupto degrada a "sin datos
  de posición" (todos `raw: null`), nunca tira el motor.**
- **El umbral de 200 partidas no es negociable en silencio.** Sin él, héroes con presencia
  marginal aparecen en las 5 posiciones (caso real verificado: Windranger). Si se cambia, se
  cambia acá y en `SPEC.md` §10.1 P4, nunca solo en el código.
- **El motor nunca llama a la red por este dato.** El script que regenera el archivo corre a mano,
  fuera de `apps/engine`, nunca programado. La regla de cero red en el camino caliente queda
  intacta — esta fase ni siquiera abre una excepción "de configuración" como sí hizo
  `POST /api/hero-pool/calculate` en 1b.

## Fase 5 — Auth & Personal Hero Pool multi-usuario — SPEC.md §12

- **`PRAGMA foreign_keys` sigue apagado.** Las FK de `accounts`/`hero_pool`/`team_groups` son
  documentación del modelo, no una defensa en runtime — el aislamiento real entre cuentas lo da
  exclusivamente el `WHERE account_id = ?` de cada query. Nunca asumir que la constraint impide
  nada.
- **`hero_pool` pasa a PK compuesta `(accountId, heroId)`** vía migración `0006` (tabla-nueva/
  copiar/drop/rename — SQLite no soporta `ALTER TABLE` para cambiar una PK). `team_groups` gana
  `accountId` como columna **nullable** (migración `0007`) — no necesita cirugía de PK porque ya
  tiene `id` autoincremental propio; `team_members` no gana columna propia, hereda el scope vía su
  `teamGroupId` existente.
- **`buildMetaSnapshot(db, accountId)` — `accountId: AccountId | null` es obligatorio, nunca
  opcional con default.** Un parámetro opcional con default `null` dejaría que cualquier llamador
  nuevo que se olvide de pasarlo obtenga silenciosamente "sin pool" — el mismo tipo de bug invisible
  que ya costó una fase entera (`hero_pool_fit` inerte desde 1b hasta TSK-064). Que rompa la
  compilación es la funcionalidad, no un defecto a suavizar.
- **El cache de `MetaSnapshot` está partido en dos capas, nunca un solo `Map<accountId,
  MetaSnapshot>`.** Capa compartida (`sharedSnapshot`: `heroes`/`hero_matchups`/`hero_patch_stats`,
  idéntica para todas las cuentas) + capa por cuenta (`accountOverlays: Map<AccountId,
  AccountMetaOverlay>`: solo `hero_pool`/`personal_baseline_winrate`). Invalidación separada por
  responsabilidad: fin de `runMetaSync` invalida solo la capa compartida (nunca los overlays — una
  sync de meta no cambia el pool de nadie); `PUT /api/hero-pool` de la cuenta X invalida solo
  `accountOverlays.delete(X)` (nunca el mapa entero — ninguna otra sesión activa paga un recálculo
  ajeno).
- **`x-account-token` — contrato exacto**: `{accountId}.{issuedAtMs}.{nonce}.{firmaHMAC}`, HMAC-
  SHA256 sobre `"d2k-account-token/v1|" + payload` con `INTERNAL_AUTH_SECRET`. Verificación en
  **este orden exacto, sin saltarse ninguno**: forma → firma (comparación en tiempo constante) →
  ventana (60 s + 5 s de tolerancia de reloj) → rango del `accountId` (Steam32 válido) → nonce (un
  solo uso, store en memoria con evicción oportunista, mismo patrón que `SessionStore.evictStale`).
  El token se **acuña únicamente en `apps/web`** (`proxy.ts`/`GET /api/auth/engine-token`) —
  `apps/engine` solo verifica, nunca firma.
- **`accountId` nunca se acepta desde el cuerpo o el query string de una request.** Sale
  exclusivamente del token verificado (`x-account-token` en HTTP, `accountToken` en el `hello` de
  WebSocket). `POST /api/hero-pool/calculate` pierde el campo `accountId` de su contrato — el Steam32
  sale del token, el cuerpo queda en `{ days?: number }`.
- **`calculationInProgress` es `Set<AccountId>`, nunca un booleano por proceso.** Con varios
  usuarios, un booleano global le devolvería `409` a todos por el cálculo de uno solo.
- **`SessionStore` gana `ownerAccountId: AccountId | null` por sesión.** Lo fija el primer `hello`
  autenticado; un `hello` de otra cuenta sobre una sesión que ya tiene dueño se rechaza, nunca
  reasigna el dueño. `POST /ingest/draft-event` (capturador, `x-capture-token`) no fija dueño — no
  representa a una persona logueada.
- **Ninguna ruta de cuenta responde con el `accountId` en un mensaje de error.** Los 5 errores de
  token (`missing_account_token`, `invalid_account_token`, `expired_account_token`,
  `replayed_account_token`, `unknown_account`) nunca incluyen el valor — misma regla de 1b
  (`account_id` nunca se ecoa en un error), ahora vale para todas las cuentas, no solo la del
  desarrollador.
- **`apps/engine` sigue atado a `127.0.0.1`, sin excepción.** El callback de Steam OpenID necesita
  una URL pública — solo puede terminar en `apps/web`. `apps/engine` nunca ve el flujo de login
  directamente, solo recibe el `accountId` ya verificado vía el token.
- **Fase 5 no expone el WebSocket del motor a la red** — decisión explícita, no una laguna. Un
  usuario remoto logueado tiene cuenta y `hero_pool` guardado, pero las sugerencias en vivo siguen
  requiriendo el motor local del propio visitante, sin cambios respecto a hoy.

## Fase 4 — `archetype_fit` (S3, sub-ticket 4.1) — SPEC.md §11

Esta fase tiene 4 piezas (intención de draft, sinergia en cadena, denial de composición,
diversificación); **solo la pieza 1 (sub-ticket 4.1) pasó por `/blueprint`** — las reglas de acá
son las de 4.1 únicamente. Las piezas 2-4 quedan al nivel conceptual de `architecture.md`, sin
números, hasta que cada una tenga su propio `/blueprint` (SPEC.md §11.10).

- **`DraftPathArchetype` (`push`/`teamfight`/`pickoff`/`scaling`, `draft-paths/types.ts`) se
  reutiliza tal cual como tipo de la intención de draft** — no se duplica un tipo nuevo. Import
  directo entre `signals/` y `draft-paths/` es legítimo (mismo proceso, `team-synergy.ts` ya lo
  hace); la regla de "espejo a mano" es exclusiva de la frontera `apps/engine` ↔ `apps/web`.
- **`archetypeFitBonus` se reutiliza, nunca se reimplementa.** Pasa de función privada a exportada
  en `draft-paths/build-paths.ts` (una línea, sin cambiar firma ni cuerpo) — `archetype-fit.ts` la
  importa. Una segunda copia de esa fórmula es rechazo automático de revisión.
- **La normalización de `raw` a `[0, 1]` ocurre DENTRO del scorer, nunca en `RAW_RANGE` de
  `mix.ts`.** `archetypeFitBonus` no tiene una escala uniforme entre los 4 arquetipos (`0..2` para
  push/teamfight/scaling, `0..3` solo para pickoff, que suma dos booleanos en vez de leer un
  `CapabilityLevel`) — `RAW_RANGE` es un rango único por señal, no por arquetipo, así que ningún
  valor sirve para los cuatro sin normalizar antes.
- **`archetype_fit` no depende de `DraftState` ni de `MetaSnapshot`** — `raw` es constante por par
  `(intent, hero)` durante todo el draft. No es un descuido: es la primera señal del motor que
  discrimina candidatos con el draft vacío (las otras cinco necesitan picks propios/rivales o un
  pool configurado para votar con fuerza en el pick #1).
- **Dos resultados posibles, nunca un tercero inventado**: sin intención elegida →
  `raw: null` **y** `applicable: false` (nunca un número); candidato sin entrada en las
  capacidades inyectadas → `raw: null`, `applicable` ausente/`true` (nunca `applicable: false` por
  falta de dato — ese campo es exclusivo de "función no configurada", igual que `hero_pool_fit`).
- **`capabilities.json` NO tiene cobertura completa** (corrección real de `/blueprint`, verificada
  contra el archivo): 124 entradas contra 126 héroes en `hero-positions.json` — faltan `131`,
  `145`, `155`. La rama `raw: null` por falta de dato es alcanzable con el dato real de hoy, no
  defensiva. No se completa en 4.1 — es trabajo de dominio del usuario, ticket aparte.
- **`SignalId` NO se amplía en 4.1.** Ampliarlo rompería la compilación de `SCORING_WEIGHTS_V4`/
  `V5` (`Record<SignalId, number>` totales, ambas congeladas) y de `RAW_RANGE`/`SIGNAL_LABELS`.
  4.1 usa una vista de tipo derivada (`Omit<SignalContribution, "signal"> & { signal:
  "archetype_fit" }`) que compila hoy y desaparece sola en 4.2. Antes de ampliar `SignalId` en
  4.2, V4 y V5 pasan primero a tiparse con sus propios literales históricos (mismo mecanismo que
  V1/V2/V3 ya usan) — así una versión congelada no queda acoplada a qué señales existen hoy.
- **4.1 no toca `mix.ts`, `weights.ts` ni `apps/web`.** El motor no cambia de comportamiento
  todavía — `SCORING_WEIGHTS_V5` sigue siendo la única activa hasta 4.2.
- **Hallazgo real, fuera de alcance de 4.1 pero anotado**: `team_synergy` devuelve `raw: 0` (no
  `raw: null`) para un héroe sin capacidades — viola la regla dura de este mismo archivo ("`raw:
  null` nunca es 0 ni 0.5") y hoy se dispara con los mismos 3 héroes sin entrada en
  `capabilities.json`. Necesita su propio ticket, no se corrige de paso en 4.1.

## Fase 6 — Formalizar Pro-Drafter: apertura de equipo consciente de bans (SPEC.md §13)

- **`SignalId`/`SCORING_WEIGHTS_V1`-`V5` no se tocan en esta fase.** Toda dimensión nueva vive en
  el universo ya separado de `pipeline/merge.ts` (`PipelineSignalId = "knn_similarity"|
  "lane_score"|"denial_score"`) — el término ban-aware alimenta el `raw` de `denial_score`, no
  agrega una cuarta clave.
- **`intent/denial-score.ts` no se edita.** El nuevo `pipeline/ban-relief.ts` solo le cambia los
  parámetros inyectados (héroes baneados en vez de picks rivales revelados) — la fórmula
  (`Σ P(pos)·MatchupWinrate + β·EarlyPressure·H(F)`) es la formalización correcta, ya existente.
- **`POSITION_OVERLAP_GAIN = 5` es el ancla, no negociable**: un candidato sin dato de posición
  reproduce exactamente el alivio plano de `team-opener.ts` — un hueco de datos nunca penaliza.
  `BETA_OPENING = 0.04` sí es una perilla de producto, fijada con justificación medida (SPEC.md
  §13.11), ajustable si el resultado real lo pide.
- **`knn_similarity` no corre en el modo `teamOpening`.** Con `own=[]`, los 502 drafts del corpus
  empatan en 0 y el desempate quedaría arbitrario por orden de archivo — en apertura, esa señal es
  `raw: null` para todos, nunca un `0` fabricado.
- **`MAX_COUNTER_RELIEF` de `team-opener.ts` no se toca ni se retira en esta fase.** Sigue siendo
  el único camino de apertura con `ENABLE_PRO_DRAFTER` apagado (el default). Su reemplazo depende
  de que el paquete de evidencia de `scripts/evaluate-pro-drafter.ts` (SPEC.md §13.15) supere la
  barra fijada, y es decisión de un segundo `/blueprint`, más angosto.
- **Sin tabla `heroSynergy` ni recolección de datos de sinergia de aliados nueva** — mismo
  precedente que Fase 4: OpenDota no expone ese endpoint (verificado dos veces, en Fase 4 y en
  Fase 6). Si algún día hace falta sinergia par a par, se deriva de `capabilities.json`, no de una
  fuente estadística nueva.
- **`openingStrategy` tiene una sola implementación real**, en `draft-paths/strategy.ts` — `mix.ts`
  la importa, no la duplica. Una segunda copia de esta clasificación en cualquier archivo es
  rechazo automático de revisión.
- **El umbral `MIN_MATCHUP_GAMES = 200` recorta el 92.5% de `hero_matchups`** (medido: 1200 de
  15984 filas llegan al umbral) — no es un detalle menor, es la razón real por la que un alivio
  por ban plano casi nunca tenía con qué disparar. El factor de solapamiento posicional + entropía
  de rol es lo que hace que la apertura reaccione a todos los bans, no solo al 7.5% con volumen.
