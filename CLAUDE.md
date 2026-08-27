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

Ningún agente corre en Opus — Opus vive únicamente en `/blueprint`, una sola vez por proyecto, antes de que exista ningún agente que invocar. Ver "Política de modelos" arriba.

Decisión de diseño: no se creó un agente "Orquestador" ni "Arquitecto" separado. Orquestar es una skill (`/dispatch`), no un sub-agente — no necesita su propio contexto aislado, y separar el enrutamiento en un sub-agente añadiría latencia sin beneficio. Lo mismo aplica a arquitectura: vive en `/pre-flight` como skill, no como rol permanente, porque solo se ejecuta al inicio del proyecto o ante cambios grandes.

## SKILLS
- **Core** (`.claude/skills/`): se cargan siempre, forman el flujo real del proyecto.
- **Extra** (`skills-extra/`): utilidades opcionales de investigación/aprendizaje personal. No se cargan por defecto — se invocan copiando el archivo a `.claude/skills/` o referenciándolo explícitamente.

Ver `docs/SETUP.md` para el listado completo y `CHANGELOG.md` para el historial de decisiones.
