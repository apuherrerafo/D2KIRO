# Estado del Proyecto — se actualiza solo, no lo edites a mano

## FASE ACTUAL
**Dos hilos activos en paralelo -- ninguno se abandonó, el segundo apareció mientras el primero
seguía pendiente.**

**Hilo 1 (pausado, no descartado): Random Draft Simulator (Fase 2)**, implementado y verificado
en navegador real, pendiente de gate de seguridad y commit. Trabajado fuera de la tabla de fases
de este skill: el usuario había avanzado con Kiro nativo
(`.kiro/specs/random-draft-simulator/{requirements,design,tasks}.md`, sin pasar por `/rulebook`)
y lo dejó a medio camino; una sesión de Claude Code completó las 17 tareas de `tasks.md`
directamente sobre ese spec (sin tickets `TSK-XXX` propios). Ver detalle completo en `journal.md`
evt-20260820-047: store Zustand + hook de sesión + 6 componentes de UI + ruta `/random-draft`, un
endpoint de solo lectura nuevo en `apps/engine` (`GET /api/meta/hero-stats`, aprobado
explícitamente por el usuario), un bug real encontrado y corregido solo gracias a la verificación
en navegador (transición de fase trabada tras la Ban_Phase), y un Conflict_Ban real confirmado con
seed reproducible. `bun test` 70/70 (web) + 198/198 (engine), lint y `tsc --noEmit` limpios.
**Nada de esto está commiteado todavía**, y no pasó por `@redteam` -- toca `apps/engine` (nueva
superficie HTTP, aunque de solo lectura), así que corresponde el gate de seguridad antes de dar
la feature por cerrada.

**Hilo 2 (código completo, pendiente de QA manual): Fase 3 -- "Posiciones reales en el motor de sugerencias".**
**Actualización 2026-08-21: los 5 tickets (TSK-043 a TSK-047) están `done`, en cadena, sin pausas
(instrucción explícita del usuario: "vamos flecha hasta terminar y luego irnos a probar").**
`apps/engine` (210/210 tests) y `apps/web` (70/70 tests) verdes, `tsc --noEmit` limpio en ambos,
`verify-simplicity.sh` PASS. `SCORING_WEIGHTS_V4` activa, `position_fit` reemplaza `role_gap`/
`role_safety` en el pipeline real de `buildSuggestions`, candado de regresión del bug original
verificado contra el motor completo (Spectre + Wraith King disponible -> Wraith King fuera del
top 3). **Hallazgo de diseño real, no anticipado en `/rulebook`**: TSK-047 (borrar
`role-gap.ts`/`role-safety.ts`) no pudo quedar al final como estaba planeado -- en cuanto TSK-045
quita esos dos nombres de `SignalId`, esos archivos dejan de compilar de inmediato, no hay estado
"huérfano pero vivo" que sostener. Se borraron dentro de TSK-045 (documentado en su nota de
ejecución y en `journal.md` evt-20260821-056); TSK-047 quedó reducido a la verificación final
(`grep` sin referencias funcionales) y se cerró sin diff de código propio. Detalle completo en
`journal.md` evt-20260821-056 a evt-20260821-061.

**QA manual completo y PASS en los dos escenarios de `SPEC.md` §10.9**, contra el Copilot real
(sesiones sembradas directo contra `POST /api/session/manual`, el mismo endpoint real, y
observadas en vivo por el usuario en su propio navegador). Escenario A (Spectre pickeado): top 3
= Shadow Shaman, Venomancer, Warlock -- cero carries, Wraith King no aparece. Escenario B (draft
vacío): top 3 = Bane, Crystal Maiden, Mirana -- el #1 es support real. **Fase 3 queda validada de
punta a punta**, no solo por tests automatizados. Dos hallazgos de UI reales pero **no
relacionados con `position_fit` ni con ninguna señal** salieron en el camino, ya convertidos en
tickets a pedido del usuario (marcados `[UI]` a propósito, para no confundirlos con trabajo de
motor): **TSK-048** (el WebSocket no reenvía `suggestions` al reconectar, solo el `snapshot` de
`draftState`) y **TSK-049** (no hay botón de "Entrada manual" visible una vez el draft ya está
activo). Detalle en `journal.md` evt-20260821-062.

**Actualización 2026-08-21, más tarde -- TSK-049 y la cadena "reporte de QA" (TSK-050 a TSK-052)
completas, `done`, `@build`+`@redteam` cada una.** El usuario probó los dos escenarios en su
propio navegador (no un mockup) contra sesiones sembradas directo en el motor real, y pidió poder
armar drafts completos en vez de escenarios sueltos -- para eso hacía falta TSK-049 primero
(sin él, el draft quedaba trabado tras el primer pick). Con eso resuelto, se armó **`draft_feedback`**:
tabla nueva (TSK-050, `simplicity_exception` documentada) + `POST /api/session/:id/feedback` +
`GET /api/feedback` de solo lectura para que una sesión futura los lea con curl (TSK-051) +
`DraftFeedbackBox` en `/draft`, junto al botón de entrada manual (TSK-052, también con
`simplicity_exception` -- 5 archivos por la arquitectura por features, detectada durante el build,
no oculta). Cada reporte guarda el comentario **junto con una foto exacta** del `draftState` y las
`suggestions` del momento del envío -- decisión de producto explícita para no perder contexto.
Dos hallazgos técnicos reales en el camino, ninguno bloqueante: ordenar por `id` en vez de
`createdAt` en `getAllDraftFeedback` (dos reportes en el mismo milisegundo empataban), y
confirmación de que `scripts/verify-simplicity.sh` compara contra `git diff --cached` -- no
bloquea nada hasta que se haga `git add`, así que el conteo de archivos de toda esta sesión fue
manual. **TSK-048 sigue en backlog, sin tocar** -- no bloqueaba el QA en curso (mientras el
navegador no se refresque a mitad de draft, el push en vivo de `suggestions` funciona bien).
Detalle completo en `journal.md` evt-20260821-063 a evt-20260821-071.

**Actualización 2026-08-21, más tarde -- TSK-053, bug real encontrado por el usuario en vivo,
`done`.** Al probar en su propio navegador, el primer pick vía "Entrada manual" en una sesión
nueva (`/draft` sin `?session`) fue rechazado con `wrong_phase`. Causa raíz: ningún capturador
automático existe todavía (Overwolf/OCR), y `apps/web` restringía deliberadamente la entrada
manual a no poder emitir `session_started` -- así que una sesión que arranca por entrada manual
pura nunca podía pasar de `phase:"idle"`, contradiciendo SPEC.md D1 ("entrada manual es
capturador de primera clase"). Arreglado: `DraftView.openManualEntry` ahora bootstrapea
`session_started`+`local_side_identified` (lado fijo "radiant", sin selector de lado en la UI
todavía) la primera vez que se abre sobre una sesión inactiva, nunca sobre una ya activa.
Verificado con la secuencia real contra el motor corriendo. Detalle en `journal.md`
evt-20260821-072/073.

Texto original de la sesión de `/rulebook` (para contexto de cómo se llegó hasta acá, no editado):
Disparado al hacer QA manual del Random Draft Simulator: el usuario notó que el bot pickea
composiciones inválidas (doble carry) y que el copiloto no se siente como un drafter real.
Investigado en profundidad (código real + 2 deep research externos que el usuario trajo de
Gemini): el motor no tiene ningún concepto de posición (pos 1-5) -- usa etiquetas temáticas de
OpenDota donde 57% de los héroes están marcados "Carry" (Zeus, Axe, Tidehunter incluidos), y la
señal `role_gap` que debería frenar esto pesa 0.108 contra 0.288 de `counter`. Además se
descubrió que el bot del Random Draft Simulator (Hilo 1) tiene su propio scoring de ~20 líneas,
no usa `buildSuggestions` -- lo que se ve ahí no refleja el motor real. **`/kickoff`,
`/pre-flight`, `/blueprint` y `/rulebook` completos** -- toda la planificación cerrada, reglas
escritas y **5 tickets listos en backlog (TSK-043 a TSK-047)**; falta ejecutar. Decisiones firmes: posiciones curadas a mano en vez de STRATZ (cero dependencias/secretos
nuevos); `role_gap` y `role_safety` se **fusionan** en una señal nueva, `position_fit`, en vez de
arreglarse por separado -- las dos razonaban sobre la misma pregunta y competían entre sí;
`SCORING_WEIGHTS_V4` = position_fit 0.25 / counter 0.27 / patch_meta 0.17 / team_synergy 0.14 /
hero_pool_fit 0.17; fórmula completa cerrada (cobertura de posición + `TIMING_BLEND` que decae
suave, reemplazando la ventana dura de 2 picks). **Dato real ya conseguido y validado** (no queda
para `/build`): 126 de 127 héroes con posición real, sacado de Dota2ProTracker vía navegador real
(Playwright), verificado contra conocimiento del juego y contra el caso que arrancó todo (Spectre
carry puro, Wraith King Offlane/Carry). Vive en el scratchpad de la sesión hasta que `/build` lo
mueva al repo. **Hallazgo de alcance de `/blueprint`**: esto no es solo el motor -- `SignalId` y
`SIGNAL_LABELS` están espejados a mano en `apps/web`, entran en el mismo cambio o el tipado se
rompe. Explícitamente fuera de esta primera vuelta: arreglar el bot del simulador, y la queja de
UX de "no veo en tiempo real qué ya se sacó". Contrato completo en `docs/specs/SPEC.md`
§10.0-§10.11 (9 criterios de aceptación, 5 fronteras de ticket); investigación en
`architecture.md` § Fase 3; reglas en `.claude/rules/` (secciones "Fase 3", incluida la costura
nueva S10) y `CLAUDE.md`. Detalle en `journal.md` evt-20260821-048/049/050.

**Nota de importación de Kiro (para no re-litigarlo en cada `/rulebook`)**: existe
`.kiro/specs/random-draft-simulator/tasks.md`, pero **no se importó a tickets a propósito** --
corresponde al Hilo 1, cuyas 17 tareas ya están implementadas y verificadas; crear tickets
`TSK-XXX` retroactivos para trabajo terminado sería burocracia sin valor. Fase 3 no tiene spec
nativo de Kiro (se planificó con la cadena kickoff→pre-flight→blueprint), sus tickets salen de
`SPEC.md` §10.11.

---

**Antes de esto: deploy completo, validado y en producción real.** dota2coach corre en Railway:
https://d2kiro-production.up.railway.app (proyecto "wonderful-embrace", servicio "D2KIRO",
auto-deploy activado sobre `master`). Los 5 tickets de la arquitectura de deploy (TSK-037 a
TSK-041) se ejecutaron, verificaron y cerraron completos, y el primer `/castoff` real (que se
había detenido en 2026-08-01 por falta de `.env.example` y el hallazgo de arquitectura de
`127.0.0.1`, ver evt-20260801-017/018) se reintentó y **pasó de punta a punta con verificación real
contra la instancia pública**, no solo revisión de código: `/healthz` sano sin auth, Basic Auth
real exigido en el resto del sitio, `/draft` correctamente deshabilitado en la nube ("Draft local"
en el NavBar, nunca intenta WebSocket), proxy hacia el motor funcionando, y sincronización real con
OpenDota trayendo los ~126 héroes tras un clic manual en "Sincronizar ahora" (la SQLite de la nube
arranca vacía a propósito).

En el camino, Sentinel (gate de seguridad de `/castoff`) encontró y se corrigió un hallazgo real:
`proxy.ts` dejaba pasar tráfico sin autenticación (fail-open) si faltaban las variables de Basic
Auth -- correcto para uso local, peligroso en el contenedor de deploy. Se agregó un bloqueo
fail-closed en `scripts/start-railway.sh`, verificado en vivo. También se resolvieron 3 problemas
de infraestructura ajenos al código del motor (commits nunca subidos a GitHub, `next-env.d.ts`
gitignored rompiendo el build de Railway, la app de GitHub de Railway nunca instalada +
auto-deploy apagado) -- documentados en `journal.md` evt-20260801-040/041 y en memoria del usuario
para no repetirlos.

Fase 1b, el bloque de feedback TSK-027 a TSK-033, y "Draft en equipo" completo (Fase A/B/C,
TSK-034 a TSK-036) siguen completos (ver historial).

**Actualización 2026-08-21, más tarde -- auditoría de arquitectura ad-hoc + 9 tickets nuevos.**
El usuario pidió una auditoría de arquitectura general (agente `system-architect`, publicada como
artifact "Radiografía de dota2coach"), sin partir de una queja puntual de producto. Confirmó lo
bueno (separación de dos procesos, reductor/scorers puros, invariantes de seguridad, todo
verificado contra código real) y encontró 8 problemas reales: `app.ts` (669 líneas, archivo dios
que creció vía commits individualmente válidos bajo el gate de 200 líneas -- el gate limita el
diff por tarea, no el archivo en el tiempo), `SessionStore` sin TTL (memoria sin límite, latente
porque `/draft` está apagado en la nube), el bot del simulador sigue usando `roles[]` en vez de
`hero-positions.json` (reabre a propósito lo que Fase 3 había diferido explícitamente), un tercer
espejo de tipos no documentado en `bot-drafter.ts`, recómputo redundante de `MetaSnapshot` y de
estado por-draft dentro de varios `SignalScorer`, y falta de test sobre el condicional real que
arregló TSK-053. El hallazgo de reconexión sin `suggestions` ya era TSK-048, no generó ticket
nuevo. Ante la pregunta directa, el usuario eligió: arrancar con estos fixes ya (sin esperar al
cierre administrativo pendiente de abajo) y ticketear los 8 hallazgos completos. **9 tickets
nuevos, TSK-055 a TSK-063**, backlog, sin `assigned_tool` -- detalle completo del mapeo
hallazgo→ticket en `journal.md` evt-20260821-076.

**Actualización 2026-08-21, más tarde -- cadena completa de la auditoría de arquitectura
ejecutada de punta a punta, sin pausas (decisión explícita del usuario: implementar directo,
sin el pipeline formal `@build`/`@redteam` de sub-agentes separados para esta ronda -- ver
`journal.md` evt-20260821-077 en adelante para la justificación caso por caso).** Los 9 tickets
(TSK-055 a TSK-063) más TSK-048 (ya en backlog) quedaron `done`. **Hallazgo real no anticipado,
encontrado a mitad de camino (TSK-064, `must`, ya corregido)**: `buildMetaSnapshot()` nunca
incluía el hero pool del usuario -- `hero_pool_fit` (17% del peso) devolvía `applicable: false`
en el 100% de los drafts reales desde Fase 1b, silenciosamente, porque cada capa se probaba
aislada con fixtures que ya traían el pool armado a mano. El usuario preguntó si esto explicaba
la percepción de sugerencias pobres tanto tiempo -- respuesta comunicada sin sobreclamar: sí, es
un contribuyente real y probable, pero no aislable del bug de `role_gap`/`role_safety` (ya
corregido en Fase 3) sin un QA manual comparativo dedicado. Resumen de lo tocado:
- **TSK-048**: WebSocket reenvía `suggestions` al reconectar, no solo `snapshot`.
- **TSK-055**: `SessionStore` expira sesiones sin actividad (TTL 45min, mismo criterio que el
  simulador).
- **TSK-056/057/058**: `app.ts` partido de 682 a 257 líneas (-62%) en 5 módulos de rutas nuevos
  (`routes/{hero-pool,team-groups,simulator-sessions,meta,draft-paths}.ts`), cero cambio de
  comportamiento verificado por la suite de integración existente sin tocar un solo test.
- **TSK-064 (bug crítico, no en el reporte original)**: `buildMetaSnapshot` ahora incluye
  `heroPool`/`personal_baseline_winrate` reales -- `hero_pool_fit` funciona por primera vez en
  producción.
- **TSK-059**: cache de `MetaSnapshot` en memoria, invalidada en sync y en reemplazo de pool.
- **TSK-060**: memoización por-draft (no por-candidato) en `position_fit`/`counter`/
  `team_synergy` -- hallazgo real en el camino: `team_synergy` necesitó cache anidada por
  `(state, meta)`, no solo por `state`, para no servir datos contra el meta equivocado.
- **TSK-061**: `shouldBootstrapManualSession` y `DraftViewBody` ganaron pruebas propias.
- **TSK-062**: segundo espejo de tipos (`bot-drafter.ts`) documentado en `engine.md`/`web.md`.
- **TSK-063**: el bot del simulador ya no usa `roles[]` para su bono de complemento -- usa
  posición real (`hero-positions.json`, vía `GET /api/meta/hero-stats` extendido), con candado de
  regresión del caso Spectre/Wraith King reproducido en `bot-drafter.test.ts` (archivo que no
  tenía ninguna prueba propia hasta este ticket). `simplicity_exception: true` documentada (6
  archivos, cambio cruza los dos procesos por naturaleza).

Estado final verificado: `apps/engine` 232/232 tests + `tsc` limpio, `apps/web` 87/87 tests +
`tsc` limpio. **Nada de esto está commiteado todavía** -- decisión de la sesión de no commitear
sin que el usuario lo pida explícitamente. Detalle completo de cada ticket en `journal.md`
evt-20260821-076 a evt-20260821-085.

## SIGUIENTE PASO
Herramienta: Claude Code. Modelo: **Sonnet**.
Acción: **Decisión del usuario pendiente sobre cómo commitear todo lo acumulado.** El working
tree tiene ahora tres frentes sin commitear, todos verificados en verde por separado pero nunca
unificados en un solo `git add`: (1) Fase 3 + cadena de reporte de QA (TSK-043 a TSK-054), (2) el
Random Draft Simulator (Hilo 1, pendiente también de su propio gate de seguridad), y (3) esta
cadena de la auditoría de arquitectura (TSK-048, TSK-055 a TSK-064). Sugerido: `@shipcheck` por
frente, en commits separados por unidad lógica -- nunca un solo commit gigante. El usuario decide
el orden y si quiere revisar el diff de cada frente antes de commitear.

Nota vieja, ya resuelta -- el ciclo anterior de QA manual de draft completo con `DraftFeedbackBox`
(reportes en `draft_feedback`, leídos vía `GET /api/feedback`) generó TSK-053/TSK-054, ambos
`done`. Si el usuario retoma esa ronda de QA, misma mecánica: leer los reportes con su
`draftState`/`suggestions` exactos antes de convertir cualquiera en ticket.

**Pendiente menor, no bloqueante (anotado a pedido del usuario para no perderlo)**: Chen es el
único héroe sin ninguna posición real en `hero-positions.json` (TSK-043) -- no llegó al umbral de
200 partidas en ninguna de las 5. `position_fit` lo trata como `raw: null`, no rompe nada. Si se
quiere cerrar el hueco, se agrega su entrada a mano en el archivo (nota igual dejada en
`hero-positions.ts`) -- no hace falta rejugar la recolección completa por un solo héroe.

Una vez resuelto lo de arriba, no hay ninguna otra tarea técnica obligatoria pendiente -- el resto
es la misma decisión de producto de antes: elegir cuál de los caminos ya identificados y sin fecha
se prioriza (o ninguno, y el proyecto queda en modo mantenimiento). Cualquiera de ellos arranca con
`/kickoff` cuando el usuario lo decida:
- El spike de Overwolf (sigue sin correrse -- único capturador de fase 1 nunca validado contra una
  partida real de Dota 2).
- El adaptador OCR (contrato ya especificado en `architecture.md`, nunca construido).
- Predicción de rol/posición del rival (dependencia condicional de STRATZ, documentada desde fase
  1b, nunca priorizada -- necesita su propia evaluación de costo/beneficio del API key nuevo).
- La pieza más grande y deliberadamente diferida del brainstorm original de "Fase C": el sistema
  combinatorial completo de caminos de draft (eje de timing, forma de recursos, win conditions
  primaria+secundaria) -- la v1 ya construida (TSK-036) solo cubrió el eje de plan macro, a
  propósito, por decisión explícita del usuario de mantener el alcance acotado.

Nota vieja, ya resuelta -- las 3 cosas que habían quedado abiertas en el diseño del Dockerfile
(imagen base npm/no-bun, path exacto del volumen, multi-tenancy fuera de alcance) se cerraron
todas dentro de TSK-040, ver journal.md evt-20260801-037/038/039.

## HISTORIAL (append-only, no se borra)
- [inicio] Proyecto creado, sin fase completada todavía.
- [2026-07-26] /launchpad completado: proyecto nuevo confirmado, modo de trabajo solo (equipo previsto post-MVP), entorno real Kiro + extensión Claude Code + Codex CLI mapeado en docs/agents/TOOLKIT.md.
- [2026-07-26] /kickoff completado: brief de fase 1 (Draft Coach) acordado — captura de draft en vivo (pub vs. Captain Mode) + sugerencias de picks/bans/contrapicks basadas en meta del parche, SIN personalización de hero pool (eso queda como fase 1b). Riesgo central identificado: el pipeline que combina fuentes de información en una sugerencia coherente, no la captura de datos en sí. Requiere ambiente de pruebas con simulación de drafts.
- [2026-07-26] /pre-flight completado: los 6 bloques consolidados en docs/agents/architecture.md. Hallazgo clave verificado con fuentes primarias (WebSearch/WebFetch): GSI no expone picks de draft en matchmaking público (issue oficial de Valve #19408 sin resolver); Overwolf SDK y/o OCR son los caminos viables de captura. Corrección de alcance importante: dota2coach es un sitio web (Next.js, con visión de cuentas/login y multiusuario a futuro) — Overwolf/OCR es solo el capturador, no el contenedor de toda la app. Stack: Next.js + RTK Query + Zustand (draft en vivo vía WebSocket) + Tailwind/shadcn + Bun + SQLite/Drizzle. Monolito modular, ambiente de pruebas con simulador de draft (mismo contrato de eventos que el capturador real). Plan de validación con 4 criterios definidos.
- [2026-07-26] /blueprint completado (ÚNICA ejecución en Opus de todo el proyecto — a partir de aquí, Sonnet siempre). Generado docs/specs/SPEC.md: 6 costuras de prueba definidas antes que el comportamiento, contrato de eventos draft-event/v1, reductor puro applyDraftEvent con sus rechazos explícitos, motor de sugerencias como tubería de 5 etapas con 4 señales ponderadas (una señal sin datos devuelve null y redistribuye su peso — nunca vota neutro), esquema SQLite/Drizzle, API HTTP + WebSocket, presupuesto de latencia por tramo (≤1 s total contra un criterio de 2-3 s) y 11 requisitos de seguridad. Cerradas las 3 ambigüedades que dejó abiertas architecture.md: (D1) simulador y entrada manual son capturadores de primera clase en fase 1, Overwolf y OCR quedan como adaptadores posteriores del mismo contrato; (D2) contrapick y meta con datos reales de OpenDota, sinergia como heurística auditable sobre roles[], sin STRATZ ni dependencias nuevas; (D3) dos procesos locales — apps/web (Next.js) y apps/engine (Bun: motor, WebSocket, SQLite). Incógnitas dejadas abiertas a propósito en la sección 7 del SPEC: qué expone Overwolf realmente, el algoritmo de bans de All Pick 7.35d, la biblioteca de validación (debe pasar por /gear-up), y que Bun todavía no está instalado en la máquina.
- [2026-07-26] /rulebook completado: sin requirements.md/design.md/tasks.md nativo de Kiro (proyecto se planificó con la cadena kickoff→pre-flight→blueprint), así que no aplicó la rama de importación. Generadas reglas condicionales en .claude/rules/ (engine.md, web.md, security.md, testing-seams.md) derivadas de SPEC.md. Corregido CLAUDE.md: tenía el nombre de proyecto genérico sin llenar y STACK ACTUAL desactualizado (Bun+HTMX, plantilla por defecto nunca sincronizada tras /pre-flight) — actualizado a la decisión real (apps/engine Bun + apps/web Next.js/RTK Query/Zustand, SQLite/Drizzle, Railway) y añadida sección de reglas inviolables de fase 1. Poblados .kiro/steering/{product,structure,tech}.md (antes stubs). Configurados hooks PreToolUse/PostToolUse/SubagentStop en .claude/settings.json sobre scripts/verify-simplicity.sh. Sin espejo en .cursor/rules/ — Cursor no está en uso. Creados 14 tickets TSK-001 a TSK-014 en docs/agents/tasks/ (uno por frontera de SPEC §8, los 4 SignalScorer separados según indica el SPEC), con preferred_tool y moscow asignados (todos must salvo TSK-014, should).
- [2026-07-27] TSK-001 a TSK-015 completados (15/15, incluyendo TSK-015 — SqliteMetaProvider, descubierto como gap durante TSK-010 y resuelto como ticket propio). Motor de sugerencias, reductor de draft, servidor Bun con WebSocket, vista de draft con 6 estados, entrada manual, páginas del sitio: todo construido, pasado por @redteam (3 hallazgos de seguridad reales corregidos: validación de URL de héroe en TSK-003, sessionId de WebSocket en TSK-010, validación+error boundary en TSK-012) y varios gaps de infraestructura del propio gate de simplicidad reparados en el camino. Fase 1 verificada contra sus 4 criterios de aceptación por primera vez: captura (✅ simulador, aún no probado contra partida real), sugerencias coherentes (✅), latencia 5-20ms (✅, muy por debajo del criterio de 2-3s), simulador independiente (✅). MVP funcional de punta a punta.
- [2026-07-28] /pre-flight de fase 1b (personalización de hero pool) completado. Addendum "Fase 1b" anexado a docs/agents/architecture.md (fase 1 intacta). Decisiones cerradas con el usuario: hero pool solo del usuario local (compañeros de equipo fuera de alcance — el motor no tiene identidad de slot); fuente manual + "calcular desde mis partidas" (OpenDota /players/{account_id}/heroes, ventana ~90 días, ranking por winrate con mínimo de partidas, propuesta que el usuario confirma, nunca auto-aplicada); integración como quinta señal ponderada nueva hero_pool_fit (continua, escalada por winrate personal, respeta la regla raw:null cuando el pool no existe). Investigado y descartado del alcance de 1b: predicción de rol/posición del equipo rival — depende de STRATZ (OpenDota no expone datos de posición limpios), documentada como dependencia condicional futura, contrato de señal especificado pero no construido. Primer dato personal del proyecto (Steam account_id) — cruce de trust boundary nuevo respecto a architecture.md original, coherente con los gatillos de Opus ya documentados. Nada de código ni tickets se creó en esta sesión.
- [2026-07-28] /blueprint de fase 1b completado (segunda ejecución en Opus del proyecto, por el gatillo documentado de cambio de trust boundary — el account_id de Steam es el primer dato personal; de aquí en adelante, Sonnet). Anexada a docs/specs/SPEC.md la parte "Fase 1b" (§9.0 a §9.10), sin reescribir fase 1: §9.0 lista las 5 cosas de fase 1 que quedan superadas. Cerrados los dos números que quedaron provisionales: mínimo de 10 partidas en la ventana de 90 días, con suavizado hacia la línea base personal del jugador (K=10) para que un 10-0 no valga 100%; y SCORING_WEIGHTS_V2 por reducción proporcional (counter 0.32, patch_meta 0.20, team_synergy 0.16, role_gap 0.12, hero_pool_fit 0.20) en vez de la propuesta original de /pre-flight — al escalar los 4 pesos viejos por 0.80, la redistribución que ya hace mix.ts devuelve exactamente los pesos de v1 cuando no hay pool configurado, así que la regresión cero sobre el MVP queda demostrada por prueba unitaria y no prometida. Dos decisiones más salieron de leer el código real, no del addendum: (a) `applicable?: boolean` nuevo en SignalContribution, porque tal como estaba, un usuario que nunca configure su pool habría visto TODAS sus sugerencias bajar de confianza "alta" a "media" para siempre; (b) el raw de hero_pool_fit es una escala de comodidad relativa a ti mismo (0.20 fuera del pool, piso 0.50 dentro), no un winrate crudo, con un techo de 16 puntos sobre 100 del score final — ponderación fuerte, nunca filtro duro. Registradas además D4-D7 (capturador real Overwolf/OCR) en el mismo bloque de decisiones para que SPEC.md y architecture.md no se desincronicen, y D11/D12 (pool solo del usuario local; predicción de rol rival como dependencia condicional de STRATZ, documentada y no construida). Deriva menor registrada, no corregida en silencio: GET/PUT /api/settings existen en el código desde TSK-014 pero nunca entraron en la tabla de §3.
- [2026-07-28] Limpieza de PROGRESS.md: se eliminó un bloque "HISTORIAL" duplicado (repetición parcial de las primeras 6 entradas, sin ninguna línea única) dejado por una regeneración anterior de /compass. No se perdió ninguna entrada real — solo la duplicación.
- [2026-07-28] Catch-up de commits (21 archivos/1688 líneas acumulados de TSK-016, el spike de Overwolf Paso 0, y la planificación de fase 1b) dividido en 6 commits por unidad lógica. En el camino se corrigió un bug real de scripts/verify-simplicity.sh (medía todo el árbol de trabajo con `git diff HEAD`, ciego a qué estaba en stage para un commit puntual — imposibilitaba dividir un backlog grande en commits lógicos) y se agregó un mecanismo de excepción declarativa (`simplicity_exception: true` en el frontmatter de un ticket, reconocido si el commit lo referencia). /rulebook completado sobre SPEC.md §9.10: 10 tickets nuevos (TSK-017 a TSK-026, backlog, must), reglas de .claude/rules/ y .kiro/steering/ extendidas con secciones "Fase 1b", CLAUDE.md gana "REGLAS DE FASE 1b" y corrige notas de estado desactualizadas (fase 1 ya no dice "no existe todavía"). Tablero regenerado: 26 tareas.
- [2026-07-29] Fase 1b completa: los 10 tickets (TSK-017 a TSK-026) ejecutados vía /dispatch → @build → @redteam → @shipcheck, uno por uno, WIP=1 respetado en todo momento. Motor (apps/engine, TDD real): migración hero_pool + settings (TSK-017), OpenDotaClient.getPlayerHeroes + validación Steam32 (TSK-018), cálculo puro del pool propuesto con suavizado K=10 (TSK-019), endpoints GET/PUT /api/hero-pool transaccionales (TSK-020), POST /api/hero-pool/calculate conectando las piezas (TSK-021), SignalScorer hero_pool_fit (TSK-022), SCORING_WEIGHTS_V2 + integración real en mix.ts con el candado de regresión cero demostrado por prueba, no solo prometido (TSK-023). Frontend (apps/web, sin tests de componente -- patrón ya establecido del proyecto): pantalla de configuración del pool (TSK-024), pantalla de propuesta/confirmación con 3 acciones explícitas -- confirmar/editar/descartar, nunca auto-aplica (TSK-025), SignalBreakdown con las 5 señales distinguiendo `applicable:false` de `raw:null` (TSK-026). @redteam encontró y corrigió hallazgos reales en varias rondas (días=Infinity vía JSON válido en TSK-021, mensajes de error genéricos en TSK-024) sin necesitar una segunda ronda en ningún ticket. Cinco tickets (TSK-017, TSK-018, TSK-020, TSK-022, TSK-024) necesitaron excepción de simplicidad documentada por adelantado en su propio frontmatter (`simplicity_exception: true`); el resto (TSK-019, TSK-021, TSK-023, TSK-025, TSK-026) pasó dentro del límite sin excepción. Pendiente, no bloqueante: verificación visual en navegador real de las 3 pantallas nuevas (sin herramienta de automatización disponible en ninguna sesión de esta fase).
- [2026-07-29] Verificación visual real completada: se levantó apps/engine (migración hero_pool aplicada a la base de datos real, no una de prueba) y apps/web en local, con smoke test de curl confirmando el flujo completo del backend (GET/PUT /api/hero-pool persistiendo de verdad, POST /calculate validando accountId). El usuario probó "calcular desde mis partidas" con su cuenta real de Steam y confirmó que los héroes propuestos hacen sentido con su historial real -- primera validación de extremo a extremo por una persona, no solo por tests automatizados. Fase 1b queda completa y validada.
- [2026-07-29/2026-08-01] Bloque de feedback directo de producto (TSK-027 a TSK-032) ejecutado completo vía /dispatch → @build → @redteam → @shipcheck: señal role_safety + SCORING_WEIGHTS_V3 (prioriza support en los primeros 2 picks propios), simulador personalizado al hero pool del usuario con fallback al guion original, home real + navegación compartida entre las 5 pantallas del sitio, persistencia del account_id de Steam, guion de bans de All Pick ampliado de 2 a 16, y comparación explícita entre el pick #1 y #2 ("le gana a X por Y"). Once hallazgos reales de @redteam corregidos en el camino (ninguno bloqueante más de 1 ronda). Cerrado con una sesión de QA manual guiada paso a paso del usuario contra los servidores reales, que encontró un gap real más (TSK-033: el mensaje "probá ampliar la ventana" no tenía ningún control detrás) -- resuelto en el mismo momento, mismo ciclo completo aplicado dentro de la sesión de prueba.
- [2026-08-01] /kickoff de fase 2 (Draft en equipo) completado, disparado por feedback del usuario a mitad de la sesión de QA: modo de equipo (solo/2/3/5, nunca 4 -- restricción real de Dota 2), hero pools de compañeros cargados a mano (sin cuenta de Steam de terceros, decisión explícita para no abrir el tema de datos personales de más de una persona todavía), presets de equipo guardados localmente en la misma SQLite, y el simulador dejando de pausar entre baneos. Separado a propósito de una pieza mucho más grande e indefinida ("3 caminos completos de draft" tipo álbum) que el usuario prefirió no mezclar "porque se puede prestar a confusiones" -- queda documentada, pendiente de su propio /kickoff. El usuario decidió llevarse el brief a Codex en vez de continuar con /pre-flight en Claude Code.
- [2026-08-01] TSK-034 completado: Codex propuso su propio diseño (2 tablas Drizzle, endpoints CRUD, componentes siguiendo el patrón de hero-pool) antes de codificar -- revisado por el usuario y Claude Code (se agregó el link de NavBar que faltaba) antes de aprobar. Implementado y reportado en verde por Codex (183+27 pruebas). Claude Code hizo su propia verificación independiente, sin confiar en el reporte, y encontró 3 hallazgos reales: un error de TypeScript real en apps/engine que Codex nunca detectó (no corrió tsc ahí), un bug de UX que duplicaba equipos al guardar dos veces sin recargar, y un hallazgo CRÍTICO -- la migración de la tabla nueva nunca se había registrado en el journal de Drizzle, así que jamás se habría aplicado contra la base de datos real pese a que todas las pruebas pasaban (los tests usan una DB en memoria que no pasa por el migrador real, ningún test podía detectar esto por diseño). Los 3 corregidos, migración aplicada de verdad y confirmada contra data/dota2coach.sqlite, CRUD real verificado contra el servidor vivo. Decidida también, por separado, la resolución del timer visible del draft (pendiente de construir): simulador primero, simple, visualmente parecido al lobby real de Dota.
- [2026-08-01] Bloque de deploy completo (TSK-037 a TSK-041) ejecutado y cerrado, y **primer `/castoff` exitoso del proyecto** -- dota2coach en producción real en https://d2kiro-production.up.railway.app. Los 5 tickets de la arquitectura ya decidida (evt-20260801-018) se construyeron vía Codex + revisión independiente de Claude Code, con hallazgos reales corregidos en 3 de ellos (regresión de `getDraftPaths` en TSK-037, `middleware.ts` crasheando en Edge Runtime por la convención `proxy.ts` de Next 16 en TSK-039, y una variable faltante en la lista de TSK-041 verificada antes de dispatchear). En el reintento real de `/castoff`, Sentinel (subagente de seguridad) encontró un hallazgo bloqueante real -- `proxy.ts` fail-open si faltan las credenciales de Basic Auth, contradiciendo el propio criterio "sin ella, no se despliega" de TSK-039 -- corregido con un guard fail-closed en `scripts/start-railway.sh`, verificado en un contenedor Docker real (instalado en la sesión, junto con WSL2, guiado paso a paso). El deploy real a Railway encontró y resolvió 3 problemas de infraestructura no relacionados con el código del motor: 145 commits nunca subidos a GitHub, `next-env.d.ts` (gitignored a propósito) rompiendo el build de Railway pese a funcionar en Docker local, y la app de GitHub de Railway nunca instalada correctamente + auto-deploy apagado. Verificado en producción real (no solo teoría): `/healthz` sano sin auth, Basic Auth exigido en el resto del sitio, `/draft` deshabilitado en la nube sin intentar WebSocket, proxy funcionando, y sincronización manual con OpenDota trayendo los ~126 héroes reales. Detalle completo en `journal.md` evt-20260801-017 a evt-20260801-041.
- [2026-08-20] Random Draft Simulator (spec de Kiro nativo, Fase 2) completado: el usuario lo había dejado a medio camino (tareas 1/2/4/9 hechas, 3/8 escritas sin marcar, 6-16 sin código real pese a algunas marcadas en progreso). Claude Code completó las 17 tareas de `tasks.md` en una sesión: lógica pura, store, hook de sesión contra el motor real, 6 componentes de UI y la ruta `/random-draft`. Aprobado por el usuario un endpoint de solo lectura nuevo en `apps/engine` (`GET /api/meta/hero-stats`) por falta de dato de pick/win rate expuesto a `apps/web`. Verificación en navegador real (no solo tests) encontró y corrigió un bug real que ningún test unitario detectaba (transición de fase trabada tras la Ban_Phase) y confirmó un Conflict_Ban real con seed reproducible. Todo verde (`bun test`, lint, `tsc`) pero **sin commitear todavía y sin pasar por `@redteam`** -- pendiente antes de cerrar la feature. Detalle completo en `journal.md` evt-20260820-047.
- [2026-08-20] QA manual del usuario sobre el Random Draft Simulator (Hilo 1) reveló un problema mucho más de fondo: el bot pickea dos carries seguidos, y el usuario lo describió sin filtro -- "el drafter no funciona como un drafter, es como una mentira". Investigación en el código real confirmó dos hallazgos: (1) el bot del simulador tiene su propio scoring de ~20 líneas, no usa `buildSuggestions` (el motor real); (2) el motor real tampoco tiene ningún concepto de posición (pos 1-5) -- usa etiquetas temáticas de OpenDota donde 57% de los héroes están marcados "Carry" (Zeus, Axe, Tidehunter incluidos), y la señal `role_gap` que debería frenar esto pesa 0.108 contra 0.288 de `counter`. Confirmado además que esto ya estaba documentado como decisión diferida (`architecture.md` D2/E4: STRATZ es la única fuente real de datos de posición, evitada a propósito en fase 1 y 1b). `/kickoff` completado para "Posiciones reales en el motor de sugerencias" (Fase 3): el usuario trajo 2 deep research externos (Gemini) que el asistente no generó -- el primero define la jerarquía real de decisión de un draft (posición > contrarresto > sinergia > timing > laning) y una tabla de anti-patrones con penalización; el segundo compara STRATZ vs. curaduría manual y recomienda curar a mano (6-8h armar, 12-18h/año mantener) citando el propio patrón ya existente del proyecto (`capabilities.json`). Decisión cerrada: cero STRATZ, cero dependencia/secreto nuevo. Alcance de la primera vuelta: filtro/señal de posición + que realmente pese en el resultado. Explícitamente fuera, decisión del usuario de ir paso a paso: arreglar el bot del simulador para usar el motor real, y la queja de UX de "no veo en tiempo real qué ya se sacó" -- cada uno espera su propio turno. El usuario decide quedarse en Claude Code -- sigue `/pre-flight`.
- [2026-08-21] `/pre-flight` completo para Fase 3, los 6 bloques. Decisión de arquitectura clave: `role_gap` y `role_safety` (dos señales existentes, las dos ciegas por usar `roles[]` de OpenDota) se fusionan en una señal nueva, `position_fit`, en vez de arreglarse por separado -- razonaban sobre la misma pregunta de fondo y competían entre sí en el número final. Sigue siendo señal ponderada, nunca filtro duro (el único invariante real del motor se mantiene); necesita `SCORING_WEIGHTS_V4` nueva, V1/V2/V3 quedan congeladas. **Dato real de posición conseguido y validado en esta misma sesión** (no quedó pendiente para después): tras confirmar que ni la API pública de OpenDota ni su SQL Explorer tienen ese dato (verificado directo, no solo repetido de investigación previa), se navegó Dota2ProTracker con un navegador real (Playwright + Edge del sistema) -- Cloudflare bloqueó el fetch simple y las ráfagas rápidas, pero no el acceso pausado y real. Resultado: 126 de 127 héroes con posición real (umbral 200+ partidas para filtrar ruido), mapeados sin ningún desajuste contra los IDs reales del motor, validados contra conocimiento real del juego y contra el caso que arrancó todo -- Spectre confirmado carry puro, Wraith King confirmado Offlane/Carry. Antes de arrancar `/pre-flight`, el usuario pidió auditar `CLAUDE.md`/reglas por desactualización -- se encontraron y corrigieron 3 (la nota de estado de `CLAUDE.md` parada en 2026-08-01, `.claude/rules/engine.md` sin el endpoint de la sesión anterior, y su espejo en `.kiro/steering/`). Plan de validación acordado en dos escenarios manuales con pasos numerados (preferencia ya conocida del usuario), uno de ellos ("no repitas rol") usa el caso real Spectre+Wraith King a propósito. Addendum completo en `docs/agents/architecture.md` § Fase 3. Ningún código tocado -- `/pre-flight` no escribe código, el archivo de posiciones vive en el scratchpad hasta que `/build` lo mueva al repo. Detalle completo en `journal.md` evt-20260821-048. Siguiente: `/blueprint` (Opus).
- [2026-08-21] `/blueprint` de Fase 3 completo -- **tercera y última ejecución en Opus del proyecto** (fase 1, fase 1b, y esta). Generado `SPEC.md` §10.0-§10.11, sin reescribir fase 1 ni 1b. Cerrados los tres números que `/pre-flight` dejó provisionales: `SCORING_WEIGHTS_V4` (position_fit 0.25 / counter 0.27 / patch_meta 0.17 / team_synergy 0.14 / hero_pool_fit 0.17, suma exacta 1.0), el umbral de 200 partidas ya aplicado al dato, y la fórmula completa de `position_fit` (vector de posición por héroe, cobertura del equipo, `need`, `fill` como producto punto, `safety`, y mezcla con `TIMING_BLEND` que decae suave en vez de la ventana dura de 2 picks que usaba `role_safety`). El peso es 0.25 y no 0.208 (la suma de las dos señales que reemplaza) porque el problema real nunca fue el cálculo de `role_gap` sino que no pesaba lo suficiente para mover el resultado -- con V4, `position_fit` controla el 44.6% del score en el primer pick propio sin pool, verificado contra el código (`counter` devuelve `raw: null` sin picks rivales, `hero_pool_fit` no aplica sin pool configurado). Tres decisiones que salieron de leer el código real: el contrato `SignalScorer.score()` no se modifica (fábrica + `heroPositions?` opcional en `BuildSuggestionsOptions`, mismo patrón que `now?`/`metaIsStale?`); costura nueva S10 para el dato inyectable (ninguna prueba puede leer `hero-positions.json` real, se regenera cada parche); y `localSide === "unknown"` pasa a devolver `raw: null`, corrigiendo un caso donde `role_gap`/`role_safety` afirmaban "te falta todo" sin base. Documentado explícitamente que el candado de regresión cero de V2/V3 no se hereda (V4 reemplaza dos señales por una, no hay estado "sin configurar" que reproducir). Hallazgo de alcance: `SignalId`/`SIGNAL_LABELS` están espejados a mano en `apps/web`, entran en el mismo cambio. Los ejemplos numéricos de §10.5 se verificaron ejecutando la fórmula real contra el archivo de posiciones real, no a mano, y se agregó un criterio de aceptación dedicado (simetría con 4 supports propios: Anti-Mage 1.000 vs Crystal Maiden 0.094) tras notar que sin él una implementación que solo premiara supports pasaría los otros dos criterios y seguiría rota. Cero código escrito. Siguiente: `/rulebook` en Sonnet. Detalle en `journal.md` evt-20260821-049.
- [2026-08-21] `/rulebook` de Fase 3 completo (tercera ejecución del proyecto). Rama de importación de Kiro evaluada y **deliberadamente no aplicada** (ver "Nota de importación de Kiro" arriba, para no re-litigarlo). Generadas secciones "Fase 3" en las 4 reglas de `.claude/rules/`: `testing-seams.md` gana la costura **S10** (`HeroPositions` inyectable; ninguna prueba lee el archivo real, con el agravante de que se regenera por parche -- un test atado a su contenido no falla al cambiar el código, falla al cambiar el meta) y la regla de que son 3 pruebas de escenario obligatorias, no 2; `engine.md` gana la regla que originó toda la fase (**`roles[]` de OpenDota NO son posiciones**, prohibido usarlos para razonar sobre cobertura de rol o solapamiento de farm); `web.md` gana el espejo a mano de `SignalId` y la terminología en castellano de las 5 posiciones; `security.md` gana el análisis de Fase 3 (cero frontera de confianza nueva en runtime, cero secreto nuevo, y que agregar el navegador headless al `package.json` exigiría `/gear-up`). `CLAUDE.md` gana "REGLAS DE FASE 3" con los 8 puntos inviolables. Hooks revisados: los 3 existentes son genéricos, no necesitaban cambios, no se tocaron. **5 tickets nuevos, TSK-043 a TSK-047**, todos `must`, en orden estricto de dependencia, cada uno autocontenido con criterios de aceptación numéricos exactos (no aproximados). Dos decisiones de diseño de tickets que importan: TSK-046 (el espejo de `apps/web`) va a `codex` por ser mecánico y autocontenido; y TSK-047 (borrar `role-gap.ts`/`role-safety.ts`) va deliberadamente **al final y solo**, para no mezclar "el motor cambia de comportamiento" con "se limpia código muerto" en un mismo diff -- si algo falla ahí, es inequívocamente la limpieza. Tablero regenerado: 47 tareas, 214 eventos. `verify-simplicity.sh`: PASS. Cero código de producción escrito. Siguiente: `/dispatch` de TSK-043. Detalle en `journal.md` evt-20260821-050.
- [2026-08-21] Cadena TSK-043 a TSK-047 (Fase 3) ejecutada completa en una sola sesión, sin pausas entre tickets por instrucción explícita del usuario ("vamos flecha hasta terminar y luego irnos a probar"), cada uno vía `@build` → `@redteam`. TSK-043 (dato curado + cargador, S10): 126/127 héroes con posición real, recolectados con Playwright contra un navegador real (WebFetch simple bloqueado por Cloudflare) -- 1 hallazgo de `@redteam` no bloqueante (el procedimiento de regeneración vivía solo en el scratchpad de la sesión, no en el repo), corregido en la misma revisión. TSK-044 (`position-fit.ts`, la señal): los 3 escenarios numéricos de `SPEC.md` §10.5 verificados con los `matches` reales, sin hallazgos de `@redteam`; un fallo real de mi propio test detectado y corregido en el camino (esperaba `raw:0.5` para un héroe propio sin dato, el correcto es `0.7` -- el pick sí cuenta para el timing aunque no aporte cobertura). TSK-045 (pesos V4 + integración en `mix.ts`, el ticket que hace que el motor cambie de verdad): **hallazgo de diseño real, no anticipado en `/rulebook`** -- en cuanto `SignalId` deja de incluir `role_gap`/`role_safety`, esos dos archivos y sus tests dejan de compilar de inmediato (no hay estado "huérfano pero vivo" intermedio como asumía TSK-047), así que se borraron acá, adelantando el núcleo de ese ticket; documentado en ambos tickets y en `journal.md`, nunca en silencio. `mix.test.ts` reescrito con ajuste consciente (nunca en silencio, por instrucción explícita del ticket): se borraron los tests del candado de regresión cero de V2/V3 (no se hereda en V4, que reemplaza señales en vez de agregarlas) y los de `role_safety`; se agregó el candado de regresión del bug original contra `buildSuggestions` completo (Spectre + Wraith King disponible -> Wraith King fuera del top 3). `@redteam` de TSK-045 encontró y corrigió un hallazgo real: faltaba el test "los 5 pesos de V4 suman 1.0" que el propio criterio de aceptación pedía. TSK-046 (espejo `SignalId`/`SIGNAL_LABELS` en `apps/web`): ejecutado en `claude-code` en vez de `codex` (contexto ya cargado en la sesión, decisión documentada en el ticket); autocorrección propia -- un comentario que dejé nombraba literalmente las señales viejas, rompiendo el propio criterio de "grep vacío" del ticket, corregido antes de cerrar. TSK-047 quedó reducido a verificación pura (el borrado ya había pasado en 045) -- `grep` final confirma que solo sobreviven menciones históricas y los literales congelados de V1/V2/V3, exactamente lo que el ticket exige que siga existiendo. Estado final: `apps/engine` 210/210 tests + `tsc` limpio, `apps/web` 70/70 tests + `tsc` limpio + lint 0 errores nuevos, `verify-simplicity.sh` PASS en todo momento. Tablero regenerado: 47 tareas, 226 eventos. Siguiente: QA manual de los dos escenarios de `SPEC.md` §10.9 contra el Copilot real. Detalle completo en `journal.md` evt-20260821-056 a evt-20260821-061.
