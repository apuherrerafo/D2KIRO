# Fiabilidad de ingeniería — fase 1 (2026-11-24)

> **Alcance en `release/mvp-beta` (unidad C):** informe histórico del 2026-11-24 sobre la rama `agent-ecosystem/phase1`.
> El guard descrito en aquel informe (TSK-257) **no es el vigente**: las unidades A+B (PR #172, fusionado en `32cd2502`)
> integraron revisores sin Bash (TSK-261, `readonly-guard-hardening.md`). La tabla de evidencia vigente de `/dispatch`
> es la de su `SKILL.md`.
>
> **Versión resumida para publicación.** El detalle operativo (cargas de prueba, rutas y huecos aún abiertos) se
> conserva fuera del repositorio, en el archivo privado del propietario, disponible para revisores autorizados.
> SHA-256 del original: `eadad3bd9fbf9cc4bcc8b7ee09904fe66cc56e995e2cfe94e5835353fc7fb544`.

Base certificada `release/mvp-beta` @ `05cb456d`. Vocabulario: **PASS / FAIL / SKIPPED / NOT_TESTED**.

## Qué se revisó

| Área | Resultado en esa fecha |
|---|---|
| Mecanismo real de `independent-review` | Contrastado con el log de GitHub: se ejecuta el workflow de la rama predeterminada |
| Revisores de «solo lectura» | Hallazgo confirmado y corregido; la corrección fue reemplazada después por la de TSK-261 |
| Cobertura de las compuertas sobre un PR | Quedaron recomendaciones **abiertas**, no aplicadas; requieren decisión del propietario |
| Alcance de `intelligence-ci` | Comprueba integridad y comparabilidad del baseline versionado; la calidad de un candidato se evalúa como operación local y aprobada |
| Revisión adversarial externa | 8 rondas; la última aprobó el cambio revisado entonces |

## Mantenimiento

- Las decisiones sobre protección de rama y la política de revisión de `master` son del propietario.
- Antes de apoyarte en cualquier afirmación de esa fecha, vuelve a medirla.
