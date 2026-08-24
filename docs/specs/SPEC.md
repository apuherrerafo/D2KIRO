# SPEC.md — dota2coach, fase 1 (Draft Coach)

Generado por `/blueprint` (Opus, única ejecución del proyecto) a partir de
`docs/agents/architecture.md`. Este documento es el **contrato de desarrollo**: lo que
`/rulebook` traduce a reglas y tickets, y contra lo que `@redteam` y Sentinel verifican.

Todo lo que no esté aquí, no es fase 1. Si algo de aquí se contradice con el código, gana
este documento hasta que se actualice explícitamente (una discrepancia seria confirmada
entre SPEC y código es uno de los gatillos de Opus documentados en `CLAUDE.md`).

> **Fase 1b vive al final de este archivo**, como parte anexada (§9 en adelante), no reescribiendo
> lo de arriba. Lo que 1b supersede está listado explícitamente en §9.0 — si una fila de fase 1 no
> aparece ahí, sigue vigente tal cual.

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

---
---

# SPEC — Fase 1b (Personalización de hero pool)

Generado por `/blueprint` (segunda ejecución en Opus del proyecto) a partir del addendum
"Fase 1b" de `docs/agents/architecture.md`. La segunda ejecución en Opus **no es una excepción
nueva**: cae en un gatillo ya documentado en `CLAUDE.md` — *cambio de trust boundary respecto a
lo que definió `/pre-flight`* (el `account_id` de Steam es el primer dato personal del proyecto).
De aquí en adelante, Sonnet otra vez.

Mismo estatuto que fase 1: esto es contrato. Lo que no esté aquí, no es fase 1b.

## 9.0 — Qué de fase 1 queda superado por 1b

Todo lo demás de §0–§8 sigue vigente sin cambios. Solo estas cinco cosas se mueven:

| Fase 1 decía | 1b lo cambia a |
|---|---|
| §C3: `SignalId` son 4 valores | 5 valores — se añade `hero_pool_fit` (§9.3) |
| §C3: `SCORING_WEIGHTS_V1` (0.40 / 0.25 / 0.20 / 0.15) | `SCORING_WEIGHTS_V2`, 5 pesos (§9.3, D8). V1 **no se borra ni se edita** — se deja versionado por nombre, como manda `engine.md` |
| §C3: `Suggestion.signals` "siempre las 4" | siempre las **5** |
| §C4: tablas de SQLite | + tabla `hero_pool`; + claves `steam_account_id` y `personal_baseline_winrate` en `settings` (§9.4) |
| §5: "Datos personales: ninguno en fase 1 (…) se retoma en 1b" | Se retoma aquí: §9.7 |

**Regresión cero sobre el MVP, y es demostrable, no una promesa** (§9.3, D8): con el pool sin
configurar, la redistribución proporcional de `mix.ts` devuelve exactamente los pesos de v1.

---

## 9.1 — Decisiones cerradas

Continúan la numeración de §0. D4–D7 vienen del addendum de capturador real del 2026-07-28 y se
registran aquí para que `SPEC.md` y `architecture.md` no se desincronicen; **no se especifica el
adapter todavía** — eso espera al resultado del spike.

| # | Decisión | Razón |
|---|---|---|
| D4 | **Spike empírico de Overwolf antes de construir cualquier adapter de producción.** Script desechable fuera del árbol de producción, corrido por el usuario en una partida real. | Hay evidencia contradictoria (GSI roto para partidas propias vs. GEP de Overwolf documentado oficialmente pero de dependencia interna incierta) que no se resuelve leyendo más documentación. Criterio de éxito doble: que `roster`/`bans`/`draft` entreguen `heroId`/`team` en vivo **y** que un `pick_revert` provocado sea distinguible de un pick nuevo en los datos crudos. |
| D5 | **Es aceptable que el capturador dependa de que el usuario tenga Overwolf instalado y corriendo.** | Mismo patrón que DotaPlus y STRATZ+, gratuito, y la vía técnica más sólida encontrada. |
| D6 | **OCR se construye solo si el spike de Overwolf falla**, nunca en paralelo. | Ataca primero la vía documentada oficialmente; evita duplicar esfuerzo antes de saber si hace falta. |
| D7 | **El patrón 2-2-1 de turnos de All Pick NO se modela en el reductor.** Se mantiene §C2 intacto. | La evidencia nueva es de una guía de terceros, no de Valve. No alcanza para tocar una regla inviolable ya cerrada. |
| D8 | **`SCORING_WEIGHTS_V2` por reducción proporcional**: los 4 pesos de v1 se multiplican por `0.80` y `hero_pool_fit` recibe `0.20`. | Cambia **una** cosa (añadir la señal), no dos. Con el pool sin configurar, `w_i/0.80 = v1_i` exactamente para las cuatro — el comportamiento del MVP ya validado no se mueve ni un punto. La alternativa (recortar más a las heurísticas) alteraba las sugerencias de un usuario que ni siquiera usa la función nueva. |
| D9 | **Mínimo 10 partidas** dentro de la ventana, **+ suavizado hacia la línea base personal** con `K = 10`. | 10 partidas en 90 días ≈ una cada 9 días: bar bajo pero real. El suavizado no existe para invertir pares ajustados (no lo hace, y estadísticamente no debería): existe para que un 10-0 no valga `1.0` y para que un 60%-en-10 y un 55%-en-45 queden casi empatados en vez de muy separados. |
| D10 | **`raw` de `hero_pool_fit` es una escala de comodidad 0–1, no un winrate crudo.** Fuera del pool = `0.20` (dato real). Pool sin configurar = `applicable: false`, no una degradación. | Un winrate personal crudo no es comparable con el agregado público de `patch_meta`. Y "no configuraste la función" no es lo mismo que "no hay datos": si contara como degradación, todo usuario sin pool bajaría de confianza `alta` a `media` para siempre — una regresión de UX en el MVP causada por una función que no está usando. |
| D11 | **El hero pool es solo del usuario local.** Compañeros de equipo, fuera de alcance. | El motor conoce `HeroId` + `side`, nunca "de quién" es un pick. Crear identidad de slot es un problema propio, y necesita el login/multiusuario que no existe. |
| D12 | **Predicción de rol/posición del rival: documentada como dependencia condicional de STRATZ, no se construye en 1b.** | Mismo patrón que D1 con Overwolf: el contrato de señal se puede especificar sin comprometerse a construirla. Añadiría el segundo proveedor externo y el primer secreto real (`STRATZ_API_KEY`) que fase 1 evitó a propósito (D2). Cuando se priorice, pasa obligatoriamente por `/gear-up`/`@depcheck`. |

---

## 9.2 — Costuras nuevas (antes que el comportamiento)

`hero_pool_fit` no estrena costura: es un `SignalScorer` más, cae en **S3** tal cual (función
pura, su propio archivo de prueba, aislado de los otros cuatro). Lo que sí estrena costura es
todo lo que rodea al cálculo del pool:

| Costura | Frontera | Qué es real en la prueba | Qué se reemplaza |
|---|---|---|---|
| **S7 — Cálculo del pool propuesto** | OpenDota → propuesta de pool | El filtro por mínimo, el suavizado, el orden por winrate y el corte en 5 — todo como **función pura** | El cliente HTTP: respuestas de `/players/{id}/heroes` grabadas en fixtures. **Cero red en las pruebas.** |
| **S8 — Persistencia y edición del pool** | `apps/web` (configuración) → `apps/engine` → SQLite | La validación en el borde, el reemplazo transaccional y la lectura vía Drizzle, contra una SQLite en memoria | Nada más. `POST /calculate` no participa: leer/escribir el pool nunca llama a la red |

**Regla derivada:** ninguna prueba de S7 depende de que OpenDota esté arriba, igual que S6.

---

## 9.3 — C3 extendido: la quinta señal

```ts
type SignalId = 'counter' | 'patch_meta' | 'team_synergy' | 'role_gap' | 'hero_pool_fit';

interface SignalContribution {
  signal: SignalId;
  raw: number | null;
  weighted: number;
  explanation: string;
  sampleSize: number;
  applicable?: boolean;   // NUEVO. Ausente = true (los 4 scorers de fase 1 no lo tocan).
}
```

`applicable: false` significa **"esta señal no aplica a este usuario ahora mismo"**, y es
distinto de `raw: null` ("hay hueco de datos"). Sólo `hero_pool_fit` lo usa hoy, y sólo cuando el
pool nunca se configuró. Consecuencias obligatorias, las tres:

- **No cuenta como `null` para la confianza.** `computeConfidence` se calcula únicamente sobre las
  señales aplicables: los umbrales de §C3 (≥2 nulls → `baja`, 1 null o meta vencida → `media`)
  siguen operando sobre las 4 señales de fase 1 mientras no haya pool.
- **No dispara `degraded: partial_signals`.**
- **Sí se muestra en el desglose de la UI**, con su explicación propia ("Configura tu pool de
  héroes para que las sugerencias tengan en cuenta con qué juegas cómodo"). Una señal que no
  aplica se dice, no se esconde — misma regla que `raw: null`.

**Pesos, `SCORING_WEIGHTS_V2`** (archivo propio, versionado por nombre; V1 se conserva intacto):

| Señal | v1 | **v2** | Cambio |
|---|---|---|---|
| `counter` | 0.40 | **0.32** | ×0.80 |
| `patch_meta` | 0.25 | **0.20** | ×0.80 |
| `team_synergy` | 0.20 | **0.16** | ×0.80 |
| `role_gap` | 0.15 | **0.12** | ×0.80 |
| `hero_pool_fit` | — | **0.20** | nueva |
| | **1.00** | **1.00** | |

Dos pruebas unitarias, no una: (1) los 5 pesos suman exactamente `1.0`; (2) con
`hero_pool_fit` no aplicable, la redistribución de `mix.ts` produce exactamente
`0.40 / 0.25 / 0.20 / 0.15` — el candado de la regresión cero (criterio §9.8-4).

**Contrato del scorer `hero_pool_fit`** (S3, función pura, sin I/O):

| Situación | `raw` | `sampleSize` | `applicable` |
|---|---|---|---|
| `meta.heroPool` ausente o vacío | `null` | `0` | **`false`** |
| Candidato **fuera** del pool | **`0.20`** — dato real: "sin comodidad conocida con este héroe" | `0` | `true` |
| Candidato en el pool, sin winrate registrado (añadido a mano) | **`0.50`** — el piso de "está en tu pool" | `0` | `true` |
| Candidato en el pool, con winrate registrado | `clamp(0.5 + (shrunk − baseline) × 2, 0.5, 1.0)` | `personalGames` | `true` |

```
shrunk   = (personalWins + K × baseline) / (personalGames + K),   K = 10
baseline = winrate agregado del jugador en la ventana (settings.personal_baseline_winrate);
           0.5 si nunca se calculó
```

`RAW_RANGE.hero_pool_fit = [0, 1]` en `mix.ts` — la normalización a 0–100 es `raw × 100`.

La señal mide **comodidad relativa a ti mismo**, no winrate absoluto: un jugador con 45% general
que va 55% con un héroe recibe el mismo empujón que uno de 55% general que va 65%. El piso `0.50`
para un héroe dentro del pool con winrate igual o inferior a tu media es deliberado: estar en tu
pool solo suma, nunca castiga dos veces.

**Distancia máxima que puede mover una sugerencia:** de `0.20` a `1.00` son 80 puntos
normalizados × peso `0.20` = **16 puntos sobre 100 del score final**. Es una ponderación fuerte y
un filtro duro no: un contrapick claramente superior (peso `0.32`) sigue pudiendo ganarle a un
héroe de tu pool. Eso es exactamente lo que pide el Bloque 1 de 1b ("nunca se filtra en duro").

Los cuatro números (`0.20`, `0.50`, `K = 10`, factor `× 2`) son **un punto de partida razonado, no
medido** — misma honestidad que `SCORING_WEIGHTS_V1` en §7.5. Se calibran con el criterio 2 de
aceptación en la mano.

---

## 9.4 — C4 extendido: persistencia

**Tabla nueva `hero_pool`** (Drizzle; cuenta como **una unidad lógica** con su migración, por la
excepción documentada en `CLAUDE.md`):

| Columna | Tipo | Nota |
|---|---|---|
| `hero_id` | integer PK, FK → `heroes.id` | Un héroe no puede estar dos veces |
| `source` | text `'manual' \| 'calculated'` | Procedencia honesta, igual que `CaptureSource` en S1 |
| `personal_winrate` | real, nullable | `null` = añadido a mano sin datos |
| `personal_games` | integer, default `0` | |
| `updated_at` | text ISO-8601 | |

**Claves nuevas en `settings`** (tabla ya existente, sin cambios de esquema):
`steam_account_id` y `personal_baseline_winrate`.

**Sin tabla de historial de partidas** — se persiste el agregado (héroe → winrate/partidas), nunca
las partidas individuales. Coherente con §C4 de fase 1.

**`MetaSnapshot` se extiende** con un campo opcional, mismo patrón que `patchStats?`/`roles?`:

```ts
interface HeroPoolEntry {
  hero: HeroId;
  source: 'manual' | 'calculated';
  personalWinrate: number | null;   // 0.0 – 1.0
  personalGames: number;
  updatedAt: string;
}

interface MetaSnapshot {
  // …lo de fase 1…
  heroPool?: HeroPoolEntry[];              // ≤ 5 entradas
  personalBaselineWinrate?: number | null; // 0.0 – 1.0
}
```

`buildMetaSnapshot` gana dos lecturas triviales (≤5 filas + 1 setting). **No toca el presupuesto
de §4**: sigue siendo SQLite local, cero red.

**Método nuevo en `OpenDotaClient`** — mismo patrón de clase, reintentos 1s/4s/16s ya cubiertos:

```ts
getPlayerHeroes(accountId: string, options?: { days?: number }): Promise<unknown>
// GET /players/{account_id}/heroes?date={days}
```

Devuelve `unknown` a propósito, igual que los tres métodos existentes: **la validación vive en el
borde** (§5), nunca en el cliente. El nombre exacto del parámetro de fecha se confirma contra el
Swagger en vivo durante el build; si difiere, cambia una línea del cliente y nada más.

**Cálculo del pool propuesto (S7), función pura:**

1. Descartar héroes con `games < 10` dentro de la ventana (D9).
2. `baseline` = `Σwins / Σgames` sobre **todas** las partidas de la ventana (no solo las de los
   héroes que pasaron el filtro — si no, sale inflado).
3. Ordenar por `shrunk` descendente (fórmula de §9.3). Desempate: `personalGames` descendente.
4. Tomar los primeros 5. **"Hasta 5" es un techo, no un piso**: pueden ser 0.
5. `source: 'calculated'` en todas las entradas propuestas.

Cero héroes pasan el filtro → `proposed: []` y la UI lo explica en llano, ofreciendo ampliar la
ventana (`days`) o editar a mano. No es un error.

---

## 9.5 — API nueva

Todo en `apps/engine`, `127.0.0.1`, consumido por `apps/web` vía **RTK Query** — el hero pool se
edita en configuración, no es parte del WebSocket de draft en vivo (régimen "páginas normales",
§C5).

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `GET` | `/api/hero-pool` | → `HeroPoolEntry[]` |
| `PUT` | `/api/hero-pool` | `{ entries: HeroPoolEntry[], baselineWinrate?: number \| null }` → `200 HeroPoolEntry[]`. **Reemplaza el pool completo, en una sola transacción.** Único camino de escritura |
| `POST` | `/api/hero-pool/calculate` | `{ accountId: string, days?: number }` → `200 { proposed: HeroPoolEntry[], baselineWinrate: number, consideredHeroes: number, windowDays: number }`. **No escribe en SQLite**: solo propone. El `PUT` posterior confirma |

`days` por defecto: **90**. `accountId` se persiste, si el usuario quiere, vía el
`PUT /api/settings` ya existente — no se duplica un camino de escritura para eso.

> **Deriva detectada y registrada aquí:** `GET`/`PUT /api/settings` existen en el código desde
> TSK-014 pero nunca entraron en la tabla de §3. Quedan registrados. Es aditivo y no contradice
> nada de fase 1 — no es de los gatillos de §7 de `CLAUDE.md`.

**Errores, explícitos:**

| Situación | Respuesta |
|---|---|
| `accountId` con formato inválido | `400 { error: 'invalid_account_id' }`. **Nunca se eco el valor recibido** en el cuerpo ni en el log |
| `entries` con >5 elementos, `heroId` duplicado, o héroe inexistente en `heroes` | `400` con el motivo. El pool guardado **no se toca** |
| `personalWinrate` fuera de `[0,1]` o `personalGames` negativo/no entero | `400`. Igual: no se toca lo guardado |
| OpenDota 429 o caído tras los 3 reintentos | `502 { error: 'opendota_unavailable' }` + mensaje en llano. **El pool guardado sigue intacto y las sugerencias siguen funcionando** — mismo principio que `stale_meta` en S6 |
| Un `calculate` ya en curso | `409 { error: 'calculation_in_progress' }`. Sin cola, sin reintento automático |
| Ningún héroe pasa el mínimo | `200` con `proposed: []` — **no es un error** |

**Nada de esto toca el camino caliente.** `/api/hero-pool/calculate` es una llamada de red, pero
vive en el flujo de configuración; durante un draft activo el motor sigue sin tocar la red. La
regla de §1 sigue intacta, palabra por palabra.

---

## 9.6 — C5: pantallas

Dos, en el régimen RTK Query (nunca WebSocket):

- **Configuración → Mi pool de héroes**: lista editable de hasta 5 héroes con su ícono oficial
  (requisito duro de `web.md`), añadir/quitar a mano, y un botón "Calcular desde mis partidas"
  que pide el `account_id` de Steam.
- **Propuesta de pool**: pantalla de confirmación con los ≤5 héroes propuestos, su winrate y sus
  partidas en la ventana. **Nunca auto-aplica.** El usuario confirma tal cual, edita antes de
  confirmar, o descarta. Descartar deja el pool anterior exactamente como estaba.

Ambas con su error boundary y estado de carga propios (`web.md`), y con los estados de "aún no
calculaste nada", "no hay héroes que pasen el mínimo" y "OpenDota no respondió" visibles y
explicados en llano — el mismo estándar que los 6 estados de la vista de draft.

`SignalBreakdown` pasa a mostrar **5** señales. Los tres textos nuevos de `hero_pool_fit`
("configura tu pool", "fuera de tu pool", "en tu pool: X% en N partidas") se muestran igual que
los de las otras cuatro, sin excepción.

---

## 9.7 — Seguridad (extiende §5)

| Requisito | Cómo se cumple en 1b |
|---|---|
| **Validación del `account_id`** | Steam32: **solo dígitos decimales**, valor entre `1` y `4294967295`. Se valida en el borde, antes de tocar lógica de negocio o construir ninguna URL. Un `accountId` que no pase **nunca** llega a `fetch` |
| **Dato personal — el primero del proyecto** | Vive únicamente en la SQLite local. Se transmite a un solo destino: la propia OpenDota (endpoint público, sin autenticación). **Prohibido**: registrarlo en `journal.md`, en tickets, en `meta_sync.error`, en `/api/health`, o devolverlo en el cuerpo de un error. Si aparece en un diff, es hallazgo de `@redteam` |
| **Sin secreto nuevo** | OpenDota no requiere API key. `STRATZ_API_KEY` es condicional y futuro (D12) — fuera del alcance de 1b |
| **Consultas parametrizadas** | Vía Drizzle, incluida la escritura transaccional del `PUT`. Cero SQL concatenado |
| **Escritura atómica** | El `PUT` reemplaza el pool completo dentro de **una transacción**: nunca queda un pool a medias, mismo principio que S6 |
| **Sin cambios en lo ya cerrado** | `apps/engine` sigue atado a `127.0.0.1`. El `x-capture-token` de `/ingest/draft-event` no cambia. Las rutas nuevas son del régimen web (sin token, CORS a `127.0.0.1`/`localhost`), igual que `/api/settings` y `/api/session/manual` |
| **Sin dependencias nuevas** | Cero. `OpenDotaClient` gana un método; no entra ninguna librería |

---

## 9.8 — Criterios de aceptación de 1b

| # | Criterio | Verificación |
|---|---|---|
| 1 | **Pool manual** | El usuario guarda hasta 5 héroes a mano desde configuración, persisten en SQLite, siguen ahí al recargar |
| 2 | **Cálculo desde partidas** | Con un `account_id` real, el sistema trae la ventana de 90 días, filtra por el mínimo de 10 partidas y **propone** un top 5 sin sobreescribir nada hasta que el usuario confirma |
| 3 | **Visible en el draft** | Un héroe del pool recibe un ajuste **visible y explicado** en el desglose: `hero_pool_fit` aparece igual que las otras cuatro, nunca se calla |
| 4 | **Regresión cero** | Con el pool nunca configurado: `applicable: false`, la confianza de las sugerencias **no baja**, y el orden de sugerencias es idéntico al de fase 1. Verificado por prueba unitaria de redistribución (§9.3), no a ojo |
| 5 | **Pesos** | Prueba unitaria: los 5 pesos de `SCORING_WEIGHTS_V2` suman exactamente `1.0` |
| 6 | **Fuera** | La predicción de rol rival **no** entra en estos criterios: no se construye en 1b (D12) |

---

## 9.9 — Lo que 1b deja abierto a propósito

1. **El nombre exacto del parámetro de ventana de `/players/{id}/heroes`** (`date` en días, según
   la doc). Se confirma contra el Swagger en vivo durante el build; no bloquea.
2. **Los cuatro números de `hero_pool_fit`** (`0.20`, `0.50`, `K = 10`, `× 2`) y los pesos de v2:
   razonados, no medidos. Se calibran con el criterio 2 de fase 1 en la mano.
3. **Predicción de rol rival vía STRATZ** (D12): contrato de señal descrito en `architecture.md`,
   sin construir. Requiere `/gear-up` y un secreto nuevo cuando se priorice.
4. **Hero pool de compañeros** (D11): necesita identidad de slot y login. Fase posterior.
5. **Qué expone el GEP de Overwolf realmente** (D4): sigue pendiente del spike empírico, con el
   script ya escrito en `scripts/spikes/overwolf-draft-probe/`. No bloquea nada de 1b.

---

## 9.10 — Entrada para `/rulebook`

Fronteras naturales de ticket, en orden de dependencia. **No son tickets todavía.** Ninguna
depende del spike de Overwolf — 1b y el capturador real avanzan en paralelo sin tocarse.

1. Migración `hero_pool` + claves de `settings` (§9.4) — **una unidad lógica** con su migración.
2. `OpenDotaClient.getPlayerHeroes` + validación en el borde de la respuesta + fixtures grabados.
3. Cálculo puro del pool propuesto (S7): filtro por mínimo, `baseline`, suavizado, orden, corte.
4. Endpoints `GET`/`PUT /api/hero-pool` + escritura transaccional + validaciones de §9.5 (S8).
5. Endpoint `POST /api/hero-pool/calculate` + sus errores (502/409/`proposed: []`).
6. `heroPoolFitScorer` (S3) — archivo y prueba propios, aislado de los otros cuatro.
7. `SCORING_WEIGHTS_V2` + `applicable` en `mix.ts` (confianza y `partial_signals`) + las dos
   pruebas del candado de regresión cero.
8. Pantalla de configuración del pool (RTK Query) con íconos oficiales.
9. Pantalla de propuesta/confirmación + los tres estados vacíos/de error.
10. `SignalBreakdown` con las 5 señales y los tres textos nuevos.

---

# SPEC — Fase 3 (Posiciones reales en el motor de sugerencias)

Síntesis de `docs/agents/architecture.md` § Fase 3 (Bloques 1-6, `/kickoff` + `/pre-flight`
completos). Origen: QA manual real del usuario (2026-08-20) sobre el Random Draft Simulator --
el motor sugiere composiciones estructuralmente inválidas (doble carry). Ver `journal.md`
evt-20260820-047 y evt-20260821-048.

## 10.0 — Qué de fases anteriores queda superado

1. **`role_gap` deja de existir como señal.** Su lógica ("el equipo ya tiene 2 carries") vivía
   sobre `roles[]` de OpenDota, donde 57% de los héroes están etiquetados `"Carry"` (Axe, Zeus,
   Tidehunter incluidos) -- detectaba un solapamiento que casi nunca era real.
2. **`role_safety` deja de existir como señal.** Su lógica ("support primero, revelar core
   después", TSK-027) era correcta como intención de producto y se conserva completa dentro de
   `position_fit` -- lo que se descarta es su implementación sobre la etiqueta `"Support"` (38%
   de los héroes) y su ventana dura de 2 picks.
3. **`SCORING_WEIGHTS_V3` deja de ser la constante activa** -- queda congelada por nombre, igual
   que V1 y V2. La activa pasa a ser `SCORING_WEIGHTS_V4` (§10.3).
4. **El candado de regresión cero de V2/V3 no se hereda.** V2 y V3 *agregaban* una señal y
   escalaban proporcionalmente, de modo que con la señal nueva inaplicable se reproducían los
   pesos anteriores. V4 **reemplaza dos señales por una**: no existe un estado "position_fit sin
   configurar", así que no hay nada que reproducir. Es una diferencia deliberada respecto al
   patrón de 1b -- si alguien busca ese candado y no lo encuentra, es por esto, no por olvido.

## 10.1 — Decisiones cerradas

| # | Pregunta | Decisión |
|---|---|---|
| P1 | ¿Arreglar `role_gap` o rediseñar? | **Fusionar `role_gap` + `role_safety` en `position_fit`.** Las dos responden la misma pregunta de fondo ("qué posición me falta y es buen momento de revelarla"); separadas competían entre sí dentro del mismo score en vez de resolver una decisión coherente. |
| P2 | ¿Filtro duro o señal ponderada? | **Señal ponderada.** El único filtro duro del motor (`candidatePool`) es por hechos binarios (baneado/pickeado), nunca por juicio de calidad. `position_fit` no rompe ese invariante. La fuerza necesaria se consigue con el peso (§10.3), no descartando candidatos. |
| P3 | Fuente del dato de posición | **Archivo estático curado, `hero-positions.json`**, versionado en el repo. Mismo patrón exacto que `capabilities.json` (Fase 2). Sin STRATZ, sin API nueva, sin `STRATZ_API_KEY`. |
| P4 | Umbral de partidas para que una posición cuente | **200 partidas** en el bracket 7000+ MMR del parche activo. Sin este umbral, héroes con presencia marginal aparecen en las 5 posiciones (caso real verificado: Windranger). |
| P5 | ¿Qué pasa con un héroe sin dato? | `raw: null` (hueco de datos), **nunca** `applicable: false` -- ese campo significa "función que el usuario no configuró" (hero_pool_fit) y `position_fit` no tiene configuración de usuario. Caso real hoy: Chen (1 de 127). |
| P6 | Alcance | **Solo el motor + el espejo de tipos/etiquetas en `apps/web`.** El bot del Random Draft Simulator (que no usa `buildSuggestions`, ver `.claude/rules/engine.md`) y la queja de UX de "no veo qué ya se sacó" quedan fuera, cada uno para su propio turno. Decisión explícita del usuario. |

## 10.2 — Costuras nuevas (antes que el comportamiento)

| Costura | Frontera | Real en la prueba | Se reemplaza |
|---|---|---|---|
| **S10** — `HeroPositions` | `hero-positions.json` (dato curado) → `position-fit.ts` | La lógica de cobertura, necesidad, timing y mezcla -- función pura | El archivo real: `heroPositions` inyectado con un fixture propio y determinístico. **Ninguna prueba puede depender del contenido real de `hero-positions.json`** -- ese archivo se regenera cada parche grande, un test atado a su contenido se rompería en silencio con cada actualización. Mismo criterio literal que S9 (`capabilities.json`) ya estableció. |

`position_fit` **no estrena costura como señal** -- es un `SignalScorer` más, cae en **S3** tal
cual (función pura, archivo de prueba propio, aislado de las otras). S10 cubre únicamente su
dependencia de datos, igual que S9 hace para los caminos de draft.

**Mecanismo de inyección** (resuelto acá, no en `/build`): el contrato `SignalScorer.score(state,
candidate, meta)` **no se modifica**. `position_fit` se construye con una fábrica que cierra
sobre el dato:

```typescript
export function createPositionFitScorer(positions: HeroPositions): SignalScorer;
```

`buildSuggestions` gana un campo opcional en `BuildSuggestionsOptions` (mismo patrón que
`now?`/`metaIsStale?` que ya existen ahí):

```typescript
export interface BuildSuggestionsOptions {
  metaIsStale?: boolean;
  now?: () => number;
  heroPositions?: HeroPositions; // ausente -> carga el archivo real (loadHeroPositions())
}
```

Así los llamadores existentes (`app.ts`) no cambian, y las pruebas inyectan su fixture.

## 10.3 — C3 extendido: `SCORING_WEIGHTS_V4`

```typescript
export const SCORING_WEIGHTS_V4: Record<SignalId, number> = {
  position_fit: 0.25,
  counter: 0.27,
  patch_meta: 0.17,
  team_synergy: 0.14,
  hero_pool_fit: 0.17,
};
```

Suma exactamente `1.0` -- **prueba unitaria obligatoria**, mismo candado que V1/V2/V3 ya tienen.

**Por qué 0.25 y no la suma de las dos señales viejas (0.108 + 0.10 = 0.208):** el problema real
que dispara esta fase no es que `role_gap` estuviera mal calculada, es que **no pesaba lo
suficiente para cambiar el resultado**. Un peso igual a la suma anterior reproduciría el mismo
síntoma con mejor dato. 0.25 la pone por encima de `patch_meta`/`hero_pool_fit` y apenas debajo
de `counter`, coherente con la jerarquía de decisión que documenta `architecture.md` § Fase 3
Bloque 2 (posición > contrarresto > sinergia).

**Los 4 pesos supervivientes conservan su orden y su proporción relativa** de V3 (counter >
patch_meta = hero_pool_fit > team_synergy), redondeados a 2 decimales: en V3 la razón
counter/patch_meta era 1.600, en V4 es 1.588; team_synergy/patch_meta era 0.800, ahora 0.824.

**Efecto real en el pick temprano, verificado contra el código, no estimado**: `counter` devuelve
`raw: null` mientras el rival no haya pickeado nada (`counter.ts`, `deltas.length === 0`), y
`hero_pool_fit` devuelve `applicable: false` sin pool configurado. Con la redistribución
proporcional que `mix.ts` ya hace, en el primer pick propio sin pool las señales con voto son
`patch_meta` (0.17), `team_synergy` (0.14) y `position_fit` (0.25) -- **`position_fit` controla
el 44.6% del score** (`0.25 / 0.56`) justo en el momento del draft donde más importa. No hace
falta ningún caso especial para lograrlo.

## 10.4 — C3 extendido: el `SignalScorer` `position_fit`

### Contrato de datos

```typescript
export interface HeroPositionShare {
  position: 1 | 2 | 3 | 4 | 5; // carry | mid | offlane | soft support | hard support
  matches: number;             // >= 200 (P4), del bracket 7000+ del parche activo
}

export type HeroPositions = Record<HeroId, HeroPositionShare[]>;
```

Orden de `HeroPositionShare[]`: descendente por `matches`. La primera entrada es la posición
primaria del héroe, pero **el algoritmo no la privilegia** -- usa el vector completo (§siguiente),
que es lo que hace que un flex pick se comporte como flex pick.

### Algoritmo (determinista, puro, sin I/O)

Sea `h` el candidato, `own` los picks del lado propio, `n = own.length`.

**1. Vector de posición** -- qué tan "suya" es cada posición para un héroe:

```
share(x, p) = matches(x, p) / Σ_q matches(x, q)
```

Ejemplos con el dato real ya recolectado: `Spectre = {1: 1.000}`,
`Wraith King = {3: 0.588, 1: 0.412}`, `Crystal Maiden = {5: 0.828, 4: 0.172}`,
`Pudge = {4: 0.419, 5: 0.284, 3: 0.242, 2: 0.055}`.

**2. Cobertura del equipo propio** -- suma de los vectores ya pickeados:

```
coverage(p) = Σ_{x ∈ own} share(x, p)
```

Un héroe propio sin dato de posición aporta 0 a toda la cobertura -- degrada, nunca rompe.

**3. Necesidad por posición** -- cada posición se llena una sola vez:

```
need(p) = max(0, 1 - coverage(p))
```

**4. Cobertura del candidato** (`fill`) -- producto punto, rango `[0, 1]`:

```
fill(h) = Σ_p share(h, p) · need(p)
```

**5. Seguridad del pick** (`safety`) -- cuánto del héroe es rol de apoyo, rango `[0, 1]`:

```
safety(h) = share(h, 4) + share(h, 5)
```

**6. Mezcla por momento del draft.** `t` es cuánto pesa "esconder información" frente a "llenar
el hueco", y decae con cada pick propio -- **decae suave, no es la ventana dura de 2 picks que
usaba `role_safety`**:

```
TIMING_BLEND = [0.50, 0.30, 0.15, 0.00]   // índice = n, saturado en 3
t = TIMING_BLEND[min(n, 3)]

raw = (1 - t) · fill(h) + t · safety(h)
```

`RAW_RANGE.position_fit = [0, 1]` en `mix.ts`.

### Casos `raw: null` (los dos únicos)

1. **El candidato no tiene entrada en `hero-positions.json`** (hoy: Chen). `explanation`: "Sin
   datos de posición para este héroe este parche".
2. **`state.localSide === "unknown"`**. Sin saber cuál equipo es el propio, `coverage` no se
   puede calcular; devolver `fill` sobre cobertura vacía afirmaría "te falta todo", que puede
   ser falso. **Cambio de comportamiento explícito** respecto a `role_gap`/`role_safety`, que
   trataban ese caso como "sin picks propios" -- se corrige acá porque contradice la regla dura
   del proyecto ("`raw: null` nunca es 0 ni 0.5"; una señal sin base no vota).

`sampleSize` = total de partidas que respaldan el vector del candidato (`Σ_q matches(h, q)`).
Cero solo cuando `raw` es `null`.

### `explanation` (texto visible en el desglose de la UI)

Determinista, en castellano, derivada del componente que domine:

- `fill ≈ 0` con `n > 0` → "Repite una posición que tu equipo ya cubre" (el caso doble carry).
- `t > 0` y `safety` alto → "Rol flexible: pick temprano seguro, no revela tu core".
- `fill` alto → "Cubre la posición N que a tu equipo le falta" (N = la de mayor
  `share(h,p) · need(p)`).
- resto → "Encaja parcialmente en lo que le falta a tu equipo".

## 10.5 — Ejemplos trabajados (con el dato real, no inventado)

**Escenario A -- "no repitas rol"** (Spectre ya pickeado, `n = 1`, `t = 0.30`):

| Candidato | `fill` | `safety` | `raw` |
|---|---|---|---|
| Crystal Maiden | 1.000 | 1.000 | **1.000** |
| Pudge | 1.000 | 0.703 | **0.911** |
| Wraith King | 0.588 | 0.000 | **0.412** |
| Anti-Mage | 0.000 | 0.000 | **0.000** |

**Escenario B -- "primero lo seguro"** (draft vacío, `n = 0`, `t = 0.50`; con `need(p) = 1` para
toda `p`, `fill = 1.0` para todos, así que decide `safety`):

| Candidato | `fill` | `safety` | `raw` |
|---|---|---|---|
| Crystal Maiden | 1.000 | 1.000 | **1.000** |
| Pudge | 1.000 | 0.703 | **0.851** |
| Invoker | 1.000 | 0.100 | **0.550** |
| Anti-Mage | 1.000 | 0.000 | **0.500** |

**Simetría, para que no se lea como "siempre prefiere supports"**: con 4 supports propios ya
pickeados (Crystal Maiden, Lich, Dazzle, Oracle -- `n = 4`, `t = 0`, `need(1) = 1`), Anti-Mage da
`fill = 1.000` → `raw = 1.000`, y Crystal Maiden da `fill = 0.094` → `raw = 0.094`. La señal se
invierte sola cuando lo que falta es el carry.

**Los tres bloques de números de §10.5 están verificados ejecutando la fórmula contra el archivo
de posiciones real**, no calculados a mano -- son los valores exactos que las pruebas deben
esperar.

## 10.6 — El archivo de datos y su generación

- **Ubicación**: `apps/engine/src/signals/hero-positions.json`, con `hero-positions.ts` como
  cargador y validador de borde -- mismo par exacto que `capabilities.json`/`capabilities.ts`.
- **Validación al cargar** (`loadHeroPositions()`): descarta entradas malformadas, `position`
  fuera de `1..5`, `matches` no entero o `< 200`, y héroes duplicados. Un archivo corrupto
  degrada a "sin datos de posición" (todos `raw: null`), **nunca** tira el motor.
- **Estado actual del dato**: 126 de 127 héroes, recolectado y validado en la sesión de
  `/pre-flight` (Dota2ProTracker, bracket 7000+ MMR, parche 7.41e). Único hueco: Chen.
- **Regeneración**: script ad-hoc documentado, corrido a mano por el desarrollador tras un parche
  grande. **No se agrega ninguna dependencia al `package.json` del proyecto** -- el script usa un
  navegador headless instalado aparte, fuera del árbol de dependencias (igual que en la sesión de
  `/pre-flight`). Esto mantiene intacta la regla de "sin dependencias nuevas sin `/gear-up`".
- **`apps/engine` nunca llama a la red por este dato.** La regla dura de cero red en el camino
  caliente queda intacta, y esta fase tampoco abre una excepción "de configuración" como sí hizo
  `POST /api/hero-pool/calculate` en 1b.

## 10.7 — C5: qué cambia en `apps/web`

Esta fase **no es solo del motor**. Hay dos espejos que deben moverse en el mismo cambio o el
tipado se rompe:

1. **`apps/web/features/draft/types.ts`** -- la unión `SignalId` es un espejo a mano del contrato
   del motor (documentado como tal en ese archivo). Quita `role_gap` y `role_safety`, agrega
   `position_fit`.
2. **`apps/web/components/signal-breakdown/SignalBreakdown.tsx`** -- `SIGNAL_LABELS` pierde
   `"Solapamiento de rol"` y `"Seguridad del pick temprano"`, gana una etiqueta para
   `position_fit`: **"Posición y momento del pick"**.

`SignalBreakdown` pasa a mostrar **5 señales, no 6**. La distinción entre `raw: null` y
`applicable: false` que 1b introdujo (§9.6) se mantiene sin cambios -- `position_fit` solo usa la
primera.

## 10.8 — Seguridad (extiende §5 y §9.7)

- **Ningún cruce de frontera de confianza nuevo en runtime.** El único contacto con una fuente
  externa es el script de regeneración, que corre a mano en la máquina del desarrollador, nunca
  desde `apps/engine`, nunca programado.
- **Ningún secreto nuevo.** La decisión P3 evita exactamente el `STRATZ_API_KEY` que 1b había
  dejado documentado como condicional futuro (§9.7).
- **Ningún dato personal.** Estadísticas públicas agregadas de héroes, misma naturaleza que
  `patchStats`, que ya vive en el motor.
- `hero-positions.json` es **input externo** en el sentido del proyecto: se valida en el borde al
  cargarlo (§10.6), no se confía en su forma.

## 10.9 — Criterios de aceptación

1. `SCORING_WEIGHTS_V4` suma exactamente `1.0` (prueba unitaria). V1/V2/V3 siguen existiendo sin
   modificar.
2. Con un carry puro propio ya pickeado, otro carry puro da `raw = 0` en `position_fit`
   (Escenario A, números exactos de §10.5).
3. Con el draft vacío, un support puntúa estrictamente más alto que un carry puro
   (Escenario B).
4. Con 4 supports propios pickeados, la señal se invierte y el carry puntúa más alto (§10.5,
   simetría: Anti-Mage `1.000` vs. Crystal Maiden `0.094`) -- **prueba dedicada**, no se infiere
   de las dos anteriores. Sin ella, una implementación que solo premiara supports pasaría los
   criterios 2 y 3 y seguiría estando rota.
5. Un héroe sin dato de posición devuelve `raw: null`, nunca un número inventado, nunca una
   excepción sin capturar.
6. `state.localSide === "unknown"` devuelve `raw: null`.
7. **Candado de regresión del bug original**: contra el pipeline completo (`buildSuggestions`, no
   la señal aislada), reproducir Spectre pickeado + Wraith King disponible y verificar que Wraith
   King **no** aparece en el top 3. Es la prueba de que el peso mueve el resultado final, no solo
   el desglose.
8. Ninguna prueba de `position_fit` lee `hero-positions.json` real (S10).
9. `SignalBreakdown` muestra 5 señales con la etiqueta nueva; `bunx tsc --noEmit` limpio en
   **ambos** paquetes (el espejo de `SignalId` es lo que lo prueba).

## 10.10 — Lo que esta fase deja abierto a propósito

- **Anti-patrones más allá del solapamiento de posición** (cero iniciación, cero stun, daño
  mono-tipo, supports que necesitan farm): documentados en `architecture.md` § Fase 3 Bloque 2 a
  partir del research, **no se construyen acá**. Nota: parte de esa información ya existe en
  `capabilities.json` (Fase 2), hoy usada solo por los caminos de draft -- es el punto de partida
  natural cuando se prioricen.
- **`Δmatchup`/`Δsynergy` con la fórmula del research** (pesos ~1.3 a 1 entre contrarresto y
  sinergia): `counter` y `team_synergy` siguen tal cual. Fuera de alcance.
- **El bot del Random Draft Simulator sigue sin usar `buildSuggestions`** -- lo que se ve
  draftear ahí seguirá sin reflejar estas mejoras hasta que se haga ese trabajo, que tiene su
  propio turno. **Consecuencia operativa: el QA de esta fase se hace contra el Copilot real**
  (`/draft` con entrada manual, o el simulador de guion fijo), nunca contra ese bot.
- **La queja de UX** ("no veo en tiempo real qué ya se sacó") -- su propio turno.
- **Predicción de la posición del rival** -- sigue fuera de alcance desde 1b (D12), sin cambios.
- **Los números de `TIMING_BLEND`** son el primer candidato a ajustar durante el QA manual: son
  defendibles y producen el orden correcto en los dos escenarios, pero no están calibrados contra
  partidas reales. Cambiarlos es editar 4 números en una constante, no reescribir la señal.

## 10.11 — Entrada para `/rulebook`

Fronteras naturales de ticket, en orden de dependencia. **No son tickets todavía.**

1. `hero-positions.json` + `hero-positions.ts` (cargador y validación de borde) -- **una unidad
   lógica** con el archivo de datos y su fixture de prueba.
2. `positionFitScorer` vía `createPositionFitScorer` (S3 + S10) -- archivo y prueba propios,
   aislado del resto de las señales. Cubre los criterios 2-6 de §10.9.
3. `SCORING_WEIGHTS_V4` + baja de `role_gap`/`role_safety` de `SCORERS` y `RAW_RANGE` en
   `mix.ts` + `heroPositions` en `BuildSuggestionsOptions` + el candado de regresión (criterios
   1 y 7).
4. Espejo en `apps/web`: `SignalId` + `SIGNAL_LABELS` (criterio 9).
5. Borrado de `role-gap.ts`/`role-safety.ts` y sus pruebas -- **último**, cuando nada los
   referencie, nunca antes.

# SPEC — Fase 4 (Intención de Draft, Sinergia en Cadena y Diversificación Estratégica)

Síntesis de `docs/agents/architecture.md` § Fase 4 (Bloques 1-6 + "Detalle de implementación --
Sub-ticket 4.1"). Origen: feedback directo del usuario (2026-08-23) -- el motor da un top-3
estático al inicio de cada draft porque pondera winrate general de forma aislada, sin ningún
concepto de intención táctica. Ver `journal.md` de esta fase.

## 11.0 — Alcance de este blueprint (leer primero)

Este `/blueprint` **no cierra la Fase 4 completa**. Decisión de alcance explícita del usuario:
se formaliza **únicamente el sub-ticket 4.1** (la señal `archetype_fit` en su forma aislada), al
nivel de detalle sin ambigüedad que `/rulebook` necesita para generar un `TSK-XXX` ejecutable.

- **§11.1 a §11.9 son contrato cerrado.** Cero números pendientes, cero "a confirmar". Lo que
  está ahí se puede implementar sin volver a preguntar nada.
- **§11.10 documenta las piezas 2-4 y los sub-tickets 4.2-4.8 al nivel conceptual que ya tiene
  `architecture.md`** -- contratos e invariantes, **nunca los números**. Cada número que
  corresponde a un sub-ticket posterior está marcado como *pendiente del blueprint de su propio
  sub-ticket*, mismo criterio que la sección "Cierre" de `architecture.md` ya usa.

Si alguien busca acá el peso de `SCORING_WEIGHTS_V6`, el ancho de la banda de diversificación, la
matriz 4×4 de contras por arquetipo o la fórmula de sinergia par a par, **no están y es
deliberado** -- no un olvido.

## 11.1 — Qué de fases anteriores queda superado

**Nada.** A diferencia de 1b (que agregó una quinta señal) y de Fase 3 (que fusionó dos señales en
una y congeló `SCORING_WEIGHTS_V3`), el sub-ticket 4.1 **no toca ninguna señal existente, ningún
peso, ningún archivo de `apps/web`, y no cambia el comportamiento observable del motor**. Al
terminar 4.1, `buildSuggestions` devuelve exactamente lo mismo que antes: la señal existe, está
probada, y todavía no está enchufada.

Esto es intencional y es lo que hace que 4.1 quepa en el presupuesto de 3 archivos / 200 líneas
(`scripts/verify-simplicity.sh`). La integración -- y con ella el único cambio de comportamiento
real -- vive entera en 4.2.

**`SCORING_WEIGHTS_V5` sigue siendo la constante activa durante todo 4.1.** V1/V2/V3/V4 siguen
congeladas por nombre, sin tocar.

## 11.2 — Decisiones cerradas (sub-ticket 4.1)

| # | Pregunta | Decisión |
|---|---|---|
| P1 | ¿De dónde sale la afinidad héroe↔arquetipo? | **De `capabilities.json`, vía la función que ya existe**: `archetypeFitBonus()` (`draft-paths/build-paths.ts`), escrita, probada y en producción desde Fase 2. **No se crea `archetype-affinity.json`.** Materializar un segundo JSON duplicaría un dato que ya vive en `capabilities.json`. Confirma y fija el hallazgo 2 del Bloque 2 de `architecture.md` (la reinterpretación de "Opción A" que quedaba pendiente de confirmación). |
| P2 | ¿`archetypeFitBonus` se exporta desde `build-paths.ts` o se mueve a `gaps.ts`? | **Se exporta tal cual desde `build-paths.ts`.** Ver §11.4, "Por qué exportar y no mover". |
| P3 | ¿Cómo llega el dato de capacidades a la señal? | **Inyectado por fábrica**: `createArchetypeFitScorer(capabilities, intent)`. Mismo patrón exacto que `createTeamSynergyScorer(capabilities)` ya usa hoy. **Corrige la firma que proponía `architecture.md`** (§11.4). |
| P4 | ¿Qué escala tiene `raw` y cuál es su `RAW_RANGE`? | **`raw ∈ [0, 1]`, normalizado dentro del scorer**, y `RAW_RANGE.archetype_fit = [0, 1]` en `mix.ts` (lo aplica 4.2). **No** se deja la escala cruda de `archetypeFitBonus`. Motivo forzado por el código real, no estético: ver §11.4, "Por qué la normalización va adentro". |
| P5 | ¿`"archetype_fit"` entra en `SignalId` ya en 4.1? | **No. Entra en 4.2.** `architecture.md` recomendaba tentativamente adelantarlo ("probablemente sí"); **verificado contra el código real, es incorrecto** y rompería dos constantes congeladas. Ver §11.7. |
| P6 | ¿Qué pasa con un candidato sin entrada en `capabilities.json`? | **`raw: null`** (hueco de datos), `applicable` ausente. Mismo criterio que P5 de Fase 3 (§10.1). **No es un caso hipotético: hoy hay 3 héroes así** (§11.6). |
| P7 | ¿Qué pasa sin intención elegida? | **`raw: null` + `applicable: false`.** Es el único caso de `applicable: false` de la señal, y el segundo del motor entero tras `hero_pool_fit`. "El usuario no configuró esta función" -- exactamente el significado que 1b le dio al campo (§9.3). |
| P8 | ¿La señal depende de `DraftState`? | **No.** `raw` es función pura de `(intent, capacidades del candidato)` y es constante durante todo el draft. Es la única señal del motor con esa propiedad, y es lo que la hace útil en el pick #1 (§11.4, "Invariante de independencia del estado"). |

## 11.3 — Costuras: ninguna nueva

**No se estrena costura en 4.1.** Confirmado tras leer el código real, coincidiendo con lo que
`architecture.md` ya argumentaba:

- `archetype_fit` es un `SignalScorer` más → cae en **S3** tal cual (función pura, archivo de
  prueba propio, aislado de las otras cinco señales).
- Su única dependencia de datos es `HeroCapabilities[]`, que ya tiene costura: **S9**
  (`capabilities.json` → inyectado como fixture, nunca leído real en una prueba). La validación de
  borde ya existe y no se toca (`loadHeroCapabilities()`, `draft-paths/capabilities.ts`).
- **No hace falta una `S11`.** La primera propuesta de esta fase la asumía porque asumía un
  archivo `archetype-affinity.json` nuevo con su propio `loadArchetypeAffinity()`; P1 elimina ese
  archivo, y con él la frontera que habría necesitado costura propia.

**Regla derivada, heredada literal de S9/S10**: ninguna prueba de `archetype-fit.test.ts` puede
leer `capabilities.json` real. `capabilities.json` es un borrador curado, editable -- un test
atado a su contenido se rompe en silencio con cada corrección de dominio. Los números de §11.5
están calculados **contra el archivo real** para que sean realistas, pero se llevan al test **como
fixture literal inline**, no como lectura del archivo.

`S12` (RNG inyectable para la diversificación, pieza 4) **no se define acá** -- pertenece al
sub-ticket que la use (§11.10).

## 11.4 — Contrato de la señal `archetype_fit` (sub-ticket 4.1)

### Tipo de la intención: reutilizado, no duplicado

```typescript
// draft-paths/types.ts -- ya existe, no se toca
export type DraftPathArchetype = "push" | "teamfight" | "pickoff" | "scaling";
```

Un solo nombre de dominio para el mismo concepto, consumido por "Caminos de draft" (post-hoc:
*qué le falta al draft*) y por `archetype_fit` (pre-hoc: *qué quiero que sea mi draft*). Importar
directo entre `signals/` y `draft-paths/` es legítimo: ambos viven en el mismo proceso, y
`team-synergy.ts` ya lo hace hoy (`import { detectDraftGaps, filledGaps, ownCapabilities } from
"../draft-paths/gaps"`). La regla de "espejo a mano, nunca import directo" es exclusiva de la
frontera `apps/engine` ↔ `apps/web`.

### Firma de la fábrica

```typescript
export function createArchetypeFitScorer(
  capabilities: HeroCapabilities[],
  intent: DraftPathArchetype | undefined,
): ArchetypeFitScorer;
```

**Corrección a `architecture.md`**, verificada contra el código: el detalle de sub-ticket 4.1
proponía `createArchetypeFitScorer(intent)` a secas. Eso no puede funcionar --
`SignalScorer.score(state, candidate, meta)` recibe el candidato como `HeroId`, y
`capabilities.json` **no vive en `MetaSnapshot`**. Sin `capabilities` inyectado, el scorer no
tiene forma de resolver `HeroId → HeroCapabilities`. El orden de parámetros (`capabilities`
primero, `intent` después) espeja `createTeamSynergyScorer(capabilities)`.

La resolución `HeroId → HeroCapabilities` usa **`capabilitiesByHero()`**, ya exportada de
`draft-paths/gaps.ts` -- no se construye un `Map` a mano (`team-synergy.ts` sí lo hace inline hoy;
no se toca, pero la señal nueva no repite ese detalle).

### Tipado sin tocar `SignalId` (4.1)

Como `"archetype_fit"` todavía no es un `SignalId` (P5, §11.7), el archivo declara su propia vista
estrecha del contrato, **derivada de los tipos reales, no copiada a mano**:

```typescript
export type ArchetypeFitContribution =
  Omit<SignalContribution, "signal"> & { signal: "archetype_fit" };

export interface ArchetypeFitScorer {
  id: "archetype_fit";
  score(state: DraftState, candidate: HeroId, meta: MetaSnapshot): ArchetypeFitContribution;
}
```

`Omit<SignalContribution, "signal">` y no una interfaz escrita de cero: si `SignalContribution`
gana un campo, esta vista lo hereda sola. En 4.2, cuando `SignalId` incluya `"archetype_fit"`,
estos dos alias se borran y las anotaciones pasan a `SignalContribution`/`SignalScorer` --
**el cuerpo de `score()` no cambia una línea**, porque por tipado estructural el objeto ya
satisface `SignalScorer` en cuanto la unión se amplía.

### Algoritmo (determinista, puro, sin I/O, sin estado)

Sea `h` el candidato e `i` la intención.

**1. Bonus crudo** -- **la función ya existente, reutilizada sin reimplementar**:

```typescript
// draft-paths/build-paths.ts, hoy privada -> pasa a exportada. Sin cambios de firma ni de cuerpo.
export function archetypeFitBonus(archetype: DraftPathArchetype, candidate: HeroCapabilities): number {
  if (archetype === "push")      return levelScore(candidate.structuralDamage);  // 0 | 1 | 2
  if (archetype === "teamfight") return levelScore(candidate.teamfight);         // 0 | 1 | 2
  if (archetype === "pickoff")   return (candidate.hasCatch ? 2 : 0) + (candidate.hasInitiation ? 1 : 0); // 0..3
  return levelScore(candidate.scaling);                                          // 0 | 1 | 2
}
```

**2. Normalización por arquetipo** -- constante nueva, vive en `archetype-fit.ts`:

```typescript
const ARCHETYPE_MAX_BONUS: Record<DraftPathArchetype, number> = {
  push: 2, teamfight: 2, pickoff: 3, scaling: 2,
};

raw = archetypeFitBonus(i, h) / ARCHETYPE_MAX_BONUS[i]      // ∈ [0, 1]
```

**3.** `RAW_RANGE.archetype_fit = [0, 1]` en `mix.ts` -- **lo agrega 4.2**, no 4.1 (4.1 no toca
`mix.ts`). Queda fijado acá para que 4.2 no tenga que redecidirlo.

#### Por qué la normalización va adentro del scorer (y no en `RAW_RANGE`)

**Corrección a `architecture.md`**, medida contra el código real. El Cierre de `architecture.md`
dice que "la escala natural de `archetypeFitBonus` hoy es 0-3". Es cierto sólo como cota global:
la escala real es **distinta por arquetipo** -- `0..2` para `push`, `teamfight` y `scaling`, y
`0..3` **sólo** para `pickoff`, que es el único que suma dos booleanos en vez de leer un
`CapabilityLevel`.

`RAW_RANGE` es `Record<SignalId, [number, number]>`: **un solo rango por señal, no por arquetipo**.
No existe un valor que sirva para los cuatro:

- `[0, 3]` → con intención `push`, el mejor héroe posible del juego normaliza a **66.7**, nunca a
  100. Tres de los cuatro arquetipos quedan sistemáticamente subponderados frente al cuarto, por
  un detalle de implementación de la función, no por dominio.
- `[0, 2]` → `clamp` aplasta el `3` de `pickoff` contra el `2`, y se pierde la distinción entre
  "tiene catch" (2) y "tiene catch **e** initiation" (3), que es justamente la información que
  ese arquetipo aporta.

Como el arquetipo sólo se conoce dentro del scorer, **la normalización tiene que ocurrir ahí**.
Con `raw ∈ [0, 1]` la señal queda además alineada con `team_synergy`, `hero_pool_fit` y
`position_fit`, que ya usan `[0, 1]` (`mix.ts`).

#### Invariante de independencia del estado

`raw` **no depende de `DraftState` ni de `MetaSnapshot`** -- es constante por par `(intent, hero)`
durante todo el draft. `score()` recibe los tres parámetros por contrato, pero sólo usa
`candidate`.

No es un descuido: es exactamente lo que resuelve la queja de producto que originó la fase.
`counter` devuelve `raw: null` sin picks rivales, `team_synergy` devuelve `raw: null` sin picks
propios y `position_fit` reparte `need = 1` entre las cinco posiciones -- en el pick #1 casi nada
distingue a un candidato de otro, y por eso el top-3 inicial es siempre el mismo. `archetype_fit`
es la primera señal del motor que **sí** discrimina con el draft vacío.

Su contracara (la señal sigue empujando en el pick #5 aunque el draft ya haya cumplido la
intención) es una pregunta legítima de calibración, **registrada como abierta para 4.2/4.3**
(§11.11). No se resuelve en 4.1.

### Los tres resultados posibles de `score()`

| Caso | `raw` | `applicable` | `sampleSize` | `explanation` |
|---|---|---|---|---|
| `intent === undefined` | `null` | **`false`** | `0` | `"Elegí una intención de draft para activar esta señal"` |
| Candidato sin entrada en `capabilities.json` | `null` | ausente | `0` | `"Sin datos de capacidades tácticas para este héroe"` |
| Normal | `[0, 1]` | ausente | `0` | ver abajo |

`weighted: 0` siempre -- lo calcula `mix.ts`, igual que las otras cinco señales.

`sampleSize: 0` **siempre, incluido el caso normal**: `capabilities.json` es dato de dominio
curado a mano, no una muestra estadística. No hay ningún número de partidas que reportar, y
poner uno inventado sería peor que el cero. Mismo criterio que `team_synergy` (que también deriva
de `capabilities.json` y también reporta `0`).

**Nunca `applicable: false` por falta de dato**, y **nunca un número por falta de intención**: son
los dos errores que la distinción de 1b (§9.3) existe para evitar, y acá conviven los dos casos en
la misma señal por primera vez.

### `explanation` (texto visible en el desglose de la UI)

Determinista, en castellano, mismo vocabulario que `GAP_LABELS`/`PATH_LABELS` (`build-paths.ts`)
y `LEVEL_QUALIFIER` (`team-synergy.ts`) ya usan -- no se inventa terminología nueva:

```
ARCHETYPE_LABEL   = { push: "Push", teamfight: "Teamfight", pickoff: "Pickoff", scaling: "Scaling" }
DIMENSION_LABEL   = { push: "daño a estructuras", teamfight: "teamfight", scaling: "scaling" }
LEVEL_QUALIFIER   = { medium: "buen", high: "muy buen" }   // "low" nunca llega acá: da bonus 0
```

- `raw === 0` → `"No aporta a un draft de ${ARCHETYPE_LABEL[i]}"`
- `push`/`teamfight`/`scaling` con `raw > 0` →
  `"Aporta ${LEVEL_QUALIFIER[nivel]} ${DIMENSION_LABEL[i]} a tu draft de ${ARCHETYPE_LABEL[i]}"`
- `pickoff` con `raw > 0` → `"Aporta ${lista} a tu draft de Pickoff"`, donde `lista` es
  `"catch"`, `"initiation"` o `"catch e initiation"` según los dos booleanos.

### Por qué exportar `archetypeFitBonus` y no moverla a `gaps.ts` (P2)

`architecture.md` dejaba las dos abiertas. Se elige **exportar en su lugar actual**, y el motivo
decisivo es el presupuesto real del gate, verificado leyendo `scripts/verify-simplicity.sh`:
cuenta **todos los archivos staged** salvo bookkeeping, y **los archivos de prueba cuentan**.

- Exportar en `build-paths.ts` → **1** archivo tocado. Total del ticket: **3** (§11.9). ✅
- Mover a `gaps.ts` → **2** archivos (agregar en `gaps.ts` + quitar e importar en
  `build-paths.ts`). Total del ticket: **4**. ❌ Bloquea, y obligaría a un
  `simplicity_exception: true` para un refactor que 4.1 no necesita.

Se reconoce el argumento de capas a favor de `gaps.ts` (es el módulo de primitivas puras que
`signals/` ya consume, mientras que `build-paths.ts` es el que arma la salida `DraftPath`). Se
descarta por presupuesto, no por técnica: **si el sub-ticket 4.4 termina necesitándola en
`gaps.ts`, moverla ahí es un refactor mecánico y aislado, con su propio ticket**. Hacerlo ahora
sería pagarlo con la prueba que sí importa.

## 11.5 — Ejemplos trabajados (con el dato real, no inventado)

Valores obtenidos **ejecutando `archetypeFitBonus` real contra `capabilities.json` real** y
aplicando `ARCHETYPE_MAX_BONUS` -- son los números exactos que las pruebas deben esperar (mismo
estándar que §10.5). Los héroes se llevan al test **como fixture inline** (S9), nunca leyendo el
archivo.

**Escenario A -- intención `push`** (`MAX = 2`):

| Candidato | `structuralDamage` | bonus | `raw` |
|---|---|---|---|
| Nature's Prophet (53) | `high` | 2 | **1.000** |
| Lycan (77) | `high` | 2 | **1.000** |
| Juggernaut (8) | `medium` | 1 | **0.500** |
| Anti-Mage (1) | `low` | 0 | **0.000** |

**Escenario B -- los mismos héroes, intención `scaling`** (`MAX = 2`). Es el escenario que prueba
que la señal sigue **la intención** y no una calidad intrínseca del héroe:

| Candidato | `scaling` | bonus | `raw` |
|---|---|---|---|
| Anti-Mage (1) | `high` | 2 | **1.000** |
| Juggernaut (8) | `high` | 2 | **1.000** |
| Nature's Prophet (53) | `medium` | 1 | **0.500** |
| Crystal Maiden (5) | `low` | 0 | **0.000** |

**El orden se invierte por completo entre A y B** (Anti-Mage `0.000` → `1.000`; Nature's Prophet
`1.000` → `0.500`), usando los mismos héroes y el mismo dato.

**Escenario C -- intención `pickoff`** (`MAX = 3`, la única escala de cuatro niveles):

| Candidato | `hasCatch` / `hasInitiation` | bonus | `raw` |
|---|---|---|---|
| Pudge (14) | sí / sí | 3 | **1.000** |
| Lion (26) | sí / sí | 3 | **1.000** |
| Crystal Maiden (5) | sí / no | 2 | **0.667** |
| Axe (2) | no / sí | 1 | **0.333** |
| Anti-Mage (1) | no / no | 0 | **0.000** |

`0.667` y `0.333` sólo salen si el denominador es `3`. Es el escenario que detecta un
`ARCHETYPE_MAX_BONUS` mal puesto (o un `RAW_RANGE` global de `[0,2]`/`[0,3]`), y por eso es
prueba obligatoria y no un extra (§11.9).

## 11.6 — Estado real de `capabilities.json` (corrección a `architecture.md`)

`architecture.md` asumía "hoy: cobertura completa, a reconfirmar en `/blueprint`". **Reconfirmado:
es falso.**

- `capabilities.json`: **124** entradas, 124 héroes únicos.
- `hero-positions.json` (el censo más reciente del motor, Fase 3): **126** héroes.
- **Héroes en `hero-positions.json` sin entrada en `capabilities.json`: `131`, `145`, `155`** --
  héroes agregados al juego después de que se curó `capabilities.json` en Fase 2.
- Caso inverso: hero `66` (Chen) tiene capacidades pero no posiciones -- ya conocido y documentado
  como el hueco de `position_fit` (§10.1 P5).

**Consecuencias, todas para 4.1:**

1. La rama `raw: null` de P6 **no es defensiva, es alcanzable con el dato real de hoy**. Deja de
   ser un caso teórico y pasa a ser comportamiento observable.
2. **No se completa `capabilities.json` en este ticket.** Curar 3 héroes es trabajo de dominio del
   usuario (mismo tipo de dato que `PATH_PRIORITIES`), no de implementación, y consumiría archivo
   y presupuesto del ticket. Va como su propio ticket, sin bloquear a 4.1 -- la señal degrada
   correctamente mientras tanto.
3. **Es también un hueco preexistente de `team_synergy` y de los caminos de draft**, no algo que
   introduzca esta fase: esos 3 héroes ya no participan hoy como candidatos de `buildDraftPaths`.

## 11.7 — Por qué `SignalId` **no** se toca en 4.1 (P5)

`architecture.md` recomendaba tentativamente adelantarlo a 4.1 "para que el archivo de prueba
compile con el tipo real". Verificado contra el código, **es la decisión equivocada**: `SignalId`
se usa como clave de varios `Record` **totales**, así que ampliarlo no agrega un caso, **rompe la
compilación en todo lo que lo indexa**:

| Archivo | Uso | Qué pasa al ampliar `SignalId` |
|---|---|---|
| `signals/weights.ts` | `SCORING_WEIGHTS_V4: Record<SignalId, number>` | **No compila** (falta la clave) |
| `signals/weights.ts` | `SCORING_WEIGHTS_V5: Record<SignalId, number>` | **No compila** (falta la clave) |
| `signals/mix.ts` | `RAW_RANGE: Record<SignalId, [number, number]>` | **No compila** (falta la clave) |
| `apps/web/.../SignalBreakdown.tsx` | `SIGNAL_LABELS: Record<SignalId, string>` | **No compila** (espejo, apps/web) |

El problema de fondo no es el conteo de archivos: **V4 y V5 están congeladas por nombre**
(`weights.ts`: *"Congelada, nunca se edita a partir de acá"*). Adelantar `SignalId` obligaría a
editar dos constantes congeladas, para una señal que en 4.1 todavía no vota. Sumado a eso,
llevaría el ticket a **5-6 archivos** contra un límite de 3.

Se resuelve con la vista estrecha de §11.4 (`Omit<SignalContribution, "signal"> & { signal:
"archetype_fit" }`), que compila hoy y desaparece en 4.2.

**Prescripción para 4.2, decidida acá para que no se redescubra:** antes de ampliar `SignalId`,
V4 y V5 pasan a tiparse con sus propios literales históricos -- exactamente el mecanismo que
`weights.ts` ya estableció para V1/V2/V3 (`type SignalIdV1 = ...`):

```typescript
type SignalIdV5 = "counter" | "patch_meta" | "team_synergy" | "hero_pool_fit" | "position_fit";
// V4 y V5 pasan a Record<SignalIdV5, number>. Ningún valor cambia -- sólo el mecanismo de tipado,
// igual que TSK-045 hizo con V1/V2/V3. Recién entonces SCORING_WEIGHTS_V6: Record<SignalId, number>.
```

Así una versión congelada deja de estar acoplada a qué señales existen hoy, que es justamente el
motivo por el que ese patrón se introdujo en Fase 3.

## 11.8 — Seguridad (hereda el Bloque 4 de `/pre-flight`; extiende §5, §9.7 y §10.8)

Confirmado contra el código, no reinventado:

- **Ningún cruce de frontera de confianza nuevo en runtime.** `archetype_fit` consume
  exclusivamente `HeroCapabilities[]`, ya validado en el borde por `loadHeroCapabilities()`
  (costura S9, `draft-paths/capabilities.ts`), y `DraftPathArchetype`, que es una unión cerrada de
  4 literales interna al proceso. Cero superficie nueva.
- **Ninguna dependencia nueva, ningún archivo de datos nuevo.** P1 elimina el
  `archetype-affinity.json` que el diseño original iba a introducir, y con él su validación de
  borde.
- **Ningún secreto nuevo, ningún dato personal.** Mismo tipo de dato agregado y público que el
  resto del motor.
- **Cero red en el camino caliente, intacta.** `archetype-fit.ts` vive bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` ya bloquea cualquier `fetch(` sobre el
  árbol completo (invariante 7 del script). La señal no puede llamar a la red ni por accidente.
- **`intent` es input de la propia UI, no de la red**, y en 4.1 ni siquiera llega desde afuera: lo
  inyecta el llamador de la fábrica. Su validación en el borde (cuando llegue por API en 4.2+) es
  responsabilidad del sub-ticket que abra ese camino, y está anotada en §11.10.
- **`archetypeFitBonus` no gana lógica al exportarse** -- sólo visibilidad. El cambio es
  `function` → `export function`, sin tocar firma ni cuerpo, así que no puede alterar el
  comportamiento ya probado de `buildDraftPaths`.

## 11.9 — Criterios de aceptación (sub-ticket 4.1)

**Archivos exactos del ticket -- 3, dentro del límite:**

| # | Archivo | Cambio | Líneas nuevas (est.) |
|---|---|---|---|
| 1 | `apps/engine/src/draft-paths/build-paths.ts` | `function archetypeFitBonus` → `export function archetypeFitBonus`. **Una línea, sin cambios de firma ni de cuerpo.** | ~1 |
| 2 | `apps/engine/src/signals/archetype-fit.ts` | **Nuevo.** Fábrica, `ARCHETYPE_MAX_BONUS`, normalización, las 3 ramas de resultado y `explanation`. | ~75 |
| 3 | `apps/engine/src/signals/archetype-fit.test.ts` | **Nuevo.** Los 5 casos obligatorios de abajo, con fixture inline. | ~95 |

Total estimado: **~170 líneas nuevas / 3 archivos** (límites: 200 / 3). Si el archivo de prueba se
pasa del presupuesto, **se declara `simplicity_exception: true` en el ticket -- nunca se recorta
una de las 5 pruebas obligatorias** para entrar en el límite.

**Criterios funcionales:**

1. `mix.ts`, `weights.ts`, `signals/types.ts` y **todo `apps/web` quedan sin tocar**.
   `SCORING_WEIGHTS_V5` sigue activa. `bunx tsc --noEmit` limpio en **ambos** paquetes, y
   `bun test` sigue verde **sin que ninguna prueba existente cambie** -- el motor todavía no
   cambia de comportamiento (§11.1).
2. **Sin intención** (`intent === undefined`) → `raw: null` **y** `applicable: false`, para
   candidatos de perfiles distintos. Nunca `raw: 0`, nunca `applicable: false` con un número.
3. **Intención `push`** → Nature's Prophet `1.000` > Juggernaut `0.500` > Anti-Mage `0.000`
   (Escenario A, §11.5).
4. **Intención `scaling`, mismos héroes → el orden se invierte**: Anti-Mage `1.000` >
   Nature's Prophet `0.500` (Escenario B). **Prueba dedicada, no se infiere del criterio 3.**
   Sin ella, una implementación que devolviera un ranking fijo de "héroes buenos" ignorando
   `intent` pasaría el criterio 3 y seguiría estando rota -- mismo tipo de hallazgo que §10.9
   criterio 4 y que `@redteam` encontró en TSK-036.
5. **Intención `pickoff` → la escala de 4 niveles**: Pudge `1.000`, Crystal Maiden `0.667`,
   Axe `0.333`, Anti-Mage `0.000` (Escenario C). Es el único criterio que detecta un denominador
   equivocado; con `MAX = 2` para todos, Crystal Maiden y Pudge empatan en `1.000` y los otros
   criterios siguen pasando.
6. **Candidato sin entrada en las capacidades inyectadas** → `raw: null`, `applicable` ausente
   (nunca `false`), `explanation` de "sin datos", **nunca una excepción sin capturar** (contrato
   de `safeScore`, `mix.ts`).
7. **Ninguna prueba lee `capabilities.json` real** (S9, §11.3) -- fixture inline, verificable
   leyendo el archivo de prueba.
8. `archetypeFitBonus` **se reutiliza, no se reimplementa**: `archetype-fit.ts` la importa de
   `build-paths.ts`. Una segunda copia de la fórmula es rechazo automático de revisión.

## 11.10 — Piezas 2-4 y sub-tickets 4.2-4.8 (contrato conceptual, **sin números**)

Nivel de detalle deliberadamente igual al de `architecture.md` Bloque 3: contratos e invariantes
sí, números no. **Cada número marcado abajo se fija en el `/blueprint` de su propio sub-ticket**,
no acá.

### 4.2 — Integración de `archetype_fit` en el motor

- Amplía `SignalId` con `"archetype_fit"`, **precedido del recongelado de V4/V5 con literales
  históricos** (§11.7 -- prescripción ya decidida, no pendiente).
- `SCORING_WEIGHTS_V6: Record<SignalId, number>`, 6 pesos. **Peso exacto de `archetype_fit` y
  redistribución de los otros 5: pendiente del blueprint de 4.2.** Invariantes que sí quedan
  fijos ahora: suman exactamente `1.0` (prueba unitaria obligatoria, como toda versión desde V1);
  V1-V5 quedan congeladas por nombre; **`position_fit` sigue siendo la señal de mayor peso**
  (Fase 3 no se reabre).
- `RAW_RANGE.archetype_fit = [0, 1]` -- **ya fijado** (§11.4 P4), no vuelve a discutirse.
- `BuildSuggestionsOptions.archetypeIntent?: DraftPathArchetype`, mismo patrón que
  `now?`/`heroPositions?`/`heroCapabilities?`. Ausente → `applicable: false`.
- **Candado de regresión V5→V6, del tipo V1→V2 de 1b** (no el de V4→V5, que no aplicaba): con
  `archetypeIntent` ausente, `mixScore` sobre un set fijo de señales debe reproducir **los mismos
  números exactos** que `SCORING_WEIGHTS_V5`. Candado numérico en `mix.test.ts`, no una
  afirmación de que "no cambió nada". Es exigible porque V6 **agrega** una señal con estado "no
  configurada" -- justo la forma que hace demostrable la regresión cero.
- Espejo obligatorio en `apps/web` **en el mismo cambio** (`web.md`): `SignalId` en
  `features/draft/types.ts`, `SIGNAL_LABELS` en `SignalBreakdown.tsx` (`Record<SignalId, string>`,
  no compila si falta) y `SIGNAL_DISPLAY_PRIORITY` en `features/draft/constants.tsx`.
  `SignalBreakdown` pasa a mostrar **6 señales**. Etiqueta visible de `archetype_fit`: **pendiente
  del blueprint de 4.2** (terminología en castellano, `web.md`).
- Cuando `intent` llegue desde `apps/web`, **se valida en el borde contra la unión cerrada de 4
  literales** antes de tocar el motor (§5: todo input externo se valida en el borde). Un valor
  inválido degrada a "sin intención" (`applicable: false`), nunca lanza.

### 4.3 — QA manual y calibración

Escenario base ya acordado (`architecture.md` Bloque 6): elegir "Push" con el draft vacío y
confirmar que el top-3 se inclina hacia daño a estructuras/waveclear temprano **sin romper la
prioridad de `position_fit`**. Guion exacto y umbrales: pendientes de su propio turno.

### 4.4 — Pieza 2: sinergia en cadena (extiende `team_synergy.ts`, **no** señal nueva)

- Se deriva de `capabilities.json`, **sin agregar campos nuevos** a `HeroCapabilities` en esta
  fase. Cerrado por el hallazgo 1 del Bloque 2: OpenDota **no expone** sinergia de compañeros
  (verificado contra `odota/core`, `HeroMatchupsResponse.ts`: el shape es sólo
  `{ hero_id, games_played, wins }`, exclusivamente "against"). **Sin `MetaSnapshot.heroSynergy?`,
  sin tabla SQLite nueva, sin sync nuevo, sin dependencia nueva.**
- Generaliza `filledGaps` de "cuánto llena un hueco del equipo" a "cuánto complementa a un aliado
  ya elegido" -- diferencia de granularidad (par a par vs. equipo agregado), no de fuente.
- **Fórmula exacta (cómo pesar "complementa al último pick" vs. "complementa al equipo"):
  pendiente del blueprint de 4.4.**
- `SignalId: "team_synergy"` no cambia; cambia su cálculo interno y su `explanation`.

### 4.5 — Pieza 3: denial de composición (extiende `counter.ts`, **no** señal nueva)

- Segunda pasada agregada sobre `knownEnemies`: qué arquetipo insinúan los picks rivales
  (reusando `archetypeFitBonus` contra héroes rivales, no sólo candidatos propios) y qué
  candidatos puntúan bien contra **ese** arquetipo.
- Necesita una **matriz 4×4 de contras por arquetipo**, dato de producto curado a mano, versionado
  en el repo (mismo criterio que `PATH_PRIORITIES`/`capabilities.json`, **no** SQLite, **no**
  fuente externa en runtime). **Contenido exacto de la matriz: pendiente del blueprint de 4.5** --
  es dominio real del juego y **requiere validación directa del usuario**, no se infiere de ningún
  dato existente.
- `SignalId: "counter"` no cambia.

### 4.6 — Pieza 4: diversificación (selección final en `mix.ts`, **no** el scoring)

- No toca las 6 señales ni sus pesos. Aplica sólo a qué candidatos de `scored` (ya ordenado por
  `mixScore`) entran al `TOP_N`: los que caen dentro de una banda de tolerancia respecto del líder
  entran a un softmax de temperatura baja.
- **Invariante duro que sí queda fijo ahora**: un líder que domina por margen amplio se muestra
  **siempre** en el puesto 1 -- nunca se diversifica fuera una sugerencia claramente superior.
- **Ancho de la banda de tolerancia y temperatura del softmax: pendientes del blueprint de 4.6.**
- `BuildSuggestionsOptions.random?: () => number`, mismo patrón que `now?`. **Estrena la costura
  S12** (RNG inyectable), que se define en el blueprint de ese sub-ticket, no acá.
- `buildComparison`/`SuggestionComparison` no cambian de contrato: la diversificación ocurre
  después de tener el ranking completo.

### 4.7-4.8 — Sin contenido asignado todavía

`architecture.md` deja la numeración abierta a propósito, tras eliminar el ticket de "cargar
archivo JSON nuevo" que la primera propuesta incluía (P1). **Se asigna cuando 4.2-4.6 estén
cerrados**, no antes.

## 11.11 — Lo que esta fase deja abierto a propósito

- **Todos los números de §11.10.** Repetido acá para que sea imposible tomarlos por olvido:
  peso de `archetype_fit` en V6, banda de tolerancia y temperatura del softmax, matriz 4×4 de
  contras, fórmula de sinergia par a par, etiqueta visible de la señal en `apps/web`.
- **Decaimiento de `archetype_fit` a lo largo del draft.** La señal es constante por
  `(intent, hero)` (§11.4): sigue empujando en el pick #5 aunque el draft ya haya cumplido la
  intención. Pregunta legítima de calibración, **abierta para 4.2/4.3**. En 4.1 no se resuelve, y
  no es un defecto de 4.1 -- es el comportamiento especificado.
- **Los 3 héroes sin entrada en `capabilities.json`** (`131`, `145`, `155`, §11.6): ticket propio
  de curación de dominio, no bloquea a 4.1.
- **`team_synergy` devuelve `raw: 0` -- no `null` -- para un héroe sin capacidades**
  (`team-synergy.ts`, rama `!candidateCapabilities`). Contradice la regla dura del proyecto
  (`engine.md`: *"`raw: null` nunca es 0 ni 0.5"*) y, con el hueco real de §11.6, hoy se dispara
  con 3 héroes. **Hallazgo de este blueprint, fuera de alcance de 4.1** (tocaría un 4º archivo):
  queda registrado como ticket propio.
- **El bot del Random Draft Simulator sigue sin usar `buildSuggestions`** -- sin cambios desde
  Fase 3 (`engine.md`). El QA de esta fase se hace contra el Copilot real, nunca contra ese bot.
- **Predicción de la posición del rival** -- fuera de alcance desde 1b (D12), sin cambios.
- **Sin ML, sin recomendación de items/builds, sin reabrir Fase 3** (Bloque 1).

## 11.12 — Entrada para `/rulebook`

**Sólo el sub-ticket 4.1 está listo para generar ticket.** El resto espera su propio `/blueprint`.

Una unidad lógica, un solo ticket, 3 archivos (§11.9):

1. `archetypeFitBonus` exportada (`draft-paths/build-paths.ts`) + `createArchetypeFitScorer`
   (`signals/archetype-fit.ts`) + su prueba aislada (`signals/archetype-fit.test.ts`).
   Cubre los criterios 1-8 de §11.9. Costuras: **S3** (señal pura, aislada) sobre **S9**
   (capacidades inyectadas). **Ninguna costura nueva.**

**No se parte en dos tickets** (exportar / crear señal): exportar una función sin consumidor no es
una unidad entregable, y partirlo duplicaría el bookkeeping sin bajar el riesgo.

`preferred_tool` sugerido: **`claude-code`** -- toca el motor, exige `@redteam` y la trazabilidad
de las decisiones de §11.4/§11.7 vive en `journal.md`.
