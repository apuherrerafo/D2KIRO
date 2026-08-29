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

## Fase 4.2 — `archetype_fit` entra al motor (S3) — SPEC.md §11.13

Integración de la señal aislada en 4.1. **`SCORING_WEIGHTS_V6` pasa a ser la constante activa**;
V1-V5 quedan congeladas por nombre, sin editar un solo valor.

- **`SCORING_WEIGHTS_V6: Record<SignalId, number>`, 6 pesos, suman `1.0`** (prueba unitaria
  obligatoria, como toda versión desde V1). `archetype_fit: 0.10`; los otros 5 = su valor de V5 ×
  `0.90` exacto (`position_fit 0.342`, `counter 0.216`, `patch_meta 0.117`, `team_synergy 0.117`,
  `hero_pool_fit 0.108`). El factor `0.90` no es negociable: es lo que hace que la redistribución
  proporcional de `mix.ts` reproduzca V5 **al bit** cuando `archetype_fit` no vota.
- **Antes de ampliar `SignalId`, `SCORING_WEIGHTS_V4` y `V5` pasan a `Record<SignalIdV5, number>`**
  (literales históricos propios, mismo mecanismo que TSK-045 usó para V1/V2/V3). Sin ese re-tipado
  no compila. Los valores de V4/V5 no cambian una coma.
- **`SignalId` gana `"archetype_fit"` (6º literal).** `SignalContribution`/`SignalScorer` no
  cambian de forma. Los alias `ArchetypeFitContribution`/`ArchetypeFitScorer` de
  `archetype-fit.ts` **se borran**; el cuerpo de `score()` no cambia una línea (tipado
  estructural — §11.4 lo previó).
- **`RAW_RANGE.archetype_fit = [0, 1]` en `mix.ts`** — `raw` ya viene normalizado del scorer
  (`ARCHETYPE_MAX_BONUS` por arquetipo). Nunca se deja la escala cruda de `archetypeFitBonus` en
  `RAW_RANGE`, que es un rango único por señal y no puede representar uno distinto por arquetipo.
- **`BuildSuggestionsOptions.archetypeIntent?: DraftPathArchetype`**, mismo patrón que
  `now?`/`heroPositions?`/`heroCapabilities?`. Ausente → el scorer recibe `intent === undefined`
  → `applicable: false` (nunca vota, nunca baja la confianza). En 4.2 lo fija **sólo el llamador
  dentro del proceso** — el transporte por request/WS y su validación de borde son 4.3.
- **`createArchetypeFitScorer(heroCapabilities, options.archetypeIntent)` se ensambla por
  llamada** en `buildSuggestions`, junto a `position_fit`/`team_synergy` (no es singleton de
  módulo: depende de datos inyectables). `safeScore`/`computeConfidence` ya cubren `raw: null` y
  `applicable: false` — sin ramas de error nuevas.
- **Sin decaimiento en 4.2.** `raw` sigue constante por `(intent, hero)` como en 4.1. El posible
  sobre-empuje en picks tardíos es calibración de 4.3 — no se le agrega dependencia de
  `DraftState` al scorer sin datos de QA que la respalden.
- **`position_fit` sigue siendo el peso más alto de V6** (`0.342`). Fase 3 no se reabre.
- **4.2 no toca `intent/`, `pipeline/`, `knn/`, `lane/` ni `ENABLE_PRO_DRAFTER`** — el Pro-Drafter
  dark es otro universo, sin relación con esta señal.

## Fase 4.3 — `archetype_fit` usable: transporte de la intención (server/) — SPEC.md §11.14

Hace usable la señal que 4.2 dejó integrada pero inerte. Toca `apps/engine/src/server/`, nunca
`signals/`.

- **`SessionStore` gana `archetypeIntent: DraftPathArchetype | null` por sesión** (default `null`),
  mismo patrón exacto que `ownerAccountId`: `setArchetypeIntent(sessionId, intent)` /
  `archetypeIntent(sessionId)`. El merge de `applyDraftEvent` lo preserva igual que
  `ownerAccountId` (`?? null`). **No se persiste en SQLite** — vive en memoria, TTL 45 min.
- **`ClientMessage.type` gana `"set_intent"`** (junto a `"hello"`/`"ping"`). Payload:
  `{ sessionId, archetypeIntent: DraftPathArchetype | null }`. `import type { DraftPathArchetype }
  from "../draft-paths/types"` es import directo legítimo (mismo proceso), no espejo a mano.
- **`isValidClientMessage` gana la rama `set_intent`**: `sessionId` string no vacío **y**
  `archetypeIntent ∈ {"push","teamfight","pickoff","scaling", null}`. Un `set_intent` malformado
  se descarta en silencio (`return`), igual que cualquier `ClientMessage` inválido (TSK-010).
- **`SuggestionsPreviewRequest` gana `archetypeIntent?: DraftPathArchetype`** (9º campo, opcional).
  `isValidSuggestionsPreviewRequest`: si está presente y no es uno de los 4 literales → body
  inválido → `400` (mismo criterio que `targetPosition`).
- **`computeSuggestionsForState` gana `archetypeIntent?` en `options`**, se pasa tal cual a
  `buildSuggestions`. **Todos** los caminos en vivo (`hello`, push tras cada `/ingest/draft-event`,
  reconexión) leen `sessionStore.archetypeIntent(sessionId)` y lo pasan. `handleSuggestionsPreview`
  lo toma de `body.archetypeIntent`. `computeV5Fallback` (ruta `pro-drafter.ts`) **no cambia**.
- **El handler de `set_intent`**: sobre una sesión suscrita → `setArchetypeIntent(...)`; **si el
  valor cambió**, recalcula y publica **sólo `suggestions`** (no `snapshot`, no `draft_state` — el
  tablero no cambió). Si el valor es igual al almacenado, **no-op** (guarda de idempotencia). Esto
  es una excepción explícita al orden de push `draft_state` → `suggestions`, igual que
  `draft_paths` ya lo es.
- **4.3 no toca `SCORING_WEIGHTS_V6` ni ningún archivo de `signals/`.** Si el QA de calibración
  (§11.14.8) pide otro `w`, es un follow-up que acuña `SCORING_WEIGHTS_V7` con la misma estructura
  `V5 × (1 − w)` y su candado de regresión cero re-corrido.

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

## Fase 8 — rehabilitar `counter` (base curada + shrinkage) (S3) — SPEC.md §14

Toca `apps/engine/src/signals/{counter,relationship-index,mix,hero-counters}.ts` +
`hero-counters.json`. Estrictamente aditivo salvo la re-parametrización deliberada de la capa
estadística (§14.7), con candado de regresión cero de dos pruebas.

- **`SignalId`, `SCORING_WEIGHTS_V1`-`V6`, `RAW_RANGE.counter` (`[-0.12, 0.12]`), `weights.ts` no
  se tocan.** `RELATIONSHIP_MIN_GAMES = 200` sigue exportado con su valor — el default del módulo
  no cambia; `counter.ts` llama a `createRelationshipIndex(matchups, COUNTER_MIN_GAMES)` con el
  valor bajo.
- **`counterScorer` (singleton) → `createCounterScorer(curated, opts)`**, mismo patrón que
  `createPositionFitScorer`/`createTeamSynergyScorer`. `CounterScorerOptions`: `minGames?`
  (default `COUNTER_MIN_GAMES`; el candado pasa `200`), `shrinkPriorStrength?: number | null`
  (default `COUNTER_SHRINK_PRIOR_STRENGTH`; `null` → usa el delta crudo, comportamiento de hoy).
- **`mix.ts`**: `MODULE_HERO_COUNTERS = loadHeroCounters()` a nivel de módulo (como
  `MODULE_HERO_POSITIONS`); `createCounterScorer(options.heroCounters ?? MODULE_HERO_COUNTERS)`
  ensamblado por llamada; `BuildSuggestionsOptions.heroCounters?` inyectable (patrón
  `heroPositions?`/`heroCapabilities?`).
- **`signals/hero-counters.ts` (`loadHeroCounters`)**: valida en el borde — descarta `level` fuera
  de `{"hard","medium"}`, `why` vacío, `vs` no entero o desconocido (`CURATED_HERO_IDS`), víctima
  con `vs` duplicado. Archivo ausente / JSON inválido / forma de raíz inesperada → **`Map` vacío**,
  nunca lanza. Mismo criterio literal que `loadHeroPositions()` con archivo malformado.
- **`hero-counters.json`**: keyed por víctima, `{ "<heroId>": [{ vs, level, why }] }`. Archivo
  estático versionado en el repo, **no SQLite**. `why` es texto visible (obligatorio).
- **`relationship-index.ts`**: único cambio = agregar `observedWinrate: row.wins / row.games` a
  `CounterEvidence` (1 línea, aditivo — los consumidores actuales lo ignoran). Sin cambios
  estructurales.
- **Fórmula de `score()`** (§14.5): para cada rival revelado `r`, una `c_r` — capa curada
  (prioridad, bidireccional: `curated[candidate]` incluye `r` → `-M[level]`; `curated[r]` incluye
  `candidate` → `+M[level]`) o, si `r` no quedó cubierto, capa estadística
  (`shrunkWinrate - base`, con `base = observedWinrate - delta` y
  `shrunkWinrate = shrinkEstimate(observedWinrate, games, base, P)`; `shrinkPriorStrength: null`
  ⇒ `= delta`). `raw = mean(c_r)` sobre los rivales cubiertos; `null` si ninguno.
  `sampleSize` = Σ `games` **sólo** de la capa estadística.
- **`shrinkEstimate` se reutiliza de `apps/engine/src/pro/shrinkage.ts`** (TSK-165) — no se
  reimplementa. Shrink hacia el **baseline del candidato**, no hacia 0.5.
- **Constantes** (`counter.ts`): `M = { hard: 0.12, medium: 0.06 }`, `COUNTER_MIN_GAMES = 10`,
  `COUNTER_SHRINK_PRIOR_STRENGTH = 20`. Valores de arranque, ajustables tras el QA — no reabren
  el SPEC.
- **Cero red en el camino caliente, intacta**: `counter.ts`/`hero-counters.ts` bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` bloquea cualquier `fetch(`. El JSON se
  carga una vez al iniciar el módulo.
- **Sin dependencia nueva, sin STRATZ.** El peso `0.216` de `counter` en V6 no cambia — se
  rehabilita la señal, no se re-pondera.

### Fase 8 addendum — alivio por counters baneados (`TSK-188`, SPEC.md §14.13)

- Término **positivo** aditivo dentro de `createCounterScorer`, sobre el mismo `raw` de `counter`
  — **no** una clave nueva en `SignalId`/`RAW_RANGE`/`weights.ts`.
- Fuente: `curated.get(candidate)` (héroes que counterean al candidato) ∩
  `observedDraftFacts(state).bannedHeroes`. Solo dirección positiva.
- **Vota desde el pick 1** (no necesita `revealedEnemyPicks`). `counter` deja de ser siempre
  `null` en picks tempranos.
- `banRelief === 0` → `raw = meanRevealed` **sin clamp** (8A byte-idéntico, el candado de §14.7
  sigue dando `0.12222`); `banRelief > 0` → `raw = clamp(meanRevealed + banRelief, -M.hard,
  M.hard)`. `meanRevealed = 0` si no hay rivales cubiertos; `contribs` vacío **y**
  `banRelief === 0` → `raw: null`. `banRelief` no suma a `sampleSize`.
- Constantes de arranque QA-tuneables: `BAN_RELIEF = { hard: 0.04, medium: 0.02 }`,
  `BAN_RELIEF_CAP = 0.06`.
- `explanation`: cláusula `"N de sus counters están baneados: <hasta 2 nombres>"`, anexada al
  texto de 8A si hubo rival revelado, o sola si solo hubo alivio.
- Candado de regresión §14.7 intacto: con `curated = new Map()`, `banRelief` es siempre 0.

## Fase 9 — V6-medido → V6-contextual (SPEC.md §15)

Programa 9.0→9.5. **Sólo 9.0 está especificada a nivel ejecutable**; 9.1 tiene el mecanismo fijado
con números diferidos a su gate; 9.2–9.5 son conceptuales (cada una abre su `/blueprint` angosto).

### 9.0 — regla dura: no se toca el motor

- **9.0 no cambia una línea de `apps/engine/src/**` ni de `apps/web/src/**`.** Criterio de
  aceptación verificable con `git diff --name-only`. No toca `signals/`, `weights.ts`, `mix.ts`,
  `RAW_RANGE`, `SignalId`, `SCORING_WEIGHTS_V6`. `ENABLE_PRO_DRAFTER` y el comportamiento de
  producción quedan idénticos.
- **`scripts/eval/**` y `scripts/stats/**` nunca se importan desde `apps/`.** Verificable
  mecánicamente. Son runners offline; leer código del motor como import (para medirlo) está
  permitido, escribir en él no.
- **`pro-drafts.sqlite` y `dota2coach.sqlite` se abren `readonly: true`** desde todo script de
  Fase 9. Un guard aborta si detecta una ingesta escribiendo el mismo archivo (regla que ya existía
  para el backfill, ahora mecánica).
- **Ninguna prueba abre `pro-drafts.sqlite`, `dota2coach.sqlite`, `eval/golden/` real ni un JSON de
  `data/generated/`** — fixtures inline. Mismo criterio literal que S9/S10 desde Fase 2 (costuras
  S15–S19, ver `testing-seams.md`).

### Reconstrucción de `DraftState` desde el corpus (S15)

- El replay (`buildReplayCases`) es **función pura**: `(ProDraftTurn[], meta) => ReplayCase[]`, sin
  I/O.
- `state.localSide` = **el equipo que actúa en ese turno**, para que `observedDraftFacts()` devuelva
  `ownPicks`/`revealedEnemyPicks` correctos sin tocar el motor.
- `state.banned` / `state.picks` = **exactamente** el prefijo `[0, turnIndex)`. **Ninguna filtración
  de turno futuro** — es la única fuga posible en este diseño y se prueba explícitamente.
- 9.0 evalúa **sólo los turnos `is_pick = 1`**. Los bans se reconstruyen como estado, no se predicen
  (el motor no tiene recomendador de ban con el flag apagado).
- Draft con shape inválido (≠24 turnos, héroe repetido, `team` fuera de `{0,1}`) → **se descarta con
  motivo registrado**, nunca se repara.

### Realidad del corpus (medida 2026-08-29, no estimada — SPEC §15.1)

- **2.164** drafts con shape válido (de 2.179). Los 826 `tier_not_accepted` **entran** al backtest
  con `tier` como covariable — es política de curación de Fase 7, no un defecto de dato.
- **Mono-parche**: `patch = 60` en los 2.179. El eje `patch` del fallback jerárquico de calibración
  (9.1) **nace inerte**; sólo `global` y `bracket` (8, balanceados) estratifican.
- `hero_matchups`: `p50 = 54`, `p90 = 175`, **máx 712** partidas por par. En 9.2 el término `δ_AB`
  del Empirical Bayes quedará fuertemente encogido y el orden lo dominarán los efectos principales —
  **resultado esperado, no fallo**.
- **No existe snapshot de meta point-in-time.** El backtest es un instrumento **comparativo**
  (V6 vs V6+cambio sobre el mismo snapshot), **nunca predictivo**. El valor absoluto de cualquier
  métrica no es interpretable sin sus baselines.

### 9.1+ (mecanismo fijado, números diferidos)

- **`SignalContribution` gana `normalized: number | null` y `evidenceConfidence: number` (aditivo)**
  — ningún campo actual se borra. Espejo en `apps/web` en el mismo cambio (ver `web.md`).
- **`raw: null` sigue siendo sagrado**: nunca se convierte en 0, 0.5 ni 50. Cambia cómo se propaga
  su ausencia (fin de la redistribución candidate-specific), no que se rellene.
- **Calibración** `N(x) = clamp((x − P05)/(P95 − P05), 0, 1)` con fallback jerárquico
  `global → bracket`, percentiles **congelados sobre el split de train**. Candado de regresión
  obligatorio: calibración desactivada + opciones legacy ⇒ `mixScore` reproduce V6 **exacto**.
- **Loader de calibración (S18)**: `data/generated/*.json` es input externo. Validado en el borde;
  corrupto/ausente/forma inesperada → **degrada al mecanismo V6 actual**, nunca lanza, nunca inyecta
  magnitudes arbitrarias. Mismo criterio literal que `loadHeroPositions()`/`loadHeroCounters()`.
  Se carga **una vez al iniciar el módulo** (patrón `MODULE_HERO_*`), nunca por llamada.
- `SCORING_WEIGHTS_V7` **sólo en 9.5**, regularizado hacia V6, con el split congelado de §15.4.3.
  V1–V6 congeladas por nombre.

## Fase 9.1 — comparabilidad + calibración empírica (SPEC.md §16)

9.1 **sí toca `apps/engine/src/signals/`** (a diferencia de 9.0). Cambia el mecanismo de
normalización y de mezcla. **No toca `weights.ts`** — `SCORING_WEIGHTS_V6` sigue activa; V7 es 9.5.
`counter` NO se parte en 3 (eso es 9.3). Empirical Bayes es 9.2. Gating contextual es 9.3.

- **`raw: null` sigue sagrado** — nunca 0/0.5/50. 9.1 agrega un campo `contribution` separado y un
  relleno `μ` que **jamás** se escribe en `raw`. El desglose de una señal sin dato sigue diciendo
  "sin datos suficientes".
- **`SignalContribution` gana `normalized: number | null` y `evidenceConfidence: number`**
  (aditivo, ningún campo se borra). El contrato `SignalScorer.score()` **no cambia de firma** —
  esos dos campos los agrega `mix.ts`/`enrich()` después de llamar a cada scorer.
  - `normalized = raw === null ? null : clamp((raw − p05)/(p95 − p05), 0, 1) * 100`, con
    `p05`/`p95` de `data/generated/percentiles.json` (`byBracket` del estado si existe, si no
    `global`, si no falta el archivo → `RAW_RANGE[signal]`).
  - `evidenceConfidence`: estadísticas (`counter`/`patch_meta`/`position_fit`) →
    `raw === null ? 0 : sampleSize/(sampleSize + K)` con `K_position_fit=200`, `K_counter=20`,
    `K_patch_meta=200` (arranque, QA-tuneable). Categóricas (`team_synergy`/`hero_pool_fit`/
    `archetype_fit`) → `raw === null ? 0 : 1`.
- **Calibración empírica (S18)**: `loadCalibration()` valida en el borde (esquema, `p05 < p95`,
  no NaN, `SignalId` conocido); archivo corrupto/ausente/forma inesperada → **fallback a
  `RAW_RANGE`**, byte-idéntico a V6, **nunca lanza**. Se carga **una vez al iniciar el módulo**
  (patrón `MODULE_HERO_*`). Los percentiles se congelan sobre folds de **train** del `split.json`
  de 9.0 — nunca el fold held-out.
- **Fin de la redistribución candidate-specific → mezcla por estado** (`mix.ts`):
  1. `A(S)` = señales estructuralmente aplicables al estado `S`, **igual para todo candidato de
     `S`**: `position_fit` siempre (salvo `localSide === "unknown"`); `counter` si hay rivales
     revelados o un counter curado sobre un baneado; `team_synergy` si hay picks propios;
     `patch_meta` si hay calibración de `patch_meta`; `hero_pool_fit` si `meta.heroPool` no vacío;
     `archetype_fit` si hay `archetypeIntent`.
  2. `wᵢ' = SCORING_WEIGHTS_V6[i] / Σ_{j∈A(S)} SCORING_WEIGHTS_V6[j]` — **mismo denominador para
     todo candidato de `S`**.
  3. `μᵢ(S)` = media de `normalizedᵢ(h)` sobre los candidatos de `S` con `rawᵢ(h) ≠ null`.
     Si ninguno tiene dato → `μᵢ(S) = 50` (**único lugar donde aparece un neutro, nunca en `raw`**).
  4. `contributionᵢ(h)`: `i ∉ A(S)` → 0; `rawᵢ(h) ≠ null` → `wᵢ'·normalizedᵢ(h)`;
     `rawᵢ(h) = null` → `wᵢ'·μᵢ(S)`.
  5. `score(h) = Σ contributionᵢ(h)` ∈ `[0, 100]`.
- **`EvidenceCoverage(h) = Σ_{i∈A(S), rawᵢ(h)≠null} wᵢ'`**; **`GuessingIndex(h) = 1 − EvidenceCoverage(h)`**.
  `computeConfidence` pasa a derivarse de `EvidenceCoverage`: `alta` si `≥ 0.75` y meta no stale;
  `media` si `≥ 0.5` o meta stale; `baja` si `< 0.5` (umbrales de arranque).
- **`Suggestion` gana `evidenceCoverage` y `guessingIndex` (0–1).** **No se renderiza en 9.1** (UI
  diferida, D4) — sólo el tipo y los reportes de eval.
- **Candado de regresión cero (obligatorio)**: con `loadCalibration()` en fallback + `A(S)` =
  "señales con `raw ≠ null` para el candidato" (legacy) + sin usar `μᵢ(S)`, `mixScore` y
  `buildSuggestions` reproducen V6 **byte a byte**. Prueba con números concretos en `mix.test.ts`.
- Presupuesto intacto: 300 ms / corte 500 ms. `μᵢ(S)` exige una segunda pasada por candidato por
  estado — despreciable con ~110 candidatos × 6 señales.
