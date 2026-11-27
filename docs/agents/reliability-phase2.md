# Fiabilidad de ingeniería — fase 2 (2026-11-24)

> **Alcance en `release/mvp-beta` (unidad C):** la unidad C trae sólo el cambio de `r1-certification` (TSK-259). El
> guard probado en aquella fase **no es el vigente** (ver TSK-261, `readonly-guard-hardening.md`).
>
> **Versión resumida para publicación.** El detalle operativo (cargas de prueba, rutas y huecos aún abiertos) se
> conserva fuera del repositorio, en el archivo privado del propietario, disponible para revisores autorizados.
> SHA-256 del original: `0d94486ea133c340db5da0985f5e6e09033f789f51ac9002808b00f52e9046aa`.

Vocabulario: **PASS / FAIL / SKIPPED / NOT_TESTED**.

## `r1-certification` (TSK-259)

- **Invariante:** el check sólo termina en `success` si `test` (matriz engine/web/root/qa), `verify-simplicity`,
  `intelligence-ci` y el propio `verify:r1` terminaron en `success`, también si se cancela el workflow.
- **Cómo:** `if: ${{ always() }}` en el job, un primer paso que exige `success` en cada `needs` (antes de descargar
  código) y un último paso, también `always()`, que exige que `verify:r1` haya terminado en `success`.
- **Motivo:** GitHub documenta que un check requerido omitido cuenta como satisfecho y recomienda `always()` con `needs`.
- **Prueba:** `scripts/ci/ci-needs-semantics.test.ts` simula esa semántica sobre el `ci.yml` real y ejecuta los pasos.
- **Costo aceptado:** al cancelar el workflow, este job puede arrancar igualmente y terminar en fallo.
- **NOT_TESTED en GitHub real** y `actionlint` no ejecutado. La prueba analiza el YAML por patrones: no detecta todas
  las formas futuras de anular el control (limitación aceptada por el propietario; no sustituye la revisión).

## Pendiente de decisión del propietario

Quedan recomendaciones **no aplicadas** sobre la política de revisión, la protección de rama y la evaluación de
candidatos del motor. El detalle está en el archivo privado.
