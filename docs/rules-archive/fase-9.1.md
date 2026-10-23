## REGLAS DE FASE 9.1 (comparabilidad + calibración empírica) — desde `docs/specs/SPEC.md` §16

Generadas por `/rulebook`. `/blueprint` angosto corrido en **Sonnet** (`SPEC.md` §15.0: los
blueprints de 9.1–9.5 no cuestan Opus salvo gatillo objetivo; 9.1 no cruza ninguno). Alcance:
9.1 aplica al motor el mecanismo que 9.0 midió. Detalle completo en `.claude/rules/` (secciones
"Fase 9.1" en `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — resumen de lo no
negociable:

- **9.1 SÍ toca `apps/engine/src/signals/`** (a diferencia de 9.0). **No toca `weights.ts`** —
  `SCORING_WEIGHTS_V6` sigue siendo la constante activa; `SCORING_WEIGHTS_V7` es 9.5. `counter` no
  se parte en 3 (9.3). Empirical Bayes es 9.2. Gating contextual es 9.3.
- **`raw: null` sigue sagrado** — nunca 0/0.5/50. 9.1 agrega un campo `contribution` separado y un
  relleno `μᵢ(S)` que **jamás** se escribe en `raw`.
- **`SignalContribution` gana `normalized: number | null` y `evidenceConfidence: number`**
  (aditivo). Espejo a mano en `apps/web` (`features/draft/types.ts` + `validation.ts`) **en el
  mismo cambio** o `tsc` de `apps/web` rompe. `Suggestion` gana `evidenceCoverage`/`guessingIndex`
  (0–1). **Nada se renderiza en 9.1** (UI diferida, D4) — sólo el tipo y los reportes de eval.
- **Percentiles empíricos reemplazan la normalización lineal de `RAW_RANGE`.** `RAW_RANGE` queda
  en el código como **fallback**, sin editar sus valores. Se congelan sobre folds de **train** del
  `split.json` de 9.0. `loadCalibration()` (S18): archivo corrupto/ausente/forma inesperada →
  fallback a `RAW_RANGE`, byte-idéntico a V6, nunca lanza. Fallback jerárquico `global → bracket`
  (el eje `patch` no participa — mono-parche, C3).
- **Fin de la redistribución candidate-specific → mezcla por estado.** El denominador de la
  redistribución de pesos es **el mismo para todo candidato de un estado `S`**. `raw:null` de un
  candidato en una señal disponible → su `contribution` usa `μᵢ(S)` (media del `normalized` sobre
  los candidatos de `S` que sí tienen dato); `raw` sigue `null`.
- **`EvidenceCoverage(h)` / `GuessingIndex(h)`** internos. `computeConfidence` pasa a derivarse de
  `EvidenceCoverage`, no del conteo de nulls.
- **Precondición bloqueante**: el mismatch de patch del backtest (`patch="60"` vs `patchStats
  "7.41e"`) se arregla **sólo en `scripts/eval/`** (`patchOverride` en el reconstructor de
  `ReplayCase`). **No toca `apps/engine`.** Se re-genera `signal-profile.json` + `v6-measured.json`
  antes de calcular ningún percentil; el nuevo `v6-measured.json` es el baseline de referencia del
  `--enforce`.
- **Candado de regresión cero — dos pruebas obligatorias**: calibración en fallback + `A(S)`
  legacy + sin `μᵢ(S)` ⇒ `mixScore` byte-idéntico a V6; `buildSuggestions` con opciones legacy no
  mueve el ranking ni un `signals[].weighted`.
- **`gate.ts` pasa a `--enforce`** en el camino de commit (en 9.0 era informativo): un cambio que
  baje NDCG@5 más que la tolerancia (`0.041`), suba Bad Pick Rate@5 más que la tolerancia
  (`0.035`), haga caer un contexto más que su tolerancia, o produzca `ConstraintViolationRate > 0`
  **bloquea el commit**.
- **Criterio de éxito** (no bloqueante para mergear, sí para declarar la fase útil): **baja el Bad
  Pick Rate@5** respecto de `0.293` con NDCG@5 ≥ `0.771 − 0.041`. Si la calibración no lo logra,
  9.1 igual entra (deja el mecanismo listo para 9.2/9.3) y se anota que la palanca real está en
  el split de `counter` (9.3).
- **Sin dependencia nueva, sin secreto, sin variable de entorno nueva, cero red, cero PII.**
- **6 tickets, `TSK-207`→`TSK-212`** (`SPEC.md` §16.13): A patch-fix del backtest ·
  B `build-percentiles.ts` · C `calibration.ts` + `SignalContribution` v2 · D `mix.ts` mezcla por
  estado · E espejo `apps/web` · F gate `--enforce`. C→D en orden; A precede a B; E depende de C;
  F depende de D+E. `@redteam` obligatorio en C, D y E (cambian el contrato de señal y el scoring
  activo).
