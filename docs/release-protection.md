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
Antes bastaba escribir dos líneas en la descripción del PR. Ahora el PR **debe añadir** registros `docs/reviews/*.review.json` (esquema `review-evidence/v1`, se crean con
`bun run scripts/ci/record-review.ts`) y la compuerta los comprueba:

1. **Proveedores distintos y conocidos**: al menos 2, de la lista `docs/reviews/providers.json` **de la rama base** (un PR no puede ampliarla) o `human:<login>`. «openai2»
   o «gpt» no cuentan.
2. **Atados al diff exacto**: `diffSha256` se **recalcula** con git (`merge-base..reviewedHead`), con las opciones de git fijadas (prefijos, algoritmo, renames, drivers
   externos) para que no dependa de la configuración de cada máquina. Solo quedan fuera del diff los registros `*.review.json` y las salidas `*.raw.txt`: **`providers.json` y
   `ACCEPTED-RISKS.json` sí entran**, así los revisores ven cualquier cambio a las listas de las que depende la compuerta. Un registro inventado sin conocer el diff no coincide.
3. **Vigentes**: si cambió una sola línea de código después de `reviewedHead`, esa revisión caduca y el proveedor debe revisar el head actual. De cada proveedor cuenta su
   ronda más reciente y **se evalúan todos sus registros** (un RECHAZADO no se tapa con un APROBADO del mismo head).
4. **Salida cruda íntegra y propia de este PR**: el texto original del revisor se guarda junto al registro; **lo añade este PR** (no vale reutilizar la de una revisión anterior),
   **nombra el head revisado**, su SHA-256 (sobre el texto normalizado: BOM y CRLF no importan) debe coincidir, tiene un mínimo de sustancia, cita archivos del diff y no
   puede ser idéntica a la de otro revisor.
5. **Hallazgos contrastados con la salida cruda**: cada línea «N. BLOQUEANTE|ALTA|MEDIA|BAJA …» de la salida cruda debe tener su hallazgo en el registro (cota inferior: un
   BLOQUEANTE que el revisor escribió no puede desaparecer sin editar la salida cruda, y eso cambia su hash) y el registro no puede declarar más hallazgos de una severidad que
   menciones de esa palabra hay en la salida (cota superior).
6. **Resolución**: en la ronda vigente ningún hallazgo puede figurar `fixed` (si el revisor lo ve en el código actual, no está arreglado). Un ALTA solo pasa con
   `disposition: "accepted"` y una razón de ≥ 40 caracteres (`rejected` con texto libre no vale). Un BLOQUEANTE solo pasa como **riesgo aceptado por el propietario**:
   `acceptedRisk` debe ser un id de `docs/reviews/ACCEPTED-RISKS.json` **de la rama base**, el resumen del hallazgo debe contener el `match` de ese riesgo (no es un comodín) y
   no puede estar caducado (`expires`, comparado con la fecha del commit head). El propietario acepta un riesgo al fusionar el PR que lo añade; ese PR no se aprueba con su propia
   lista. Los arreglos de rondas anteriores exigen un commit del PR que toque el archivo citado.
7. **Seguridad del propio check**: corre con `pull_request_target`, así el verificador se lee de la rama base y un PR no puede reescribirlo; nunca hace checkout del código del PR
   (solo `git fetch` de sus objetos y lectura de blobs); el número de PR y los SHA entran por `env`; las acciones están fijadas por SHA y sin credenciales persistidas.

Las pruebas (`scripts/ci/verify-review-evidence.test.ts`) usan repos git reales y efímeros, y se comprobaron con *mutantes*: desactivar la regla del hash, la de vigencia, la
allowlist, el cruce con la salida cruda o la evaluación de toda la ronda hace fallar al menos una prueba.

## Lo que NO se puede garantizar (límites honestos)
- **No es infalsificable.** Quien quiera fingir una revisión debe fabricar la salida cruda de un revisor y dejar esa fabricación para siempre en el historial de git, en vez de
  teclear un nombre. Eso sube el costo y deja rastro, pero GitHub no puede verificar que quien escribió «openai» fue OpenAI. La autenticidad criptográfica exige una de estas
  opciones, **todas dependen del propietario**:
  - **(a) Aprobación nativa de una segunda cuenta de GitHub** (colaborador con permiso de escritura) y `required_approving_review_count: 1`. Con un solo mantenedor no es
    utilizable: el autor no puede aprobar su propio PR. *BLOCKED.*
  - **(b) Un revisor que corra dentro del CI** con una credencial propia del repositorio. Cuesta dinero y agrega un secreto: no se crea sin aprobación. *BLOCKED.*
  - **(c) Registros firmados** con una clave de revisor registrada en el repositorio. *No implementado.*
  Mientras tanto la limitación queda declarada como riesgo `R-001` en `docs/reviews/ACCEPTED-RISKS.json` (propuesto; vale solo si el propietario lo fusiona).
- **El agente que escribe el código y uno de los revisores pueden ser del mismo proveedor** (hoy: Claude escribe y un subagente Claude revisa). Por eso se exige un segundo
  proveedor distinto, pero el solapamiento con el autor sigue siendo una debilidad.
- **Cada avance de la base, merge o rebase obliga a revisar de nuevo** (el diff y `reviewedBase` cambian). Es el precio de atar la revisión al diff exacto; con la rama
  protegida y «al día» exigido, un PR concurrente que se fusione fuerza dos revisiones nuevas en los demás.
- **`ci.yml` sigue siendo editable por el propio PR** (`pull_request`): un PR malicioso podría debilitar el CI. Cerrarlo del todo exige CODEOWNERS sobre `.github/**` con una
  segunda persona revisora. *BLOCKED.*
- `enforce_admins` impide el push directo accidental; el propietario *puede* quitar la protección desde Settings (es su repositorio). Queda en el log de auditoría de GitHub.
- Los E2E corren contra el motor y la web reales pero con **Dota y Steam simulados**: no sustituyen las pruebas con dos cuentas Steam auténticas ni con el Companion en Dota real.

## Cómo fusionar a la rama
1. Rama de trabajo → PR hacia `release/mvp-beta`.
2. CI en verde (los seis checks).
3. Dos proveedores revisan el head final; sus registros se añaden al PR (último commit solo de `docs/reviews/`).
4. `independent-review` en verde. Fusionar. **Fusionar publica en Railway Preview** (auto-deploy): es el último paso.
