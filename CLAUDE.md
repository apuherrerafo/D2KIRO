# PROYECTO: dota2coach (Draft Coach) — Fase 4 en curso

## STACK ACTUAL
Definido por `/pre-flight` (`docs/agents/architecture.md`, Bloque 5) y cerrado por `/blueprint`
(`docs/specs/SPEC.md`, §0-D3). No modificar manualmente — si cambia, se regenera desde ahí.

Dos procesos locales, no uno:
- **`apps/engine`** (Bun): motor de sugerencias, WebSocket, SQLite. Escucha únicamente en
  `127.0.0.1`. Nunca llama a la red en el camino caliente del draft.
- **`apps/web`** (Next.js, App Router, TypeScript estricto): sitio + vista de draft en vivo.
  RTK Query para páginas normales; WebSocket + Zustand como única excepción para el draft en vivo.
  Tailwind + shadcn/ui.
- DB: SQLite + Drizzle ORM (solo en `apps/engine`).
- Testing: Bun Test.
- Despliegue: Railway.
- Captura de draft (fase 1): `simulator` y `manual` son capturadores de primera clase.
  `overwolf` y `ocr` quedan especificados como contrato, se construyen después (SPEC §0-D1).

**Nota de estado (2026-08-26)**: fases 1, 1b, 2 y 3 completas y en producción (Railway,
https://d2kiro-production.up.railway.app, auto-deploy sobre `master`), sin cambios de fondo desde
la nota anterior. **Fase 4 sigue en pausa, sub-ticket 4.1 completo** — señal `archetype_fit`
aislada (`TSK-089`), sin integrar al motor (4.2, sin fecha). **Fase 5 completa** ("MVP de
Producción: Auth & Personal Hero Pool multi-usuario"): los 13 tickets originales (`TSK-094` a
`TSK-106`) más el trabajo posterior de producto/infraestructura hasta `TSK-125` están `done` e
integrados en `master` — login real con Steam, esquema multi-cuenta, CI/CD (GitHub Actions +
Husky), y el motor Pro-Drafter (KNN + simulador de línea + decodificador de intención bayesiano,
`apps/engine/src/{pipeline,knn,lane,intent}/`) construido y probado, dark detrás de
`ENABLE_PRO_DRAFTER`. **Fase 6 en curso** ("Formalizar Pro-Drafter: apertura de equipo consciente
de bans", `docs/specs/SPEC.md` §13): origen — el top-5 de apertura del Copilot se sentía
repetitivo entre bans distintos porque el bono actual (`MAX_COUNTER_RELIEF=0.12` en
`team-opener.ts`) es chico frente al peso dominante de `position_fit`. `/pre-flight` y `/blueprint`
completos, `/rulebook` recién cerrado con 10 tickets (`TSK-126` a `TSK-135`, orden estricto de
dependencia) — le da al motor Pro-Drafter, ya construido pero nunca conectado a la apertura de
equipo, un camino real que reacciona al solapamiento posicional y la entropía de rol de los héroes
baneados, reutilizando `intent/denial-score.ts` sin editarlo. `ENABLE_PRO_DRAFTER` sigue apagado
por defecto durante toda la fase — nada de esto cambia el comportamiento observable de producción
hasta un segundo `/blueprint`, condicionado a un paquete de evidencia numérico (`TSK-135`). Cero
código de esta fase escrito todavía. Ver `docs/agents/PROGRESS.md` para el estado exacto y el
siguiente paso.

## COMANDOS ESENCIALES
- `bun run dev` → Iniciar servidor de desarrollo.
- `bun test` → Ejecutar pruebas unitarias.
- `bun run lint` → Formatear código.
- `bash scripts/verify-simplicity.sh` → Verificar seguridad, invariantes y calidad antes de un commit.
- `bun scripts/hub.ts` → Regenerar el tablero desde los tickets.

## REGLAS INVIOLABLES
Los gates técnicos de seguridad, invariantes, tipos y pruebas se codifican en `scripts/verify-simplicity.sh`.

- **Política de dependencias por categoría (Governance 2.0, 2026-08-24):** una `dependency` de
  producción nueva (`package.json` → `dependencies`) sigue exigiendo pasar por `/gear-up` o
  `@depcheck` y marcarse `// ALLOWED` — es lo que termina en el bundle/runtime real. Una
  `devDependency` nueva (tooling de infraestructura rutinaria del stack Bun — p. ej.
  `better-sqlite3`, `typescript`, linters, generadores de tipos) tiene **bypass total**: no exige
  ticket de excepción, comando previo ni marca `// ALLOWED`. Verificado mecánicamente en
  `scripts/verify-simplicity.sh` (sección 3), que distingue la clave exacta del `package.json`.
- Está permitido modificar todos los archivos y líneas técnicamente necesarios para completar una
  tarea o refactorización limpia e integral. No se requiere una excepción ni confirmación por el
  tamaño de un cambio.
- **WIP = 1**: solo una tarea puede estar en estado `doing` a la vez.
- Prohibido refactorizar archivos no relacionados con la tarea.
- Cada cambio debe traducirse a lenguaje producto: "Esto significa que ahora...".

## SEGURIDAD DESDE EL DISEÑO
No es un checklist al final. Es un gate que bloquea.

- Todo input externo se valida antes de tocar la lógica de negocio (formularios, query params, body de API).
- Toda query a la base de datos es parametrizada vía Drizzle. Nunca strings concatenados.
- Todo HTML insertado dinámicamente (HTMX) se escapa. Cero `innerHTML` con datos sin sanear.
- Los secretos viven únicamente en variables de entorno (`process.env`). Un literal sospechoso en el diff es FAIL automático en `verify-simplicity.sh` y en Sentinel.
- Cada agente y skill declara solo las `tools` que necesita (mínimo privilegio). Ver tabla de agentes abajo.
- `/castoff` es obligatorio antes de cualquier deploy y no se puede saltar dentro del flujo automatizado.
- La dimensión de seguridad en `@redteam` es un gate binario (bloquea si falla), no un ítem ponderado entre cinco.

## REGLAS DE FASE 1 (dota2coach) — desde `docs/specs/SPEC.md`
Generadas por `/rulebook` a partir del contrato de desarrollo. Detalle completo y condicional por
tipo de archivo en `.claude/rules/` (`engine.md`, `web.md`, `security.md`, `testing-seams.md`) —
esta sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **Cero red en el camino caliente**: el motor de sugerencias (`apps/engine`, C3) nunca llama a
  la red. Todo lo que necesita ya está en SQLite antes de que empiece el draft.
- **`apps/engine` solo en `127.0.0.1`.** Un binding a `0.0.0.0` es FAIL automático de revisión.
- **`raw: null` nunca es 0 ni 0.5.** Una señal sin datos suficientes no vota neutro — su peso se
  redistribuye proporcionalmente entre las señales que sí tienen dato.
- **Un `SignalScorer` que lanza excepción no tira el motor.** Esa señal cuenta como `raw: null`;
  las otras tres siguen. Corte duro a 500 ms de cálculo total.
- **`applyDraftEvent` es pura**: sin I/O, sin reloj ni ids propios — se inyectan como parámetros.
  Un evento rechazado nunca tira la sesión (se devuelve `RejectionReason`, el estado anterior sigue
  siendo válido).
- **Orden de push por WebSocket, siempre**: `draft_state` antes que `suggestions`.
- **`POST /ingest/draft-event`** exige la cabecera `x-capture-token` (generada en runtime, leída de
  `process.env`) y limita a 20 eventos/segundo por sesión — el exceso se descarta con `429`.
- **`dangerouslySetInnerHTML` prohibido** en toda la app (`apps/web`). Los nombres de héroe de
  OpenDota son input externo, se tratan como texto no confiable.
- **`img_url` de héroe**: se valida que el host esté en la lista permitida del CDN de Valve antes
  de renderizar — nunca una URL arbitraria de la respuesta de la API.
- **Sincronización con OpenDota (S6) es transaccional por tabla.** Un 429/caída de OpenDota nunca
  deja un draft sin sugerencias — se sigue usando el cache viejo con `degraded: stale_meta`.
- **Los pesos de señales viven en una sola constante versionada** (`SCORING_WEIGHTS_V1`); una
  prueba unitaria verifica que suman `1.0`.
- **No se modela la tabla de turnos de Valve en fase 1** — el orden de bans vive como datos
  (`DraftFormat`), nunca como lógica adivinada en el reductor.

## REGLAS DE FASE 1b (hero pool) — desde `docs/specs/SPEC.md` §9
Generadas por `/rulebook`, segunda ejecución del proyecto. Detalle completo en `.claude/rules/`
(secciones "Fase 1b" añadidas a `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — esta
sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **`applicable: false` no es `raw: null`.** El pool sin configurar hace que `hero_pool_fit`
  devuelva `applicable: false` — no cuenta para la confianza ni dispara `partial_signals`, pero se
  muestra en el desglose igual que cualquier otra señal.
- **`SCORING_WEIGHTS_V1` no se toca.** `hero_pool_fit` vive en `SCORING_WEIGHTS_V2` (5 pesos, suma
  `1.0`). Con el pool sin configurar, la redistribución de `mix.ts` debe reproducir exactamente los
  pesos de v1 — regresión cero demostrada por prueba, no prometida.
- **`account_id` de Steam es el primer dato personal del proyecto.** Validado en el borde (Steam32:
  solo dígitos, `1`–`4294967295`). Prohibido loguearlo o ecoarlo en cualquier error, `journal.md`,
  ticket o `/api/health`.
- **`PUT /api/hero-pool` reemplaza el pool completo en una sola transacción.** Nunca queda un pool
  a medio escribir.
- **La propuesta de "calcular desde mis partidas" nunca se auto-aplica.** Confirmar, editar antes
  de confirmar, o descartar — las tres únicas acciones. Descartar nunca escribe.
- **`POST /api/hero-pool/calculate` no es camino caliente.** Toca red hacia OpenDota, pero vive en
  configuración — la regla de cero red durante el cálculo de sugerencias por pick sigue intacta.
- **Predicción de rol/posición del rival: fuera de alcance de 1b.** Documentada como dependencia
  condicional de STRATZ (contrato de señal descrito en `architecture.md`), no se construye hasta
  que se priorice explícitamente y pase por `/gear-up`.

## REGLAS DE FASE 3 (posiciones reales) — desde `docs/specs/SPEC.md` §10
Generadas por `/rulebook`, tercera ejecución del proyecto. Detalle completo en `.claude/rules/`
(secciones "Fase 3" en `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — esta sección
son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **`roles[]` de OpenDota NO son posiciones.** 57% de los héroes están etiquetados `"Carry"`
  (Zeus, Axe, Tidehunter incluidos), 38% `"Support"`. Prohibido usarlos para razonar sobre
  posición, cobertura de rol o solapamiento de farm — para eso existe `hero-positions.json`.
  Este error, no detectado durante 3 fases, es exactamente lo que originó esta fase.
- **`role_gap` y `role_safety` dejan de existir**, fusionadas en `position_fit`. La intención de
  producto de `role_safety` (support primero, revelar el core después) se conserva completa; lo
  que se descarta es su implementación sobre etiquetas y su ventana dura de 2 picks.
- **`SCORING_WEIGHTS_V5` es la activa; V1/V2/V3/V4 quedan congeladas por nombre.** V4 fue la que
  introdujo `position_fit` en esta fase (reemplaza dos señales por una, no hay estado "sin
  configurar" que reproducir, así que el candado de regresión cero de V2/V3 **no aplica** a
  ninguna de las dos). V5 (auditoría 2026-08-22, TSK-065) no agrega ni quita señales sobre V4 —
  recalibra `RAW_RANGE.counter` (nunca medido contra datos reales) y sube `position_fit` de 0.25 a
  0.38 tras confirmar que un hard counter real casi empataba con un core que repite rol ya
  cubierto. Prueba unitaria obligatoria en toda versión: los 5 pesos suman `1.0`.
- **`position_fit` es señal ponderada, nunca filtro duro.** Un héroe que repite rol puntúa
  `raw: 0`; no se elimina de `candidatePool`, que solo descarta por hechos binarios.
- **El contrato `SignalScorer.score()` no se modifica** — el dato entra por fábrica y por
  `BuildSuggestionsOptions.heroPositions?`, mismo patrón que `now?`/`metaIsStale?`.
- **`hero-positions.json` se valida en el borde al cargarlo.** Umbral de 200 partidas por
  posición, no negociable en silencio. Archivo corrupto → "sin datos", nunca tira el motor.
- **El motor nunca llama a la red por este dato.** El script de regeneración corre a mano, fuera
  de `apps/engine`. Cero dependencias nuevas: el navegador headless vive fuera del `package.json`.
- **`SignalId` está espejado a mano en `apps/web`** — cambiar el set de señales del motor sin
  mover ese espejo en el mismo cambio rompe el tipado.

## REGLAS DE FASE 4 (sub-ticket 4.1 — señal `archetype_fit`) — desde `docs/specs/SPEC.md` §11
Generadas por `/rulebook`, cuarta ejecución del proyecto. **Alcance deliberadamente parcial**: solo
el sub-ticket 4.1 pasó por `/blueprint` — las otras 3 piezas de la fase y los sub-tickets 4.2-4.8
quedan documentados a nivel conceptual (sin números) hasta que cada uno tenga su propio
`/blueprint`. Detalle completo en `.claude/rules/` (secciones "Fase 4" en `engine.md`,
`security.md`, `testing-seams.md`) — esta sección son los puntos que no se pueden violar sin
romper el contrato de 4.1, resumidos:

- **`archetypeFitBonus` se reutiliza desde `draft-paths/build-paths.ts`, nunca se reimplementa.**
  El concepto de arquetipo (`push`/`teamfight`/`pickoff`/`scaling`) ya existía en el motor desde
  Fase 2 ("Caminos de draft") — el diseño original de esta fase iba a curar un
  `archetype-affinity.json` nuevo; se descartó al descubrir la función existente.
- **La normalización a `[0, 1]` ocurre dentro de `archetype-fit.ts`, nunca en `RAW_RANGE` de
  `mix.ts`.** `archetypeFitBonus` no tiene escala uniforme entre arquetipos (0-2 salvo pickoff,
  0-3) — un solo rango en `RAW_RANGE` no puede servir para los cuatro sin normalizar antes.
- **`SignalId` NO se amplía en 4.1** — haría que `SCORING_WEIGHTS_V4`/`V5` (congeladas, `Record`
  totales) dejen de compilar. 4.1 usa una vista de tipo derivada que desaparece sola en 4.2.
- **`capabilities.json` no tiene cobertura completa** (124/126 héroes) — la rama `raw: null` por
  falta de dato es alcanzable hoy, no defensiva. No se completa en 4.1.
- **4.1 no toca `mix.ts`, `weights.ts` ni `apps/web`** — el motor no cambia de comportamiento
  todavía. `SCORING_WEIGHTS_V5` sigue siendo la única activa.
- **Hallazgo real, fuera de alcance**: `team_synergy` devuelve `raw: 0` (no `null`) para un héroe
  sin capacidades — viola la regla dura de `engine.md`. Ticket aparte, no se corrige en 4.1.

## REGLAS DE FASE 4.2 (integrar `archetype_fit` al motor) — desde `docs/specs/SPEC.md` §11.13
Generadas por `/rulebook`. `/blueprint` corrido en Sonnet por decisión explícita del usuario
(2026-08-28) — desviación consciente de la política de modelos, anotada en `journal.md`. Alcance:
`archetype_fit` pasa de señal aislada (4.1) a la **sexta señal ponderada** de `buildSuggestions`.
El selector de intención en `apps/web`, el transporte (request de sugerencias + `hello` del WS) y
la validación de borde de ese input son **4.3**, no 4.2. Detalle completo en `.claude/rules/`
(secciones "Fase 4.2" en `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — resumen de lo
no negociable:

- **`SCORING_WEIGHTS_V6` es la constante activa.** V1-V5 congeladas por nombre, sin editar un
  valor. 6 pesos, suman `1.0` (prueba obligatoria). `archetype_fit: 0.10`; los otros 5 = su valor
  de V5 × `0.90` exacto. Ese `0.90` es un ancla, no una perilla: garantiza que con
  `archetype_fit` sin voto la redistribución proporcional de `mix.ts` reproduzca V5 **al bit**
  (candado de regresión cero, tipo V1→V2 de 1b, probado con números concretos en `mix.test.ts`).
- **Antes de ampliar `SignalId`, `SCORING_WEIGHTS_V4`/`V5` se re-tipan con literales históricos
  propios** (`Record<SignalIdV5, number>`, mismo mecanismo que TSK-045). Sin ese paso previo, no
  compila.
- **`SignalId` gana `"archetype_fit"`.** Los alias `ArchetypeFitContribution`/`ArchetypeFitScorer`
  de `archetype-fit.ts` se borran; el cuerpo de `score()` no cambia una línea.
- **`RAW_RANGE.archetype_fit = [0, 1]`** (`raw` ya normalizado dentro del scorer).
- **`BuildSuggestionsOptions.archetypeIntent?: DraftPathArchetype`.** Ausente → `applicable: false`
  (nunca vota, nunca baja la confianza). En 4.2 lo fija sólo el llamador dentro del proceso.
- **Sin decaimiento en 4.2.** La señal sigue constante por `(intent, hero)` — el ajuste por picks
  tardíos es calibración de 4.3, sin dependencia de `DraftState` en el scorer.
- **`position_fit` sigue siendo el peso más alto** (`0.342`). Fase 3 no se reabre.
- **Espejo de `apps/web` en el mismo cambio** (4 archivos: `types.ts`, `validation.ts`,
  `constants.tsx`, `SignalBreakdown.tsx`), o `tsc` de `apps/web` rompe. `SignalBreakdown` pasa a
  **6 filas**; etiqueta visible de la señal: **"Intención de draft"**.
- **4.2 no toca `intent/`, `pipeline/`, `knn/`, `lane/` ni `ENABLE_PRO_DRAFTER`.**
- Un solo ticket, `simplicity_exception: true` (~9-10 archivos: motor + espejo `apps/web` + dos
  candados de prueba). Nunca se recorta una prueba obligatoria para entrar en un límite.

## REGLAS DE FASE 4.3 (`archetype_fit` usable: selector + transporte) — desde `docs/specs/SPEC.md` §11.14
Generadas por `/rulebook`. `/blueprint` corrido en Sonnet por decisión explícita del usuario
(2026-08-28), anotada en `journal.md`. Alcance: hacer usable la señal que 4.2 dejó integrada pero
inerte — selector de intención en `apps/web` + transporte de esa elección al motor + validación de
borde + QA de calibración. Detalle en `.claude/rules/` (secciones "Fase 4.3" en `engine.md`,
`web.md`, `security.md`, `testing-seams.md`) — resumen de lo no negociable:

- **Transporte = mensaje WS `set_intent` + `SessionStore.archetypeIntent` por sesión**, mismo
  patrón que `ownerAccountId`. `computeSuggestionsForState` lo lee del store, así **todos** los
  caminos en vivo (hello, cada draft-event, reconexión) lo respetan sin tocarlos uno por uno.
  **Sin ruta HTTP nueva.** `POST /api/suggestions/preview` gana `archetypeIntent?` opcional en su
  contrato (lo usa el bot/panel, no la vista en vivo).
- **Nueva frontera de confianza**: `archetypeIntent` llega del cliente → se valida en el borde
  contra la unión cerrada de 4 literales (`isValidClientMessage` rama `set_intent`,
  `isValidSuggestionsPreviewRequest`) **antes** de tocar `SessionStore`/`buildSuggestions`.
  Inválido → mensaje descartado (WS) o `400` (HTTP). Cierra el hallazgo #2 de `@redteam` en
  TSK-180 (`raw: NaN`). `@redteam` obligatorio.
- **El selector aparece también en `esperando_draft`** (fijar dirección antes del pick #1),
  además de `activo`/`degradado`. Componente nuevo `<DraftIntentSelector>` — color por rol
  semántico + escala de 4 px, ni un hex/px suelto. Terminología: "intención de draft", "Push /
  Teamfight / Pickoff / Scaling"; nunca "arquetipo" a secas en texto visible.
- **`set_intent` dispara sólo `suggestions`** (el tablero no cambió) — excepción explícita al
  orden de push, como `draft_paths`. `set_intent` con el mismo valor almacenado es no-op.
- **La intención vive en `SessionStore` (memoria, TTL 45 min)**, nunca en SQLite, nunca logueada.
  Sobrevive reconexión del cliente; un reinicio del motor la pierde (el cliente la re-envía tras
  `hello`).
- **4.3 no toca `signals/` ni `SCORING_WEIGHTS_V6`.** Si el QA (§11.14.8) pide otro `w`, follow-up
  que acuña `SCORING_WEIGHTS_V7` con la misma estructura `V5 × (1 − w)` y su candado de regresión
  cero re-corrido.
- **Costura S5** (ya existente), ninguna nueva. Un solo ticket, `simplicity_exception: true`
  (~10-12 archivos: `server/` + transporte y componente en `apps/web`). El QA de calibración es un
  paso manual dentro del mismo ticket.

## REGLAS DE FASE 5 (Auth & Personal Hero Pool multi-usuario) — desde `docs/specs/SPEC.md` §12
Generadas por `/rulebook`, quinta ejecución del proyecto. Alcance: login real con Steam (OpenID
2.0), esquema multi-cuenta, y personalización de `hero_pool_fit` por usuario real — no solo el
propio desarrollador. Detalle completo en `.claude/rules/` (secciones "Fase 5" en `engine.md`,
`security.md`, `web.md`, `testing-seams.md`) — esta sección son los puntos que no se pueden violar
sin romper el contrato, resumidos:

- **`apps/engine` sigue en `127.0.0.1`, sin excepción.** El callback de Steam OpenID necesita una
  URL pública — solo puede terminar en `apps/web`. `apps/engine` nunca ve el login directamente,
  solo el `accountId` ya verificado vía `x-account-token`.
- **`check_authentication` de Steam es obligatorio, no opcional.** Sin esa verificación server-a-
  servidor, cualquiera puede fabricar un "login exitoso" con el `steamid64` que quiera — es la
  vulnerabilidad real y documentada de `passport-steam`, la librería más popular para esto. Por eso
  el protocolo se implementa a mano, sin Passport.
- **La conversión SteamID64 → Steam32 exige `BigInt`, nunca aritmética `Number`.** El offset
  (`76561197960265728`) excede `Number.MAX_SAFE_INTEGER` — con `Number()` la resta pierde precisión
  y mapea al usuario a la cuenta de otra persona, **sin ningún error**. Prueba dedicada obligatoria.
- **`buildMetaSnapshot(db, accountId)` — `accountId` es obligatorio, nunca opcional con default.**
  Evita el mismo tipo de bug silencioso que dejó `hero_pool_fit` inerte desde Fase 1b hasta TSK-064.
- **El cache de meta está partido en dos capas** (compartida + overlay por cuenta), nunca un
  `Map<accountId, MetaSnapshot>` de snapshots completos — medido contra la base real: lo que varía
  por cuenta son 5 filas y un número, no las 17 000 filas de meta pública.
- **`accountId` nunca se acepta desde el cuerpo o el query de una request** — sale exclusivamente
  del token verificado (`x-account-token` en HTTP, `accountToken` en el `hello` de WebSocket).
- **`PRAGMA foreign_keys` sigue apagado** — el aislamiento entre cuentas lo da el `WHERE
  account_id = ?` de cada query, nunca la constraint de la FK.
- **`hero_pool` pasa a PK compuesta `(accountId, heroId)`; `team_groups` gana `accountId` nullable
  (sin cirugía de PK); `team_members` hereda el scope vía `teamGroupId`, sin columna propia.**
- **Basic Auth (`proxy.ts`) se retira por completo** — el login de Steam es el único gate de acceso
  al sitio. Nunca conviven los dos mecanismos.
- **Ningún `accountId`/Steam32 se loguea, se ecoa en un error, ni aparece en `journal.md`/tickets**
  — regla de 1b, ahora vale para todas las cuentas, no solo la del desarrollador.
- **Fase 5 no expone el WebSocket del motor a la red** — decisión explícita de alcance, no una
  laguna. Un usuario remoto tiene cuenta y pool guardado, pero las sugerencias en vivo siguen
  dependiendo del motor local del propio visitante.
- **Dos secretos nuevos, ambos `process.env`**: `SESSION_SECRET` (`iron-session`) e
  `INTERNAL_AUTH_SECRET` (HMAC del token interno). Steam OpenID no exige credencial del sitio.
- **`iron-session` es la única dependencia de producción nueva** — pasa por `/gear-up`/`@depcheck`.

## REGLAS DE FASE 6 (Formalizar Pro-Drafter: apertura consciente de bans) — desde `docs/specs/SPEC.md` §13

Generadas por `/rulebook`, sexta ejecución del proyecto. Alcance: darle al motor Pro-Drafter (ya
construido, dark detrás de `ENABLE_PRO_DRAFTER`) un camino real de apertura de equipo, que hoy no
existe (`TOP_N=3` hardcodeado, `denial_score` degrada a null sin picks rivales). Detalle completo
en `.claude/rules/` (secciones "Fase 6" en `engine.md`, `security.md`, `testing-seams.md`,
`web.md`) — esta sección son los puntos que no se pueden violar sin romper el contrato, resumidos:

- **`SignalId`/`SCORING_WEIGHTS_V1`-`V5` no se tocan.** Toda dimensión nueva vive en
  `pipeline/merge.ts`'s `PipelineSignalId`, ya separado — el término ban-aware alimenta el `raw`
  de `denial_score`, no agrega una cuarta clave.
- **`intent/denial-score.ts` no se edita.** Se formaliza reutilizándolo contra héroes baneados
  (nuevo `pipeline/ban-relief.ts`), nunca reimplementando la fórmula.
- **Sin tabla `heroSynergy` ni recolección de sinergia de aliados nueva** — mismo precedente que
  Fase 4 (OpenDota no expone ese endpoint, verificado dos veces).
- **Sin Python, sin runtime nuevo.** Bun/TypeScript únicamente, cero dependencia nueva.
- **`MAX_COUNTER_RELIEF` de `team-opener.ts` no se retira en esta fase** — sigue siendo el único
  camino de apertura con el flag apagado (el default). Su reemplazo depende del paquete de
  evidencia (`TSK-135`) y de un segundo `/blueprint`, más angosto.
- **`ENABLE_PRO_DRAFTER` sigue apagado por defecto durante toda la fase.** Ningún ticket de esta
  fase cambia el comportamiento observable de producción.
- **`POSITION_OVERLAP_GAIN=5` es un ancla matemática, no una perilla**: garantiza que un candidato
  sin dato de posición reproduzca exactamente el alivio plano actual. `BETA_OPENING=0.04` sí es una
  perilla de producto real, ajustable tras ver el resultado.
- **El umbral `MIN_MATCHUP_GAMES=200` recorta el 92.5% de los matchups reales** (1200 de 15984
  filas) — la causa raíz de "los bans no mueven nada" no es solo el bono chico, es que el dato que
  lo dispara casi nunca existe.
- **El candado de sensibilidad (dos conjuntos de bans producen un top-5 medible mente distinto) se
  prueba contra el pipeline completo, nunca contra el adaptador aislado** — mismo criterio que ya
  exigen Fase 3 y Fase 5.
- **`openingStrategy` tiene una sola implementación**, movida a `draft-paths/strategy.ts` — una
  segunda copia es rechazo automático de revisión.

## REGLAS DE FASE 8 (rehabilitar `counter` + higiene de superficie) — desde `docs/specs/SPEC.md` §14
Generadas por `/rulebook`. `/blueprint` corrido en Sonnet por decisión del usuario (gatillo de
Opus documentado — discrepancia seria `SPEC.md` ↔ código real en `counter` — anotado en
`journal.md`). Alcance: `counter` devuelve `raw: null` en ~93% de los casos porque
`RELATIONSHIP_MIN_GAMES=200` recorta el 92.7% de los matchups reales (caso real: recomienda Huskar
de último pick contra un Ancient Apparition revelado). Fase 8 lo arregla con dos capas + reduce el
nav a la superficie que se usa. Detalle en `.claude/rules/` (secciones "Fase 8" en `engine.md`,
`web.md`, `security.md`, `testing-seams.md`) — resumen de lo no negociable:

- **Alcance estrictamente aditivo + candado de regresión cero.** `SignalId`, `SCORING_WEIGHTS_V1`-
  `V6`, `RAW_RANGE.counter` (`[-0.12, 0.12]`), `weights.ts` — **no se tocan**. Dos pruebas
  obligatorias: `createCounterScorer(new Map(), { minGames: 200, shrinkPriorStrength: null })`
  reproduce el `raw`/`explanation`/`sampleSize` de hoy número por número; `buildSuggestions` con
  `heroCounters` vacío + opciones legacy no mueve el ranking.
- **`counterScorer` (singleton) → fábrica `createCounterScorer(curated, opts)`** — mismo patrón
  que `createPositionFitScorer`/`createTeamSynergyScorer`. `mix.ts` lo ensambla por llamada,
  `MODULE_HERO_COUNTERS = loadHeroCounters()` a nivel de módulo,
  `BuildSuggestionsOptions.heroCounters?` inyectable para tests.
- **Capa curada `signals/hero-counters.json`** — keyed por víctima, `{ vs, level: "hard"|"medium",
  why }`. S9: loader validado (`loadHeroCounters()`), archivo corrupto/ausente → `Map` vacío,
  nunca tira el motor, nunca se lee real en un test. Piso **bidireccional**: te counterean →
  `-M[level]`; counterás a un rival → `+M[level]`. `M.hard = 0.12` (satura `RAW_RANGE.counter`
  sin re-escalar), `M.medium = 0.06`.
- **Capa estadística — sólo para rivales NO cubiertos por el curado.** `COUNTER_MIN_GAMES = 10`
  (se pasa a `createRelationshipIndex`; el default 200 del módulo **no se toca**). Shrinkage hacia
  el **baseline del candidato** vía `shrinkEstimate` (`pro/shrinkage.ts`, ya existe, TSK-165),
  `COUNTER_SHRINK_PRIOR_STRENGTH = 20`. `CounterEvidence` gana `observedWinrate` (1 línea
  aditiva). `relationship-index.ts` **sin cambios estructurales**.
- **`raw = mean(c_r)`** sobre los rivales cubiertos (curado o estadística con ≥10 partidas);
  `null` si ninguno está cubierto (idéntico a hoy). `sampleSize` = Σ `games` sólo de la capa
  estadística; la curada reporta 0 (mismo criterio que `team_synergy`/`archetype_fit`).
- **`explanation`**: si hubo capa curada → se arma de los `why`; si no → el `buildExplanation`
  actual.
- **Ninguna dependencia nueva, sin STRATZ, sin variable de entorno nueva, cero red en el camino
  caliente** (el JSON se carga una vez al iniciar el módulo).
- **8B — nav de `apps/web` pasa de 7 links a 4**: Simulador · Mi pool · Meta · Configuración. Se
  quitan `Draft en vivo`, `Equipos`, `Héroes` del array de `NavBar.tsx` — **ruta, código y tests
  intactos**, alcanzables por URL directa. Reversible. Overwolf/OCR quedan en stand-by
  documentado. 8B no cambia comportamiento: ninguna prueba existente cambia de resultado.
- Las magnitudes de §14.6 son **valores de arranque, ajustables tras el QA** en el simulador
  (mismo criterio que `w=0.10` en Fase 4.3) — un cambio no reabre `SPEC.md` §14.

## REGLAS DE FASE 9 (V6-medido → V6-contextual: evaluación offline, calibración empírica, inteligencia contextual) — desde `docs/specs/SPEC.md` §15

Generadas por `/rulebook`, décima ejecución del proyecto. `/blueprint` corrido en **Opus** (gatillo
documentado: cambia el mecanismo de normalización de señales + el contrato `SignalContribution` +
estrena `SCORING_WEIGHTS_V7`). Origen: 3 informes externos consolidados en
`docs/research/fase9-research-consolidation.md` (48 ideas, IDs `R1-1`…`R3-15`, trazabilidad
mecánica §8). Detalle completo en `.claude/rules/` (secciones "Fase 9" en `engine.md`, `web.md`,
`security.md`, `testing-seams.md`) — resumen de lo no negociable:

- **Programa 9.0→9.5. Sólo 9.0 está especificada a nivel ejecutable** (§15.0); 9.1 tiene el
  mecanismo fijado con números diferidos a su gate; 9.2–9.5 son conceptuales y cada una abre su
  `/blueprint` angosto. Fijar hoy un `P05`/`P95` sería inventarlo — mismo precedente que Fase 4
  §11.10.
- **9.0 no cambia una línea de `apps/engine/src/**` ni `apps/web/src/**`** — criterio de aceptación
  verificable con `git diff --name-only`. No toca `signals/`, `weights.ts`, `mix.ts`, `RAW_RANGE`,
  `SignalId`, `SCORING_WEIGHTS_V6`. `ENABLE_PRO_DRAFTER` y el comportamiento de producción quedan
  idénticos durante toda la fase.
- **Dos benchmarks separados** (§15.4.3): **Engine Quality** (principal, Golden Dataset graduado,
  titular **NDCG@5** + Bad Pick Rate@5 + Pairwise Accuracy) y **Professional Pick Agreement**
  (secundario, Recall@1/3/5/10 + MRR sobre 2.164 replays). El pick profesional **no es ground
  truth**; el benchmark secundario **nunca** se llama "accuracy" ni "qué tan bueno es el motor".
  Ambos **segmentados por contexto de decisión y por `tier`**.
- **`ConstraintViolationRate = 0` es un gate duro**, no una métrica ponderada: una recomendación de
  héroe baneado/pickeado/inexistente invalida la corrida entera.
- **No existe snapshot de meta point-in-time** (§15.1 C4): el backtest es **comparativo, nunca
  predictivo**; el valor absoluto de cualquier métrica no significa nada sin sus baselines.
- **`raw: null` sigue siendo sagrado** — nunca 0, 0.5 ni 50. 9.1 cambia cómo se propaga su
  ausencia (fin de la redistribución candidate-specific), no que se rellene.
- **Harness (paquete completo, R3)**: `eval/` + `data/{curated,generated,schemas,metadata}/` +
  `docs/adr/` + hook de frontera de datos + `write_scope` por ticket + su hook PreToolUse + regla
  de paralelismo (`writeScope(A) ∩ writeScope(B) = ∅` ∧ sin `blocked_by` ⇒ `isolation: worktree`) +
  2 agentes nuevos (`data-stat-engineer`, `evaluation-engineer`, sin `mcp__context7`) + partir
  `CLAUDE.md` a **< 200 líneas** moviendo los bloques `## REGLAS DE FASE X` **verbatim** a
  `.claude/rules/fase-N.md`.
- **Descartado con motivo escrito** (§15.2 D10, §15.4.9): RL, DL, minimax, predicción del siguiente
  pick, counterfactual winrate, MCMC/Stan en prod, LangGraph/CrewAI/AutoGen, Memory MCP, Firecrawl,
  `work/{active,done}/`. **Diferido**: `PlayerHeroReliability`, Branch Survival, V3 secuencial, SDK
  en `tools/ai-harness/`, harness V3–V4/CI, migración de los 3 JSON curados a `data/curated/`.
- **Sin dependencia nueva, sin secreto de runtime, sin variable de entorno nueva, cero PII, cero
  red en el camino caliente.** `scripts/eval/**` y `scripts/stats/**` nunca se importan desde
  `apps/`. Las SQLite se abren `readonly: true`.
- **`TSK-174`/`TSK-179` deja de ser dependencia de Fase 9** (§15.1 C2): los slots Dire no
  participan de ninguna métrica.
- **Precondición para arrancar el bloque A**: commitear Fase 8 (`TSK-183`→`TSK-192` + el fix de
  `apps/web/features/draft/validation.ts`). El baseline "V6-medido" tiene que corresponder a un
  commit identificable.
- **14 tickets, `TSK-193`→`TSK-206`, sólo de 9.0**, en 5 bloques por dependencia (A harness →
  B replay+métricas puras → C runners → D diagnóstico → E cierre del gate). Cada ticket declara
  `write_scope` y cita el ID `Rx-y` que implementa.

## MEMORIA
- `docs/agents/journal.md` → **fuente de verdad**, append-only, nunca se comprime ni se borra. `verify-simplicity.sh` bloquea cualquier diff que elimine líneas de aquí.
- `docs/agents/MEMORY.md` → vista comprimida y regenerable de `journal.md`.
- `docs/agents/USER.md` → perfil del diseñador de producto.
- `docs/agents/ledger.md` → registro append-only de tareas completadas (misma protección que journal.md).

Leer `MEMORY.md` y `USER.md` al inicio de cada sesión.

## GESTIÓN DE TAREAS (Kanban derivado)
- Fuente única de verdad: el frontmatter YAML de cada `docs/agents/tasks/TSK-XXX.md`.
- `plan.md`, `ledger.md` y `docs/agents/hub.html` son **vistas derivadas**. Nunca se editan a mano.
- Campo `attempts` en 3 → dispara automáticamente Tracer. No se pregunta, se ejecuta.
- WIP=1 por herramienta (`assigned_tool`), verificado por script — ver detalle abajo.

## FORMATO DE LOG EN journal.md (para que el HUB pueda contar, no solo leer)
Toda skill/agente que anote algo en `journal.md` usa esta primera línea fija, seguida de texto libre si hace falta:
```
- [YYYY-MM-DDTHH:MM] event:evt-<id> schema:v1 tool:<nombre-skill-o-agente> ticket:<TSK-XXX|-> result:<ok|blocked|fail|info> — nota breve
```
`event:` es un identificador único (ej. `evt-20260725-001`) y `schema:v1` versiona el formato — si el formato cambia en el futuro, un parser puede distinguir líneas viejas de nuevas sin romperse. Ejemplos reales:
```
- [2026-07-25T14:02] event:evt-20260725-001 schema:v1 tool:build ticket:TSK-014 result:ok — login con magic link implementado
- [2026-07-25T14:10] event:evt-20260725-002 schema:v1 tool:redteam ticket:TSK-014 result:blocked — gate de seguridad: secreto hardcodeado en auth.ts
- [2026-07-25T14:15] event:evt-20260725-003 schema:v1 tool:sentinel ticket:TSK-014 result:fail — falta validación de input en endpoint /login
```
Esto no reemplaza el texto libre de siempre — es solo la primera línea, para que `bun scripts/hub.ts` pueda contar sin tener que interpretar prosa.

## HUMAN-IN-THE-LOOP: dónde intervienes tú
`bun scripts/hub.ts` genera un solo HTML con tres cosas: en qué fase del proyecto estás (leído de `PROGRESS.md`), el Kanban de tareas, y la actividad reciente de los agentes (leída de `journal.md`). Cuando un gate falla (`@redteam` → REJECTED, Sentinel → FAIL), el ticket pasa a `state: blocked` automáticamente y aparece con la bandera "🟡 necesita tu decisión" — ningún agente reintenta solo desde ahí. Ese es el punto exacto donde entras: revisas el motivo en `journal.md`, y decides si se reintenta, se cambia de enfoque, o se descarta.

## HERRAMIENTA POR TAREA (Kiro + Claude Code + Codex + Hermes)
Cada ticket declara **dos campos**, no uno — la intención y la decisión real son cosas distintas:
- **`preferred_tool`**: la intención al crear el ticket, asignada por `/grill-me`.
- **`assigned_tool`**: la decisión real, fijada por `/dispatch` justo antes de ejecutar — considera alcance actual, sensibilidad, necesidad de memoria, créditos disponibles y reversibilidad. Puede diferir de `preferred_tool` si las condiciones cambiaron desde que se creó el ticket.

Valores posibles para ambos campos:
- **`claude-code`**: la tarea toca skills, memoria (`journal.md`), tablero, o necesita `@redteam`/gates de seguridad. Es lo único que entiende este ecosistema.
- **`codex`**: feature acotada con spec ya clara, pocos archivos, sin necesidad de leer memoria del proyecto. El ticket debe ser 100% autocontenido — Codex no lee `journal.md` ni conoce las skills de aquí.
- **`kiro-nativo`**: planificación, navegación o edición rápida que Kiro ya resuelve bien sin pasar por ningún agente.
- **`hermes-vps`**: trabajo largo y autocontenido que se deja corriendo desatendido de noche en el VPS de Hermes (GPT). Nunca por defecto — solo si el usuario lo pide explícito vía `/nightwatch`, con el checklist de seguridad operacional que esa skill exige. Siempre pasa por `@redteam`/Sentinel al volver, igual que cualquier otro código.

Si no estás seguro de cuál usar, por defecto es `claude-code` — es la única opción que no pierde trazabilidad en `journal.md`.

## WIP=1 POR HERRAMIENTA, NO GLOBAL
La regla original ("solo una tarea en `doing`, punto") desperdiciaba el sistema multi-herramienta que construimos. La regla real: **máximo 1 tarea en `doing` por cada valor de `assigned_tool`** — Claude Code puede estar implementando mientras Codex resuelve algo acotado y Hermes investiga de noche, siempre que cada uno tenga como máximo una tarea activa a la vez. Verificado por script, no por confianza.

## POLÍTICA DE MODELOS (Opus solo al principio, y ahí se acaba)
Tres niveles, no nombres fijos — así solo actualizas esta tabla cuando salga un modelo nuevo, no 20 archivos.

| Nivel | Cuándo | Modelo hoy | Por qué |
|---|---|---|---|
| **Razonamiento** (caro, UNA sola vez en todo el proyecto) | Exclusivamente `/blueprint` — el momento donde ya hay brief + respuestas de `/pre-flight` completas y hay que sintetizarlas en una arquitectura coherente. | `claude-opus-4-8` | Recolectar información (`/kickoff`, `/pre-flight`) no necesita razonamiento caro — sintetizarla en una decisión coherente sí. Separar ambos evita pagar Opus tres veces por lo que en realidad es un solo trabajo de síntesis. |
| **Estándar** (todo lo demás, sin excepción) | `/kickoff`, `/pre-flight`, `/rulebook` en adelante: ejecutar, revisar, diagnosticar, gate de seguridad, diseño de UI, arquitectura continua, revisión adversarial | `claude-sonnet-5` | Suficiente para preguntas/respuestas y para todo lo que viene después de tener ya una arquitectura sólida |
| **Volumen/barato** | Memoria, archivado, tareas repetitivas de bajo riesgo | `claude-haiku-4-5-20251001` | Se ejecuta muy seguido; no tiene sentido pagar de más por resumir texto |

**Evita `claude-fable-5` salvo que no tengas otra opción disponible** — es el más caro de todos, y no gana nada frente a Opus para lo que hacemos aquí.

**Regla simétrica para Codex/GPT**: mismo principio que con Claude — el modelo insignia/caro solo en los casos que de verdad lo exigen (razonamiento profundo, bug oculto, `/blueprint` si no hay Opus). Para todo lo demás dentro de `tool: codex`, usa el equivalente a "Sonnet" del lado de OpenAI — el modelo de trabajo estándar de tu plan, no el flagship por defecto.

**Para tareas con `tool: codex`**: no todas son iguales — distingue por tipo de tarea, no uses un solo modelo para todo (info no verificada de forma independiente, tómala como guía operativa y confírmala tú de tanto en tanto en la doc oficial de OpenAI):
- Completado rápido, edición acotada, 1-2 archivos: el modelo de código más rápido/barato disponible en tu plan (ligero, latencia baja).
- Bug de lógica oculta o concurrencia que ya resistió un intento normal: el modelo de razonamiento profundo disponible (piensa antes de responder, no el de respuesta instantánea) — es el mismo espíritu que justifica Opus en `/blueprint`, aplicado del lado de Codex.
- Tarea de lote/alto volumen (limpiar miles de filas, clasificar datos): el modelo más barato disponible, optimizado para eso — no gastes el modelo de razonamiento en volumen.

**Fallback sin créditos de Opus**: si te quedas sin créditos de Opus justo en `/blueprint`, el modelo insignia disponible en tu plan de Codex/ChatGPT (el de gama más alta, pensado para tareas críticas y complejas) es un sustituto razonable — mismo nivel "razonamiento caro, solo al inicio", solo que del otro proveedor. No es una equivalencia confirmada, es la mejor alternativa disponible cuando no hay opción.

**Excepciones documentadas — gatillo de riesgo verificable, no un dogma**: "si algo pide Opus fuera de `/blueprint`, la planificación falló" es cierto la mayoría de las veces, pero no siempre — un cambio legítimo de alcance no es lo mismo que una planificación floja. Se permite una activación puntual de Opus (vía `/compass`, nunca en silencio) si se cumple **al menos uno** de estos gatillos objetivos:
- Cambio de trust boundary respecto a lo que definió `/pre-flight`.
- Migración de datos irreversible.
- Modificación de autenticación o permisos.
- Cambio de motor de base de datos.
- `@root-cause` falla 2 veces consecutivas apuntando a la capa de dominio/entidades (Opus-Emergency).
- Más del 40% de los tickets activos requieren reescribir `architecture.md` (Blueprint v2 — pivote de dominio real).
- Discrepancia seria confirmada entre `SPEC.md` y la arquitectura real del código.

Fuera de esta lista, la regla original se mantiene: si "hace falta" Opus y no hay un gatillo de la lista, es señal de planificación floja — se replanifica con Sonnet, no se sube de modelo por comodidad. Después de resolver cualquiera de estos casos, vuelve a Sonnet de inmediato — ninguna excepción se queda "por si acaso". Anota en `journal.md` cuál gatillo aplicó, siempre.

| Agente | Modelo | Rol | Tools |
|---|---|---|---|
| Warden | `claude-sonnet-5` | Revisa: pruebas, linters, límites | Read, Glob, Grep, Bash |
| Artisan | `claude-sonnet-5` | Ejecuta: interfaces y sistema de diseño | Read, Write, Edit, Glob, Grep |
| Chronicle | `claude-haiku-4-5-20251001` | Documenta: memoria, specs, ledger | Read, Write, Edit, Glob, Grep |
| Tracer | `claude-sonnet-5` | Analiza: fallos repetidos, alternativas | Read, Grep, Bash |
| Sentinel | `claude-sonnet-5` | Revisa: gate de seguridad obligatorio pre-deploy | Read, Grep, Bash |
| data-stat-engineer | `claude-sonnet-5` | Fase 9: capa estadística offline (percentiles, Empirical Bayes, perfil de señales, procedencia). No toca el motor. Sin MCP. | Read, Glob, Grep, Bash, Write, Edit |
| evaluation-engineer | `claude-sonnet-5` | Fase 9: harness de evaluación (replay, métricas, 2 benchmarks, Golden Dataset, `gate.ts`). No toca el motor. Sin MCP. | Read, Glob, Grep, Bash, Write, Edit |

Ningún agente corre en Opus — Opus vive únicamente en `/blueprint`, una sola vez por proyecto, antes de que exista ningún agente que invocar. Ver "Política de modelos" arriba.

Decisión de diseño: no se creó un agente "Orquestador" ni "Arquitecto" separado. Orquestar es una skill (`/dispatch`), no un sub-agente — no necesita su propio contexto aislado, y separar el enrutamiento en un sub-agente añadiría latencia sin beneficio. Lo mismo aplica a arquitectura: vive en `/pre-flight` como skill, no como rol permanente, porque solo se ejecuta al inicio del proyecto o ante cambios grandes.

## CONTEXT7 (documentación de librería al día)
MCP declarado en `.mcp.json` (project-scoped, versionado). Se consulta **sólo** en `/rulebook` e
implementación, para confirmar la API vigente de una librería del stack (sobre todo Next.js y Bun).
**Nunca en el camino caliente** — es tooling de desarrollo, no entra en ningún `import` de `apps/`.
Detalle, alcance por agente y CLI equivalente (`npx ctx7 …`) en `.claude/rules/context7.md`.
Token: `CONTEXT7_API_KEY` exportado en el shell (ver `.env.example`); sin él corre en modo anónimo.

## SKILLS
- **Core** (`.claude/skills/`): se cargan siempre, forman el flujo real del proyecto.
- **Extra** (`skills-extra/`): utilidades opcionales de investigación/aprendizaje personal. No se cargan por defecto — se invocan copiando el archivo a `.claude/skills/` o referenciándolo explícitamente.

Ver `docs/SETUP.md` para el listado completo y `CHANGELOG.md` para el historial de decisiones.
