# Protección de `release/mvp-beta`

`release/mvp-beta` es la rama que Railway Preview publica. Este documento dice **qué está realmente activado en GitHub**, qué lo hace cumplir y qué **no** puede
garantizarse. Se escribió después de que 12 commits (581 archivos) entraron en la rama sin CI, sin E2E y sin revisión independiente.

## Qué se exige para entrar

| # | Control | Cómo se hace cumplir |
|---|---------|----------------------|
| 1 | Todo cambio llega por Pull Request | Protección de rama: PR obligatorio, sin push directo, sin force-push, sin borrar la rama, **también para administradores** (`enforce_admins`) |
| 2 | CI con verificaciones obligatorias | `ci.yml` en cada PR. Checks requeridos: `test (engine)`, `test (web)`, `test (root)`, `verify-simplicity`, `intelligence-ci (eval --enforce)`, `r1-certification (verify:r1)` |
| 3 | E2E relevantes | `r1-certification (verify:r1)` ejecuta `bun run e2e` completo (Chromium + WebKit móvil) |
| 4 | Revisión independiente **comprobable** | Check `independent-review` (`release-gate.yml` + `scripts/ci/verify-review-evidence.ts`), descrito abajo |
| 5 | Verificaciones en verde y al día | `strict`: la rama del PR debe estar al día con la base; conversaciones resueltas |

## `independent-review`: de «dos nombres» a evidencia comprobada contra git
Antes bastaba escribir dos líneas en la descripción del PR. Ahora el PR **debe añadir** registros `docs/reviews/*.review.json` y la compuerta los comprueba:

1. **Proveedores distintos**: al menos 2 (p. ej. `openai` y `anthropic`). Dos registros del mismo proveedor cuentan como uno.
2. **Atados al diff exacto**: `diffSha256` se **recalcula** con git (`merge-base..reviewedHead`, sin `docs/reviews`). Un registro inventado sin conocer el diff no coincide.
3. **Vigentes**: si cambió una sola línea de código después de `reviewedHead`, esa revisión caduca y el proveedor debe revisar el head actual. De cada proveedor cuenta su
   registro más reciente; los anteriores quedan como historial.
4. **Salida cruda íntegra**: el texto original del revisor se guarda junto al registro; su SHA-256 debe coincidir, tiene un mínimo de sustancia, cita archivos del diff y
   no puede ser idéntico al de otro revisor.
5. **Hallazgos**: ningún BLOQUEANTE sin resolver; un ALTA sin arreglar exige una aceptación razonada (≥ 40 caracteres); los arreglos citados (`fixedIn`) deben ser commits del
   PR que de verdad tocan el archivo del hallazgo. Un veredicto RECHAZADO bloquea.
6. **Seguridad del propio check**: corre con `pull_request_target`, así el verificador se lee de la rama base y un PR no puede reescribirlo; nunca hace checkout del
   código del PR (solo `git fetch` de sus objetos y lectura de blobs); el número de PR y los SHA entran por `env`.

Formato (`docs/reviews/<sha8>-<proveedor>.review.json`, esquema `review-evidence/v1`) y prueba del verificador: `scripts/ci/verify-review-evidence.test.ts` (repos git reales
y efímeros; se comprobó con *mutantes*: desactivar la regla del hash o la de vigencia hace fallar sus pruebas).

## Lo que NO se puede garantizar (límites honestos)
- **No es infalsificable.** Quien quiera fingir una revisión debe fabricar la salida cruda de un revisor y dejar esa fabricación para siempre en el historial de git, en vez de
  teclear un nombre. Eso sube el costo y deja rastro, pero GitHub no puede verificar que quien escribió «Codex» fue Codex. La autenticidad criptográfica exige una de estas
  opciones, **todas dependen del propietario**:
  - **(a) Aprobación nativa de una segunda cuenta de GitHub** (colaborador con permiso de escritura) y `required_approving_review_count: 1`. Con un solo mantenedor no es
    utilizable: el autor no puede aprobar su propio PR. *BLOCKED.*
  - **(b) Un revisor que corra dentro del CI** con una credencial propia del repositorio. Cuesta dinero y agrega un secreto: no se crea sin aprobación. *BLOCKED.*
  - **(c) Registros firmados** con una clave de revisor registrada en el repositorio. *No implementado.*
- **El agente que escribe el código y uno de los revisores pueden ser del mismo proveedor** (hoy: Claude escribe y un subagente Claude revisa). Por eso se exige un segundo
  proveedor distinto, pero el solapamiento con el autor sigue siendo una debilidad.
- **`ci.yml` sigue siendo editable por el propio PR** (`pull_request`): un PR malicioso podría debilitar el CI. Cerrarlo del todo exige CODEOWNERS sobre `.github/**` con una
  segunda persona revisora. *BLOCKED.*
- `enforce_admins` impide el push directo accidental; el propietario *puede* quitar la protección desde Settings (es su repositorio). Queda en el log de auditoría de GitHub.
- Los E2E corren contra el motor y la web reales pero con **Dota y Steam simulados**: no sustituyen las pruebas con dos cuentas Steam auténticas ni con el Companion en Dota real.

## Cómo fusionar a la rama
1. Rama de trabajo → PR hacia `release/mvp-beta`.
2. CI en verde (los seis checks).
3. Dos proveedores revisan el head final; sus registros se añaden al PR (último commit solo de `docs/reviews/`).
4. `independent-review` en verde. Fusionar. **Fusionar publica en Railway Preview** (auto-deploy): es el último paso.
