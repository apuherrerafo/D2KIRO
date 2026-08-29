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

