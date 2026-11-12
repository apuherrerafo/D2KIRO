# Protección de `release/mvp-beta`

`release/mvp-beta` es la rama que Railway Preview publica. Este documento dice **qué está realmente
activado en GitHub**, qué lo hace cumplir y qué **no** puede garantizarse. Se escribió después de que 12
commits (581 archivos) entraron en la rama sin CI, sin E2E y sin revisión independiente.

## Qué se exige para entrar

| # | Control | Cómo se hace cumplir | Estado |
|---|---------|----------------------|--------|
| 1 | Todo cambio llega por Pull Request | Protección de rama: PR obligatorio, sin push directo, sin force-push, sin borrar la rama, **también para administradores** (`enforce_admins`) | Ver "Estado verificado" |
| 2 | CI con verificaciones obligatorias | `ci.yml` corre en cada PR hacia la rama. Checks requeridos: `test (engine)`, `test (web)`, `test (root)`, `verify-simplicity`, `intelligence-ci (eval --enforce)`, `r1-certification (verify:r1)` | Ver "Estado verificado" |
| 3 | E2E relevantes | `r1-certification (verify:r1)` ejecuta `bun run e2e` completo (Chromium + WebKit móvil) | Ver "Estado verificado" |
| 4 | Revisión independiente | Check `independent-review` (`.github/workflows/release-gate.yml` + `scripts/ci/check-independent-review.sh`): el PR debe declarar dos revisiones de revisores **distintos**, con veredicto y alcance, y ningún `BLOQUEANTE ABIERTO`. Corre con `pull_request_target`: el script se lee de la rama base, un PR no puede reescribirlo. | Ver "Estado verificado" |
| 5 | Verificaciones en verde y al día | `strict`: la rama del PR debe estar al día con la base antes de fusionar; conversaciones resueltas | Ver "Estado verificado" |

Formato de la atestación en la descripción del PR (una línea por revisor):

```
- [x] Revision independiente 1 (Codex GPT): APROBADO CON OBSERVACIONES -- revisó feedback, auth y simulador
- [x] Revision independiente 2 (Claude, contexto limpio): APROBADO -- revisó E2E y companion
```

## Lo que NO se puede garantizar (límites honestos)

- **La independencia del revisor es una atestación, no una firma.** GitHub no puede verificar que quien
  escribió "Codex" fue Codex. Con un solo mantenedor, la aprobación nativa de GitHub (`required_approving_review_count`)
  no es utilizable: el autor no puede aprobar su propio PR. El check obliga a *declarar* quién revisó y qué
  quedó abierto; no demuestra que la revisión ocurriera. **Mejora pendiente (BLOCKED, requiere al propietario):**
  añadir un segundo colaborador de GitHub y subir `required_approving_review_count` a 1.
- El gate `independent-review` se reevalúa al **editar** la descripción del PR (`pull_request_target.edited`).
- **Arranque (huevo y gallina):** `pull_request_target` lee el workflow de la rama base, así que el check `independent-review` no existe hasta que este
  cambio se fusione. Por eso se activa la protección con los seis checks de CI, se fusiona, y *después* se añade `independent-review` a los checks requeridos.
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
3. Dos revisiones independientes declaradas en la descripción; hallazgos bloqueantes corregidos.
4. Fusionar. **Fusionar publica en Railway Preview** (auto-deploy): es el último paso, no el primero.
