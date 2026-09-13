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


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 4.2 — `archetype_fit` entra al motor (S3) — SPEC.md §11.13

Integración de la señal aislada en 4.1. **`SCORING_WEIGHTS_V6` pasa a ser la constante activa**;
V1-V5 quedan congeladas por nombre, sin editar un solo valor.

- **`SCORING_WEIGHTS_V6: Record<SignalId, number>`, 6 pesos, suman `1.0`** (prueba unitaria
  obligatoria, como toda versión desde V1). `archetype_fit: 0.10`; los otros 5 = su valor de V5 ×
  `0.90` exacto (`position_fit 0.342`, `counter 0.216`, `patch_meta 0.117`, `team_synergy 0.117`,
  `hero_pool_fit 0.108`). El factor `0.90` no es negociable: es lo que hace que la redistribución
  proporcional de `mix.ts` reproduzca V5 **al bit** cuando `archetype_fit` no vota.
- **Antes de ampliar `SignalId`, `SCORING_WEIGHTS_V4` y `V5` pasan a `Record<SignalIdV5, number>`**
  (literales históricos propios, mismo mecanismo que TSK-045 usó para V1/V2/V3). Sin ese re-tipado
  no compila. Los valores de V4/V5 no cambian una coma.
- **`SignalId` gana `"archetype_fit"` (6º literal).** `SignalContribution`/`SignalScorer` no
  cambian de forma. Los alias `ArchetypeFitContribution`/`ArchetypeFitScorer` de
  `archetype-fit.ts` **se borran**; el cuerpo de `score()` no cambia una línea (tipado
  estructural — §11.4 lo previó).
- **`RAW_RANGE.archetype_fit = [0, 1]` en `mix.ts`** — `raw` ya viene normalizado del scorer
  (`ARCHETYPE_MAX_BONUS` por arquetipo). Nunca se deja la escala cruda de `archetypeFitBonus` en
  `RAW_RANGE`, que es un rango único por señal y no puede representar uno distinto por arquetipo.
- **`BuildSuggestionsOptions.archetypeIntent?: DraftPathArchetype`**, mismo patrón que
  `now?`/`heroPositions?`/`heroCapabilities?`. Ausente → el scorer recibe `intent === undefined`
  → `applicable: false` (nunca vota, nunca baja la confianza). En 4.2 lo fija **sólo el llamador
  dentro del proceso** — el transporte por request/WS y su validación de borde son 4.3.
- **`createArchetypeFitScorer(heroCapabilities, options.archetypeIntent)` se ensambla por
  llamada** en `buildSuggestions`, junto a `position_fit`/`team_synergy` (no es singleton de
  módulo: depende de datos inyectables). `safeScore`/`computeConfidence` ya cubren `raw: null` y
  `applicable: false` — sin ramas de error nuevas.
- **Sin decaimiento en 4.2.** `raw` sigue constante por `(intent, hero)` como en 4.1. El posible
  sobre-empuje en picks tardíos es calibración de 4.3 — no se le agrega dependencia de
  `DraftState` al scorer sin datos de QA que la respalden.
- **`position_fit` sigue siendo el peso más alto de V6** (`0.342`). Fase 3 no se reabre.
- **4.2 no toca `intent/`, `pipeline/`, `knn/`, `lane/` ni `ENABLE_PRO_DRAFTER`** — el Pro-Drafter
  dark es otro universo, sin relación con esta señal.

