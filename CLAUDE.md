# PROYECTO: dota2coach (Draft Coach) — Fase 3 en curso

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

**Nota de estado (2026-08-20)**: fase 1 completa (TSK-001 a TSK-016, done), MVP validado. Fase 1b
(personalización de hero pool, `docs/specs/SPEC.md` §9) completa y validada por el usuario con su
cuenta real de Steam (TSK-017 a TSK-026, done). Bloque de feedback directo de producto tras probar
fase 1b en vivo, también completo (TSK-027 a TSK-033, done): señal `role_safety` + priorización de
support en picks tempranos, simulador personalizado al hero pool propio, home real + navegación
compartida, persistencia de `account_id`, guion de bans de `allPick` ampliado a 16, comparación
explícita entre sugerencias, y selector de ventana de días al calcular el pool. Fase 2 ("Draft en
equipo") **completa**: modo de party solo/2/3/5 + hero pools de compañeros a mano + equipos
guardados localmente (TSK-034 a TSK-036, vía Codex), y el Random Draft Simulator (spec nativo de
Kiro, sin tickets `TSK-XXX` propios — store + hook de sesión contra el motor real + UI completa en
`/random-draft`; agregó `GET /api/meta/hero-stats`, solo lectura, ver `engine.md`). El simulador
está construido y verificado en navegador pero **sin commitear y sin pasar `@redteam` todavía** —
pendiente, en cola. **Deploy real completo**: dota2coach corre en producción en Railway
(https://d2kiro-production.up.railway.app, auto-deploy activado sobre `master`), primer `/castoff`
exitoso y verificado contra la instancia pública. **Fase 3 en curso** ("Posiciones reales en el
motor de sugerencias"): QA manual reveló que el motor no tiene ningún concepto de posición (pos
1-5) — usa etiquetas temáticas de OpenDota que no representan roles reales (57% de los héroes
marcados "Carry"), lo que produce composiciones inválidas (doble carry). `/kickoff` cerrado:
se resuelve curando posiciones a mano (mismo patrón que `capabilities.json`), sin STRATZ ni
dependencias nuevas. Ver `docs/agents/PROGRESS.md` para el estado exacto y el siguiente paso.

## COMANDOS ESENCIALES
- `bun run dev` → Iniciar servidor de desarrollo.
- `bun test` → Ejecutar pruebas unitarias.
- `bun run lint` → Formatear código.
- `bash scripts/verify-simplicity.sh` → Verificar límites (fuente única de verdad de los números).
- `bun scripts/hub.ts` → Regenerar el tablero desde los tickets.

## REGLAS INVIOLABLES
Codificadas en `scripts/verify-simplicity.sh`. Si cambias un número aquí, cámbialo también ahí.

- No añadir dependencias sin pasar por `/gear-up` o `@depcheck`.
- Máximo 3 archivos modificados por tarea.
- Máximo 200 líneas nuevas por tarea.
- **Excepción documentada:** una migración de esquema (Drizzle) cuenta como 1 unidad lógica aunque toque schema + migración + 1 query afectada.
- **Excepción documentada, puntual, no generalizable:** el scaffolding inicial del monorepo (TSK-001 —
  `create-next-app` para `apps/web` + esqueleto a mano de `apps/engine`) contó como 1 unidad lógica
  aunque tocó decenas de archivos generados. Es boilerplate de herramienta, no código escrito a
  mano — la regla de 1 archivo/200 líneas sigue aplicando sin excepción a todo trabajo posterior.
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
