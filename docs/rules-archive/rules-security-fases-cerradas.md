# Archivo — secciones de fase de `.claude/rules/security.md` (verbatim)

Movidas fuera de la carga automática (Etapa 2/3 de instrucciones). Narrativa de cómo se llegó a cada
regla; lo vinculante vigente vive en `.claude/rules/invariantes.md` y en el SPEC. Se leen cuando hacen falta.

## Fase 1b — Primer dato personal del proyecto (SPEC.md §9.7)
- **`account_id` de Steam**: validado en el borde como Steam32 (solo dígitos, `1`–`4294967295`)
  antes de tocar lógica de negocio o construir cualquier URL. Un valor que no pase **nunca** llega
  a `fetch`.
- **Prohibido**: registrar el `account_id` en `journal.md`, en tickets, en `meta_sync.error`, en
  `/api/health`, o devolverlo en el cuerpo de un error. Si aparece en un diff, es hallazgo
  automático de `@redteam` — mismo nivel de cuidado que un secreto, aunque técnicamente sea un
  endpoint público sin autenticación.
- Vive únicamente en la SQLite local. Se transmite a un solo destino externo: la propia OpenDota.
- **Sin secreto nuevo** para el hero pool en sí — OpenDota no requiere API key. `STRATZ_API_KEY`
  (predicción de rol rival) es condicional y futuro, fuera del alcance de 1b — no se implementa
  hasta que se priorice explícitamente, y en ese momento pasa por `/gear-up`.
- `PUT /api/hero-pool` reemplaza el pool completo dentro de una única transacción — cero escritura
  parcial, mismo principio que la sincronización de meta.

## Fase 2 — Draft en equipo (construida vía `/kickoff` + Codex)
- **Pools de compañeros de equipo (`team_members.heroPool`) NO son dato personal** — son texto
  cargado a mano por el usuario (nombre + héroes), nunca una cuenta de Steam real de un tercero.
  Decisión de alcance explícita para no expandir el primer dato personal del proyecto (`account_id`
  de Steam, fase 1b) a más de una persona todavía. Si en el futuro se conecta la cuenta real de un
  compañero, eso activa esta misma sección de nuevo, con el mismo nivel de cuidado que
  `account_id`.
- `capabilities.json` (Fase C) es dato de producto curado sobre héroes públicos de Dota 2 — no es
  dato de usuario ni personal, vive versionado en el repo como cualquier otro archivo de código.
- `GET /api/session/:id/draft-paths` es de solo lectura, sin escritura a SQLite, sin cabecera de
  autenticación (mismo criterio que el resto de la API de lectura local — `apps/engine` solo
  escucha en `127.0.0.1`, ese es el perímetro real). No abre superficie de ataque nueva.

## Fase 3 — Posiciones reales (SPEC.md §10.8)

- **Ningún cruce de frontera de confianza nuevo en runtime.** El único contacto con una fuente
  externa (Dota2ProTracker) es el script de regeneración de `hero-positions.json`, que corre a
  mano en la máquina del desarrollador — **nunca desde `apps/engine`, nunca programado, nunca
  automático**. Si alguien propone automatizarlo dentro del motor, eso reabre esta sección.
- **Ningún secreto nuevo.** La decisión de curar el dato a mano evita exactamente el
  `STRATZ_API_KEY` que 1b había dejado documentado como dependencia condicional futura. Si en el
  futuro se decide integrar STRATZ igual, pasa obligatoriamente por `/gear-up` primero.
- **Ningún dato personal.** Estadísticas públicas agregadas de héroes, misma naturaleza que
  `patchStats`, que ya vive en el motor desde fase 1.
- `hero-positions.json` es **input externo** en el sentido del proyecto, igual que una respuesta
  de OpenDota: se valida en el borde al cargarlo (`loadHeroPositions()`), nunca se confía en su
  forma. Un archivo corrupto o manipulado degrada a "sin datos", jamás rompe el motor ni inyecta
  valores arbitrarios en el scoring.
- **Sin dependencias nuevas.** El script de regeneración usa un navegador headless instalado
  aparte, fuera del árbol de dependencias del proyecto — no entra en ningún `package.json`. Si
  alguien lo agrega como dependencia real, eso exige `/gear-up`/`@depcheck` como cualquier otra.

## Fase 4 — Intención de draft, sub-ticket 4.1 (SPEC.md §11.8)

- **Ningún cruce de frontera de confianza nuevo en runtime.** `archetype_fit` consume
  exclusivamente `HeroCapabilities[]`, ya validado en el borde por `loadHeroCapabilities()` (S9),
  y `DraftPathArchetype`, una unión cerrada de 4 literales interna al proceso. El diseño original
  de esta fase (pieza 2, sinergia en cadena) iba a abrir un sync nuevo hacia OpenDota — se
  descartó tras verificar contra el código fuente real de `odota/core` que esa partición de dato
  no existe; el sub-ticket 4.1 no hereda ese riesgo.
- **Ninguna dependencia nueva, ningún archivo de datos nuevo.** El diseño original de la pieza 1
  iba a introducir `archetype-affinity.json` (con su propia validación de borde); se descartó a
  favor de reutilizar `archetypeFitBonus`, ya existente — sin archivo nuevo, sin costura de
  validación nueva.
- **Ningún secreto nuevo, ningún dato personal.** Mismo tipo de dato agregado y público que el
  resto del motor.
- `intent` (la intención de draft) en 4.1 no llega desde la red ni de la UI — lo inyecta el
  llamador de la fábrica. Su validación en el borde, cuando llegue por API en un sub-ticket
  posterior, es responsabilidad de ese sub-ticket, no de 4.1.

## Fase 4.2 — Integración de `archetype_fit` en el motor (SPEC.md §11.13.7)

- **Ninguna frontera de confianza nueva en runtime.** En 4.2 `archetypeIntent` sólo entra por
  `BuildSuggestionsOptions`, que fija el llamador dentro del proceso — no llega de la red ni de la
  UI todavía. La validación de borde de ese input (contra la unión cerrada
  `push`/`teamfight`/`pickoff`/`scaling`, degradado a "sin intención" ante un valor inválido, sin
  lanzar nunca) es responsabilidad de **4.3**, cuando llegue por request/`hello`.
- **Ninguna dependencia nueva, ningún archivo de datos nuevo, ningún secreto, ningún dato
  personal.** Mismo dato agregado y público que el resto del motor (`capabilities.json`, ya
  validado en el borde por `loadHeroCapabilities()`, costura S9).
- **Cero red en el camino caliente, intacta.** `archetype-fit.ts` vive bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` ya bloquea cualquier `fetch(` sobre el
  árbol completo.

## Fase 6 — Formalizar Pro-Drafter: apertura de equipo consciente de bans (SPEC.md §13.12)

- **Ninguna frontera de confianza nueva.** Las tres entradas de datos de esta fase ya están
  validadas en el borde por loaders existentes: `hero-positions.json` (S10), `capabilities.json`
  (S9), `MetaSnapshot.matchups` (S6, ya sincronizado). Descartar `heroSynergy` (mismo precedente
  de Fase 4) elimina el único sync/tabla nueva que el diseño original iba a abrir — esta fase tiene
  **menos** superficie nueva que el plan que la originó, no más.
- **Cero red en el camino caliente, reforzado.** La única lectura nueva de la ruta es
  `getCachedMetaSnapshot(db, null)` — SQLite y cache en memoria, la misma llamada que el fallback a
  v5 ya hacía en ese handler. `scripts/evaluate-pro-drafter.ts` sigue siendo un script de
  desarrollador manual, nunca invocado desde el motor ni desde CI.
- **Ningún secreto nuevo, ninguna variable de entorno nueva.** `ENABLE_PRO_DRAFTER` es el único
  gate y no cambia de semántica ni de default.
- **Ningún dato personal.** La ruta computa con `accountId: null` por contrato — ningún
  `hero_pool` de ninguna cuenta entra en este camino, así que ningún Steam32 puede aparecer en un
  log/error/ticket de esta fase, por construcción, no por vigilancia.
- **Ninguna dependencia nueva** (`dependencies` ni `devDependencies`) — sin Python, decisión
  explícita del usuario. Sin `/gear-up`, sin `@depcheck`.
- **`apps/engine` sigue atado a `127.0.0.1`.** Esta fase reutiliza `/api/v1/draft/pro-recommendations`,
  que ya existe y ya está gateada — no agrega ninguna ruta HTTP nueva.

## Fase 8 — rehabilitar `counter` + higiene de superficie (SPEC.md §14.9)

- **Ninguna frontera de confianza nueva.** `hero-counters.json` es dato curado del repo, mismo
  perfil que `capabilities.json`/`hero-positions.json`: se valida en el borde al cargarlo
  (`loadHeroCounters()`), un archivo corrupto o manipulado degrada a "capa estadística sola"
  (`Map` vacío) — nunca inyecta magnitudes arbitrarias ni tira el motor. No cruza red ni proceso.
- La capa estadística lee `MetaSnapshot.matchups`, ya validado en la sincronización (S6). Sin
  cambios a esa frontera.
- **Sin secreto nuevo, sin dependencia nueva, sin dato personal, sin variable de entorno nueva.**
  STRATZ queda fuera de alcance (mismo criterio que Fase 3). `shrinkEstimate` ya está en el repo.
- **Cero red en el camino caliente, intacta.** El JSON se carga una vez al iniciar el módulo;
  `verify-simplicity.sh` ya bloquea `fetch(` bajo `apps/engine/src/signals/`.
- **8B no toca `proxy.ts` ni el gate de sesión de Steam.** Sacar links del nav no cambia qué
  rutas existen ni quién puede acceder — el perímetro de auth es el mismo.

## Fase 9 — V6-medido → V6-contextual (SPEC.md §15.7)

- **Ninguna frontera de confianza nueva en runtime.** Todo lo de 9.0 vive fuera de `apps/engine`.
- **`pro-drafts.sqlite` y `dota2coach.sqlite` se abren `readonly: true`** desde todo script de
  `scripts/eval/**` y `scripts/stats/**`. Guard que aborta si una ingesta está escribiendo el mismo
  archivo.
- **Los JSON de `data/generated/` son input externo** (costura S18): loader validado en el borde;
  archivo corrupto, ausente o con forma inesperada → **degrada al mecanismo V6 actual**, nunca
  lanza, nunca inyecta magnitudes arbitrarias en el scoring.
- **Cero PII.** El corpus profesional y el Golden Dataset son datos públicos de partidas
  profesionales. Ningún `hero_pool` de ninguna cuenta entra en este camino: **ningún Steam32 puede
  aparecer en un reporte, log, `journal.md` o ticket de Fase 9, por construcción, no por
  vigilancia**.
- **Sin secreto nuevo de runtime, sin variable de entorno nueva, sin dependencia nueva** (ni
  `dependencies` ni `devDependencies`). `CONTEXT7_API_KEY` es dev-only y ya existía (Fase 9 previa).
- **`apps/engine` sigue atado a `127.0.0.1`.** Cero red en el camino caliente:
  `verify-simplicity.sh` ya bloquea `fetch(` bajo `apps/engine/src/`. **`scripts/eval/**` y
  `scripts/stats/**` nunca se importan desde `apps/`** — verificable mecánicamente.
- **Hook de frontera de datos** (`data/curated` vs `data/generated`): rechaza cualquier `Edit|Write`
  sobre `data/curated/**` cuyo origen sea un script de `scripts/stats/**` o `scripts/eval/**`.
  Determinista, sin heurística. Se prueba el rechazo, no se declara.
- **Hook `write_scope`**: cada ticket de Fase 9 declara `write_scope: [globs]` en su frontmatter;
  el hook PreToolUse rechaza `Edit|Write` fuera de esos globs cuando el ticket está en `doing`.
  Ausente → no bloquea (retrocompatible con los 192 tickets previos).
- **Dos agentes nuevos** (`data-stat-engineer`, `evaluation-engineer`): `tools` mínimas, **veto
  explícito de escritura** sobre `apps/engine/src/signals/**`, cualquier archivo de scoring y
  `apps/web/**`. **No reciben `mcp__context7`** (R3-14: tener la capacidad no implica concederla).

## Fase 9.1 — comparabilidad + calibración empírica (SPEC.md §16.11)

- **Ninguna frontera de confianza nueva.** `data/generated/percentiles.json` es dato generado del
  repo — input externo en el sentido del proyecto: `loadCalibration()` valida en el borde
  (esquema, `p05 < p95`, no NaN, `SignalId` conocido); corrupto/ausente/forma inesperada →
  **fallback a `RAW_RANGE`**, byte-idéntico a V6, nunca lanza, nunca inyecta un rango arbitrario.
  Mismo criterio literal que `loadHeroPositions()` / `loadHeroCounters()`.
- **Sin secreto nuevo, sin dependencia nueva, sin variable de entorno nueva.** El generador de
  percentiles (`scripts/stats/build-percentiles.ts`) es offline, SQLite **`readonly: true`**,
  cero red, y **nunca se importa desde `apps/`** — verificable mecánicamente.
- **El fix del mismatch de patch del backtest (§16.4) vive SÓLO en `scripts/eval/`** — un
  `patchOverride` en el reconstructor de `ReplayCase`. **No toca `apps/engine`.** `patchMetaScorer`
  queda sin cambios (en producción los drafts llevan el patch semántico correcto).
- **Cero PII.** Percentiles y perfil se calculan sobre datos públicos agregados. Ningún `hero_pool`
  de ninguna cuenta entra en este camino.
- `apps/engine` sigue atado a `127.0.0.1`. Cero red en el camino caliente: `verify-simplicity.sh`
  ya bloquea `fetch(` bajo `apps/engine/src/`.
- **`gate.ts` pasa a `--enforce`** en el camino de commit de 9.1 (en 9.0 era informativo): un
  cambio que baje NDCG@5 más que la tolerancia, suba Bad Pick Rate@5 más que la tolerancia, o
  produzca `ConstraintViolationRate > 0` **bloquea el commit**.
