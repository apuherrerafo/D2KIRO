# SPEC.md — dota2coach, fase 1 (Draft Coach)

Generado por `/blueprint` (Opus, única ejecución del proyecto) a partir de
`docs/agents/architecture.md`. Este documento es el **contrato de desarrollo**: lo que
`/rulebook` traduce a reglas y tickets, y contra lo que `@redteam` y Sentinel verifican.

Todo lo que no esté aquí, no es fase 1. Si algo de aquí se contradice con el código, gana
este documento hasta que se actualice explícitamente (una discrepancia seria confirmada
entre SPEC y código es uno de los gatillos de Opus documentados en `CLAUDE.md`).

---

## 0. Decisiones cerradas en esta fase

`architecture.md` dejó tres puntos abiertos. Quedan cerrados así:

| # | Ambigüedad en `architecture.md` | Decisión | Razón |
|---|---|---|---|
| D1 | "Overwolf SDK y/o OCR" sin decidir | **Simulador + entrada manual son capturadores de primera clase en fase 1.** Overwolf y OCR se especifican como adaptadores del mismo contrato, se construyen después. | Ataca primero el riesgo central declarado (el motor de sugerencias) sin depender de la incógnita de captura. Si Overwolf no expone el draft, no se pierde trabajo. |
| D2 | Sinergia entre aliados, sin fuente | **Contrapick y meta salen de datos reales de OpenDota. La sinergia es una heurística explícita y auditable sobre datos de OpenDota, marcada en la UI como señal más débil.** Sin STRATZ, sin API key, sin dependencias nuevas. | Evita un segundo proveedor externo (y un secreto) el día uno. La interfaz `MetaProvider` queda lista para enchufar sinergia medida más adelante sin tocar el motor. |
| D3 | "Backend Next.js" (diagrama) vs. "Bun como runtime" (stack) | **Dos procesos locales**: `apps/web` (Next.js — sitio, futuro login, RTK Query) y `apps/engine` (Bun — motor, WebSocket, SQLite). | El WebSocket y el SQLite nativos de Bun son justamente lo que Next.js no da bien, y el capturador le habla directo al motor sin pasar por el sitio. |

---

## 1. Costuras (seams) — dónde se prueba cada cosa

Se definen **antes** que el comportamiento, por regla de `/blueprint`. Si un componente no
aparece aquí, no está listo para implementarse.

| Costura | Frontera | Qué es real en la prueba | Qué se reemplaza |
|---|---|---|---|
| **S1 — Contrato de eventos de draft** | Capturador → Motor | El reductor de estado completo | El capturador: se inyectan secuencias de `DraftEventEnvelope` grabadas en archivos de fixture |
| **S2 — `MetaProvider`** | Motor → datos de meta | El motor de sugerencias completo | El proveedor: `FakeMetaProvider` con tablas fijas en memoria. **Cero red en las pruebas del motor.** |
| **S3 — `SignalScorer`** | Motor → cada señal individual | Nada más; cada scorer es una función pura probada sola | Nada. Entrada: `(DraftState, HeroId, MetaSnapshot)`. Salida: `SignalContribution`. |
| **S4 — `applyDraftEvent`** | Reductor de estado | Función pura, sin I/O, sin reloj propio | El reloj y los ids se inyectan como parámetros |
| **S5 — Transporte WebSocket** | Motor → Frontend | El store de Zustand y los componentes de la vista de draft | El socket: `FakeSocket` que emite `ServerMessage` tipados |
| **S6 — Sincronización de meta** | OpenDota → SQLite | El mapeo y la escritura en SQLite | El cliente HTTP: respuestas grabadas de OpenDota en fixtures |

**Regla derivada, no negociable:** el motor de sugerencias **nunca** llama a la red. Todo lo
que necesita ya está en SQLite antes de que empiece el draft. Si no está, degrada — no espera.

---

## 2. Componentes

Cinco componentes. Cada uno con comportamiento, entradas/salidas, estados y errores.

```
┌──────────────────────────────────────────────────────┐
│ C1 CAPTURADORES (adaptadores intercambiables)         │
│  · simulador   · manual   · overwolf(*)   · ocr(*)    │
└───────────────────────┬───────────────────────────────┘
                        │ S1: DraftEventEnvelope (HTTP loopback)
                        ▼
┌──────────────────────────────────────────────────────┐
│ apps/engine (Bun)                                     │
│  C2 SESIÓN DE DRAFT  ──S4── reductor puro             │
│  C3 MOTOR DE SUGERENCIAS ──S3── scorers puros         │
│  C4 META (SQLite/Drizzle) ──S2── MetaProvider         │
│         ▲ S6: sincronización fuera del camino caliente │
│         └──── OpenDota                                 │
└───────────────────────┬───────────────────────────────┘
                        │ S5: WebSocket (push)
                        ▼
┌──────────────────────────────────────────────────────┐
│ C5 apps/web (Next.js) — vista de draft + sitio        │
└──────────────────────────────────────────────────────┘

(*) especificados como contrato, construidos después de validar C3
```

---

### C1 — Capturadores

**Comportamiento esperado:** observar un draft (real o simulado) y emitir eventos discretos
al motor. Un capturador **no interpreta reglas del modo de juego, no decide de quién es el
turno, y no conoce el motor**: solo reporta lo que observó, con un nivel de confianza.

**Adaptadores de fase 1:**

| Adaptador | Qué hace | Confianza reportada |
|---|---|---|
| `simulator` | Reproduce un guion de draft desde un archivo JSON, a velocidad configurable (incluida "instantánea") | `1.0` |
| `manual` | El usuario marca picks/bans en la propia UI cuando la detección automática falla o no existe | `1.0` |
| `overwolf` | *(contrato definido, implementación posterior)* traduce eventos del SDK de Overwolf | según el SDK |
| `ocr` | *(contrato definido, implementación posterior)* lee la pantalla del draft | `0.0–1.0` según el reconocimiento |

**Salida (S1) — contrato de eventos, versionado:**

```ts
type HeroId = number;                       // id numérico de Valve/OpenDota
type TeamSide = 'radiant' | 'dire';
type DraftFormatId = 'all_pick' | 'captains_mode';
type CaptureSource = 'simulator' | 'manual' | 'overwolf' | 'ocr';

interface DraftEventEnvelope {
  schema: 'draft-event/v1';
  eventId: string;        // único por evento — base de la idempotencia
  sessionId: string;
  seq: number;            // monótono creciente dentro de la sesión
  emittedAt: string;      // ISO-8601
  source: CaptureSource;
  confidence: number;     // 0.0 – 1.0
  payload: DraftEvent;
}

type DraftEvent =
  | { type: 'session_started'; format: DraftFormatId | 'unknown'; patch: string }
  | { type: 'local_side_identified'; side: TeamSide }
  | { type: 'hero_banned';  hero: HeroId; side: TeamSide | 'unknown' }
  | { type: 'hero_picked';  hero: HeroId; side: TeamSide }
  | { type: 'pick_reverted'; hero: HeroId; side: TeamSide }   // corrección: lo reportado antes era falso
  | { type: 'session_ended'; reason: 'completed' | 'aborted' | 'lost_capture' }
  | { type: 'capture_health'; status: 'ok' | 'degraded' | 'lost'; detail?: string };
```

`pick_reverted` existe porque OCR se equivoca. Sin un evento de corrección, un solo falso
positivo envenena el resto del draft. Todo adaptador debe poder emitirlo; `simulator` y
`manual` lo usan para deshacer.

**Errores y degradación:**

| Situación | Comportamiento obligatorio |
|---|---|
| El capturador pierde la ventana del juego | Emite `capture_health: lost`. La UI muestra el aviso y **habilita la entrada manual sin perder el estado ya capturado**. |
| Confianza por debajo de `0.6` | El evento se aplica igual, pero el estado queda marcado y la UI lo muestra como "sin confirmar", con un toque para corregir. |
| Héroe no reconocido | Se emite `capture_health: degraded` con detalle. **Nunca se inventa un `HeroId`.** |

---

### C2 — Sesión de draft (reductor)

**Comportamiento esperado:** mantener el estado del draft aplicando eventos, **sin predecir**.
El estado es un hecho observado, no una simulación de las reglas de Valve.

```ts
interface DraftState {
  sessionId: string;
  schema: 'draft-state/v1';
  format: DraftFormatId | 'unknown';
  patch: string;
  localSide: TeamSide | 'unknown';
  phase: 'idle' | 'active' | 'complete' | 'aborted';
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  lastSeq: number;
  appliedEventIds: string[];
  quality: { unconfirmed: HeroId[]; captureStatus: 'ok' | 'degraded' | 'lost' };
  updatedAt: string;
}
```

**Transiciones:**

```
idle ──session_started──▶ active ──session_ended(completed)──▶ complete
  ▲                         │
  │                         ├──session_ended(aborted|lost_capture)──▶ aborted
  └────────nueva sessionId──┘

en `active`: hero_banned | hero_picked | pick_reverted | local_side_identified
             | capture_health  → mutan el estado, no la fase
```

**Firma (S4), pura:**

```ts
function applyDraftEvent(
  state: DraftState,
  envelope: DraftEventEnvelope,
): { state: DraftState; rejected?: RejectionReason };

type RejectionReason =
  | 'duplicate_event'      // eventId ya aplicado
  | 'stale_seq'            // seq <= lastSeq y no es una corrección
  | 'wrong_phase'          // p. ej. un pick en fase `complete`
  | 'unknown_hero'         // el HeroId no existe en la tabla local de héroes
  | 'hero_already_taken';  // el héroe ya está baneado o elegido
```

**Reglas de error, explícitas:**

- **Idempotencia:** un `eventId` repetido se descarta en silencio (los capturadores reintentan).
- **Orden:** eventos con `seq` menor o igual al último aplicado se rechazan, **salvo**
  `pick_reverted`, que siempre se evalúa (es una corrección de algo pasado).
- **Un evento rechazado nunca tira la sesión.** Se registra y se devuelve el motivo; el estado
  anterior sigue siendo válido.
- **`format: 'unknown'` es un estado legítimo y operativo.** El sistema sugiere igual. Conocer
  el modo mejora la explicación (bans de Captain Mode pesan distinto), pero no es requisito.
- **No se modela la tabla de turnos de Valve en fase 1.** El algoritmo exacto de bans de All
  Pick en 7.35d no está documentado con claridad (ver `architecture.md`, Bloque 2). Especificar
  un turnero que adivine sería especificar un bug. El orden de turnos vive como **datos**
  (`DraftFormat`, una tabla por modo) para poder añadirlo después sin tocar el reductor.

---

### C3 — Motor de sugerencias

Es el riesgo central declarado del proyecto. Se especifica como **una tubería de etapas
separadas**, no como una consulta; cada etapa es probable por sí sola.

```
1. CANDIDATOS   todos los héroes − baneados − ya elegidos (ambos lados)
        ▼
2. SEÑALES      cada SignalScorer puntúa cada candidato, en aislamiento
        ▼
3. MEZCLA       normalizar a 0–100, aplicar pesos, sumar
        ▼
4. ORDEN        top 3: 1 principal + 2 alternativas
        ▼
5. EXPLICACIÓN  una frase corta en español por sugerencia, derivada de las señales
```

**Contrato de señal (S3) — todas las señales tienen la misma forma, sin excepciones:**

```ts
type SignalId = 'counter' | 'patch_meta' | 'team_synergy' | 'role_gap';

interface SignalContribution {
  signal: SignalId;
  raw: number | null;      // null = sin datos suficientes. NO es 0, NO es 0.5.
  weighted: number;
  explanation: string;     // frase corta, en español, mostrable tal cual
  sampleSize: number;      // partidas detrás del dato; 0 en señales heurísticas
}

interface SignalScorer {
  id: SignalId;
  score(state: DraftState, candidate: HeroId, meta: MetaSnapshot): SignalContribution;
}
```

`raw: null` es la pieza que evita el error clásico: **una señal sin datos no vota, no vota
neutro.** Cuando una señal devuelve `null`, su peso se redistribuye proporcionalmente entre las
señales que sí tienen dato, y la sugerencia baja de confianza.

**Las cuatro señales de fase 1:**

| Señal | Peso v1 | Fuente | Cómo se calcula | Umbral |
|---|---|---|---|---|
| `counter` | **0.40** | Real — OpenDota `/heroes/{id}/matchups` | Para cada héroe enemigo ya elegido, el winrate del candidato contra él menos su winrate base. Se promedia sobre los enemigos conocidos. | Un enfrentamiento con menos de **200 partidas** no cuenta. Sin ningún enfrentamiento válido → `raw: null`. |
| `patch_meta` | **0.25** | Real — OpenDota `/heroStats` | Winrate del candidato en el parche actual, **en el rango de MMR bajo/medio**, no en pro. El producto es para ese jugador (`architecture.md`, Bloque 1). | Menos de **500 partidas** en el bracket → `raw: null`. |
| `team_synergy` | **0.20** | **Heurística** (decisión D2) | Cobertura de capacidades faltantes en el equipo propio, usando `roles[]` de OpenDota: control, iniciación, aguante, empuje, curación/soporte. Puntúa alto lo que llena un hueco. | `sampleSize: 0` siempre. La UI la marca como señal estimada, no medida. |
| `role_gap` | **0.15** | **Heurística** | Penaliza el solapamiento de prioridad de farm: si el equipo propio ya tiene dos carries, otro carry baja. Complementa a `team_synergy` (una mira capacidades, la otra recursos). | `sampleSize: 0`. |

**Los pesos viven en una sola constante versionada** (`SCORING_WEIGHTS_V1`), en un archivo
propio. Una prueba unitaria verifica que suman exactamente `1.0`. Cambiar la calidad de las
sugerencias debe ser editar cuatro números, no reescribir el motor.

**Salida:**

```ts
interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;                        // 0–100
  signals: SignalContribution[];        // siempre las 4, incluidas las que dieron null
  reason: string;                       // "Fuerte contra Lina y Zeus; buen winrate este parche"
  confidence: 'alta' | 'media' | 'baja';
}

interface SuggestionSet {
  schema: 'suggestions/v1';
  sessionId: string;
  basedOnSeq: number;                   // el seq del estado que las produjo
  suggestions: Suggestion[];
  degraded: DegradationFlag[];
  computedInMs: number;
}

type DegradationFlag =
  | 'stale_meta'          // el cache de meta pasó su ventana de frescura
  | 'partial_signals'     // una o más señales devolvieron null
  | 'unconfirmed_state'   // hay héroes con confianza baja en el estado
  | 'unknown_format';
```

**Reglas de confianza:** `alta` = las 4 señales con dato y meta fresca. `media` = una señal en
`null` o meta vencida. `baja` = dos o más señales en `null`. **Una sugerencia de confianza
`baja` se muestra igual, marcada como tal.** Callarse durante un draft es peor que sugerir con
una advertencia visible.

**Errores:**

| Situación | Comportamiento |
|---|---|
| El cálculo supera **500 ms** | Se corta y se devuelve lo que haya, con `degraded: partial_signals`. Nunca se bloquea el push. |
| Un scorer lanza una excepción | Esa señal cuenta como `raw: null`; las otras tres siguen. **Una señal rota no cae el motor.** |
| No hay candidatos válidos | `suggestions: []` + mensaje explícito en la UI. No es un error del sistema. |
| El cache de meta está vacío (primer arranque) | Se sugiere solo con las heurísticas, `confidence: baja`, y la UI ofrece disparar la sincronización. |

---

### C4 — Meta y persistencia

**Comportamiento esperado:** tener los datos de OpenDota en SQLite **antes** de que empiece el
draft, y servirlos al motor sin tocar la red.

**Contrato (S2):**

```ts
interface MetaProvider {
  getHeroes(): Promise<HeroMeta[]>;
  getMatchups(hero: HeroId): Promise<MatchupRow[]>;
  getPatchStats(patch: string): Promise<PatchStatRow[]>;
  getFreshness(): Promise<{ syncedAt: string | null; isStale: boolean }>;
}
```

Tres implementaciones: `SqliteMetaProvider` (la única que usa el motor), `OpenDotaClient`
(solo lo usa el sincronizador) y `FakeMetaProvider` (pruebas).

**Esquema SQLite (Drizzle):**

| Tabla | Columnas | Nota |
|---|---|---|
| `heroes` | `id` PK, `name`, `localized_name`, `img_url`, `primary_attr`, `attack_type`, `roles` (JSON), `updated_at` | `img_url` cubre el requisito duro de mostrar siempre el ícono oficial |
| `hero_patch_stats` | `hero_id`, `patch`, `bracket`, `picks`, `wins`, `updated_at` — PK compuesta | Alimenta `patch_meta` |
| `hero_matchups` | `hero_id`, `vs_hero_id`, `games`, `wins`, `updated_at` — PK compuesta | Alimenta `counter` |
| `meta_sync` | `id`, `source`, `started_at`, `finished_at`, `status`, `rows_written`, `error` | Auditoría de sincronización |
| `settings` | `key` PK, `value` | Preferencias locales |

**No se crea tabla de historial de partidas.** Eso es fase 1b (`architecture.md`, Bloque 1).
El estado de la sesión de draft vive **en memoria** en fase 1 y se pierde al reiniciar el
motor; es aceptable porque un draft dura ~5 minutos.

**Sincronización (S6):** trabajo aparte, fuera del camino caliente. Se dispara al arrancar el
motor si el cache está vencido, y manualmente desde la UI. Ventana de frescura: **24 horas**.

**Errores:**

| Situación | Comportamiento |
|---|---|
| OpenDota devuelve 429 (límite de peticiones) | Reintento con espera creciente (1s, 4s, 16s), máximo 3 intentos. Si falla, `meta_sync.status = 'failed'` y **se sigue usando el cache viejo**. |
| OpenDota caído o sin internet | Idéntico: el cache viejo sigue sirviendo, con `degraded: stale_meta` visible. **Un draft nunca se queda sin sugerencias por una API de terceros.** |
| Respuesta con forma inesperada (cambio de API) | Se valida en el borde; los registros inválidos se descartan y se cuentan en `meta_sync.error`. **Una escritura parcial nunca deja el cache a medias**: la sincronización de cada tabla es transaccional. |
| Héroe nuevo tras un parche | Entra en `heroes` en la siguiente sincronización. Hasta entonces, un evento con ese id se rechaza con `unknown_hero` y avisa en la UI. |

---

### C5 — Frontend (Next.js)

**Dos regímenes de datos en la misma app, deliberadamente:**

- **Páginas normales del sitio** (inicio, configuración, estado del meta, héroes): RTK Query
  contra `apps/engine`. Estructura de rutas preparada para añadir login más adelante sin
  reescritura (`architecture.md`, Bloque 4).
- **Vista de draft en vivo**: **única excepción** — WebSocket + Zustand. La misma página sirve
  en pestaña de navegador y embebida en un overlay de Overwolf. Un solo frontend, sin UI
  duplicada.

**Estados de la vista de draft (todos deben existir en pantalla, ninguno es opcional):**

| Estado | Qué ve el usuario |
|---|---|
| `desconectado` | Aviso + botón de reconectar. El último estado conocido sigue visible, atenuado. |
| `esperando_draft` | "Esperando a que empiece el draft" + botón de entrada manual + botón de simulador. |
| `activo` | Tablero de picks/bans con íconos oficiales + 1 sugerencia principal + 2 alternativas + señales expandibles. |
| `degradado` | Igual que `activo`, con la bandera de degradación visible y explicada en lenguaje llano. |
| `completo` | Draft final, sin sugerencias nuevas. |
| `error` | Mensaje concreto + acción de recuperación. Nunca una pantalla en blanco. |

**Reconexión:** al abrir el socket, el cliente manda `hello`; el servidor **siempre responde
con una instantánea completa** del estado, no con deltas. El estado del draft es pequeño (≤10
héroes); la complejidad de un protocolo incremental no se paga aquí.

**Convenciones de código** — heredadas de la memoria del usuario, aplican sin excepción:
TypeScript estricto sin `any`, sin ternarios para renderizado condicional, sin funciones
anónimas, un componente una responsabilidad, lógica de más de ~20 líneas extraída a un hook de
la feature, componentes atómicos en carpeta común, error boundary y estado de carga por
feature, arquitectura por features (`index.ts`, componente, `styles.ts`, `constants.tsx`,
`types.ts`).

**Taxonomía de design system** (definida temprano para que `/design-forge` sea una extensión y
no una reescritura, según Bloque 5):

- **Color por rol semántico, nunca por valor:** `--surface-*`, `--content-*`, `--accent-*`,
  `--signal-positive` / `--signal-negative` / `--signal-warning`. Prohibido un hex suelto en un
  componente.
- **Espaciado:** escala de 4 px, nombrada `space-1` … `space-12`.
- **Tipografía:** `text-caption` / `text-body` / `text-heading` / `text-display`.
- **Nombres de componentes:** `<Dominio><Cosa>` — `DraftBoard`, `DraftHeroSlot`,
  `SuggestionCard`, `SignalBreakdown`.
- El pulido visual (hover/pressed/focus/disabled, estética "glass") es requisito duro cuando se
  construyan pantallas, vía `/design-forge` + `artisan`, auditado por `ux-senior`.

---

## 3. API — contratos

Todo `apps/engine`, escuchando **únicamente en `127.0.0.1`**.

### HTTP

| Método | Ruta | Quién llama | Cuerpo / respuesta |
|---|---|---|---|
| `POST` | `/ingest/draft-event` | Capturadores | `DraftEventEnvelope` → `202 { accepted: boolean, rejected?: RejectionReason }` |
| `GET` | `/api/health` | Web | `{ status, uptimeMs, activeSessions }` |
| `GET` | `/api/heroes` | Web | `HeroMeta[]` (con `img_url`) |
| `GET` | `/api/meta/status` | Web | `{ syncedAt, isStale, lastSync }` |
| `POST` | `/api/meta/sync` | Web | `202 { syncId }` — asíncrono, no bloquea |
| `POST` | `/api/session/manual` | Web (entrada manual) | Mismo `DraftEventEnvelope`, `source: 'manual'` |

### WebSocket — `/ws/draft`

```ts
interface ServerMessage {
  schema: 'draft-ws/v1';
  type: 'snapshot' | 'draft_state' | 'suggestions' | 'capture_status' | 'error';
  seq: number;
  sentAt: string;
  payload: DraftState | SuggestionSet | CaptureStatus | ErrorPayload;
}

interface ClientMessage {
  schema: 'draft-ws/v1';
  type: 'hello' | 'ping';
  sessionId?: string;
}
```

**Orden garantizado tras cada evento aplicado:** primero `draft_state`, después `suggestions`.
El tablero se actualiza al instante aunque el motor tarde; la UI nunca queda desincronizada
del estado real esperando un cálculo.

---

## 4. Rendimiento

Criterio de `architecture.md`, Bloque 6: **la sugerencia aparece en menos de 2–3 segundos** tras
cada pick/ban. Presupuesto repartido, medible por tramo:

| Tramo | Presupuesto | Cómo se verifica |
|---|---|---|
| Captura → `POST /ingest` | ≤ 500 ms | Marca de tiempo del capturador vs. llegada |
| Validación + reductor | ≤ 20 ms | Prueba de rendimiento sobre la función pura |
| Motor de sugerencias | ≤ 300 ms (corte duro a 500 ms) | `computedInMs` en cada `SuggestionSet` |
| Push WebSocket | ≤ 50 ms | Local, medido en la prueba de integración |
| Render en el frontend | ≤ 150 ms | React Profiler sobre la vista de draft |
| **Total observado** | **≤ 1 s en camino normal** | Deja ~2 s de margen contra el criterio de aceptación |

**Regla que hace que esto se cumpla:** cero red en el camino caliente. Las ~120 filas de héroes
y sus enfrentamientos ya están en SQLite local antes del primer pick.

---

## 5. Seguridad

Hereda el Bloque 4 de `/pre-flight` y las reglas de `CLAUDE.md`. Es un gate, no un checklist
final.

| Requisito | Cómo se cumple en fase 1 |
|---|---|
| Sin exposición de red innecesaria | `apps/engine` **se ata a `127.0.0.1`**, nunca a `0.0.0.0`. Un binding a `0.0.0.0` es FAIL automático de revisión. |
| Autenticación local del capturador | `POST /ingest/draft-event` exige la cabecera `x-capture-token`, generada al arrancar el motor y leída desde variable de entorno por el capturador. Sin token en el repo. |
| Validación de todo input externo | **Todo** `DraftEventEnvelope` y **toda** respuesta de OpenDota se validan contra esquema en el borde, antes de tocar lógica de negocio. Datos de una API pública son input externo, igual que un formulario. |
| Consultas parametrizadas | Exclusivamente vía Drizzle. Cero SQL concatenado. |
| Escapado de HTML | React escapa por defecto; **prohibido `dangerouslySetInnerHTML`** en toda la app. Los nombres de héroe vienen de OpenDota — se tratan como texto no confiable. |
| Imágenes de héroe | `img_url` apunta al CDN de Valve. Se valida que el host esté en la lista permitida antes de renderizar; nada de URLs arbitrarias de la respuesta de la API. |
| Secretos | **Fase 1 no requiere ninguna API key** (OpenDota sirve sin clave en su nivel gratuito). El único secreto es el token de captura, generado en ejecución, siempre en `process.env`. Un literal sospechoso en el diff es FAIL en `verify-simplicity.sh`. |
| Privilegio mínimo | El capturador usa solo los permisos que Overwolf ya concede, sin admin. El motor solo necesita salida a internet hacia OpenDota y lectura/escritura de su archivo SQLite. |
| Límite de peticiones al ingreso | `/ingest/draft-event` acepta como máximo 20 eventos/segundo por sesión; el exceso se descarta con `429`. Un capturador en bucle no debe poder tumbar el motor. |
| Datos personales | Ninguno en fase 1: solo estadísticas públicas agregadas. La pregunta de privacidad se retoma en 1b, al consultar historial ligado a una cuenta de Steam. |
| Puerta abierta a login | Estructura de rutas y capa de datos de Next.js preparadas para añadir autenticación sin reescritura. **No se implementa nada de auth en fase 1.** |

---

## 6. Criterios de aceptación

Traducción directa de los 4 criterios del Bloque 6 a algo verificable:

| # | Criterio | Verificación |
|---|---|---|
| 1 | **Captura correcta** | Con el simulador reproduciendo un draft de Captain Mode y otro de All Pick, la UI refleja cada pick/ban en orden y sin perder ninguno. `format: 'unknown'` no rompe la vista. Luego se repite contra una partida real. |
| 2 | **Sugerencias con sentido** | Sobre un set de al menos 5 drafts guardados, el usuario juzga cualitativamente las sugerencias como coherentes. **Cada sugerencia debe poder explicarse mirando su desglose de señales** — si el usuario no entiende por qué apareció, es un fallo del criterio aunque el héroe sea bueno. |
| 3 | **Velocidad** | `computedInMs` bajo 300 ms en el p95, y menos de 2 s de extremo a extremo medidos en la prueba de integración. |
| 4 | **Simulador independiente** | Un draft completo se reproduce sin Dota 2 abierto, con la misma ruta de código que el capturador real (S1). |

---

## 7. Lo que este SPEC deja abierto a propósito

No son omisiones: son incógnitas reales que no se resuelven documentándolas.

1. **Qué expone Overwolf realmente para el draft de Dota 2.** Pendiente de validación empírica
   del usuario. La decisión D1 hace que esto **no bloquee** la fase 1.
2. **El algoritmo exacto de bans de All Pick en 7.35d.** No documentado oficialmente. El
   reductor no lo asume (§C2).
3. **La biblioteca de validación de esquemas.** El SPEC exige validar en el borde, pero elegir
   la biblioteca es una dependencia nueva → **debe pasar por `/gear-up` o `@depcheck`**, no se
   decide aquí.
4. **Bun no está instalado en la máquina** (`TOOLKIT.md`). Es un requisito previo a cualquier
   ticket de `apps/engine`.
5. **Calibración de los pesos de las señales.** `SCORING_WEIGHTS_V1` es un punto de partida
   razonado, no un resultado medido. Se ajusta con el criterio 2 de aceptación en la mano.

---

## 8. Entrada para `/rulebook`

Fronteras naturales de ticket, en orden de dependencia. **No son tickets todavía** — `/rulebook`
los formaliza con `preferred_tool` y límites de archivos:

1. Esqueleto del monorepo (`apps/web`, `apps/engine`) + Bun instalado.
2. Esquema de SQLite/Drizzle (§C4) — cuenta como **una unidad lógica** por la excepción
   documentada en `CLAUDE.md`.
3. `OpenDotaClient` + sincronización de meta (S6) — con fixtures, sin red en las pruebas.
4. `applyDraftEvent` puro + contrato de eventos (S1, S4).
5. Los cuatro `SignalScorer` (S3) — **uno por ticket**, cada uno con sus pruebas.
6. Mezcla, orden y explicación del motor (§C3).
7. Servidor Bun: ingreso HTTP + WebSocket + seguridad de §5.
8. Simulador de draft + guiones de prueba.
9. Vista de draft en Next.js (S5) con sus 6 estados.
10. Entrada manual y camino de degradación.
11. Páginas del sitio (estado del meta, héroes, configuración) con RTK Query.
