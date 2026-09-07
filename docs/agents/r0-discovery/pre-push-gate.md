# R0.1 — Task 1 (Discovery): estado real del PRE-PUSH gate y convergencia WSL/Windows

- **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` (R0 — Engineering Baseline Recovery)
- **Task:** 1 — `[R0.1] Discovery: estado real del PRE-PUSH gate y convergencia WSL/Windows`
- **Requisitos cubiertos:** 1.5, 1.1, T.2 · **Precondiciones de diseño resueltas:** §9.7, §9.6
- **Naturaleza:** DISCOVERY — read-only. Rol: Claude Code = Writer/Executor.
- **Fecha de la corrida:** 2026-09-06
- **Commit observado (HEAD):** `d617ba5` en `master`, upstream `origin/master`
- **Estado del working tree durante la corrida:** limpio salvo dos entradas sin trackear
  (`.kiro/specs/r0-engineering-baseline-recovery/`, `scripts/hooks/__pycache__/`)

## Convenciones de evidencia

| Marca | Significado |
|---|---|
| **CONFIRMED** | Respaldado por la salida literal de un comando o el contenido de un archivo observado en esta corrida. |
| **NOT CONFIRMED** | No hay evidencia suficiente desde esta máquina. No se sustituye por una suposición. |
| **INFERENCE** | Conclusión razonable derivada de hechos CONFIRMED. Marcada como inferencia, nunca presentada como hecho. |

**Seguridad:** no se imprimió ni se registró ningún secreto, token, API key, password ni valor de
variable sensible. No se inspeccionó Railway (fuera del alcance de esta task; §9.1/§9.2 siguen
abiertas para R0.2/R0.4).

---

## 1. Entorno real detectado

**CONFIRMED — el entorno de ejecución es Git Bash (MSYS2/MINGW64) sobre Windows 10, no WSL.**

```
$ uname -a
MINGW64_NT-10.0-19045 DESKTOP-OJ22916 3.6.5-22c95533.x86_64 2025-10-10 12:02 UTC x86_64 Msys
$ echo $OSTYPE $MSYSTEM        -> msys MINGW64
$ pwd                          -> /d/JULIO/apuherrerafoprojects/dota2coach
$ which git bun node
/mingw64/bin/git
/c/Users/Julio/.bun/bin/bun
/c/nvm4w/nodejs/node
$ git --version                -> git version 2.52.0.windows.1
```

**CONFIRMED — el repo fue creado/gestionado por git de Windows.** `git config --local --list`:
`core.filemode=false`, `core.symlinks=false`, `core.ignorecase=true` — la firma de un checkout
Windows nativo, no de un checkout POSIX.

**CONFIRMED — WSL2 existe en esta máquina, con la distro `Ubuntu` en estado `Stopped`** (más
`docker-desktop`, distro interna de Docker):

```
$ wsl.exe -l -v
* Ubuntu           Stopped   2
  docker-desktop   Stopped   2
```

---

## 2. §9.7 — ¿Está git realmente cableado a `.husky`?

### 2.1 `core.hooksPath`

**CONFIRMED — `core.hooksPath` NO está configurado en ningún scope (local, global, system).**

```
$ git config core.hooksPath                         -> (sin salida) exit=1
$ git config --get-all core.hooksPath               -> (sin salida) exit=1
$ git config --show-origin --get core.hooksPath     -> (sin salida) exit=1
$ git config --local --list | grep -Ei 'hook|core\.'
core.repositoryformatversion=0
core.filemode=false
core.bare=false
core.logallrefupdates=true
core.symlinks=false
core.ignorecase=true
$ git config --global --list | grep -Ei 'hook'      -> (sin salida) exit=1
$ git config --system --list | grep -Ei 'hook'      -> (sin salida) exit=1
$ git rev-parse --git-path hooks                    -> .git/hooks
```

Los únicos archivos de config global/system observados son `C:/Users/Julio/.gitconfig`
(`user.name`, `user.email`, filtros LFS, `windows.appendatomically`) y
`C:/Program Files/Git/etc/gitconfig` (`core.autocrlf=true`, `init.defaultBranch=master`).
Ninguno declara `core.hooksPath`.

### 2.2 Contenido real de `.git/hooks`

**CONFIRMED — `.git/hooks` contiene EXCLUSIVAMENTE los 14 `*.sample` de plantilla; cero hooks
activos.**

```
$ ls -la .git/hooks
applypatch-msg.sample  commit-msg.sample  fsmonitor-watchman.sample  post-update.sample
pre-applypatch.sample  pre-commit.sample  pre-merge-commit.sample    pre-push.sample
pre-rebase.sample      pre-receive.sample prepare-commit-msg.sample  push-to-checkout.sample
sendemail-validate.sample  update.sample
$ find .git/hooks -maxdepth 1 -type f ! -name '*.sample' | wc -l
0
```

Todos con fecha `Jul 26 01:10` — la fecha de inicialización del repo, nunca tocados desde entonces.

### 2.3 Estado de `.husky`

**CONFIRMED — `.husky/` existe con `pre-commit` y `pre-push`, trackeados como `100755`.**

```
$ ls -la .husky
-rw-r--r-- pre-commit  (18 bytes)
-rw-r--r-- pre-push   (758 bytes)
$ git ls-files -s .husky
100755 ... .husky/pre-commit
100755 ... .husky/pre-push
```

`.husky/pre-commit` -> `bunx lint-staged`.
`.husky/pre-push` -> seis pasos secuenciales: `bun test` + `tsc --noEmit` en `apps/engine`;
`bun test` + `tsc --noEmit` + `bun run lint` en `apps/web`; `bun test scripts/`.

**CONFIRMED — Husky NUNCA se instaló en este working tree:**

```
$ ls -la .husky/_          -> No such file or directory   (husky v9 crea .husky/_ al instalar)
$ ls -d node_modules/husky -> No such file or directory
$ ls -d node_modules       -> No such file or directory   (NO existe node_modules en la raíz)
```

`package.json` raíz sí declara `"prepare": "husky"` y `husky ^9.1.7` en `devDependencies`, pero sin
`node_modules` en la raíz el script `prepare` nunca produjo efecto.

**INFERENCE (fuerte, soportada por los tres hechos anteriores):** la causa raíz de que `.husky` no
esté cableado es que nunca se corrió `bun install` en la raíz del repo; sin `node_modules/husky`,
`prepare` no puede ejecutar `husky`, que es lo que fija `core.hooksPath`. No se corrigió (fuera del
write scope de esta task).

### 2.4 Otros posibles mecanismos locales

**CONFIRMED — no existen alias de git ni configuración de push que interpongan un gate:**

```
$ git config --get-regexp '^alias\.'  -> (none)
$ git config --get-regexp 'push\.'    -> (none)
$ git remote -v                       -> origin https://github.com/apuherrerafo/D2KIRO.git (fetch/push)
```

**CONFIRMED — SÍ existe un mecanismo local, pero es de alcance Claude Code, no de git.**
`.claude/settings.json` (única config de proyecto; no hay `.claude/settings.local.json`) registra:

```
PreToolUse  matcher "Bash"                 -> bash scripts/hooks/pretooluse-guard.sh
PreToolUse  matcher "Edit|Write|MultiEdit" -> bash scripts/hooks/pretooluse-edit-guard.sh
PostToolUse matcher "Edit|Write"           -> bash scripts/verify-simplicity.sh
SubagentStop                               -> bash scripts/verify-simplicity.sh
```

`scripts/hooks/pretooluse-guard.sh` intercepta comandos que matcheen `git (commit|push)` y ejecuta
`VERIFY_COMMIT_GATE=1 bash scripts/verify-simplicity.sh`, bloqueando con `exit 2` si falla.
`verify-simplicity.sh` §6, bajo `VERIFY_COMMIT_GATE=1` (CONFIRMED leyendo el script, líneas
175–270), corre: `tsc --noEmit` de `apps/engine` y `apps/web`, `bun test` en `apps/engine`, en
`apps/web` y en `scripts/`, y — sólo si existen las dos SQLite y el baseline — `bun run eval` +
`gate.ts --enforce`.

La config de usuario `~/.claude/settings.json` también define un `PreToolUse`/`Bash`, pero es ajeno
(mata procesos de dev server en puertos 3000/3001/8742/8080); no anula ni sustituye el guard del
proyecto.

**CONFIRMED — el eval pesado del motor está hoy OMITIDO en ese camino**, porque falta una de sus
precondiciones:

```
PRESENT  apps/engine/data/dota2coach.sqlite (778240 bytes)
ABSENT   apps/engine/data/pro-drafts.sqlite          <- coincide con §9.3
PRESENT  eval/baselines/v6-measured.json (12524 bytes)
```

### 2.5 CI — capa POSTERIOR, no PRE-PUSH

**CONFIRMED — existe `.github/workflows/ci.yml`** (GitHub Actions, `ubuntu-latest`), disparado por
`push` a `master` y por `pull_request` a `master`. Dos jobs: matriz `test` (engine / web / root) con
`bun install` -> `bunx tsc --noEmit` -> `bun run lint` (sólo web) -> `bun test <args>` por
directorio; y `verify-simplicity` (`bash scripts/verify-simplicity.sh`, sin `VERIFY_COMMIT_GATE`,
con `fetch-depth: 100`).

Por definición del requisito 1.5 c3, **CI/PR corre DESPUÉS de que el código sale de la máquina y NO
satisface el PRE-PUSH**. Se registra aquí sólo para no confundir las dos capas.

**Nota de divergencia relevante para 1.1/T.2 (CONFIRMED):** CI **no** usa el comando canónico
`bun run test` de la raíz. Usa `bun test` por directorio, con un `bun install` fresco por target
(más un `bun install` extra de `apps/engine` para el type-check cruzado de web). Es decir, el
comando ejecutado en CI y el comando canónico documentado no son literalmente el mismo.

### 2.6 Veredicto §9.7

| Pregunta | Veredicto |
|---|---|
| ¿`core.hooksPath` configurado? | **CONFIRMED: NO**, en ningún scope. |
| ¿Hooks activos en `.git/hooks`? | **CONFIRMED: NO**, sólo `*.sample`. |
| ¿`.husky` existe? | **CONFIRMED: SÍ** (`pre-commit`, `pre-push`, modo `100755` en el índice). |
| ¿Husky instalado / `.husky/_` presente? | **CONFIRMED: NO**; no hay `node_modules` en la raíz. |
| ¿Git ejecuta `.husky/pre-push` hoy? | **CONFIRMED: NO.** Un `git push` desde cualquier terminal, IDE o cliente gráfico no dispara ningún hook. |
| ¿Existe algún gate PRE-PUSH local? | **Parcial y condicional** — ver §2.4 y §5. |

---

## 3. §9.6 — ¿Los tests en rojo fallan en la máquina donde se hacen los commits reales?

### 3.1 Dónde se hacen realmente los commits

**CONFIRMED — el commit más reciente (`d617ba5`, HEAD) se hizo con la identidad configurada en
ESTE entorno Windows** (`C:/Users/Julio/.gitconfig` -> `user.name=apuherrerafo`):

```
$ git log -1 --format='%h | %cn <%ce> | %cd'
d617ba5 | apuherrerafo <apuherrera.fo@gmail.com> | 2026-09-03 22:05:48 -0500
```

**CONFIRMED — la historia muestra tres identidades locales distintas (más una de la web de
GitHub):**

```
$ git log --format='%cn' | sort | uniq -c | sort -rn
   181 apuherrerafo       (2026-07-26 -> 2026-09-03)   <- coincide con el gitconfig de esta máquina
    80 Usuario            (2026-08-22 -> 2026-08-25)
    72 Julio Herrera      (2026-08-27 -> 2026-09-01)
     1 GitHub             (2026-08-25)                  <- commit desde la UI web
```

Las tres comparten el mismo email (`apuherrera.fo@gmail.com`); sólo cambia `user.name`.

**NOT CONFIRMED — el origen de las identidades `Usuario` y `Julio Herrera`.** No corresponden a
ninguna configuración de git observable en esta máquina (`--local`, `--global`, `--system`).

**CONFIRMED — no pudieron originarse en la distro WSL Ubuntu de esta máquina en su estado actual:**

```
$ wsl -d Ubuntu -- ...
UNAME=Linux 6.18.33.2-microsoft-standard-WSL2
WHOAMI=root · HOME=/root · GITCONFIG_EXISTS=no
git config --global user.name  -> (vacío)
git config --system user.name  -> (unset)
ls -1 /home                    -> (vacío: ninguna cuenta de usuario)
find /home -maxdepth 3 -name .gitconfig -> (ninguno)
```

**INFERENCE:** `Usuario` y `Julio Herrera` provienen de otro entorno de git — otra máquina, otro
perfil de Windows, o un cliente/IDE con identidad propia. No es determinable desde aquí y no se
asume.

### 3.2 ¿Es WSL un entorno de commit/test viable para este repo?

**CONFIRMED — el repo ES visible desde WSL** (`/mnt/d` montado):

```
$ wsl -d Ubuntu -- ls -d /mnt/d/JULIO/apuherrerafoprojects/dota2coach
/mnt/d/JULIO/apuherrerafoprojects/dota2coach
$ wsl -d Ubuntu -- ls -1 /mnt   ->  c  d  wsl  wslg
```

**CONFIRMED — pero la distro NO tiene el toolchain del proyecto:**

```
HAS_BUN=none      HAS_NODE=none      HAS_GIT=/usr/bin/git
```

**NOT CONFIRMED — el resultado de las suites bajo WSL Ubuntu.** No se puede medir sin instalar
`bun` en la distro, lo cual está explícitamente prohibido por el write guardrail de esta task (no
instalar dependencias). Se reporta como no confirmado; **no** se asume.

**INFERENCE (fuerte):** con `/home` vacío, sin identidad de git y sin `bun`/`node`, la distro WSL
Ubuntu no es hoy un entorno de desarrollo activo de este repo. El alcance real de la convergencia
P3 es, por lo tanto, **Windows (Git Bash / bun nativo) ↔ Ubuntu (GitHub Actions)**, no
Windows ↔ WSL. Esta inferencia es la base recomendada para el alcance de las tareas 2 y 5; queda
sujeta a que el usuario confirme que no commitea desde otra máquina (residual de §3.1).

### 3.3 Estado real de las suites en esta máquina (Windows, comando canónico)

**CONFIRMED — `bun run test` en Windows falla, exit code 1.** Por el `&&` del script raíz, se corta
en la primera suite: **web y scripts nunca llegan a ejecutarse en el camino canónico.**

```
$ bun run test    -> EXIT_CODE=1
$ bun test apps/engine && bun test apps/web && bun test scripts
 616 pass · 2 fail · Ran 618 tests across 69 files [6.31s]
error: script "test" exited with code 1
```

Los dos fallos de `apps/engine`:

1. `apps/engine/src/pipeline/run-pipeline.test.ts:275` — **assert de separador** (clase C, diseño
   §4.1 inconsistencia #1):
   ```
   - "routes/pro-drafter.ts"
   + "routes\pro-drafter.ts"
   ```
2. `apps/engine/src/server/app.test.ts` — `cuentas HTTP multi-tenant (TSK-098) > (unnamed)`,
   `[5007.26ms] ^ a beforeEach/afterEach hook timed out for this test`. **No es un fallo de
   ruta/separador a primera vista** — es un timeout de hook de test. Se registra como observación;
   su clasificación (A/B/C/D) corresponde a la tarea 2, que debe hacer STOP si no es de
   path/separador.

**CONFIRMED — suites web y scripts, corridas por separado (el mismo par de comandos que ejecuta el
script canónico):**

```
$ bun test apps/web   -> EXIT=1 ·  180 pass ·  7 fail ·  7 errors · 187 tests / 40 files
$ bun test scripts    -> EXIT=1 ·  173 pass ·  4 fail ·            · 177 tests / 30 files
```

`apps/web` — 7 errores de resolución de módulo, literales:

```
error: Cannot find package 'iron-session' from '...\apps\web\proxy.test.ts'
error: Cannot find package 'iron-session' from '...\apps\web\lib\session.ts'
error: Cannot find module '@testing-library/react' from '...\DraftIntentSelector.test.tsx'
error: Cannot find module '@testing-library/react' from '...\CopilotPanel.test.tsx'
error: Cannot find module '@testing-library/react' from '...\use-random-draft-session.integration.test.ts'
```

**CONFIRMED (matiz relevante para la tarea 3):** ambos paquetes **SÍ están declarados** en
`apps/web/package.json` (`iron-session ^8.0.4` en `dependencies`,
`@testing-library/react ^16.3.2` en `devDependencies`); lo que falta es la **instalación**:

```
$ ls -d apps/web/node_modules                        -> existe (300 entradas)
$ ls -d apps/web/node_modules/iron-session            -> No such file or directory
$ ls -d apps/web/node_modules/@testing-library/react  -> No such file or directory
$ ls -d node_modules                                  -> No such file or directory (raíz)
```

`scripts` — 4 fallos:

```
(fail) runProAgreement — Benchmark B > loadReplayCasesFromDb: ... tier_not_accepted entra como unknown
        scripts/eval/benchmark-pro-agreement.test.ts:118
        const path = `/tmp/d2k-pro-${...}.sqlite`
        SQLiteError: unable to open database: /tmp/d2k-pro-egsxwv6f0r.sqlite   <- ruta POSIX hardcodeada
(fail) write-scope: ticket en doing con write_scope -> bloquea fuera, permite dentro   (hook-guards.test.ts:54)
(fail) write-scope: journal.md y el propio ticket siempre pasan                        (hook-guards.test.ts:59)
(fail) data-boundary: bloquea data/curated/ sin autorización                           (hook-guards.test.ts:81)
        expect(received).toBe(expected) · Expected: 2 · Received: 0
```

**CONFIRMED — evidencia empírica directa de la premisa de la tarea 4 / propiedad CP6:** el fallo
`data-boundary: bloquea data/curated/ sin autorización` recibe `0` bloqueos donde espera `2`, es
decir el `data-boundary-guard` **falla ABIERTO en Windows**, exactamente como afirma el diseño §4.1.
No se corrigió (fuera del write scope de esta task).

### 3.4 Contraste con los números de la auditoría

| Suite | Auditoría (diseño §4.1) | Medido hoy en Windows (2026-09-06, `d617ba5`) | Coincide |
|---|---|---|---|
| engine | 615 pass / 3 fail | **616 pass / 2 fail** | **NO** |
| web | 180 pass / 7 fail / 7 errors | **180 pass / 7 fail / 7 errors** | SÍ |
| scripts | 173 pass / 4 fail | **173 pass / 4 fail** | SÍ |

**NOT CONFIRMED — la causa de la diferencia en engine (615/3 -> 616/2).** Puede deberse a commits
posteriores a la auditoría o a un test no determinista (el fallo #2 es un timeout de 5 s, un
candidato natural a flake). Se registra como divergencia observada; no se investiga en esta task ni
se asume una explicación.

### 3.5 Veredicto §9.6

| Pregunta | Veredicto |
|---|---|
| ¿Los tests fallan en la máquina donde se commitea? | **CONFIRMED: SÍ.** `bun run test` da exit 1 en Windows, en el mismo entorno cuya identidad de git firmó HEAD. |
| ¿Fallan también bajo WSL? | **NOT CONFIRMED** — WSL Ubuntu no tiene `bun`; medirlo exigiría instalar (prohibido en esta task). |
| ¿Cuál es el alcance real de la convergencia P3? | **INFERENCE (fuerte): Windows Git Bash ↔ Ubuntu CI.** WSL no es hoy un entorno activo del repo (`/home` vacío, sin identidad de git, sin toolchain). |
| ¿CI pasa hoy? | **NOT CONFIRMED desde esta máquina** — no se consultó GitHub Actions (fuera del alcance read-only local de esta task). |

---

## 4. Hallazgos inesperados (observados, NO reparados)

Regla aplicada: **OBSERVE -> RECORD EVIDENCE. No FIX.**

1. **`.husky/pre-push` no tiene `set -e` ni encadenamiento condicional (CONFIRMED).** Sus seis pasos
   corren en secuencia con `(...)` y el hook devuelve el exit code del **último** comando
   (`bun test scripts/`). Incluso si se cableara `core.hooksPath` hoy, un fallo de `apps/engine`,
   de `tsc` o del lint de web **no bloquearía el push**. Insumo directo para la tarea 5.
2. **`.husky/pre-push` usa `bun test` crudo por subapp, no el comando canónico (CONFIRMED).** Además
   invoca `bun run lint` en `apps/web` — que **sí existe** (`apps/web/package.json` ->
   `"lint": "eslint"`), a diferencia del `lint` de la raíz, que no existe. Insumo para las tareas 5
   y 6.
3. **`package.json` raíz: sin `dev`, sin `lint` (CONFIRMED).** Scripts reales: `prepare`, `pro:sync`,
   `draft:test`, `eval`, `e2e`, `test`. Confirma la inconsistencia #3 del diseño §4.1 (tarea 6).
4. **`node_modules` de la raíz ausente (CONFIRMED).** Explica a la vez que Husky no esté instalado y
   que el `prepare` nunca surtiera efecto. Insumo para las tareas 3, 5 y 23.
5. **`iron-session` está declarado en DOS lugares (CONFIRMED):** `apps/web/package.json`
   (`dependencies`) y también en `package.json` de la raíz (`devDependencies`, junto a
   `@playwright/test`, `better-sqlite3`, `husky`, `lint-staged`). Insumo para la tarea 3 / la
   Harness Responsibility Matrix (tarea 23).
6. **El gate de commit de Claude Code corre el eval pesado (CONFIRMED por lectura del script).**
   `verify-simplicity.sh` §6 bajo `VERIFY_COMMIT_GATE=1` incluye `bun run eval` +
   `gate.ts --enforce`, que según el diseño §3.2/§5 pertenece al nivel **INTELLIGENCE CI**, no al
   PRE-PUSH. Hoy está inerte por falta de `pro-drafts.sqlite` (§9.3). Insumo para la tarea 5 y las
   de R0.2B; **no** se modificó nada.
7. **CI no ejecuta el comando canónico (CONFIRMED).** Ver §2.5. Divergencia estructural relevante
   para 1.1 c2 (mismo veredicto para el mismo commit) y T.2.
8. **`scripts/hooks/__pycache__/` sin trackear en el working tree (CONFIRMED por `git status`).**
   Se observa; no se toca.

---

## 5. Conclusión sobre el estado del PRE-PUSH gate

Aplicando la definición del requisito 1.5 (barrera **local**, antes de que el código salga de la
máquina; CI/PR no cuenta):

| Mecanismo | ¿Local? | ¿Activo hoy? | ¿Satisface 1.5? |
|---|---|---|---|
| `.husky/pre-push` vía `core.hooksPath` | Sí | **CONFIRMED: NO** (`core.hooksPath` vacío, `.git/hooks` sólo samples, husky sin instalar) | No |
| Hook `pre-push` nativo en `.git/hooks` | Sí | **CONFIRMED: NO** (no existe) | No |
| `pretooluse-guard.sh` (Claude Code, matcher `Bash`) | Sí | **CONFIRMED: configurado** en `.claude/settings.json`; corre `VERIFY_COMMIT_GATE=1 verify-simplicity.sh` y bloquea con `exit 2` | **Parcial** — sólo cubre `git commit`/`git push` emitidos por la herramienta Bash de Claude Code. Un push desde terminal, IDE, Kiro o cliente gráfico lo esquiva por completo. |
| CI GitHub Actions | No (post-push) | CONFIRMED: existe | **No**, por definición (1.5 c3) |

**Local gate effective: NO** para el camino general de `git push` (**CONFIRMED**).
**Parcialmente sí** para el camino "push emitido desde una sesión de Claude Code con
`.claude/settings.json` cargado" (**CONFIRMED por configuración**; **NOT CONFIRMED empíricamente** —
verificarlo exigiría intentar un push real, prohibido en esta task).

El juicio final de cumplimiento del requisito 1.5 corresponde a la **tarea 5**, no a esta discovery.

---

## 6. Tareas desbloqueadas / bloqueadas

### Desbloqueadas

- **Tarea 5 — `[R0.1] Implementar/verificar el PRE-PUSH gate determinístico`** (referida en el
  objetivo de esta task como "3.* PRE-PUSH gate"): su dependencia sobre la tarea 1 queda
  **satisfecha**. El estado de git **no** es ambiguo ni inaccesible, de modo que **no** aplica la
  stop condition de la tarea 1 ("si el estado de git es ambiguo o inaccesible … se marca el bloqueo
  de la tarea 5"). Mecanismo confirmado: `core.hooksPath` vacío + `.git/hooks` sólo samples + husky
  sin instalar => hoy no hay gate de git. La tarea 5 sigue bloqueada por sus **otras** dependencias
  declaradas (tareas 2 y 3), no por ésta.
- **Alcance de convergencia P3 para 1.1 / T.2 (tareas 2 y 6)**: fijado como
  **Windows Git Bash ↔ Ubuntu CI** (INFERENCE fuerte, §3.2). La tarea 2 dispone además del
  inventario literal de fallos por suite (§3.3) para delimitar sus slices.
- **Tarea 4 (`_hook_lib.py` / CP6)**: su premisa queda **empíricamente confirmada** —
  `data-boundary-guard` falla abierto en Windows (`Expected: 2 · Received: 0`) más dos fallos de
  `write-scope`. No requería esta task como dependencia, pero ahora tiene la reproducción.

### Bloqueadas / pendientes

- **Tarea 3 (dependencias de `apps/web`)**: sigue bloqueada por su dependencia declarada, la
  **tarea 23** (procedimiento canónico de dependencias, R0.4 / requisito 4.3). Esta discovery no la
  desbloquea. Aporta el matiz de §3.3: los paquetes están **declarados y no instalados**, y no hay
  `node_modules` en la raíz.
- **Comportamiento de las suites bajo WSL Ubuntu**: **NOT CONFIRMED**, y no se puede confirmar sin
  instalar `bun` en la distro (prohibido aquí). Si el proyecto decide que WSL entra en el alcance de
  P3, hace falta una task explícita con permiso de instalación.
- **Origen de las identidades `Usuario` / `Julio Herrera`**: **NOT CONFIRMED**. Si se commitea desde
  otra máquina, el alcance de P3 se amplía y la tarea 5 debe cablear el gate local también allí.
  Requiere confirmación humana, no evidencia local.
- **Veredicto actual de CI**: **NOT CONFIRMED** desde esta máquina (no se consultó GitHub Actions).
- **§9.1 / §9.2 / §9.3 / §9.4 (Railway, env vars, `pro-drafts.sqlite`, migraciones)**: siguen
  abiertas; fuera del alcance de la tarea 1. Único dato colateral registrado aquí:
  `apps/engine/data/pro-drafts.sqlite` **está ausente** en esta máquina (consistente con §9.3).

---

## 7. Cumplimiento del write scope

- **Archivos modificados:** exactamente uno — `docs/agents/r0-discovery/pre-push-gate.md` (este
  reporte), autorizado por el write scope de la tarea 1.
- **Directorio creado:** `docs/agents/r0-discovery/` (contenedor del artefacto autorizado).
- **Nada más se creó, modificó ni borró.** No se tocó `.git/`, `.git/config`, `.git/hooks`,
  `.husky/`, `package.json`, ningún lockfile, `.claude/settings.json`, CI, hooks, código de
  producto, tests, baselines, Golden Dataset ni datos curados.
- **Ningún fix aplicado.** Todos los problemas encontrados quedan registrados, ninguno reparado.
- **Ningún artefacto protegido tocado** (regla transversal (a)).
- **Ningún comando de escritura de git ejecutado**: ni `commit`, ni `push`, ni `config --set`.
- **Archivos temporales** (logs de las corridas de test, script de sondeo de WSL) fuera del repo, en
  el scratchpad de la sesión.

### 7.1 Desviación registrada: `docs/agents/hub.html` modificado por el harness

**Se reporta, no se repara** (regla OBSERVE -> RECORD EVIDENCE).

Tras escribir este reporte, `git status` muestra `docs/agents/hub.html` como **modificado**, pese a
que esta task nunca lo tocó. Evidencia:

```
$ git status --porcelain
 M docs/agents/hub.html
?? .kiro/specs/r0-engineering-baseline-recovery/
?? docs/agents/r0-discovery/
?? scripts/hooks/__pycache__/
$ stat -c '%y' docs/agents/hub.html
2026-09-06 02:27:51 -0500                 (= 07:27:51 UTC)
$ git diff -- docs/agents/hub.html | head
-<title>HUB del ecosistema — 2026-08-22T05:30:26.466Z</title>
+<title>HUB del ecosistema — 2026-09-06T07:27:51.925Z</title>
 ... 1296 insertions(+), 133 deletions(-)
```

- **CONFIRMED:** el archivo fue **regenerado** (no editado a mano) — el título lleva el timestamp
  `2026-09-06T07:27:51.925Z`, coincidente al milisegundo con el `mtime`, y el generador es
  `scripts/hub.ts:327` (`Bun.write("docs/agents/hub.html", html)`), invocable también vía
  `scripts/sync-context.ts`.
- **CONFIRMED:** el momento coincide con la escritura de este reporte, es decir con el disparo del
  hook `PostToolUse` / `Edit|Write` de `.claude/settings.json`.
- **NOT CONFIRMED:** qué ejecutó exactamente `scripts/hub.ts`. `verify-simplicity.sh` y los tres
  scripts de `scripts/hooks/` **no** contienen ninguna referencia a `hub.ts` ni a `hub.html`
  (`grep` vacío), y no existe `.claude/hooks/`.
- **INFERENCE:** alguna automatización del harness fuera de lo declarado en `.claude/settings.json`
  regeneró el tablero como efecto colateral de la escritura. `hub.html` es, por contrato del
  proyecto, una **vista derivada** que "nunca se edita a mano" y se reconstruye con
  `bun scripts/hub.ts`.
- **Hallazgo colateral (CONFIRMED, fuera de alcance):** la versión regenerada difiere mucho de la
  commiteada (backlog `0` -> `153` tarjetas; "Siguiente paso" pasa del texto largo de la sesión a
  `corre /kickoff para empezar`). Es decir, el `hub.html` commiteado está **desincronizado** de lo
  que el generador produce hoy con los tickets y el `PROGRESS.md` actuales. Se registra; no se
  investiga ni se corrige aquí.

**Decisión deliberadamente NO tomada:** no se revirtió el archivo. Revertirlo
(`git checkout -- docs/agents/hub.html`) sería una escritura fuera del write scope de esta task y
una decisión sobre un artefacto derivado que corresponde al usuario, no a esta discovery. Queda
señalado para que se resuelva antes del primer commit de R0.
