# MEMORY.md — vista comprimida y regenerable de `journal.md`

Regenerado el 2026-08-28 a partir de `journal.md` (hasta evt-20260828-179) y
`docs/agents/PROGRESS.md`. Esta vista es descartable y regenerable — la fuente de verdad sigue
siendo `journal.md` (append-only, nunca se comprime ni se borra). Regeneración anterior:
2026-08-26 (cubría hasta evt-20260827-177c).

## Estado del proyecto

**Fase 6 (Formalizar Pro-Drafter, `TSK-126` a `TSK-142`+`144`+`145`) está `done` e integrada** —
reconstruida en 15 commits atómicos por `TSK-146` (2026-08-27) tras encontrar 2 commits locales
rotos (`ban-relief.ts` importaba un módulo nunca commiteado). El overhaul de apertura separa ghost
counters de opportunity windows, usa FlexScore y overrides Tier-1 deterministas, y el benchmark
primario ahora mide Role-Pressure. La corrida de referencia mostró 27.3% de estabilidad ante bans
irrelevantes y 94.9% de cambio ante bans pivotales; por ello `ENABLE_PRO_DRAFTER` permanece
apagado. **Fase 7 (línea de datos profesionales Tier 1) está en ejecución: `TSK-146` a `TSK-179`
creados; todos `done` salvo `TSK-174` (`in_progress`, ampliación de corpus a 3.000 drafts, corre
solo desde un entorno con red real) y `TSK-179` (`backlog`, bloqueado por `TSK-174`).** El pipeline
offline está construido y probado (contratos, ingesta/normalización/clasificación, agregados y
combinatorios, compilador de patrones, consulta contextual pura, analyzer QA, benchmark, shrinkage,
ban-scaling, evidence-gate, y en `TSK-178` la recuperación de los slots de Dire que la ingesta
vieja descartaba). **Gate 3 sigue sin pasar por estabilidad ante bans irrelevantes (27,3% vs
80%); `ENABLE_PRO_DRAFTER` permanece apagado y G4 no arranca hasta un segundo `/blueprint`.** El
2026-08-28 se consolidó en Git todo el árbol pendiente de Fase 6 tardía + Fase 7 en 6 commits
locales (aún sin push). **144 tickets `TSK-001` a `TSK-145` están `done`; `TSK-143` es un hueco
huérfano permanente, nunca reutilizado.** Fase 1, Fase 1b
(hero pool), el bloque de feedback directo de producto, Fase 2 ("Draft en equipo" + Random Draft
Simulator), el deploy a Railway, Fase 3 (posiciones reales, `position_fit`) y una auditoría de
arquitectura + recalibración de pesos posterior están todas completas y verificadas contra
procesos reales corriendo — no solo pruebas unitarias. **Deploy real en producción**:
https://d2kiro-production.up.railway.app, auto-deploy activo sobre `master`.

## Arquitectura construida (por pieza) — estado actual, no solo fase 1

- **C2 — Reductor** (`apps/engine/src/draft/reducer.ts`): `applyDraftEvent` puro, contrato
  `draft-event/v1`. `quality.unconfirmed` se popula cuando `confidence < 0.6`.
- **C3 — Motor de sugerencias** (`apps/engine/src/signals/`): 5 `SignalScorer` activos —
  `counter`, `patch_meta`, `team_synergy`, `hero_pool_fit`, **`position_fit`** (reemplazó
  `role_gap`+`role_safety` en Fase 3, usa `hero-positions.json` curado a mano, nunca `roles[]` de
  OpenDota). **`SCORING_WEIGHTS_V5` es la constante activa**
  (`position_fit: 0.38, counter: 0.24, patch_meta: 0.13, team_synergy: 0.13, hero_pool_fit: 0.12`,
  suma 1.0 verificada por test). V1-V4 quedan congeladas por nombre, nunca se editan.
  `apps/engine/src/tools/batch-harness.ts` valida el motor real a escala (N drafts sintéticos,
  PRNG determinista, sin red ni SQLite) — p95 0.34ms, p99 0.86ms sobre N=1000.
- **C4 — Persistencia** (`apps/engine/src/db/`): esquema Drizzle/SQLite, sincronización con
  OpenDota, `hero_pool`/`settings`/`team_groups`/`draft_feedback`. Cache LRU de winrates de
  matchup (capacidad 512), cache de `MetaSnapshot` en memoria (invalidada en sync y en reemplazo
  de pool), `SessionStore` con TTL de 45min.
- **Servidor Bun** (`apps/engine/src/server/`, partido en TSK-056/057/058 de 682 a 257 líneas en
  `app.ts` + 5 módulos de rutas nuevos: `routes/{hero-pool,team-groups,simulator-sessions,meta,
  draft-paths}.ts`): 127.0.0.1 únicamente, `x-capture-token` en runtime, rate limit 20 eventos/seg
  por sesión + 200 eventos/seg por token (TSK-066), CORS allowlist localhost-only.
- **apps/web**: vista de draft en vivo (6 estados, WebSocket+Zustand), páginas normales con RTK
  Query, `/random-draft` (Random Draft Simulator — bot propio con scoring simplificado, **no** usa
  `buildSuggestions`, desde TSK-063 usa posición real de `hero-positions.json` en vez de `roles[]`
  para su bono de complemento), `/team-groups`, configuración de hero pool.
- **Simulador** (`apps/engine/src/simulator/`): reproduce guiones de draft grabados.

## Patrones operativos establecidos (confirmados, no solo intentados una vez)

- **Excepción de 200 líneas: avisá con `AskUserQuestion` en cuanto se detecta, nunca asumas la
  respuesta de antemano.** Respuesta consistente del usuario en 7+ tickets: "completo, pedir
  excepción al cerrar" — pero conocer el patrón no autoriza a saltarse la pregunta. `@build`
  (SKILL.md) sigue avisando; no se detiene a mitad de una unidad lógica para eso, pero tampoco
  asume en silencio (corregido el 2026-08-22, una edición anterior de este mismo día lo había
  invertido por error).
- **"Verificar por ejecución" significa reproducir las condiciones reales del cliente** — CORS,
  transición de fase trabada, primer pick vía entrada manual: los tres bugs reales solo aparecieron
  con navegador real, nunca con `bun test` solo.
- **Codex sin créditos, confirmado 2/2 en TSK-002/003** → desde TSK-004 en adelante, todo ticket
  con `preferred_tool: codex` se asigna directo a `claude-code` sin pasar por el ciclo
  dispatch-Codex-Handoff.
- **Gaps de planificación descubiertos en construcción, no al crear el ticket** → se presentan al
  usuario con `AskUserQuestion` (arreglar dentro del ticket actual vs. crear uno aparte).
- **Trabajo hecho fuera del flujo de tickets (Kiro nativo) se registra retroactivamente, nunca se
  re-litiga.** Precedente doble: Random Draft Simulator (Hilo 1, spec de Kiro sin tickets propios)
  y TSK-066 (spec de Kiro "engine-performance-optimizations", encontrado sin commitear por otra
  sesión que se topó con `git status` sucio pese a que el journal decía "working tree limpio"
  horas antes — journaleado retroactivamente, ticket creado solo para habilitar
  `simplicity_exception` de forma trazable).
- **El peso, no la fórmula, es el único lever real bajo `normalize()`** (transformación lineal) —
  confirmado dos veces: una vez con `role_gap` (por eso nació `position_fit` con peso 0.25 en vez
  de arreglar el cálculo viejo) y otra vez con `SCORING_WEIGHTS_V5` (`position_fit` sube a 0.38
  tras recalibrar `RAW_RANGE.counter` y ver que el margen sobre un core que repite rol caía a
  ~1.5 puntos).

## Hallazgos de seguridad reales de `@redteam`/Sentinel (todos resueltos, ninguno pendiente)

1. **TSK-003** — URL de imagen de héroe vulnerable a host-injection. Corregido con
   `SAFE_RELATIVE_IMG_PATH`.
2. **TSK-010** — mensaje WebSocket (`hello`) sin validar runtime. Corregido con
   `isValidClientMessage`.
3. **TSK-012** — mismo patrón del lado cliente + ausencia de error boundary. Corregido con
   `validation.ts` + `app/draft/error.tsx`.
4. **TSK-014** — `apps/engine` sin headers CORS. Corregido con allowlist localhost-only.
5. **TSK-034** — migración de `team_groups` nunca registrada en el journal de Drizzle (crítico:
   jamás se habría aplicado contra la DB real pese a tests en verde, porque los tests usan una DB
   en memoria que no pasa por el migrador real).
6. **Deploy (evt-20260801-040)** — `proxy.ts` fail-open si faltan credenciales de Basic Auth en el
   contenedor de Railway. Corregido con guard fail-closed en `scripts/start-railway.sh`.
7. **TSK-064 (crítico, no en ningún reporte original)** — `buildMetaSnapshot()` nunca incluía el
   hero pool del usuario: `hero_pool_fit` (17% del peso en V4) devolvía `applicable: false` en el
   100% de los drafts reales desde Fase 1b, silenciosamente, porque cada capa se probaba aislada
   con fixtures que ya traían el pool armado a mano.
8. **TSK-066** — `index.ts` no conectaba `tokenRateLimiter` a `createApp()`: el rate limit de 200
   eventos/seg por token (Requirement 7 del spec) estaba implementado correctamente pero era
   código muerto en producción. Encontrado por Sentinel, corregido en el mismo ticket.

## Gaps de infraestructura del propio ecosistema, corregidos en el camino

`scripts/verify-simplicity.sh`: 4+ rondas de fixes reales (base de comparación sin HEAD, ciego a
untracked, sección de secretos con el mismo bug, `package.json` de raíz que no existe en el
monorepo) — más el cambio a `git diff --cached` (TSK catch-up 2026-07-28) para que un backlog
grande pudiera dividirse en commits lógicos sin que el gate viera todo el árbol pendiente.
`scripts/sync-context.ts` (nuevo, 2026-08-22): detecta cuando `AGENTS.md`/`.kiro/steering/`
quedan atrás del stack real, y cuando `plan.md`/`MEMORY.md` quedan atrás del estado real de los
tickets — nace directamente de que `AGENTS.md` fue encontrado como plantilla genérica sin llenar
(Bun+HTMX) casi un mes después de que `CLAUDE.md` documentara Next.js. **TSK-067**: cierra ese
mismo hallazgo de punta a punta — `AGENTS.md`/Sentinel/`@redteam`/`.kiro/steering/*` calibrados
contra el stack real, `USER.md`/`CONTEXT.md` poblados, este archivo regenerado. En el camino se
encontró y corrigió una contradicción real entre `@build`/`USER.md`/`MEMORY.md`: los tres habían
quedado escritos como "no preguntes por adelantado, el patrón ya se confirmó" — invirtiendo la
regla real ("nunca asumas la respuesta de antemano, seguí preguntando aunque el patrón se repita").
`CLAUDE.md` § REGLAS DE FASE 3 también se corrigió (`SCORING_WEIGHTS_V4` → `V5`, TSK-065).

## Decisiones de diseño no especificadas en SPEC.md, documentadas para referencia futura

- `unknown_hero` (reductor) valida solo forma, sin catálogo de héroes inyectado.
- "Bracket bajo/medio" (`patch_meta`) = mitad inferior de la escalera de 8 de OpenDota, sin
  taxonomía oficial de Valve.
- `RAW_RANGE.counter` original (`[-0.3, 0.3]`) nunca se midió contra datos reales — recalibrado a
  `[-0.12, 0.12]` en TSK-065 (estimación de dominio, todavía no medida contra percentiles reales
  de `heroMatchups` — pendiente como script offline futuro).
- CORS: el binding a `127.0.0.1` sigue siendo el perímetro de seguridad real; el allowlist de
  origin solo destraba la llamada cross-port legítima de `apps/web`.
- Segundo espejo de tipos, documentado desde TSK-062: `bot-drafter.ts` (Random Draft Simulator)
  define su propia versión angosta de `HeroPatchStat`/`MetaHeroEntry`/`MetaSnapshot`, en vez de
  importar los tipos reales del motor — mismo criterio que el espejo ya documentado de `SignalId`
  en `apps/web/features/draft/types.ts`. Un rename de campo en el motor toca los dos.

## Notas abiertas / deuda técnica conocida (ninguna bloqueante)

- Chen es el único héroe sin ninguna posición real en `hero-positions.json` (no llegó al umbral de
  200 partidas en ninguna de las 5) — `position_fit` lo trata como `raw: null`, no rompe nada.
- Predicción de rol/posición del rival (STRATZ) — dependencia condicional documentada desde fase
  1b, nunca priorizada.
- El sistema combinatorial completo de "caminos de draft" (ejes de timing, forma de recursos, win
  conditions) — la v1 (TSK-036) solo cubrió el eje de plan macro, a propósito.
- Overwolf (spike, nunca corrido contra una partida real) y el adaptador OCR (contrato
  especificado, nunca construido) — únicos capturadores automáticos de fase 1 sin validar.

## Referencias

- TSK-163 completado: `scripts/pro/signal-stability.ts` compara snapshots por señal de forma pura
  y determinista para diagnosticar la sensibilidad del Pro-Drafter; no modifica scoring ni flags.
- TSK-164 completado: `scripts/pro/confidence-audit.ts` detecta patrones bajo el mínimo de muestra,
  incluyendo filas exploratory, sin activar ni modificar el scoring.
- TSK-165 completado: `apps/engine/src/pro/shrinkage.ts` regulariza estimaciones con prior y devuelve
  `null` para muestras débiles; permanece aislado del scoring.
- TSK-166 completado: `apps/engine/src/pro/ban-relevance.ts` atenúa pesos de ban por pick-rate,
  con techo en el peso base y sin integración al scoring.
- TSK-167 completado: `apps/engine/src/pro/evidence-gate.ts` exige mínimo 30 muestras y confianza
  estrictamente mayor a 0.6 para habilitar evidencia profesional.
- TSK-168 completado: `scripts/pro/ingest-drafts.ts` admite objetivo configurable de 3.000 drafts y
  reanudación por checkpoint; la descarga masiva no se ejecutó automáticamente.
- TSK-169 completado: `writeCompiledPatterns` y la CLI recompilan patrones determinísticamente desde
  agregados inyectados; la ejecución masiva queda pendiente de la ingesta.
- TSK-170 completado: Gate 3 re-ejecutado con corpus 502; Jaccard 0.278 y rank-1 90% pasan, pero
  estabilidad irrelevante 27.3% falla, por lo que el flag sigue apagado.
- TSK-171 completado: `analyzeSignalContributions` y `instability-report.ts` muestran que
  `denial_score` domina la variación observada (delta 0.279966; contribución 0.069992; 43/50),
  mientras lane/KNN permanecen estables; no modifica pesos ni scoring.
- TSK-172 completado: el diagnóstico separa presión de rol; `denial_score` sigue variando incluso
  en el grupo etiquetado irrelevante (delta 0.494974, 10/11 pares), por lo que aún no se calibran
  pesos y se requiere auditar la clasificación/fuente de bans.
- TSK-173 completado: `classifyBanRelevance` exige presión de rol o matchup con evidencia para
  marcar un ban como pivotal; ausencias y valores inválidos permanecen irrelevantes.
- TSK-174 en progreso: diagnóstico no destructivo confirma que el entorno actual no resuelve
  `api.opendota.com` (DNS); posteriormente un entorno autorizado respondió HTTP 200 y un lote
  mínimo persistió 2 drafts completos, 7 rechazados y checkpoint `8946563158`.
- TSK-175 completado: `validateDraftShape` rechaza drafts sin 24 turnos, orden inválido, héroes
  fuera del catálogo curado de OpenDota o metadatos mínimos; queda listo para integrarse a la ingesta.
- TSK-176 completado: la ingesta usa concurrencia secuencial, 500 requests por sesión y pausa
  configurable (`--delay-ms`, 2.5s por defecto); `429` termina de forma reanudable.
- TSK-177 completado: el catálogo de validación se curó desde `/api/heroes` (127 IDs, incluyendo
  136 y 155; conserva huecos de Valve), eliminando el falso rechazo por el límite histórico 127.
  Lote posterior de 20 requests: 19 nuevos drafts, 21 completos acumulados y checkpoint
  `8946563158`; permanecen 7 rechazos históricos para revisión posterior.
  La ingesta controlada posterior alcanzó 500 partidas procesadas: 414 `complete` y 86 excluidas
  por `tier_not_accepted`; el corpus utilizable mantiene únicamente los drafts profesionales.
- Sesión de agregación (sin ticket previo): `scripts/pro/aggregate-from-db.ts` lee los drafts
  `complete` de `pro-drafts.sqlite` (readonly), reconstruye `ProDraft`/turnos/slots, reutiliza
  `aggregate.ts`/`classify-tier`/`normalize` y emite un JSON provisional determinista con metadata
  (`source`/`fetchedAt`/`sampleSize`/`confidence`) y resumen de cobertura; no sobrescribe
  `pro-patterns.json`.
- TSK-178 completado (código/esquema): la ingesta guardaba solo los 5 slots de Radiant por partida
  porque escribía `team = slot.team ?? 0` y la PK `(match_id, team, position_est)` descartaba el
  lado Dire. Ahora `ingest-drafts.ts` deriva `team` de `isRadiant`/`player_slot`, la PK de
  `pro_draft_slots` pasa a `(match_id, team, hero_id)`, y `scripts/pro/backfill-slots.ts`
  (idempotente, offline, reconstruye desde `raw_json`) recupera Dire. Verificado sobre una copia
  full-size: slots 10.855 → 21.710, posiciones elegibles del agregador 68 → 108. El backfill sobre
  la SQLite de producción es `TSK-179`, bloqueado por `TSK-174` (no correrlo mientras codex
  escribe el mismo archivo).

Ver `docs/agents/USER.md` para preferencias de proceso confirmadas del usuario (excepciones al
cierre, verificación real vs. solo tests, terminología de posiciones) y `docs/agents/CONTEXT.md`
para el glosario de dominio y el stack cerrado.
