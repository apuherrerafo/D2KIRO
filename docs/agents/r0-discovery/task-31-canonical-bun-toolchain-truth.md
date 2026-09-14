# R0.1 — Task 31: Canonical Bun Toolchain Truth — evidencia de ejecución

- **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` (R0 — Engineering Baseline Recovery)
- **Task:** 31 — `[R0.1] Canonical Bun Toolchain Truth — pin exacto local/CI/Docker y revalidación`
- **Requisitos:** 1.1, 4.1, T.1, T.2 · **Owner ejecutable de** `TOOLCHAIN_VERSION_DRIFT`
- **Rol:** Claude Code = Writer / Executor
- **Fecha de la corrida:** 2026-09-06
- **Commit observado (HEAD):** `d617ba5` en `master`
- **RESULTADO (corrida original 2026-09-06):** **BLOCKED** — `TSK098_RUNTIME_SEMANTICS_CHANGED`
  (ver §8). Requiere clasificación independiente A/B/C/D → REPLAN/HUMAN. No se ejecutó Task 3,
  Task 5, ni la suite web completa. No hay commit ni push.
- **RESULTADO (continuación post-REPLAN, ver §12):** **PASS** de Canonical Toolchain Truth. El
  REPLAN (`TSK098 RUNTIME MIGRATION REPLAN: PASS`) movió la migración de evidencia TSK-098 a
  **Task 32** y estrechó el boundary de Task 31 a sólo Toolchain Truth. `LOCAL == CI == DOCKER ==
  Bun 1.4.2`, tres lockfiles frozen sin churn, guard GREEN, Docker build + smoke verificados.
  Task 32 queda desbloqueada; Task 3 sigue BLOCKED. Sin commit ni push.

## Convenciones de evidencia

| Marca | Significado |
|---|---|
| **CONFIRMED** | Respaldado por la salida literal de un comando en esta corrida. |
| **CHANGED** | Observable que difiere materialmente entre Bun 1.3.14 y Bun 1.4.2. |

**Seguridad:** no se imprimió ni registró ningún secreto/token/API key. El `account_id` Steam32 no
aparece (el escenario TSK-098 usa `accountToken: "invalid"`, nunca un id real).

---

## 1. PHASE 1 — Pre-change evidence (CONFIRMED)

```
$ bun --version            -> 1.3.14
$ node --version           -> v22.22.3
$ git branch --show-current -> master
```

### Lockfiles trackeados — SHA-256 y encabezados (pre-change)

| Árbol | Archivo | SHA-256 | lockfileVersion / configVersion |
|---|---|---|---|
| raíz | `bun.lock` | `13edc3a3f2d1d2302ad334ed1ad54bb03619b9cb3c90ee54cb029f0a8455facd` | v2 / config 1 |
| engine | `apps/engine/bun.lock` | `aa8ea0d84927f6f67e2a7a9b63c19b6be55fb9bd44e99a18b5c5a29dcedeb306` | v1 / config 1 |
| web | `apps/web/bun.lock` | `d27a034722a832c5a7db4c8038b28735e65f0662e88f4c40283f5ca22a872654` | v2 / config 0 |
| web (npm) | `apps/web/package-lock.json` | `cf442bf0afe0d5859fc3949c10fcd7535f59346248ef7ac3f9c15134f5244fab` | — |

`git diff --stat` sobre los cuatro: **sin cambios sin commitear**. Ninguno está en el write scope
de Task 31 (confirmado).

### git status (pre-change)

```
 M apps/engine/src/pipeline/run-pipeline.test.ts        (Task 2, aceptado)
 M apps/engine/src/server/app.test.ts                   (Task 17, aceptado)
 M scripts/eval/benchmark-pro-agreement.test.ts         (Task 2/4, aceptado)
 M scripts/hooks/_hook_lib.py                            (Task 4, aceptado)
 M scripts/hooks/data-boundary-guard.py                 (Task 4, aceptado)
?? .kiro/specs/r0-engineering-baseline-recovery/
?? docs/agents/harness-matrix.md
?? docs/agents/r0-discovery/
?? scripts/hooks/hook-path-normalization.test.ts        (Task 4, aceptado)
```

Diff preexistente = trabajo aceptado de Tasks 2/4/17. **No se atribuye a Task 31.**

### Estado pre-change de toolchain (CONFIRMED)

- `package.json` raíz: **sin** `packageManager`, **sin** `engines.bun`, **sin** `.bun-version`.
- `.github/workflows/ci.yml`: dos `oven-sh/setup-bun@v2` con `with: bun-version: latest`.
- `Dockerfile` (único, contexto raíz, `railway.json` → builder `DOCKERFILE`): instalador flotante
  `RUN curl -fsSL https://bun.sh/install | bash` (sin versión).
- Bun local: `/c/Users/Julio/.bun/bin/bun` → 1.3.14.
- Docker: CLI 29.6.2; daemon inicialmente DOWN, se levantó con `docker desktop start` (UP).

---

## 2. PHASE 2 — Canonical pin (CONFIRMED)

Único literal de versión añadido, en `package.json` raíz:

```json
"packageManager": "bun@1.4.2"
```

No se creó `.bun-version`, `engines.bun`, ARG, variable Railway, secreto, tag de imagen ni
`bun-version:` con copia del número. `node -p "require('./package.json').packageManager"` → `bun@1.4.2`.

---

## 3. PHASE 3 — Deterministic local guard (`scripts/verify-simplicity.sh`) (CONFIRMED)

Bloque fail-fast añadido **antes** de `sync-context.ts` (primer código que usa Bun). Sin red, sin
escrituras. Lee `packageManager` con `grep`/`sed` (sin depender de Bun/Node), exige formato cerrado
`^bun@[0-9]+\.[0-9]+\.[0-9]+$`, resuelve el binario `bun` sin red (mismo patrón que la sección 6),
compara `bun --version` contra el pin y sale no-cero ante ausencia / formato no exacto / mismatch.

### Camino negativo (shim temporal fuera del repo — falla ANTES de cualquier efecto lateral)

| Caso | Entrada | Salida | Exit |
|---|---|---|---|
| Drift real | bun 1.3.14 vs pin 1.4.2 | `❌ ERROR: Bun toolchain drift -- package.json fija bun@1.4.2 pero 'bun --version' dice '1.3.14'.` | **1** |
| Shim en PATH | `bun --version`→`9.9.9` | `❌ ERROR: Bun toolchain drift -- ... dice '9.9.9'.` | **1** |
| Formato no exacto | `packageManager: "bun@^1.4"` | `❌ ERROR: package.json#packageManager ausente o no es 'bun@<semver exacto>' (valor leído: 'bun@^1.4').` | **1** |
| Ausente | sin `packageManager` | `❌ ERROR: ... (valor leído: '<ausente>').` | **1** |

En los cuatro, el `❌` aparece justo tras el banner `🦴` y **antes** de que `sync-context.ts`
corra — cero efecto lateral.

### Camino positivo (tras alinear Bun local)

```
🦴 Verificando reglas del proyecto...
🔒 Toolchain Bun OK: 1.4.2 == package.json#packageManager (bun@1.4.2)
...
✅ Verificación de simplicidad superada.        exit=0
```

No se creó agente, skill, segunda fuente ni verificador LLM.

---

## 4. PHASE 4 — CI (`.github/workflows/ci.yml`) (CONFIRMED)

- Ambos `oven-sh/setup-bun@v2`: se eliminó `with: bun-version: latest`. Sin input, la Action
  resuelve `package.json#packageManager`.
- Tras cada `setup-bun`, nuevo step **Verify Bun matches packageManager pin**: deriva `EXPECTED`
  del manifest raíz (`node -p`), valida formato `bun@<semver>` y exige `bun --version == EXPECTED`
  (no confía sólo en la resolución implícita).
- Todas las instalaciones Bun pasan a `bun install --frozen-lockfile`:
  - `Install dependencies` (matriz raíz/engine/web),
  - `Install apps/engine dependencies (needed by apps/web's cross-app type-check)` (cruzada).
- El job `verify-simplicity` no ejecuta `bun install`; sólo ganó el step de verificación de pin.
- No se regeneró ningún lockfile. Se conserva la grafía explícita `--frozen-lockfile` (no se
  mezcla con `bun ci`).

Nota: la validación real de la ejecución de CI ocurre al abrir el PR (fuera de esta corrida
local). Los cambios de YAML son estáticos y verificables por lectura.

---

## 5. PHASE 5 — Docker / Railway (`Dockerfile`) (CONFIRMED, estático)

Se reemplazó `RUN curl -fsSL https://bun.sh/install | bash` por:

```dockerfile
COPY package.json ./package.json
RUN set -eu; \
  EXPECTED_PM="$(node -p "require('./package.json').packageManager")"; \
  case "$EXPECTED_PM" in bun@[0-9]*.[0-9]*.[0-9]*) : ;; *) echo "..."; exit 1 ;; esac; \
  EXPECTED_BUN_VERSION="${EXPECTED_PM#bun@}"; \
  curl -fsSL https://bun.sh/install | bash -s "bun-v${EXPECTED_BUN_VERSION}"; \
  ACTUAL_BUN_VERSION="$(bun --version)"; \
  echo "Bun build check: expected=${EXPECTED_BUN_VERSION} actual=${ACTUAL_BUN_VERSION}"; \
  [ "$EXPECTED_BUN_VERSION" = "$ACTUAL_BUN_VERSION" ]
```

- `node` ya existe (base `node:22-bookworm-slim`); `bash`/`curl`/`unzip` los instala el `apt-get`
  previo. No se usa ARG externo — Railway construye el Dockerfile directamente.
- `apps/engine` sigue en `bun install --frozen-lockfile`; el contrato web de producción sigue en
  `apps/web/package-lock.json` + `npm ci` (Task 31 **no** migra web de producción a Bun).
- Imagen single-stage → el binario verificado es el del runtime final.
- **Smoke del contenedor: NO ejecutado en esta corrida** — la ejecución se detuvo en PHASE 8
  (STOP) antes de la verificación Docker (PHASE 10). Ver §10.

---

## 6. PHASE 6 — Align local Bun (CONFIRMED — mutación de entorno autorizada por la tarea)

```
PRE-change bun: 1.3.14
$ EXPECTED="$(node -e "...packageManager.replace(/^bun@/,'')")"   -> 1.4.2
$ powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
    "& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing https://bun.sh/install.ps1))) -Version $EXPECTED"
  -> "Bun 1.4.2 was installed successfully!"  (C:\Users\Julio\.bun\bin\bun.exe)
POST-change bun: 1.4.2   ==   packageManager pin (bun@1.4.2)   [MATCH]
$ bunx --version -> 1.4.2
```

Instalación de la versión **exacta** vía el instalador oficial de Windows, con la versión leída
del `packageManager` (ningún literal `1.4.2` fuera del manifest). No se usó `latest`/`canary`/
`1.x`/`^1.4`.

---

## 7. PHASE 7 — Three-lockfile frozen validation bajo Bun 1.4.2 (CONFIRMED)

Comando: `bun install --frozen-lockfile --dry-run` desde cada árbol.

| Árbol | Lock | Exit | Resultado |
|---|---|---|---|
| raíz | `bun.lock` v2/c1 | 1 (plano) / **0** con `--ignore-scripts` | Lock **parseable y frozen-coherente** (resuelve `[2.00ms] done`, sin migración, sin churn). El exit 1 del comando plano es del lifecycle script `prepare`→`husky` (la raíz **no tiene `node_modules`**; `husky` no está en PATH), **no** del lockfile. |
| engine | `apps/engine/bun.lock` v1/c1 | **0** | v1 consumible por 1.4.2 sin migrar. `[3.00ms] done`. Sin churn. |
| web | `apps/web/bun.lock` v2/c0 | **0** | v2/c0 consumible por 1.4.2 sin migrar ni materializar el árbol local (eso es Task 3). `[4.00ms] done`. Sin churn. |

### Churn — SHA-256 después + `git diff --exit-code`

| Archivo | SHA-256 después | ¿Cambió? |
|---|---|---|
| `bun.lock` | `13edc3a3…facd` | **NO** |
| `apps/engine/bun.lock` | `aa8ea0d8…b306` | **NO** |
| `apps/web/bun.lock` | `d27a0347…2654` | **NO** |
| `apps/web/package-lock.json` | `cf442bf0…4fab` | **NO** |

`git diff --exit-code` sobre los cuatro → **exit 0 (sin cambios)**. Cero churn de lockfile.
Ninguna STOP-condition de lockfile (unreadable / migración / churn) se disparó.

---

## 8. PHASE 8 — TSK-098 semantic re-measurement — **STOP: `TSK098_RUNTIME_SEMANTICS_CHANGED`**

Sonda acotada, throwaway (creada, ejecutada 3×, borrada). Supervisor externo duro de 15 s
(+ `timeout 20` de shell); esperas de apertura/cierre/listener 2 s; carrera de `server.stop(true)`
1 s. Escenario exacto: **server-side WS close 1008** (`hello` con `accountToken: "invalid"`).

Reproducción **determinística en las 3 corridas** (idénticas):

| # | Observable | Bun 1.3.14 (documentado en `app.test.ts:734-742`, evidencia Task 17 aceptada) | Bun 1.4.2 (medido 2026-09-06) | ¿Cambió? |
|---|---|---|---|---|
| 1 | Cliente llegó a `CLOSED` | sí (`readyState 3`) | sí (`readyState 3`) | no |
| 2 | Código de cierre | `1008` | `1008` | no |
| 3 | `server.pendingWebSockets` tras el cierre iniciado por el servidor | **1** (atascado; `stop()` espera a que llegue a 0) | **0** | **CHANGED** |
| 4 | `server.stop(true)` Promise | **PENDING** — "esa promesa no se asienta en este escenario" | **RESOLVED** (< 1 s) | **CHANGED** |
| 5 | Listener realmente cerrado | sí (puerto abajo, `fetch` rechaza) | sí (puerto abajo, `fetch` rechaza) | no |

Salida literal representativa (corrida 1):

```
{"event":"BUN_VERSION","version":"1.4.2"}
{"event":"WS_OPEN","opened":true,"readyState":1}
{"event":"WS_CLOSE","clientClosed":true,"readyState":3,"closeCode":1008,"closeObserved":true}
{"event":"PENDING_WEBSOCKETS","pendingWebSockets":0}
{"event":"STOP_PROMISE","state":"RESOLVED"}
{"event":"LISTENER_CLOSED","listenerClosed":true,"detail":{"reachable":false,"error":"TypeError: Unable to connect. ..."}}
{"event":"PROBE_DONE"}   shell exit=0
```

### Por qué es STOP

Task 31 (`Failure / STOP conditions`) y su `Task 17 bounded revalidation` obligan a **STOP →
clasificar A/B/C/D → REPLAN/HUMAN, sin reparación dentro de Task 31**, si **cambia cualquiera de
los cuatro observables TSK-098**. Cambiaron **dos** (#3 y #4).

Task 31 **no** adapta la evidencia: no se retiró el descarte de la promesa, no se editó
`app.test.ts`, no se reescribieron comentarios, no se tocó el candado de regresión.

### Lectura preliminar (NO es la clasificación — esa es independiente)

Bajo 1.4.2 el teardown de WebSocket iniciado por el servidor se comporta "bien": `pendingWebSockets`
baja a 0 y `server.stop(true)` resuelve. Es decir, **la condición de runtime que motivó el
workaround de TSK-098 (Task 17) ya no se reproduce en 1.4.2**. El candado de regresión de Task 17
(`app.test.ts:757`) sólo asevera que el listener queda cerrado — eso **sigue siendo cierto** en
1.4.2 —, pero su premisa documentada ("la promesa que no se asienta en este escenario") **ya no
aplica**. Clasificación probable: **clase C** (divergencia de tooling: el cambio de runtime
canónico altera semántica observable contra la que se calibró una evidencia aceptada). Se deja a
la clasificación independiente + REPLAN.

---

## 9. PHASE 9 / PHASE 10 — NO EJECUTADAS

Por el STOP de §8:

- **PHASE 9** (revalidación de evidencia aceptada: `app.test.ts`, engine 618/0, TypeScript engine,
  scripts 181/0, candados Tasks 2/4/17) — **no ejecutada** (el contrato la condiciona a que la
  semántica TSK-098 no obligue STOP).
- **PHASE 10** (Docker build + smoke `docker run --entrypoint bun <img> --version`) — **no
  ejecutada**. Docker daemon está disponible (se levantó al inicio), así que **no** hay
  `ENVIRONMENT_LIMITATION`; simplemente la ejecución se detuvo antes por el STOP anterior.

---

## 10. Estado del working tree al detenerse

Cambios de Task 31 aplicados (sin commit, sin push), listos para que el REPLAN construya encima:

```
 M .github/workflows/ci.yml        (Task 31)
 M Dockerfile                      (Task 31)
 M package.json                    (Task 31 — pin canónico)
 M scripts/verify-simplicity.sh    (Task 31 — guard)
 M apps/engine/src/pipeline/run-pipeline.test.ts   (preexistente, Task 2)
 M apps/engine/src/server/app.test.ts              (preexistente, Task 17 — NO tocado por Task 31)
 M scripts/eval/benchmark-pro-agreement.test.ts    (preexistente, Task 2/4)
 M scripts/hooks/_hook_lib.py                       (preexistente, Task 4)
 M scripts/hooks/data-boundary-guard.py            (preexistente, Task 4)
 M docs/agents/hub.html            (EFECTO LATERAL — ver abajo)
?? scripts/hooks/__pycache__/       (EFECTO LATERAL — ver abajo)
?? docs/agents/r0-discovery/task-31-canonical-bun-toolchain-truth.md   (este archivo, write scope de Task 31)
```

- **`docs/agents/hub.html` reapareció como modificado**: lo regeneró `scripts/sync-context.ts`
  al correr `verify-simplicity.sh` en el camino positivo del guard (PHASE 3). No lo tocó Task 31
  directamente; no se revierte ni se amplía scope para arreglarlo (instrucción de la tarea:
  reportarlo).
- **`scripts/hooks/__pycache__/` reapareció (sin trackear)**: bytecode de Python generado por la
  ejecución de hooks. Mismo criterio: reportado, no arreglado.
- Ningún `bun.lock` ni `apps/web/package-lock.json` cambió (§7).
- Ningún archivo de producto, test funcional, dataset, baseline, scoring, ni `app.test.ts` fue
  modificado por Task 31.
- **Mutación de entorno**: Bun local 1.3.14 → 1.4.2 (autorizada por la tarea). No se restauró
  `apps/web/node_modules`. No se creó imagen Docker de smoke.

---

## 11. Veredicto

**TASK 31 RESULT: BLOCKED** — `TSK098_RUNTIME_SEMANTICS_CHANGED`.

Requiere clasificación independiente (probable clase C) y REPLAN antes de:
- decidir el destino del workaround de teardown de TSK-098 / su candado de regresión bajo el
  runtime canónico 1.4.2 (Task 31 tiene prohibido tocarlo),
- reanudar PHASE 9 (revalidación de evidencia aceptada) y PHASE 10 (Docker smoke),
- desbloquear Task 3.

Task 3 permanece **BLOCKED**. Circuit breaker: **no** disparado (STOP de precondición, no un
segundo FAIL de la misma root cause). Contradicción de spec: **no** (el contrato previó y ordenó
exactamente este STOP).

---

## 12. CONTINUACIÓN post-REPLAN — 2026-09-06 (nuevo boundary de Task 31)

**Contexto:** el REPLAN aprobado (`TSK098 RUNTIME MIGRATION REPLAN: PASS`) separó responsabilidades.
Task 31 ahora cierra **exclusivamente Canonical Toolchain Truth**; la migración de la evidencia
TSK-098 (semántica `pendingWebSockets 1→0`, `stop(true) PENDING→RESOLVED` bajo Bun 1.4.2) pertenece
formalmente a **Task 32** y **no** se ejecuta aquí. El STOP de §8 queda como historia y no obliga a
revertir nada. Esta corrida verifica el estado parcial y cierra el build/smoke Docker pendiente.

### 12.1 PHASE 1 — verificación del trabajo parcial existente (CONFIRMED, sin reaplicar)

| Ítem | Estado | Evidencia literal |
|---|---|---|
| `bun --version` local | **1.4.2** | `bun --version` → `1.4.2` (no se reinstaló: ya alineado) |
| `package.json#packageManager` | **`bun@1.4.2`** | `node -p "require('./package.json').packageManager"` → `bun@1.4.2` |
| Guard determinista | **GREEN** | `bash scripts/verify-simplicity.sh` → `🔒 Toolchain Bun OK: 1.4.2 == package.json#packageManager (bun@1.4.2)`, exit 0 |
| CI deriva `packageManager` | **SÍ** | 2× `oven-sh/setup-bun@v2` sin `with: bun-version:`; `latest` sólo en `runs-on: ubuntu-latest` y comentarios |
| CI verifica versión explícita | **SÍ** | 2× step `Verify Bun matches packageManager pin` (líneas 50, 118), uno tras cada `setup-bun` |
| CI installs frozen | **SÍ** | únicos `bun install` ejecutables: líneas 72 y 85, ambos `--frozen-lockfile`; `grep` de no-frozen → `(none)` |
| Docker deriva `packageManager` | **SÍ** | `Dockerfile` paso 5: `EXPECTED_PM="$(node -p "require('./package.json').packageManager")"` → `curl … | bash -s "bun-v${EXPECTED_BUN_VERSION}"` |
| Segundo pin manual | **NINGUNO** | sin `.bun-version`; `engines` = `null`; sin ARG/`BUN_VERSION`; `git grep '1\.4\.2'` fuera de `package.json` (excl. `.kiro/`, `r0-discovery/`) → **0 hits** |

Hashes de lockfiles al inicio de la continuación (idénticos a §1 / §7):

| Archivo | SHA-256 | ¿Cambió vs pre-change? |
|---|---|---|
| `bun.lock` | `13edc3a3…facd` | NO |
| `apps/engine/bun.lock` | `aa8ea0d8…b306` | NO |
| `apps/web/bun.lock` | `d27a0347…2654` | NO |
| `apps/web/package-lock.json` | `cf442bf0…4fab` | NO |

### 12.2 PHASE 2 — three-lockfile frozen validation (re-corrida read-only, Bun 1.4.2)

Comando: `bun install --frozen-lockfile --dry-run` desde cada árbol.

| Árbol | Lock | Exit | Resultado |
|---|---|---|---|
| raíz | `bun.lock` v2/c1 | 1 (plano) / **0** con `--ignore-scripts` | El exit 1 del comando plano es del lifecycle `prepare`→`husky` (`bun: command not found: husky`; la raíz no tiene `node_modules`), **no** del lockfile. Con `--ignore-scripts` (variante autorizada por el contrato para validación puramente de lockfile): `[1.00ms] done`, sin migración, sin churn. |
| engine | `apps/engine/bun.lock` v1/c1 | **0** | `[2.00ms] done`. v1 consumible por 1.4.2 sin migrar. |
| web | `apps/web/bun.lock` v2/c0 | **0** | `[5.00ms] done`. v2/c0 consumible por 1.4.2 sin migrar ni materializar el árbol local (Task 3). |

Post dry-runs: SHA-256 de los cuatro **sin cambios**; `git diff --exit-code` sobre los cuatro →
**exit 0**. Cero churn. Ninguna STOP-condition de lockfile disparada.

### 12.3 PHASE 3 — local toolchain truth (CONFIRMED)

```
expected = 1.4.2   (derivado de package.json#packageManager, sin literal fuera del manifest)
actual   = 1.4.2   (bun --version)
guard    = 🔒 Toolchain Bun OK: 1.4.2 == package.json#packageManager (bun@1.4.2)   exit=0
```

No se reinstaló Bun (ya alineado).

### 12.4 PHASE 4 — Docker build + runtime smoke (CONFIRMED — el pendiente principal)

`DOCKER_BUILDKIT=1 docker build -t d2k-task31-smoke -f Dockerfile .` (contexto raíz, Dockerfile
real). Daemon: Docker Desktop 29.6.2, sin `ServerErrors`.

- **`BUILD_EXIT=0`** — build completo (21/21 pasos: engine `bun install --frozen-lockfile`, web
  `npm ci` + `next build`, exportación de imagen).
- Paso `[ 5/21]` (log literal):
  ```
  #9 4.779 Bun build check: expected=1.4.2 actual=1.4.2
  #9 DONE 4.8s
  ```
  La versión se deriva de `package.json` (`node -p … packageManager`) e se instala como
  `bun-v${EXPECTED_BUN_VERSION}`; **no hay literal `1.4.2` en el `RUN`** — es interpolación de la
  variable extraída del manifest. El propio build falla (`[ … ]` final) si `expected != actual`.
- Paso `[ 7/21]`: `bun install v1.4.2 (744846f84)` … `23 packages installed` — engine frozen OK
  bajo el Bun de la imagen.
- **Runtime smoke** sobre la imagen resultante:
  ```
  manifest packageManager = bun@1.4.2
  expected (derived)      = 1.4.2
  docker runtime bun      = 1.4.2      (docker run --rm --entrypoint bun d2k-task31-smoke --version)
  SMOKE MATCH: YES
  command -v bun          = /root/.bun/bin/bun
  bun --revision          = 1.4.2+744846f84
  ```
- Imagen single-stage → el binario verificado por el smoke es el del runtime final.
- **Railway:** `railway.json` → builder `DOCKERFILE`, `dockerfilePath: Dockerfile`, contexto raíz.
  El Dockerfile deriva el pin de `package.json` con el `node` de la base `node:22-bookworm-slim`,
  sin ARG externo ni inyección de GitHub Actions → Railway construye este archivo directamente y
  obtiene 1.4.2 por sí solo. **CONFIRMED** (build reproducido localmente con el mismo archivo y
  contexto, exit 0).
- Imagen de smoke **eliminada** tras la verificación (`docker rmi d2k-task31-smoke` → `Untagged` +
  `Deleted`). Mutación de entorno autorizada por la tarea.

### 12.5 PHASE 5 — CI static verification (CONFIRMED por lectura)

- `oven-sh/setup-bun@v2`: **2 ocurrencias**, **0** con `bun-version:` (sólo comentarios lo
  mencionan). Sin input, la Action resuelve `package.json#packageManager`.
- `Verify Bun matches packageManager pin`: **2 steps**, uno tras cada `setup-bun` — deriva
  `EXPECTED` del manifest, valida formato `bun@<semver>`, exige `bun --version == EXPECTED`.
- `bun install` ejecutables: **2**, ambos `--frozen-lockfile` (matriz raíz/engine/web + cruzada
  engine del job web). `grep` de `bun install` no-frozen → **`(none)`**.
- Sin segundo pin manual divergente en el YAML.
- No se ejecutó CI remoto en esta corrida — verificación estática por lectura del YAML, como
  ordena el contrato.

### 12.6 Efectos laterales de la continuación

- **`docs/agents/hub.html` reaparece como modificado**: lo regeneró `scripts/sync-context.ts` al
  correr `verify-simplicity.sh` (camino positivo del guard, PHASE 3). No lo tocó Task 31
  directamente. **Reportado, no revertido** (instrucción del contrato; `git checkout` de ese
  archivo fue además bloqueado por el clasificador de permisos). Es un artefacto derivado
  regenerable.
- **`scripts/hooks/__pycache__/`**: **NO** reapareció en esta corrida.
- Ningún `bun.lock` ni `apps/web/package-lock.json` cambió.
- Ningún archivo de producto, test funcional, dataset, baseline, scoring ni `app.test.ts` fue
  modificado.
- **`apps/engine/node_modules/` y `apps/web/node_modules/` ya existían** antes de esta corrida
  (no trackeados, gitignored); `--dry-run` no los materializa ni los altera. Task 31 no restauró
  `apps/web/node_modules` (eso es Task 3).

### 12.7 Veredicto de la continuación

**TASK 31 CONTINUATION RESULT: PASS.**

`LOCAL == CI expected == DOCKER == Bun 1.4.2 exacto`, los tres derivados de
`package.json#packageManager`. Tres `bun.lock` (v2/v1/v2) frozen-válidos bajo 1.4.2, cero churn.
Guard determinista GREEN. Docker build + runtime smoke verifican 1.4.2. Sin ediciones de
tests/producto/lockfiles.

- **Task 32 unlocked:** YES (Toolchain Truth cerrado; la migración de evidencia TSK-098 es suya).
- **Task 3 unlocked:** NO (sigue BLOCKED tras 31; espera además el PASS de 32).
- **Circuit breaker:** no disparado. **Contradicción de spec:** no.
- No se ejecutó Task 32, Task 3, Task 5, ninguna suite funcional, commit ni push.

---

## 13. CONTINUACIÓN — primera ejecución REAL de CI remoto en GitHub Actions — 2026-09-14

**Contexto:** §4 y §12.5 de este mismo documento dejaron registrado, explícitamente, que la
verificación de `.github/workflows/ci.yml` en las corridas de Task 31 fue **estática, por lectura
del YAML** — "no se ejecutó CI remoto en esta corrida". Esa historia **no se borra ni se falsea
acá**: hasta el PR #2 (rama `r0/finalize` → `master`), este proyecto nunca había tenido una
ejecución real de GitHub Actions sobre este workflow. Esta sección documenta la primera vez que
ocurrió, con datos literales del run — no una re-lectura del YAML.

### 13.1 Primer run real — FAIL parcial (evidencia de partida, no generada por esta sesión)

- **PR:** #2, `r0/finalize` → `master`.
- **HEAD evaluado:** `9c78fab79e027deba4fea0e467ce453299a298e5`.
- **Workflow run:** `34806575375`.
- **Resultado:** 4 de 5 jobs GREEN (`test (engine)`, `test (web)`, `intelligence-ci (eval
  --enforce)`, `verify-simplicity`); **`test (root)` FAIL**.

### 13.2 Root cause — tres fallos reales, no de producto

Los tres viven exclusivamente en el arnés de pruebas (`scripts/*.test.ts`); ningún archivo de
`apps/engine/src/**` ni `apps/web/**` cambió.

| # | Archivo | Síntoma en Ubuntu | Causa |
|---|---|---|---|
| 1 | `scripts/verify-simplicity.test.ts` | Trampa de ejecución (execution trap) no detectaba los señuelos `bun`/`bunx`/`tsc`; exit 127 en el canario | El directorio de señuelos se anteponía al `PATH` con el delimitador `;` hardcodeado (formato Windows). En Linux, `PATH` usa `:` — el shim quedaba en una sola entrada ilegible, invisible para la resolución de comandos de `bash`. |
| 2 | `scripts/eval/rebased-reference.test.ts` | `expect(env.ENGINE_DB_PATH).toContain("eval\\snapshots\\S1.sqlite")` fallaba | Literal de ruta con separador Windows (`\`) contra una ruta real construida con separador POSIX (`/`) en Ubuntu. |
| 3 | `scripts/verify-simplicity.test.ts` (tras corregir 1) | `expect(code).toBe(0)` fallaba en 3 pruebas — el propio `verify-simplicity.sh` real devolvía `ERRORS>0` | Estas pruebas heredan `process.env` completo hacia el proceso hijo que corre el gate real. Dentro de un job de GitHub Actions, `GITHUB_ACTIONS=true`/`GITHUB_BASE_REF=master` llegan ambiente-heredados también a ESTE archivo de test (no sólo al job dedicado `verify-simplicity`), desviando el gate hacia su rama de diff de PR de CI. Combinado con el checkout **superficial por defecto** del job `test (root)` (`actions/checkout@v4`, `fetch-depth: 1` — a diferencia del job `verify-simplicity`, que pide `fetch-depth: 100`), `git merge-base` no encuentra ancestro común y el gate cae a comparar el árbol completo contra el árbol vacío, reportando violaciones ("nueva dependencia sin // ALLOWED", "secreto hardcodeado") que no existen en ningún diff real. **Reproducido de forma determinística** con un clon superficial real (`git clone --depth 1 file://…`) + `GITHUB_ACTIONS=true GITHUB_BASE_REF=master` antes de escribir el fix, y vuelto a probar después para confirmar el GREEN. |

### 13.3 Fixes — sólo arnés de pruebas, cero producto

| Commit | Archivo(s) | Cambio |
|---|---|---|
| `469e9556…` | `scripts/verify-simplicity.test.ts`, `scripts/eval/rebased-reference.test.ts` | `node:path` `delimiter` (`;` en win32, `:` en POSIX) en vez de `;` hardcodeado; `join("eval","snapshots","S1.sqlite")` en vez del literal `\`-separado. |
| `ef0d0550…` | `scripts/verify-simplicity.test.ts` | Nueva función `stripCiAmbientEnv()`: elimina `GITHUB_ACTIONS`/`GITHUB_BASE_REF` del entorno que estas pruebas pasan al `verify-simplicity.sh` real, para que siempre ejerciten el camino local AFTER-EDIT (diff sin commitear vs. `HEAD`) que documentan probar — sin importar si el propio test corre dentro de un runner de GitHub Actions. El job dedicado `verify-simplicity` sigue ejercitando la rama real de diff de CI sin cambios (su propio `fetch-depth: 100` la resuelve bien). |

Ninguna trampa de ejecución (execution trap), canario, ni assertion de detección de `bun
test`/`bunx tsc`/`tsc`/`eval --enforce` se debilitó — se verificó explícitamente corriendo el
canario tras el fix (sigue detectando las 3 invocaciones señuelo) y reproduciendo el escenario de
clon superficial + variables de CI antes y después del segundo fix.

### 13.4 Run final — GREEN completo (CONFIRMED)

- **HEAD:** `ef0d0550200d527d48f4dc3ba0f80b63ae37e7c9`.
- **Workflow run:** `34808005935`.
- **Runner:** `ubuntu-latest` (los 5 jobs).
- **Bun:** `1.4.2` (pin de `package.json#packageManager`, verificado por el step "Verify Bun
  matches packageManager pin" en cada job — sin drift, consistente con §12 de este mismo
  documento).

| Check | Conclusion | started_at (UTC) | completed_at (UTC) |
|---|---|---|---|
| `test (root)` | **success** | 2026-09-14T04:59:43Z | 2026-09-14T05:00:00Z |
| `test (engine)` | **success** | 2026-09-14T04:59:42Z | 2026-09-14T04:59:51Z |
| `test (web)` | **success** | 2026-09-14T04:59:43Z | 2026-09-14T05:00:20Z |
| `intelligence-ci (eval --enforce)` | **success** | 2026-09-14T04:59:43Z | 2026-09-14T04:59:48Z |
| `verify-simplicity` | **success** | 2026-09-14T04:59:43Z | 2026-09-14T04:59:51Z |

Fuente: `GET /repos/apuherrerafo/D2KIRO/commits/{sha}/check-runs` (API de GitHub, leída
directamente en esta sesión — no una re-lectura del YAML).

### 13.5 Local, previo a cada push (paridad con lo que corrió en CI)

Para cada uno de los dos commits de fix (`469e9556…`, `ef0d0550…`), corrido y en verde ANTES del
push: `bun run test` (engine 673/0, web 218/0, scripts 359/0), `bunx tsc --noEmit` en
`apps/engine` y `apps/web`, `bun run lint` en `apps/web` (0 errores, 6 warnings preexistentes),
`bash scripts/verify-simplicity.sh`, `bun run scripts/eval/gate.ts --enforce`, `git diff --check
3ced3c1..HEAD` (sin errores de espacio en blanco), y el hook real `.husky/pre-commit` /
`.husky/pre-push` de cada commit (lint-staged + `bun run test` + `tsc`), todos en verde.

### 13.6 Veredicto de la continuación

**CI RECOVERY (PR #2): PASS.** Primera ejecución remota real de `.github/workflows/ci.yml` para
este proyecto, con los 5 jobs requeridos en GREEN sobre `ef0d0550200d527d48f4dc3ba0f80b63ae37e7c9`.
Ningún archivo de `apps/engine/src/**` ni `apps/web/**` cambió; ningún baseline, dataset Golden,
artefacto `accepted/reference/candidate`, ni `requirements/design` fue tocado. Sin merge a
`master`, sin force-push, sin Task 30.
