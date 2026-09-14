## REGLAS DE FASE 2 (Draft en equipo + Random Draft Simulator) — construida vía `/kickoff` + Codex

Fase sin número de sección de `SPEC.md` propio (documentada en `.claude/rules/engine.md`/`web.md`
como fuente de verdad hasta esta migración). No pasó por `/rulebook` como las fases numeradas de
`SPEC.md`, así que este archivo no tenía contraparte hasta que R0.4 Task 24 movió el detalle
completo (antes siempre cargado en `.claude/rules/engine.md`) hacia acá — mismo criterio que el
resto de `docs/rules-archive/`. Resumen de lo no negociable:

- **`partySize` acepta únicamente `1 | 2 | 3 | 5`** — 4 nunca es válido (restricción real de la cola
  de Dota 2). El pool de héroes de cada compañero es dato manual (nombre + hasta 5 héroes), **nunca**
  una cuenta de Steam de un tercero — decisión explícita para no abrir dato personal de más de una
  persona en esta fase.
- **Los "caminos de draft" (`draft-paths/`) NO son un `SignalScorer`**: no participan de
  `SCORING_WEIGHTS_*`, no aparecen en `Suggestion.signals`. Cálculo bajo demanda
  (`GET /api/session/:id/draft-paths`), **nunca** empujado por WebSocket en cada evento — el orden
  de push `draft_state` → `suggestions` sigue intacto, sin un tercer paso automático.
- **`capabilities.json`** (`hasInitiation`, `hasCatch`, `hasWaveclear`, `structuralDamage`,
  `teamfight`, `scaling`, `damageType`) es dato curado a mano, versionado en el repo, **no SQLite**.
  Un héroe sin entrada nunca rompe el cálculo — no participa como candidato.
- **El Random Draft Simulator tiene su propio scoring de bot** (`bot-drafter.ts`, pick rate + ban
  rate), **no usa `buildSuggestions`** — son dos cerebros distintos, confirmado como causa real de
  una queja de producto (QA manual 2026-08-20) que disparó Fase 3.
- **`metaBanPool` usa pick rate como proxy de ban rate** — no existe dato de ban rate en el proyecto
  (OpenDota no lo expone). No es un placeholder sin justificar: es la mejor aproximación disponible.
- **Segundo espejo de tipos deliberado**: `bot-drafter.ts` define su propia versión angosta de
  `HeroPatchStat`/`MetaHeroEntry`/`MetaSnapshot` en vez de importar los tipos reales del motor —
  mismo criterio que el espejo de `SignalId` en `apps/web/features/draft/types.ts`. Si el motor
  renombra un campo de `MetaSnapshot`, hay que corregir los dos espejos en el mismo cambio.

---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

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
