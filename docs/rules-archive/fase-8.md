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


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 8 — rehabilitar `counter` (base curada + shrinkage) (S3) — SPEC.md §14

Toca `apps/engine/src/signals/{counter,relationship-index,mix,hero-counters}.ts` +
`hero-counters.json`. Estrictamente aditivo salvo la re-parametrización deliberada de la capa
estadística (§14.7), con candado de regresión cero de dos pruebas.

- **`SignalId`, `SCORING_WEIGHTS_V1`-`V6`, `RAW_RANGE.counter` (`[-0.12, 0.12]`), `weights.ts` no
  se tocan.** `RELATIONSHIP_MIN_GAMES = 200` sigue exportado con su valor — el default del módulo
  no cambia; `counter.ts` llama a `createRelationshipIndex(matchups, COUNTER_MIN_GAMES)` con el
  valor bajo.
- **`counterScorer` (singleton) → `createCounterScorer(curated, opts)`**, mismo patrón que
  `createPositionFitScorer`/`createTeamSynergyScorer`. `CounterScorerOptions`: `minGames?`
  (default `COUNTER_MIN_GAMES`; el candado pasa `200`), `shrinkPriorStrength?: number | null`
  (default `COUNTER_SHRINK_PRIOR_STRENGTH`; `null` → usa el delta crudo, comportamiento de hoy).
- **`mix.ts`**: `MODULE_HERO_COUNTERS = loadHeroCounters()` a nivel de módulo (como
  `MODULE_HERO_POSITIONS`); `createCounterScorer(options.heroCounters ?? MODULE_HERO_COUNTERS)`
  ensamblado por llamada; `BuildSuggestionsOptions.heroCounters?` inyectable (patrón
  `heroPositions?`/`heroCapabilities?`).
- **`signals/hero-counters.ts` (`loadHeroCounters`)**: valida en el borde — descarta `level` fuera
  de `{"hard","medium"}`, `why` vacío, `vs` no entero o desconocido (`CURATED_HERO_IDS`), víctima
  con `vs` duplicado. Archivo ausente / JSON inválido / forma de raíz inesperada → **`Map` vacío**,
  nunca lanza. Mismo criterio literal que `loadHeroPositions()` con archivo malformado.
- **`hero-counters.json`**: keyed por víctima, `{ "<heroId>": [{ vs, level, why }] }`. Archivo
  estático versionado en el repo, **no SQLite**. `why` es texto visible (obligatorio).
- **`relationship-index.ts`**: único cambio = agregar `observedWinrate: row.wins / row.games` a
  `CounterEvidence` (1 línea, aditivo — los consumidores actuales lo ignoran). Sin cambios
  estructurales.
- **Fórmula de `score()`** (§14.5): para cada rival revelado `r`, una `c_r` — capa curada
  (prioridad, bidireccional: `curated[candidate]` incluye `r` → `-M[level]`; `curated[r]` incluye
  `candidate` → `+M[level]`) o, si `r` no quedó cubierto, capa estadística
  (`shrunkWinrate - base`, con `base = observedWinrate - delta` y
  `shrunkWinrate = shrinkEstimate(observedWinrate, games, base, P)`; `shrinkPriorStrength: null`
  ⇒ `= delta`). `raw = mean(c_r)` sobre los rivales cubiertos; `null` si ninguno.
  `sampleSize` = Σ `games` **sólo** de la capa estadística.
- **`shrinkEstimate` se reutiliza de `apps/engine/src/pro/shrinkage.ts`** (TSK-165) — no se
  reimplementa. Shrink hacia el **baseline del candidato**, no hacia 0.5.
- **Constantes** (`counter.ts`): `M = { hard: 0.12, medium: 0.06 }`, `COUNTER_MIN_GAMES = 10`,
  `COUNTER_SHRINK_PRIOR_STRENGTH = 20`. Valores de arranque, ajustables tras el QA — no reabren
  el SPEC.
- **Cero red en el camino caliente, intacta**: `counter.ts`/`hero-counters.ts` bajo
  `apps/engine/src/signals/`, donde `verify-simplicity.sh` bloquea cualquier `fetch(`. El JSON se
  carga una vez al iniciar el módulo.
- **Sin dependencia nueva, sin STRATZ.** El peso `0.216` de `counter` en V6 no cambia — se
  rehabilita la señal, no se re-pondera.

### Fase 8 addendum — alivio por counters baneados (`TSK-188`, SPEC.md §14.13)

- Término **positivo** aditivo dentro de `createCounterScorer`, sobre el mismo `raw` de `counter`
  — **no** una clave nueva en `SignalId`/`RAW_RANGE`/`weights.ts`.
- Fuente: `curated.get(candidate)` (héroes que counterean al candidato) ∩
  `observedDraftFacts(state).bannedHeroes`. Solo dirección positiva.
- **Vota desde el pick 1** (no necesita `revealedEnemyPicks`). `counter` deja de ser siempre
  `null` en picks tempranos.
- `banRelief === 0` → `raw = meanRevealed` **sin clamp** (8A byte-idéntico, el candado de §14.7
  sigue dando `0.12222`); `banRelief > 0` → `raw = clamp(meanRevealed + banRelief, -M.hard,
  M.hard)`. `meanRevealed = 0` si no hay rivales cubiertos; `contribs` vacío **y**
  `banRelief === 0` → `raw: null`. `banRelief` no suma a `sampleSize`.
- Constantes de arranque QA-tuneables: `BAN_RELIEF = { hard: 0.04, medium: 0.02 }`,
  `BAN_RELIEF_CAP = 0.06`.
- `explanation`: cláusula `"N de sus counters están baneados: <hasta 2 nombres>"`, anexada al
  texto de 8A si hubo rival revelado, o sola si solo hubo alivio.
- Candado de regresión §14.7 intacto: con `curated = new Map()`, `banRelief` es siempre 0.

