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

Esto es intencional: 4.1 aísla la nueva señal antes de la integración. La integración -- y con
ella el único cambio de comportamiento real -- vive entera en 4.2.

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

---

## 11.13 — Blueprint del sub-ticket 4.2 (integración de `archetype_fit` en el motor)

Sexto `/blueprint` de sub-ticket del proyecto. Corrido en **Sonnet por decisión explícita del
usuario (2026-08-28)** -- desviación consciente de la política de modelos (`/blueprint` = nivel
razonamiento/Opus), no un gatillo de la lista de `CLAUDE.md`. Anotada en `journal.md`. Todo lo que
sigue (`/rulebook` en adelante) es Sonnet igual que siempre.

### 11.13.0 — Alcance (leer primero)

**Sólo la integración en el motor.** `archetype_fit` pasa de señal aislada (4.1) a la **sexta
señal ponderada** de `buildSuggestions`, alimentada por una opción inyectada
(`BuildSuggestionsOptions.archetypeIntent`). **Fuera de 4.2, va a 4.3:** el selector de intención
en `apps/web`, el transporte (campo en el request de sugerencias y en el `hello` del WS) y la
validación de borde de ese input. `apps/web` en 4.2 se toca **sólo** para el espejo de tipos y
para que `SignalBreakdown` renderice la sexta fila -- que mostrará `applicable: false` ("elegí una
intención") hasta que 4.3 conecte el selector.

- **§11.13.1 a §11.13.8 son contrato cerrado.** Cero números pendientes.
- **§11.13.9 lista lo que 4.2 deja abierto para 4.3** -- explícito para que no se tome por olvido.

### 11.13.1 — Qué de fases anteriores queda superado

| Antes | 4.2 lo cambia a |
|---|---|
| §10.3 / §11.1: `SCORING_WEIGHTS_V5` es la constante activa | **`SCORING_WEIGHTS_V6`** es la activa. V1-V5 quedan congeladas por nombre, nunca se editan |
| `weights.ts`: `SCORING_WEIGHTS_V4`/`V5: Record<SignalId, number>` | `Record<SignalIdV5, number>` -- literales históricos propios, **valores intactos**, mismo mecanismo que TSK-045 usó para V1/V2/V3 (§11.7). Es el paso previo obligatorio a ampliar `SignalId` |
| `signals/types.ts`: `SignalId` = 5 literales | 6 literales (`… \| "archetype_fit"`) |
| §11.4: `archetype-fit.ts` declara la vista estrecha `ArchetypeFitContribution`/`ArchetypeFitScorer` | Los dos alias **se borran**; las anotaciones pasan a `SignalContribution`/`SignalScorer`. **El cuerpo de `score()` no cambia una línea** (§11.4 lo previó) |
| §11.1: el motor no cambia de comportamiento observable | 4.2 **es** el cambio de comportamiento -- pero sólo cuando hay `archetypeIntent`; sin él, salida byte a byte idéntica a V5 (candado, §11.13.5) |

`applyDraftEvent` sigue puro, el orden de push no cambia, `position_fit` sigue siendo la señal de
mayor peso, Fase 3 no se reabre.

### 11.13.2 — Decisiones cerradas

| # | Pregunta | Decisión (usuario, 2026-08-28) |
|---|---|---|
| Q1 | ¿Alcance de 4.2? | **Sólo motor.** UI + transporte + validación de borde = 4.3 (§11.13.0). |
| Q2 | ¿Peso de `archetype_fit` en V6? | **`0.10`.** Los otros 5 pesos = su valor de V5 × `0.90`. Mismo criterio de precedente que `role_safety` (§9 / `weights.ts`): señal opt-in que sólo vota si el usuario eligió intención. |
| Q3 | ¿Decaimiento de la señal a lo largo del draft? | **No en 4.2.** `raw` sigue constante por `(intent, hero)` como en 4.1. El posible sobre-empuje en picks tardíos se mide en el QA de 4.3 y se resuelve ahí si es real -- no se le mete una dependencia de `DraftState` al scorer sin datos que la respalden. |
| Q4 | Etiqueta visible en `apps/web` | **"Intención de draft"** (`SIGNAL_LABELS`, `SignalBreakdown.tsx`). Al final de `SIGNAL_DISPLAY_PRIORITY` -- señal gruesa (3-4 niveles), menor densidad informativa que las tácticas. |
| Q5 | `RAW_RANGE.archetype_fit` | **`[0, 1]`** -- ya fijado en §11.4 P4, no se rediscute. |

### 11.13.3 — Costuras: ninguna nueva

- `archetype_fit` ya es un `SignalScorer` puro con archivo de prueba propio → **S3**, sin cambios
  respecto de 4.1. Su dependencia de datos sigue siendo **S9** (`HeroCapabilities[]` inyectado).
- **El candado de regresión V5→V6 se prueba en `mix.test.ts` contra `mixScore(SignalContribution[])`
  directamente**, con un set fijo de contribuciones -- nunca reconstruido vía `buildSuggestions`.
  Mismo patrón exacto que el candado V1→V2 de 1b (§9.3) y V1→V3 de TSK-027. Es exigible porque V6
  **agrega** una señal con estado "no configurada", que es justo la forma que hace demostrable la
  regresión cero (a diferencia de V4→V5, que reemplazaba señales y por eso no llevaba candado).
- El candado de sensibilidad ("con `archetypeIntent` el top-3 se mueve") se prueba contra
  **`buildSuggestions` completo**, no la señal aislada -- mismo criterio literal que §10.9-7 y
  §12.14-2: la señal puede dar el número correcto y el ranking no moverse si el peso no alcanza.
- **`S12` sigue reservada** para el RNG de diversificación (4.6). 4.2 no la toca.

### 11.13.4 — Contrato de datos

**`signals/weights.ts`** -- primero el re-tipado (valores sin tocar), después V6:

```typescript
type SignalIdV5 = "counter" | "patch_meta" | "team_synergy" | "hero_pool_fit" | "position_fit";
// SCORING_WEIGHTS_V4 y V5 pasan a Record<SignalIdV5, number>. Ni una coma cambia -- sólo el tipo,
// igual que TSK-045 hizo con V1/V2/V3. Una versión congelada no debe seguir acoplada a qué
// señales existen hoy.

// V6 = V5 escalada por 0.90 + archetype_fit 0.10. Con archetype_fit sin voto (sin intención), la
// redistribución proporcional de mix.ts sobre las otras 5 reproduce V5 EXACTO:
//   (V5ᵢ · 0.90) / Σ(V5 · 0.90)  ==  V5ᵢ / Σ V5   para todo i.
// Candado numérico en mix.test.ts, no una afirmación a ojo (§11.13.5).
export const SCORING_WEIGHTS_V6: Record<SignalId, number> = {
  position_fit:  0.342,   // 0.38 · 0.90 — sigue siendo la de mayor peso
  counter:       0.216,   // 0.24 · 0.90
  patch_meta:    0.117,   // 0.13 · 0.90
  team_synergy:  0.117,   // 0.13 · 0.90
  hero_pool_fit: 0.108,   // 0.12 · 0.90
  archetype_fit: 0.10,
};
// Σ = 1.000 — prueba unitaria obligatoria en mix.test.ts, como toda versión desde V1.
```

**`signals/types.ts`**: `SignalId = "counter" | "patch_meta" | "team_synergy" | "hero_pool_fit" |
"position_fit" | "archetype_fit"`. `SignalContribution`/`SignalScorer` no cambian de forma.

**`signals/archetype-fit.ts`**: se borran `ArchetypeFitContribution` y `ArchetypeFitScorer`;
`createArchetypeFitScorer` pasa a devolver `SignalScorer` y `score()` a devolver
`SignalContribution`. **Cuerpo, normalización, `ARCHETYPE_MAX_BONUS`, `explanation` y las 3 ramas
de resultado: sin cambios** (ya son los de §11.4). Por tipado estructural el objeto ya satisface
`SignalScorer` en cuanto la unión se amplía.

**`signals/mix.ts`**:

```typescript
import { SCORING_WEIGHTS_V6 } from "./weights";   // reemplaza el import de V5
// weightedContributions() y buildReason() pasan a indexar SCORING_WEIGHTS_V6. Ningún otro cambio
// de lógica: la redistribución proporcional de hasVote() ya maneja una señal que no vota.

const RAW_RANGE: Record<SignalId, [number, number]> = {
  counter: [-0.12, 0.12], patch_meta: [0.3, 0.7], team_synergy: [0, 1],
  hero_pool_fit: [0, 1], position_fit: [0, 1],
  archetype_fit: [0, 1],                           // nuevo — raw ya viene normalizado del scorer
};

export interface BuildSuggestionsOptions {
  // …existentes…
  // Ausente -> el scorer recibe intent === undefined -> applicable: false (nunca vota, nunca baja
  // la confianza). Presente -> la señal entra a la mezcla. Mismo patrón que heroPositions?/
  // heroCapabilities?/now?. En 4.2 lo fija sólo el llamador; por request/WS es 4.3.
  archetypeIntent?: DraftPathArchetype;
}
```

Ensamblado dentro de `buildSuggestions`, junto a los otros dos scorers por-llamada:

```typescript
const scorers: SignalScorer[] = [
  ...baseScorers,
  createPositionFitScorer(heroPositions),
  createTeamSynergyScorer(heroCapabilities),
  createArchetypeFitScorer(heroCapabilities, options.archetypeIntent),   // nuevo
];
```

`safeScore` ya envuelve toda excepción del scorer en `raw: null`; `computeConfidence` ya ignora
`applicable === false`. No hay ramas nuevas de manejo de error.

### 11.13.5 — Candado de regresión cero (números exactos)

Sea `S` un set fijo de `SignalContribution[]` con voto real en las 5 señales de V5 (`raw` fijos,
elegidos en el test) y una sexta contribución `archetype_fit` con `applicable: false`.

- `hasVote()` descarta la de `archetype_fit` en ambas versiones.
- Con **V5**: `share_i = V5_i / Σ(V5)` sobre las 5.
- Con **V6**: `share_i = (V5_i · 0.90) / Σ(V5 · 0.90) = V5_i / Σ(V5)` sobre las mismas 5 -- el
  factor `0.90` se cancela.
- ⇒ `mixScore(S)` con V6 **==** `mixScore(S)` con V5, al bit.

`mix.test.ts` fija `S` con números concretos, calcula el `mixScore` esperado a mano y verifica la
igualdad exacta con ambas constantes (se importa `SCORING_WEIGHTS_V5` sólo para el test). Con
`archetypeIntent` presente y un candidato con `raw ∈ [0,1]`, el `mixScore` **sí** difiere -- ese
es el caso que el criterio 3 de §11.13.8 cubre.

### 11.13.6 — Espejo obligatorio en `apps/web` (mismo cambio, `web.md`)

| Archivo | Cambio |
|---|---|
| `features/draft/types.ts` | `SignalId` += `"archetype_fit"` |
| `features/draft/validation.ts` | `isSignalId` (cadena `value === …`) += `\|\| value === "archetype_fit"` |
| `features/draft/constants.tsx` | `SIGNAL_DISPLAY_PRIORITY` += `"archetype_fit"` **al final** |
| `components/signal-breakdown/SignalBreakdown.tsx` | `SIGNAL_LABELS: Record<SignalId, string>` += `archetype_fit: "Intención de draft"` -- es un `Record` total, **no compila sin la clave** |

`SignalBreakdown` pasa a mostrar **6 filas**. Sin intención, la sexta cae en la fila
`SignalBreakdownRowNotApplicable` ya existente (TSK-026), con el `explanation` que manda el motor
(`"Elegí una intención de draft para activar esta señal"`) -- **nunca** el texto de "Sin datos
suficientes", que es exclusivo de `raw: null`. Un candidato de los 3 sin entrada en
`capabilities.json` con intención elegida sí usa la fila de `raw: null`.

### 11.13.7 — Seguridad (hereda §11.8; sin frontera nueva)

- **Ningún cruce de frontera de confianza nuevo en runtime.** En 4.2 `archetypeIntent` sólo entra
  por `BuildSuggestionsOptions`, que fija el llamador dentro del proceso -- no llega de la red. La
  validación de borde contra la unión cerrada de 4 literales (`push`/`teamfight`/`pickoff`/
  `scaling`), con degradado a "sin intención" ante un valor inválido y sin lanzar nunca, es
  responsabilidad de **4.3**, cuando el input llegue por request/`hello` (§5, §11.8).
- Ninguna dependencia nueva, ningún archivo de datos nuevo, ningún secreto, ningún dato personal.
- `archetype-fit.ts` vive bajo `apps/engine/src/signals/`, donde `verify-simplicity.sh` ya bloquea
  cualquier `fetch(` sobre el árbol completo. Cero red en el camino caliente, intacta.

### 11.13.8 — Criterios de aceptación

**Archivos (≈9-10) -- se declara `simplicity_exception: true` en el ticket.** Es una integración
transversal (motor + espejo `apps/web` + dos candados de prueba), no una unidad de 3 archivos.
**Nunca se recorta una prueba obligatoria para entrar en un límite.**

- Motor: `signals/types.ts`, `signals/weights.ts`, `signals/mix.ts`, `signals/archetype-fit.ts`,
  `signals/mix.test.ts`, `signals/archetype-fit.test.ts`.
- `apps/web`: `features/draft/types.ts`, `features/draft/validation.ts`,
  `features/draft/constants.tsx`, `components/signal-breakdown/SignalBreakdown.tsx`
  (+ su `.test.ts` si el conteo de filas está aseverado).

**Funcionales:**

1. `bunx tsc --noEmit` limpio en **`apps/engine` y `apps/web`**. `SCORING_WEIGHTS_V1..V5` sin un
   solo valor cambiado. Prueba de que los 6 pesos de V6 suman `1.0`.
2. **Candado de regresión cero numérico** (`mix.test.ts`): con `archetypeIntent` ausente,
   `mixScore(S)` sobre un set fijo `S` da **el mismo número exacto** con V6 que con V5. No "no
   cambió a ojo" (§11.13.5).
3. **Candado de sensibilidad** contra `buildSuggestions` completo: con `archetypeIntent: "push"`
   y draft vacío, el top-3 se inclina hacia héroes de `structuralDamage` alto respecto del top-3
   sin intención. Prueba dedicada con `scaling` que **invierte** la inclinación (mismo tipo de
   hallazgo que §11.9 criterio 4).
4. **`position_fit` sigue siendo el mayor peso de V6** (`0.342` > todos) -- aserción explícita.
5. Candidato sin entrada en las capacidades inyectadas + intención elegida → `raw: null` para
   `archetype_fit`, las otras 5 se calculan igual, **nunca una excepción sin capturar**.
6. `SignalBreakdown` renderiza 6 filas; sin intención la sexta usa la fila "no aplica" con el
   texto del motor, jamás "Sin datos suficientes".
7. Ninguna prueba lee `capabilities.json`/`hero-positions.json` real (S9/S10) -- fixtures inline.
8. El espejo de `apps/web` se mueve **en el mismo cambio**: si el motor amplía `SignalId` y
   `apps/web` no, `tsc` de `apps/web` rompe. Es la funcionalidad, no un defecto a suavizar.

### 11.13.9 — Lo que 4.2 deja abierto (para 4.3)

- **Selector de intención en `apps/web` + transporte + validación de borde.** 4.3 pasa de "sólo
  QA manual" (§11.10) a "UI del selector + campo en el request de sugerencias y en el `hello` del
  WS + validación de borde contra los 4 literales + QA + calibración".
- **Decaimiento de `archetype_fit` a lo largo del draft** (§11.11) -- se mide primero en el QA de
  4.3; sólo si el sobre-empuje en picks tardíos es real se le agrega dependencia de `DraftState`.
- **Ajuste fino de `w = 0.10`** tras ver el resultado real del QA de 4.3. Es una perilla de
  producto, no un ancla.
- Los 3 héroes sin `capabilities.json` (`131`/`145`/`155`) y el bug de `team_synergy` que devuelve
  `raw: 0` en vez de `null` (§11.11) -- tickets propios, sin cambios, no bloquean 4.2.

### 11.13.10 — Entrada para `/rulebook`

**Un solo ticket** (4.2), `simplicity_exception: true`, `preferred_tool: claude-code` -- toca el
motor y el espejo `apps/web`, exige `@redteam`, y la trazabilidad de Q1-Q5 vive en `journal.md`.
No se parte en "re-tipar V4/V5" + "ampliar `SignalId`" + "espejo web": el re-tipado sin la
ampliación no compila como unidad entregable y partirlo triplica el bookkeeping sin bajar el
riesgo. Costuras: **S3** sobre **S9** (ya existentes). **Ninguna costura nueva.**

---

## 11.14 — Blueprint del sub-ticket 4.3 (`archetype_fit` usable: selector + transporte + QA)

Séptimo `/blueprint` de sub-ticket. Corrido en **Sonnet por decisión explícita del usuario
(2026-08-28)** -- misma desviación consciente de la política de modelos que §11.13, anotada en
`journal.md`. `/rulebook` en adelante, Sonnet.

### 11.14.0 — Alcance

4.2 (TSK-180) integró `archetype_fit` al motor pero **inerte**: sin `archetypeIntent`, la señal es
`applicable: false` y no hay forma de elegir una intención desde la app. 4.3 la hace **usable de
punta a punta**:

1. Selector de intención de draft en `apps/web` (4 arquetipos + "sin intención").
2. Transporte: mensaje WS `set_intent` + estado por sesión en `SessionStore`, **y** campo
   `archetypeIntent?` en `POST /api/suggestions/preview`.
3. Validación de borde de ese input (unión cerrada de 4 literales) -- cierra el hallazgo de
   `@redteam` de TSK-180 (un valor fuera de la unión daría `raw: NaN`).
4. Protocolo de QA manual para confirmar/ajustar el peso `w = 0.10`.

**Fuera de 4.3:** tocar `SCORING_WEIGHTS_V6` (ver §11.14.7 -- si el QA pide otro `w`, es un
follow-up que acuña `V7`), el decaimiento de la señal a lo largo del draft (§11.11, sigue
abierto), y persistir la intención más allá de la vida de la sesión en memoria.

### 11.14.1 — Qué de fases anteriores queda superado

| Antes | 4.3 lo cambia a |
|---|---|
| §C5 / `session.ts`: `SessionEntry` = `{ state, lastAccessedAt, ownerAccountId }` | + `archetypeIntent: DraftPathArchetype \| null` (default `null`), preservado entre `applyDraftEvent` igual que `ownerAccountId` |
| `edge.ts`: `ClientMessage.type` = `"hello" \| "ping"` | + `"set_intent"` |
| §C5 / `edge.ts` §"SuggestionsPreviewRequest": 8 campos | + `archetypeIntent?: DraftPathArchetype` (9º campo, opcional) |
| `app.ts`: `computeSuggestionsForState(state, accountId, options)` con `options` de 4 campos, y el push del camino en vivo (`hello` / cada draft-event) **no pasaba ninguno** | `options` gana `archetypeIntent?`; los caminos en vivo lo leen de `SessionStore` en cada recálculo |
| El push automático por WS es `draft_state` → `suggestions` | `set_intent` dispara **sólo** `suggestions` (el tablero no cambió) -- excepción explícita al orden de push, como ya lo es el cálculo de `draft_paths` |

Nada más se mueve. `applyDraftEvent` sigue puro, `SCORING_WEIGHTS_V6` intacta, ninguna señal
cambia de fórmula.

### 11.14.2 — Decisiones cerradas

| # | Pregunta | Decisión (usuario, 2026-08-28) |
|---|---|---|
| Q1 | ¿Cómo llega la intención al motor en el camino en vivo? | **Mensaje WS `set_intent` + estado en `SessionStore`.** Nuevo mensaje de cliente ligero; `SessionStore` gana `archetypeIntent` por sesión (mismo patrón que `ownerAccountId`). `computeSuggestionsForState` lo lee del store, así **todos** los caminos de recálculo (hello, cada draft-event, reconexión) lo respetan sin tocarlos uno por uno. No se agrega ruta HTTP nueva. |
| Q2 | ¿Dónde puede elegirse? | **También en `esperando_draft`**, además de `activo`/`degradado`. `archetype_fit` es la primera señal que discrimina con el tablero vacío -- fijar la dirección antes del pick #1 es el caso de uso central. Persiste al arrancar el draft. |
| Q3 | ¿4.3 retoca `w`? | **No.** El QA mide si `w = 0.10` es correcto; si no lo es, un follow-up acuña `SCORING_WEIGHTS_V7` con la misma estructura `× (1 − w)` (§11.14.7). 4.3 no abre `weights.ts`. |
| Q4 | ¿Persistencia de la intención? | Vive en `SessionStore` (memoria, TTL 45 min) -- sobrevive una reconexión del cliente mientras la sesión viva. El cliente además la re-envía tras cada `hello` (cinturón y tiradores: un reinicio del motor la pierde). No se persiste en SQLite. |

### 11.14.3 — Costuras: ninguna nueva

- El mensaje `set_intent` cae en **S5** (transporte WebSocket -- `FakeSocket` emitiendo/recibiendo
  `ClientMessage`/`ServerMessage` tipados). La prueba del store verifica que `setArchetypeIntent`
  manda el `set_intent` por el `FakeSocket`; nunca un WebSocket real.
- El handler del motor cae en el patrón de integración de `app.ts` ya existente (`SessionStore`
  real + `buildSuggestions` real + snapshot cacheado, cero red).
- La validación de borde (`isValidClientMessage` rama `set_intent`, `isValidSuggestionsPreviewRequest`
  campo nuevo) son funciones puras -- pruebas en `edge.test.ts`, mismo criterio que las que ya
  tiene.
- **`S13` sigue reservada** (RNG de diversificación, 4.6). 4.3 no la toca.
- El QA de calibración es un **protocolo manual** (§11.14.8), no una costura.

### 11.14.4 — Contratos de datos

**`server/session.ts`:**

```typescript
// mirror de draft-paths/types.ts -- import directo legítimo (mismo proceso), no espejo a mano
import type { DraftPathArchetype } from "../draft-paths/types";

interface SessionEntry {
  state: DraftState;
  lastAccessedAt: number;
  ownerAccountId: AccountId | null;
  archetypeIntent: DraftPathArchetype | null;   // NUEVO -- default null
}

// En SessionStore:
setArchetypeIntent(sessionId: string, intent: DraftPathArchetype | null): void; // no-op si no existe la sesión
archetypeIntent(sessionId: string): DraftPathArchetype | null;                  // null si no existe

// El merge de applyDraftEvent (hoy: `ownerAccountId: this.states.get(id)?.ownerAccountId ?? null`)
// gana `archetypeIntent: this.states.get(id)?.archetypeIntent ?? null` -- se preserva igual.

// ClientMessage: la unión gana el mensaje set_intent
export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping" | "set_intent";
  sessionId?: string;
  accountToken?: string;
  archetypeIntent?: DraftPathArchetype | null;   // sólo en set_intent
}
```

**`server/edge.ts`:**

```typescript
// isValidClientMessage: rama nueva -- input externo (JSON.parse -> any), se valida en el borde.
//   type === "set_intent"  =>  sessionId string no vacío  &&
//     archetypeIntent ∈ {"push","teamfight","pickoff","scaling", null}
// Un set_intent malformado se descarta en silencio (return), igual que cualquier ClientMessage
// inválido hoy (hallazgo de @redteam ronda 1, TSK-010).

export interface SuggestionsPreviewRequest {
  // …8 campos existentes…
  archetypeIntent?: DraftPathArchetype;   // 9º -- ausente => sin intención
}
// isValidSuggestionsPreviewRequest: si archetypeIntent !== undefined, debe ser uno de los 4
// literales; si no, el body es inválido -> 400 (mismo criterio que targetPosition).
```

**`server/app.ts`:**

```typescript
async function computeSuggestionsForState(
  state, accountId = null,
  options: { targetPosition?; usePersonalPool?; teamOpening?; diversitySeed?; archetypeIntent?: DraftPathArchetype } = {},
): Promise<SuggestionSet> { /* …pasa ...options a buildSuggestions, sin otro cambio… */ }
```

- **Camino en vivo** (`hello`, push tras cada `/ingest/draft-event`, reconexión): cada llamada a
  `computeSuggestionsForState` pasa `archetypeIntent: sessionStore.archetypeIntent(sessionId)`.
- **Handler `set_intent`**: sobre una sesión suscrita → `sessionStore.setArchetypeIntent(...)` →
  **si el valor cambió** recalcula `computeSuggestionsForState(state, owner, { archetypeIntent })`
  y publica `suggestions` (no `snapshot`, no `draft_state`). Si el valor es igual al almacenado,
  **no-op** -- ni recálculo ni push (guarda de idempotencia; evita que un cliente que reenvía
  fuerce recálculos).
- **`handleSuggestionsPreview`**: pasa `body.archetypeIntent` en `options`.
- **`computeV5Fallback`** (ruta `pro-drafter.ts`): no cambia -- ese camino no representa una
  sesión con intención elegida (mismo criterio que ya usa para no pasar `targetPosition`).

**`apps/web`:**

```typescript
// features/draft/types.ts -- mirror a mano de draft-paths/types.ts (frontera apps/engine ↔ apps/web)
export type DraftArchetype = "push" | "teamfight" | "pickoff" | "scaling";
// y el mirror de ClientMessage gana "set_intent" + archetypeIntent

// features/draft/store.ts (useDraftStore) -- estado + acción
archetypeIntent: DraftArchetype | null;                 // default null
setArchetypeIntent(intent: DraftArchetype | null): void; // (1) set local  (2) socket.send({type:"set_intent", sessionId, archetypeIntent: intent})
// connect(): tras el hello, si archetypeIntent !== null, re-enviar set_intent
```

- **`components/draft-intent-selector/DraftIntentSelector.tsx`** (nuevo): 4 chips
  (`Push`/`Teamfight`/`Pickoff`/`Scaling`) + affordance "Sin intención" para limpiar. Handlers
  nombrados, sin funciones anónimas inline, sin ternario para render condicional (`web.md`). Color
  por rol semántico (`--surface-*`/`--content-*`/`--accent-*`), escala de 4 px, `text-caption`.
  Etiquetas en `features/draft/constants.tsx` (`ARCHETYPE_LABELS`), mismo vocabulario que las
  `explanation` del motor ("tu draft de Push").
- **`DraftView.tsx`**: monta `<DraftIntentSelector>` en `WaitingForDraftState` (esperando_draft)
  y en `ActiveDraftState`/`DegradedDraftState` (cerca de `modeSelector`/`extraTopBar`).

### 11.14.5 — Estados y transiciones

| Trigger | Efecto |
|---|---|
| Usuario elige un arquetipo | store local ← arquetipo; socket envía `set_intent`; motor guarda en `SessionStore` y (si cambió) empuja `suggestions` con `archetype_fit` votando |
| Usuario limpia ("Sin intención") | `set_intent` con `archetypeIntent: null`; motor guarda `null` y empuja `suggestions` con `archetype_fit` de vuelta en `applicable: false` -- el top-3 vuelve al orden sin intención |
| Cada pick/ban aplicado | el push automático (`draft_state` → `suggestions`) ya recalcula leyendo la intención del store; sin cambios de código en ese punto salvo pasar el campo |
| Reconexión (`hello`) | el motor mantiene la intención en `SessionStore` (si la sesión vive); el cliente re-envía `set_intent` por si el motor se reinició |
| Sesión expira (TTL 45 min) / motor reinicia | la intención se pierde con la sesión -- una sesión nueva arranca en `null` |

### 11.14.6 — Seguridad (hereda §11.8 / §11.13.7; §5)

- **Nueva frontera de confianza, con mitigación obligatoria:** `archetypeIntent` ahora **sí llega
  desde el cliente** (mensaje WS `set_intent` y body de `/api/suggestions/preview`). Es input
  externo → se valida en el borde contra la unión cerrada de 4 literales (`isValidClientMessage`
  / `isValidSuggestionsPreviewRequest`) **antes** de tocar `SessionStore` o `buildSuggestions`. Un
  valor inválido: en WS se descarta el mensaje (sin cambiar la sesión, sin lanzar), en HTTP es
  `400`. Nunca llega un valor fuera de la unión a `archetypeFitBonus` -- **cierra el hallazgo #2
  de `@redteam` en TSK-180** (`ARCHETYPE_MAX_BONUS[intent]` undefined → `NaN`).
- **Sin ruta HTTP nueva** -- el WS reutiliza el socket ya autenticado; el único toque HTTP es un
  campo opcional en un endpoint existente.
- **Sin secreto nuevo, sin dato personal, sin escritura a SQLite** -- `SessionStore` es memoria.
- **DoS:** un `set_intent` cuyo valor es igual al almacenado es no-op (ni recálculo ni push). El
  WS del motor sigue atado a `127.0.0.1` y no expuesto a la red (Fase 5 no lo cambió), así que
  `set_intent` no es superficie nueva más allá de lo que `ping` ya es.
- **Cero red en el camino caliente, intacta.**

### 11.14.7 — Gobernanza del peso `w`

`SCORING_WEIGHTS_V6` (TSK-180) es la constante activa con `archetype_fit: 0.10`. 4.3 **no la
toca**. El QA de §11.14.8 mide si `0.10` es el valor correcto de producto:

- Si el resultado es bueno → V6 queda como está y se considera "pasada por QA".
- Si `archetype_fit` sobre- o sub-empuja → **follow-up ticket que acuña `SCORING_WEIGHTS_V7`**:
  mismos 5 pesos heredados = `V5 × (1 − w_new)`, `archetype_fit: w_new`. El candado de regresión
  cero (`mix.test.ts`) se re-corre con los números nuevos; la estructura `× (1 − w)` se conserva,
  así que V7-sin-intención sigue ≡ V5 al bit. V6 queda congelada por nombre igual que V1-V5.

### 11.14.8 — Protocolo de QA manual (parte del ticket)

Contra `bun run dev` o Railway, en la vista de draft (entrada manual), **no** contra el bot del
simulador (que no usa `buildSuggestions`, `engine.md`):

1. Draft vacío, elegir cada uno de los 4 arquetipos por turno. Anotar el top-3 y compararlo con el
   top-3 sin intención. Esperado: se inclina hacia la dimensión del arquetipo (push → daño a
   estructuras; pickoff → catch/initiation; etc.).
2. Con 2-3 picks propios que **ya cumplen** la intención + un candidato con hard counter real
   contra un rival revelado: confirmar que el counter (o la posición faltante) **sigue ganando** --
   `archetype_fit` no debe dar vuelta una ventaja táctica real (`position_fit` sigue siendo el
   mayor peso).
3. Limpiar la intención a mitad del draft → el top-3 vuelve exactamente al que daría sin intención.
4. Reconectar (recargar la página) con una intención puesta → sigue aplicada.
5. Juicio de producto: ¿`w = 0.10` mueve lo justo, o de más/de menos? Registrar la respuesta; si
   pide cambio, abrir el ticket de `V7` (§11.14.7).

### 11.14.9 — Criterios de aceptación

**Archivos (~10-12) -- `simplicity_exception: true`.** Motor: `server/session.ts`,
`server/edge.ts`, `server/app.ts` + `server/edge.test.ts` + `server/app.test.ts` (o
`session.test.ts`). `apps/web`: `features/draft/store.ts`, `features/draft/types.ts`,
`features/draft/constants.tsx`, `components/draft-intent-selector/DraftIntentSelector.tsx` (+
`.test.ts`), `features/draft/DraftView.tsx`.

1. `bunx tsc --noEmit` limpio en `apps/engine` y `apps/web`. **Sin intención puesta, la vista de
   draft en vivo devuelve exactamente las mismas `suggestions` que antes de 4.3** (candado de
   no-regresión, heredado de TSK-180 pero re-aseverado en el camino WS).
2. `set_intent` con un arquetipo válido → el motor empuja `suggestions` frescas donde
   `archetype_fit` vota y el top-3 se mueve. Probado contra el camino de `app.ts` (`SessionStore`
   real + `buildSuggestions` real), **no** la señal aislada.
3. `set_intent` con `archetypeIntent: null` → `archetype_fit` vuelve a `applicable: false`, el
   top-3 vuelve al orden sin intención.
4. `set_intent` malformado (`"carry"`, `123`, `{}`, sin `sessionId`) → mensaje descartado, la
   sesión no cambia, no lanza, no hay push. Prueba unitaria de `isValidClientMessage`.
5. `archetypeIntent` inválido en `SuggestionsPreviewRequest` → `400`. Prueba unitaria de
   `isValidSuggestionsPreviewRequest`.
6. Reconexión tras fijar la intención → sigue aplicada (server-side); el cliente re-envía
   `set_intent` tras el `hello` (prueba del store con `FakeSocket`).
7. `<DraftIntentSelector>` se renderiza en `esperando_draft` y en `activo`/`degradado`; elegir un
   chip llama `setArchetypeIntent` y manda el `set_intent` por el `FakeSocket`; el chip elegido
   muestra estado seleccionado; "Sin intención" limpia.
8. El selector usa color por rol semántico + escala de 4 px + tipografía por rol -- ni un hex/px
   suelto (`web.md`, `@redteam` pasada 1).
9. La 6ª fila de `SignalBreakdown` (TSK-180) muestra valor y `explanation` reales una vez puesta
   la intención.
10. QA manual de §11.14.8 corrido y registrado en `journal.md`; si pide otro `w`, ticket de `V7`
    abierto.

### 11.14.10 — Entrada para `/rulebook`

**Un solo ticket** (4.3), `simplicity_exception: true`, `preferred_tool: claude-code` -- toca el
motor (`server/`) y `apps/web` (transporte + componente nuevo), exige `@redteam` (nueva frontera
de confianza), y la trazabilidad de Q1-Q4 vive en `journal.md`. No se parte en "transporte motor" +
"UI" + "validación": el selector sin transporte no es entregable y la validación de borde es
inseparable del transporte. Costuras: **S5** (ya existente). **Ninguna nueva.** El QA de
calibración es un paso manual dentro del mismo ticket, no un ticket aparte -- salvo que dispare el
follow-up de `V7`.

---

# SPEC — Fase 5 (MVP de Producción: Auth & Personal Hero Pool multi-usuario)

Síntesis de `docs/agents/architecture.md` § Fase 5 (Bloques 1-6, `/pre-flight` completo, 2026-08-24).
**Quinta ejecución en Opus del proyecto**, delegada a un agente separado (mismo patrón que Fase 4).
No es una excepción nueva: el Bloque 4 de `/pre-flight` confirma **dos** gatillos objetivos ya
documentados en `CLAUDE.md` — *cambio de trust boundary* y *modificación de autenticación o
permisos*. De aquí en adelante, Sonnet otra vez.

Mismo estatuto que las fases anteriores: esto es contrato. Lo que no esté aquí, no es Fase 5.

## 12.0 — Alcance de este blueprint (leer primero)

- **§12.1 a §12.14 son contrato cerrado.** Números fijados, formatos byte a byte, DDL exacto.
- **§12.15 son correcciones a `architecture.md`**, todas por leer el código real (mismo estándar
  que §11.6 de Fase 4). Tres de ellas invalidan un mecanismo que el `/pre-flight` daba por bueno.
- **§12.16 son las preguntas que NO se deciden acá.** No son números por fijar: son decisiones de
  producto/infraestructura que exigen confirmación del usuario antes de `/rulebook`. Están
  marcadas con `PENDIENTE DE CONFIRMACIÓN` y ninguna se resolvió en silencio.
- Lo que Fase 5 **no** es (Bloque 1, sin cambios): no toca la captura del draft en vivo, no cambia
  ninguna señal del motor más allá de scopearla por cuenta, no hay roles/permisos/admin, no
  extiende el hero pool de compañeros (Fase 2) a cuentas de Steam reales, no hay perfil social.

---

## 12.1 — Qué de fases anteriores queda superado

Todo lo demás sigue vigente. Solo estas siete cosas se mueven:

| Fase anterior decía | Fase 5 lo cambia a |
|---|---|
| §9.4: `hero_pool` con PK simple `hero_id` | PK compuesta `(account_id, hero_id)` + FK a `accounts` (§12.7) |
| §9.4: `steam_account_id` y `personal_baseline_winrate` viven como claves de `settings` | Columnas de `accounts`. Las dos claves de `settings` se migran y se borran (§12.7) |
| §9.5: `POST /api/hero-pool/calculate` recibe `{ accountId }` en el cuerpo | El `accountId` **nunca** llega por el cuerpo: sale del token verificado (§12.10). El campo se elimina del contrato |
| §9.5 (nota de deriva): `GET`/`PUT /api/settings` quedan registrados como API real | **Se retiran** — un KV global escribible por cualquier cliente no sobrevive a multi-usuario (§12.10, P7) |
| §C4/§9.4: `buildMetaSnapshot(db)` | `buildMetaSnapshot(db, accountId)`, con el cache partido en dos capas (§12.8) |
| §C5/`web.md`: el acceso al sitio es Basic Auth compartido (`proxy.ts`) | Login de Steam, única puerta. `proxy.ts` pierde el Basic Auth por completo (§12.11) |
| §5: "el perímetro real es el binding a `127.0.0.1`" | Sigue siendo cierto **y ya no alcanza**: dentro de ese perímetro ahora conviven varias personas. Se suma el token interno por cuenta (§12.6) |

**Lo que NO se toca, y es deliberado**: `SCORING_WEIGHTS_V5` sigue siendo la activa, ninguna señal
cambia de fórmula, `SignalId` no se amplía, `applyDraftEvent` sigue siendo puro, el orden de push
`draft_state` → `suggestions` no cambia, y `POST /ingest/draft-event` sigue autenticándose con
`x-capture-token` (es otro contrato, con otro actor — el capturador no es una persona logueada).

---

## 12.2 — Decisiones cerradas

| # | Decisión | Razón |
|---|---|---|
| P1 | **PK de `accounts` = el propio Steam32 (`steam_account_id`, integer), sin id sustituto.** | Es único, inmutable y ya es la clave natural que el proyecto usa en todos lados (`isValidSteamAccountId`, la URL de OpenDota, el `settings` de hoy). Un id sustituto obligaría a un join para resolver identidad en cada request y a decidir *cuál* de los dos ids viaja firmado en el token. Cero beneficio, dos formas de nombrar a la misma persona. |
| P2 | **`personal_baseline_winrate` pasa a columna de `accounts`. No se crea `account_settings`.** | Es un valor por cuenta, nullable, sin historial. Una tabla aparte para una columna es ceremonia. Precedente propio: `team_groups` guarda sus campos en su fila, no en un KV lateral. |
| P3 | **`settings` (tabla) sobrevive vacía; `GET`/`PUT /api/settings` se retiran.** | La tabla no se dropea (migración destructiva sin beneficio). Su API sí: es un KV global sin dueño, de escritura libre — en multi-usuario, cualquiera podría leer el Steam32 ajeno o pisar configuración de instancia. Reemplazada por `GET /api/account`, scopeada (§12.10). |
| P4 | **Steam OpenID implementado a mano, sin Passport ni wrapper.** | Confirmado en `/pre-flight` Bloque 2: la librería más popular tiene un bypass de firma documentado. El protocolo real son dos cosas: construir una URL y hacer un POST de verificación. Mismo principio que ya llevó a curar `hero-positions.json` a mano en Fase 3. |
| P5 | **`iron-session` es la única dependencia de producción nueva** (en `apps/web`). | Confirmada contra la doc oficial del Next.js instalado (`01-app/02-guides/authentication.md`, línea 526: recomienda `iron-session` o `jose`). Pasa por `/gear-up`/`@depcheck` y se marca `// ALLOWED`, como cualquier `dependency`. |
| P6 | **El token interno se acuña en `proxy.ts` y viaja como header inyectado al destino del rewrite** — no en `fetchBaseQuery`. | **Corrección forzada por el código real** (§12.15-A): el navegador no puede firmar (no tiene el secreto) ni leer la cookie `httpOnly`. `proxy.ts` corre en runtime Node en Next 16 y su `NextResponse.next({ request: { headers } })` alcanza los destinos de `rewrites` (verificado en la doc del binario instalado). |
| P7 | **Ventana del token: 60 s. Anti-replay: nonce de un solo uso**, no solo timestamp. | Con acuñado por request, la latencia entre firma y verificación es de milisegundos: 60 s ya es holgado. Solo-timestamp dejaría un token capturado reutilizable durante toda la ventana; el criterio 6 del Bloque 6 exige probar replay, no solo firma inválida. |
| P8 | **Cookie de sesión: 30 días de TTL, con renovación deslizante a partir de los 7 días de antigüedad y tope absoluto de 90 días.** | Quedarse sin sesión en mitad de un draft es un costo de producto real; re-loguear obliga a rebotar por Steam. La renovación es gratis (`proxy.ts` ya desencripta la sesión en cada request). El tope absoluto de 90 días evita la sesión eterna. |
| P9 | **El MVP no guarda nada del perfil público de Steam** (nombre, avatar). | Traerlos exige la Steam Web API, que **sí** requiere una API key propia — un secreto nuevo que el Bloque 4 no contempló, más dato personal de terceros. La UI identifica al usuario por su propio Steam32, que ya ve hoy. |
| P10 | **Conversión SteamID64 → Steam32 obligatoriamente con `BigInt`.** | **No es una preferencia de estilo**: `76561197960265728 > Number.MAX_SAFE_INTEGER`. Verificado ejecutándolo (§12.15-C): la resta con `Number` devuelve un Steam32 **equivocado y silencioso**, que mapearía a la cuenta de otra persona. |
| P11 | **El motor tiene dos modos: `multi_tenant` (con `INTERNAL_AUTH_SECRET`) y `single_tenant_local` (sin él).** | Regresión cero para `bun run dev` y para el motor local del usuario, que hoy no manda ningún token. El fail-open queda acotado exactamente igual que el precedente de `proxy.ts`: un guard fail-closed en `scripts/start-railway.sh` hace imposible arrancar el contenedor de producción sin el secreto (§12.12). |
| P12 | **En `single_tenant_local`, la cuenta activa es la única fila de `accounts`** — con 0 o ≥2 filas, no hay cuenta (`accountId: null`). | Determinista, sin inventar una cuenta centinela ni una variable de entorno nueva. Con `null`, `hero_pool_fit` cae en `applicable: false`, que es un camino ya especificado (§9.3) y con candado de regresión propio. |
| P13 | **Una sesión de draft tiene un dueño (`ownerAccountId`), fijado por el primer `hello` autenticado.** | `pushSessionUpdate` publica a un topic compartido: sin dueño único, dos cuentas suscritas al mismo `sessionId` recibirían las sugerencias personalizadas de la otra. Un `hello` de otra cuenta sobre una sesión con dueño se rechaza. |
| P14 | **`POST /api/suggestions/preview` y `/api/v1/draft/pro-recommendations` computan siempre con `accountId: null`.** | Son el cerebro del **bot rival** del simulador. Hoy usan el `MetaSnapshot` global y por lo tanto el hero pool del usuario local: el bot juega, sin que nadie lo decidiera, con la comodidad del humano que tiene enfrente. En multi-usuario no existe una cuenta defendible que usar ahí, así que se fija `null` explícito. |
| P15 | **El cache de `MetaSnapshot` se parte en dos: compartido (héroes/matchups/patchStats) + overlay por cuenta (pool + baseline).** | **Corrección de dimensionamiento** al `Map<accountId, MetaSnapshot>` del Bloque 3 (§12.15-D). Medido contra la base real: 14 850 filas de `hero_matchups` + 2 032 de `hero_patch_stats` son idénticas para todos; lo que varía por cuenta son **5 filas y un número**. |

---

## 12.3 — Costuras nuevas (antes que el comportamiento)

Dos costuras nuevas. **Se saltea el número `S12` a propósito**: §11.10 ya lo reservó por nombre
para el RNG inyectable de la pieza 4 de Fase 4, y una costura reservada por escrito no se
reutiliza para otra cosa.

| Costura | Frontera | Qué es real en la prueba | Qué se reemplaza |
|---|---|---|---|
| **S11 — Identidad verificada de Steam (OpenID 2.0)** | navegador / Steam → `apps/web` | La construcción de la URL de login, el parseo y validación de los `openid.*` de vuelta, la lectura de la respuesta de `check_authentication`, la conversión SteamID64→Steam32 y la decisión de crear o no la sesión — todo como **funciones puras** | El `fetch` a `steamcommunity.com`: respuestas de `check_authentication` **grabadas en fixtures** (`is_valid:true` y `is_valid:false`, byte a byte). **Cero red en las pruebas**, mismo criterio que S6/S7 |
| **S13 — Token interno de cuenta (`x-account-token`)** | `apps/web` → `apps/engine` (HTTP **y** WebSocket) | El acuñado y la verificación completos: formato, firma HMAC, ventana de validez, rechazo por replay. Función pura salvo el store de nonces, que es una `Map` en memoria del proceso | **Nada externo**: el reloj y el generador de nonce se **inyectan como parámetros**, igual que `applyDraftEvent` (S4) ya hace con `now`/ids. Una prueba de expiración que dependa de `Date.now()` real es rechazo automático de revisión |

**S8 (persistencia del pool) no se reemplaza: se extiende** con la dimensión de cuenta. Sus
pruebas siguen corriendo contra una SQLite en memoria, y ganan el caso que hoy no existe: *dos
cuentas, dos pools, ninguna ve la otra*.

**Reglas derivadas:**

- Ninguna prueba de S11 hace una llamada real a Steam. Un test que dependa de que
  `steamcommunity.com` esté arriba es rechazo automático (misma razón literal que S6).
- Ninguna prueba de S13 usa el reloj real ni un nonce aleatorio real. Sin inyección no hay forma
  de probar "token vencido hace 1 ms" ni "el mismo nonce dos veces" de forma reproducible.
- **El vector de prueba de §12.6 es obligatorio en los dos lados** (`apps/web` y `apps/engine`).
  Es el único mecanismo que tiene el proyecto para detectar que el espejo a mano se desincronizó:
  los dos procesos no comparten código, así que no hay tipo ni import que lo garantice.
- La prueba de aislamiento entre cuentas (§12.14, criterio 2) corre **contra `buildSuggestions`
  completo**, no contra la query aislada — mismo criterio que §10.9 criterio 7: la query puede
  filtrar bien y el pipeline seguir sirviendo un snapshot cacheado de otra cuenta.

---

## 12.4 — Autenticación con Steam (OpenID 2.0)

Todo esto vive en `apps/web`. **`apps/engine` nunca ve el flujo de OpenID** y sigue atado a
`127.0.0.1` sin excepción.

### Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/login` | Página pública. Un botón, cero formularios, cero contraseñas propias |
| `GET` | `/api/auth/steam/login` | Genera el nonce de login, lo deja en cookie, y responde `302` hacia Steam |
| `GET` | `/api/auth/steam/callback` | Punto de retorno de Steam. Verifica, crea la cuenta si hace falta, abre la sesión |
| `POST` | `/api/auth/logout` | Destruye la sesión y redirige a `/login` |
| `GET` | `/api/auth/engine-token` | Acuña un token de cuenta para que el **navegador** lo mande en el `hello` del WebSocket (§12.9). Exige sesión válida |

### Redirección a Steam (`/api/auth/steam/login`)

`https://steamcommunity.com/openid/login` con exactamente estos parámetros:

```
openid.ns          = http://specs.openid.net/auth/2.0
openid.mode        = checkid_setup
openid.return_to   = {PUBLIC_BASE_URL}/api/auth/steam/callback?state={nonce}
openid.realm       = {PUBLIC_BASE_URL}
openid.identity    = http://specs.openid.net/auth/2.0/identifier_select
openid.claimed_id  = http://specs.openid.net/auth/2.0/identifier_select
```

- `PUBLIC_BASE_URL` es **variable de entorno obligatoria**, no se deriva de las cabeceras del
  request. Motivo duro, no estético: `return_to` tiene que ser **byte a byte idéntico** entre la
  ida y el `check_authentication` de vuelta, y detrás del proxy de Railway el origin reconstruido
  desde el request no es confiable (`x-forwarded-proto`/`host`).
- `nonce`: 32 caracteres hex (16 bytes de `crypto.getRandomValues`). Se guarda además en la cookie
  `d2k_login_nonce` (`httpOnly`, `sameSite: lax`, `maxAge` 600 s). Cierra el *login CSRF*: sin esto,
  un tercero puede forzar a una víctima a quedar logueada en **la cuenta del atacante** y verle
  escribir su hero pool ahí.

### Callback (`/api/auth/steam/callback`) — orden estricto, sin atajos

1. `openid.mode === "cancel"` → redirige a `/login` con un mensaje en llano. **No es un error.**
2. `openid.mode` debe ser exactamente `id_res`. Cualquier otro valor → `400`, sin sesión.
3. `state` del query debe coincidir con la cookie `d2k_login_nonce` (comparación de igualdad
   simple; no es un secreto de larga vida). No coincide o falta → `400`. La cookie se borra
   siempre, coincida o no.
4. `openid.claimed_id` **y** `openid.identity` deben cumplir
   `^https://steamcommunity\.com/openid/id/([0-9]{17})$` — anclado a los dos extremos, host en
   lista permitida, exactamente el mismo principio que ya rige `img_url` del CDN de Valve
   (`web.md`). Nunca se hace `split("/").pop()` sobre una URL arbitraria.
5. `openid.return_to` recibido debe ser igual al que se construyó en el paso de ida (incluido el
   `state`). Distinto → `400`.
6. **`check_authentication` — obligatorio, sin excepción.** `POST` a
   `https://steamcommunity.com/openid/login`, `content-type: application/x-www-form-urlencoded`,
   con **todos** los parámetros `openid.*` recibidos tal cual (incluidos `openid.sig`,
   `openid.signed`, `openid.assoc_handle`, `openid.response_nonce`) y `openid.mode` reemplazado por
   `check_authentication`. La respuesta es texto de líneas `clave:valor`; **solo** se acepta si
   contiene la línea exacta `is_valid:true`. Timeout **5 s** (`AbortSignal.timeout`), **sin
   reintentos** (a diferencia de OpenDota: acá el usuario reintenta con un click, y reintentar
   automáticamente una verificación de identidad no aporta nada). Fallo de red, timeout, `is_valid:false`
   o cuerpo inesperado → `401`, **sin sesión**, mensaje en llano.
7. `steamId32 = Number(BigInt(steamId64) - 76561197960265728n)`. **`BigInt` es obligatorio** (P10,
   §12.15-C).
8. El `steamId32` resultante se valida como Steam32 (solo dígitos, `1`–`4294967295`) — el mismo
   contrato de 1b, aplicado a un dato que ahora llega de otra fuente. Fuera de rango → `401`.
9. `POST {ENGINE_INTERNAL_URL}/api/account` con el header `x-account-token` recién acuñado para esa
   cuenta (§12.6). El motor hace el `INSERT ... ON CONFLICT DO NOTHING` y devuelve la fila. Es una
   llamada de servidor a servidor, directa, sin pasar por el rewrite `/engine/*` — mismo patrón que
   ya usa `app/healthz/route.ts`.
10. Se abre la sesión (§12.5) y se redirige a `/`.

**Nada de lo anterior puede saltarse el paso 6.** Un callback que crea sesión leyendo
`openid.claimed_id` sin verificar es exactamente la vulnerabilidad documentada de `passport-steam`
(Bloque 2) y es **rechazo automático de `@redteam`**, no un hallazgo ponderable.

---

## 12.5 — Sesión en `apps/web` (`iron-session`)

```ts
// apps/web/lib/session.ts
export interface SessionData {
  accountId: number;     // Steam32 verificado. Nada más: ni SteamID64, ni nombre, ni avatar.
  issuedAt: number;      // ms epoch — base de la renovación deslizante
  firstLoginAt: number;  // ms epoch — base del tope absoluto
}

export const sessionOptions = {
  password: process.env.SESSION_SECRET,      // ≥32 caracteres, solo entorno
  cookieName: "d2k_session",
  ttl: 60 * 60 * 24 * 30,                    // 30 días (P8)
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};
```

| Parámetro | Valor | Por qué |
|---|---|---|
| Nombre de cookie | `d2k_session` | Corto, sin dato personal en el propio nombre |
| TTL | **30 días** | P8 |
| Renovación | **Deslizante**, cuando `now - issuedAt > 7 días`: se reescribe la cookie con `issuedAt` nuevo. Se hace en `proxy.ts`, que ya desencripta la sesión en cada request | Evita un `Set-Cookie` por request y a la vez evita la expiración sorpresa |
| Tope absoluto | **90 días** desde `firstLoginAt`. Superado: la sesión se destruye y se redirige a `/login`, aunque el usuario haya estado activo | Ninguna sesión eterna |
| `sameSite` | `lax` | El retorno de Steam es una navegación *top-level* cross-site; `strict` es fricción sin beneficio acá |
| `secure` | `true` en producción | Railway sirve HTTPS. En `bun run dev` (http://localhost) tiene que ser `false` o la cookie nunca se setea |
| Contenido | **Solo** los 3 campos de arriba | Todo lo demás se lee de SQLite vía el motor, con el `accountId` verificado |

**La cookie nunca se reenvía a `apps/engine`.** El motor no conoce el formato de sesión de
`apps/web` ni comparte su clave de cifrado — esa era la opción (a) del Bloque 2 y se descarta por
acoplamiento, igual que ahí.

---

## 12.6 — Token interno de cuenta (`x-account-token`)

La frontera de confianza #2 y #3 del Bloque 4 son la misma frontera con dos transportes, así que
tienen **un solo formato**.

### Formato, byte a byte

```
payload = "{accountId}.{issuedAtMs}.{nonce}"
firma   = hex( HMAC_SHA256( INTERNAL_AUTH_SECRET, "d2k-account-token/v1|" + payload ) )
token   = "{payload}.{firma}"
```

| Campo | Forma exacta | Nota |
|---|---|---|
| `accountId` | 1–10 dígitos decimales, `1`–`4294967295` | El Steam32 verificado |
| `issuedAtMs` | 13 dígitos decimales (ms epoch) | Lo estampa quien acuña, nunca el cliente |
| `nonce` | 32 caracteres `[0-9a-f]` (16 bytes) | `crypto.getRandomValues`, uno por token |
| `firma` | 64 caracteres `[0-9a-f]` | HMAC-SHA256 en hex |

El prefijo `d2k-account-token/v1|` es **separación de dominio**: garantiza que el mismo secreto
nunca pueda usarse para forjar otro tipo de mensaje si algún día se firma algo más.
Regex de forma, previa a todo lo demás:
`^[0-9]{1,10}\.[0-9]{13}\.[0-9a-f]{32}\.[0-9a-f]{64}$`.

**Vector de prueba obligatorio** (calculado ejecutando la fórmula real, no inventado — obligatorio
en el test de los dos procesos, §12.3):

| Entrada | Valor |
|---|---|
| clave HMAC del vector (32 chars, existe solo dentro del test) | `d2k-test-vector-key-0123456789ab` |
| `accountId` | `123456789` |
| `issuedAtMs` | `1787500000000` |
| `nonce` | `0123456789abcdef0123456789abcdef` |
| **firma esperada** | `033834d055eb3497adbe0188a53b636815f15e9f7e6836b0e66e9228a7f0be98` |

### Verificación en `apps/engine` — orden estricto

1. **Forma** (la regex de arriba). Antes que nada: `timingSafeEqual` lanza `RangeError` si los
   buffers tienen largos distintos, así que comparar sin validar forma primero convierte un token
   basura en una excepción, no en un `401`.
2. **Firma**, con `timingSafeEqual` sobre los dos buffers de 32 bytes. Nunca `===`.
3. **Ventana**: `issuedAt ∈ [now - 60_000, now + 5_000]`. Los +5 s son tolerancia de reloj; en
   producción los dos procesos comparten contenedor y el desfase real es ~0.
4. **Rango de `accountId`** (`1`–`4294967295`).
5. **Nonce**: si ya está en el store → rechazo por replay. Si no, se registra con vencimiento
   `issuedAt + 60_000`.

**El orden 2 → 5 no es negociable**: tocar el store de nonces antes de verificar la firma deja que
cualquiera llene memoria del motor sin autenticarse.

### Store de nonces

`Map<string, number>` (nonce → vencimiento) en memoria del proceso. Evicción **oportunista**, igual
que `SessionStore.evictStale()` y `cleanupSimulatorSessions()` — sin scheduler propio: en cada
inserción, si `size > 5000`, se barren los vencidos. Cota real: los tokens viven 60 s, así que a 20
req/s el store no pasa de ~1200 entradas. Un reinicio del motor vacía el store; la consecuencia es
que un token de ≤60 s podría reusarse justo después de un reinicio — aceptado y anotado, misma
naturaleza que perder las sesiones de draft en memoria al reiniciar.

### Los dos modos del motor (P11)

| Modo | Condición | Comportamiento |
|---|---|---|
| `multi_tenant` | `INTERNAL_AUTH_SECRET` presente | Toda ruta de cuenta exige token válido. WS: `hello` sin token válido se rechaza |
| `single_tenant_local` | `INTERNAL_AUTH_SECRET` ausente | El token se ignora. `accountId` = la única fila de `accounts`, o `null` con 0 o ≥2 filas (P12) |

El modo se decide **una vez al arrancar**, se imprime en el log de arranque (sin el secreto, obvio)
y se expone como `authMode` en `GET /api/health`. `scripts/start-railway.sh` **falla al arrancar**
si falta `INTERNAL_AUTH_SECRET` o `SESSION_SECRET` — mismo guard fail-closed que hoy protege
`SITE_ACCESS_*`, que es exactamente el hallazgo que Sentinel bloqueó en el primer `/castoff`.

### Espejo a mano, el tercero del proyecto

`apps/web/lib/account-token.ts` (acuña) y `apps/engine/src/server/account-token.ts` (verifica) son
**un espejo a mano**, no código compartido — los dos procesos son independientes a propósito y
`apps/web` nunca importa de `apps/engine`. Se suma a los dos ya documentados (`SignalId` en
`features/draft/types.ts`, `web.md`; `MetaSnapshot` angosto en `bot-drafter.ts`, `engine.md`). Un
cambio de formato toca **los dos archivos y los dos tests en el mismo cambio**. El vector de prueba
de arriba es el candado.

Lo mismo aplica a la validación de Steam32: `apps/web` necesita la suya (paso 8 de §12.4) y no
puede importar `isValidSteamAccountId` del motor. Cuarto espejo, mismo régimen.

---

## 12.7 — Esquema y migración (Drizzle)

### Tabla nueva `accounts`

| Columna | Tipo | Nota |
|---|---|---|
| `steam_account_id` | `integer PRIMARY KEY NOT NULL` | Steam32 (P1). SQLite guarda enteros de 64 bits: `4294967295` entra sin problema |
| `personal_baseline_winrate` | `real`, nullable | Migrado desde `settings` (P2). `null` = nunca calculado, mismo significado que hoy |
| `created_at` | `text NOT NULL` | ISO-8601 |

**No lleva `last_login_at`.** Es dato de comportamiento sin ningún consumidor en esta fase;
agregarlo sería funcionalidad no pedida.

```ts
export const accounts = sqliteTable("accounts", {
  steamAccountId: integer("steam_account_id").primaryKey(),
  personalBaselineWinrate: real("personal_baseline_winrate"),
  createdAt: text("created_at").notNull(),
});
```

### `hero_pool` con PK compuesta

```ts
export const heroPool = sqliteTable(
  "hero_pool",
  {
    accountId: integer("account_id").notNull().references(() => accounts.steamAccountId),
    heroId: integer("hero_id").notNull().references(() => heroes.id),
    source: text("source").notNull().$type<"manual" | "calculated">(),
    personalWinrate: real("personal_winrate"),
    personalGames: integer("personal_games").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.heroId] })],
);
```

> **`PRAGMA foreign_keys` está apagado** en este proyecto (`db/client.ts` solo activa WAL). Las FK
> son documentación del modelo, **no** una defensa en runtime. El aislamiento entre cuentas lo da
> exclusivamente el `WHERE account_id = ?` de cada query, y por eso las pruebas de §12.14 son sobre
> el comportamiento observable, no sobre la constraint.

### Migración `0005_accounts.sql` — crear y llenar

```sql
CREATE TABLE IF NOT EXISTS `accounts` (
	`steam_account_id` integer PRIMARY KEY NOT NULL,
	`personal_baseline_winrate` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`steam_account_id`, `personal_baseline_winrate`, `created_at`)
SELECT CAST(s.`value` AS INTEGER),
       (SELECT CAST(b.`value` AS REAL) FROM `settings` b WHERE b.`key` = 'personal_baseline_winrate'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `settings` s
WHERE s.`key` = 'steam_account_id'
  AND s.`value` GLOB '[0-9]*'
  AND s.`value` NOT GLOB '*[^0-9]*'
  AND CAST(s.`value` AS INTEGER) BETWEEN 1 AND 4294967295;
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('steam_account_id', 'personal_baseline_winrate');
```

- Los dos `GLOB` juntos son "solo dígitos": `GLOB '[0-9]*'` sin el segundo dejaría pasar `1abc`.
  Es el mismo contrato de `isValidSteamAccountId`, escrito en SQL porque acá no hay TypeScript.
- Si la clave no existe o está corrupta, `accounts` queda vacía y la migración **no falla** — un
  checkout limpio nunca tuvo esa fila.
- `strftime('%Y-%m-%dT%H:%M:%fZ','now')` produce ISO-8601 con milisegundos, el mismo formato que
  usa todo el resto del proyecto (`new Date().toISOString()`).

### Migración `0006_hero_pool_account.sql` — recrear con PK compuesta

SQLite no puede cambiar una PK con `ALTER TABLE`; es el patrón estándar tabla-nueva/copiar/drop/rename.

```sql
CREATE TABLE `hero_pool_new` (
	`account_id` integer NOT NULL,
	`hero_id` integer NOT NULL,
	`source` text NOT NULL,
	`personal_winrate` real,
	`personal_games` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `hero_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`steam_account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `hero_pool_new` (`account_id`, `hero_id`, `source`, `personal_winrate`, `personal_games`, `updated_at`)
SELECT (SELECT `steam_account_id` FROM `accounts` LIMIT 1),
       `hero_id`, `source`, `personal_winrate`, `personal_games`, `updated_at`
FROM `hero_pool`
WHERE (SELECT COUNT(*) FROM `accounts`) = 1;
--> statement-breakpoint
DROP TABLE `hero_pool`;
--> statement-breakpoint
ALTER TABLE `hero_pool_new` RENAME TO `hero_pool`;
```

El `WHERE (SELECT COUNT(*) FROM accounts) = 1` es el corazón de la seguridad de esta migración:

- **1 cuenta** (el caso real de producción hoy): las filas del pool se le asignan a ella. Es el
  criterio 3 del Bloque 6.
- **0 cuentas** (checkout limpio, o instancia sin `steam_account_id` guardado): las filas del pool
  quedarían huérfanas, así que **no se copian**. En un checkout limpio el pool está vacío de todas
  formas; si no lo estuviera, adivinar un dueño sería peor que perderlo.
- **≥2 cuentas**: imposible hoy, pero si pasara no se adivina. No se copia nada.

**`_journal.json` se actualiza a mano** con las dos entradas nuevas (`idx` 5 y 6), exactamente como
ya se hizo con `0004_vs_hero_idx` — que también es una migración escrita a mano, con `when`
fijado a mano. No es un atajo: es el precedente del proyecto.

### `team_groups` con scoping por cuenta (confirmado, §12.16-2)

A diferencia de `hero_pool`, **no hace falta cirugía de PK**: `team_groups` ya tiene un `id`
autoincremental propio (`schema.ts:73-78`) — el scoping es una columna nueva, no un cambio de
clave primaria. `team_members` no gana columna propia: hereda el scope de forma transitiva vía su
`teamGroupId` existente (`schema.ts:80-89`), evitando duplicar `accountId` en dos tablas para el
mismo dato.

```ts
export const teamGroups = sqliteTable("team_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").references(() => accounts.steamAccountId), // NUEVO
  name: text("name").notNull(),
  partySize: integer("party_size").notNull().$type<1 | 2 | 3 | 5>(),
  updatedAt: text("updated_at").notNull(),
});
```

**Nullable, no `.notNull()` a nivel de columna** — mismo criterio ya establecido para `hero_pool`
(`PRAGMA foreign_keys` apagado, §12.7): la FK es documentación, el aislamiento real lo da el
`WHERE account_id = ?` de cada query. Un `NOT NULL` real exigiría el mismo patrón de tabla-nueva/
copiar/drop/rename que `0006`, que acá es esfuerzo sin beneficio — toda fila creada después de este
ticket pasa por `createTeamGroup`, que a partir de acá exige token válido (§12.10) y siempre escribe
un `accountId` real; ninguna fila nueva puede quedar huérfana.

### Migración `0007_team_groups_account.sql` — agregar columna y hacer backfill

```sql
ALTER TABLE `team_groups` ADD COLUMN `account_id` integer REFERENCES `accounts`(`steam_account_id`);
--> statement-breakpoint
UPDATE `team_groups`
SET `account_id` = (SELECT `steam_account_id` FROM `accounts` LIMIT 1)
WHERE (SELECT COUNT(*) FROM `accounts`) = 1;
```

Mismo criterio exacto que `0006` para 0/1/≥2 cuentas: con una sola cuenta real (el caso de
producción hoy), todos los equipos guardados se le asignan; con cero o más de una, no se adivina y
la fila queda con `account_id NULL` — indistinguible de un checkout limpio, nunca un dato falso.
`_journal.json` gana la entrada `idx: 7`, mismo patrón manual que `0004`/`0005`/`0006`.

### `queries.ts` y `routes/team-groups.ts` — scoping en las 5 funciones

`getTeamGroups(db)` → `getTeamGroups(db, accountId)`, con `WHERE account_id = ?`. `getTeamGroup`/
`replaceTeamGroup`/`deleteTeamGroup` (que hoy reciben un `id` de fila) pasan a recibir también
`accountId` y verifican que la fila encontrada pertenezca a esa cuenta **antes** de devolver/
modificar/borrar — un `id` válido de otra cuenta responde `404`, nunca `403` (no confirma que el
recurso existe, mismo principio que ya usa el resto de la API para no filtrar existencia entre
cuentas). `createTeamGroup` exige `accountId` como campo obligatorio de la fila a insertar, nunca
opcional. Las rutas HTTP (`server/routes/team-groups.ts`) ganan `requireAccount` (el mismo helper
del ticket 5 de §12.17) delante de las 5 operaciones — `/api/team-groups` pasa de "sin auth" a
exigir `x-account-token`, cerrando tanto el acceso anónimo (ya cerrado por la medida interina) como
la fuga entre cuentas logueadas (lo que quedaba abierto hasta este ticket).

### Estrategia de despliegue, paso a paso

Esto **no** es "correr `db:migrate` y ver qué pasa". Orden obligatorio, dentro de `/castoff`:

1. **Antes de desplegar**: copia de respaldo del archivo SQLite de producción (`ENGINE_DB_PATH`),
   fuera del contenedor. Sin respaldo, no se despliega.
2. **Antes de desplegar**: verificación de solo lectura contra la base real de producción —
   ¿existe la fila `settings.steam_account_id`? ¿cuántas filas tiene `hero_pool`? ¿cuántas filas
   tiene `team_groups`? Los tres números se anotan. **No se escriben en `journal.md` ni en el
   ticket el valor del `steam_account_id`** (regla de 1b, sigue vigente y ahora vale para todas las
   cuentas).
3. Si la fila **no existe** pero `hero_pool`/`team_groups` tiene filas: **parar**. Esa combinación
   significa que el pool o los equipos guardados de producción se perderían. Se resuelve insertando
   la fila de `settings` a mano antes de migrar, no relajando la migración.
4. Desplegar. `scripts/start-railway.sh` ya corre `bun run db:migrate` antes de levantar el motor —
   corre `0005`, `0006` y `0007` en ese orden, dentro de la misma pasada.
5. **Después de desplegar**: verificar que `accounts` tiene 1 fila, que `hero_pool` conserva
   exactamente la misma cantidad de filas que en el paso 2 (todas con ese `account_id`), y que
   `team_groups` conserva su misma cantidad de filas con `account_id` no nulo.

---

## 12.8 — Motor multi-cuenta: `buildMetaSnapshot` y el cache partido

### Firma real de hoy

```ts
// apps/engine/src/meta/provider.ts (actual)
export async function buildMetaSnapshot<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
): Promise<MetaSnapshot>
```

### Firma de Fase 5

```ts
export type AccountId = number; // Steam32

export async function buildMetaSnapshot<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  accountId: AccountId | null,
): Promise<MetaSnapshot>

export async function getCachedMetaSnapshot<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  accountId: AccountId | null,
): Promise<MetaSnapshot>

export function invalidateMetaSnapshotCache(): void;              // sin cambio de firma
export function invalidateAccountMetaCache(accountId: AccountId): void;   // nueva
```

**`accountId` es obligatorio, no opcional con default.** Un `accountId?` con default `null` haría
que cualquier llamador nuevo que se olvide de pasarlo obtenga silenciosamente "sin pool" — un bug
invisible exactamente del tipo que ya costó una fase entera (`hero_pool_fit` inerte desde 1b hasta
TSK-064). Que rompa la compilación es la funcionalidad.

`accountId: null` significa **"no hay cuenta en contexto"** y produce `heroPool: []` +
`personalBaselineWinrate: null` → `hero_pool_fit` devuelve `applicable: false`. Es un camino ya
especificado (§9.3) y con candado de regresión propio; **no es `raw: null`** y no baja la confianza.

### El cache, partido en dos (P15)

```ts
// Capa 1 — compartida: idéntica para todas las cuentas. Una sola en memoria, como hoy.
//   heroes (127 filas) + hero_matchups (14 850) + hero_patch_stats (2 032)  [medido, base real]
let sharedSnapshot: SharedMetaSnapshot | null = null;

// Capa 2 — por cuenta: hero_pool (≤5 filas) + personal_baseline_winrate (1 número).
const accountOverlays = new Map<AccountId, AccountMetaOverlay>();
```

`getCachedMetaSnapshot(db, accountId)` compone `{ ...shared, ...overlay }` y devuelve un
`MetaSnapshot` con la forma exacta de hoy — **ningún consumidor cambia**: ni `buildSuggestions`, ni
las señales, ni `RAW_RANGE`, ni los pesos.

**Invalidación, con la responsabilidad separada:**

| Evento | Qué se invalida |
|---|---|
| Fin de `runMetaSync` (`meta/sync.ts`) | `sharedSnapshot` + el LRU de matchups. **Los overlays no** — una sincronización de meta no cambia el pool de nadie |
| `PUT /api/hero-pool` de la cuenta X | Solo `accountOverlays.delete(X)`. Ninguna otra sesión activa paga un recálculo |
| `POST /api/account` que cambia el baseline de X | Solo el overlay de X |

Esto cumple mejor el objetivo declarado en el Bloque 3 ("nunca borrar el mapa entero para no
penalizar a otras sesiones") que el `Map<accountId, MetaSnapshot>` que proponía: con un mapa de
snapshots completos, una sincronización de meta **obliga** a tirar todas las entradas, y cada
usuario nuevo relee las 14 850 filas de matchups (§12.15-D).

**Cota de memoria de los overlays**: sin límite explícito. Cada entrada son ≤5 filas + un número
(orden de 500 bytes); mil cuentas activas simultáneas serían menos de 1 MB. Si algún día hiciera
falta, el LRU ya existente (`db/lru-cache.ts`) se aplica sin cambiar nada más — no se hace ahora
porque sería complejidad sin problema.

### Los llamadores de `getCachedMetaSnapshot`, uno por uno

| Llamador | Pasa | Por qué |
|---|---|---|
| `computeSuggestionsForState` (`server/app.ts`) — push del draft en vivo | El `ownerAccountId` de la sesión (§12.9) | Es el único camino donde el pool personal debe pesar |
| `routes/meta.ts` → `GET /api/meta/hero-stats` | `null` | Solo lee `patchStats` |
| `routes/draft-paths.ts` | `null` | Solo lee `heroes` y las capacidades |
| `routes/simulator-sessions.ts` | `null` | Solo lee `patchStats` |
| `POST /api/suggestions/preview` y `/api/v1/draft/pro-recommendations` | `null` **explícito** | P14: es el bot rival. Hoy usa el pool del humano sin que nadie lo decidiera |

`computeV5Fallback` que hoy se inyecta en `createProDrafterRoutes` pasa a ser
`(state) => computeSuggestionsForState(state, null)` — se ata `null` en el punto de cableado, sin
cambiar la firma que espera `pro-drafter.ts`.

---

## 12.9 — WebSocket: cuenta en el `hello` y dueño de sesión

### `ClientMessage` (`server/session.ts`)

```ts
export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping";
  sessionId?: string;
  accountToken?: string;   // NUEVO. Opcional en el tipo: en single_tenant_local no viaja.
}
```

`isValidClientMessage` (`server/edge.ts`) acepta `accountToken` solo si es `string`; **no** valida
el formato ahí (eso es responsabilidad de `account-token.ts`, que ya tiene su regex y su prueba).

**El esquema del mensaje no cambia de versión** (`draft-ws/v1`): es un campo aditivo y opcional, un
cliente viejo sigue conectando en modo local. Un `hello` sin `accountToken` contra un motor en
`multi_tenant` **sí** se rechaza — eso no es retrocompatibilidad, es el punto de la fase.

### Dueño de sesión (P13)

`SessionStore` gana `ownerAccountId: AccountId | null` por sesión:

- Lo fija el **primer `hello` autenticado** (o el primer `POST /api/session/manual` autenticado).
- Un `hello` de otra cuenta sobre una sesión que ya tiene dueño → se rechaza, no se suscribe.
- `POST /ingest/draft-event` (el capturador, `x-capture-token`) **no** fija dueño: no representa a
  una persona logueada. Una sesión creada solo por el capturador tiene `ownerAccountId: null`
  hasta que alguien haga `hello`, y mientras tanto sus sugerencias se calculan con `null`.
- El dueño viaja con la entrada del `SessionStore` y se descarta con ella en `evictStale()` — sin
  ciclo de vida propio.

### Rechazo, sin tirar nada

Un `hello` con token ausente/inválido/vencido/repetido en modo `multi_tenant`:

```ts
buildServerMessage("error", 0, { code: "unauthorized", message: "Sesión no válida — volvé a iniciar sesión" })
```

…y **se cierra el socket con código 1008** (violación de política). No se suscribe al topic, no se
manda `snapshot`, no se calcula nada. La conexión se cierra a propósito — a diferencia de
`snapshot_unavailable` (§5.4 de fase 1), que sí deja la conexión viva porque es una degradación
temporal del servidor; acá el problema es del cliente y reintentar sin re-autenticar no puede
funcionar.

`ErrorPayload` ya existe y no cambia de forma. `code: "unauthorized"` es el único valor nuevo.

### Cómo consigue el navegador su token

`GET /api/auth/engine-token` (en `apps/web`, exige sesión) devuelve
`{ token: string, expiresAt: number }`. El cliente lo pide **inmediatamente antes de cada
conexión**, incluida cada reconexión — nunca lo guarda en `localStorage` ni lo reutiliza. Vive 60 s
y es de un solo uso, así que un token guardado no sirve para nada dos veces.

> El token queda al alcance del JS de la página. Es aceptado y consciente: autoriza exactamente lo
> que ese usuario ya puede hacer, dura 60 s y muere al primer uso. La alternativa (cookie
> reenviada por el WebSocket) es justamente la que el Bloque 2 descartó por no ser confiable entre
> orígenes distintos.

---

## 12.10 — API: qué cambia, qué se retira, y los errores

### Rutas que exigen `x-account-token` (modo `multi_tenant`)

| Método | Ruta | Qué cambia |
|---|---|---|
| `GET` | `/api/hero-pool` | Devuelve **solo** el pool de la cuenta del token |
| `PUT` | `/api/hero-pool` | Reemplaza **solo** el pool de esa cuenta, en una transacción (S8 sin cambios) |
| `POST` | `/api/hero-pool/calculate` | **El campo `accountId` del cuerpo se elimina del contrato.** El Steam32 sale del token. El cuerpo queda en `{ days?: number }` |
| `GET` | `/api/account` | **Nueva.** → `{ steamAccountId, personalBaselineWinrate, createdAt }` de la cuenta del token |
| `POST` | `/api/account` | **Nueva.** Idempotente (`INSERT ... ON CONFLICT DO NOTHING`). La usa el callback de OpenID (§12.4, paso 9). Única ruta que acepta un token de una cuenta que todavía no existe |
| `POST` | `/api/meta/sync` | Exige token. Es una operación global y cara (sincroniza OpenDota entero): que cualquiera la dispare a voluntad deja de ser aceptable con varios usuarios |
| `GET/POST/PUT/DELETE` | `/api/team-groups` | Confirmado en §12.16-2. Cada operación se scopea por la cuenta del token (§12.7, "`team_groups` con scoping por cuenta") — un `id` de equipo de otra cuenta responde `404`, nunca `403` |

### Rutas que **no** exigen token

`GET /api/health`, `GET /api/heroes`, `GET /api/meta/status`, `GET /api/meta/hero-stats`,
`/api/simulator/*`, `/api/session/:id/draft-paths`, `/api/session/:id/feedback`,
`POST /api/suggestions/preview`. Ninguna devuelve dato de cuenta. `POST /ingest/draft-event` sigue
con `x-capture-token`, sin cambios.

`POST /api/session/manual` acepta el token de forma **opcional**: si viene y es válido, fija el
dueño de la sesión (§12.9); si no viene, la sesión queda sin dueño. No lo exige porque es una ruta
que solo se alcanza contra el motor local (nunca estuvo en la allowlist de `next.config.ts`, y es
regla dura que siga así).

### Rutas retiradas

`GET /api/settings` y `PUT /api/settings` (P3). Se van de `server/app.ts`, de
`ENGINE_REWRITE_SOURCES` en `next.config.ts` y de `lib/engine-api.ts`. `getAllSettings`/
`upsertSetting` en `db/queries.ts` quedan sin llamadores: **se borran en el ticket de limpieza**,
nunca en el mismo diff que un cambio de comportamiento (criterio de TSK-047).

### Errores del token, explícitos

| Situación | Respuesta |
|---|---|
| Falta el header | `401 { error: "missing_account_token" }` |
| Forma o firma inválidas | `401 { error: "invalid_account_token" }` |
| Fuera de la ventana de 60 s | `401 { error: "expired_account_token" }` |
| Nonce ya usado | `401 { error: "replayed_account_token" }` |
| Token válido, cuenta inexistente en `accounts` (salvo en `POST /api/account`) | `401 { error: "unknown_account" }` |

**Ninguno de estos cuerpos ni ninguno de sus logs incluye el `accountId`.** La regla de 1b
("prohibido ecoarlo en un error") ahora vale para todas las cuentas, no solo la del desarrollador.

### Otro cambio forzado: `calculationInProgress`

`routes/hero-pool.ts` guarda hoy un booleano por proceso: con varios usuarios, el cálculo de uno
le devuelve `409 calculation_in_progress` a todos los demás. Pasa a ser
`Set<AccountId>` — un cálculo en curso bloquea solo a su propia cuenta.

---

## 12.11 — `apps/web`: proxy, pantallas y régimen de datos

### `proxy.ts` — deja de ser Basic Auth

Se retira `isValidBasicAuth` y las variables `SITE_ACCESS_USER`/`SITE_ACCESS_PASSWORD`. El nuevo
`proxy.ts` hace, en este orden:

1. Rutas públicas (`/healthz`, `/login`, `/api/auth/*`) → pasar sin tocar.
2. Leer la sesión (`iron-session`). Sin sesión válida:
   - petición a `/engine/*` → `401` JSON. **Nunca un redirect**: RTK Query lo seguiría y parsearía
     el HTML del login como si fuera la respuesta.
   - cualquier otra → `redirect` a `/login`.
3. Si `now - firstLoginAt > 90 días` → destruir sesión y redirigir a `/login`.
4. Si `now - issuedAt > 7 días` → renovar (reescribir la cookie con `issuedAt` nuevo).
5. Si la ruta es `/engine/*` → acuñar el token (§12.6) e inyectarlo:
   `NextResponse.next({ request: { headers } })` con `x-account-token`.

**Esto funciona porque el orden de ejecución de Next 16 es: Proxy (3) → `beforeFiles` (4) →
filesystem (5) → `afterFiles` (6)**, y los `rewrites()` de `next.config.ts` son `afterFiles`
(verificado en la doc del binario instalado: `01-app/03-api-reference/03-file-conventions/proxy.md`,
"Execution order", y "Set request headers for API Routes, getServerSideProps, and **rewrite
destinations**"). Proxy corre en **runtime Node** por defecto desde Next 16 — `node:crypto` y
`iron-session` funcionan ahí, y el `runtime` no se puede configurar (lanza error si se intenta).

> **Criterio de aceptación dedicado, no un supuesto** (§12.14, criterio 8): que el header inyectado
> llegue de verdad al destino externo del rewrite se verifica contra el binario real antes de
> construir el resto. **Plan B si no llega**: reemplazar `rewrites()` por un Route Handler
> `app/engine/[...path]/route.ts` que lea la sesión, firme y reenvíe a `ENGINE_INTERNAL_URL`.
> Mismo contrato de cara al navegador, un archivo más, cero cambios en `apps/engine`.

### `next.config.ts`

`ENGINE_REWRITE_SOURCES`: se quita `/engine/api/settings`, se agrega `/engine/api/account`. El
test existente (`next.config.test.ts`) se actualiza en el mismo cambio.

### Pantallas

Régimen **RTK Query** en todo lo de acá ("páginas normales", `web.md`); nada de esto es la vista de
draft en vivo.

- **`/login`** (nueva, pública): un botón "Iniciar sesión con Steam", el estado de error del
  callback explicado en llano ("Steam no confirmó tu inicio de sesión — probá de nuevo"), y nada
  más. Su propio error boundary y estado de carga, como toda feature (`web.md`).
- **`/settings` pasa a ser "Mi cuenta"**: el editor genérico de clave/valor desaparece con la API
  que lo alimentaba. Muestra el Steam32 de la sesión (visible **solo para su dueño**, nunca en un
  log ni en un error) y el baseline si existe, más el botón de cerrar sesión.
- **`HeroPoolConfig.tsx`**: desaparece el input de `account_id` y la escritura de
  `steam_account_id` vía `updateSetting`. "Calcular desde mis partidas" ya no pide nada: usa la
  cuenta con la que iniciaste sesión. Todo lo demás de 1b (nunca auto-aplica, confirmar/editar/
  descartar, los tres estados vacíos) queda **exactamente igual**.
- **`DraftView.tsx` y `use-random-draft-session.ts`**: piden `GET /api/auth/engine-token` antes de
  abrir el socket y en cada reconexión, y lo mandan en el `hello`. El estado `desconectado` de los
  6 obligatorios (`web.md`) cubre también "sesión vencida": se muestra, no se calla.

---

## 12.12 — Seguridad (extiende §5, §9.7, §10.8 y §11.8)

| Requisito | Cómo se cumple en Fase 5 |
|---|---|
| **Frontera #1 — navegador/Steam → `apps/web`** | `check_authentication` obligatorio (§12.4 paso 6), host de `claimed_id` anclado por regex, `return_to` verificado, nonce anti-CSRF de login. Saltarse cualquiera de los cuatro es rechazo automático de `@redteam` |
| **Frontera #2/#3 — `apps/web` → `apps/engine` (HTTP y WS)** | HMAC-SHA256 con secreto compartido que nunca toca el navegador, ventana de 60 s, nonce de un solo uso, comparación en tiempo constante, y verificación de firma **antes** de tocar el store de nonces |
| **`apps/engine` sigue en `127.0.0.1`** | Sin cambios. Un binding a `0.0.0.0` sigue siendo FAIL automático. Fase 5 **no** expone el motor a la red (§12.16-3) |
| **Dato personal, ahora a escala** | El `account_id` de Steam deja de ser "el del desarrollador" y pasa a ser el de cada persona real. Toda la regla de 1b sigue vigente **multiplicada**: nunca en logs, `journal.md`, tickets, `meta_sync.error`, `/api/health` ni en el cuerpo de ningún error. Se agrega: nunca en el mensaje de un ticket de migración (§12.7, paso 2) |
| **Secretos nuevos** | `SESSION_SECRET` (≥32 chars, `iron-session`) e `INTERNAL_AUTH_SECRET` (≥32 chars, HMAC). Solo `process.env`, nunca literal, nunca default de fallback en el repo — mismo régimen exacto que `CAPTURE_TOKEN`. Steam OpenID **no** exige credencial del sitio (no es OAuth2: no hay `client_id`/`client_secret` que registrar) |
| **Fail-closed en producción** | `scripts/start-railway.sh` aborta si falta `SESSION_SECRET`, `INTERNAL_AUTH_SECRET` o `PUBLIC_BASE_URL`. Reemplaza el guard actual sobre `SITE_ACCESS_*` — mismo mecanismo, mismo motivo (hallazgo de Sentinel del primer `/castoff`) |
| **Privilegio mínimo** | Toda ruta de cuenta responde `401` sin token válido. Hoy `GET /api/settings` devuelve todo a cualquiera que llegue al puerto — ese hallazgo se cierra retirando la ruta (P3) |
| **Validación de input externo** | Los `openid.*` son input externo puro y se validan antes de tocar lógica: modo, host, forma del id, `return_to`, `state`. El `accountId` nunca se acepta desde el cuerpo/query de una request (§12.10) |
| **Consultas parametrizadas** | Todo por Drizzle, incluidas las nuevas por `account_id`. Las migraciones son SQL fijo sin interpolación de ningún dato externo |
| **Dependencias nuevas** | Una: `iron-session` (`dependency` de producción en `apps/web`) → `/gear-up`/`@depcheck` + `// ALLOWED`. Cero en `apps/engine`: HMAC con `node:crypto`, ya disponible |
| **Sin `dangerouslySetInnerHTML`** | Sin cambios. Ningún dato de Steam se renderiza como HTML; el Steam32 es un número |

**Superficie que Fase 5 abre y no cerraba antes**: cualquier persona con una cuenta de Steam puede
crear una cuenta en la instancia. No hay lista de invitados ni límite de registro. Es consecuencia
directa del Bloque 1 ("cualquier jugador de Dota 2 con cuenta de Steam") y queda anotada como tal
en §12.16-6, no resuelta con un mecanismo que nadie pidió.

---

## 12.13 — Rendimiento

| Restricción | Número | Cómo se verifica |
|---|---|---|
| Verificación del token | **< 1 ms p95**, y **fuera** del presupuesto de 500 ms del motor (ocurre antes de calcular nada) | Micro-benchmark en el ticket de S13: N verificaciones seguidas con reloj inyectado. Medido, no asumido (criterio 5 del Bloque 6) |
| `check_authentication` contra Steam | Timeout duro **5 s**, sin reintentos | Solo en el login. **Nunca** en el camino caliente del draft: la regla de "cero red en el camino caliente" queda intacta, esta llamada vive incluso más lejos que `POST /api/hero-pool/calculate` |
| Composición del snapshot por cuenta | Un *spread* de objeto por cálculo de sugerencias (no por candidato) | El costo real que se evita es el otro: sin el cache partido, cada cuenta nueva relee 14 850 filas de `hero_matchups` |
| Presupuesto del motor | **Sin cambios**: 300 ms normal, corte duro a 500 ms | Ninguna señal cambia de fórmula |
| Store de nonces | ≤ ~1200 entradas en régimen normal; barrido a partir de 5000 | Cota derivada de 60 s de vida × el límite de 20 req/s ya existente |

---

## 12.14 — Criterios de aceptación

| # | Criterio | Verificación |
|---|---|---|
| 1 | **Login real** | Un usuario con cuenta de Steam entra sin contraseña propia; sin sesión, toda ruta salvo `/login`, `/api/auth/*` y `/healthz` redirige a login. Basic Auth **retirado por completo** (Bloque 6-4) |
| 2 | **Aislamiento entre cuentas** | Dos cuentas distintas guardan pools distintos; las sugerencias de una **nunca** reflejan el pool de la otra. Probado contra `buildSuggestions` completo y **con las dos cacheadas a la vez** (Bloque 6-2) — no contra la query aislada |
| 3 | **Usuario nuevo arranca vacío** | Una cuenta recién creada ve `hero_pool` vacío y `hero_pool_fit` con `applicable: false`, nunca el pool de otro (Bloque 6-1) |
| 4 | **Migración sin pérdida** | La cuenta real de producción conserva sus filas de `hero_pool` con `account_id` correcto, verificado contra el dato real y con los conteos de §12.7 antes/después (Bloque 6-3) |
| 5 | **Firma verificada de verdad** | Un callback con `openid.claimed_id` fabricado y `check_authentication` respondiendo `is_valid:false` **no** crea sesión. Fixture grabado, S11 |
| 6 | **Replay rechazado** | Un token válido reenviado dentro de su ventana se rechaza con `replayed_account_token`; uno reenviado fuera de la ventana, con `expired_account_token`. **Dos pruebas, no una** — un solo test de "token vencido" pasaría igual con anti-replay inexistente (Bloque 6-6) |
| 7 | **Latencia** | La verificación del token no suma latencia perceptible al presupuesto del motor, medido (§12.13, Bloque 6-5) |
| 8 | **El header llega al motor** | Verificación contra el binario real de Next 16: un header inyectado en `proxy.ts` llega al destino externo del rewrite. Si no llega, se aplica el Plan B de §12.11 **antes** de construir el resto |
| 9 | **Vector de prueba en los dos lados** | El vector de §12.6 produce la misma firma en `apps/web` y en `apps/engine`. Es el único candado del tercer espejo a mano |
| 10 | **Precisión de la conversión** | Prueba dedicada: un SteamID64 real convertido con `BigInt` da el Steam32 correcto, y la prueba documenta el valor que daría la conversión ingenua. Sin esta prueba, el bug de §12.15-C vuelve en el primer refactor |
| 11 | **El bot no usa el pool de nadie** | `POST /api/suggestions/preview` devuelve lo mismo con y sin pool configurado en la base (P14) |
| 12 | **Regresión cero del motor** | `SCORING_WEIGHTS_V5` intacta, los 5 pesos siguen sumando `1.0`, y las suites de `apps/engine`/`apps/web` pasan sin excepciones nuevas |
| 13 | **Aislamiento de `team_groups`** (§12.16-2) | Dos cuentas distintas crean equipos con el mismo `partySize`/nombre; ninguna ve, edita ni borra los equipos de la otra. Un `id` de equipo válido pero ajeno responde `404` |

---

## 12.15 — Correcciones a `architecture.md` (Fase 5), todas por leer el código real

**A. `fetchBaseQuery`/`prepareHeaders` no puede firmar el token.** El Bloque 3 dice: *"`fetchBaseQuery`
de `apps/web/lib/engine-api.ts` gana `prepareHeaders` para adjuntar el token HMAC en cada llamada a
`apps/engine`, leyendo el `accountId` de la sesión activa"*. **No es implementable**: `engine-api.ts`
corre en el navegador, que no tiene `INTERNAL_AUTH_SECRET` (y no puede tenerlo) ni puede leer una
cookie `httpOnly`. Además `ENGINE_HTTP_BASE_URL` es `/engine`, es decir el rewrite server-side de
Next: el navegador nunca habla directo con `apps/engine` por ese camino. Corregido a P6: el token se
acuña en `proxy.ts` (servidor) y se inyecta como header de request hacia el destino del rewrite.

**B. La cookie tampoco puede viajar en el `hello` del WebSocket, pero por otra razón que la del
Bloque 3.** El Bloque 3 acierta en descartar la cookie; lo que no dice es que el navegador tampoco
puede firmar el token él mismo. Corregido: hay un endpoint dedicado, `GET /api/auth/engine-token`,
que acuña del lado del servidor y entrega un token de 60 s y un solo uso (§12.9).

**C. La fórmula SteamID64→Steam32 es correcta; la aritmética ingenua de JavaScript no.**
`76561197960265728 > Number.MAX_SAFE_INTEGER (9007199254740991)`. Verificado ejecutándolo en este
mismo blueprint, con un SteamID64 sintético:

| Método | Resultado |
|---|---|
| `BigInt("76561198012345678") - 76561197960265728n` | `52079950` ✅ |
| `Number("76561198012345678") - 76561197960265728` | `52079952` ❌ |

Dos de diferencia, **sin ningún error, sin ninguna excepción**: mapearía al usuario a la cuenta de
otra persona. De ahí P10 y el criterio 10.

**D. `Map<accountId, MetaSnapshot>` está mal dimensionado.** Medido contra la base real del
proyecto: `hero_matchups` tiene **14 850** filas y `hero_patch_stats` **2 032**, idénticas para
todas las cuentas; `hero_pool` tiene **5**. Un snapshot completo por cuenta multiplica memoria y
obliga a que cada cuenta nueva relea las 14 850 filas — y además obliga a vaciar el mapa entero en
cada sincronización de meta, que es justo lo que el Bloque 3 quería evitar. Corregido a P15.

**E. `settings` no tiene hoy la clave `personal_baseline_winrate`, y nada la escribe nunca.**
Verificado contra la base real: la tabla `settings` tiene **una sola** clave, `steam_account_id`.
`PUT /api/hero-pool` **no** persiste el `baselineWinrate` que §9.5 describía (`isValidHeroPoolPutBody`
solo valida `entries`, y `put()` ignora cualquier otro campo), y ninguna pantalla lo escribe por
`PUT /api/settings`. Consecuencia real: `hero_pool_fit` viene usando `baseline = 0.5` desde 1b,
siempre. Para Fase 5 esto **facilita** la migración (la columna nace `null`, que es lo que ya hay),
pero es un hueco funcional preexistente y **no se arregla acá** — ticket aparte (§12.16-7).

**F. `capabilities.json`, `hero-positions.json` y el motor de señales no se tocan.** El Bloque 3
no lo pedía, y se deja escrito para que nadie lo interprete como implícito: Fase 5 no cambia
ninguna fórmula de scoring.

---

## 12.16 — Lo que Fase 5 deja abierto, y lo que exige confirmación antes de `/rulebook`

### Confirmado por el usuario (2026-08-24), antes de `/rulebook`

1. **Volumen persistente en Railway.** Confirmado como prerrequisito de infraestructura: se
   verifica/resuelve la existencia del volumen montado en `ENGINE_DB_PATH` **antes** de correr las
   migraciones `0005`/`0006`/`0007` en producción — mismo lugar exacto donde ya vive el paso 1 de
   "Estrategia de despliegue" (§12.7). No es un ticket de código de esta fase; es un gate manual
   previo, igual de obligatorio que el respaldo del paso 1.

2. **`team_groups`/`team_members` se scopean por cuenta en esta fase.** Aceptada la recomendación
   fuerte del Bloque 3: aislamiento multi-tenant total, ninguna tabla queda global salvo `heroes`/
   `hero_matchups`/`hero_patch_stats` (dato compartido por diseño, capa 1 del cache de §12.8). Deja
   de ser condicional — diseño completo en el nuevo apartado "`team_groups` con scoping por cuenta"
   de §12.7, y el ticket 12 de §12.17 pasa de condicional a firme.

3. **Exponer el motor a usuarios remotos queda deliberadamente fuera de Fase 5.** Confirmado: esta
   fase se limita a identidad, esquema multi-usuario y personalización del hero pool/motor local —
   no a hacer que el WebSocket de sugerencias en vivo sea alcanzable para un visitante remoto. El
   hallazgo del Bloque 2 (`DRAFT_LIVE_ENABLED=false`, `/ws/draft` fuera de `ENGINE_REWRITE_SOURCES`,
   clientes apuntando a `127.0.0.1` del propio visitante) queda documentado como **no-goal
   explícito** de esta fase, no como una laguna accidental — es trabajo de una fase futura propia
   (su propia frontera de confianza: autenticación de la conexión, límite de sesiones, y qué pasa
   con la regla dura de `127.0.0.1` de `apps/engine`). Los criterios de aceptación de §12.14 se
   verifican contra el motor local/simulador, igual que ya hacían las fases 3 y 4.

4. **`GET`/`PUT /api/settings` y el editor genérico de `/settings` se retiran.** Confirmado, sin
   scoping alternativo del KV — coincide con lo que ya especificaba el ticket 13 de §12.17 (P3):
   se centraliza todo en `GET`/`POST /api/account` y la pantalla "Mi cuenta" (§12.11).

5. **El MVP no consulta ni muestra nombre/avatar de Steam.** Confirmado — sin Steam Web API key,
   sin secreto nuevo más allá de los dos ya contemplados (§12.12). La UI sigue identificando al
   usuario por su Steam32, igual que hoy.

### Abierto a propósito, sin bloquear

6. **Registro abierto.** Cualquiera con cuenta de Steam puede crear cuenta en la instancia. No hay
   lista de invitados, ni límite de cuentas, ni verificación de nada más. Es lo que pide el Bloque
   1; si se quisiera restringir, es una decisión de producto posterior.
7. **`personal_baseline_winrate` sigue sin escribirse nunca** (§12.15-E). La columna existe, el
   contrato de §9.3 la usa, y sigue valiendo `null` → `0.5`. Ticket propio, fuera de Fase 5.
8. **Sin borrado de cuenta.** No hay ruta para "borrá mis datos". No se inventa una: cuando se
   priorice, define su propio alcance (¿borra el pool? ¿los equipos? ¿el feedback?).
9. **Sin límite de tasa en `POST /api/hero-pool/calculate` por cuenta.** Con varios usuarios,
   varios cálculos concurrentes pegan a OpenDota desde la misma IP. Hoy hay un `409` por cuenta
   (§12.10) pero ningún enfriamiento entre cálculos sucesivos. Anotado, no resuelto — inventar el
   número acá sería adivinar.
10. **`GET /api/session/:id/draft-paths` no verifica dueño de sesión.** Es una ruta que solo se
    alcanza contra el motor local (nunca estuvo en la allowlist del rewrite). Si algún día el motor
    se expone (punto 3), esta ruta entra en el mismo régimen que el `hello`.
11. **Rotación de `INTERNAL_AUTH_SECRET`/`SESSION_SECRET`.** Rotar el primero invalida los tokens
    en vuelo (≤60 s, irrelevante); rotar el segundo desloguea a todos. No hace falta un mecanismo
    de doble clave para esto, pero queda dicho para que no sorprenda.

---

## 12.17 — Entrada para `/rulebook`

Fronteras naturales de ticket, en orden estricto de dependencia. **No son tickets todavía.** Cada
uno es compilable y testeable por sí mismo; ninguno deja el árbol roto esperando al siguiente.

**Bloque A — el motor aprende qué es una cuenta (sin login todavía)**

1. **`accounts` + migración `0005`** (`db/schema.ts`, `0005_accounts.sql`, `_journal.json`, + su
   prueba de migración con el precedente de `migration-0004.test.ts`). Una unidad lógica por la
   excepción de migración de `CLAUDE.md`. **Cero cambio de comportamiento.**
2. **`hero_pool` con PK compuesta + migración `0006` + `queries.ts` + los llamadores de
   `routes/hero-pool.ts`.** Unidad lógica de migración (schema + migración + queries afectadas).
   El `accountId` entra como **parámetro** de las funciones de ruta, resuelto todavía por P12.
3. **`buildMetaSnapshot(db, accountId)` + cache partido + `invalidateAccountMetaCache`**
   (`meta/provider.ts` + los 5 llamadores, todos de una línea). Es un cambio mecánico de firma:
   va **solo**, sin mezclarse con comportamiento nuevo (criterio de TSK-047).
4. **`server/account-token.ts`: verificación + store de nonces + su prueba** (costura **S13**,
   con reloj y nonce inyectados). Sin conectar a ninguna ruta todavía. Incluye el vector de §12.6.
5. **Conectar el token a las rutas HTTP del motor**: helper `requireAccount`, `401` tipados,
   `routes/account.ts` nuevo, `calculate` sin `accountId` en el cuerpo, `calculationInProgress`
   por cuenta, retiro de `/api/settings`, `authMode` en `/api/health`.
6. **WebSocket**: `accountToken` en `hello`, `ownerAccountId` en `SessionStore`, rechazo
   `unauthorized` + cierre 1008, `pushSessionUpdate` con la cuenta dueña.

**Bloque B — `apps/web` aprende quién sos**

7. **`iron-session` (`/gear-up` + `// ALLOWED`) + `lib/session.ts` + `lib/steam-openid.ts`** con
   fixtures grabados de `check_authentication` (costura **S11**), incluida la prueba de `BigInt`
   del criterio 10.
8. **Rutas de auth**: `/login`, `/api/auth/steam/login`, `/api/auth/steam/callback`,
   `/api/auth/logout`.
9. **`proxy.ts` nuevo** (sesión + renovación + inyección del token) + `lib/account-token.ts`
   (acuñado, con el mismo vector de prueba) + guard fail-closed en `scripts/start-railway.sh`.
   **Este es el ticket donde el Basic Auth deja de existir**, y por eso va junto con el guard.
10. **`GET /api/auth/engine-token`** + `DraftView.tsx`/`use-random-draft-session.ts` pidiéndolo
    antes de cada conexión y reconexión.
11. **Pantallas**: `HeroPoolConfig.tsx` sin el input de `account_id`, `/settings` → "Mi cuenta",
    `lib/engine-api.ts` y `next.config.ts` alineados.

**Bloque C — cierre**

12. **Scoping de `team_groups`/`team_members` por cuenta** (confirmado, §12.16-2): `db/schema.ts`
    (columna `accountId`) + `0007_team_groups_account.sql` + `_journal.json` + las 5 funciones de
    `queries.ts` + `routes/team-groups.ts` con `requireAccount`. Una unidad lógica de migración
    (mismo criterio que el ticket 2 — schema + migración + queries afectadas), depende del helper
    `requireAccount` del ticket 5. **Va después del Bloque A y B completos** — necesita `accounts`
    poblada y `requireAccount` ya construido, no puede adelantarse.
13. **Limpieza, sin comportamiento**: borrar `isValidBasicAuth`, `getAllSettings`/`upsertSetting`,
    `SITE_ACCESS_*` de `.env.example`, y agregar `SESSION_SECRET`, `INTERNAL_AUTH_SECRET`,
    `PUBLIC_BASE_URL`. Va al final y solo, mismo criterio que TSK-047: si algo se rompe acá, es
    inequívocamente la limpieza.

**Variables de entorno, resumen**: se agregan `SESSION_SECRET`, `INTERNAL_AUTH_SECRET` y
`PUBLIC_BASE_URL`; se retiran `SITE_ACCESS_USER` y `SITE_ACCESS_PASSWORD`. `.env.example` es la
fuente y se actualiza en el ticket 13.

`preferred_tool` sugerido: **`claude-code`** para todo el Bloque A y para los tickets 9 y 13 (tocan
el gate de seguridad, `journal.md` y decisiones que viven en este SPEC); **`codex`** es razonable
para los tickets 8 y 11, que son acotados y autocontenidos una vez que §12.4 y §12.11 están
escritos. Ningún ticket de esta fase es candidato a `hermes-vps`: todos tocan autenticación.

---

# SPEC — Fase 6 (Formalizar Pro-Drafter: apertura de equipo consciente de bans)

Síntesis de `docs/agents/architecture.md` § Fase 6 (Bloques 1-6, `/pre-flight` completo,
2026-08-26) y del plan aprobado en `/Users/usuario/.claude/plans/system-prompt-act-parsed-reef.md`
(fases 0-4). **Sexta ejecución en Opus del proyecto**, delegada a un agente separado (mismo patrón
que Fase 4 y Fase 5). El Bloque 4 de `/pre-flight` confirma que esta fase **no cruza ningún gatillo
objetivo** de `CLAUDE.md`: no hay frontera de confianza nueva, ni migración, ni cambio de auth. El
uso de Opus acá es el lugar designado por política (`/blueprint`, una vez por fase), no una
excepción. De aquí en adelante, Sonnet otra vez.

Mismo estatuto que las fases anteriores: esto es contrato. Lo que no esté aquí, no es Fase 6.

## 13.0 — Alcance de este blueprint (leer primero)

- **§13.1 a §13.15 son contrato cerrado.** Números fijados, fórmulas exactas, contratos de tipo
  literales.
- **§13.16 son correcciones a `architecture.md`/al plan**, todas por leer el código real y por
  medir contra el dato real (mismo estándar que §11.6 y §12.15). **Tres de ellas invalidan una
  afirmación que el `/pre-flight` daba por buena** — la más grave es que `knn_similarity` *no*
  discrimina con cero picks propios, al revés de lo que el Bloque 3 y el plan asumen.
- **§13.17 es lo que queda abierto.** Deliberadamente corto: esta fase cierra números, no los
  delega.
- Lo que Fase 6 **no** es (Bloque 1, sin cambios): no reescribe `SCORING_WEIGHTS_V5` (sigue
  congelada, y sigue siendo la única activa en producción); no amplía `SignalId`; no construye una
  tabla `heroSynergy` ni ningún sync nuevo; no unifica `capabilities.json` con
  `lane/hero-line-profiles.json`; no introduce Python ni ninguna dependencia nueva; no toca el bot
  del Random Draft Simulator (`bot-drafter.ts`); no agrega pantallas ni telemetría; y **no prende
  `ENABLE_PRO_DRAFTER`** — la promoción es un segundo blueprint, más angosto, alimentado por la
  evidencia de §13.15.

---

## 13.1 — Qué de fases anteriores queda superado

Todo lo demás sigue vigente. Solo estas cinco cosas se mueven, y **ninguna toca producción con el
flag apagado**:

| Antes decía | Fase 6 lo cambia a |
|---|---|
| `pipeline/run-pipeline.ts`: `TOP_N = 3` es el único tamaño de salida posible | `TOP_N = 3` sigue siendo el del camino normal; el modo `teamOpening` devuelve `OPENING_TOP_N = 5` (§13.8) |
| `pipeline/run-pipeline.ts`: `corpusMatchupWinrate` (proxy sobre el corpus) es la única fuente de `MatchupWinrate` | `createMetaMatchupWinrate(meta.matchups)` cuando el llamador inyecta `matchups`; el adaptador de corpus sobrevive como fallback explícito para el script de evaluación (§13.5) |
| `pipeline/merge.ts`: los 3 pesos de `PipelineWeights` son fijos durante todo el draft | Se derivan por fase con `deriveContinuousPipelineWeights` (§13.4). `PipelineWeights` y `PIPELINE_RAW_RANGE` **no cambian de forma** |
| `signals/mix.ts`: `openingStrategy()` es una función privada | Se mueve tal cual a `draft-paths/strategy.ts` y se exporta (§13.7). Cuerpo y semántica idénticos — mismo movimiento de una línea que Fase 4.1 hizo con `archetypeFitBonus` |
| `server/routes/pro-drafter.ts`: `ProDrafterSuggestion.rank: 1 \| 2 \| 3` | `1 \| 2 \| 3 \| 4 \| 5`, más los dos espejos a mano de `apps/web` (§13.10) |

**Lo que NO se toca, y es deliberado**: `SignalId`, `SCORING_WEIGHTS_V1`-`V5`, `RAW_RANGE` de
`mix.ts`, `applyDraftEvent`, el orden de push `draft_state` → `suggestions`,
`intent/denial-score.ts` (ni una línea), `intent/position-prior.ts`, `intent/flex-inference.ts`,
`knn/jaccard.ts`, `lane/*`, `drafter/decision-context.ts`, y `drafter/team-opener.ts` — que
conserva `MAX_COUNTER_RELIEF = 0.12` hasta que la evaluación de §13.15 autorice su retiro (P9).

---

## 13.2 — Decisiones cerradas

| # | Decisión | Razón |
|---|---|---|
| **P1** | **En modo `teamOpening`, `knn_similarity` es `raw: null` para *todos* los candidatos y la etapa KNN no se ejecuta.** | **Corrección forzada por el código real** (§13.16-A). Con `own = []`, `similarity()` (`knn/jaccard.ts`) da numerador 0 contra cualquier draft del corpus → `sim = 0` para los 502. `nearestNeighbors` devuelve entonces los **primeros 10 del archivo**, y `knnScoresByHero` les asigna `raw: 0` a los héroes ganadores de esos 10 — mientras el resto queda en `null`. `0` normaliza a 0 y `null` se redistribuye: el resultado es una **penalización arbitraria, dependiente del orden del JSON**, a ~50 héroes. No es una señal débil: es ruido con signo. |
| **P2** | **El término ban-aware reutiliza `calculateDenialScore` sin editarla, cambiando únicamente las dos funciones que ya recibe inyectadas** (`matchupWinrate`, `earlyPressure`) **y el `flexHero`, que pasa a ser un héroe baneado.** | La fórmula ya es la formalización correcta (Bloque 3). Sus dos dependencias son parámetros — cambiar qué significan es exactamente el punto de extensión que la firma ofrece. Una segunda copia de la fórmula es rechazo automático de revisión, mismo criterio que `archetypeFitBonus` en 4.1. |
| **P3** | **El insumo de `matchupWinrate` en modo apertura es el *alivio* (`max(0, 0.5 − winrate)`), no el winrate crudo**, escalado por el solapamiento posicional candidato↔baneado. | Un ban no es un rival: ganarle a un héroe que ya no está no vale nada. Lo que vale es que un héroe **al que el candidato le perdía** desapareció. `max(0, 0.5 − wr)` es literalmente el primitivo que `team-opener.ts` ya usa (`reliefScore`), lo que hace que el reemplazo eventual de `MAX_COUNTER_RELIEF` sea una sustitución comparable, no un salto a otra escala. |
| **P4** | **`POSITION_OVERLAP_GAIN = 5`**, exactamente `1 / UNIFORM_PROBABILITY` de `intent/position-prior.ts`. | Es el ancla de calibración: un candidato **sin dato de posición** cae en la distribución uniforme (`0.2` en las 5), y `Σ_p P(ban=p)·5·0.2·alivio = alivio` — es decir, reproduce **exactamente** el alivio plano de `team-opener.ts`. Un hueco de datos nunca penaliza; solo deja de premiar. |
| **P5** | **`earlyPressure` en modo apertura se reemplaza por `positionalCommitment(c) = 1 − H(c)/log₂5`**, derivado de `deriveFlexDistribution` sobre `hero-positions.json`. | **Medido**: `lane/hero-line-profiles.json` tiene **15 de 126** héroes. `earlyPressureFromProfiles` devuelve `0` para los otros 111 → el término `β·EarlyPressure·H(F)` sería **inerte para el 88% del pool**, y toda la fase se reduciría al alivio plano de siempre. `hero-positions.json` cubre 126/126 y ya está validado en el borde (S10). Semántica: un ban vuelve *seguro comprometerse*; el candidato que sí tiene un rol definido es el que convierte esa certeza en plan. |
| **P6** | **`BETA_OPENING = 0.04`** (constante propia; `DEFAULT_BETA = 0.5` sigue intacta para el camino normal). | **Calibrado contra el dato real, no elegido a ojo** (§13.11). Con 16 bans: `Σ_b H(b)` medido = 9.47 de media, rango `[3.90, 15.79]` sobre 200 sorteos → el término de entropía abarca `[0, 0.38]` de media. El término de alivio, medido sobre las 15 984 filas reales de `hero_matchups`, llega a 0.35 de media y 0.57 en p90. Los dos sub-términos quedan en el mismo orden de magnitud: ninguno puede volver invisible al otro. Con `DEFAULT_BETA = 0.5` la entropía dominaría ~12:1. |
| **P7** | **Los bans se combinan por SUMA, no por promedio** — al revés del camino normal, que promedia sobre rivales. | El promedio sobre 16 bans divide el alivio por 16 y lo vuelve un decimal de tercer orden (medido: media 0.019 vs. máximo 0.35). El motivo por el que el camino normal promedia está escrito en `run-pipeline.ts` — preservar la calibración `[0, 2]` de `PIPELINE_RAW_RANGE.denial_score` con hasta 5 rivales — y **acá se preserva igual, pero por calibración de `BETA_OPENING`**: el `raw` medido sobre 30 sorteos × ~110 candidatos va de `0` a **1.170**, nunca cerca de 2. `PIPELINE_RAW_RANGE` no se toca. |
| **P8** | **`OPENING_REPEAT_STRATEGY_PENALTY = 4.0`, no `0.04`.** | `REPEAT_STRATEGY_PENALTY = 0.04` de `team-opener.ts` opera sobre `baseScore = score / 100`, escala `[0, 1]`. `mergePipelineSignals` devuelve escala `[0, 100]`. Copiar el número tal cual haría la penalización **25 veces más débil** y la diversificación sería decorativa. `4.0` es el **mismo 4% del rango** — misma conducta de producto, otra unidad. |
| **P9** | **`MAX_COUNTER_RELIEF` de `team-opener.ts` NO se retira en esta fase.** Su retiro es un ticket propio, posterior y condicionado a §13.15. | Con `ENABLE_PRO_DRAFTER` apagado (default, y no cambia acá), `team-opener.ts` es el **único** camino de apertura vivo. Retirarle el mecanismo antes de que el reemplazo esté encendido es una regresión garantizada a cambio de nada. Cierra la pregunta abierta del "Cierre" de `architecture.md`: **ticket de limpieza posterior, nunca el mismo commit.** |
| **P10** | **`openingStrategy` se mueve a `draft-paths/strategy.ts`, no se exporta desde `mix.ts`.** | `pipeline/` no debe importar `signals/mix.ts` — es la separación deliberada que documenta `merge.ts`. `draft-paths/` ya es el tercer lugar neutral del que ambos árboles consumen (`archetypeFitBonus`, `capabilitiesByHero`, `DraftPathArchetype`): mismo precedente exacto que Fase 4.1. |
| **P11** | **`deriveContinuousPipelineWeights` satura en `own + enemy ≥ 4`.** | No es un número inventado: es exactamente donde `deriveDecisionContext` (`drafter/decision-context.ts`) declara terminada la fase ciega (`enemy >= 2 && own >= 2` → `response_pick`). El blend continuo llega a 0 en la misma frontera que el gate discreto que el proyecto ya usa. |
| **P12** | **El modo `teamOpening` entra por un 7º parámetro de opciones de `runProDrafterPipeline`, no por una función exportada aparte.** | `ProDrafterRouteDeps.runPipeline` está tipado `typeof runProDrafterPipeline`: un parámetro opcional al final mantiene esa inyección válida sin tocar la costura de pruebas de la ruta. Mismo patrón que `BuildSuggestionsOptions` en `mix.ts`. |
| **P13** | **La lectura de `MetaSnapshot.matchups` en la ruta ocurre ANTES de arrancar el cronómetro de `PIPELINE_TIMEOUT_MS`,** y si falla se cae a v5 con `fallback_applied: true`. | El presupuesto de 200 ms está escrito para medir el pipeline, no una lectura de SQLite en frío. `getCachedMetaSnapshot` normalmente es un hit en memoria; la primera llamada del proceso no lo es. Nunca un 500. |
| **P14** | **La ruta pide el snapshot con `accountId: null`, siempre.** | No es una decisión nueva: es §12 P14 ya vigente. `/api/v1/draft/pro-recommendations` es el cerebro del bot rival del simulador — no representa a ninguna persona logueada. |

---

## 13.3 — Costuras: ninguna nueva

**Fase 6 no estrena costura.** Cada pieza cae dentro de una costura ya definida en
`.claude/rules/testing-seams.md`, y se deja escrito para que nadie invente una:

| Pieza nueva | Costura existente | Qué es real en la prueba | Qué se inyecta |
|---|---|---|---|
| `pipeline/phase-decay.ts` | **Ninguna** — función pura sin frontera de datos | La función completa | Nada. Recibe `PipelineWeights` y dos enteros |
| `pipeline/meta-matchup.ts` (`createMetaMatchupWinrate`) | **S2** (`MetaProvider`) | La lógica de umbral y de cache por par | `Record<HeroId, HeroMatchupStat[]>` como fixture literal. **Cero red, cero SQLite** |
| `pipeline/ban-relief.ts` (`createBanReliefWinrate`, `createPositionalCommitment`) | **S2** + **S10** (`HeroPositions`) | La fórmula de alivio, el factor de solapamiento, la conversión entropía→compromiso | `matchups` como fixture literal y `HeroPositions` inyectado. **Ninguna prueba lee `hero-positions.json` real** |
| `extractCandidateStrategies` (`pipeline/feature-extractor.ts`) | **S9** (`HeroCapabilities`) | La clasificación por arquetipo | `HeroCapabilities[]` inyectado. **Ninguna prueba lee `capabilities.json` real** |
| Modo `teamOpening` de `run-pipeline.ts` | **S2 + S9 + S10** combinadas | El pipeline completo de apertura, incluida la diversificación | Corpus, `HeroPositions`, `matchups`, `HeroCapabilities` y perfiles de línea, todos como fixtures — igual que las pruebas actuales de ese archivo |

**El número `S12` sigue reservado** por §11.10 para el RNG inyectable de la pieza 4 de Fase 4, y
**`S14` queda libre**: la diversificación de esta fase es determinista (penalización, no sorteo), así
que no consume ninguna reserva.

**Reglas derivadas (obligatorias):**

- Ninguna prueba de Fase 6 lee `hero-positions.json`, `capabilities.json`,
  `hero-line-profiles.json`, `pro-draft-corpus.json` ni la SQLite real. Es la misma regla de S9/S10
  de siempre, con un agravante propio de esta fase: los números de §13.11 se **midieron** contra
  esos archivos reales, y por eso mismo no pueden ser el sustrato de un test — se regeneran.
- El candado de sensibilidad (§13.14, criterio 3) se prueba contra **el pipeline completo**, nunca
  contra el adaptador de alivio aislado. Mismo criterio literal que §10.9-7 y §12.14-2: el
  adaptador puede dar el número correcto y el ranking seguir sin moverse si el peso no alcanza —
  que es exactamente lo que pasa hoy con `MAX_COUNTER_RELIEF`.
- El candado de regresión del camino normal (§13.14, criterio 6) también corre contra el pipeline
  completo, con `teamOpening` ausente y `matchups` ausente: debe devolver **3** resultados.

---

## 13.4 — `pipeline/phase-decay.ts` (archivo nuevo)

Generaliza el precedente de `TIMING_BLEND` (`signals/position-fit.ts`, `[0.5, 0.3, 0.15, 0.0]`
indexado por picks propios) a un blend **continuo** sobre los 3 pesos de `PipelineWeights`.

```ts
import type { PipelineWeights } from "./weight-loader";

// Frontera de saturación = la misma que deriveDecisionContext usa para declarar terminada la fase
// ciega (enemy >= 2 && own >= 2 -> "response_pick", drafter/decision-context.ts). No es un número
// nuevo: es el gate discreto que el proyecto ya tiene, leído como frontera continua.
export const OPENING_SPAN = 4;

// [0, 1]. 1 = draft vacío (apertura pura), 0 = 4 o más picks confirmados entre los dos lados.
export function openingBlend(ownPickCount: number, enemyPickCount: number): number {
  const confirmed = ownPickCount + enemyPickCount;
  return Math.max(0, 1 - confirmed / OPENING_SPAN);
}

export function deriveContinuousPipelineWeights(
  base: PipelineWeights,
  ownPickCount: number,
  enemyPickCount: number,
): PipelineWeights;
```

**Fórmula exacta**:

```
t                = openingBlend(own, enemy)                  // 1.0, 0.75, 0.5, 0.25, 0.0, 0.0, ...
knn_similarity'  = base.knn_similarity * (1 - t)
lane_score'      = base.lane_score                            // no cambia: no depende de picks
denial_score'    = 1 - knn_similarity' - lane_score'          // por RESTA, nunca sumando el sobrante
```

- **Por qué `denial_score` sale por resta y no por suma**: sumar el peso liberado
  (`base.denial_score + base.knn_similarity * t`) da el mismo número en aritmética exacta, pero
  acumula error de punto flotante en dos operaciones distintas. Derivar el tercero por resta hace
  que la suma sea 1.0 **por construcción**, no por casualidad numérica.
- **Invariante obligatorio**: para cualquier par `(ownPickCount, enemyPickCount)` de enteros ≥ 0,
  `|knn' + lane' + denial' − 1| ≤ SUM_EPSILON`, con **`SUM_EPSILON = 1e-9`, el mismo valor exacto
  que ya usa `parsePipelineWeights`** (`weight-loader.ts`). Nunca `=== 1`: en IEEE-754 la igualdad
  exacta no está garantizada ni siquiera derivando por resta, y el proyecto ya fijó su tolerancia.
- Con `base = pro-drafter-weights-v6.json` (`0.40 / 0.35 / 0.25`), los valores son exactamente:

| own + enemy | t | knn_similarity | lane_score | denial_score |
|---|---|---|---|---|
| 0 (apertura) | 1.00 | 0.00 | 0.35 | **0.65** |
| 1 | 0.75 | 0.10 | 0.35 | 0.55 |
| 2 | 0.50 | 0.20 | 0.35 | 0.45 |
| 3 | 0.25 | 0.30 | 0.35 | 0.35 |
| ≥ 4 | 0.00 | 0.40 | 0.35 | **0.25** = base |

- **Consecuencia declarada, no incidental**: con 4 o más picks confirmados, `deriveContinuousPipelineWeights`
  devuelve exactamente `base` — el camino normal del pipeline en fase media/tardía no cambia en
  nada. Los únicos drafts cuyo peso cambia son los de ≤ 3 picks confirmados, que es precisamente
  donde el KNN tiene poco con qué comparar.
- **Impacto conocido en una prueba existente**: `run-pipeline.test.ts` usa
  `STATE = picks { radiant: [1], dire: [10, 11] }` → `own = 1`, `enemy = 2`, `t = 0.25`. Los números
  exactos trazados a mano de ese archivo cambian y **deben actualizarse en el mismo ticket**. No es
  una regresión: es el cambio de comportamiento que esta sección especifica.

---

## 13.5 — `pipeline/meta-matchup.ts` (archivo nuevo): la fuente real de `MatchupWinrate`

```ts
import type { HeroId } from "../draft/reducer";
import type { HeroMatchupStat } from "../signals/types";

// Mismo valor y misma razón que en signals/counter.ts y drafter/team-opener.ts, declarado local
// como ya hacen esos dos archivos -- el proyecto nunca cruza-importa esta constante entre capas.
export const MIN_MATCHUP_GAMES = 200;

export type MatchupWinrateFn = (
  candidate: HeroId,
  rival: HeroId,
  position: 1 | 2 | 3 | 4 | 5,
) => number | null;

export function createMetaMatchupWinrate(
  matchups: Record<HeroId, HeroMatchupStat[]>,
): MatchupWinrateFn;
```

**Contrato exacto**:

1. Se construye un índice `Map<HeroId, Map<HeroId, HeroMatchupStat>>` **una vez** al crear la
   función — no un `Array.find` por llamada. `calculateDenialScore` invoca esta función 5 veces por
   par `(candidato, rival)`, y el pool de apertura es de ~110 candidatos.
2. `row` ausente → **`null`**.
3. `row.games < MIN_MATCHUP_GAMES` → **`null`**. Mismo umbral y misma semántica que `counter.ts`:
   sin volumen no hay dato, y `null` nunca se disfraza de `0` (regla dura de `engine.md`).
4. En otro caso → `row.wins / row.games`, un número en `[0, 1]`.
5. **`position` se ignora por completo** (parámetro `_position`). `hero_matchups` no tiene columna
   de posición y OpenDota no la expone — es el hueco heredado desde 1b que `denial-score.ts` ya
   documenta. Se conserva el parámetro porque la interfaz de `calculateDenialScore` lo exige, y se
   deja escrito acá para que nadie lo lea como un olvido.

**Regla de selección de fuente en `run-pipeline.ts`** (§13.8): si el llamador inyecta
`options.matchups`, se usa `createMetaMatchupWinrate`; si no, se usa `corpusMatchupWinrate` **sin
cambios**. `corpusMatchupWinrate` no se borra: `scripts/evaluate-pro-drafter.ts` corre una
evaluación *leave-one-out* deliberadamente restringida al corpus, y darle datos de OpenDota
invalidaría su metodología. Dos fuentes, una regla explícita, ningún default silencioso.

**Dato real medido (2026-08-26, contra `apps/engine/data/dota2coach.sqlite`)**: `hero_matchups`
tiene **15 984** filas; solo **1 200 (7.5%)** alcanzan `games ≥ 200`. De esas, **593** son adversas
(`wr < 0.5`), repartidas en **73** héroes. Es decir: el umbral de 200 no es una formalidad — recorta
el 92.5% de las filas. Esto explica, junto con el tamaño de `MAX_COUNTER_RELIEF`, por qué el alivio
por ban actual casi nunca reordena nada.

---

## 13.6 — `pipeline/ban-relief.ts` (archivo nuevo): el término ban-aware

Es el corazón de la fase. **`intent/denial-score.ts` no se edita**: se le cambian los dos
parámetros inyectados y el `flexHero`.

### Fórmula

Para un candidato `c` y el conjunto de héroes baneados `B = state.banned`:

```
BanAwareRaw(c) = Σ           calculateDenialScore( c, target(b), banRelief, commitment, BETA_OPENING )
                 b ∈ B

donde, desarrollado:

calculateDenialScore(c, target(b), …) =  Σ  P(Pos_b = p) · banRelief(c, b, p)
                                         p∈1..5
                                      +  BETA_OPENING · commitment(c) · H(b)
```

con:

| Símbolo | Definición exacta | Origen |
|---|---|---|
| `target(b)` | `inferFlexPick(b, heroPositions, DEFAULT_ENTROPY_THRESHOLD)` | `intent/flex-inference.ts`, sin cambios. Su campo `isFlex` **no lo lee `calculateDenialScore`** — se reutiliza la función entera igual, en vez de duplicar la construcción del `FlexInferenceResult` |
| `P(Pos_b = p)` | `target(b).distribution.probabilities[p]` | `deriveFlexDistribution` (`intent/position-prior.ts`), sin cambios. Héroe sin dato → uniforme `0.2` |
| `H(b)` | `target(b).distribution.entropy`, entropía de Shannon en bits, `[0, log₂5 = 2.3219]` | ídem |
| `banRelief(c, b, p)` | ver abajo | **nuevo** |
| `commitment(c)` | `1 − H(c) / log₂5`, en `[0, 1]` | **nuevo**, sobre `deriveFlexDistribution(c, heroPositions)` |
| `BETA_OPENING` | **`0.04`** | **nuevo** (P6) |

### `createBanReliefWinrate`

```ts
import { deriveFlexDistribution } from "../intent/position-prior";
import { MIN_MATCHUP_GAMES, type MatchupWinrateFn } from "./meta-matchup";
import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";
import type { HeroMatchupStat } from "../signals/types";

// 1 / UNIFORM_PROBABILITY de intent/position-prior.ts. Un candidato sin dato de posición cae en la
// uniforme (0.2 en las cinco) y este factor lo devuelve exactamente a 1.0 -- el alivio plano de
// team-opener.ts, ni más ni menos. Un hueco de datos nunca penaliza.
export const POSITION_OVERLAP_GAIN = 5;

export const BETA_OPENING = 0.04;

export function createBanReliefWinrate(
  matchups: Record<HeroId, HeroMatchupStat[]>,
  heroPositions: HeroPositions,
): MatchupWinrateFn;

export function createPositionalCommitment(
  heroPositions: HeroPositions,
): (heroId: HeroId) => number;
```

`banRelief(c, b, p)`, exactamente:

1. `row = matchups[c]?.find(m => m.vsHero === b)` — vía el mismo índice `Map` de §13.5,
   construido una sola vez.
2. `row` ausente **o** `row.games < MIN_MATCHUP_GAMES (200)` → **`null`**.
   `calculateDenialScore` excluye esa posición de la suma; con `null` en las 5, el término de
   matchup vale exactamente 0 (no un 0 fabricado: la posición se saltea, ver el comentario ya
   escrito en `denial-score.ts`).
3. `relief = Math.max(0, 0.5 − row.wins / row.games)`. **Idéntico al primitivo de `reliefScore`
   en `team-opener.ts`.** Un matchup favorable al candidato aporta `0`, nunca negativo: un ban
   sobre un héroe al que ya le ganabas no es un alivio.
4. `return POSITION_OVERLAP_GAIN * P(Pos_c = p) * relief`.

**Qué produce esto al sumarse dentro de la fórmula**:

```
Σ P(Pos_b = p) · 5 · P(Pos_c = p) · relief(c,b)  =  5 · overlap(c,b) · relief(c,b)
p
     con overlap(c,b) = Σ P(Pos_b = p) · P(Pos_c = p)  ∈ [0, 1]
```

Es decir: **el alivio cuenta en proporción a que el héroe baneado hubiera jugado la misma posición
que el candidato quiere jugar.** Un mid baneado al que le perdías vale si estás abriendo con un
mid; no vale si estás abriendo con un hard support. Esa es la información que
`MAX_COUNTER_RELIEF = 0.12` — un bono plano — no tiene forma de expresar, y es la mitad de la queja
de producto que originó la fase.

`createPositionalCommitment(c)`:

```
1 − deriveFlexDistribution(c, heroPositions).entropy / Math.log2(5)
```

Rango cerrado `[0, 1]`: un héroe con una sola posición ≥ 200 partidas da `1`; un héroe sin entrada
en `hero-positions.json` cae en la uniforme y da exactamente `0`. **Nunca negativo, nunca > 1** —
no hace falta un `clamp`, la entropía de Shannon sobre 5 símbolos está acotada por `log₂5` por
definición. Memoizado en un `Map<HeroId, number>` por corrida: se consulta una vez por par
`(candidato, ban)`, es decir hasta 1 760 veces en una apertura de 16 bans, para ~110 valores
distintos.

### Qué pasa sin bans

`B` vacío → **`denial_score` es `raw: null` para todos los candidatos**, nunca `0`. Es el mismo
criterio, literal, que ya aplica `run-pipeline.ts` cuando `flexTargets.length === 0`: sin insumo no
hay señal, y `null` se redistribuye proporcionalmente en `mergePipelineSignals` en vez de arrastrar
a todos por igual. Con `knn_similarity` también `null` en apertura (P1), el ranking queda entonces
determinado solo por `lane_score` — resultado honesto y explícito para un draft sin bans, no un
número inventado.

---

## 13.7 — `pipeline/feature-extractor.ts` extendido, y `openingStrategy` movido

### El movimiento (P10)

`draft-paths/strategy.ts`, archivo nuevo de una sola función, **cuerpo copiado tal cual** desde
`signals/mix.ts:305-312`:

```ts
import type { DraftPathArchetype, HeroCapabilities } from "./types";
import type { HeroId } from "../draft/reducer";

export function openingStrategy(hero: HeroId, capabilities: HeroCapabilities[]): DraftPathArchetype {
  const capability = capabilities.find((entry) => entry.hero === hero);
  if (!capability) return "scaling";
  if (capability.structuralDamage === "high") return "push";
  if (capability.teamfight === "high") return "teamfight";
  if (capability.hasInitiation && capability.hasCatch) return "pickoff";
  return "scaling";
}
```

`signals/mix.ts` borra la función privada e importa esta. El tipo de retorno pasa de la unión
literal `"push" | "teamfight" | "pickoff" | "scaling"` a `DraftPathArchetype`, que es **la misma
unión** (`draft-paths/types.ts`) — `mix.ts` compila sin ningún otro cambio. Es el mismo movimiento
de una línea que Fase 4.1 hizo con `archetypeFitBonus`: privada → exportada, sin tocar firma ni
cuerpo. **Una segunda copia de esta clasificación es rechazo automático de revisión.**

### La extensión

`extractCandidateFeatures` **conserva su firma y su tipo de retorno exactos** — cero regresión, sus
pruebas actuales no se tocan. El archivo gana un segundo export:

```ts
import { openingStrategy } from "../draft-paths/strategy";
import type { DraftPathArchetype, HeroCapabilities } from "../draft-paths/types";

export function extractCandidateStrategies(
  candidates: readonly HeroId[],
  capabilities: readonly HeroCapabilities[],
): Map<HeroId, DraftPathArchetype>;
```

- Devuelve **una entrada por candidato, siempre** — nunca omite héroes, a diferencia de
  `extractCandidateFeatures`, que descarta a los que no tienen perfil de línea. Un héroe sin
  entrada en `capabilities.json` recibe `"scaling"`, que es exactamente lo que `openingStrategy`
  ya devuelve hoy para ese caso en `mix.ts` (y lo que `team-opener.ts` ya consume en producción).
- **No filtra por `state`**: la exclusión de baneados/pickeados ya la hizo quien construyó
  `candidates`. Duplicar el filtro sería una segunda copia de `candidatePool`, que es justo lo que
  el comentario de cabecera de `feature-extractor.ts` explica que no debe pasar.
- `capabilities` es **obligatorio** en esta función, no opcional con default. Un default que cargue
  `capabilities.json` real acoplaría cualquier prueba futura al archivo curado (regla S9) y
  repetiría el tipo de bug silencioso que `engine.md` ya prohíbe explícitamente para
  `buildMetaSnapshot(db, accountId)`. La inyección del archivo real se hace **una sola vez**, en la
  ruta (§13.10).

**Cobertura real medida (2026-08-26)**: de los **124** héroes distintos del corpus del KNN, **121**
tienen entrada en `capabilities.json`, **123** en `hero-positions.json` y **15** en
`hero-line-profiles.json`. Los tres huecos son alcanzables hoy, no defensivos.

---

## 13.8 — `pipeline/run-pipeline.ts`: el modo `teamOpening`

### Contrato de entrada y salida

```ts
export interface ProDrafterPipelineOptions {
  // Ausente o false -> camino normal, 3 resultados, comportamiento de hoy salvo el peso por fase.
  readonly teamOpening?: boolean;
  // Ausente -> corpusMatchupWinrate (sin cambios). Presente -> createMetaMatchupWinrate (§13.5).
  readonly matchups?: Record<HeroId, HeroMatchupStat[]>;
  // Obligatorio en la práctica para el modo teamOpening: sin capacidades no hay diversificación.
  // Ausente -> todos los candidatos caen en "scaling" y la penalización se aplica igual.
  readonly heroCapabilities?: readonly HeroCapabilities[];
}

export function runProDrafterPipeline(
  state: DraftState,
  index: InMemoryDraftIndex,
  corpus: readonly DraftCandidate[],
  heroPositions: HeroPositions,
  weights: PipelineWeights,
  profiles?: Map<HeroId, HeroLineProfile>,
  options?: ProDrafterPipelineOptions,          // <- 7º parámetro, nuevo
): readonly PipelineCandidateResult[];
```

`PipelineCandidateResult` **no cambia de forma**. `PipelineSignalId` **no gana una cuarta clave**:
el término ban-aware alimenta el `raw` de `denial_score`, no una señal nueva.

### La condición de apertura, exacta

```ts
const OPENING_TOP_N = 5;

const isTeamOpening =
  options?.teamOpening === true &&
  state.picks.radiant.length === 0 &&
  state.picks.dire.length === 0;
```

**Byte a byte la misma guarda que `signals/mix.ts` ya usa** (`isTeamOpening`, verificado en el
código). Deliberadamente **no** se usa `deriveDecisionContext(state, true) === "team_opening"`:
esa función pasa por `observedDraftFacts`, que con `state.localSide === "unknown"` devuelve dos
arrays vacíos y reportaría `"team_opening"` sobre un tablero que ya tiene 10 héroes pickeados
(§13.16-C). La guarda cruda mira los dos arrays reales y no puede engañarse.

Si `options.teamOpening === true` pero ya hay picks, se cae al camino normal (3 resultados) sin
error — misma tolerancia que `mix.ts`.

### Etapas, en modo apertura

| # | Etapa | Qué hace en apertura |
|---|---|---|
| 1 | Feature Extractor | `extractCandidateFeatures` igual que hoy, más `extractCandidateStrategies(candidates, options.heroCapabilities ?? [])` |
| 2 | KNN | **No se ejecuta** (P1). `knn_similarity` → `raw: null` para todos. Se ahorran además 502 cálculos de `similarity` que darían 0 |
| 3 | Lane Sim | `evaluateLaneRoster([features.get(c)], [], LANE_WEIGHTS)` — igual que hoy. Con el lado rival vacío, `meanOfDimension` devuelve `NEUTRAL_VALUE = 0.5` (verificado), así que un candidato sin perfil da `laneScore = 0.5` exacto y uno con perfil se separa de ahí |
| 4 | Intent Decoder | `denial_score` = `BanAwareRaw(c)` de §13.6. Con `state.banned` vacío → `null` |
| 5 | Merger | `mergePipelineSignals(signals, deriveContinuousPipelineWeights(weights, 0, 0))` → pesos `0.00 / 0.35 / 0.65`; con `knn_similarity: null`, la redistribución de `merge.ts` deja `lane 0.35 / denial 0.65` |
| 6 | Selección | Orden por score **con desempate explícito** (abajo), luego diversificación por estrategia (§13.9), corte en `OPENING_TOP_N = 5` |

### Desempate obligatorio

```ts
results.sort((a, b) => b.score - a.score || a.heroId - b.heroId);
```

El camino normal hoy ordena solo por score. Con ~110 candidatos y un `lane_score` idéntico para los
111 héroes sin perfil de línea, los empates en apertura son **la norma, no la excepción**: sin
desempate, el orden lo decidiría el orden de iteración del `Set` construido desde el corpus. El
desempate por `heroId` es el mismo que `team-opener.ts` ya usa (`left.hero - right.hero`) y es
condición necesaria del criterio de determinismo (§13.14-2).

### Precomputación obligatoria (fuera del bucle de candidatos)

Mismo criterio de memoización que el archivo ya documenta para `rivalFlexTargets` y
`corpusMatchupWinrate`:

- `banTargets = state.banned.map(b => inferFlexPick(b, heroPositions, DEFAULT_ENTROPY_THRESHOLD))`
  — hasta 16 llamadas por corrida, nunca 110 × 16.
- El índice `Map<HeroId, Map<HeroId, HeroMatchupStat>>` de `createMetaMatchupWinrate`/
  `createBanReliefWinrate` — una vez.
- `commitment` memoizado por héroe.

Costo resultante en apertura: 110 candidatos × 16 bans × 5 posiciones = **8 800** lecturas de `Map`
más 110 entropías. Holgado dentro de `PIPELINE_TIMEOUT_MS = 200` (§13.13).

---

## 13.9 — Diversificación por estrategia

Selección greedy idéntica en forma a `recommendTeamOpeners`, sobre la escala del pipeline:

```ts
export const OPENING_REPEAT_STRATEGY_PENALTY = 4.0;
```

```
selected = []
remaining = [...sorted]                      // ya ordenado por score desc, desempate por heroId
while selected.length < OPENING_TOP_N && remaining.length > 0:
    used = new Set(selected.map(strategyOf))
    remaining.sort by  (score − (used.has(strategyOf(x)) ? OPENING_REPEAT_STRATEGY_PENALTY : 0)) desc,
                       heroId asc
    selected.push(remaining.shift())
```

- **`4.0`, no `0.04`** (P8): `mergePipelineSignals` devuelve `[0, 100]`, `team-opener.ts` opera
  sobre `[0, 1]`. Es el mismo 4% del rango; copiar el literal sería debilitar la diversificación 25
  veces.
- **La penalización es acumulativa por presencia, no por conteo**: se penaliza igual la segunda
  aparición de una estrategia que la tercera, exactamente como hace `team-opener.ts` hoy
  (`usedStrategies` es un `Set`). No se inventa un escalado nuevo.
- **Nunca es un filtro duro**: si las 5 mejores opciones son todas `"scaling"`, se devuelven las 5.
  Misma regla que rige `position_fit` (§10.4) y `team-opener.ts`: penalizar, jamás eliminar
  candidatos por juicio de calidad.
- `strategyOf` sale de `extractCandidateStrategies` (§13.7). Sin `heroCapabilities`, todos son
  `"scaling"` y la penalización se aplica de todas formas, dejando el orden por score intacto —
  degradación limpia, no una rama especial.

---

## 13.10 — `server/routes/pro-drafter.ts` y los espejos de `apps/web`

### Lo que NO cambia

- **`ENABLE_PRO_DRAFTER` sigue siendo el único gate, sin tocar** (`app.ts:267`). Apagado por
  defecto; con el flag en `false`, `/api/v1/draft/pro-recommendations` sigue cayendo en
  `handleSuggestionsPreview` (v5) exactamente como hoy.
- **El contrato de request no cambia en absoluto.** `SuggestionsPreviewRequest` **ya tiene**
  `teamOpening?: boolean` y `isValidSuggestionsPreviewRequest` **ya lo valida** (verificado en
  `server/edge.ts`). Fase 6 no toca la validación de borde.
- `PIPELINE_TIMEOUT_MS = 200`, `CACHE_TTL_MS`, `CACHE_MAX_ENTRIES`, la política LRU y el fallback
  transparente a v5: sin cambios.

### Lo que cambia

**1. `ProDrafterSuggestion.rank` se ensancha:**

```ts
interface ProDrafterSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3 | 4 | 5;      // antes: 1 | 2 | 3
  score: number;
  signals: PipelineCandidateResult["signals"];
}
```

**2. `ProDrafterRouteDeps` gana dos inyecciones y ensancha una:**

```ts
export interface ProDrafterRouteDeps {
  corpus?: readonly DraftCandidate[];
  heroPositions?: HeroPositions;
  heroCapabilities?: HeroCapabilities[];                        // NUEVO, default loadHeroCapabilities()
  getMetaMatchups?: () => Promise<Record<HeroId, HeroMatchupStat[]>>;  // NUEVO
  runPipeline?: typeof runProDrafterPipeline;
  computeV5Fallback?: (
    state: DraftState,
    accountId: number | null,
    options: { teamOpening?: boolean },
  ) => Promise<SuggestionSet>;                                  // ENSANCHADA
  now?: () => number;
}
```

En `server/app.ts`, `createProDrafterRoutes` pasa a recibir:

```ts
createProDrafterRoutes({
  heroPositions: deps.heroPositions,
  heroCapabilities: deps.heroCapabilities,
  getMetaMatchups: async () => (await getCachedMetaSnapshot<TSchema>(deps.db, null)).matchups,
  computeV5Fallback: computeSuggestionsForState,
})
```

`accountId: null` siempre (P14 / §12 P14). `computeSuggestionsForState` ya tiene exactamente esa
firma (`state, accountId = null, options = {}`), así que la inyección compila sin adaptador.

**3. `fingerprint()` incorpora `teamOpening`:**

```ts
return [
  body.format, body.patch, body.localSide,
  `opening:${body.teamOpening === true}`,          // NUEVO
  `banned:${sortedIds(body.banned)}`,
  `radiant:${sortedIds(body.picks.radiant)}`,
  `dire:${sortedIds(body.picks.dire)}`,
].join("|");
```

**Sin esto hay un bug real, no hipotético**: dos requests con los mismos héroes y distinto
`teamOpening` comparten clave, y la segunda recibe del cache la respuesta de 3 sugerencias de la
primera. (`targetPosition`/`usePersonalPool` siguen fuera del fingerprint y afectan al camino de
fallback v5 — hueco **preexistente**, anotado en §13.17-3, no se arregla acá.)

**4. `runPipelineWithBudget` recibe las opciones, y el snapshot se lee antes del cronómetro:**

```
matchups = null
try { matchups = await deps.getMetaMatchups?.() } catch { matchups = null }   // P13
start = now()
results = pipelineImpl(state, index, corpus, heroPositions, weights, profiles, {
  teamOpening: body.teamOpening === true,
  matchups: matchups ?? undefined,
  heroCapabilities,
})
if (now() - start > PIPELINE_TIMEOUT_MS) return null
```

Un fallo al leer el snapshot **no** tira la request ni fuerza el fallback: degrada a
`corpusMatchupWinrate`, que es el comportamiento de hoy. Un fallo del pipeline sigue cayendo a v5
con `fallback_applied: true`, sin cambios.

**5. `buildFallbackSuggestions` deja de recortar a 3 cuando la request es de apertura:**

```ts
async function buildFallbackSuggestions(state, teamOpening: boolean) {
  if (!deps.computeV5Fallback) return [];
  const v5 = await deps.computeV5Fallback(state, null, { teamOpening });
  const limit = teamOpening ? 5 : 3;
  return v5.suggestions.filter((s) => s.rank <= limit).map(…);
}
```

El comentario actual (*"Pro-Drafter conserva su contrato de tres alternativas. La apertura de
equipo del simulador puede tener cinco, pero nunca viaja por este fallback experimental"*) deja de
ser cierto en esta fase y **se reemplaza**, no se deja contradiciendo al código.

### Los dos espejos a mano de `apps/web` (`features/pro-drafter/types.ts`)

Cambian **en el mismo cambio** que el motor, o el tipado miente:

```ts
export interface ProSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3 | 4 | 5;      // antes: 1 | 2 | 3
  score: number;
  signals: ProSignalContribution[];
}

export interface LegacySuggestionSetResponse {
  schema: "suggestions/v1";
  suggestions: { hero: HeroId; rank: 1 | 2 | 3 | 4 | 5; score: number }[];   // antes: 1 | 2 | 3
}
```

**`LegacySuggestionSetResponse` ya está mal hoy, antes de esta fase** (§13.16-D): con
`ENABLE_PRO_DRAFTER` apagado y `teamOpening: true`, `app.ts` responde en esa misma URL con el
`SuggestionSet` de v5, que **ya trae ranks 4 y 5**. Es una mentira de tipo preexistente que esta
fase corrige de paso porque toca exactamente esa línea.

**Nada más de `apps/web` cambia.** Sin pantallas nuevas, sin `ProDrafterPanel` reescrito, sin
`bot-drafter.ts` tocado. `ProDrafterPanel` renderiza la lista que recibe; 5 elementos en vez de 3 no
exigen ningún cambio de componente.

---

## 13.11 — Números medidos contra el dato real (no estimados)

Todo lo de esta sección se midió el 2026-08-26 contra `apps/engine/data/dota2coach.sqlite`,
`signals/hero-positions.json`, `draft-paths/capabilities.json`, `lane/hero-line-profiles.json` y
`knn/pro-draft-corpus.json` **reales**. Está acá para justificar `BETA_OPENING` y para fijar la
barra de §13.15 — **ninguna prueba puede depender de estos números** (S9/S10: los archivos se
regeneran).

**Entropía de posición (`hero-positions.json`, 126 héroes):**

| | valor |
|---|---|
| `H` mínimo / máximo | `0.0000` / `2.1736` (tope teórico `log₂5 = 2.3219`) |
| `H` medio / mediana | `0.6052` / `0.6329` |
| Héroes con `H = 0` (una sola posición ≥ 200 partidas) | **51 de 126** |
| `commitment = 1 − H/log₂5` medio | `0.7394` |

**Alivio por matchup (`hero_matchups`, 15 984 filas):**

| | valor |
|---|---|
| Filas con `games ≥ 200` | **1 200 (7.5%)** |
| De esas, adversas (`wr < 0.5`) | **593 (49.4%)** — en 73 héroes |
| `relief = 0.5 − wr` medio / mediana / p95 / máximo | `0.0293` / `0.0240` / `0.0750` / `0.1140` |

**Simulación de apertura (200 sorteos de 16 bans, candidatos = los 124 héroes del corpus):**

| | valor |
|---|---|
| Candidatos con algún alivio (de ~110) | **27** — el 75% del pool no recibe ninguno |
| `Σ_b 5·overlap·relief` máximo por draft: media / p90 | `0.3484` / `0.5718` |
| `Σ_b H(b)` sobre 16 bans: media / mín / máx | `9.468` / `3.896` / `15.792` |

**Calibración de `BETA_OPENING = 0.04`** (P6): el término de entropía vale
`0.04 · commitment(c) · Σ_b H(b)`, que con los rangos medidos abarca `[0.156, 0.632]` según qué
tan comprometidos de rol sean los héroes baneados — contra un término de alivio que llega a
`0.35`-`0.57`. **Los dos sub-términos son del mismo orden**, y el conjunto de bans mueve tanto el
alivio (por candidato, reordena) como el peso relativo del compromiso (escalar, cambia quién le
gana a quién). Con `DEFAULT_BETA = 0.5` la entropía valdría hasta `7.9` y borraría al alivio.

**`raw` resultante de `denial_score` en apertura** (30 sorteos × ~110 candidatos):
mínimo `0.0000`, media `0.2985`, p99 `0.6624`, **máximo `1.1703`**. Dentro de
`PIPELINE_RAW_RANGE.denial_score = [0, 2]` con margen; el `clamp` de `normalize()` nunca se activó
en la muestra. **`PIPELINE_RAW_RANGE` no se toca.**

**Sensibilidad del top-5** (300 pares de conjuntos de 16 bans, con los pesos de apertura
`0.35 / 0.65` de §13.4 y la diversificación de §13.9):

| Métrica | Resultado |
|---|---|
| Héroes distintos entre los dos top-5 (de 5) | media **3.29**, mínimo **1** |
| Pares con ≥ 1 héroe distinto | **100.0%** |
| Pares con ≥ 2 héroes distintos | **97.0%** |
| El héroe de rank 1 cambia | **89.0%** |
| Posiciones del ranking que cambian (de 5) | media **4.61**, mínimo **2** |
| Jaccard del top-5 | media **0.225**, máximo `0.667` |

---

## 13.12 — Seguridad (hereda el Bloque 4; extiende §5, §9.7, §10.8, §11.8 y §12.12)

Se documenta explícitamente, no se da por sobreentendido:

- **Ninguna frontera de confianza nueva.** Las tres entradas de datos de esta fase ya están
  validadas en el borde por loaders existentes: `hero-positions.json` por `loadHeroPositions()`
  (S10), `capabilities.json` por `loadHeroCapabilities()` (S9), y `MetaSnapshot.matchups` por la
  validación de borde de la sincronización con OpenDota (S6) más el `parse` de `meta/mappers`.
  Fase 6 no lee ningún archivo nuevo ni ningún origen nuevo. La decisión de descartar `heroSynergy`
  (Bloque 2) eliminó el único sync/tabla nueva que el diseño original iba a abrir: esta fase tiene
  **menos** superficie nueva que el plan que la originó, no más.
- **Cero red en el camino caliente, intacto y reforzado.** Nada de lo que se agrega hace `fetch`.
  La única lectura nueva de la ruta es `getCachedMetaSnapshot(db, null)` — SQLite y cache en
  memoria, exactamente la misma llamada que el fallback a v5 ya hacía en ese mismo handler. El
  script de evaluación (§13.15) sigue siendo un script de desarrollador, manual, nunca invocado
  desde el motor ni desde CI.
- **Ningún secreto nuevo.** Ni variable de entorno nueva. `ENABLE_PRO_DRAFTER` es el único gate y no
  cambia de semántica ni de default (`!== "true"` → apagado).
- **Ningún dato personal.** Estadísticas públicas agregadas de héroes, misma naturaleza que
  `patchStats` desde fase 1. La ruta computa con `accountId: null` por contrato (P14): ningún
  `hero_pool` de ninguna cuenta entra en este camino, y por lo tanto **ningún Steam32 puede
  aparecer en un log, un error o un ticket de esta fase** — la regla de 1b/§12.12 se cumple por
  construcción, no por vigilancia.
- **Ninguna dependencia nueva** (`dependencies` ni `devDependencies`). Sin `/gear-up`, sin
  `@depcheck`, sin marca `// ALLOWED`. Cero runtime nuevo: sin Python, decisión explícita del
  usuario (Bloque 5).
- **`apps/engine` sigue atado a `127.0.0.1`.** Esta fase no expone ninguna ruta nueva ni cambia el
  binding. No agrega ninguna ruta HTTP: reutiliza `/api/v1/draft/pro-recommendations`, que ya
  existe y ya está gateada.
- **Privilegio sin cambios**: nadie que no tuviera acceso a la ruta lo gana. Con el flag apagado, el
  comportamiento observable de producción es idéntico byte a byte al de hoy.

---

## 13.13 — Rendimiento

- **Presupuesto**: `PIPELINE_TIMEOUT_MS = 200` sin cambios, medido como hoy (después de la llamada
  síncrona; el mecanismo real es "nunca entregar una respuesta que se pasó", ya documentado en la
  cabecera de `pro-drafter.ts`).
- **Costo en apertura**: ~110 candidatos × 16 bans × 5 posiciones = **8 800** lecturas de `Map`, más
  110 entropías memoizadas y 16 `inferFlexPick`. Contra eso, se **ahorran** los 502 cálculos de
  `similarity` del KNN, que en apertura daban 0 (P1). El neto no debería superar el orden de
  magnitud del camino normal.
- **Prueba de rendimiento obligatoria**: el modo `teamOpening` entra en la misma prueba de "se
  mantiene rápido" que ya existe en `run-pipeline.test.ts`, con el mismo margen generoso y el mismo
  motivo escrito ahí (probar ausencia de regresión de orden de magnitud, no un número exacto que se
  vuelva flaky en CI).
- **Cache de la ruta**: sin cambios de política. Con `teamOpening` incorporado al fingerprint
  (§13.10-3), una sesión del simulador que consulte la apertura varias veces con los mismos bans
  paga el pipeline una sola vez por TTL.

---

## 13.14 — Criterios de aceptación

| # | Criterio | Verificación |
|---|---|---|
| 1 | **La apertura devuelve 5, no 3** | Con `own = []`, `enemy = []`, `teamOpening: true` y un corpus fixture con ≥ 6 candidatos, `runProDrafterPipeline` devuelve exactamente 5 resultados (Bloque 6-2) |
| 2 | **Determinismo** | El mismo `DraftState` y el mismo conjunto de bans producen el **mismo orden y los mismos scores**, en dos corridas y con el mismo fixture. Exige el desempate por `heroId` de §13.8 |
| 3 | **Candado de sensibilidad — criterio de éxito real de toda la fase** | Sobre el mismo `DraftState` de apertura y el mismo fixture, **dos conjuntos de bans construidos deliberadamente contrastantes** (uno con héroes de `H = 0` que son counters reales de los mejores candidatos; otro con héroes de `H` alta sin matchup adverso ≥ 200 partidas) producen top-5 que difieren en **≥ 2 de los 5 héroes** *y* en el héroe de **rank 1**. Contra el pipeline completo, nunca contra el adaptador aislado. Referencia medida sobre el dato real: ≥ 2 héroes distintos en el 97.0% de los pares aleatorios, rank 1 distinto en el 89.0% (§13.11) |
| 4 | **Sin bans no se inventa señal** | Con `state.banned = []`, los 5 resultados traen `denial_score` con `raw: null` — nunca `0` (Bloque 6, regla dura de `engine.md`) |
| 5 | **`knn_similarity` es `null` en apertura, para todos** | Ningún candidato sale con `raw: 0` en `knn_similarity` cuando `own = []`. **Prueba dedicada**: sin ella, la regresión de §13.16-A vuelve sin que nada falle (P1) |
| 6 | **Regresión cero del camino normal** | Con `teamOpening` ausente: 3 resultados, mismas señales, y `deriveContinuousPipelineWeights` devuelve `base` **idéntico** para `own + enemy ≥ 4`. Los casos de ≤ 3 picks cambian a propósito (§13.4) y sus números esperados se actualizan en el mismo ticket |
| 7 | **Los pesos siguen sumando 1.0** | `deriveContinuousPipelineWeights` cumple `\|Σ − 1\| ≤ 1e-9` para **toda** combinación de `(own, enemy)` en `0..5 × 0..5`, con el mismo `SUM_EPSILON` de `weight-loader.ts` (Bloque 6-1) |
| 8 | **`raw` de `denial_score` dentro del rango calibrado** | Con el fixture del candado de sensibilidad, ningún `raw` de `denial_score` supera `2` — es decir, `normalize()` nunca clampea. Referencia medida: máximo `1.1703` (§13.11) |
| 9 | **Diversificación real** | Con 5 candidatos de la misma estrategia y uno claramente peor de otra, el sexto entra al top-5 solo si su desventaja de score es menor que `OPENING_REPEAT_STRATEGY_PENALTY = 4.0`. **Dos pruebas, no una**: una donde entra y otra donde no. Un solo test pasaría igual con la penalización en cualquier valor > 0 |
| 10 | **`openingStrategy` tiene una sola implementación** | `signals/mix.ts` no contiene ninguna función que clasifique arquetipos; importa `draft-paths/strategy.ts`. `bun test` de `mix` y de `team-opener` pasa sin cambios de expectativa |
| 11 | **Fallback y gate intactos** | Con `ENABLE_PRO_DRAFTER` apagado, `/api/v1/draft/pro-recommendations` responde exactamente lo que responde hoy (incluidas 5 sugerencias en apertura, por el camino v5). Con el flag encendido y el pipeline lanzando, `fallback_applied: true` y 5 sugerencias v5 cuando `teamOpening: true` |
| 12 | **El cache no cruza modos** | Dos requests con los mismos héroes y distinto `teamOpening` devuelven 3 y 5 sugerencias respectivamente, en cualquier orden de llegada (§13.10-3) |
| 13 | **Aislamiento de árboles intacto** | La prueba ya existente de `run-pipeline.test.ts` sigue verde: `server/` importa `pipeline/` **solo** desde `routes/pro-drafter.ts`. Ningún archivo nuevo de `pipeline/` importa `signals/mix.ts` ni `signals/weights.ts` ni `SignalId` |
| 14 | **`SCORING_WEIGHTS_V5` intacta** | Los 5 pesos siguen sumando `1.0`, `SignalId` sigue con 5 miembros, y las suites de `apps/engine`/`apps/web` pasan sin excepciones nuevas |

---

## 13.15 — El paquete de evidencia (Fase 4 del plan) y la barra numérica

Extensión de `scripts/evaluate-pro-drafter.ts`, **modo nuevo, no reemplazo del existente**. Sigue
siendo un script de desarrollador manual (`#!/usr/bin/env bun`), nunca en CI, nunca invocado desde
el motor.

**Qué mide**: para una muestra de al menos **50** drafts del corpus, se generan **2 variantes de
conjunto de bans** por draft (16 héroes cada una, muestreadas del propio corpus, semilla fija y
declarada para que la corrida sea reproducible). Para cada variante se calcula el top-5 de apertura
por los dos caminos:

- **V5**: `buildSuggestions(state, meta, { teamOpening: true })` → pasa por `recommendTeamOpeners`.
- **Pro-Drafter**: `runProDrafterPipeline(..., { teamOpening: true, matchups, heroCapabilities })`.

**Métrica**: índice de Jaccard del top-5 entre las dos variantes de ban del mismo draft,
`|A ∩ B| / |A ∪ B|`. Más bajo = más sensible a los bans. Se reporta la media por camino, más el
número de héroes distintos (de 5) y el porcentaje de casos en que cambia el rank 1 — las tres, no
solo la primera, porque un Jaccard bajo con el rank 1 fijo no resuelve la queja de producto tal
como el usuario la formuló ("las mismas sugerencias primarias").

**Barra de aceptación, cerrada acá** — se considera superada si se cumplen **las tres**:

1. **Jaccard medio del top-5 de Pro-Drafter ≤ 0.35.** Referencia simulada en este blueprint contra
   el dato real: `0.225` (§13.11). El margen entre `0.225` y `0.35` cubre que el corpus real de
   bans no es uniforme como el sorteo de la simulación.
2. **Jaccard medio de Pro-Drafter estrictamente menor que el de V5 sobre la misma muestra**, con una
   diferencia absoluta de al menos **0.15**. Es la comparación que convierte "se siente repetitivo"
   en un número: no alcanza con ser sensible, hay que ser *más* sensible que el mecanismo que se
   propone reemplazar.
3. **El héroe de rank 1 cambia en al menos el 60% de los pares de variantes.** Referencia simulada:
   `89.0%`. Es el criterio que habla el idioma de la queja original.

**Qué NO decide este script**: no prende `ENABLE_PRO_DRAFTER`, no retira `MAX_COUNTER_RELIEF`, no
promueve nada. Es el insumo de un **segundo `/blueprint`, más angosto**, que decidirá entre tres
salidas: (a) prender el flag solo para el caso de apertura, (b) portar únicamente el término
ban-aware a `team-opener.ts` sin adoptar el resto de Pro-Drafter, o (c) dejarlo dark y curar más
datos. Las tres siguen siendo posibles al terminar Fase 6.

---

## 13.16 — Correcciones a `architecture.md` y al plan (Fase 6), todas por leer el código y medir el dato real

**A. `knn_similarity` NO discrimina con cero picks propios.** El Bloque 3 dice
*"combinando `knn_similarity` (sin cambios)"* y el plan afirma *"ya discrimina con cero picks
propios"*. **Es falso, verificado en `knn/jaccard.ts`**: `similarity(own, candidate, weights)`
calcula el numerador solo sobre `ownSet ∩ candidateSet`; con `own = []` la intersección es vacía y
el numerador es `0` para **los 502 drafts del corpus**. `nearestNeighbors` entonces ordena 502
empates en `0` y devuelve los **primeros 10 en orden de archivo**; `knnScoresByHero` le pone
`raw: 0` a los héroes ganadores de esos 10 y deja `null` al resto. Como `0` normaliza a `0` y `null`
se redistribuye, el efecto neto es **penalizar a ~50 héroes elegidos por el orden del JSON**. De ahí
P1: en apertura la etapa KNN no se ejecuta y `knn_similarity` es `null` para todos.

**B. `earlyPressure` es inerte para el 88% del pool.** El Bloque 3 propone aplicar
`β·EarlyPressure(h*)·H(F)` contra los bans sin observar que `earlyPressureFromProfiles` lee
`lane/hero-line-profiles.json`, que tiene **15 de 126** héroes (medido) y devuelve `0` para el
resto. El término de entropía —la mitad de la fase— habría sido exactamente `0` para 111 candidatos
y la apertura habría quedado igual de plana que hoy. De ahí P5:
`positionalCommitment = 1 − H/log₂5`, sobre `hero-positions.json`, que cubre 126/126.

**C. `deriveDecisionContext` no sirve como guarda de apertura.** El Bloque 3 lo señala como el
precedente del gate discreto. Lo es conceptualmente, pero **no puede usarse como condición**:
`observedDraftFacts` devuelve `ownPicks: []` y `revealedEnemyPicks: []` cuando
`state.localSide === "unknown"`, así que `deriveDecisionContext(state, true)` reporta
`"team_opening"` sobre un tablero con 10 héroes ya pickeados. `signals/mix.ts` ya evita esa trampa
con una guarda cruda sobre los dos arrays; §13.8 usa esa misma guarda, byte a byte.

**D. Un espejo de `apps/web` ya está mal hoy, antes de esta fase.**
`LegacySuggestionSetResponse.suggestions[].rank` está tipado `1 | 2 | 3` en
`apps/web/features/pro-drafter/types.ts`. Pero con `ENABLE_PRO_DRAFTER` apagado —el default—
`app.ts:267` responde en esa URL con el `SuggestionSet` de v5, y `buildSuggestions` con
`teamOpening: true` devuelve **5** sugerencias, ranks 4 y 5 incluidos. Es una mentira de tipo que
existe desde antes; se corrige acá porque §13.10 toca esa línea.

**E. El corpus tiene 502 drafts, no ~175.** El plan y la cabecera de
`scripts/evaluate-pro-drafter.ts` hablan de "~175 drafts". Contado sobre
`knn/pro-draft-corpus.json`: **502**, con **124** héroes distintos. No cambia ninguna decisión, pero
la cabecera del script queda desactualizada y se corrige en el mismo ticket que lo extienda.

**F. `REPEAT_STRATEGY_PENALTY` no se puede reutilizar por valor.** El Bloque 3 dice *"mismo criterio
que `team-opener.ts` ya usa hoy"*. El criterio sí; el número no: `0.04` vive en escala `[0, 1]` y el
pipeline puntúa en `[0, 100]`. De ahí P8 y `OPENING_REPEAT_STRATEGY_PENALTY = 4.0`.

**G. El umbral de 200 partidas recorta el 92.5% de los matchups.** No es una corrección a un texto,
sino un dato que ningún documento previo tenía: de las 15 984 filas de `hero_matchups`, solo 1 200
llegan a `games ≥ 200`, y solo 593 son adversas. La causa raíz de "los bans no mueven nada" no es
únicamente que `MAX_COUNTER_RELIEF = 0.12` sea chico: es que el dato que lo dispara casi nunca
existe. El factor de solapamiento posicional (P4) y el término de entropía (P5/P6) son lo que hace
que la apertura reaccione a **todos** los bans, no solo a los 7.5% con volumen suficiente.

**H. El corpus del KNN, no `meta.heroes`, define el universo de candidatos.**
`candidatesFromCorpus` deriva los candidatos de los héroes que aparecen en el corpus — **124**, no
los 126 de `hero-positions.json` ni los que tenga `meta.heroes`. Ningún documento previo lo decía.
Consecuencia real: dos héroes que existen en el juego nunca pueden aparecer en una sugerencia de
Pro-Drafter mientras no estén en el corpus. No se corrige en esta fase (es curación de corpus,
§13.17-1), pero deja de ser invisible.

---

## 13.17 — Lo que esta fase deja abierto

Deliberadamente corto. Solo los dos primeros piden algo del usuario, y ninguno bloquea `/rulebook`.

### Pide confirmación del usuario (no bloqueante, pero conviene antes de ejecutar)

1. **`BETA_OPENING = 0.04` y `POSITION_OVERLAP_GAIN = 5` quedan fijados acá con justificación
   medida (§13.11).** `POSITION_OVERLAP_GAIN` no es negociable: es el ancla que hace que un héroe
   sin dato de posición reproduzca exactamente el alivio de `team-opener.ts`. `BETA_OPENING` sí es
   una perilla de producto: subirlo hace que el compromiso de rol pese más que el counter
   neutralizado, bajarlo lo contrario. Si al ver el resultado el usuario prefiere otro balance, se
   cambia **acá y en el código**, nunca solo en el código — misma regla que el umbral de 200
   partidas de §10.

2. **La barra de §13.15 (Jaccard ≤ 0.35, delta ≥ 0.15 contra V5, rank 1 cambia ≥ 60%) es una
   propuesta con referencia simulada, no una medición del sistema real terminado.** Es lo mejor que
   se puede fijar antes de que exista el código; si la corrida real queda cerca del borde, la
   decisión de si eso "resolvió la queja" es del usuario, no del número.

### Abierto a propósito, sin bloquear

3. **`fingerprint()` sigue sin incluir `targetPosition` ni `usePersonalPool`** — hueco preexistente
   que afecta al camino de fallback v5 del cache de la ruta. Fase 6 agrega `teamOpening` porque sin
   eso su propia función se rompe; arreglar los otros dos es un ticket propio, chico, fuera de
   alcance.
4. **El camino normal del pipeline (no apertura) sigue sin desempate por `heroId`.** Se agrega solo
   en la rama de apertura, donde los empates son la norma. Cambiar el orden del camino normal
   movería los números de sus pruebas actuales por una razón ajena a esta fase.
5. **`team_synergy` sigue devolviendo `raw: 0` (no `null`) para un héroe sin capacidades** —
   hallazgo de Fase 4.1 (§11.6), todavía sin ticket propio. Fase 6 no lo toca: no pasa por
   `mix.ts`.
6. **Cobertura de datos curados**: `capabilities.json` 124/126, `lane/hero-line-profiles.json`
   15/126, corpus 124 héroes distintos. Los tres huecos son reales y alcanzables. Completarlos es
   curación manual de dominio, no código — ticket aparte, y es el insumo que más subiría la calidad
   de `lane_score` en apertura, hoy prácticamente constante para el 88% del pool.
7. **`MAX_COUNTER_RELIEF` sigue vivo en `team-opener.ts`** (P9), y seguirá hasta que §13.15 diga lo
   contrario. Su retiro es un ticket posterior con su propio candado de regresión.
8. **`ENABLE_PRO_DRAFTER` sigue apagado por defecto.** Prenderlo —incluso solo para el caso de
   apertura— es el segundo `/blueprint` de §13.15, no una decisión de esta fase.

---

## 13.18 — Entrada para `/rulebook`

Fronteras naturales de ticket, en orden estricto de dependencia. **No son tickets todavía.** Cada
uno es compilable y testeable por sí mismo; ninguno deja el árbol roto esperando al siguiente, y
**ninguno cambia el comportamiento observable de producción** (el flag sigue apagado).

**Bloque A — piezas puras, nadie las consume todavía**

1. **`draft-paths/strategy.ts`**: mover `openingStrategy` desde `signals/mix.ts` (privada →
   exportada, cuerpo intacto) + importarla en `mix.ts`. Cambio mecánico, va **solo**, mismo criterio
   que TSK-047: si algo se rompe acá, es inequívocamente el movimiento. Criterio 10.
2. **`pipeline/phase-decay.ts` + `phase-decay.test.ts`**: `openingBlend`,
   `deriveContinuousPipelineWeights`, invariante de suma con `SUM_EPSILON`. Sin conectar a nada
   todavía. Criterio 7.
3. **`pipeline/meta-matchup.ts` + su prueba** (`createMetaMatchupWinrate`, índice `Map`, umbral
   200, `position` ignorada). Costura S2, fixture literal. Sin conectar.
4. **`pipeline/ban-relief.ts` + su prueba** (`createBanReliefWinrate`,
   `createPositionalCommitment`, `BETA_OPENING`, `POSITION_OVERLAP_GAIN`). Costuras S2 + S10,
   fixtures inyectados. **Incluye la prueba del ancla de P4**: candidato sin dato de posición →
   el término reproduce exactamente el alivio plano. Sin conectar.
5. **`extractCandidateStrategies` en `pipeline/feature-extractor.ts` + su prueba** (costura S9).
   `extractCandidateFeatures` no se toca. Depende del ticket 1.

**Bloque B — el pipeline aprende a abrir**

6. **`run-pipeline.ts`: 7º parámetro de opciones + pesos por fase + selección de fuente de
   matchups**, sin el modo apertura todavía. Es donde se actualizan los números trazados a mano de
   `run-pipeline.test.ts` (§13.4). Criterio 6. Depende de 2 y 3.
7. **`run-pipeline.ts`: el modo `teamOpening` completo** — guarda de apertura, KNN saltado,
   `denial_score` ban-aware, desempate por `heroId`, diversificación, `OPENING_TOP_N = 5`.
   **Es el ticket que resuelve la queja**: incluye los criterios 1, 2, 3, 4, 5, 8 y 9. Depende de
   4, 5 y 6.

**Bloque C — la ruta y los espejos**

8. **`server/routes/pro-drafter.ts` + `server/app.ts`**: `rank` ensanchado, `getMetaMatchups`,
   `heroCapabilities`, `computeV5Fallback` ensanchada, `fingerprint` con `teamOpening`,
   `buildFallbackSuggestions` sin el recorte a 3. Criterios 11, 12, 13. Depende de 7.
9. **Los dos espejos de `apps/web/features/pro-drafter/types.ts`** (`ProSuggestion.rank`,
   `LegacySuggestionSetResponse`). Chico y autocontenido, pero **debe ir en el mismo PR que el 8**
   o el espejo queda desincronizado — que es exactamente el fallo que §13.16-D documenta.

**Bloque D — evidencia**

10. **`scripts/evaluate-pro-drafter.ts`: modo de sensibilidad a bans** (§13.15) + corrección de la
    cabecera desactualizada (§13.16-E). Script manual, sin CI. Depende de 7 y 8.

**Variables de entorno**: ninguna nueva, ninguna retirada. `.env.example` no cambia.

`preferred_tool` sugerido: **`claude-code`** para los tickets 4, 7 y 10 (la fórmula calibrada, el
modo de apertura completo y la barra de evidencia — los tres viven en decisiones de este SPEC y
necesitan memoria del proyecto); **`codex`** es razonable para 1, 2, 3, 5, 8 y 9, que son acotados y
autocontenidos una vez escrito §13.4-§13.10. Ningún ticket de esta fase es candidato a
`hermes-vps`: todos tocan el motor de scoring, y ninguno es de volumen.

---

# SPEC — Fase 8 (Rehabilitar `counter`: base curada de counter-picks + shrinkage; + higiene de superficie)

Síntesis de `docs/agents/architecture.md` § "Fase 8" (`/pre-flight` completo, 2026-08-28) + la
consulta a DeepSeek (respuesta completa en el hilo de la sesión). Corrido en **Sonnet por
decisión del usuario** — la fase cruza un gatillo objetivo de Opus documentado en `CLAUDE.md`
(*discrepancia seria confirmada entre `SPEC.md` y el código real*: el SPEC describe `counter` como
señal activa de peso 0.216 y en la práctica devuelve `raw: null` en ~93% de los casos), pero el
usuario mantiene el flujo en Sonnet, igual que hizo en Fase 4.2/4.3. Anotado en `journal.md`.

Mismo estatuto que las fases anteriores: esto es contrato. Lo que no esté aquí, no es Fase 8.

## §14.0 — Alcance de este blueprint (leer primero)

- **§14.1 a §14.10 son contrato cerrado.** Números fijados. Las magnitudes calibradas (§14.6) son
  valores de arranque, ajustables tras el QA — mismo criterio que `w=0.10` en Fase 4.3, no "a
  confirmar antes de codificar".
- **§14.11 es lo que la fase deja abierto a propósito.**
- Dos bloques independientes: **8A** (rehabilitar `counter`, motor) y **8B** (higiene de superficie,
  `apps/web`). No comparten archivos; se pueden ejecutar en cualquier orden.

Lo que Fase 8 **no** es: no es un predictor completo de matchups; no modela counter-por-lane vs
counter-por-teamfight ni counters que dependen de un ítem en v1 (el schema deja lugar, no se
llena); no reabre `SCORING_WEIGHTS_V6` ni re-pondera `counter` (sigue 0.216); no cambia la
sincronización de meta (S6); no agrega STRATZ ni ninguna dependencia; no borra ninguna ruta ni
feature — 8B **oculta**, no resta.

## §14.1 — Qué de fases anteriores queda superado

| Antes | Fase 8 lo cambia a |
|---|---|
| `counter.ts`: `counterScorer` es un singleton de módulo | **Fábrica `createCounterScorer(curated, opts)`** — mismo patrón que `createPositionFitScorer`/`createTeamSynergyScorer` ya usan. Los llamadores en `mix.ts` cambian igual que cambiaron para esas dos. |
| `relationship-index.ts`: `RELATIONSHIP_MIN_GAMES = 200` es el umbral efectivo | Sigue exportado (V1/V2 congeladas por nombre, nadie lo edita), pero `counter.ts` llama a `createRelationshipIndex(matchups, COUNTER_MIN_GAMES)` con el valor bajo nuevo (§14.6). El default del módulo no se toca. |
| `CounterEvidence` | Gana **un campo aditivo**: `observedWinrate: number` (`wins/games`). Los consumidores actuales lo ignoran. |
| `counter.raw` = `mean(delta)` sobre rivales revelados con ≥200 partidas, o `null` | `mean(c_r)` sobre rivales **cubiertos** (por la capa curada **o** por la estadística con ≥`COUNTER_MIN_GAMES`), o `null` si ninguno está cubierto (§14.5). |
| `counter` no lee ningún archivo de dominio | Lee `signals/hero-counters.json` (nuevo, curado, S9), cargado una vez al iniciar el módulo (`MODULE_HERO_COUNTERS`, igual que `MODULE_HERO_POSITIONS`). |
| `apps/web` nav: 7 links | 4 links (Simulador · Mi pool · Meta · Configuración). Los otros 3 salen del array; rutas, código y tests intactos (§14.8). |

`SignalId`, `SCORING_WEIGHTS_V1`-`V6`, `RAW_RANGE.counter` (`[-0.12, 0.12]`), `applyDraftEvent`, el
orden de push, `weights.ts` entero — **no se tocan**.

## §14.2 — Decisiones cerradas

| # | Pregunta | Decisión (usuario, 2026-08-28) |
|---|---|---|
| Q1 | ¿Alcance de 8A? | **Las dos capas.** Base curada como piso (aditivo) **y** arreglar la capa estadística (umbral bajo + shrinkage + el módulo `pro/shrinkage.ts` que ya existe). Cubre hard counters (capa A) y la zona gris (capa B, ~50% de los drafts, hoy muda). |
| Q2 | ¿Quién arma `hero-counters.json`? | **Deep research** de conocimiento público estándar de Dota 2 para un borrador de ~30 héroes, que el usuario revisa y corrige antes del merge. No se scrapea Dotabuff. |
| Q3 | ¿8B? | Sacar del nav "Draft en vivo", "Equipos", "Héroes" — ruta y código quedan, sólo se ocultan (editar un array en `NavBar.tsx`). Nav activo cubre login + cuenta + pool + el flujo completo del simulador. |
| Q4 | ¿Se toca `RAW_RANGE.counter` o `weights.ts`? | **No.** `RAW_RANGE.counter` queda `[-0.12, 0.12]` y `M_HARD` se calibra a `0.12` para que un hard counter llegue al extremo sin re-escalar. `counter` mantiene su peso `0.216` en V6. Si el QA muestra que el piso queda corto, ampliar el rango es un follow-up con su propio candado. |
| Q5 | ¿Shrinkage hacia 0.5 o hacia el baseline del candidato? | **Hacia el baseline** (`shrinkEstimate(wr, games, baseline, P)`), para que una muestra chica tienda a `delta = 0` ("sin señal"), no a un offset fijo. `shrinkEstimate` ya soporta un `prior` arbitrario. |
| Q6 | ¿Ponderar además por la `confidence` de Wilson? | **No en v1.** Shrinkage y confidence-por-ancho-de-Wilson son ambos descuentos por tamaño de muestra — aplicar los dos sub-pondera. El campo `confidence` sigue disponible en `CounterEvidence` para un refinamiento futuro. |

## §14.3 — Costuras: ninguna nueva

- `counter` sigue siendo un `SignalScorer` puro → **S3** tal cual (función pura, archivo de prueba
  propio, aislado de las otras cinco señales).
- `hero-counters.json` cae en la **familia S9** (dato curado inyectado como fixture, **nunca leído
  real en una prueba** — mismo criterio literal que `capabilities.json` (S9) y `hero-positions.json`
  (S10)). No estrena número de costura, igual que Fase 4.1 no lo hizo al reutilizar S9.
- `shrinkEstimate` (`pro/shrinkage.ts`) es una función pura ya probada (TSK-165). No estrena
  costura.
- El candado de regresión cero se prueba a nivel **S3** (scorer aislado) **y** contra
  `buildSuggestions` completo (candado de pipeline, mismo criterio que Fase 3/4).
- **`S12` sigue reservada** (RNG de diversificación, Fase 4). Fase 8 no la toca.
- 8B no estrena costura: es un array de links.

## §14.4 — Contrato de datos: `signals/hero-counters.json` + `loadHeroCounters()`

**Archivo** (`apps/engine/src/signals/hero-counters.json`), keyed por la *víctima* (el héroe al
que le hacen counter):

```jsonc
{
  "59": [                                        // Huskar
    { "vs": 68, "level": "hard",   "why": "Ice Blast de Ancient Apparition bloquea toda tu curación y regeneración" },
    { "vs": 36, "level": "medium", "why": "Necrophos: Heartstopper Aura y Reaper's Scythe castigan tu vida alta" }
  ],
  "1": [                                          // Anti-Mage
    { "vs": 26, "level": "hard",   "why": "Doom te silencia y anula tu movilidad por 16 s" }
  ]
}
```

- `level`: `"hard"` | `"medium"` en v1. **Cualquier otro valor descarta la entrada** al cargar.
- `why`: string no vacío, es el texto que la UI muestra. Entrada sin `why` válido → descartada.
- `vs`: `HeroId`. Debe existir en el catálogo (`CURATED_HERO_IDS`, `validate-drafts.ts`) — si no,
  entrada descartada.

**`loadHeroCounters(): Map<HeroId, CuratedCounter[]>`** — mismo patrón que `loadHeroPositions()`:

- Valida en el borde: descarta entradas malformadas (sin `vs` entero, `level` fuera de la unión,
  `why` vacío, héroe duplicado en la lista de una víctima, `vs` desconocido).
- Archivo ausente, JSON inválido, o forma inesperada de raíz → **`Map` vacío**, nunca lanza. Un
  archivo corrupto degrada `counter` a "capa estadística sola", nunca tira el motor (criterio
  literal de `loadHeroPositions()` con archivo malformado).
- Exportada por separado para probarla con fixtures sintéticos, **jamás contra el archivo real**
  (S9: el archivo se cura por parche, un test atado a su contenido se rompe en silencio con cada
  corrección).

## §14.5 — Contrato de `createCounterScorer` y la fórmula de `raw`

```typescript
export interface CuratedCounter { vs: HeroId; level: "hard" | "medium"; why: string }

export interface CounterScorerOptions {
  minGames?: number;              // default COUNTER_MIN_GAMES (§14.6). El candado de regresión pasa 200.
  shrinkPriorStrength?: number | null; // default COUNTER_SHRINK_PRIOR_STRENGTH. `null` -> usa el delta crudo (candado de regresión).
}

export function createCounterScorer(
  curated: Map<HeroId, CuratedCounter[]>,
  options: CounterScorerOptions = {},
): SignalScorer;
```

`mix.ts`: `MODULE_HERO_COUNTERS = loadHeroCounters()` a nivel de módulo;
`createCounterScorer(options.heroCounters ?? MODULE_HERO_COUNTERS)` se ensambla por llamada dentro
de `buildSuggestions` (mismo lugar que `createPositionFitScorer`/`createTeamSynergyScorer`).
`BuildSuggestionsOptions` gana `heroCounters?: Map<HeroId, CuratedCounter[]>` (inyectable para
tests, ausente → el `Map` real; mismo patrón que `heroPositions?`/`heroCapabilities?`).

### `score(state, candidate, meta)`

1. `revealedRivals = observedDraftFacts(state).revealedEnemyPicks` (sin cambios).
2. Para cada `r` en `revealedRivals`, producir **como máximo una** contribución `c_r`:
   - **Capa curada** (tiene prioridad): si `curated.get(candidate)` incluye `{ vs: r, level }` →
     `c_r = -M[level]` (el candidato **está** counterado por `r`). Si `curated.get(r)` incluye
     `{ vs: candidate, level }` → `c_r = +M[level]` (el candidato **le hace** counter a `r`).
     Si ambos (raro), se suman y se sigue. `why` del/los match se guarda para la `explanation`.
   - **Capa estadística** (sólo si `r` no quedó cubierto por la capa curada en ninguna dirección):
     `rows = createRelationshipIndex(meta.matchups, minGames).counterRows(candidate, [r])`. Si
     `rows` está vacío (sin dato o `games < minGames`) → `r` **no aporta** (no cuenta para la
     media). Si hay fila:
     - `base = row.observedWinrate - row.delta` (baseline del candidato, derivado del campo nuevo).
     - `shrunkWinrate = shrinkPriorStrength === null ? row.observedWinrate : shrinkEstimate(row.observedWinrate, row.games, base, shrinkPriorStrength)`.
     - `c_r = shrunkWinrate - base`.  (Con `shrinkPriorStrength: null` esto es exactamente
       `row.delta`, el comportamiento de hoy.)
3. Sea `contribs` el array de `c_r` de los rivales **cubiertos** (capa curada o estadística con
   dato). Si `contribs` está vacío → `{ raw: null, sampleSize: 0, explanation: "Sin datos
   suficientes de enfrentamientos para este candidato", weighted: 0 }` (idéntico a hoy).
4. `raw = mean(contribs)`. `mix.ts` lo normaliza con `RAW_RANGE.counter = [-0.12, 0.12]` (sin
   cambios) — un `raw ≤ -0.12` (uno o varios hard counters) satura en el peor valor, correcto.
5. `sampleSize = Σ row.games` **sólo de los rivales resueltos por la capa estadística** (la capa
   curada no tiene muestra — reporta 0, mismo criterio que `team_synergy`/`archetype_fit`).
6. `explanation`:
   - Si hubo contribuciones curadas → se arma de los `why` (los negativos primero, hasta 2:
     `"AA bloquea tu curación con Ice Blast. Necrophos castiga tu vida alta."`). Los positivos
     ("Le ganás a X") se agregan si quedan.
   - Si sólo hubo capa estadística → el `buildExplanation` actual (`"Fuerte contra X y Y"` /
     `"Sin ventaja de contrapick conocida en este draft"`).

`weighted: 0` siempre — la mezcla es de `mix.ts`, sin cambios.

## §14.6 — Constantes calibradas (valores de arranque, ajustables tras el QA)

```typescript
// signals/counter.ts
const M: Record<"hard" | "medium", number> = { hard: 0.12, medium: 0.06 };
// hard = 0.12 -> un solo hard counter satura RAW_RANGE.counter en su extremo (el peor score
// posible para esa señal), sin necesidad de re-escalar el rango. medium = 0.06 -> mitad.
export const COUNTER_MIN_GAMES = 10;
// 200 recortaba el 92.7% de los pares; 10 cubre el 93% (medido) y coincide con el minimumSampleSize
// que pro/shrinkage.ts ya usa. Pares con <10 partidas siguen sin aportar (ruido puro incluso shrunk).
export const COUNTER_SHRINK_PRIOR_STRENGTH = 20;
// "partidas virtuales" al baseline del candidato. Una muestra de 42 partidas conserva ~68% de su
// delta; una de 200, ~91%; una de 10, ~33%. Más confiado que el 30 del pro-drafter porque acá
// SÍ queremos que la señal se active; menos que "sin descuento" para no dejar que 12 partidas
// griten.
```

`RAW_RANGE.counter` **no cambia**. `weights.ts` **no cambia**.

## §14.7 — Candado de regresión cero (obligatorio)

Dos pruebas, no una:

1. **Scorer aislado** (`counter.test.ts`): `createCounterScorer(new Map(), { minGames: 200,
   shrinkPriorStrength: null })` sobre los fixtures actuales de `counter.test.ts` (incluido el de
   "todos bajo 200 → `raw: null`" y el de deltas ≥200) devuelve **el mismo `raw` / `explanation`
   / `sampleSize` que hoy**, número por número. Prueba que la capa curada es 100% aditiva y que
   la re-parametrización estadística es una calibración deliberada, reversible dial-a-dial.
2. **Pipeline completo** (`mix.test.ts`): con `heroCounters` inyectado vacío y las opciones
   legacy, `buildSuggestions` sobre un fixture fijo produce el mismo ranking y los mismos
   `signals[].raw` de `counter` que antes de Fase 8. Mismo criterio que el candado de Fase 3
   contra Spectre+Wraith y el de Fase 4 contra `buildSuggestions`.

El test actual `"enemigos conocidos pero todos bajo 200 partidas -> raw: null"` **se reescribe**:
con los parámetros de producción (`minGames: 10`) esa misma fixture (150 y 199 partidas) ahora
produce un `raw` real shrunk; el caso `null` se prueba con muestras `< 10`.

## §14.8 — 8B: higiene de superficie

- **`apps/web/components/nav-bar/NavBar.tsx`**: el array de links pasa de 7 a **4**:
  `Simulador de Draft` (`/simulator`), `Mi pool` (`/hero-pool`), `Meta` (`/meta`),
  `Configuración` (`/settings`). Se quitan `Draft en vivo` (`/live-draft`), `Equipos`
  (`/team-groups`), `Héroes` (`/heroes`).
- La prop `draftLiveEnabled` de `NavBar` queda sin uso → se puede retirar de la firma o dejar
  (decisión de `@build`, ambas son válidas; retirarla es más limpio).
- **Rutas, componentes y tests de `/live-draft`, `/team-groups`, `/heroes` no se tocan.** Siguen
  alcanzables por URL directa. `/live-draft` ya renderiza `DraftUnavailablePage` con
  `DRAFT_LIVE_ENABLED` apagado (default), así que no hay cambio de comportamiento ahí.
- Redirects legacy (`/draft` → `/live-draft`, `/random-draft` → `/simulator`) quedan.
- **Overwolf / OCR**: ya dormidos (nunca construidos / spike sin correr). Se documenta
  explícitamente en el ticket que quedan en stand-by; no se toca `scripts/spikes/`.
- **Prueba**: `NavBar` renderiza 4 links; una prueba de humo confirma que
  `/team-groups`/`/heroes`/`/live-draft` siguen resolviendo por URL (sus suites siguen verdes,
  nada se rompió — sólo se ocultó).

## §14.9 — Seguridad (hereda el Bloque 4 de `/pre-flight`; §5)

- **Ninguna frontera de confianza nueva.** `hero-counters.json` es dato curado del repo, mismo
  perfil que `capabilities.json`/`hero-positions.json`: se valida en el borde al cargarlo
  (`loadHeroCounters()`), un archivo corrupto o manipulado degrada a "capa estadística sola"
  (`Map` vacío) — nunca inyecta magnitudes arbitrarias ni tira el motor. No cruza red ni proceso.
- La capa estadística lee `MetaSnapshot.matchups`, ya validado en la sincronización (S6). Sin
  cambios a esa frontera.
- **Cero red en el camino caliente, intacta.** `counter.ts` y `hero-counters.ts` viven bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` ya bloquea cualquier `fetch(` sobre el
  árbol completo. El JSON se carga una vez al iniciar el módulo.
- **Sin secreto nuevo, sin dependencia nueva, sin dato personal.** STRATZ queda fuera de alcance
  (mismo criterio que Fase 3). `shrinkEstimate` ya está en el repo.
- **8B no toca `proxy.ts` ni el gate de sesión.** Sacar links del nav no cambia qué rutas
  existen ni quién puede acceder — el perímetro de auth es el mismo.
- **No sustituye el gate de `/castoff`** — corre igual en cada deploy.

## §14.10 — Criterios de aceptación (Fase 8)

**8A:**

1. `bunx tsc --noEmit` limpio en `apps/engine`. `SignalId`, `SCORING_WEIGHTS_V1`-`V6`,
   `RAW_RANGE.counter` sin cambios. `RELATIONSHIP_MIN_GAMES` sigue exportado con su valor 200.
2. **Candado de regresión cero, dos pruebas** (§14.7): scorer aislado con opciones legacy
   reproduce hoy número por número; `buildSuggestions` con `heroCounters` vacío + opciones legacy
   no mueve el ranking.
3. **Capa curada — hard counter**: con `{ 59: [{ vs: 68, level: "hard", why: "..." }] }`
   inyectado y el héroe 68 en `state.picks` del rival, `counter.score(state, 59, meta)` da un
   `raw` fuertemente negativo (≤ `-M.hard` promediado) y `explanation` contiene el `why`. La
   dirección inversa (candidato 68, rival 59 revelado) da `raw` positivo.
4. **Capa estadística — zona gris**: sin entrada curada, dos candidatos con
   `observedWinrate`/`games` reales distintos sobre muestras de 30-100 partidas → `counter` los
   **diferencia** (ambos `raw` no nulos, ordenados por ventaja real) — donde hoy los dos son
   `raw: null`.
5. **Shrinkage**: un par de 12 partidas y un par de 180 partidas con el mismo `observedWinrate`
   producen `|c_r|` distinto (el de 12 partidas, mucho menor). Muestra `< COUNTER_MIN_GAMES` →
   ese rival no aporta.
6. **Degradación**: `hero-counters.json` corrupto → `loadHeroCounters()` devuelve `Map` vacío,
   `counter` cae a la capa estadística sola, cero excepción.
7. **Ninguna prueba lee `hero-counters.json` real** (S9) — fixtures inline.
8. **QA manual en el Simulador de Draft** (§14.11 del Bloque 6 de `architecture.md`), registrado
   en `journal.md`: pickear Huskar con un Ancient Apparition revelado del bot → el Copilot
   penaliza Huskar y el desglose de `counter` cita la mecánica; un caso de zona gris → `counter`
   ordena los candidatos en vez de quedarse mudo. Si el QA pide otras magnitudes → follow-up de
   calibración (no reabre este SPEC).

**8B:**

9. `NavBar` renderiza 4 links. `/team-groups`, `/heroes`, `/live-draft` siguen resolviendo por
   URL directa; sus suites de test siguen verdes sin cambios.
10. `bun test` verde en `apps/web` sin que ninguna prueba existente cambie de resultado (8B no
    cambia comportamiento, sólo visibilidad).

## §14.11 — Lo que Fase 8 deja abierto a propósito

- **`phase` (lane/teamfight), `requires_item`, `situational`, `magnitude` 0-1 por entrada** —
  campos futuros del schema de `hero-counters.json`, no se llenan en v1.
- **Validación / cuantificación de la lista curada contra datos grandes** (OpenDota Explorer,
  `fetch-expanded-matchups.ts` ya existe) — v2, no bloquea.
- **La lista completa de ~120 héroes** — v1 cubre los ~30 más pickeados; se expande
  incrementalmente.
- **Ponderar por la `confidence` de Wilson** además del shrinkage — refinamiento futuro (§14.2 Q6).
- **Re-balancear `SCORING_WEIGHTS_V6`** si tras el QA `counter` rehabilitado desequilibra la
  mezcla — sería un `V7` con su propio candado, fuera de esta fase.
- **STRATZ** — sin cambios desde Fase 1b: dependencia condicional futura, pasa por `/gear-up` si
  algún día se prioriza.

## §14.12 — Entrada para `/rulebook`

Bloques y orden de dependencia:

**8A — motor:**
1. `signals/hero-counters.ts` (`loadHeroCounters` + validación de borde) + `signals/hero-counters.json`
   **borrador de ~30 héroes por deep research** + su prueba con fixtures sintéticos. Es un ticket
   de dominio: el JSON lo revisa el usuario antes del merge. `preferred_tool: claude-code`.
2. `signals/relationship-index.ts`: agrega `observedWinrate` a `CounterEvidence` (1 línea,
   aditivo) + su prueba. `preferred_tool: codex` (acotado).
3. `signals/counter.ts`: `counterScorer` → `createCounterScorer(curated, opts)`, las dos capas,
   la fórmula de §14.5, las constantes de §14.6, reescritura de `counter.test.ts` + el candado de
   regresión aislado. Depende de 1 y 2. `preferred_tool: claude-code` (toca el scoring, decisiones
   de este SPEC, exige `@redteam`).
4. `signals/mix.ts`: `MODULE_HERO_COUNTERS`, ensamblado por llamada, `BuildSuggestionsOptions.heroCounters?`,
   candado de regresión de pipeline en `mix.test.ts`. Depende de 3. `preferred_tool: claude-code`.

**8B — apps/web (independiente de 8A):**
5. `components/nav-bar/NavBar.tsx`: 7 links → 4, prueba del render, humo de rutas. `preferred_tool: codex`.

**Variables de entorno**: ninguna nueva, ninguna retirada. `.env.example` no cambia.

## §14.13 — Addendum (post-QA): alivio por counters baneados

Decisión del usuario 2026-08-28, tras revisar el QA de 8A: `counter` gana un término **positivo**
que no depende de picks rivales revelados — **"tus counters están baneados = pick más libre"**.
Ejemplo: considerás Morphling, ves que Silencer (su hard counter) está baneado → el Copilot lo
marca a favor. Es aditivo sobre 8A, mismo `SignalId`/`RAW_RANGE.counter`/`weights.ts` sin tocar.

- **Fuente de dato**: `hero-counters.json` ya keyed por víctima — `curated.get(candidate)` es
  exactamente "quién counterea a este candidato". Se cruza con `observedDraftFacts(state).bannedHeroes`.
- **Vota desde el pick 1** — no necesita enemigos revelados. Es la 2ª señal (con `archetype_fit`)
  que discrimina con el draft casi vacío. `counter` deja de ser 100% `null` en picks tempranos.
- **Fórmula**: `banRelief = min(BAN_RELIEF_CAP, Σ BAN_RELIEF[level])` sobre las entradas de
  `curated.get(candidate)` cuyo `vs ∈ bannedHeroes`. Solo la dirección positiva (un counter tuyo
  fuera de la mesa) — no se modela "un héroe al que le ganás fue baneado".
- **Integración con el término de contrapick de 8A**: `meanRevealed` es el `mean(c_r)` de 8A
  (o `0` si no hay rivales cubiertos).
  - `banRelief === 0` → `raw = meanRevealed` **exactamente como 8A, sin clamp** (así el candado
    de regresión de §14.7 queda byte-idéntico — el fixture actual da `0.12222`, por encima de
    `M.hard`, y debe seguir dándolo).
  - `banRelief > 0` → `raw = clamp(meanRevealed + banRelief, -M.hard, M.hard)`.
  - `contribs` vacío **y** `banRelief === 0` → `raw: null` (idéntico a hoy).
  - `banRelief` no aporta a `sampleSize` (mismo criterio que la capa curada).
- **Constantes** (`counter.ts`, valores de arranque QA-tuneables, no reabren el SPEC):
  `BAN_RELIEF = { hard: 0.04, medium: 0.02 }`, `BAN_RELIEF_CAP = 0.06` (la mitad de `M.hard`).
- **`explanation`**: si hubo alivio → se agrega la cláusula `"N de sus counters están baneados:
  <nombres>"` (hasta 2 nombres). Si además hubo capa curada/estadística por rival revelado, la
  cláusula se **anexa** al texto de 8A. Si solo hubo alivio → es el texto completo.
- **Candado de regresión**: `createCounterScorer(new Map(), …)` sigue dando `banRelief = 0` (mapa
  curado vacío) → los dos candados de §14.7 se mantienen byte-idénticos sin cambios.
- Ticket: `TSK-188`, follow-up de 8A, `@redteam` obligatorio (toca el scoring activo). Entra en
  el mismo push que Fase 8.
