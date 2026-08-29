# ADR-004 — Calibración de señales por percentiles empíricos, con cutover diferido al gate de 9.1

**Estado**: aceptado (2026-08-29, Fase 9.0, `TSK-193`)
**Implementa**: `R1-1`, `R1-2`, `R2-5`, decisión D2 del `/pre-flight` (`docs/specs/SPEC.md` §15.2, §15.5)

## Contexto

El motor normaliza cada señal a `[0,100]` con `RAW_RANGE[signal] = [min, max]` fijo y una
transformación lineal (`mix.ts`). Los comentarios del propio código admiten que esos rangos "no
están medidos contra datos reales sincronizados". Dos problemas confirmados:

1. **La pendiente efectiva la fija el rango, no el peso declarado.** `pendiente = 100·w/(b−a)`.
   Con V6 y los rangos actuales: `counter` ≈ 90, `patch_meta` ≈ 29. El vector
   `SCORING_WEIGHTS_V6` dice una cosa; el ranking obedece otra.
2. **La redistribución proporcional por `raw: null` rompe la comparabilidad entre héroes.** El
   peso efectivo de una señal para un candidato depende de cuántas *otras* señales votaron para
   *ese* candidato (`position_fit` observado varía 34,2 % → 50,6 %). No es *Missing At Random*
   (Rubin 1976).

Los informes #1 y #2 proponen el mismo reemplazo: normalizar cada señal contra su distribución
**empírica observada** — `N(x) = clamp((x − P05)/(P95 − P05), 0, 1)` — con percentiles
**congelados sobre el split de train** y un fallback jerárquico.

## Decisión

- **Se adopta el mecanismo de percentiles empíricos** como reemplazo de la normalización lineal de
  `RAW_RANGE`, y **se termina la redistribución candidate-specific** (peso fijo + término de
  cobertura de evidencia).
- **El cutover no ocurre en 9.0.** 9.0 sólo *mide*: `scripts/stats/profile-signals.ts`
  (`TSK-203`) emite la pendiente efectiva **y la influencia realizada** (pendiente × SD del `raw`
  entre candidatos del mismo estado — corrección `C5`), la tasa de `raw: null` por señal, y la
  ablación por contexto. Ese archivo es la entrada del gate de 9.1.
- **El cutover exacto se decide en el `/blueprint` angosto de 9.1**, con esos números a la vista:
  qué `P05`/`P95` por señal, qué ejes de fallback tienen sustrato real (medido: `global` y
  `bracket` sí; `patch` **no** — el corpus es mono-parche, corrección `C3`), y qué término
  reemplaza a la redistribución.
- `RAW_RANGE` **no se toca en 9.0**. Cuando el cutover entre (9.1), `RAW_RANGE.counter` y los
  demás quedan como dato histórico, no se editan sus valores.
- **Candado de regresión obligatorio en 9.1**: con la calibración desactivada y opciones legacy,
  `mixScore` reproduce el número de V6 **exacto** (mismo criterio que V1→V2 de 1b y V5→V6 de 4.2).
- `raw: null` **sigue siendo sagrado**: nunca se convierte en 0, 0.5 ni 50. Lo que cambia es cómo
  se propaga su ausencia, no que se rellene.

## Alternativas consideradas

- **Fijar hoy los `P05`/`P95`.** Imposible sin inventar: los percentiles los produce
  `profile-signals.ts` en 9.0. Fijarlos antes sería exactamente el error que los blueprints de
  este proyecto existen para evitar. Rechazada.
- **Sólo re-calibrar a mano los `[min,max]` de `RAW_RANGE` con datos reales, sin cambiar el
  mecanismo.** Menos invasivo, pero no resuelve la no-comparabilidad de fondo (problema 2).
  Rechazada.
- **Percentiles empíricos calculados en runtime.** Viola "cero red / cálculo acotado en el camino
  caliente" y no es reproducible. El cálculo es offline, emite JSON, el motor hace lookup.
  Rechazada.

## Consecuencias

- 9.0 entrega la medición; 9.1 es quien cambia el motor. Ningún ticket de 9.0 toca `mix.ts`,
  `weights.ts` ni `RAW_RANGE`.
- El artefacto `data/generated/percentiles.json` (9.1) cae en la costura S18: loader validado en
  el borde, archivo corrupto/ausente → degrada al mecanismo V6 actual, nunca lanza.
- Este ADR se supersede si la medición de 9.0 mostrara que el mecanismo lineal ya es adecuado
  (improbable dado el ≈90 vs ≈29, pero la decisión formal se toma en el gate, no acá).
