# Protección de `release/mvp-beta`

`release/mvp-beta` es la rama que Railway Preview publica. Este documento dice **qué se exige**, qué lo hace cumplir y qué **no**
puede garantizarse. Se escribió después de que 12
commits (581 archivos) entraron en la rama sin CI, sin E2E y sin revisión independiente.

## Qué se exige para entrar

| # | Control | Cómo se hace cumplir |
|---|---------|----------------------|
| 1 | Todo cambio llega por Pull Request | Protección de rama: PR obligatorio, sin push directo, sin force-push, sin borrar la rama, **también para administradores** (`enforce_admins`) |
| 2 | CI con verificaciones obligatorias | `ci.yml` corre en cada PR hacia la rama. Checks requeridos: `test (engine)`, `test (web)`, `test (root)`, `verify-simplicity`, `intelligence-ci (eval --enforce)`, `r1-certification (verify:r1)` |
| 3 | E2E relevantes | `r1-certification (verify:r1)` ejecuta `bun run e2e` completo (Chromium + WebKit móvil) |
| 4 | Revisión independiente | Check `independent-review`: GitHub ejecuta el `release-gate.yml` de la rama predeterminada (`master`), que no hace checkout del código del PR y comprueba contra git los registros de `docs/reviews/` (`scripts/ci/verify-review-evidence.ts`, `check-gate-producers.ts`). Las reglas son las de `docs/reviews/POLICY.md` en `master`. Declarar revisores en la descripción del PR no basta. |
| 5 | Verificaciones en verde y al día | `strict`: la rama del PR debe estar al día con la base antes de fusionar; conversaciones resueltas |

> La tabla no certifica qué está activado hoy: eso es configuración de GitHub (cómo medirla: `AGENTS.md`).
>
> **Nota (2026-11-27):** `ci.yml` también corre `test (qa)`. `r1-certification` sólo termina en `success` si sus
> `needs` (incluida toda la matriz `test`) y `verify:r1` terminaron en `success`, también ante una cancelación (TSK-259).
> **NOT_VERIFIED en GitHub:** sólo está simulado en local; confírmalo en el primer PR real. La lista de checks
> requeridos vive en GitHub: vuelve a medirla antes de apoyarte en ella.

Comprobado el 2026-11-27 en `release-gate.yml` de `master` y en el log del run `45941219690` (PR #172). Las copias de
`release-gate.yml` y `check-independent-review.sh` que quedan en esta rama no son las que decide GitHub en ese check.

## Lo que NO se puede garantizar (límites honestos)

- **La evidencia de revisión es comprobable, no una firma.** El check verifica que los registros correspondan al diff
  exacto, pero no autentica quién produjo la salida del revisor. **Mejora pendiente (BLOCKED, requiere al
  propietario):** un segundo colaborador de GitHub y aprobación nativa.
- El gate se reevalúa también al editar la descripción del PR.
- **`ci.yml` sigue siendo editable por el propio PR** (`pull_request`): un PR malicioso podría debilitar el CI. Cerrarlo del todo exige CODEOWNERS sobre
  `.github/**` con una segunda persona revisora (BLOCKED, requiere al propietario).
- **`test.fixme` en `e2e/feedback.spec.ts`**: el feedback 👍/👎 por tarjeta no tiene cobertura E2E hasta que el propietario decida restituirlo o retirarlo.
- `enforce_admins` impide que el propietario empuje directo por accidente; el propietario *puede* quitar la
  protección desde Settings (por diseño, es su repositorio). Eso queda registrado en el log de auditoría de GitHub.
- Los E2E corren contra el motor y la web reales pero con **Dota y Steam simulados**. No sustituyen las
  pruebas con dos cuentas Steam auténticas ni con el Companion en Dota real.

## Cómo fusionar a la rama

1. Rama de trabajo → PR hacia `release/mvp-beta`.
2. CI en verde (los seis checks).
3. Registros de revisión en `docs/reviews/` según la política de `master`; hallazgos bloqueantes corregidos.
4. Fusionar. **Fusionar publica en Railway Preview** (auto-deploy): es el último paso, no el primero.
