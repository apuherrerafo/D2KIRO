# Implementation Plan: R0 â€” Restablecimiento del Baseline de IngenierÃ­a

## Overview

Este plan convierte el diseÃ±o (`design.md`) y los requisitos (`requirements.md`) de R0 en una serie
de tareas de cÃ³digo incrementales para un LLM de generaciÃ³n de cÃ³digo. R0 es una fase de
**recuperaciÃ³n** (brownfield): no agrega funcionalidad de Dota ni mejora la inteligencia de drafting;
su Ãºnico objetivo es que **cuando el sistema diga GREEN, exista evidencia reproducible de que
realmente estÃ¡ GREEN** (diseÃ±o Â§1.1, Â§2.1).

Lenguajes de implementaciÃ³n (derivados del diseÃ±o, no del task-writer): **TypeScript** para el motor
(`apps/engine`), el eval (`scripts/eval`) y el sitio (`apps/web`); **Python** para los hooks
(`scripts/hooks/_hook_lib.py`); **Bash** para scripts de gate/CI donde ya existen. El comando canÃ³nico
de test es `bun run test` (nunca `bun test` crudo en la raÃ­z â€” miente por el registrator global de
happy-dom, diseÃ±o Â§2.2).

El orden de dependencia es acÃ­clico: `R0.1 â†’ R0.2A â†’ R0.3 â†’ R0.2B` y `R0.1 â†’ R0.4` (independiente).
R0.4 es paralelizable respecto a R0.2A/R0.3 donde el write scope no colisiona. La Ãºltima tarea
(Certification) es un gate que solo verifica y emite veredicto, no arregla nada.

---

## Reglas transversales de ejecuciÃ³n (referenciables por todas las tareas)

Estas reglas aplican a **toda** tarea de implementaciÃ³n de este plan. Cada tarea las asume; no se
repiten en su contrato salvo cuando una regla concreta es crÃ­tica para esa tarea.

### (a) Protected evidence + STOP/REPLAN (diseÃ±o Â§7, Â§4.4 guardrail 4, requisitos 4.8, T.3, T.4)

Ninguna tarea de implementaciÃ³n modifica **unilateralmente** ninguno de estos artefactos protegidos
para hacer pasar una implementaciÃ³n:

- `Requirements` / `Design` / `acceptance criteria` de esta spec.
- `accepted reference baseline` (`eval/baselines/*` aceptado), `Golden Dataset` (`eval/golden/*`),
  `evaluation protocol` (protocolo/tolerancias de Fase 9).
- `SCORING_WEIGHTS_V1..V6` y el patrÃ³n freeze-by-name (`apps/engine/src/signals/weights.ts`).
- `ADRs` (ADR-001 jerarquÃ­a L0â€“L6, ADR-002 pro pick no es ground truth, ADR-003, ADR-004),
  `curated data` (`data/curated/`, `hero-positions.json`, counters curados, `capabilities.json`).
- `invariantes.md`, `journal.md` / `ledger.md` (append-only; nunca se borran lÃ­neas).
- `evaluateGate()` (NDCG@5 / BadPickRate / Agreement), `applyDraftEvent` (reductor puro),
  `ENABLE_PRO_DRAFTER=false`.

Si una tarea descubre que uno de estos artefactos estÃ¡ **mal** â‡’ **STOP** â†’ clasificar la causa
(spec/design = clase B, datos/evaluaciÃ³n = clase D) â†’ **REPLAN** (volver a diseÃ±o/requirements,
actualizar el Spec, regenerar las tareas afectadas antes de re-implementar). No se parchea el
sÃ­ntoma ni se edita el artefacto protegido para acomodar el cÃ³digo.

### (b) Circuit-breaker (diseÃ±o Â§4.4 guardrail 7, requisito 4.8 c4â€“c5)

Tras un fix y su re-verificaciÃ³n: si vuelve a ocurrir un FAIL atribuible a la **MISMA root cause**,
**NO** se permite otro ciclo automÃ¡tico de reparaciÃ³n â‡’ **STOP** automatic repair â†’ **report
evidence** â†’ escalar a **REPLAN/HUMAN** (conecta con `attempts â†’ Tracer`, `=3` dispara Tracer). Un
FAIL de root cause **distinta** inicia su propia clasificaciÃ³n A/B/C/D y **no** cuenta contra el
circuit-breaker de la causa anterior.

### (c) Disciplina de regresiÃ³n (diseÃ±o Â§2.1 P4, Â§10 nota CP2/CP5/CP10, `invariantes.md`)

Para todo bug reproducible: **reproducir el FAIL** â†’ escribir el **candado en rojo** (verificarlo
fallando antes de arreglar) â†’ **fix** en la causa raÃ­z â†’ **PASS**. Nunca se modifica el test para
acomodar una implementaciÃ³n incorrecta. CP2, CP5 y CP10 llevan candado de regresiÃ³n cero
obligatorio.

### (d) Tier de verificaciÃ³n mÃ­nimo por tarea (diseÃ±o Â§3.2, Â§5)

Cada tarea usa el **tier mÃ­nimo suficiente**, no el mÃ¡s caro:

- **AFTER EDIT** (informational): escaneo estÃ¡tico barato, sin efectos.
- **TASK COMPLETION** (required): `tsc` + **solo** la suite afectada â€” default para una tarea local.
- **PRE-PUSH** (required): software correctness (`bun run test` + sanity pequeÃ±o) â€” reservado a los
  gates, no a cada tarea.
- **PR / CI** (required): software completo.
- **INTELLIGENCE CI** (required): eval pesado de draft (NDCG / agreement) â€” **solo** donde R0.2B lo
  exige; nunca en pre-push.

**P1 (required-skip â‰  PASS):** un check `required` en `SKIPPED`/`BLOCKED` bloquea (exit != 0 en
enforce); un check `optional`/`informational` skipped se reporta sin bloquear. **P2:** los chequeos
obligatorios corren como cÃ³digo (script/hook/CI), nunca como juicio de un LLM. **P3:** convergencia
Windows â†” Ubuntu con el mismo comando canÃ³nico.

---

## Tasks

### R0.1 â€” Environment Truth

- [x] 1. [R0.1] Discovery: estado real del PRE-PUSH gate y convergencia WSL/Windows
  - **Workstream:** R0.1 Environment Truth (discovery, read-only salvo el artefacto de evidencia).
  - **Dependencies:** ninguna.
  - **Preconditions:** ninguna.
  - **Objetivo:** determinar de forma verificable (1) si git estÃ¡ realmente cableado a `.husky`
    (`core.hooksPath` / contenido de `.git/hooks`) y quÃ© mecanismo, si alguno, ejecuta hoy el
    PRE-PUSH gate; y (2) si las tres suites en rojo tambiÃ©n fallan en la mÃ¡quina donde se hacen los
    commits reales (WSL vs Windows), para fijar el alcance real de la convergencia P3.
  - **Expected observable output:** un reporte de evidencia (p.ej.
    `docs/agents/r0-discovery/pre-push-gate.md`) con la salida literal de `git config core.hooksPath`,
    el listado de `.git/hooks`, y la clasificaciÃ³n WSL-vs-Windows de los fallos observados; enumera
    quÃ© tareas desbloquea (3.* PRE-PUSH gate, 1.1/T.2 alcance de convergencia).
  - **Write scope:** `docs/agents/r0-discovery/pre-push-gate.md` (solo evidencia). Read-only sobre
    `.git/`, `.husky/`, `package.json`, `.claude/settings.json`.
  - **Protected / DO NOT CHANGE:** no arregla ni reconfigura git ni Husky; solo observa y reporta. No
    toca artefactos protegidos (regla transversal (a)).
  - **Implementation notes:** diseÃ±o Â§9.7 y Â§9.6; Â§4.1 "estado actual". No inventar respuestas
    (diseÃ±o Â§9): donde no se pueda confirmar, se reporta como no confirmado.
  - **Verification:** el reporte existe, cita salidas de comando reales y no modifica configuraciÃ³n.
  - **Acceptance criteria:** el reporte responde Â§9.7 (mecanismo del gate) y Â§9.6 (WSL/Windows) con
    evidencia literal, o marca explÃ­citamente lo que no se pudo confirmar.
  - **Failure / stop conditions:** si el estado de git es ambiguo o inaccesible, se reporta como no
    confirmado y se marca el bloqueo de la tarea 5 (implementaciÃ³n del gate); no se asume.
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 1.5, 1.1, T.2_

- [x] 2. [R0.1] Reparar las tres suites bajo el comando canÃ³nico (paths POSIX / separador OS-agnÃ³stico)
  - **Workstream:** R0.1 Environment Truth.
  - **Dependencies:** ninguna (puede empezar sin discovery; la convergencia real la confirma la tarea 1).
  - **Preconditions:** ninguna bloqueante; la tarea 1 informa el alcance de convergencia P3.
  - **Objetivo:** reparar los fallos de las suites engine / web / scripts causados por rutas POSIX
    hardcodeadas (`/tmp/`) y asserts de separador (`/` vs `\`), normalizando a rutas OS-agnÃ³sticas en
    el borde del test con helpers de `node:path` â€” tratando cada divergencia como defecto de tooling
    (clase C), no como estado aceptable.
  - **Expected observable output:** `bun run test` ejecuta las tres suites y produce un veredicto con
    exit code; los fallos de path/separador desaparecen (los fallos por dependencias faltantes de web
    los cubre la tarea 3).
  - **Write scope:** archivos de test y helpers de test en `apps/engine/**/*.test.ts`,
    `apps/web/**/*.test.ts(x)`, `scripts/**/*.test.ts` que contengan rutas POSIX o asserts de
    separador. No toca lÃ³gica de producto.
  - **Protected / DO NOT CHANGE:** no modifica lÃ³gica de producto ni datos curados; no cambia el
    comando canÃ³nico (`bun run test`); no usa `bun test` crudo en la raÃ­z como fuente de verdad
    (regla (a), (d)).
  - **Implementation notes:** diseÃ±o Â§4.1 (inconsistencia #1), tabla de inconsistencias. Slices
    coherentes por suite/causa, no una tarea por test.
  - **Verification:** TASK COMPLETION â€” `tsc` + las suites afectadas bajo `bun run test`.
  - **Acceptance criteria:** los fallos por ruta POSIX / separador quedan en verde en Windows;
    ninguna ruta hardcodeada `/tmp/` o assert `/`-vs-`\` sobrevive en las suites tocadas.
  - **Failure / stop conditions:** si un fallo no es de path/separador sino de lÃ³gica de producto â‡’
    STOP y clasificar (posible clase A/B); no se fuerza el test. Circuit-breaker regla (b).
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 1.1_

- [x] 3. [R0.1] Restaurar el Ã¡rbol de instalaciÃ³n local de `apps/web` desde manifest + Bun lockfile
  - **Workstream:** R0.1 Environment Truth.
  - **Current state:** **BLOCKED** hasta que Tasks 31 y 32 estÃ©n en PASS. El blocker original
    (Bun local 1.3.14 no podÃ­a leer `apps/web/bun.lock` v2) ya fue corregido parcialmente por Task 31,
    pero el runtime canÃ³nico aÃºn debe cerrar Toolchain Truth y migrar la evidencia TSK-098 antes de
    restaurar el Ã¡rbol web. El manifest no es la causa.
  - **Dependencies:** 23 (el `canonical dependency-management procedure` lo determina la Harness
    Responsibility Matrix / R0.4, requisito 4.3 â€” no la tarea 12, que es Data Readiness de R0.3) y
    **32** (Canonical Bun Runtime Compatibility / TSK-098 Evidence Migration GREEN; 32 depende de 31).
  - **Preconditions:** la matriz de la tarea 23 fue aceptada; Task 31 estÃ¡ GREEN para Toolchain Truth;
    y Task 32 revalidÃ³/migrÃ³ la evidencia aceptada bajo Bun 1.4.2 sin cambio de producto. Confirma que
    `apps/web/package.json` y `apps/web/bun.lock` ya declaran `iron-session` y
    `@testing-library/react` antes de instalar.
  - **Objetivo:** restaurar/reconciliar `apps/web/node_modules` desde el manifest y `bun.lock`
    existentes y vÃ¡lidos para que la suite web deje de fallar por resoluciÃ³n de mÃ³dulos. Esta tarea
    no aÃ±ade paquetes ni repite su aprobaciÃ³n.
  - **Expected observable output:** `iron-session` y `@testing-library/react` resuelven desde
    `apps/web` y la suite web ya no presenta los errores `module-not-found` observados.
  - **Write scope:** Ã¡rbol local no trackeado `apps/web/node_modules/`. `apps/web/bun.lock` y
    `apps/web/package.json` son read-only en esta tarea: cualquier intento de churn bajo
    `--frozen-lockfile` es una inconsistencia nueva y activa STOP/REPLAN.
  - **Protected / DO NOT CHANGE:** no aÃ±adir paquetes que ya estÃ¡n declarados; no volver a aprobar
    `iron-session`; no usar `bun add` ni editar el manifest para forzar la instalaciÃ³n; no convertir
    la tarea en cleanup general del frontend.
  - **Implementation notes:** diseÃ±o Â§4.1 (inconsistencia #2); requisito 1.2 referencia el resultado
    canÃ³nico. Ejecutar `bun install --frozen-lockfile` desde `apps/web` Ãºnicamente con el runtime
    exacto establecido por la tarea 31. `package-lock.json` existe, pero no es el lockfile canÃ³nico de
    este procedimiento.
  - **Verification / regression discipline:** reproducir primero los errores de resoluciÃ³n; instalar
    desde `apps/web`; comprobar que ambos paquetes resuelven; ejecutar la suite web bajo el comando
    canÃ³nico; inspeccionar cualquier diff de lockfile antes de aceptarlo.
  - **Acceptance criteria:** cero errores de resoluciÃ³n de `iron-session` /
    `@testing-library/react` en la suite web; el Ã¡rbol local quedÃ³ reconciliado desde el manifest +
    `bun.lock` existentes; no se aÃ±adieron dependencias ya declaradas.
  - **Failure / stop conditions:** si el procedimiento canÃ³nico (23), Toolchain Truth (31) o Runtime
    Compatibility / Evidence Migration (32) no estÃ¡n GREEN â‡’ permanecer BLOCKED; si
    `--frozen-lockfile` intenta reescribir el lockfile â‡’ STOP/REPLAN; si despuÃ©s de restaurar la
    resoluciÃ³n aparecen fallos distintos, clasificarlos por separado y no ampliar Task 3.
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 1.2, 4.3_

- [x] 4. [R0.1] NormalizaciÃ³n de ruta OS-independiente en `_hook_lib.py` con fail-closed
  - **Workstream:** R0.1 Environment Truth.
  - **Dependencies:** ninguna.
  - **Preconditions:** ninguna (la lÃ­nea exacta que falla se confirma en tiempo de tarea, diseÃ±o Â§4.1).
  - **Objetivo:** hacer que `to_repo_relative` devuelva SIEMPRE una ruta relativa al repo con
    separador `/` idÃ©ntica en Windows y Ubuntu, y que `matches_any` produzca resultado idÃ©ntico en
    ambos SO para el mismo input lÃ³gico; centralizar la lÃ³gica en un solo lugar (`_hook_lib.py`) y
    hacer que `data-boundary-guard` **falle cerrado** (bloquee) ante ambigÃ¼edad de normalizaciÃ³n.
    Incluye el candado de regresiÃ³n en rojo antes del fix (CP6).
  - **Expected observable output:** `to_repo_relative(win_path) == to_repo_relative(posix_path)` para
    el mismo input lÃ³gico; `matches_any` asevera que nunca compara con `\`; `data-boundary-guard`
    bloquea `data/curated/` en Windows en vez de fallar abierto.
  - **Write scope:** `scripts/hooks/_hook_lib.py`, `scripts/hooks/data-boundary-guard.py` (postura
    fail-closed), y el test de regresiÃ³n OS-independiente asociado.
  - **Protected / DO NOT CHANGE:** la lÃ³gica de normalizaciÃ³n se centraliza en un solo lugar, no se
    dispersa; no se afloja el guard a fail-open.
  - **Implementation notes:** diseÃ±o Â§4.1 LLD (`to_repo_relative` / `matches_any` pseudocÃ³digo, nota
    de fail-safe), inconsistencia #4. Regla de regresiÃ³n (c).
  - **Verification:** TASK COMPLETION â€” test de regresiÃ³n OS-independiente (harness/PRNG existente,
    sin librerÃ­a PBT nueva) en rojo â†’ verde.
  - **Acceptance criteria:** el candado CP6 pasa (`norm(win) == norm(posix)`); `data-boundary-guard`
    demuestra fail-closed ante ambigÃ¼edad; la normalizaciÃ³n vive solo en `_hook_lib.py`.
  - **Failure / stop conditions:** si el fix no cierra la divergencia tras re-verificar la misma
    causa â‡’ circuit-breaker regla (b), STOP + escalar.
  - **Risk level:** medio (afecta guards de escritura/datos).
  - **Approval required?** No.
  - _Requirements: 1.3_

- [x] 5. [R0.1] Implementar/verificar el PRE-PUSH gate determinÃ­stico y verificable
  - **Workstream:** R0.1 Environment Truth.
  - **Dependencies:** 1 (discovery del gate/WSL), 2 (suites reparadas), 3 (deps web reconciliadas;
    la tarea 3 depende formalmente de Runtime Compatibility 32, que depende de Toolchain Truth 31).
  - **Preconditions:** la tarea 1 resolviÃ³ el mecanismo real del gate y el alcance de convergencia P3;
    la tarea 3 estÃ¡ GREEN bajo el pin canÃ³nico. Por trÃ¡nsito `5 â† 3 â† 32 â† 31`, esta tarea no puede
    pasar con Toolchain Truth/Evidence Migration sin resolver ni con la tarea 3 bloqueada.
  - **Objetivo:** disponer de un PRE-PUSH gate **local y determinÃ­stico** que ejecute el software
    correctness (`bun run test` + sanity pequeÃ±o, sin el eval pesado) **en la mÃ¡quina, antes de que un
    commit salga de ella**. Un PRE-PUSH gate es por definiciÃ³n un mecanismo LOCAL: Husky, un git
    `pre-push` hook nativo (`core.hooksPath` cableado), o un wrapper local equivalente verificable
    satisfacen el requisito. Un gate de CI/PR **no** lo satisface por sÃ­ solo, porque corre DESPUÃ‰S de
    que el cÃ³digo sale de la mÃ¡quina; CI/PR se conserva como capa POSTERIOR adicional, nunca como
    sustituto del gate local. Exponer de forma verificable si el gate local estÃ¡ activo y quÃ©
    mecanismo lo implementa.
  - **Expected observable output:** un comando/artefacto determinista muestra que el gate LOCAL estÃ¡
    activo y quÃ© mecanismo local lo implementa; documentar la sola ausencia de Husky NO satisface el
    requisito si no hay mecanismo local equivalente en su lugar; un gate de CI/PR presente NO cuenta
    como PRE-PUSH.
  - **Write scope:** `.husky/pre-push` o el mecanismo local equivalente (config de `core.hooksPath`,
    hook `pre-push` nativo de git, wrapper local), y su verificaciÃ³n. NO incluye el eval pesado (ese
    vive en INTELLIGENCE CI). La capa de CI/PR posterior se cablea en las tareas 10/27, no aquÃ­.
  - **Protected / DO NOT CHANGE:** el objeto es la existencia de un PRE-PUSH gate LOCAL verificable, no
    Husky especÃ­ficamente; CI/PR es capa posterior, no equivalente al gate local; el eval `--enforce`
    completo no entra aquÃ­ (diseÃ±o Â§5).
  - **Implementation notes:** diseÃ±o Â§3.2 (nivel PRE-PUSH = local), Â§5, Â§4.4 filosofÃ­a de hooks;
    requisito 1.5 (Husky = implementaciÃ³n local posible; cualquier mecanismo LOCAL equivalente
    verificable sirve; CI/PR no cuenta como PRE-PUSH).
  - **Verification:** TASK COMPLETION + demostraciÃ³n de que el gate LOCAL corre `bun run test` y
    bloquea en rojo antes del push efectivo; convergencia P3 segÃºn el alcance de la tarea 1.
  - **Acceptance criteria:** existe un PRE-PUSH gate LOCAL verificable que corre software correctness y
    bloquea antes de que el cÃ³digo salga de la mÃ¡quina; su estado y mecanismo local son inspeccionables;
    ni la ausencia de Husky ni la sola presencia de un gate de CI/PR se aceptan como cumplimiento del
    PRE-PUSH.
  - **Failure / stop conditions:** si la discovery (tarea 1) no pudo confirmar el cableado de git â‡’
    elegir un mecanismo LOCAL equivalente verificable explÃ­cito; no declarar cumplido por documentaciÃ³n
    ni por un gate de CI/PR (que es capa posterior).
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 1.5, 1.1, T.2_

- [x] 6. [R0.1] Alinear comandos documentados con `package.json` (dev / lint)
  - **Workstream:** R0.1 Environment Truth.
  - **Dependencies:** ninguna. Nota: el criterio de `dev`/`lint` se cruza con la discovery de env vars
    (tarea 11) solo si la doc de comandos depende del entorno Railway; por defecto no depende.
  - **Preconditions:** descubrir en tiempo de tarea si `dev`/`lint` deben existir (diseÃ±o Â§4.1).
  - **Objetivo:** alinear la documentaciÃ³n (CLAUDE.md y espejos) con `package.json`: crear el script
    `dev`/`lint` si debe existir, o eliminar la referencia si no; asegurar que todo comando
    documentado como canÃ³nico exista y sea ejecutable.
  - **Expected observable output:** ningÃºn comando documentado como canÃ³nico apunta a un script
    inexistente; `package.json` y la doc coinciden.
  - **Write scope:** `package.json` (si se crean scripts), `CLAUDE.md` y espejos de comandos. Coordina
    con R0.4 tarea 15 (reconciliaciÃ³n de espejos) para no colisionar el write scope de docs.
  - **Protected / DO NOT CHANGE:** no reescribe la polÃ­tica de comandos; el canÃ³nico de test sigue
    siendo `bun run test`.
  - **Implementation notes:** diseÃ±o Â§4.1 (inconsistencia #3, "decisiÃ³n de tarea, tras descubrimiento").
  - **Verification:** TASK COMPLETION â€” cada comando canÃ³nico documentado se ejecuta sin "script not
    found".
  - **Acceptance criteria:** comandos documentados == comandos que existen; decisiÃ³n crear/eliminar
    registrada.
  - **Failure / stop conditions:** si un comando "canÃ³nico" documentado no puede existir ni eliminarse
    sin ambigÃ¼edad â‡’ STOP y clasificar (posible clase B/spec).
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 1.4_

- [x] 17. [R0.1] Reparar la root cause del timeout TSK-098 en app.test.ts (cuentas HTTP multi-tenant)
  - **Workstream:** R0.1 Environment Truth.
  - **Requirements que valida:** 1.1 (suite engine GREEN) y T.2 (en lo que toca a la convergencia de la
    suite engine bajo el comando canÃ³nico). Toma **ownership** del blocker TSK-098 que hoy ninguna
    tarea posee â€” gap Taskâ†’Requirement descubierto en ejecuciÃ³n (Task 2 aislÃ³ el fallo y lo dejÃ³
    correctamente fuera de su scope de path/separator).
  - **Dependencies:** 2 (el fallo TSK-098 se aislÃ³ DESPUÃ‰S de estabilizar los problemas de path de la
    tarea 2; sin las suites reparadas no estÃ¡ aislado el residual real), 4 (normalizaciÃ³n OS-independiente
    en `_hook_lib.py` estabilizada â€” para que la Ãºnica causa residual observable sea la de TSK-098 y no
    ruido de separador aÃºn pendiente).
  - **Preconditions:** tarea 2 en PASS; el fallo TSK-098 estÃ¡ aislado y confirmado como **no-path**
    (evidencia de ejecuciÃ³n de la tarea 2: se reproduce determinÃ­sticamente â‰¥3 veces, alrededor de
    tests con servidor HTTP/WebSocket real y rate limiting, con timeout 5000ms).
  - **Objetivo:** investigar y reparar, de forma **acotada**, la ROOT CAUSE del timeout de
    `apps/engine/src/server/app.test.ts` "cuentas HTTP multi-tenant (TSK-098)", para que la suite engine
    quede GREEN. NO es una auditorÃ­a general de `app.test.ts` ni de otros tests.
  - **Expected observable output:** el test TSK-098 deja de hacer timeout; `apps/engine` pasa a
    618 pass / 0 fail (o el total correcto de la suite sin el fallo TSK-098); queda registrada la
    evidencia de reproducciÃ³n aislada (FAIL) previa al fix.
  - **Write scope (estimado, mÃ­nimo):** inicialmente `apps/engine/src/server/app.test.ts` y los helpers
    de **TEST** directamente responsables (setup/teardown del servidor HTTP/WS de test, utilidades de
    test de rate limiting). NO lÃ³gica de producto por defecto.
  - **Protected / DO NOT CHANGE:** NO modificar lÃ³gica de producto solo para hacer pasar un test
    (regla (a)); no se tocan `applyDraftEvent`, `evaluateGate()`, `SCORING_WEIGHTS_*`, datos curados ni
    artefactos protegidos; el `account_id` (Steam32) nunca se loguea ni se eco (seguridad).
  - **Implementation notes:** el fallo ocurre alrededor de servidor HTTP/WebSocket real + rate limiting;
    el candidato mÃ¡s probable de root cause es el test harness/cleanup o timing/concurrency, no la
    lÃ³gica de dominio â€” pero debe **DISTINGUIRSE, no asumirse**. Reproducir primero en aislamiento
    antes de tocar nada.
  - **Root cause classification (obligatoria ANTES del fix):** clasificar la root cause entre:
    (i) test harness / cleanup; (ii) timing / concurrency; (iii) servidor HTTP/WebSocket;
    (iv) rate limiting / shared state; (v) lÃ³gica real de producto; (vi) unknown. Documentar cuÃ¡l es.
  - **Verification:** TASK COMPLETION + disciplina de regresiÃ³n (regla (c)) â€” reproducir el **FAIL**
    aislado â†’ escribir la evidencia de regresiÃ³n â†’ identificar la root cause â†’ **minimal fix** â†’ PASS
    dirigido del test TSK-098 â†’ suite engine PASS (`bun run test` de `apps/engine` en verde).
  - **Acceptance criteria:** TSK-098 ya no hace timeout; la suite engine queda GREEN; la root cause quedÃ³
    clasificada y documentada; el fix es mÃ­nimo y del lado del test/harness salvo escalado explÃ­cito.
  - **Failure / stop conditions:**
    - Si la root cause resulta estar en **lÃ³gica real de producto** y corregirla implica cambiar
      comportamiento funcional â‡’ **STOP** â†’ clasificar clase A (defecto de implementaciÃ³n de producto)
      o clase B (spec/design) segÃºn corresponda â†’ **REPLAN** ANTES de modificar producto (no se toca
      producto para "pasar" el test, regla (a)).
    - Circuit-breaker (regla (b)): si tras un fix y su re-verificaciÃ³n reaparece un FAIL de la **MISMA**
      root cause â‡’ STOP automatic repair â†’ report evidence â†’ REPLAN/HUMAN.
  - **Risk level:** medio (toca el test harness de servidor HTTP/WS; riesgo de flakiness).
  - **Approval required?** No (salvo que se active el STOPâ†’REPLAN por root cause en producto).
  - _Requirements: 1.1, T.2_

- [x] 31. [R0.1] Canonical Bun Toolchain Truth â€” pin exacto local/CI/Docker y verificaciÃ³n
  - **Workstream:** R0.1 Environment Truth (owner ejecutable de `TOOLCHAIN_VERSION_DRIFT`).
  - **Current execution state:** **PARTIAL / CONTINUE AFTER REPLAN**. Ya estÃ¡n aplicados legÃ­timamente
    el pin raÃ­z, alineaciÃ³n local 1.4.2, guard determinista, CI derivada+frozen, Docker derivado y las
    tres validaciones frozen sin churn. No revertir ni repetir la actualizaciÃ³n local. La ejecuciÃ³n
    anterior se detuvo correctamente al detectar `TSK098_RUNTIME_SEMANTICS_CHANGED`; esa migraciÃ³n de
    evidencia sale de esta task y pasa a Task 32. Falta verificar lo ya hecho y cerrar principalmente
    el build/smoke del runtime Docker.
  - **Dependencies:** 17 (evidencia histÃ³rica TSK-098 aceptada que fija el punto de partida) y 23 (procedimiento canÃ³nico
    de dependencias aceptado). Ambas dependencias ya estÃ¡n aceptadas.
  - **Preconditions / observed blocker (confirmado contra el working tree):** baseline pre-change ya
    registrado: Bun local 1.3.14; ausencia de `packageManager`, `engines.bun` y `.bun-version`; los tres
    `bun.lock` trackeados (raÃ­z `lockfileVersion: 2` / `configVersion: 1`, engine v1/c1, web v2/c0);
    los dos `bun-version: latest` de `.github/workflows/ci.yml`; y el instalador flotante
    `curl .../install | bash` del Ãºnico `Dockerfile`. `railway.json` confirma builder `DOCKERFILE`,
    `dockerfilePath: Dockerfile` y contexto de build en la raÃ­z: producciÃ³n consume directamente ese
    archivo y no puede depender de que GitHub Actions le inyecte un ARG.
  - **Objetivo:** establecer una sola verdad ejecutable para Bun: pin exacto
    `"packageManager": "bun@1.4.2"` en el `package.json` raÃ­z; entorno local y CI consumen ese mismo
    valor; Docker/Railway tambiÃ©n lo deriva del mismo campo; una comprobaciÃ³n determinista rechaza
    cualquier runtime distinto.
  - **Expected observable output:**
    1. el `package.json` raÃ­z es la **Ãºnica fuente manual** del pin exacto;
    2. no se crea `.bun-version`, `engines.bun` ni un ARG/config con un segundo pin manual;
    3. Bun local pasa de la versiÃ³n pre-change registrada a la versiÃ³n exacta derivada de
       `packageManager`, con igualdad post-change demostrada;
    4. ambos `oven-sh/setup-bun@v2` dejan de forzar `bun-version: latest`, resuelven el
       `packageManager` raÃ­z y son seguidos por una comparaciÃ³n explÃ­cita expected-vs-actual;
    5. todas las instalaciones Bun de CI son frozen, incluida la instalaciÃ³n cruzada de engine en
       el job web;
    6. Railway/Docker instala la versiÃ³n derivada del `packageManager` raÃ­z, la comprueba durante el
       build y un smoke del contenedor demuestra esa misma versiÃ³n efectiva;
    7. raÃ­z, engine y web pasan validaciÃ³n frozen bajo 1.4.2 con sus lockfiles actuales; los formatos
       v2/v1/v2 son parseables, manifest y lock estÃ¡n coherentes y no se materializa el Ã¡rbol web
       local como objetivo de esta tarea;
    8. hashes y `git diff --exit-code` antes/despuÃ©s demuestran cero churn en los tres `bun.lock` y
       en `apps/web/package-lock.json` (este Ãºltimo protege el contrato npm de producciÃ³n web);
    9. LOCAL, CI y DOCKER verifican su versiÃ³n efectiva contra el mismo `packageManager`;
    10. la tarea termina sin editar tests/producto, sin absorber Task 32 ni ejecutar Task 3.
  - **Canonical source model:** el Ãºnico literal de versiÃ³n es
    `package.json#packageManager = bun@1.4.2`. LOCAL, CI, Docker, el guard y las verificaciones leen y
    validan el formato cerrado `bun@<semver exacto>` antes de usarlo. No se aÃ±ade `.bun-version`,
    `engines.bun`, variable Railway, secreto, tag de imagen o `bun-version:` con una copia del nÃºmero.
  - **Execution order / immutable baseline (continuaciÃ³n, no replay):**
    1. leer el artefacto existente y el diff preexistente; confirmar que el pin, guard, CI, Docker,
       frozen validations y hashes ya registrados corresponden a Task 31 sin reaplicar esos cambios;
    2. confirmar que el Bun local efectivo sigue coincidiendo con `packageManager`; **no reinstalarlo**
       si ya es 1.4.2;
    3. repetir Ãºnicamente comprobaciones de Toolchain Truth no mutantes si hacen falta para confirmar
       el estado parcial;
    4. ejecutar el build y smoke Docker pendientes, sin correr tests ni migrar evidencia TSK-098;
    5. repetir hashes/diffs, actualizar el artefacto existente y emitir PASS de Toolchain Truth o
       STOP/REPLAN. Nunca continuar un stage
       dependiente despuÃ©s de que falle su precondiciÃ³n.
  - **Local alignment (Windows + Git Bash):** registrar `bun --version` pre-change; obtener
    `expected` desde `packageManager` (sin Bun, por ejemplo con el Node ya disponible); invocar desde
    Git Bash el instalador oficial de Windows en PowerShell pasando esa variable a
    `install.ps1 -Version <expected>`; abrir/refrescar el proceso si hace falta; registrar
    `bun --version` post-change y exigir igualdad exacta. El comando reproducible debe leer el campo,
    nunca contener el literal `1.4.2` fuera del manifest. **ContinuaciÃ³n actual:** la evidencia ya
    registra 1.3.14 â†’ 1.4.2; si el runtime sigue igual al pin, no repetir instalaciÃ³n. Fuente oficial:
    https://bun.sh/docs/installation#installing-older-versions.
  - **Deterministic local guard:** `scripts/verify-simplicity.sh` sigue siendo el mecanismo correcto
    porque ya es el gate L0 invocado en AFTER EDIT, commit y CI. AÃ±adir al inicio, **antes de ejecutar
    `sync-context.ts` u otro cÃ³digo con Bun**, un chequeo fail-fast que: (a) parsea y valida
    `packageManager`; (b) resuelve el binario Bun sin red; (c) compara `bun --version` con el pin; y
    (d) sale no-cero ante ausencia, formato no exacto o mismatch. Debe ser rÃ¡pido, determinista, sin
    red y sin escrituras. Probar camino positivo y mismatch mediante un shim temporal fuera del repo;
    el mismatch debe fallar antes de cualquier efecto lateral. No crear agente, skill, segunda fuente
    ni verificador LLM.
  - **CI version + frozen-install strategy:** en ambos jobs quitar por completo
    `with: bun-version: latest` de `oven-sh/setup-bun@v2`; sin input, la Action lee primero
    `package.json#packageManager`. Inmediatamente despuÃ©s, derivar `expected` del manifest raÃ­z y
    exigir `bun --version == expected`; no confiar solo en la resoluciÃ³n implÃ­cita de la Action.
    Reemplazar **cada** `bun install` por `bun install --frozen-lockfile`: instalaciÃ³n matriz de raÃ­z,
    engine y web, mÃ¡s instalaciÃ³n cruzada de engine del job web. Este es el comando canÃ³nico para los
    tres Ã¡rboles: Bun documenta que `bun ci` es equivalente, pero se conserva la forma explÃ­cita ya
    adoptada por Docker, Task 3 y la Harness Matrix; no se mezclan ambas grafÃ­as arbitrariamente.
    Fuentes oficiales: https://github.com/oven-sh/setup-bun (resoluciÃ³n de `packageManager`) y
    https://bun.sh/docs/pm/cli/install#ci-cd (`bun ci` = `bun install --frozen-lockfile`).
  - **Docker / Railway strategy:** el Ãºnico `Dockerfile` estÃ¡ en contexto raÃ­z y parte de
    `node:22-bookworm-slim`; por tanto `node` existe antes de instalar Bun, y el mismo stage ya instala
    `bash`, `curl`, `ca-certificates` y `unzip`. Copiar `package.json` raÃ­z temprano; usar `node` para
    extraer/validar `packageManager` y pasar el tag derivado `bun-v<expected>` al instalador oficial
    Linux. En el mismo `RUN`, exigir `bun --version == expected`. No usar ARG externo generado por CI:
    Railway construye el Dockerfile directamente. Conservar `apps/engine` en
    `bun install --frozen-lockfile` y el contrato web de producciÃ³n en `package-lock.json` + `npm ci`;
    Task 31 no migra producciÃ³n web a Bun. La imagen es single-stage, asÃ­ que el binario verificado es
    el del runtime final; ademÃ¡s construir una imagen de smoke y comparar
    `docker run --rm --entrypoint bun <imagen> --version` contra el mismo valor leÃ­do del manifest.
  - **Three-lockfile frozen validation (Bun 1.4.2):** usar una sola familia de comando,
    `bun install --frozen-lockfile --dry-run`, desde cada Ã¡rbol, y registrar exit code + salida:

    | Ãrbol | Manifest | Lockfile Bun actual | Contrato a demostrar |
    |---|---|---|---|
    | raÃ­z | `package.json` | `bun.lock` v2 / config v1 | parseable, manifestâ†”lock coherente, frozen, no churn |
    | engine | `apps/engine/package.json` | `apps/engine/bun.lock` v1 / config v1 | v1 consumible sin migrarlo, frozen, no churn |
    | web | `apps/web/package.json` | `apps/web/bun.lock` v2 / config v0 | v2 consumible sin migrarlo ni restaurar localmente Task 3 |

    Comparar SHA-256 y `git diff --exit-code` antes/despuÃ©s. `apps/web/package-lock.json` sigue siendo
    read-only y canÃ³nico para el `npm ci` del Dockerfile; no sustituye la validaciÃ³n del Bun lock que
    CI y Task 3 consumen. Cualquier propuesta de cambio de formato/config/paquetes es churn y activa
    STOP/REPLAN, aunque el comando salga 0.
  - **Completion boundary:** esta task termina cuando Toolchain Truth queda demostrada: pin Ãºnico;
    runtime local alineado; guard determinista; CI derivada con installs frozen; tres lockfiles
    frozen-valid sin churn; y Docker construido/smokeado con la versiÃ³n derivada. La revalidaciÃ³n de
    suites y la migraciÃ³n de evidencia TSK-098 pertenecen exclusivamente a Task 32. El STOP previo por
    cambio semÃ¡ntico se conserva en el artefacto histÃ³rico y no obliga a revertir trabajo vÃ¡lido.
  - **Runtime version verification:** LOCAL registra pre/post y compara contra el manifest; CI compara
    tras cada `setup-bun`; Docker compara durante el build y de nuevo mediante `docker run` sobre la
    imagen producida. Las tres comparaciones leen el mismo `packageManager` y fallan ante divergencia.
  - **Write scope (repo):** Ãºnicamente `package.json` raÃ­z, `.github/workflows/ci.yml`, el Ãºnico
    `Dockerfile`, `scripts/verify-simplicity.sh` y el artefacto existente
    `docs/agents/r0-discovery/task-31-canonical-bun-toolchain-truth.md`. No se anticipa un test persistente nuevo: la prueba positiva y
    negativa del guard se registra en el artefacto con un shim temporal fuera del repo. **MutaciÃ³n de
    entorno autorizada por la tarea:** solo alinear el binario Bun local al pin y crear/eliminar imagen
    de smoke Docker; no instalar/restaurar `apps/web/node_modules` como objetivo.
  - **Protected / DO NOT CHANGE:** no modificar lÃ³gica de producto, tests para hacerlos pasar, Golden
    Dataset, eval baselines, curated data, scoring weights, manifests de apps, lockfiles Bun/npm,
    `apps/engine/src/server/app.test.ts` ni ningÃºn test funcional. El cambio de runtime no autoriza
    adaptar producto/evidencia ni migrar lockfiles para conseguir verde.
  - **Verification / acceptance criteria:** verificar el diff parcial existente sin reaplicarlo;
    confirmar pin Ãºnico â†’ local exacto + guard positivo/negativo â†’ CI derivada/frozen â†’ tres dry-runs
    frozen + hashes sin churn â†’ Docker build + smoke de runtime. Registrar comandos, versiones,
    hashes y exit codes. PASS exige Bun 1.4.2 efectivo en LOCAL/CI/DOCKER, locks v2/v1/v2 intactos y
    ninguna ediciÃ³n de tests/producto. Task 32 y Task 3 permanecen sin ejecutar.
  - **Failure / STOP conditions:** **STOP â†’ clasificar A/B/C/D â†’ REPLAN/HUMAN**, sin reparaciÃ³n dentro
    de Task 31, si ocurre cualquiera: Bun 1.4.2 no consume alguno de los tres locks; frozen validation
    genera/propone churn o requiere migraciÃ³n; Docker no puede derivar el pin sin una segunda fuente
    manual; versiÃ³n efectiva local/CI/Docker diverge; CI conserva una instalaciÃ³n no-frozen; o harÃ­a
    falta modificar product code, manifests de apps, tests/evidencia aceptada, comentarios o
    lockfiles. Un cambio de compatibilidad runtime se deriva a Task 32; no se arregla aquÃ­.
  - **Downstream boundary:** Task 32 permanece bloqueada hasta PASS completo de Task 31; Task 3
    permanece bloqueada transitivamente hasta PASS de 32. Task 31 no aÃ±ade paquetes, no edita
    `apps/web/package.json`/locks, no restaura `apps/web/node_modules`, no arregla tests web y no corre
    ninguna suite funcional.
  - **Risk level:** medio (cambia el runtime que interpreta tests y tooling, no el producto).
  - **Approval required?** No; no incluye deploy, promociÃ³n, migraciÃ³n ni acciÃ³n irreversible.
  - _Requirements: 1.1, 4.1, T.1, T.2_

- [x] 32. [R0.1] Canonical Bun Runtime Compatibility / TSK-098 Evidence Migration
  - **Workstream:** R0.1 Environment Truth (owner de `TSK098_RUNTIME_SEMANTICS_CHANGED`).
  - **Classification:** **C â€” tooling/runtime compatibility**. Task 17 fue correcta bajo Bun 1.3.14;
    el cambio del runtime canÃ³nico a 1.4.2 invalidÃ³ la premisa tÃ©cnica de su workaround test-only. No
    es clase A/producto ni clase B/spec, y no reescribe la validez histÃ³rica.
  - **Dependencies:** 31 (Canonical Bun Toolchain Truth GREEN).
  - **Preconditions:** Bun 1.4.2 es el runtime canÃ³nico efectivo; Task 31 cerrÃ³ LOCAL/CI/DOCKER,
    frozen validation y cero churn; el diff de Task 17 y su evidencia histÃ³rica permanecen intactos.
  - **Objetivo:** migrar exclusivamente el test harness/evidencia aceptada de TSK-098 desde el contrato
    histÃ³rico de Bun 1.3.14 al contrato observado de Bun 1.4.2, sin cambiar comportamiento de producto.
    La historia se preserva en `docs/agents/r0-discovery/task-31-canonical-bun-toolchain-truth.md` y en
    el artefacto de esta task; los comentarios del test describen Ãºnicamente el runtime canÃ³nico actual.
  - **Expected observable output:** tras confirmar nuevamente la semÃ¡ntica 1.4.2, el teardown de
    `cuentas HTTP multi-tenant (TSK-098)` vuelve a esperar/retornar correctamente la Promise vÃ¡lida de
    `server.stop(true)`; el workaround especÃ­fico 1.3.14 y los comentarios ya falsos se retiran; el
    candado de regresiÃ³n protege el cleanup actual; producto permanece byte-for-byte fuera del diff.
  - **Phase 1 â€” bounded semantic re-measurement (antes de editar):** ejecutar 3 veces una sonda
    aislada del escenario server-side WS close 1008, con supervisor externo de 15 s, esperas de
    apertura/cierre/listener de 2 s y carrera de `server.stop(true)` de 1 s. Registrar separadamente:
    cliente llegÃ³ a `CLOSED`, close code, `server.pendingWebSockets`, Promise `RESOLVED|PENDING` y
    listener cerrado. Las tres corridas deben coincidir en `CLOSED=true`, code 1008,
    `pendingWebSockets=0`, Promise `RESOLVED` dentro del lÃ­mite y listener cerrado. Si una difiere,
    **STOP por inconsistencia/flakiness**; no editar el harness.
  - **Phase 2 â€” test-harness migration (solo si Phase 1 confirma):** inspeccionar el diff real de Task
    17 y aplicar el cambio mÃ­nimo justificado. Resultado esperado, sin prescribir sintaxis exacta:
    restaurar cleanup awaitable/returned en `afterAll`; dejar de descartar una Promise que ahora se
    asienta; actualizar/eliminar comentarios especÃ­ficos del bug 1.3.14; y reemplazar/ajustar el test
    cuyo tÃ­tulo/premisa afirma que la Promise queda pendiente. No borrar ni reescribir la evidencia
    histÃ³rica documental. No inventar una regresiÃ³n artificial para obtener RED: la evidencia
    aceptada 1.3.14 + la sonda 1.4.2 constituyen el before/after de migraciÃ³n de plataforma.
  - **Regression contract under Bun 1.4.2:** el test permanente debe proteger observables Ãºtiles y
    pÃºblicos: cierre iniciado por servidor â†’ cliente `CLOSED` con code 1008 â†’ `server.stop(true)` se
    asienta dentro de un lÃ­mite explÃ­cito â†’ listener queda cerrado â†’ el cleanup hook termina. Medir y
    registrar `pendingWebSockets=0` en la evidencia de Phase 1, pero no congelar necesariamente ese
    contador interno en el candado permanente si settlement+listener+hook ya demuestran liberaciÃ³n;
    incluirlo como assert solo si la implementaciÃ³n mÃ­nima demuestra que aporta diagnÃ³stico estable
    sin acoplar el test a internals de Bun.
  - **Write scope:** por defecto, Ãºnicamente `apps/engine/src/server/app.test.ts` y un artefacto nuevo
    `docs/agents/r0-discovery/task-32-bun-runtime-compatibility.md`. Cualquier helper/test adicional
    requiere demostrar que es estrictamente test-only y ampliar primero este contrato mediante
    REPLAN; product code nunca entra en scope. Task 31 implementation, manifests, CI, Docker, guards,
    lockfiles, datasets y baselines son read-only.
  - **Verification (Bun 1.4.2, en orden):**
    1. test/candado TSK-098 dirigido y tests de servidor afectados;
    2. `apps/engine/src/server/app.test.ts` completo;
    3. suite completa `apps/engine`, baseline histÃ³rico aceptado 618 pass / 0 fail;
    4. TypeScript de `apps/engine`;
    5. candados de Task 2 (`apps/engine/src/pipeline/run-pipeline.test.ts` y
       `scripts/eval/benchmark-pro-agreement.test.ts`) y Task 4
       (`scripts/hooks/hook-path-normalization.test.ts`);
    6. suite completa `scripts`, baseline histÃ³rico aceptado 181 pass / 0 fail.
    Registrar comandos, versiÃ³n Bun, conteos, exit codes y diff final. No ejecutar suite web ni Task 3.
  - **Acceptance criteria:** Phase 1 fue consistente 3/3; el diff es test-only; cleanup retorna/espera
    la Promise bajo 1.4.2; el regression contract actual pasa sin depender de una afirmaciÃ³n falsa;
    engine 618/0, scripts 181/0 y TypeScript estÃ¡n verdes; candados Tasks 2/4/17 revalidados; historia
    1.3.14 preservada; cero cambios de producto/toolchain/locks.
  - **Failure / STOP conditions:** STOP/REPLAN si la sonda es inconsistente o excede timeout; la
    semÃ¡ntica 1.4.2 vuelve a mostrar `pendingWebSockets=1` o Promise pendiente; aparece una regresiÃ³n
    de producto; el cleanup correcto exige product code; hay que editar tests ajenos para mantener
    GREEN; cambian conteos/baselines sin explicaciÃ³n de tests ya aceptados; o el fix requiere ampliar
    write scope fuera de test/evidencia. Nunca adaptar producto ni relajar assertions automÃ¡ticamente.
  - **Downstream boundary:** Task 3 permanece BLOCKED hasta PASS de 31 y 32; Task 32 no instala ni
    gestiona dependencias web. Task 5 permanece bloqueada transitivamente por Task 3.
  - **Risk level:** medio (migra un contrato de teardown/concurrencia del test harness, no producto).
  - **Approval required?** No; cambio reversible y test-only. Cualquier necesidad de producto activa
    STOP/REPLAN.
  - _Requirements: 1.1, T.1, T.2_

### R0.2A â€” Evaluation Instrument Recovery

- [x] 7. [R0.2A] Discovery: ubicaciÃ³n/disponibilidad de `pro-drafts.sqlite`
  - **Workstream:** R0.2A Evaluation Instrument Recovery (discovery, read-only salvo el artefacto de evidencia).
  - **Dependencies:** ninguna.
  - **Preconditions:** ninguna.
  - **Objetivo:** determinar dÃ³nde vive `pro-drafts.sqlite` (gitignored, ausente del Ã¡rbol; 2179
    drafts ingeridos) y si estÃ¡ disponible para el sub-check de Pro Agreement / Benchmark B, sin
    inventar la respuesta (diseÃ±o Â§9.3).
  - **Expected observable output:** reporte de evidencia (p.ej.
    `docs/agents/r0-discovery/pro-drafts-db.md`) que indica ubicaciÃ³n real / ausencia y quÃ© desbloquea
    (SOLO el sub-check Pro Agreement / Benchmark B en tareas 8 y 13); Engine Quality / Benchmark A no
    depende de este archivo.
  - **Write scope:** `docs/agents/r0-discovery/pro-drafts-db.md` (solo evidencia). Read-only sobre el
    resto.
  - **Protected / DO NOT CHANGE:** no mueve ni recrea el archivo; solo reporta.
  - **Implementation notes:** diseÃ±o Â§9.3; requisito 2A.1 Preconditions.
  - **Verification:** el reporte existe y responde Â§9.3 o marca la ausencia explÃ­citamente.
  - **Acceptance criteria:** ubicaciÃ³n/ausencia confirmada; el bloqueo del sub-check Benchmark B queda
    documentado.
  - **Failure / stop conditions:** si no se puede localizar, se reporta ausente y el sub-check Pro
    Agreement queda `SKIPPED` bajo enforce (nunca PASS).
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 2A.1, 2B.1_

- [x] 8. [R0.2A] Gate que falla fuerte + `GateStatus` de 4 estados + clase por sub-check
  - **Workstream:** R0.2A Evaluation Instrument Recovery.
  - **Dependencies:** 7 (discovery de `pro-drafts.sqlite`, solo para el sub-check Pro Agreement).
  - **Preconditions:** discovery Â§9.3 resuelto para clasificar/ejecutar el sub-check Benchmark B;
    Engine Quality / Benchmark A avanza sin Ã©l.
  - **Objetivo:** reemplazar el binario PASS/FAIL de `scripts/eval/gate.ts` por
    `GateStatus âˆˆ {PASS, FAIL, SKIPPED, BLOCKED}`; devolver `SKIPPED` (exit != 0 en enforce) si el
    Golden Dataset estÃ¡ vacÃ­o o si `pro-drafts.sqlite` estÃ¡ ausente, y `BLOCKED` (exit != 0 en
    enforce) si el `ReferenceBaseline` estÃ¡ ausente â€” nunca PASS; asignar a CADA sub-check su clase
    `required | optional | informational` (el default NO es "todo required"), con Professional Pick
    Agreement / Benchmark B como `optional`/`informational` por ADR-002 y Engine Quality / Benchmark A
    como `required`; y hacer que un `required` en SKIPPED/BLOCKED bloquee mientras un
    `optional`/`informational` en esos estados solo se reporte.
  - **Expected observable output:** con dataset vacÃ­o â‡’ `SKIPPED` + exit != 0 en enforce; baseline
    ausente â‡’ `BLOCKED` + exit != 0; sub-check `optional` skipped â‡’ se reporta sin bloquear.
  - **Write scope:** `scripts/eval/gate.ts` (envoltura de polÃ­tica y clasificaciÃ³n por sub-check). NO
    toca `evaluateGate()`.
  - **Protected / DO NOT CHANGE:** `evaluateGate()` (NDCG@5 / BadPickRate / Agreement) intacto; no se
    inventan mÃ©tricas nuevas ni se rediseÃ±an benchmarks de Fase 9 (regla (a), diseÃ±o Â§7). Candado de
    regresiÃ³n en rojo (CP1).
  - **Implementation notes:** diseÃ±o Â§4.2 LLD (`GateStatus`, `runMandatoryGate` pseudocÃ³digo,
    inconsistencias #1â€“#2), Â§5 clase por nivel; requisito 2A.1 c1â€“c7. La validaciÃ³n de calidad del
    veredicto se apoya en INTELLIGENCE CI (tarea 20).
  - **Verification:** TASK COMPLETION â€” test de tabla sobre estados (dataset vacÃ­o, baseline ausente,
    pro-db ausente) verificando `status` y exit code por clase de sub-check.
  - **Acceptance criteria:** ningÃºn estado no-ejecutado devuelve PASS; cada sub-check declara su clase;
    solo `required` SKIPPED/BLOCKED bloquea (CP1 / Property 1 verde).
  - **Failure / stop conditions:** si reparar la envoltura exige tocar `evaluateGate()` â‡’ STOP
    (violarÃ­a Â§7); reclasificar como clase B y REPLAN. Circuit-breaker (b).
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 2A.1_

- [x] 9. [R0.2A] Modelo de baseline comparable (`EvaluationIdentity` + `isComparable`, sin binding por hash)
  - **Workstream:** R0.2A Evaluation Instrument Recovery.
  - **Dependencies:** 8 (envoltura de polÃ­tica del gate).
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** modelar explÃ­citamente `referenceBaseline`, `candidate`, `datasetVersion`,
    `evaluationProtocolVersion` y `scoringModelFamily`; comparar un candidate contra el
    `ReferenceBaseline` **aceptado** (no contra sÃ­ mismo); devolver `BLOCKED` con motivo "baseline
    incomparable: dataset/protocol mismatch" cuando `isComparable` es falso; determinar la
    comparabilidad por compatibilidad de dataset + protocolo (+ familia de scoring), **nunca** por
    diferencia de hash de commit.
  - **Expected observable output:** candidate con `datasetVersion`/`evaluationProtocolVersion`
    distinto â‡’ `BLOCKED` "baseline incomparable"; candidate comparable â‡’ evalÃºa contra el reference
    baseline aceptado; el binding por `engineSourceHash == HEAD` queda retirado.
  - **Write scope:** `scripts/eval/gate.ts` y los tipos de baseline/identidad en `scripts/eval/`. NO
    modifica los baselines aceptados en `eval/baselines/*`.
  - **Protected / DO NOT CHANGE:** `scoringModelFamily` (p.ej. `SCORING_WEIGHTS_V6`) es una constante
    de pesos activa, no un hash de HEAD; no se rediseÃ±an mÃ©tricas ni benchmarks; no se editan baselines
    aceptados (regla (a)).
  - **Implementation notes:** diseÃ±o Â§4.2 LLD (`EvaluationIdentity`, `ReferenceBaseline`, `Candidate`,
    `isComparable` pseudocÃ³digo, inconsistencia #4); requisito 2A.2. CP8 (parte compatibilidad).
  - **Verification:** TASK COMPLETION â€” test: candidate dataset/protocol distinto â‡’ BLOCKED por
    mismatch (no por hash).
  - **Acceptance criteria:** el gate compara contra el baseline aceptado; mismatch â‡’ BLOCKED con el
    motivo exacto; la comparabilidad nunca se decide por hash de commit (CP8 parte A verde).
  - **Failure / stop conditions:** si un baseline aceptado resultara incomparable por dato mal
    congelado â‡’ clase D (datos/evaluaciÃ³n) â†’ resolver precondiciÃ³n, no editar el baseline a ciegas.
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 2A.2_

- [x] 10. [R0.2A] Cablear `--enforce` al nivel INTELLIGENCE CI
  - **Workstream:** R0.2A Evaluation Instrument Recovery.
  - **Dependencies:** 8, 9.
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** cablear la ejecuciÃ³n de `Evaluation_Gate --enforce` al nivel INTELLIGENCE CI (donde
    vive el eval pesado), de modo que produzca exit != 0 ante `FAIL`/`SKIPPED`/`BLOCKED` de un
    sub-check `required`, y reporte sin forzar exit != 0 los `optional`/`informational` en esos
    estados; el eval pesado NO corre en pre-push (a lo sumo un sanity pequeÃ±o).
  - **Expected observable output:** un job/definiciÃ³n de INTELLIGENCE CI ejecuta `gate.ts --enforce`;
    pre-push queda sin el eval pesado.
  - **Write scope:** configuraciÃ³n de CI (workflow de INTELLIGENCE CI) y, si aplica, script de
    invocaciÃ³n del gate en enforce. NO aÃ±ade el eval pesado a `.husky/pre-push`.
  - **Protected / DO NOT CHANGE:** el eval pesado fuera de pre-push (diseÃ±o Â§5); no se rediseÃ±a la
    mÃ©trica.
  - **Implementation notes:** diseÃ±o Â§3.2 / Â§5, Â§4.4 filosofÃ­a de hooks; requisito 2A.3.
  - **Verification:** TASK COMPLETION â€” la definiciÃ³n de CI muestra `--enforce` en INTELLIGENCE CI y
    ausencia del eval pesado en pre-push.
  - **Acceptance criteria:** `--enforce` corre en INTELLIGENCE CI con la polÃ­tica de exit code por
    clase de sub-check; pre-push no ejecuta el eval pesado.
  - **Failure / stop conditions:** si INTELLIGENCE CI no puede ejecutar el eval por dato ausente â‡’
    reporta SKIPPED/BLOCKED segÃºn clase (no PASS).
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 2A.3, T.2_

### R0.3 â€” Engine Truth

_(Toda tarea R0.3 que altera la salida visible del producto indica que su validaciÃ³n de calidad ocurre
en R0.2B / INTELLIGENCE CI, no en la propia tarea. No se reescribe el motor, no se agregan seÃ±ales, no
hay lookahead, no se rediseÃ±a `DraftState`, no se toca `SCORING_WEIGHTS_V6`.)_

- [x] 11. [R0.3] Structural applicability desacoplada de la calibraciÃ³n (`A(S)`)
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** 8, 9 (instrumento R0.2A restaurado, para poder medir el candidate despuÃ©s).
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** calcular `structurallyApplicableSignals` (`A(S)`) dependiendo SOLO de la estructura
    del estado del draft, nunca de la calibraciÃ³n ni de la presencia de datos; retirar el acoplamiento
    accidental `if (calibration.signals.patch_meta) available.add("patch_meta")` de forma que
    `patch_meta` sea estructuralmente aplicable siempre y su participaciÃ³n real la decida `dataReady`.
  - **Expected observable output:** `A(S)` no consulta `calibration.signals.*`; `patch_meta` aparece
    en `A(S)` por estructura, no por calibraciÃ³n.
  - **Write scope:** `apps/engine/src/signals/mix.ts` (`availableSignals` â†’ `structurallyApplicableSignals`).
  - **Protected / DO NOT CHANGE:** la calibraciÃ³n es transformaciÃ³n de normalizaciÃ³n, nunca
    interruptor de disponibilidad; no se agregan seÃ±ales; `SCORING_WEIGHTS_V6` intacta (regla (a),
    diseÃ±o Â§7).
  - **Implementation notes:** diseÃ±o Â§4.3 estado actual #1, LLD (a) `structurallyApplicableSignals`;
    requisito 3.2 c1.
  - **Verification:** TASK COMPLETION â€” test determinista (harness/PRNG existente) de que `A(S)` no
    depende de calibraciÃ³n; validaciÃ³n de calidad de salida en R0.2B (tarea 19).
  - **Acceptance criteria:** `A(S)` estructural puro; acoplamiento a `calibration.signals.patch_meta`
    retirado (parte de CP3 / Property 3).
  - **Failure / stop conditions:** si desacoplar cambia la salida mÃ¡s allÃ¡ de lo esperado â‡’ medir en
    R0.2B antes de promover (T.4); no promover sin eval verde.
  - **Risk level:** medio (altera mecanismo que afecta salida visible).
  - **Approval required?** No (la promociÃ³n del candidate sÃ­ â€” tarea 19/T.4).
  - _Requirements: 3.2_

- [x] 12. [R0.3] Data readiness por seÃ±al + contrato exacto de `patch_meta` (sin encenderla)
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** 11.
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** evaluar `dataReady` por seÃ±al como flag explÃ­cito y verificable (independiente de
    structural applicability y de calibraciÃ³n); definir `votes == (structurallyApplicable AND
    dataReady)`; fijar el contrato R0 EXACTO de `patch_meta` (`structurallyApplicable=true`,
    `dataReady=false`, `raw=null` aceptable, `votes=false`, `weighted=0`,
    `nonVotingReason="data_not_ready"`) SIN encender `patch_meta` ni ninguna seÃ±al con
    `dataReady=false`; tratar `raw` como ortogonal a `votes` (nunca inferir no-participaciÃ³n de
    `raw:null`), y para `votes=false` fijar `weighted=0` y `nonVotingReason âˆˆ {"data_not_ready",
    "not_structurally_applicable"}`.
  - **Expected observable output:** `patch_meta` con `weighted==0`, `votes==false`,
    `nonVotingReason=="data_not_ready"`; salida observable de producciÃ³n idÃ©ntica a pre-R0
    (`raw=null weighted=0.00`); una seÃ±al `raw=null` puede tener `votes=true` o `false`.
  - **Write scope:** `apps/engine/src/signals/mix.ts` (`dataReady`, `votingSignals`, campos por seÃ±al).
  - **Protected / DO NOT CHANGE:** R0 NO enciende `patch_meta`; la activaciÃ³n real es fase posterior;
    no se rediseÃ±a `DraftState`; `raw:null` es sagrado (`invariantes.md`, regla (a)).
  - **Implementation notes:** diseÃ±o Â§4.3 estado objetivo, LLD (a) `dataReady`/`votingSignals`, tabla
    de campos; requisitos 3.2 c2â€“c5, 3.3 (contrato exacto). CP3 / CP3b / Property 3 / Property 11.
  - **Verification:** TASK COMPLETION â€” tests deterministas: `votes == (structurallyApplicable AND
    dataReady)`; `patch_meta` con `dataReady=false` â‡’ `weighted==0` + `nonVotingReason` y producciÃ³n
    idÃ©ntica a pre-R0. Candado de regresiÃ³n (c). Calidad de salida validada en R0.2B (tarea 19).
  - **Acceptance criteria:** CP3 y CP3b/Property 11 verdes; contrato exacto de `patch_meta` cumplido;
    ninguna seÃ±al con `dataReady=false` vota.
  - **Failure / stop conditions:** si la producciÃ³n de `patch_meta` difiere de pre-R0 â‡’ STOP (no
    encender por accidente), clasificar y REPLAN. Circuit-breaker (b).
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 3.2, 3.3_

- [x] 13. [R0.3] CÃ¡lculo Ãºnico: score/reason/comparison/evidence de una sola fuente
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** 12.
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** derivar `score`, `reason`, `comparison` y `evidence` de una sola estructura
    `StateWeightedContribution`, retirando `weightedContributions` legacy del camino activo; computar
    `comparison.delta` como diferencia de contribuciones `weighted` reales sobre seÃ±ales comparables
    en ambos candidatos (no un cÃ¡lculo paralelo); garantizar `Î£ contribution.weighted == score` en
    TODOS los caminos, incluido `teamOpening`; y garantizar que toda seÃ±al citada en `reason` o
    `comparison` tiene `weighted > 0` en el score.
  - **Expected observable output:** `reason`/`comparison`/`evidence` derivan de `candidate.contributions`;
    `weightedContributions` legacy fuera del camino activo; `Î£ weighted == score` incluido `teamOpening`;
    ninguna seÃ±al con `weighted==0` (p.ej. `patch_meta`) aparece citada.
  - **Write scope:** `apps/engine/src/signals/mix.ts` (`buildDerivedExplanations`, `buildComparison`,
    `buildReason`, camino `teamOpening`, `StateWeightedContribution`, `ScoredCandidate`).
  - **Protected / DO NOT CHANGE:** no se agregan seÃ±ales; no se reabre Fase 3; `SCORING_WEIGHTS_V6`
    intacta; `evaluateGate()` intacto (regla (a), Â§7). Candados de regresiÃ³n cero CP2/CP10 en rojo
    antes del fix (c). **CP5 (verificaciÃ³n absorbida):** el candado existente en `mix.test.ts` que
    verifica `Î£ SCORING_WEIGHTS_V6 == 1.0` para la versiÃ³n activa DEBE seguir en verde tras este
    cambio (candado a mantener, no a reescribir; tambiÃ©n vigilado en las tareas 11/12 y agregado en el
    Checkpoint 18) â€” preservarlo es verificaciÃ³n, no implementaciÃ³n.
  - **Implementation notes:** diseÃ±o Â§4.3 estado actual #3â€“#4, Data Models (b)
    `buildDerivedExplanations`; requisito 3.1 c1â€“c4 (y 3.6/CP5 como candado de verificaciÃ³n a
    preservar). CP2/CP4/CP5/CP10 / Property 2/4/5/10. ValidaciÃ³n de calidad en R0.2B (tarea 19).
  - **Verification:** TASK COMPLETION â€” tests deterministas (harness/PRNG existente): `comparison.delta`
    = diferencia de `weighted` reales; `Î£ weighted == score` en modo normal y `teamOpening`; assertion
    de seÃ±al citada â‡’ `weighted>0`; y **el candado CP5 `Î£ SCORING_WEIGHTS_V6 == 1.0` permanece en
    verde** (verificaciÃ³n absorbida de la antigua tarea 17, no implementaciÃ³n nueva; `weights.ts` NO se
    toca).
  - **Acceptance criteria:** CP2, CP4, CP5 y CP10 (Property 2/4/5/10) verdes; fuente Ãºnica confirmada;
    legacy retirado del camino activo; el candado de suma de pesos de la versiÃ³n activa intacto.
  - **Failure / stop conditions:** si un candado de regresiÃ³n no falla primero en rojo â‡’ regla (c) no
    cumplida, rehacer el candado antes del fix.
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 3.1_

- [x] 14. [R0.3] Estado degenerado: contrato Ãºnico sin ranking fingido
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** 12, 13.
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** cuando `votingSignals(...).size === 0` (o la forma exacta ya usada por el contrato), devolver `suggestions === []`, incluir exactamente `"no_signal_available"` en `degraded` y exponer `decisionContext === "no_signal_available"`. Es el contrato ÃšNICO de R0, sin la alternativa "confianza baja". El consumidor muestra `"No hay seÃ±ales disponibles para votar"` sin inferir el estado desde score, string o array ambiguo. NO ordenar candidatos por `Object.keys(meta.heroes)`.
  - **Expected observable output:** cuando el conjunto `voting` estÃ¡ vacÃ­o (incluido el caso con seÃ±ales estructuralmente aplicables pero `dataReady=false`) â‡’ `suggestions === []`, `degraded` incluye exactamente `"no_signal_available"` y `decisionContext === "no_signal_available"`; el orden nunca lo decide `Object.keys`.
  - **Write scope:** producciÃ³n Ãºnicamente en `apps/engine/src/signals/mix.ts` (detectar el predicado canÃ³nico y devolver el contrato sin ranking), `apps/engine/src/drafter/decision-context.ts` (nuevo miembro cerrado `"no_signal_available"`), `apps/web/features/draft/types.ts` (espejo atÃ³mico del wire type), `apps/web/features/draft/validation.ts` (aceptar los literales exactos en el boundary HTTP/WebSocket), `apps/web/features/draft/constants.tsx` (label mÃ­nimo) y `apps/web/features/random-draft-simulator/components/CopilotPanel.tsx` (mapa exhaustivo de `decisionContext`). Tests Ãºnicamente en `apps/engine/src/signals/mix.test.ts`, `apps/engine/src/drafter/decision-context.test.ts`, `apps/engine/src/server/app.test.ts`, `apps/web/features/draft/validation.test.ts`, `apps/web/features/draft/engine-wire-contract.test.ts` y `apps/web/features/random-draft-simulator/components/CopilotPanel.test.tsx`.
  - **Protected / DO NOT CHANGE:** no se finge un top-1 con score 0; `decisionContext` NO debe afirmar "no hay seÃ±ales estructuralmente aplicables" (el degenerado tambiÃ©n ocurre con `dataReady=false`); no score neutral, fallback por hero-id, orden arbitrario ni preferencia sintÃ©tica. No crear `AvailableSignalsReport`, no cambiar scoring, readiness, applicability, schema de API ni UI de observabilidad detallada: eso pertenece a la tarea 16.
  - **Implementation notes:** diseÃ±o Â§4.3 estado actual #5, Data Models (c) `guardDegenerateState`; requisito 3.4. CP7 / Property 7. La tarea 14 expone que no existe ranking vÃ¡lido; la tarea 16 expone quÃ© seÃ±ales, applicability y readiness provocaron ese estado.
  - **Verification:** TASK COMPLETION â€” verificar: (a) `voting.size === 0` â‡’ contrato degenerado; (b) `suggestions === []`; (c) `degraded` contiene `"no_signal_available"`; (d) `decisionContext === "no_signal_available"`; (e) el payload de engine pasa el validator web y los espejos engine/web siguen compatibles; (f) labels y switches son exhaustivos; (g) la primera seÃ±al legÃ­tima que vota sale del degenerado y recupera el ranking normal; (h) functional tests that inspect a concrete signal prepare a non-degenerate state and do not depend on fake suggestions without voting signals; (i) the original set_intent semantics remain intact, including explicit applicable:false after clearing; (j) rankings validos preexistentes conservan hero order y scores; (k) regresiones de tareas 11/12/13, suite completa de `apps/engine`, suite completa de `apps/web` y TypeScript de engine y web en verde. CP7 verde. ValidaciÃ³n de calidad en R0.2B (tarea 19).
  - **Acceptance criteria:** contrato Ãºnico de estado degenerado cumplido; `votingSignals(...).size === 0` es el predicado canÃ³nico; sin ranking fake ni orden por `Object.keys`; `suggestions === []`; `degraded` contiene exactamente `"no_signal_available"`; `decisionContext === "no_signal_available"`; el consumidor reconoce el estado estructurado y muestra `"No hay seÃ±ales disponibles para votar"`; al volver la primera seÃ±al votante recupera el ranking normal; en estados no degenerados se preservan order y scores; engine y web cambian atÃ³micamente (type mirror, validator, consumer exhaustiveness); `patch_meta` permanece `structurallyApplicable=true`, `dataReady=false`, `votes=false`; no se implementa `AvailableSignalsReport` (CP7 verde).
  - **Failure / stop conditions:** si aparece un top-1 con score 0 tratado como recomendaciÃ³n â‡’ FAIL, corregir en la causa.
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 3.4_
- [x] 15. [R0.3] `openingStrategy` respeta `raw: null`
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** ninguna dentro de R0.3 (independiente de 11â€“14; write scope aislado).
  - **Preconditions:** ninguna.
  - **Objetivo:** hacer que `openingStrategy` devuelva `null` para un hÃ©roe sin entrada en
    `capabilities.json` (nunca un valor fabricado como `"scaling"`), y derive la estrategia de la
    entrada cuando existe.
  - **Expected observable output:** hÃ©roe ausente en `capabilities.json` â‡’ `openingStrategy(hero) ==
    null`; hÃ©roe presente â‡’ estrategia derivada de su entrada.
  - **Write scope (normalizado tras la implementaciÃ³n real mÃ­nima):**
    - `apps/engine/src/draft-paths/strategy.ts` (+ `strategy.test.ts`) â€” contrato de
      `openingStrategy(hero, capabilities): DraftPathArchetype | null`: hÃ©roe sin entrada en
      `capabilities.json` â‡’ `null`; entrada real cuyas capacidades son todas bajas â‡’ `"scaling"`
      derivado legÃ­timamente.
    - PropagaciÃ³n de tipo `null` mecÃ¡nicamente requerida aguas abajo, con sus tests directos:
      `apps/engine/src/pipeline/feature-extractor.ts` (+ `feature-extractor.test.ts`),
      `apps/engine/src/pipeline/run-pipeline.ts` (+ `run-pipeline.test.ts`).
    - `apps/engine/src/drafter/team-opener.ts` (+ `team-opener.test.ts`) â€” fix de compatibilidad del
      bucket LOCAL de diversidad de `recommendTeamOpeners`: `null` se consulta como
      `strategy ?? "scaling"` en las DOS operaciones del desempate (construir `usedStrategies` y
      consultarlo), replicando el fallback que `run-pipeline.ts` ya aplica. Preserva el ranking
      histÃ³rico pre-Task-15 en el caso mixto `null` + `"scaling"` real; candado de regresiÃ³n aÃ±adido.
    - NO modifica `capabilities.json` (dato curado) ni `apps/engine/src/signals/`.
  - **DistinciÃ³n explÃ­cita (no se redefine `null` como `"scaling"`):**
    - `openingStrategy` â‡’ `null` = verdad de evidencia / no hay observaciÃ³n. Es el valor observable y
      se propaga tal cual a `TeamOpenerCandidate.strategy` / `TeamOpenerOption.strategy`.
    - El fallback interno `strategy ?? "scaling"` de `run-pipeline.ts` y `team-opener.ts` es
      Ãºnicamente imputaciÃ³n LOCAL de scoring/ranking para el desempate por diversidad â€” nunca cambia
      el valor observable ni fabrica evidencia.
  - **Protected / DO NOT CHANGE:** `raw: null` es sagrado (`invariantes.md`); no se inventa capacidad;
    `capabilities.json` es dato curado protegido (regla (a)); `REPEAT_STRATEGY_PENALTY`, `baseScore`,
    orden/tie-breaking, `limit` y el resumen de `recommendTeamOpeners` no cambian.
  - **Implementation notes:** diseÃ±o Â§4.3 estado actual #6, Data Models (d) `openingStrategy`;
    requisito 3.5. CP9 / Property 9.
  - **Verification:** TASK COMPLETION â€” test: hÃ©roe ausente â‡’ null (CP9 verde); candado de regresiÃ³n
    del caso mixto `null` + `"scaling"` real en `team-opener.test.ts` (verificado en rojo antes del
    fix). Suite dirigida (`strategy` / `feature-extractor` / `team-opener` / `run-pipeline`),
    `bun test apps/engine` y `bunx tsc --noEmit` de `apps/engine` en verde.
  - **Acceptance criteria:** CP9 (Property 9) verde; ningÃºn valor fabricado en el camino de apertura.
  - **Failure / stop conditions:** si respetar `null` rompe un consumidor aguas abajo â‡’ clasificar
    (A/B) y resolver en la causa; no reintroducir el valor fabricado.
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 3.5_

- [x] 16. [R0.3] Observabilidad: `AvailableSignalsReport` por decisiÃ³n
  - **Workstream:** R0.3 Engine Truth.
  - **Dependencies:** 12, 13, 14.
  - **Preconditions:** ninguna adicional.
  - **Objetivo:** producir un `AvailableSignalsReport` observable por decisiÃ³n que exponga, por seÃ±al,
    `structurallyApplicable`, `dataReady`, `calibrated`, `votes` y, cuando `votes=false`,
    `nonVotingReason`; mÃ¡s `voting[]` y el flag `degenerate`. Consumido por reportes de `bun run eval`,
    no renderizado en `apps/web`.
  - **Expected observable output:** el reporte distingue explÃ­citamente "no aplicable estructuralmente"
    de "aplicable pero `dataReady=false`" de "`raw:null`"; `patch_meta` en R0 aparece con `votes=false`
    y `nonVotingReason="data_not_ready"`.
  - **Write scope:** `apps/engine/src/signals/mix.ts` (o el mÃ³dulo de reporte del motor) para
    `SignalStatusReport` / `AvailableSignalsReport`; salida integrada al camino de reportes de eval.
  - **Protected / DO NOT CHANGE:** `calibrated` nunca decide participaciÃ³n; el reporte no se renderiza
    en `apps/web`; no se agregan seÃ±ales.
  - **Implementation notes:** diseÃ±o Â§4.3 Data Models (e) `AvailableSignalsReport`; requisito 3.2 c6.
    Cierra la evidencia de CP3/CP7: la tarea 14 ya expone que no existe ranking vÃ¡lido; esta tarea expone quÃ© seÃ±ales/applicability/readiness provocaron el estado.
  - **Verification:** TASK COMPLETION â€” test determinista de que el reporte expone los cinco campos por
    seÃ±al y `voting`/`degenerate`. ValidaciÃ³n de calidad en R0.2B (tarea 19).
  - **Acceptance criteria:** reporte reproducible que expone los tres estados por seÃ±al + `votes` +
    `nonVotingReason`; wired al camino de eval.
  - **Failure / stop conditions:** si el reporte infiere no-participaciÃ³n de `raw:null` â‡’ FAIL, regla
    de ortogonalidad; corregir.
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 3.2_

> **Nota (R0.3) â€” CP5 es verificaciÃ³n, no una tarea ejecutable.** Preservar y verificar en verde el
> candado existente `Î£ SCORING_WEIGHTS_V6 == 1.0` (CP5 / Property 5, requisito 3.6) NO es una tarea de
> implementaciÃ³n separada: no hay cÃ³digo de producto que escribir (`weights.ts` NO se toca y el candado
> ya existe en `apps/engine/src/signals/mix.test.ts`). La responsabilidad de CP5 vive en:
> - **Tarea 13** â€” su contrato de Verification exige que el candado CP5 permanezca en verde tras el
>   cÃ¡lculo Ãºnico; candado a mantener tambiÃ©n en las tareas 11/12 (cualquier cambio de R0.3 que lo rompa
>   es una regresiÃ³n de causa en 11â€“14, detectada por el candado).
> - **Checkpoint 18** â€” agrega CP5 entre los candados que deben estar verdes antes de evaluar el candidate.
>
> _Cobertura de requisito 3.6 / CP5:_ Tarea 13 (verificaciÃ³n) + Checkpoint 18 (agregaciÃ³n). El ID 17
> quedÃ³ reasignado a la tarea ejecutable de R0.1 (ownership del blocker TSK-098) â€” ver esa tarea 17
> arriba, en la secciÃ³n R0.1.

- [x] 18. Checkpoint â€” R0.1 + R0.2A + R0.3 verdes antes de evaluar el candidate
  - Ensure all tests pass, ask the user if questions arise.
  - **Workstream:** transversal (gate de progreso formal, no arregla nada).
  - **Dependencies:** 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, **17, 31, 32** (cierra R0.1 +
    R0.2A + R0.3). La dependencia directa en 31 exige Toolchain Truth; 32 exige la evidencia migrada
    bajo el runtime canÃ³nico; y 3 impide pasar mientras `apps/web` siga bloqueada. CP5
    (`Î£ SCORING_WEIGHTS_V6 == 1.0`) se agrega aquÃ­ como candado de verificaciÃ³n, no como
    dependencia de una task ejecutable (ver la nota de R0.3 sobre CP5). Se conserva **17** como ancla
    histÃ³rica aceptada de TSK-098; Task 32 es responsable de revalidar ese contrato bajo el runtime
    canÃ³nico. El checkpoint 18 no puede pasar sin ambas.
  - **Es dependencia formal de:** tareas 33, 34, 35 y 19 (18 → 33 → 34 → [HUMAN S1 CHECKPOINT] → 35 →
    19). El checkpoint es un nodo real del grafo con su propia posición, no una nota narrativa: R0.2B
    no repara el productor (33), no construye el S1 confiable (34), no rebasa el control V6 (35) ni
    evalúa (19) hasta que 18 está verde. Entre 33 y 34, el PO hace un checkpoint commit del estado R0
    aceptado — acción humana de trazabilidad. La generación real de S1 (tras aceptar el código/tests de
    la tarea 34) es un HUMAN OPERATIONAL CHECKPOINT explícito, no un nodo de implementación.
  - **Objetivo:** confirmar que las tres suites estÃ¡n verdes bajo `bun run test` y el mismo pin Bun
    exacto en Windows/CI (incluida la resoluciÃ³n histÃ³rica vÃ­a 17 y migraciÃ³n canÃ³nica vÃ­a 32), y que
    el instrumento de evaluaciÃ³n (R0.2A) y los cambios del motor (R0.3) estÃ¡n completos antes de medir
    el candidate.
  - **Verification:** Toolchain Truth 31 GREEN + Runtime Compatibility 32 GREEN + software correctness
    (`bun run test`) verde en Windows y CI con la misma versiÃ³n exacta â€” incluida la suite engine con
    TSK-098 resuelto y su evidencia migrada;
    CP2/CP3/CP5/CP6/CP7/CP9/CP10 verdes localmente (CP5 = candado
    `Î£ SCORING_WEIGHTS_V6 == 1.0`, verificaciÃ³n absorbida en la tarea 13 + este checkpoint).
  - **Risk level:** bajo.
  - **Approval required?** No.

### R0.2B â€” Candidate Evaluation / Promotion

- [x] 33. [R0.2B] Productor de eval corpus-opcional: `bun run eval` genera un candidate Benchmark-A-only sin `pro-drafts.sqlite`
  - **Workstream:** R0.2B Candidate Evaluation / Promotion.
  - **Responsabilidad (no mezclar con la tarea 19):** la tarea 33 repara el **PRODUCTOR** del
    candidate; la tarea 19 **EVALÚA** el candidate ya producido. Son contratos separados y no se
    fusionan.
  - **Dependencies:** 18 (checkpoint R0.1 + R0.2A + R0.3 verde — dependencia formal), 7 (discovery de
    `pro-drafts.sqlite`: ubicación/ausencia confirmada).
  - **Es dependencia formal de:** tarea 34 (33 → 34), tarea 19 (33 → … → 19) y tarea 30
    (certificación). R0.2B no construye el S1 confiable (34) hasta que 33 está en PASS y el PO hizo el
    checkpoint commit (acción humana, ver abajo).
  - **Preconditions:** el checkpoint 18 está verde; la tarea 7 confirmó dónde vive `pro-drafts.sqlite`
    o su ausencia.
  - **Objetivo:** la Spec ya afirma que Benchmark A / Engine Quality puede evaluar el candidate HEAD
    **sin** `pro-drafts.sqlite` (diseño §4.2, requisito 2B.1, §9.3). Hoy el productor canónico
    `scripts/eval/run.ts` **viola** ese contrato: abre `pro-drafts.sqlite` de forma incondicional y,
    cuando el archivo no existe, lanza `SQLITE_CANTOPEN` ⇒ **no se genera ningún candidate artifact**.
    La tarea 33 debe lograr que, con **Golden Dataset presente + `dota2coach.sqlite` presente +
    `pro-drafts.sqlite` AUSENTE**: `bun run eval` produzca un candidate **válido y comparable**;
    Benchmark A se mida **realmente**; Benchmark B quede **NO MEDIDO**; y el gate existente lo reporte
    como **SKIPPED informational** (sub-check `optional`/`informational` por ADR-002). NO fabricar
    corpus. NO fabricar métricas pro. NO convertir Benchmark B en PASS.
  - **Expected observable output:** sin `pro-drafts.sqlite`, `bun run eval` termina con exit 0 y
    escribe un candidate artifact con Benchmark A real y Benchmark B marcado no medido; con
    `pro-drafts.sqlite` presente, el comportamiento anterior (Benchmark B real) no cambia.
  - **Semántica del artifact "missing-pro" (un solo formato de candidate):** el candidate mantiene
    **UN SOLO** formato. Para Benchmark B no medido:
    - `corpus` de drafts/tournaments == 0;
    - `perBaseline == {}`;
    - `bootstrap == []`;
    - **ninguna** métrica profesional sintetizada.
    - **Sentinel de shape, no observación:** si el tipo actual exige un valor estructural neutro para
      poder serializar el objeto (p.ej. `constraintViolationRate: 0`), ese `0` es un **SENTINEL /
      shape técnico de un benchmark NO MEDIDO**, **no** una observación de "0 violaciones". La fuente
      de verdad de "no disponible" es `corpus == 0` **+** `perBaseline` vacío **+** `gate status
      SKIPPED`. Ese cero **nunca** se presenta como evidencia medida en un reporte.
  - **Contrato "present-pro" (preservado):** cuando `pro-drafts.sqlite` **sí** existe, el productor
    sigue ejecutando `loadReplayCasesFromDb` y `runProAgreement` y calcula el Benchmark B real. La
    tarea **no deshabilita** B: solo hace **opcional la AUSENCIA** del corpus.
  - **Write scope (implementación futura):** `scripts/eval/run.ts`, `scripts/eval/run.test.ts`,
    `scripts/eval/report.ts`. **Fuera de scope ahora, NO autorizado preventivamente:**
    `scripts/eval/gate.ts`, `scripts/eval/benchmark-pro-agreement.ts`, `eval/baselines/**`,
    `eval/golden/**`, `.github/workflows/ci.yml`, `apps/engine/**`, `apps/web/**`, `scripts/pro/**`,
    `Dockerfile`, configuración de Railway.
  - **Protected / DO NOT CHANGE:** `gate.ts` no se toca — el gate ya distingue sub-checks y solo
    interpreta el artifact; `evaluateGate()`, `GateStatus`, `EvaluationIdentity`, `ReferenceBaseline`,
    ADR-002, Golden Dataset, `SCORING_WEIGHTS_*`, comportamiento del motor y de CI intactos
    (regla (a)). Task 8/9/10 son contratos aceptados y no se reabren.
  - **STOP / REPLAN:** si la implementación demuestra que el tipo actual hace **imposible** representar
    "no medido" sin editar `scripts/eval/benchmark-pro-agreement.ts` ⇒ **STOP / REPLAN** (no ampliar
    el write scope sobre la marcha).
  - **Regression matrix (obligatoria):**
    1. corpus pro ausente ⇒ el candidate artifact **existe**;
    2. corpus pro ausente ⇒ Benchmark A **se calcula realmente**;
    3. corpus pro ausente ⇒ Benchmark B **no medido** ⇒ gate B = **SKIPPED informational**;
    4. corpus pro ausente ⇒ `gate --enforce` **puede PASS** si Benchmark A PASS;
    5. corpus pro **presente** ⇒ comportamiento B previo **preservado**;
    6. **no** se fabrican métricas pro;
    7. `ReferenceBaseline` **intacto**;
    8. candidate y reference son **artifacts distintos**;
    9. `EvaluationIdentity` **comparable** (candidate vs reference);
    10. **cero red, cero pro-sync, cero creación / copia / descarga de `pro-drafts.sqlite`**;
    11. **RED previo:** reproducir que el productor actual **crashea con `SQLITE_CANTOPEN`** antes del
        fix (candado de regresión verificado en rojo, regla (c)).
  - **HEAD trazable — precondición explícita de la tarea 19 (NO metadato en el producto):** la tarea 33
    **no** agrega metadata de dirty-working-tree al candidate. Antes de la tarea 19 debe comprobarse:
    `git status --porcelain` **sin cambios pendientes** en `apps/engine/src/**` ni en `scripts/eval/**`,
    y el campo `commit` del candidate identifica el commit que **realmente** contiene el código medido.
    Working tree sucio en esas áreas ⇒ **STOP**, no se evalúa el candidate.
  - **Acción humana (checkpoint commit) — después de esta tarea, antes de la 19:** tras Task 33 PASS y
    aceptación del PO, el **PO realiza un checkpoint commit** de TODO el estado R0 aceptado. **No** es
    una operación irreversible/sensible: es un gate humano de trazabilidad/reproducibilidad. No lo
    ejecuta ningún agente ni esta tarea.
  - **Verification:** TASK COMPLETION — `tsc` + `scripts/eval/run.test.ts` cubriendo los 11 puntos de
    la regression matrix, con el punto 11 verificado en rojo antes del fix. NO corre el eval pesado
    (eso es la tarea 19, INTELLIGENCE CI).
  - **Acceptance criteria:** sin `pro-drafts.sqlite`, `bun run eval` produce un candidate válido con
    Benchmark A medido y Benchmark B `SKIPPED` informational; con el corpus presente, Benchmark B real
    se preserva; los 11 puntos de la regression matrix en verde; `gate.ts` y
    `benchmark-pro-agreement.ts` sin tocar; cero métrica pro fabricada; el neutro estructural del shape
    documentado como sentinel.
  - **Failure / stop conditions:** `SQLITE_CANTOPEN` persiste tras el fix ⇒ circuit-breaker regla (b);
    representar "no medido" exige tocar `benchmark-pro-agreement.ts` ⇒ STOP / REPLAN; el gate empieza a
    tratar Benchmark B ausente como PASS o como bloqueo `required` ⇒ FAIL (clase B, no se parchea
    aquí).
  - **Risk level:** medio (cambia el productor del candidate que consume la evaluación obligatoria).
  - **Approval required?** No (código + test; el checkpoint commit posterior es acción humana de
    trazabilidad, no approval de acción sensible).
  - _Requirements: 2B.1 (y la política de sub-checks de 2A.1)_

- [x] 34. [R0.2B] Snapshot de meta reproducible (S1) + `EvaluationIdentity` con `metaSnapshotVersion`
  - **Workstream:** R0.2B Candidate Evaluation / Promotion.
  - **Origen (replan aceptado por el PO):** la ejecución de R0 alcanzó la tarea 19 y se detuvo —
    `Task 19 Identity Preflight = BLOCKED`, `Snapshot Recovery Preflight = NO_TRUSTWORTHY_SNAPSHOT`. El
    snapshot de meta de S0 (el que produjo `v6-measured.json`) está perdido y no se puede reconstruir.
    Decisión del PO: **no** se reconstruye S0; se construye un S1 fresco y confiable.
  - **Responsabilidad (no mezclar):** la tarea 34 define el **builder** de S1 y el modelo de
    `EvaluationIdentity` (código + tests). La generación real de S1 es un **HUMAN OPERATIONAL
    CHECKPOINT** posterior. La tarea 35 rebasa el control V6 sobre ese S1; la tarea 19 evalúa.
  - **Dependencies:** 18 (checkpoint R0.1 + R0.2A + R0.3 verde — dependencia formal), 33 (productor de
    eval corpus-opcional en PASS).
  - **Es dependencia formal de:** tarea 35 (34 → 35) y tarea 30 (certificación).
  - **Preconditions:** el checkpoint 18 está verde; la tarea 33 está en PASS; el PO hizo el checkpoint
    commit del estado R0 aceptado.
  - **Objetivo:** (1) implementar el builder de S1 y el modelo de identidad/procedencia; (2) tras
    aceptar código/tests, generar S1 en un HUMAN OPERATIONAL CHECKPOINT. `EvaluationIdentity` gana
    `metaSnapshotVersion` (huella de **contenido lógico**, `meta1:<sha256 completo>`, **nunca** el SHA
    crudo del SQLite, **nunca** truncado) sobre una serialización canónica inequívoca (JSON/JSONL con
    tabla explícita, nombres de campo explícitos, orden determinista, codificación primitiva estable,
    manejo explícito de `null`, `schemaTag`/versión incluida) de **exactamente** los inputs de
    `loadMeta`: `heroes`(`id`,`localized_name`,`roles`) orden `id`;
    `hero_patch_stats`(`hero_id`,`patch`,`bracket`,`picks`,`wins`) orden (`hero_id`,`patch`,`bracket`);
    `hero_matchups`(`hero_id`,`vs_hero_id`,`games`,`wins`) orden (`hero_id`,`vs_hero_id`). `snapshotFileSha`
    (SHA-256 crudo de `S1.sqlite`) es metadato/procedencia y **no** participa en `isComparable()`.
    `EvaluationMetadata` gana `measuredEngineCommit` y `evaluationHarnessCommit` explícitos (el motor
    medido no se infiere de `git rev-parse HEAD`). `evaluationProtocolVersion` codifica la **regla**
    `patchOverride:dominant`, no un patch concreto; el manifiesto registra `patchLabel` y
    `patchLabelSource`, y el builder **no** afirma que `dominantPatch` prueba el patch real vigente de
    Dota.
  - **Proceso del HUMAN OPERATIONAL CHECKPOINT (S1):** DB **temporal fresca** (nunca prod ni la DB
    local de trabajo) → migrar/inicializar esquema → correr el sync canónico de meta → **exigir
    `status=ok` (éxito completo)** → validar → congelar → fingerprint (`metaSnapshotVersion`) +
    `snapshotFileSha` → `S1.manifest.json` → commitear la evidencia congelada después. Si el sync
    lanza, hace rate-limit, termina non-ok o la validación falla ⇒ **descartar por completo la DB
    temporal**, **sin producir ningún artefacto**; nunca se reanuda ni se congela una DB parcial.
  - **Expected observable output:** `eval/snapshots/S1.sqlite` (SQLite congelado, git normal ~1–2 MB,
    **sin Git LFS**) + `eval/snapshots/S1.manifest.json` (con `metaSnapshotVersion`, `snapshotFileSha`,
    `schemaTag`, `patchLabel`, `patchLabelSource`, `dominantPatch`, `rowCounts`, `createdAt` efímero);
    `run.ts` produce un `EvaluationIdentity` con `metaSnapshotVersion` y una `EvaluationMetadata` con
    procedencia; `isComparable()` incluye `metaSnapshotVersion` y **excluye** `snapshotFileSha` /
    commits de motor/harness.
  - **Write scope (conceptual):** `scripts/eval/snapshot.ts` (+ tests), `scripts/eval/evaluation-identity.ts`
    (+ tests), `scripts/eval/run.ts` (+ tests), la **excepción mínima** de `.gitignore`
    (`!eval/snapshots/S1.sqlite` — sin des-ignorar SQLite arbitrarios), `eval/snapshots/S1.sqlite`,
    `eval/snapshots/S1.manifest.json`, y documentación **aditiva** de procedencia histórica de S0.
  - **Protected / DO NOT CHANGE:** NO modifica `apps/engine/**`; NO modifica el contenido de
    `v6-measured.json` (`HISTORICAL_REFERENCE_S0`, inmutable); NO modifica el Golden Dataset; NO
    regenera el split; NO cambia la matemática de `evaluateGate()`; NO cambia `SCORING_WEIGHTS`.
  - **Bug de escritura parcial de producción (no bloquea R0):** el `syncMatchups` no-transaccional es
    un defecto real ⇒ se crea/referencia un **ticket de hotfix futuro separado**. R0 protege S1 con DB
    desechable fresca + `status=ok` + validar-antes-de-congelar + descartar-ante-cualquier-fallo. NO se
    expande la tarea 34 a rediseñar el sync de producción.
  - **Verification / acceptance criteria:**
    - `metaSnapshotVersion` = SHA-256 lógico **completo**; `snapshotFileSha` solo metadato;
    - **test de falsa comparabilidad**: `HISTORICAL_REFERENCE_S0` sin `metaSnapshotVersion` vs
      candidate sobre S1 ⇒ incomparable/BLOCKED;
    - **mismos datos lógicos / distintos bytes de SQLite ⇒ misma identidad**;
    - **mismo `patchLabel` / datos relevantes distintos ⇒ identidad distinta**;
    - legacy S0 sin `metaSnapshotVersion` ⇒ incomparable/BLOCKED;
    - `run.ts` **no** re-apunta el baseline aceptado por defecto;
    - procedencia explícita motor/harness en `EvaluationMetadata`;
    - **sync fallido nunca congela S1** (test del descarte de la DB temporal);
    - determinismo lógico (CP12): `EvaluationIdentity` / métricas / ranking / huella lógica idénticos
      entre corridas equivalentes; metadato efímero documentado y excluido.
    La tarea 34 **no puede pasar a PASS** hasta que el `S1.manifest.json` y la huella lógica
    resultantes del HUMAN OPERATIONAL CHECKPOINT validen.
  - **Failure / stop conditions:** si construir S1 exige tocar `apps/engine/**`, editar
    `v6-measured.json`, el Golden o el split ⇒ **STOP / REPLAN** (clase B/D); si el sync falla o la
    validación no pasa ⇒ descartar y reintentar el checkpoint operativo, sin artefacto; circuit-breaker
    (b) para la misma root cause.
  - **Risk level:** medio (corre un sync de meta real — red/rate limits — pero contra una DB
    desechable, nunca producción; no toca producto).
  - **Approval required?** No para el builder (código + test). La generación real de S1 es un HUMAN
    OPERATIONAL CHECKPOINT (acción operativa humana de trazabilidad/reproducibilidad, **no** approval
    de acción sensible/irreversible).
  - _Requirements: 2B.3 (y 2A.2 c5–c9)_

- [x] 35. [R0.2B] COMPLETE — Control V6 rebasado sobre S1 + cableado de la comparación de la tarea 19
  - **Workstream:** R0.2B Candidate Evaluation / Promotion.
  - **Responsabilidad (no mezclar):** la tarea 35 produce `REBASED_REFERENCE(S1)` (el control V6
    rebasado) y el cableado **acotado** para que la tarea 19 lo consuma. La tarea 19 **evalúa**; la
    tarea 20 **promueve**. Contratos separados.
  - **Dependencies:** 34 (S1 confiable + `EvaluationIdentity`/`metaSnapshotVersion` en PASS,
    manifiesto/huella validados), 18 (checkpoint), 33 (productor de eval corpus-opcional en PASS).
  - **Es dependencia formal de:** tarea 19 (35 → 19) y tarea 30 (certificación).
  - **Preconditions:** S1 (`eval/snapshots/S1.sqlite` + `S1.manifest.json`) congelado y commiteado; el
    árbol principal limpio.
  - **Objetivo:** correr el **motor VIEJO aceptado (`df354b9`, comportamiento V6)** sobre el **mismo**
    S1 congelado usando el **harness de evaluación actual**, y materializarlo como
    `eval/baselines/reference.s1.json` (un `REBASED_CONTROL`, **no** un baseline aceptado). Cablear la
    tarea 19 para invocar explícitamente `reference = reference.s1.json` y
    `candidate = candidate.s1.json` por un mecanismo **acotado** (path/env/config).
  - **Mecanismo preferido:** un **git worktree temporal** que usa el **harness de evaluación actual**,
    con `apps/engine/src/**` **superpuesto (overlay)** desde `df354b9`. El **árbol principal permanece
    intacto**.
  - **CRÍTICO — sin fallback de harness viejo:** si el motor VIEJO **no compila/corre** contra el
    harness actual ⇒ **STOP / REPLAN**. **NO** se aprueba automáticamente "worktree completo de
    `df354b9` + harness de eval viejo": un harness distinto cambia otra variable y no se puede declarar
    comparable porque las fórmulas de métrica se parezcan. Un adaptador de compatibilidad bajo el
    harness actual puede diseñarse en un replan posterior si hace falta.
  - **Procedencia:** `reference.s1.json` lleva `measuredEngineCommit = df354b9c4ed415b86dba35dc92e2f84e5cb40e5d`
    y `evaluationHarnessCommit =` el commit del checkpoint actual (`59bf3bbb5955ba567bb139f79eac1d4de3c71711`
    o el checkpoint real al ejecutar). Estos campos son procedencia y **no** deciden `isComparable()`.
  - **Expected observable output:** `eval/baselines/reference.s1.json` con la `EvaluationIdentity`
    completa (misma que un candidate sobre S1: `datasetVersion`, `evaluationProtocolVersion`,
    `scoringModelFamily`, `metaSnapshotVersion`) y la `EvaluationMetadata` de procedencia; el mecanismo
    acotado de ruta-de-referencia disponible para la tarea 19; el árbol principal sin cambios
    (`git status --porcelain` limpio tras la corrida).
  - **Write scope (conceptual):** `scripts/eval/rebased-reference.ts` (+ tests),
    `eval/baselines/reference.s1.json`, la config **acotada** explícita de ruta-de-referencia para el
    gate **si hace falta** (path/env/config), el cableado de la invocación de la tarea 19, y la
    verificación de provisión de S1 en CI.
  - **Protected / DO NOT CHANGE:** **NO** re-apunta globalmente el baseline por defecto de `--enforce`
    hacia `reference.s1.json` (eso es la tarea 20, y solo con Task 19 PASS + aceptación); **NO** modifica
    la matemática de `evaluateGate()`; **NO** modifica `HISTORICAL_REFERENCE_S0` (`v6-measured.json`);
    **NO** modifica S1 ni `apps/engine/**` del árbol principal; **NO** promueve ningún baseline. El
    enrutamiento del baseline aceptado por defecto permanece intacto hasta la tarea 20.
  - **Verification / acceptance criteria:**
    - el **harness ACTUAL + overlay del motor VIEJO** corre con éxito sobre S1;
    - `measuredEngineCommit = df354b9…`; `evaluationHarnessCommit =` el checkpoint HEAD actual;
    - el **árbol principal permanece limpio**;
    - `reference` y `candidate` usan **exactamente** la misma `EvaluationIdentity` (mismo
      `metaSnapshotVersion`); un `metaSnapshotVersion` mismatch ⇒ **BLOCKED**;
    - si la API del overlay es incompatible ⇒ **STOP / REPLAN**, **no** fallback de harness viejo;
    - **sin promoción de baseline**; el `--enforce` por defecto no cambia;
    - métricas / salidas lógicas deterministas entre corridas equivalentes (CP12).
  - **Failure / stop conditions:** overlay incompatible con el harness actual ⇒ STOP / REPLAN (clase
    C/B), no se declara comparable; `metaSnapshotVersion` mismatch entre `reference` y `candidate` ⇒
    BLOCKED; cualquier intento de re-apuntar el default de `--enforce` ⇒ FAIL (es la tarea 20).
    Circuit-breaker (b).
  - **Risk level:** medio (ejecuta el motor viejo por overlay; no toca el producto del árbol
    principal).
  - **Approval required?** No; no incluye deploy, promoción de baseline ni acción irreversible (esas
    son la tarea 20).
  - _Requirements: 2B.4 (y 2B.1, 2A.2 c7)_

- [x] 19. [R0.2B] COMPLETE — Evaluar `CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)` (INTELLIGENCE CI)
  - **Workstream:** R0.2B Candidate Evaluation / Promotion.
  - **Semántica (replan aceptado por el PO):** la tarea 19 **ya no** compara el candidate contra
    `HISTORICAL_REFERENCE_S0` (`v6-measured.json`): el snapshot de meta de S0 está perdido y sus
    métricas 0.736-era no son comparables con S1. La tarea 19 es ahora
    **`CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)`** — dos motores sobre el **mismo** S1
    congelado, con la única variable independiente siendo el **código del motor**.
  - **Dependencies:** 18 (checkpoint R0.1+R0.2A+R0.3 verde — dependencia formal), 33 (productor de eval
    corpus-opcional en PASS), **34** (S1 confiable + `EvaluationIdentity` con `metaSnapshotVersion`;
    manifiesto y huella lógica validados por el HUMAN OPERATIONAL CHECKPOINT), **35**
    (`REBASED_REFERENCE(S1)` = `eval/baselines/reference.s1.json` + el cableado acotado de la comparación),
    7 (discovery `pro-drafts.sqlite`, solo para el sub-check Pro Agreement). El checkpoint 18 ya cierra
    8, 9, 10 (instrumento R0.2A restaurado) y 11, 12, 13, 14, 16 (candidate R0.3).
  - **Preconditions:** el checkpoint 18 está verde; la tarea 33 está en PASS; el **PO hizo el
    checkpoint commit** de todo el estado R0 aceptado (acción humana de trazabilidad); la tarea 34 está
    en PASS y S1 (`eval/snapshots/S1.sqlite` + `S1.manifest.json`) está congelado y commiteado; la
    tarea 35 produjo `reference.s1.json` con el motor `df354b9` sobre ese S1 usando el harness actual.
    §9.3 bloquea SOLO el sub-check Pro Agreement / Benchmark B (queda `SKIPPED` informational, ADR-002);
    Engine Quality / Benchmark A evalúa sin ese archivo y `gate --enforce` puede PASS si Benchmark A pasa.
    **HEAD trazable (precondición bloqueante):** el candidate (`candidate.s1.json`) se genera desde un
    HEAD **limpio y trazable** con todos los cambios R0 aceptados: `git status --porcelain` **sin
    cambios pendientes** en `apps/engine/src/**` ni en `scripts/eval/**`, y el campo `commit` /
    `measuredEngineCommit` del candidate identifica el commit que realmente contiene el código medido.
    Working tree sucio en esas áreas ⇒ **STOP**, no se evalúa.
  - **Objetivo:** evaluar `CURRENT_ENGINE(S1)` (candidate desde HEAD limpio) contra
    `REBASED_OLD_ENGINE_CONTROL(S1)` (`reference.s1.json`, motor `df354b9`) usando el `Evaluation_Gate`
    restaurado, con el mismo Golden, split, protocolo/harness y S1. Ejecutar este eval pesado en
    INTELLIGENCE CI (no en pre-push). La tarea 19 invoca explícitamente
    `reference = reference.s1.json` y `candidate = candidate.s1.json` por el mecanismo **acotado** de la
    tarea 35 (path/env/config) — **no** re-apunta el baseline aceptado por defecto.
  - **Requisitos de identidad (bloqueantes):** `reference` y `candidate` DEBEN tener la misma
    `EvaluationIdentity` (`datasetVersion`, `evaluationProtocolVersion`, `scoringModelFamily`,
    `metaSnapshotVersion`) y diferir **solo** en `measuredEngineCommit`
    (`reference.measuredEngineCommit = df354b9c4ed415b86dba35dc92e2f84e5cb40e5d`;
    `reference.evaluationHarnessCommit =` el checkpoint actual). Si el `metaSnapshotVersion` de ambos no
    coincide ⇒ **BLOCKED** (no se compara sobre S1 distintos).
  - **Expected observable output:** un veredicto de gate (PASS/FAIL/SKIPPED/BLOCKED por sub-check) de
    `CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)`, generado en INTELLIGENCE CI; Benchmark B
    `SKIPPED` informational si falta `pro-drafts.sqlite` (no PASS). Métricas / salidas de ranking /
    huella lógica deterministas entre corridas equivalentes (CP12; metadato efímero excluido).
  - **Write scope:** invocación/configuración del eval en INTELLIGENCE CI y el artefacto de veredicto
    (`candidate.s1.json` + el reporte de comparación). **NO** modifica `reference.s1.json`, **NO**
    escribe ningún baseline aceptado, **NO** re-apunta el `--enforce` por defecto (eso es la tarea 20).
  - **Protected / DO NOT CHANGE:** `evaluateGate()` intacto; `HISTORICAL_REFERENCE_S0`
    (`v6-measured.json`) intacto; S1 congelado intacto; `reference.s1.json` es un `REBASED_CONTROL`, no
    un baseline aceptado — no se promueve nada aquí (regla (a)).
  - **Implementation notes:** diseño §4.2 (LLD "snapshot de meta reproducible (S1) + control V6
    rebasado"), §5, §8 fila de riesgo R0.3; requisitos 2B.1, 2B.4, T.4 c2. CP8 (compatibilidad
    dataset/protocol/`metaSnapshotVersion`), CP12 (determinismo lógico).
  - **Verification:** INTELLIGENCE CI — el eval corre y produce veredicto reproducible; sin eval verde
    reproducible NO se habilita la promoción (tarea 20).
  - **Acceptance criteria:** `CURRENT_ENGINE(S1)` queda medido contra `REBASED_OLD_ENGINE_CONTROL(S1)`
    sobre el mismo S1 con veredicto reproducible en INTELLIGENCE CI; misma `EvaluationIdentity` salvo
    `measuredEngineCommit`; `metaSnapshotVersion` mismatch ⇒ BLOCKED; el sub-check Benchmark B refleja
    la presencia/ausencia del corpus; ningún baseline aceptado se escribe; el `--enforce` por defecto
    no cambia.
  - **Failure / stop conditions:** FAIL del candidate ⇒ clasificar A/B/C/D (bucle §6) — es un veredicto
    real de regresión de motor sobre S1; `metaSnapshotVersion` incompatible ⇒ BLOCKED (no se edita
    ningún artefacto); si el motor viejo no pudo correr contra el harness actual en la tarea 35 ⇒ esta
    tarea permanece BLOCKED hasta el STOP/REPLAN de la tarea 35. Circuit-breaker (b).
  - **Risk level:** medio.
  - **Approval required?** No (la promoción sí — tarea 20).
  - _Requirements: 2B.1, 2B.4, T.4_

- [x] 20. [R0.2B] COMPLETE — Promoción de `CURRENT_CANDIDATE(S1)` a `accepted.s1.json` solo tras aceptación explícita
  - **Workstream:** R0.2B Candidate Evaluation / Promotion.
  - **Dependencies:** 19.
  - **Semántica (replan aceptado por el PO):** `reference.s1.json` es un `REBASED_CONTROL`, **no** un
    baseline aceptado. Solo **si la tarea 19 da PASS**, el PO **puede** promover explícitamente
    `CURRENT_CANDIDATE(S1)` a un **nuevo** artefacto de baseline aceptado
    (`eval/baselines/accepted.s1.json`). En ese punto, y **solo entonces**, se re-apunta el `--enforce`
    por defecto hacia el baseline aceptado nuevo. `HISTORICAL_REFERENCE_S0` (`v6-measured.json`)
    permanece como evidencia histórica S0 **para siempre** — no se sobrescribe, no se borra, no se
    promueve. Antes de esta tarea NO existe ninguna ficción semántica de que `reference.s1.json` sea el
    baseline de producción aceptado.
  - **Preconditions:** eval `CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)` **en PASS** verde
    y reproducible (tarea 19); §9.1 (volumen Railway) y §9.4 (migraciones) resueltas si la promoción
    tocara persistencia (ver tarea 21).
  - **Objetivo:** esta tarea tiene **dos aspectos separados con contratos distintos** — el mecanismo
    de promoción (código + test) NO se confunde con ejecutar una promoción real (acción humana
    sensible):

    **(a) MECANISMO de promoción (`promoteCandidate`) — código + test, sin approval.**
    Implementar `promoteCandidate` de modo que, sin aceptación explícita, NO promueva y devuelva "sin
    aceptación explícita"; con aceptación explícita (criterio explícito + acción deliberada) congele
    `CURRENT_CANDIDATE(S1)` como `eval/baselines/accepted.s1.json` (con `acceptedAtCommit` y la
    `EvaluationIdentity` completa, incluida `metaSnapshotVersion`); y NUNCA promueva automáticamente
    por estar en HEAD ni por ser `reference.s1.json`. El mecanismo NO promueve si la tarea 19 no dio
    PASS. Verificación con TASK COMPLETION (sin aceptación / sin Task 19 PASS en el test ⇒ no promueve;
    con aceptación simulada + Task 19 PASS simulado ⇒ congela).
    - **Approval required? (a):** No. **Risk level (a):** medio.

    **(b) PROMOCIÓN REAL a `accepted.s1.json` + re-apuntar el `--enforce` por defecto — acción humana
    sensible/irreversible.**
    Ejecutar una promoción real usando el mecanismo (a) y, solo entonces, re-apuntar el baseline por
    defecto de `--enforce` hacia `accepted.s1.json`. SOLO este aspecto requiere y CONSUME aprobación
    humana explícita; nunca es automático; nunca se dispara por HEAD ni por `reference.s1.json`; solo
    con la tarea 19 en PASS.
    - **Approval required? (b):** Sí (promoción real de baseline + repunte del `--enforce`; T.4).
      **Risk level (b):** alto (irreversible/sensible).
  - **Expected observable output:** (a) sin aceptación / sin Task 19 PASS ⇒ no-promoción con motivo,
    con aceptación simulada + Task 19 PASS ⇒ congela `accepted.s1.json`; (b) tras approval humano
    explícito ⇒ nuevo baseline aceptado `eval/baselines/accepted.s1.json` con `acceptedAtCommit` y el
    `--enforce` por defecto re-apuntado a él.
  - **Write scope:** (a) `scripts/eval/` (`promoteCandidate` + su test) y, si hace falta, la config
    acotada de ruta-de-referencia por defecto; (b) SOLO tras aceptación humana explícita,
    `eval/baselines/accepted.s1.json` (el nuevo baseline congelado) y el repunte del default.
  - **Protected / DO NOT CHANGE:** `HISTORICAL_REFERENCE_S0` (`v6-measured.json`) intacto — nunca se
    sobrescribe ni se promueve; `reference.s1.json` (`REBASED_CONTROL`) no es el baseline aceptado; la
    matemática de `evaluateGate()` intacta; la promoción REAL (b) es acción sensible/irreversible (§8,
    T.4); no se promueve por HEAD (regla (a)).
  - **Implementation notes:** diseño §4.2 LLD (`promoteCandidate`, "snapshot de meta reproducible (S1)
    + control V6 rebasado" — semántica de la tarea 20), §8; requisitos 2B.2, 2B.4 c3, T.4 c1. CP8
    (parte promoción / repunte del default) / Property 8. El candado CP8 se verifica sobre el mecanismo
    (a); (b) es la ejecución gobernada por approval.
  - **Verification:** (a) TASK COMPLETION — test: promoción sin aceptación o sin Task 19 PASS ⇒ no
    promueve; con aceptación simulada + Task 19 PASS ⇒ congela `accepted.s1.json`; `run.ts` / gate no
    re-apunta el baseline aceptado por defecto por sí solo (CP8 verde). (b) ejecución real solo tras
    approval humano registrado.
  - **Acceptance criteria:** CP8/Property 8 (mecanismo) verde; ninguna promoción automática por HEAD ni
    por `reference.s1.json`; la promoción real (b) y el repunte del `--enforce` por defecto solo tras
    Task 19 PASS + aceptación explícita registrada; `v6-measured.json` intacto.
  - **Failure / stop conditions:** si se intenta promover realmente (b) sin Task 19 PASS o sin
    aceptación ⇒ bloquear; el mecanismo (a) no debe permitir un camino de promoción automática ni
    re-apuntar el default en silencio.
  - **Risk level:** (a) medio / (b) alto.
  - **Approval required?** Solo (b) la promoción real + repunte del default: Sí (T.4). (a) el
    mecanismo: No.
  - _Requirements: 2B.2, 2B.4, T.4_

### R0.4 â€” Harness Truth

_(Depende solo de R0.1. Paralelizable respecto a R0.2A/R0.3 donde el write scope no colisiona.
Objetivo: menos, no mÃ¡s â€” racionalizar lo existente, no crear agentes nuevos. R0.4.4/requisito 4.4
PROHÃBE crear agentes nuevos.)_

- [x] 21. [R0.4] COMPLETE — Discovery: env vars reales en Railway; persistencia y migraciones (ALTO RIESGO)
  - **Workstream:** R0.4 Harness Truth (discovery, read-only salvo el artefacto de evidencia).
  - **Dependencies:** ninguna.
  - **Preconditions:** ninguna.
  - **Objetivo:** determinar, sin inventar respuestas (diseÃ±o Â§9): (Â§9.2) quÃ© env vars existen
    realmente en Railway (`STEAM_WEB_API_KEY`, `CAPTURE_TOKEN`, `ENGINE_DB_PATH`, `DRAFT_LIVE_ENABLED`,
    `NEXT_PUBLIC_ENGINE_WS_URL`, `ENABLE_PRO_DRAFTER`); (Â§9.1) si Railway tiene volumen persistente
    montado para `apps/engine/data/`; (Â§9.4) el estado real de las migraciones de producciÃ³n y su
    supervivencia entre redeploys.
  - **Expected observable output:** reporte de evidencia (p.ej.
    `docs/agents/r0-discovery/railway-env-persistence.md`) con las tres respuestas o su marca de "no
    confirmado", enumerando quÃ© desbloquea: Â§9.2 â†’ tarea 24 (documentar `STEAM_WEB_API_KEY`) y el
    guardrail de secretos de la tarea 26; Â§9.1/Â§9.4 â†’ acciones de persistencia/migraciÃ³n y la tarea 22
    (approval, T.4).
  - **Write scope:** `docs/agents/r0-discovery/railway-env-persistence.md` (solo evidencia). Read-only;
    no toca Railway ni migra nada.
  - **Protected / DO NOT CHANGE:** no ejecuta migraciones ni cambia persistencia; `account_id` nunca
    se loguea ni se eco (seguridad). Solo observa y reporta.
  - **Implementation notes:** diseÃ±o Â§9.1/Â§9.2/Â§9.4, Â§8 (riesgos irreversibles); requisitos 4.6
    Preconditions, 4.8 Preconditions, T.4 Preconditions.
  - **Verification:** el reporte existe y responde Â§9.1/Â§9.2/Â§9.4 o marca lo no confirmado; no se
    ejecutÃ³ ninguna acciÃ³n irreversible.
  - **Acceptance criteria:** las tres preguntas quedan respondidas o explÃ­citamente marcadas como no
    confirmadas; los bloqueos de tareas 24/26 y de las acciones de persistencia/migraciÃ³n quedan
    documentados.
  - **Failure / stop conditions:** cualquier acciÃ³n de persistencia/migraciÃ³n descubierta como
    necesaria NO se ejecuta aquÃ­ â€” se difiere a la tarea 22 con approval (T.4).
  - **Risk level:** alto (toca dominio de persistencia/migraciÃ³n de producciÃ³n, aunque esta tarea es
    read-only).
  - **Approval required?** No (read-only); las acciones que habilita, sÃ­.
  - _Requirements: 4.6, 4.8, T.4_

- [x] 22. [R0.4] COMPLETE — NO ACTION REQUIRED — AcciÃ³n de persistencia/migraciÃ³n de producciÃ³n â€” CONDITIONAL (gated por discovery + approval sobre la acciÃ³n concreta)
  - **Workstream:** R0.4 Harness Truth (acciÃ³n sensible/irreversible).
  - **Conditional:** sÃ­. Esta tarea NO es auto-ejecutable. La discovery (tarea 21) NO autoriza por sÃ­
    misma a modificar producciÃ³n; solo produce una **ACCIÃ“N PROPUESTA** concreta (no un fix).
  - **Dependencies:** 21 (que produce la ACCIÃ“N PROPUESTA concreta) + aprobaciÃ³n humana explÃ­cita
    SOBRE ESA acciÃ³n concreta.
  - **Preconditions:** Â§9.1 (volumen Railway) y Â§9.4 (estado de migraciones) resueltas por la tarea 21,
    con una ACCIÃ“N PROPUESTA concreta emitida; aprobaciÃ³n humana explÃ­cita sobre esa acciÃ³n concreta
    (T.4).
  - **Objetivo:** ejecutar un **bounded fix** â€” y SOLO el bounded fix descrito en la acciÃ³n concreta
    propuesta por la tarea 21 â€” DESPUÃ‰S de aprobaciÃ³n humana explÃ­cita sobre esa acciÃ³n, para no perder
    `accounts`/`hero_pool`/`draft_feedback` entre redeploys. Si NO hay acciÃ³n concreta propuesta o no
    hay approval sobre ella â‡’ no se ejecuta nada.
  - **LÃ­mite duro (escape a Spec separada):** si el cambio requerido **excede el alcance de R0** o
    altera arquitectura/persistencia de forma **MATERIAL** (p.ej. cambiar el motor de BD, migraciÃ³n
    irreversible de esquema con pÃ©rdida potencial, reestructurar el modelo de persistencia), **NO se
    ejecuta en R0**: se abre una **Spec separada** y R0 puede quedar **BLOCKED** mientras esa deuda se
    resuelve fuera de R0.
  - **Expected observable output:** la acciÃ³n concreta aprobada queda aplicada y verificada; o se
    documenta que no era necesaria; o se documenta que era material/fuera de alcance â‡’ Spec separada
    abierta + R0 BLOCKED (sin ejecutar).
  - **Write scope:** `railway.json` / configuraciÃ³n de volumen y/o migraciones bajo `apps/engine/`,
    estrictamente lo aprobado en la acciÃ³n concreta. NO amplÃ­a alcance.
  - **Protected / DO NOT CHANGE:** no se cambia el motor de base de datos dentro de R0; no se toca
    auth/permisos sin approval; `account_id` nunca se loguea (seguridad). AcciÃ³n irreversible bajo T.4.
  - **Implementation notes:** diseÃ±o Â§8 (migraciones, persistencia Railway), Â§9.1/Â§9.4; requisito T.4
    c1. La discovery (21) entrega ACCIÃ“N PROPUESTA; esta tarea solo ejecuta lo aprobado.
  - **Verification:** TASK COMPLETION + verificaciÃ³n explÃ­cita de supervivencia entre redeploys de lo
    aprobado.
  - **Acceptance criteria:** la acciÃ³n irreversible se ejecutÃ³ solo tras approval explÃ­cito sobre la
    acciÃ³n concreta y quedÃ³ verificada; o se documentÃ³ que no procedÃ­a; o se derivÃ³ a Spec separada con
    R0 BLOCKED.
  - **Failure / stop conditions:** sin acciÃ³n concreta propuesta o sin approval explÃ­cito sobre ella â‡’
    NO actuar; **acciÃ³n material o fuera de alcance R0 â‡’ abrir Spec separada + R0 BLOCKED; NO
    ejecutar** (nunca ampliar alcance para "resolverlo dentro de R0").
  - **Risk level:** alto (irreversible: persistencia/migraciÃ³n de producciÃ³n).
  - **Conditional:** sÃ­. **Approval required?:** sÃ­ (sobre la acciÃ³n concreta propuesta por la tarea 21).
  - _Requirements: T.4_

- [x] 23. [R0.4] Harness Responsibility Matrix + taxonomÃ­a sin solapamiento (racionalizaciÃ³n)
  - **Workstream:** R0.4 Harness Truth (tarea de racionalizaciÃ³n â€” precede a las tareas KEEP/MERGE/MOVE/DELETE).
  - **Dependencies:** 2 (suites estabilizadas) â€” ancla de cierre de R0.1. R0.4 deriva de R0.1: la
    Matrix se ejecuta DESPUÃ‰S de que R0.1 estabilizÃ³ las suites, para racionalizar los mecanismos
    sobre el estado estable, no sobre un entorno todavÃ­a en rojo.
    - **Por quÃ© 2 y NO 5:** no se puede anclar 23 en la tarea 5 sin crear un ciclo. La tarea 5
      (PRE-PUSH gate) depende de la tarea 3 (deps web), y la tarea 3 depende de la tarea 23 (el
      `canonical dependency-management procedure` que la Matrix determina â€” C1). Anclar 23 en 5
      cerrarÃ­a el ciclo `3 â†’ 23 â†’ 5 â†’ 3`. Por eso el ancla de estabilidad R0.1 para la Matrix es la
      tarea 2 (suites reparadas), que NO depende transitivamente de 23. El gate local (tarea 5) sÃ­ es
      precondiciÃ³n de las tareas de R0.4 que consumen el gate/CI directamente (27 depende de 5).
  - **Preconditions:** las suites (tarea 2) estÃ¡n estabilizadas; R0.4 razona sobre el estado estable de
    R0.1. (La dependencia sobre el gate local 5 vive en las tareas de R0.4 que lo consumen â€”27â€”, no en
    la Matrix, para preservar la aciclicidad.)
  - **Objetivo:** aplicar la `Harness_Responsibility_Matrix` (veredicto KEEP / MERGE / MOVE / DELETE /
    REFACTOR por mecanismo) a los mecanismos existentes, y definir la taxonomÃ­a sin solape (`CLAUDE.md`,
    `RULE`, `SKILL`, `AGENT/SUBAGENT`, `HOOK`, `PERMISSION`, `SPEC`, `ADR`, `TEST`, `EVAL`) asegurando
    que cada categorÃ­a respete su regla de no-solapamiento (un AGENT nunca corre un chequeo
    determinista; TEST y EVAL separados). Produce el mapeo de veredictos que las tareas 24â€“29 ejecutan.
  - **Expected observable output:** un documento/artefacto de racionalizaciÃ³n con el veredicto por
    mecanismo (derivado de la tabla del diseÃ±o) y la taxonomÃ­a con sus reglas de no-solape; enumera quÃ©
    tareas KEEP/MERGE/MOVE/DELETE/REFACTOR se derivan.
  - **Write scope:** documento de racionalizaciÃ³n del harness (p.ej. `docs/agents/harness-matrix.md`).
    NO ejecuta aÃºn los MOVE/DELETE (esos son las tareas 24â€“29).
  - **Protected / DO NOT CHANGE:** se conservan intactos `invariantes.md`, `journal.md`/`ledger.md`,
    ADRs, agentes `evaluation-engineer`/`data-stat-engineer` (regla (a)). No se multiplican mecanismos.
  - **Implementation notes:** diseÃ±o Â§4.4 TaxonomÃ­a + Harness Responsibility Matrix; requisitos 4.2,
    4.3 c1.
  - **Verification:** TASK COMPLETION â€” el mapeo cubre cada mecanismo del diseÃ±o con su veredicto y la
    taxonomÃ­a respeta no-solape.
  - **Acceptance criteria:** matriz aplicada y taxonomÃ­a sin solape definidas; las tareas 24â€“29 tienen
    su mapeo de origen.
  - **Failure / stop conditions:** si un veredicto del diseÃ±o contradice un artefacto protegido â‡’ STOP
    y REPLAN (clase B).
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 4.2, 4.3_

- [ ] 24. [R0.4] Reconciliar espejos divergidos (V5â†’V6) + mover narrativa de fase a rules-archive
  - **Workstream:** R0.4 Harness Truth (KEEP+HARDEN / MOVE / MERGE-DELETE derivados de la tarea 23).
  - **Dependencies:** 23; 21 (Â§9.2, SOLO para el criterio de documentar `STEAM_WEB_API_KEY`).
  - **Preconditions:** matriz aplicada (tarea 23); Â§9.2 resuelta para documentar `STEAM_WEB_API_KEY`.
  - **Objetivo:** aplicar el `Reconciliation_Procedure` de 5 pasos (detectar, clasificar por autoridad
    ADR-001 L0â€“L6, determinar canÃ³nico, resolver, registrar) a las contradicciones documentoâ†”cÃ³digo;
    derivar "converger a V6" del hecho de que `invariantes.md` (autoridad alta) dice V6 (no de "el
    cÃ³digo gana ciegamente"); eliminar o regenerar los espejos manuales divergidos (AGENTS.md y
    `.kiro/steering/{tech,product,structure}.md`, que dicen V5); mover la narrativa de fase cerrada
    (`engine.md`, `fase-9*.md`) a `docs/rules-archive/` conservando lo imperativo como RULE; documentar
    `STEAM_WEB_API_KEY` en `.env.example`; y registrar SOLO las reconciliaciones **materiales** en el
    destino canÃ³nico Ãºnico (`ledger.md`), sin exigir registrar sincronizaciones triviales.
  - **Expected observable output:** los steering docs y AGENTS.md ya no dicen V5; `engine.md`/`fase-9*.md`
    movidos a `docs/rules-archive/` con lo imperativo preservado como RULE; `STEAM_WEB_API_KEY` en
    `.env.example`; las reconciliaciones materiales anotadas en `ledger.md` (append-only).
  - **Write scope:** `AGENTS.md`, `.kiro/steering/{tech,product,structure}.md`, `.claude/rules/engine.md`,
    `.claude/rules/fase-9*.md`, `docs/rules-archive/`, `.env.example`, `ledger.md` (append-only).
    Coordina con la tarea 6 (comandos en docs) para no colisionar write scope.
  - **Protected / DO NOT CHANGE:** `invariantes.md`, `journal.md`/`ledger.md` (append-only, solo
    append), ADRs intactos; `.kiro/` se conserva (Kiro es el IDE principal); `account_id` no se eco en
    `ledger.md` (seguridad); no se edita `SCORING_WEIGHTS_V6` (regla (a)).
  - **Implementation notes:** diseÃ±o Â§4.4 Reconciliation Procedure, tabla de inconsistencias filas 1 y
    4, Harness Responsibility Matrix (MOVE de engine.md/fase-9*.md; MERGE/DELETE de AGENTS.md;
    REFACTORâ†’KEEP de steering); requisitos 4.1, 4.3 c2, 4.6 c1.
  - **Verification:** TASK COMPLETION â€” grep confirma ausencia de "V5 activo" en espejos; los archivos
    de narrativa estÃ¡n en `docs/rules-archive/`; `.env.example` contiene `STEAM_WEB_API_KEY`.
  - **Acceptance criteria:** una sola fuente de verdad por hecho (V6); espejos divergidos
    eliminados/regenerados; narrativa archivada; `STEAM_WEB_API_KEY` documentada; solo reconciliaciones
    materiales en `ledger.md`.
  - **Failure / stop conditions:** si el procedimiento determina que el **cÃ³digo** estÃ¡ en deuda (el
    canÃ³nico es el doc/ADR) â‡’ abrir hallazgo clase A/B y corregir el cÃ³digo, no el artefacto de alta
    autoridad.
  - **Risk level:** medio.
  - **Approval required?** No (documentar `STEAM_WEB_API_KEY` no expone el secreto; solo su nombre).
  - _Requirements: 4.1, 4.3, 4.6_

- [ ] 25. [R0.4] Reparar/retirar agentes defectuosos y hacer que Warden consuma el chequeo determinista (sin crear agentes)
  - **Workstream:** R0.4 Harness Truth (REFACTOR / DELETE derivados de la tarea 23).
  - **Dependencies:** 23; **27** (dueÃ±a de la arquitectura determinÃ­stica de hooks/CI: el HOOK/CI
    destino del chequeo de Warden debe existir antes de que Warden deje de ejecutarlo por su cuenta).
  - **Preconditions:** matriz aplicada (tarea 23); la tarea 27 ya proveyÃ³ el HOOK/CI destino del
    chequeo determinista (para no crear/mover hooks desde aquÃ­).
  - **Objetivo:** hacer que el agente Warden **consuma/deje de correr** el chequeo determinista
    (tests/lint) que ahora vive en el HOOK/CI **propiedad de la tarea 27** â€” dejando al agente, si
    sobrevive, solo interpretar (P2); reparar o retirar los agentes con dependencias inexistentes
    (Artisan requiere un design system inexistente; Tracer requiere un MCP inexistente); y NO crear
    agentes nuevos. Esta tarea **solo toca `.claude/agents/*`**; NO crea ni mueve hooks/CI (eso es
    propiedad exclusiva de la tarea 27).
  - **Expected observable output:** ningÃºn agente corre un chequeo determinista; Warden (si sobrevive)
    solo interpreta y **consume** el chequeo determinista provisto por la tarea 27; Artisan/Tracer
    reparados o retirados; el conteo de agentes no aumenta.
  - **Write scope:** SOLO `.claude/agents/{warden,artisan,tracer}.md` (reparar/retirar y reapuntar
    Warden al chequeo de 27). **EXCLUYE explÃ­citamente** los hooks/CI (`.claude/settings.json` hooks,
    `verify-simplicity`, `sync-context`) â€” esos son write scope de la tarea 27. NO toca
    `evaluation-engineer`/`data-stat-engineer` (bien acotados) ni `chronicle`/`sentinel` salvo lo
    estrictamente necesario.
  - **Protected / DO NOT CHANGE:** P2 (determinismo por cÃ³digo, no por LLM); menos, no mÃ¡s â€” no se
    crean agentes nuevos (regla (a), requisito 4.4 c3); agentes bien acotados intactos; los hooks/CI
    son propiedad de la tarea 27, esta tarea no los crea ni mueve (evita solape de write scope).
  - **Implementation notes:** diseÃ±o Â§4.4 estado actual (7 agentes, 4 defectuosos), Harness
    Responsibility Matrix (REFACTOR Warden, REFACTOR/DELETE Artisan/Tracer), tabla de inconsistencias
    filas 2â€“3; requisito 4.4 c1â€“c3. El destino determinista del chequeo de Warden lo PROVEE la tarea
    27; aquÃ­ Warden solo lo consume o deja de correrlo.
  - **Verification:** TASK COMPLETION â€” inspecciÃ³n: ningÃºn agente ejecuta tests/lint; Warden consume el
    chequeo determinista de la tarea 27 (no lo ejecuta como agente); agentes con deps inexistentes
    reparados o retirados; cero agentes nuevos; ningÃºn hook/CI editado desde esta tarea.
  - **Acceptance criteria:** P2 cumplido para agentes; agentes defectuosos resueltos; no se crearon
    agentes nuevos; write scope limitado a `.claude/agents/*` sin colisiÃ³n con la tarea 27.
  - **Failure / stop conditions:** si reparar un agente exigiera crear otro â‡’ PROHIBIDO (requisito
    4.4 c3); retirar en su lugar.
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 4.4_

- [ ] 26. [R0.4] Agent Guardrail Architecture con mecanismo canÃ³nico determinista y circuit-breaker verificable
  - **Workstream:** R0.4 Harness Truth.
  - **Dependencies:** 23; 4 (referencia a path-normalization); 8 (referencia a required-skip â‰  PASS);
    21 (Â§9.2, SOLO para el guardrail de secretos).
  - **Preconditions:** matriz aplicada (tarea 23); Â§9.2 resuelta para el guardrail de secretos.
  - **Objetivo:** declarar los ocho guardrails (scope, tool/permission, write-scope, protected
    evidence, action, verification, loop/circuit-breaker, auditability) sobre los roles confirmados sin
    agregar agentes nuevos; aplicar la regla de dos ramas (determinista â‡’ `Permission | Hook | Test |
    CI | schema/invariant`; no determinista â‡’ `Policy/Rule` + independent verification + residual risk
    explÃ­cito, con discovery solo por falta de informaciÃ³n); implementar el circuit-breaker como
    polÃ­tica verificable (misma root cause repetida â‡’ stop + escalate a REPLAN/HUMAN; root cause
    distinta â‡’ su propia clasificaciÃ³n A/B/C/D, sin contar contra el breaker anterior, conectado con
    `attempts â†’ Tracer`); y REFERENCIAR los mecanismos deterministas ya existentes
    (write-scope-guard, data-boundary-guard, required-skip â‰  PASS, path-normalization de R0.1) en vez
    de duplicarlos.
  - **Expected observable output:** los ocho guardrails documentados con su mecanismo canÃ³nico; el
    guardrail de secretos usa `Permission`/secret (no prosa); el circuit-breaker es verificable; los
    guardrails deterministas referencian su mecanismo existente sin duplicar.
  - **Write scope:** documento de guardrails del harness (p.ej. `docs/agents/agent-guardrails.md`) y,
    donde el mecanismo canÃ³nico sea determinista y ya exista, referencia a `.claude/settings.json` /
    guards / CI sin duplicar. Coordina con la tarea 27 (hooks) para no colisionar.
  - **Protected / DO NOT CHANGE:** no se agregan agentes nuevos; se apoya en la Harness Responsibility
    Matrix sin reemplazarla; los guardrails deterministas existentes se referencian, no se duplican
    (regla (a)).
  - **Implementation notes:** diseÃ±o Â§4.4 Agent Guardrail Architecture (principio rector, regla de dos
    ramas, tabla de mapeo, notas de integraciÃ³n); requisito 4.8 c1â€“c6.
  - **Verification:** TASK COMPLETION â€” inspecciÃ³n: los ocho guardrails presentes; regla de dos ramas
    aplicada; circuit-breaker verificable; referencias (no duplicados) a mecanismos existentes.
  - **Acceptance criteria:** guardrails declarados sobre roles confirmados; crÃ­ticos deterministas con
    mecanismo canÃ³nico (no prosa); circuit-breaker verificable; secretos vÃ­a `Permission`/secret.
  - **Failure / stop conditions:** si un guardrail crÃ­tico solo puede quedar en prosa sin verificaciÃ³n
    independiente â‡’ FAIL de la regla de dos ramas; convertir a mecanismo determinista o aÃ±adir
    independent verification + residual risk.
  - **Risk level:** medio.
  - **Approval required?** No (documentar el nombre del secreto; nunca su valor).
  - _Requirements: 4.8_

- [x] 27. [R0.4] COMPLETE — Separar escaneo barato del regenerador y mover el trabajo pesado a su nivel
  - **Workstream:** R0.4 Harness Truth (REFACTOR / MOVE derivados de la tarea 23).
  - **Dependencies:** 23; 5 (PRE-PUSH gate existente); 10 (INTELLIGENCE CI cableado).
  - **Preconditions:** matriz aplicada; PRE-PUSH e INTELLIGENCE CI disponibles como destinos del
    trabajo pesado.
  - **Objetivo:** separar el escaneo estÃ¡tico barato (nivel AFTER EDIT) de la regeneraciÃ³n de
    `hub.html`, de modo que el escaneo no tenga efectos secundarios; convertir la regeneraciÃ³n de
    `hub.html` en una acciÃ³n explÃ­cita (no colateral de un gate); y mover el trabajo pesado (`tsc` +
    suites completas + backtest) del commit gate PreToolUse a PRE-PUSH / PR / CI, y el eval `--enforce`
    completo a INTELLIGENCE CI.
  - **Expected observable output:** el hook AFTER EDIT no regenera `hub.html`; `sync-context.ts` /
    regeneraciÃ³n es acciÃ³n explÃ­cita; el commit gate PreToolUse ya no corre `tsc`+suites+backtest;
    el eval pesado vive en INTELLIGENCE CI.
  - **Write scope:** `.claude/settings.json` (hooks PostToolUse/PreToolUse), `scripts/verify-simplicity.sh`
    (quitar el efecto secundario de regeneraciÃ³n del escaneo barato), `scripts/sync-context.ts`
    (acciÃ³n explÃ­cita). NO duplica el trabajo del PRE-PUSH/INTELLIGENCE CI ya cableado (tareas 5/10).
  - **Protected / DO NOT CHANGE:** el eval pesado no corre en pre-push (diseÃ±o Â§5); `verify-simplicity.sh`
    se conserva como gate determinista (KEEP+HARDEN), solo se le quita el efecto colateral.
  - **Implementation notes:** diseÃ±o Â§3.2, Â§4.4 filosofÃ­a de hooks + Harness Responsibility Matrix
    (REFACTOR verify-simplicity, MOVE commit gate Bash, MOVE sync-context); requisito 4.5 c1â€“c3.
  - **Verification:** TASK COMPLETION â€” el escaneo barato no tiene efectos secundarios; el trabajo
    pesado corre en su nivel; regeneraciÃ³n de `hub.html` es explÃ­cita.
  - **Acceptance criteria:** escaneo AFTER EDIT sin efectos; `hub.html` regenerado por acciÃ³n
    explÃ­cita; trabajo pesado en PRE-PUSH/CI e eval pesado en INTELLIGENCE CI.
  - **Failure / stop conditions:** si mover el trabajo pesado deja un nivel obligatorio sin cobertura
    â‡’ STOP (violarÃ­a P1); reubicar antes de retirar.
  - **Risk level:** medio.
  - **Approval required?** No.
  - _Requirements: 4.5_

- [ ] 28. [R0.4] Eliminar cÃ³digo muerto y corregir el estado invÃ¡lido de TSK-174
  - **Workstream:** R0.4 Harness Truth (DELETE derivados de la tarea 23).
  - **Dependencies:** 23.
  - **Preconditions:** matriz aplicada (confirma que son cÃ³digo muerto sin llamadores).
  - **Objetivo:** eliminar el cÃ³digo muerto `verify-claude-md-split.sh`, `analisis-arquitectura.sh`, el
    directorio vacÃ­o `.agents/` y `CHECKPOINT.json` (todo null); y corregir el estado invÃ¡lido de
    `TSK-174` (`state:in_progress`) a un valor vÃ¡lido del esquema.
  - **Expected observable output:** los cuatro artefactos muertos ya no existen; `TSK-174` tiene un
    `state` vÃ¡lido del esquema; el tablero derivado (`hub.ts`) no falla por ese estado invÃ¡lido.
  - **Write scope:** eliminar `scripts/verify-claude-md-split.sh`, `scripts/analisis-arquitectura.sh`,
    `.agents/`, `CHECKPOINT.json`; editar el frontmatter de `docs/agents/tasks/TSK-174.md`.
  - **Protected / DO NOT CHANGE:** `journal.md`/`ledger.md` append-only intactos; no se borra `.kiro/`;
    solo se elimina lo confirmado como muerto/invÃ¡lido (regla (a)).
  - **Implementation notes:** diseÃ±o Â§4.4 estado actual (doc drift, cÃ³digo muerto), Harness
    Responsibility Matrix (DELETE de los cuatro), tabla de inconsistencias filas 5â€“6; requisito 4.6
    c2â€“c3 (independiente de Â§9.2, no depende de Railway).
  - **Verification:** TASK COMPLETION â€” los archivos no existen; `TSK-174` valida contra el esquema;
    `bun scripts/hub.ts` no rompe por el estado.
  - **Acceptance criteria:** cÃ³digo muerto eliminado; `TSK-174` con estado vÃ¡lido; sin llamadores
    huÃ©rfanos.
  - **Failure / stop conditions:** si un supuesto "cÃ³digo muerto" resulta tener llamadores â‡’ NO
    eliminar; reclasificar en la matriz (posible clase B).
  - **Risk level:** bajo.
  - **Approval required?** No.
  - _Requirements: 4.6_

- [ ] 29. [R0.4] Harness Learning / Curation que PROPONE sin autoeditar
  - **Workstream:** R0.4 Harness Truth.
  - **Dependencies:** 23.
  - **Preconditions:** matriz/taxonomÃ­a definidas (tarea 23).
  - **Objetivo:** **racionalizar/reutilizar PRIMERO â€” NO crear automÃ¡ticamente un hook/script/skill
    nuevo.** El mecanismo de learning/curation que, al terminar una tarea, detecta candidatos de
    conocimiento durable a partir de los disparadores (repeated correction, architecture invariant
    changed, canonical command changed, repeated reusable procedure, new deterministic failure class,
    Dota domain fact discovered) y los clasifica hacia un destino Ãºnico (`CLAUDE.md` | `Rule` | `Skill`
    | `ADR` | `Hook/Test/Permission` | `Dota Domain Pack` | `nowhere`) DEBE apoyarse en el **mecanismo
    canÃ³nico que determine la Harness Responsibility Matrix (tarea 23)**. Si NINGÃšN mecanismo canÃ³nico
    existe y crear uno **ampliarÃ­a la arquitectura** (mÃ¡s, no menos), esta tarea NO lo introduce en
    silencio: produce una **PROPUESTA** (clasificaciÃ³n de candidatos + propuesta de mecanismo) para
    aprobaciÃ³n humana. En todos los casos el sistema PROPONE y NO autoedita `CLAUDE.md` ni ningÃºn
    artefacto de gobernanza â€” REGLA DURA: "propone, no autoedita".
  - **Expected observable output:** por defecto, dado un fin de tarea con disparadores, se emiten
    candidatos clasificados **como PROPUESTA** reutilizando el mecanismo canÃ³nico de la tarea 23;
    ninguna autoediciÃ³n de `CLAUDE.md`/gobernanza ocurre; ningÃºn hook/script/skill nuevo se crea sin
    aprobaciÃ³n previa.
  - **Write scope:** por defecto SOLO la salida de **propuesta/clasificaciÃ³n** (documento de
    candidatos) reutilizando el mecanismo canÃ³nico de la tarea 23. **NO crea hook/script/skill nuevo**
    sin aprobaciÃ³n explÃ­cita; NO escribe en `CLAUDE.md` ni artefactos de gobernanza.
  - **Protected / DO NOT CHANGE:** P2 (no autoediciÃ³n por LLM) y human-in-the-loop; "menos, no mÃ¡s" â€”
    no se multiplican mecanismos; el Dota Domain Pack solo se declara como destino, no se diseÃ±a en
    detalle (regla (a), requisito 4.4 filosofÃ­a).
  - **Implementation notes:** diseÃ±o Â§4.4 Harness Learning / Curation (disparadores, clasificaciÃ³n,
    REGLA DURA "propone, no autoedita") + Harness Responsibility Matrix (tarea 23) como fuente del
    mecanismo canÃ³nico; requisito 4.7 c1â€“c3.
  - **Verification:** TASK COMPLETION â€” el mecanismo reutiliza lo canÃ³nico (tarea 23) y produce
    propuestas clasificadas; no modifica ningÃºn artefacto de gobernanza automÃ¡ticamente; no introduce
    hook/script/skill nuevo sin aprobaciÃ³n.
  - **Acceptance criteria:** detecta y clasifica candidatos hacia destino Ãºnico reutilizando el
    mecanismo canÃ³nico; si no existe mecanismo canÃ³nico â‡’ emite PROPUESTA (no crea); propone sin
    autoeditar; revisiÃ³n humana requerida para persistir y para introducir cualquier mecanismo nuevo.
  - **Failure / stop conditions:** si el mecanismo autoedita cualquier artefacto de gobernanza â‡’ FAIL
    de la REGLA DURA; **crear un mecanismo nuevo (hook/script/skill) sin aprobaciÃ³n â‡’ FAIL** (amplÃ­a la
    arquitectura en silencio); corregir a solo-propuesta.
  - **Risk level:** bajo.
  - **Approval required?** No para emitir la propuesta; **sÃ­** para introducir cualquier mecanismo
    nuevo o persistir en gobernanza (lo valida un humano).
  - _Requirements: 4.7_

### CertificaciÃ³n final

- [ ] 30. [R0] R0 Baseline Certification â€” gate final (verifica y emite veredicto, NO arregla)
  - **Workstream:** transversal (gate de certificaciÃ³n; no arregla nada).
  - **Dependencies:** 1–29, 31, 32, 33, **34 y 35** (todas las demás tareas de este plan; 30 sigue
    siendo el gate final).
  - **Preconditions:** todos los workstreams completados; la tarea 33 (productor de eval
    corpus-opcional) en PASS y el **PO checkpoint commit** del estado R0 aceptado realizado; la tarea
    34 (S1 confiable + `EvaluationIdentity`/`metaSnapshotVersion`) en PASS con el **HUMAN OPERATIONAL
    CHECKPOINT** de generación de S1 realizado y su manifiesto/huella validados; la tarea 35
    (`REBASED_REFERENCE(S1)`) en PASS con el árbol principal limpio; las tareas con approval (20b
    promoción real + repunte del `--enforce`, 22 acción de persistencia) ejecutadas, documentadas como
    no procedentes, o — en el caso de la tarea 22 — derivadas a una Spec separada (en cuyo caso R0
    puede quedar **BLOCKED** hasta resolverse).
  - **Objetivo:** verificar y emitir un veredicto Ãºnico **R0 GREEN** o **R0 BLOCKED** con evidencia, sin
    arreglar nada. Verifica: (1) software correctness GREEN â€” las tres suites por el comando canÃ³nico
    `bun run test` en Windows y en CI con el mismo pin Bun exacto (convergencia P3); (2) Evaluation
    Instrument operativo (R0.2A) sin
    ningÃºn `SKIPâ†’PASS` en sub-checks `required` (Benchmark B ausente = `SKIPPED` informational, no
    PASS, no bloqueo); (3) candidate de R0.3 generado por el productor corpus-opcional (tarea 33) desde
    un HEAD limpio y trazable, medido sobre el **S1 confiable** (tarea 34) contra el **control V6
    rebasado** (tarea 35) en la tarea 19, con `EvaluationIdentity` compartida salvo `measuredEngineCommit`
    y `metaSnapshotVersion` coincidente; (4) las promociones necesarias explÃ­citamente aprobadas (T.4)
    — `v6-measured.json` permanece como `HISTORICAL_REFERENCE_S0` inmutable y el `--enforce` por defecto
    solo se re-apunta tras la tarea 20 con Task 19 PASS + aceptación; (5) `required` SKIPPED/BLOCKED =
    ninguno; (6) harness obligatorio operativo â€” PRE-PUSH gate real y guards OS-independientes
    fail-closed; (7) sin contradicciones materiales introducidas por R0 (incluida: ningún texto sigue
    diciendo que `e0b77d7` es el motor medido, ni que un snapshot `7.41e` es automáticamente comparable,
    ni que se admite fallback de harness viejo).
  - **Expected observable output:** un reporte de certificaciÃ³n con veredicto **R0 GREEN** o **R0
    BLOCKED** y la evidencia por cada uno de los siete puntos; si hubo acciones que requirieron
    approval (20, 22), las reporta como tal; documenta los artefactos protegidos
    (`HISTORICAL_REFERENCE_S0`, S1 congelado, `reference.s1.json` como `REBASED_CONTROL`).
  - **Write scope:** el reporte de certificaciÃ³n (p.ej. `docs/agents/r0-certification.md`). No modifica
    cÃ³digo ni artefactos de producto (no arregla).
  - **Protected / DO NOT CHANGE:** esta tarea no repara nada; solo verifica y reporta. NingÃºn artefacto
    protegido se toca (regla (a)).
  - **Implementation notes:** diseÃ±o Â§2.1 (definiciÃ³n de GREEN, P1â€“P5), Â§5 (niveles/clases), Â§10 (CP);
    requisitos T.1, T.2, y agregaciÃ³n de 1.x/2A.x/3.x/2B.x/4.x. Reporta lo que requiriÃ³ approval.
  - **Verification:** agregaciÃ³n read-only de los artefactos de evidencia de las tareas previas; no
    ejecuta reparaciones.
  - **Acceptance criteria:** veredicto emitido con evidencia reproducible; **R0 GREEN** solo si los
    siete puntos se cumplen; de lo contrario **R0 BLOCKED** con la evidencia del bloqueo.
  - **Failure / stop conditions:** cualquier punto sin evidencia reproducible â‡’ **R0 BLOCKED** (no se
    fuerza GREEN). En particular, si la deuda de persistencia/migraciÃ³n de Railway (tarea 22) resultÃ³
    **material o fuera de alcance R0** y se derivÃ³ a una Spec separada sin resolverse con approval,
    **R0 queda BLOCKED** hasta que esa deuda se resuelva. No arregla â€” reporta para que la causa se
    enrute al bucle Â§6.
  - **Risk level:** bajo.
  - **Approval required?** No (pero reporta lo que requiriÃ³ approval).
  - _Requirements: T.1, T.2, 1.1, 2A.1, 2A.2, 2B.1, 2B.2, 2B.3, 2B.4_

---

## Notes

- Las tareas de test (candados de regresiÃ³n, tests deterministas, property tests) estÃ¡n integradas en
  el contrato de verificaciÃ³n de cada tarea, no como tareas standalone (diseÃ±o Â§10 / Testing Strategy).
- Las correctness properties CP1â€“CP12 se verifican con el **harness/PRNG determinista existente**
  (`batch-harness`, Mulberry32/SeededRng), **sin** adoptar una librerÃ­a PBT nueva en R0. CP12
  (determinismo lógico de la evaluación, metadato efímero excluido) se añade con el replan R0.2B de
  S1/control rebasado.
- CP2, CP5 y CP10 llevan candado de regresiÃ³n cero: se verifican en rojo antes de darlos por bueno.
  El candado CP5 (`Î£ SCORING_WEIGHTS_V6 == 1.0`) es verificaciÃ³n pura: vive en el contrato de la tarea
  13 y se agrega en el checkpoint 18 (la antigua responsabilidad no ejecutable del ID 17 quedÃ³
  absorbida; el ID 17 actual sÃ­ es la tarea ejecutable de TSK-098).
- Las tareas de discovery (1, 7, 21) son read-only salvo su artefacto de evidencia; desbloquean tareas
  nombradas y no arreglan.
- La tarea **17** (R0.1) toma ownership del blocker **TSK-098** (timeout de `app.test.ts`, cuentas
  HTTP multi-tenant) â€” un gap Taskâ†’Requirement descubierto en ejecuciÃ³n: la tarea 2 aislÃ³ el fallo como
  no-path y lo dejÃ³ correctamente fuera de su scope, pero ninguna tarea previa era dueÃ±a de repararlo,
  aunque el requisito 1.1 y el checkpoint 18 exigen la suite engine GREEN. La tarea 17 no es discovery,
  no es conditional y no requiere approval (salvo el STOPâ†’REPLAN si la root cause resulta ser lÃ³gica de
  producto). El ID 17 fue reasignado desde una nota de absorciÃ³n de CP5 (que era no-ejecutable) a esta
  tarea ejecutable de R0.1; la responsabilidad de CP5 se preserva en la tarea 13 + checkpoint 18.
- La tarea **31** es el owner ejecutable nuevo y acotado de Canonical Bun Toolchain Truth. Se inserta
  fÃ­sicamente en R0.1 antes de la certificaciÃ³n, aunque su ID sea 31, y no absorbe Task 3 ni reabre
  automÃ¡ticamente Task 17. Tras el STOP correctamente activado por cambio semÃ¡ntico, su lÃ­mite queda
  reducido a toolchain local/CI/Docker + lockfiles; continÃºa desde el estado parcial sin revertirlo.
- La tarea **32** es el owner separado de Runtime Compatibility / TSK-098 Evidence Migration. Conserva
  la validez histÃ³rica de Task 17 bajo Bun 1.3.14 y migra Ãºnicamente test harness/evidencia al runtime
  canÃ³nico 1.4.2; no toca producto, toolchain ni dependencias web.
- Las tareas/aspectos con approval humano â€” **20b** (promociÃ³n REAL de baseline a `accepted.s1.json` +
  repunte del `--enforce` por defecto; el mecanismo 20a no requiere approval) y **22** (acciÃ³n de
  persistencia/migraciÃ³n, CONDITIONAL sobre la acciÃ³n concreta propuesta por 21) â€” son
  irreversibles/sensibles (T.4) y no se ejecutan sin aceptaciÃ³n explÃ­cita. El replan R0.2B **no añade
  ningún approval nuevo**: la generación real de S1 (tarea 34) es un **HUMAN OPERATIONAL CHECKPOINT**
  (acción operativa humana de trazabilidad/reproducibilidad), del mismo tipo que el PO checkpoint
  commit — no consume approval de acción de alto riesgo.
- La tarea **33** (R0.2B) repara el **productor** de `bun run eval` (`scripts/eval/run.ts`) para que
  genere un candidate válido con **Benchmark A medido** y **Benchmark B `SKIPPED` informational**
  cuando falta `pro-drafts.sqlite`; con el corpus presente, el Benchmark B real se preserva. No toca
  `gate.ts` ni `benchmark-pro-agreement.ts`, no fabrica corpus ni métricas pro y no convierte
  Benchmark B en PASS. Es prerequisito de la tarea **34** (`33 → 34 → [HUMAN S1 CHECKPOINT] → 35 →
  19`); entre 33 y 34, el PO hace un checkpoint commit del estado R0 aceptado (acción humana de
  trazabilidad, **no** approval de acción sensible). El candidate se genera desde un HEAD limpio y
  trazable (`git status --porcelain` sin cambios en `apps/engine/src/**` ni `scripts/eval/**`).
- La tarea **34** (R0.2B) define el **builder** del snapshot de meta congelado (S1) y el modelo de
  `EvaluationIdentity` con `metaSnapshotVersion` (huella de contenido lógico SHA-256 completo, nunca el
  SHA crudo del SQLite) + `EvaluationMetadata` (`measuredEngineCommit`/`evaluationHarnessCommit` de
  procedencia, no deciden `isComparable()`). `v6-measured.json` pasa a `HISTORICAL_REFERENCE_S0`
  inmutable (su métrica ≈ `0.73642646699061` corresponde al motor `df354b9`, no a `e0b77d7`). La
  generación real de S1 es un HUMAN OPERATIONAL CHECKPOINT (DB temporal fresca → sync → `status=ok` →
  validar → congelar; descartar la DB ante cualquier fallo). El bug no-transaccional de `syncMatchups`
  es un defecto real **no bloqueante de R0** → ticket de hotfix futuro separado.
- La tarea **35** (R0.2B) produce `REBASED_REFERENCE(S1)` (`eval/baselines/reference.s1.json`) corriendo
  el motor VIEJO (`df354b9`) sobre el **mismo** S1 con el harness **actual**, vía overlay de
  `apps/engine/src/**` en un git worktree temporal (árbol principal intacto). Si el motor viejo no
  compila/corre contra el harness actual ⇒ **STOP / REPLAN**, nunca fallback de harness viejo.
  `reference.s1.json` es un `REBASED_CONTROL`, **no** un baseline aceptado; la tarea 35 no re-apunta el
  `--enforce` por defecto (solo config de ruta acotada si hace falta).
- La tarea 30 (Certification) es un gate que solo verifica y emite veredicto; no arregla.

## Total de tareas

**35 tareas ejecutables.** Las tareas **31** y **32** viven en R0.1 para separar Toolchain Truth de
Runtime Compatibility / Evidence Migration; las tareas **33**, **34** y **35** viven en R0.2B en la
cadena `18 -> 33 -> 34 -> [HUMAN S1 CHECKPOINT] -> 35 -> 19` (33 repara el productor de `bun run
eval`; 34 construye el S1 confiable + `EvaluationIdentity`/`metaSnapshotVersion`; 35 rebasa el control
V6 sobre ese S1; ver `Task 19 Identity Preflight = BLOCKED` /
`Snapshot Recovery Preflight = NO_TRUSTWORTHY_SNAPSHOT`). Sin renumerar 1-33 ni reutilizar la tarea 6
(que conserva la cobertura del requisito 1.4). El conteo incluye 3 tareas de discovery (1, 7, 21) y 2
gates transversales (tarea 18 checkpoint y tarea 30 certification).

**DecisiÃ³n de numeraciÃ³n:** todos los marcadores top-level siguen usando IDs enteros; no se introducen
IDs alfanumÃ©ricos ni decimales. No existe en el repo un validador adicional de este `tasks.md` que exija
orden numÃ©rico fÃ­sico; las specs observadas usan marcadores enteros y este mismo plan ya admite
dependencias hacia un ID mayor (`3 â† 23`). Por eso 31 y 32 viven en la secciÃ³n R0.1 y el nodo fÃ­sico
final sigue siendo 30. Los IDs 1-33 se conservan sin renumerar; **34 y 35 son IDs enteros nuevos** en
la seccion R0.2B (S1 confiable + control V6 rebasado), anadidos por el replan de reproducibilidad de
evaluacion aceptado por el PO. La antigua nota "No se crea ninguna tarea 34" queda superada por este
replan.

## Critical path

`2 â†’ 23` y `2, 4 â†’ 17` convergen en `17, 23 â†’ 31 â†’ 32 â†’ 3 â†’ 5` (R0.1: Toolchain Truth,
migraciÃ³n de evidencia runtime, restauraciÃ³n web y cierre del gate local), en paralelo con `1`
(discovery) â†’ habilita el instrumento â†’
`8 â†’ 9 â†’ 10 (R0.2A)` â†’
`11 â†’ 12 â†’ 13 â†’ 14 â†’ 16 (R0.3; CP5 se preserva como verificaciÃ³n en 13/18)` â†’
`18 (checkpoint, nodo formal — depende también de 17, 31, 32 y 3)` → `33 (productor de eval
corpus-opcional)` → **[PO checkpoint commit — acción humana, no una Task]** → `34 (S1 confiable +
EvaluationIdentity/metaSnapshotVersion)` → **[HUMAN S1 CHECKPOINT — generación real de S1, acción
operativa humana, no una Task]** → `35 (control V6 rebasado sobre S1)` → `19 (CURRENT_ENGINE(S1) vs
REBASED_OLD_ENGINE_CONTROL(S1)) → 20 (R0.2B)` → `30 (R0 Baseline Certification)`. La cadena de R0.1
hacia el checkpoint es
`… R0.1 (17, 23 → 31 → 32 → 3 → 5) … → 18 → 33 → [PO checkpoint commit] → 34 → [HUMAN S1 CHECKPOINT] →
35 → 19 → 20 → 30`.

Cadena de workstreams: **R0.1 â†’ R0.2A â†’ R0.3 â†’ R0.2B â†’ Certification**. Nota: la tarea 23 (Matrix)
entra temprano (wave 1, tras la tarea 2) porque desbloquea a 31, que desbloquea 32 y luego 3, ademÃ¡s
de las tareas de R0.4.

## Tareas paralelizables

Solo **ALGUNAS** tareas de R0.4 son paralelizables respecto a R0.2A/R0.3; **R0.4 NO es paralelizable en
bloque**. Respetando las dependencias reales:

- **PrecondiciÃ³n de R0.4:** la tarea **23 (Harness Responsibility Matrix)** es precondiciÃ³n de las
  demÃ¡s de R0.4 (24, 25, 26, 27, 28, 29 dependen de 23). No puede paralelizarse con ellas; corre
  primero (wave 1, tras la tarea 2 que estabiliza suites).
- **SÃ­ paralelizables respecto a R0.2A/R0.3** (write scope disjunto del motor `apps/engine/src/signals/`
  y del eval `scripts/eval/`), una vez hecha la tarea 23: **28** (borra cÃ³digo muerto), **29** (produce
  propuesta de learning/curation) y, con la salvedad de docs abajo, **24**.
- **NO paralelizables sin condiciÃ³n:**
  - **27** depende de **5** (PRE-PUSH gate local) y **10** (INTELLIGENCE CI) ademÃ¡s de **23** â€” no
    puede correr antes de que existan esos destinos; cae en wave 6.
  - **25** depende de **27** (Warden consume el chequeo determinista cuyo HOOK/CI es propiedad de 27) â€”
    va despuÃ©s de 27 (wave 7); su write scope se limita a `.claude/agents/*` para no colisionar con los
    hooks/CI de 27.
  - **24** comparte write scope de **docs** con la tarea **6** (comandos documentados) â€” deben ir en
    waves distintas (6 en wave 0, 24 en wave 2) para no colisionar.
  - **26** referencia (sin duplicar) los hooks/CI que posee **27**; se mantiene en wave distinta (2 vs
    6) para no colisionar `.claude/settings.json`.
  - **31** escribe `package.json`, CI, el Ãºnico `Dockerfile` y `verify-simplicity.sh` en wave 2;
    **32** escribe solo `app.test.ts` + evidencia en wave 3; **27** toca la arquitectura posterior de
    hooks/CI en wave 6 y depende transitivamente de 31 por `27 â† 5 â† 3 â† 32 â† 31`. Task 27 no posee
    Docker y 31/32 tienen scopes disjuntos; no pueden colisionar.
  - **33, 34, 35** (R0.2B) son **seriales** en el camino crítico entre el checkpoint 18 y la tarea 19,
    en la cadena `33 -> 34 -> [HUMAN S1 CHECKPOINT] -> 35 -> 19`. Sus write scopes
    (`scripts/eval/run.ts`/`run.test.ts`/`report.ts` en 33; `scripts/eval/{snapshot,evaluation-identity,run}.ts`
    + `eval/snapshots/S1.*` + excepción `.gitignore` en 34; `scripts/eval/rebased-reference.ts` +
    `eval/baselines/reference.s1.json` + config acotada del gate en 35) no colisionan con ninguna otra
    wave, pero no se paralelizan entre sí: 34 depende de 33, 35 de 34, 19 de 35. Entre 33 y 34 hay una
    acción humana (PO checkpoint commit del estado R0 aceptado); entre 34 y 35, el HUMAN OPERATIONAL
    CHECKPOINT de generación real de S1. `run.ts` es tocado por 33 y por 34 en waves distintas
    (nunca a la vez).
  - **22** (persistencia/migraciÃ³n) es CONDITIONAL y depende de **21** + approval sobre la acciÃ³n
    concreta â€” nunca se paraleliza ni se fuerza.
- **Discovery independientes:** tarea 1 (PRE-PUSH/WSL), tarea 7 (`pro-drafts.sqlite`) y tarea 21
  (Railway env/persistencia) no dependen entre sÃ­ y corren en paralelo en la wave 0.
- **Write scope aislado dentro de R0.3:** 15 (`openingStrategy`, mÃ³dulo aparte) es independiente de
  11â€“14/16 y sube a la wave 0. La tarea 17 actual es ejecutable pero pertenece a R0.1 y ya termina antes
  de 31; Task 32 ocurre despuÃ©s de 31 y su scope test-only es disjunto de R0.3. La cadena de
  `mix.ts` (11 â†’ 12 â†’ 13 â†’ 14 â†’ 16) se serializa en waves distintas para que dos tareas nunca escriban
  ese archivo a la vez.
- No se fuerza paralelizaciÃ³n donde aumente el riesgo (persistencia/migraciÃ³n, promociÃ³n de baseline).

## Tareas de discovery (y quÃ© desbloquea cada una)

| Tarea | Discovery (diseÃ±o Â§9) | Desbloquea (granular) |
|---|---|---|
| 1 | Â§9.7 PRE-PUSH gate cableado a `.husky` + Â§9.6 WSL/Windows | IMPLEMENTACIÃ“N del PRE-PUSH gate (tarea 5, req 1.5); alcance de convergencia P3 (req 1.1, T.2) |
| 7 | Â§9.3 ubicaciÃ³n/disponibilidad de `pro-drafts.sqlite` | SOLO el sub-check Pro Agreement / Benchmark B (tareas 8, 33 y 19; req 2A.1, 2B.1); la tarea 33 hace opcional su ausencia. Engine Quality / Benchmark A avanza sin Ã©l |
| 21 | Â§9.2 env vars Railway; Â§9.1 volumen persistente; Â§9.4 migraciones | Â§9.2 â†’ documentar `STEAM_WEB_API_KEY` (tarea 24, req 4.6 c1) y guardrail de secretos (tarea 26, req 4.8 c2); Â§9.1/Â§9.4 â†’ **ACCIÃ“N PROPUESTA** concreta de persistencia/migraciÃ³n que la tarea 22 ejecuta solo bajo approval (T.4) |

## Tareas condicionales

| Tarea | CondiciÃ³n | Se ejecuta solo si |
|---|---|---|
| 22 | La discovery (21) determina necesaria una acciÃ³n de persistencia/migraciÃ³n y emite una **ACCIÃ“N PROPUESTA** concreta | Hay approval humano explÃ­cito sobre esa acciÃ³n concreta **y** el cambio no es material/fuera de alcance R0. Si es material/fuera de alcance â‡’ **Spec separada + R0 BLOCKED**, no se ejecuta |
| 20 (aspecto b) | La tarea 19 dio **PASS** (eval `CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)` verde y reproducible) | Hay aceptaciÃ³n humana explÃ­cita de la promociÃ³n real de `CURRENT_CANDIDATE(S1)` a `accepted.s1.json` **y** del repunte del `--enforce` por defecto; el aspecto (a), el mecanismo `promoteCandidate`, no es condicional (cÃ³digo + test, sin approval). `v6-measured.json` (`HISTORICAL_REFERENCE_S0`) nunca se promueve |

## Tareas / aspectos que requieren aprobaciÃ³n humana

| Tarea / aspecto | AcciÃ³n irreversible/sensible | Requisito |
|---|---|---|
| **20b** (promociÃ³n REAL) | PromociÃ³n de `CURRENT_CANDIDATE(S1)` a nuevo baseline aceptado (`accepted.s1.json`) **+ repunte del `--enforce` por defecto**, solo con la tarea 19 en PASS. El aspecto **20a** (mecanismo `promoteCandidate`) NO requiere approval | 2B.2, 2B.4, T.4 |
| **22** (acciÃ³n de persistencia) | Persistencia/migraciÃ³n de producciÃ³n en Railway (volumen/migraciones), bajo approval **sobre la acciÃ³n concreta** propuesta por la tarea 21 | T.4 |

Nota: la certificaciÃ³n (tarea 30) no requiere approval, pero **reporta** lo que lo requiriÃ³ (20b, 22) y
marca **R0 BLOCKED** si la deuda de la tarea 22 se derivÃ³ a Spec separada sin resolverse. El replan
R0.2B (S1 + control V6 rebasado) **no añade ningún approval nuevo**.

## Acciones humanas de trazabilidad (NO approval de acción sensible)

| Acción humana | Cuándo | Naturaleza |
|---|---|---|
| **PO checkpoint commit** del estado R0 aceptado | Después de la tarea 33 en PASS y aceptación del PO, **antes** de la tarea 34 | Gate humano de trazabilidad/reproducibilidad. **No** es operación irreversible/sensible; **no** consume approval de acción de alto riesgo. No lo ejecuta ningún agente ni ninguna Task de implementación (no se ejecuta en la sesión de patch de Spec). Su objeto: que el candidate de la tarea 19 se mida sobre un HEAD limpio y trazable con todos los cambios R0 aceptados. |
| **HUMAN S1 CHECKPOINT** — generación real del S1 confiable vía el builder aprobado de la tarea 34 | Después de aceptar el código/tests de la tarea 34, **antes** de que la tarea 34 pase a PASS y antes de la tarea 35 | Checkpoint operativo humano de trazabilidad/reproducibilidad. **No** es operación irreversible/sensible; **no** consume approval de acción de alto riesgo (corre un sync de meta contra una **DB temporal desechable**, nunca producción). No lo ejecuta ningún agente ni la sesión de patch de Spec. Proceso: DB temporal fresca → migrar → sync canónico → `status=ok` → validar → congelar → fingerprint → manifiesto; descartar la DB ante cualquier fallo (sin artefacto). La tarea 34 no pasa a PASS hasta que el manifiesto y la huella lógica validen. |

## Trazabilidad Task â†’ Requirement

| Task | Requisitos que valida | Correctness properties |
|---|---|---|
| 1 | 1.5, 1.1, T.2 | (discovery) |
| 2 | 1.1 | CP6 (borde de convergencia) |
| 3 | 1.2, 4.3 | â€” |
| 4 | 1.3 | **CP6** / Property 6 |
| 5 | 1.5, 1.1, T.2 | â€” |
| 6 | 1.4 | â€” |
| 7 | 2A.1, 2B.1 | (discovery) |
| 8 | 2A.1 | **CP1** / Property 1 |
| 9 | 2A.2 | **CP8** (compatibilidad) / Property 8 |
| 10 | 2A.3, T.2 | CP1 (enforce) |
| 11 | 3.2 | **CP3** / Property 3 |
| 12 | 3.2, 3.3 | **CP3**, **CP3b** / Property 3, 11 |
| 13 | 3.1, **3.6** (CP5 absorbida) | **CP2**, **CP4**, **CP5**, **CP10** / Property 2, 4, 5, 10 |
| 14 | 3.4 | **CP7** / Property 7 |
| 15 | 3.5 | **CP9** / Property 9 |
| 16 | 3.2 | CP3 (evidencia observable) |
| 17 | 1.1, T.2 (ownership de TSK-098; suite engine GREEN) | â€” (candado de regresiÃ³n en rojo del test TSK-098; sin CP nueva) |
| 18 | (checkpoint) | agrega CP2/CP3/**CP5**/CP6/CP7/CP9/CP10 |
| 19 | 2B.1, **2B.4**, T.4 | **CP8** (compatibilidad `metaSnapshotVersion`), **CP12** (determinismo lógico) — `CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)` |
| 20 | 2B.2, **2B.4**, T.4 | **CP8** (promoción a `accepted.s1.json` + repunte del default, aspecto 20a mecanismo) / Property 8 |
| 21 | 4.6, 4.8, T.4 | (discovery) |
| 22 | T.4 | â€” |
| 23 | 4.2, 4.3 | â€” |
| 24 | 4.1, 4.3, 4.6 | â€” |
| 25 | 4.4 | â€” |
| 26 | 4.8 | â€” |
| 27 | 4.5 | â€” |
| 28 | 4.6 | â€” |
| 29 | 4.7 | â€” |
| 30 | T.1, T.2, 1.1, 2A.1, 2A.2, 2B.1, 2B.2, 2B.3, 2B.4 | agrega CP1â€“CP12 (incluida CP12 del replan R0.2B) |
| 31 | 1.1, 4.1, T.1, T.2 | Toolchain Truth local/CI/Docker + tres lockfiles; sin CP nueva |
| 32 | 1.1, T.1, T.2 | migra/revalida evidencia TSK-098 y software bajo Bun 1.4.2; sin CP nueva |
| 33 | 2B.1 (productor de candidate corpus-opcional; Benchmark A medible sin `pro-drafts.sqlite`) + política de sub-checks de 2A.1 | — (candado de regresión en rojo: `SQLITE_CANTOPEN` del productor actual; sin CP nueva) |
| 34 | **2B.3** (S1 reproducible + `EvaluationIdentity`/`metaSnapshotVersion` + procedencia motor/harness) + **2A.2 c5–c9** | **CP8** (compatibilidad por `metaSnapshotVersion`, `snapshotFileSha` excluido), **CP12** (determinismo lógico) — tests: falsa comparabilidad, mismos datos lógicos/distintos bytes ⇒ misma identidad, mismo `patchLabel`/datos distintos ⇒ identidad distinta, legacy S0 sin `metaSnapshotVersion` ⇒ BLOCKED, sync fallido nunca congela S1 |
| 35 | **2B.4** (control V6 rebasado sobre S1 + cableado acotado de la tarea 19) + 2B.1, 2A.2 c7 | **CP8** (`reference.s1.json` = `REBASED_CONTROL`, no baseline aceptado; `--enforce` por defecto sin re-apuntar antes de la tarea 20), **CP12** — overlay incompatible ⇒ STOP/REPLAN, sin fallback de harness viejo |

Cobertura: requisitos **1.1â€“1.5** (tareas 1â€“6, **mÃ¡s 17 que cierra el blocker TSK-098, 31 que fija
Toolchain Truth y 32 que migra/revalida la evidencia bajo el runtime canÃ³nico â€” el requisito 1.1 queda
con ownership completo de la suite engine GREEN bajo el pin canÃ³nico**), **2A.1â€“2A.3** (7â€“10), **3.1â€“3.5** (11â€“16) y **3.6**
(cubierto por la verificaciÃ³n de la tarea 13 + checkpoint 18, como nota de R0.3 sobre CP5),
**2B.1â€“2B.4** (19â€“20, mÃ¡s 33 que repara el productor de candidate corpus-opcional, **34 que construye
el S1 confiable + `EvaluationIdentity`/`metaSnapshotVersion`, y 35 que rebasa el control V6 sobre ese
S1**), **4.1â€“4.8** (21, 23â€“29, 31), **T.1â€“T.4** (4, 8, 10, 20, 22, 30, 31, 32, 33, **34, 35**). Las
12 correctness properties (CP1â€“CP10 + CP3b/Property 11 + **CP12/Property 12**) quedan cubiertas vÃ­a
sus requisitos: CP1â†’2A.1 (T8); CP2/CP4/CP10â†’3.1 (T13); CP3â†’3.2 (T11/12/16); CP3bâ†’3.3 (T12);
**CP5â†’3.6 (verificaciÃ³n en T13 + Checkpoint 18)**; CP6â†’1.3 (T4); CP7â†’3.4 (T14);
**CP8â†’2A.2/2B.2/2B.4 (T9/T20/T34/T35)**; CP9â†’3.5 (T15); **CP12â†’2B.3 (T34, verificada tambiÃ©n en
T35/T19)**. El requisito
**3.6 sigue cubierto**: reasignar el ID 17 a la tarea de R0.1 no deja 3.6/CP5 sin cobertura, porque preservar el candado
`Î£ SCORING_WEIGHTS_V6 == 1.0` es verificaciÃ³n (tarea 13) + agregaciÃ³n (checkpoint 18), no una tarea de
implementaciÃ³n separada.

## Task Dependency Graph

Recalculado ESTRICTAMENTE desde los campos **Dependencies** finales de cada tarea, incluido el replan de
Toolchain Truth + Runtime Compatibility. El checkpoint 18 es un nodo con posiciÃ³n propia; las tareas
17, 31 y 32 aparecen como ejecutables reales.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "4", "6", "7", "15", "21"] },
    { "id": 1, "tasks": ["8", "17", "22", "23"] },
    { "id": 2, "tasks": ["9", "24", "26", "28", "29", "31"] },
    { "id": 3, "tasks": ["10", "11", "32"] },
    { "id": 4, "tasks": ["3", "12"] },
    { "id": 5, "tasks": ["5", "13"] },
    { "id": 6, "tasks": ["14", "27"] },
    { "id": 7, "tasks": ["16", "25"] },
    { "id": 8, "tasks": ["18"] },
    { "id": 9, "tasks": ["33"] },
    { "id": 10, "tasks": ["34"] },
    { "id": 11, "tasks": ["35"] },
    { "id": 12, "tasks": ["19"] },
    { "id": 13, "tasks": ["20"] },
    { "id": 14, "tasks": ["30"] }
  ]
}
```

> Acciones humanas entre nodos (no son tasks, no alteran el grafo): **PO checkpoint commit** entre
> wave 9 (33) y wave 10 (34); **HUMAN S1 CHECKPOINT** (generación real de S1) entre wave 10 (34) y
> wave 11 (35).

> Nota sobre el grafo (derivaciÃ³n desde Dependencies):
> - Los IDs son las tareas de nivel superior (no hay sub-tasks con notaciÃ³n decimal; el contrato de
>   cada tarea vive en sub-bullets). Las tareas 31 y 32 son IDs enteros top-level y se ubican antes de
>   30 por dependencias; no se renumera ninguna tarea existente.
> - Cada tarea aparece en una wave POSTERIOR a TODAS sus dependencias declaradas:
>   **31** (dep 17,23) estÃ¡ en wave 2; **32** (dep 31) estÃ¡ en wave 3; **3** (dep 23,32)
>   estÃ¡ en wave 4; **5** (dep 1,2,3) estÃ¡ en wave 5; **27** (dep 23,5,10) estÃ¡ en wave 6;
>   **17** (dep 2,4) estÃ¡ en wave 1,
>   POSTERIOR a la tarea 2 y ANTERIOR a 31/checkpoint 18.
> - El **checkpoint 18** es un nodo real (wave 8), no una nota narrativa: depende de
>   2,3,4,5,6,8,9,10,11,12,13,14,15,16,**17,31,32** y es **dependencia formal de 33** (wave 9), que a
>   su vez es dependencia formal de **34** (wave 10), **35** (wave 11) y **19** (wave 12). Entre 33 y
>   34 hay una **acción humana** (PO checkpoint commit del estado R0 aceptado); entre 34 y 35, el
>   **HUMAN S1 CHECKPOINT** (generación real de S1). Ninguna de las dos es un nodo de tareas ni altera
>   el grafo.
> - La cadena de R0.3 que escribe `apps/engine/src/signals/mix.ts` (**11 â†’ 12 â†’ 13 â†’ 14 â†’ 16**) se
>   distribuye en waves 3â†’4â†’5â†’6â†’7, de modo que **nunca dos tareas escriben ese archivo en la misma
>   wave**. La tarea 15 (`openingStrategy`, mÃ³dulo aislado) sube a la wave 0.
> - **26** depende de 4, 8, 21, 23 (todas â‰¤ wave 1) â‡’ wave 2. Su write scope es el documento de
>   guardrails + **referencias** a mecanismos existentes (no duplica), y queda en wave distinta de la
>   27 (wave 6, dueÃ±a de los hooks/CI) para no colisionar `.claude/settings.json`.
> - **31** (wave 2, toolchain local/CI/Docker), **32** (wave 3, test harness) y **27** (wave 6,
>   hooks/CI) escriben scopes disjuntos/en waves distintas; Task 27 no posee Docker y la cadena
>   `31 â†’ 32 â†’ 3 â†’ 5 â†’ 27` las serializa.
> - La tarea **33** (productor de eval corpus-opcional, dep 18,7) está en wave 9. No absorbe la tarea
>   19 ni toca `gate.ts` / `benchmark-pro-agreement.ts`; su write scope (`scripts/eval/run.ts` /
>   `run.test.ts` / `report.ts`) está solo en su wave.
> - La tarea **34** (S1 confiable + `EvaluationIdentity`/`metaSnapshotVersion`, dep 18,33) está en
>   wave 10; **35** (control V6 rebasado sobre S1, dep 34,18,33) en wave 11; **19**
>   (`CURRENT_ENGINE(S1)` vs `REBASED_OLD_ENGINE_CONTROL(S1)`, dep 18,33,34,35,7) en wave 12. Sus write
>   scopes (34: `scripts/eval/{snapshot,evaluation-identity,run}.ts` + `eval/snapshots/S1.*` +
>   excepción `.gitignore`; 35: `scripts/eval/rebased-reference.ts` + `eval/baselines/reference.s1.json`
>   + config acotada del gate; 19: invocación/artefacto de veredicto en INTELLIGENCE CI +
>   `candidate.s1.json`) están cada uno en su wave; `run.ts` lo tocan 33 (wave 9) y 34 (wave 10) en
>   waves distintas, nunca a la vez. Ninguna de las tres re-apunta el baseline aceptado por defecto ni
>   modifica `v6-measured.json` / `evaluateGate()`.
> - La tarea 30 (certification) es el gate final (wave 14) tras todo lo demÃ¡s.

## Consistency Validation

ValidaciÃ³n ejecutada tras el replan mÃ­nimo de Toolchain Truth, derivada estrictamente de los campos
**Dependencies** finales y de los **Write scope** de cada tarea.

### 1. DAG acÃ­clico (sin ciclos)
- **PASS.** Se detectÃ³ y resolviÃ³ un ciclo introducido al combinar C1 + C11: la tarea 3 depende de 23
  (C1, procedimiento canÃ³nico de deps), la tarea 5 depende de 3 (existente), y anclar 23 en 5 (C11)
  habrÃ­a cerrado `3 â†’ 23 â†’ 5 â†’ 3`. **ResoluciÃ³n:** la Matrix (tarea 23) se ancla en la tarea **2**
  (suites estabilizadas) â€” un punto de estabilidad de R0.1 que NO depende transitivamente de 23 â€” en
  lugar de la tarea 5. La dependencia sobre el gate local (5) vive en las tareas de R0.4 que lo
  consumen (27), no en la Matrix. El nuevo tramo `17,23 â†’ 31 â†’ 32 â†’ 3 â†’ 5 â†’ 27` solo agrega aristas
  hacia adelante. Orden topolÃ³gico resultante (por waves): 0â†’1â†’2â†’â€¦â†’14, sin ciclos. Las aristas del
  replan R0.2B â€” productor (`33 â† 18,7`) y S1/control rebasado (`34 â† 18,33`, `35 â† 34,18,33`,
  `19 â† 18,33,34,35,7`, `20 â† 19`, `30 â† 34,35`) â€” apuntan todas hacia adelante (W9 â† W8/W0;
  W10 â† W9/W8; W11 â† W10; W12 â† W11; W13 â† W12; W14 â† W11) y no introducen ningÃºn ciclo. Cada una de
  33, 34 y 35 aparece **una sola vez** en el grafo.

### 2. Toda dependency apunta a una task EXISTENTE y ANTERIOR
- **PASS.** Cada arista declarada apunta a una tarea que existe (1â€“32, numeraciÃ³n entera contigua; 30
  es el gate fÃ­sico final y 31/32 viven antes por DAG) y que aparece en una wave estrictamente anterior:
  `31â†17,23` (W2â†W1), `32â†31` (W3â†W2), `3â†23,32` (W4â†W1/W3), `5â†3` (W5â†W4),
  `27â†5,10` (W6â†W5/W3), `18â†â€¦16,17,31,32` (W8â†W7/W1/W2/W3), `19â†18` (W9â†W8),
  `25â†27` (W7â†W6), `23â†2` (W1â†W0) y `17â†2,4` (W1â†W0).

### 3. Ninguna task depende indirectamente de sÃ­ misma
- **PASS.** Verificado por la ausencia de aristas hacia atrÃ¡s en el orden por waves (consecuencia de
  Â§1). El Ãºnico ciclo potencial (3/23/5) fue eliminado.

### 4. NingÃºn checkpoint es solo narrativo
- **PASS.** El checkpoint **18** es un nodo formal del grafo (wave 8) con dependencias reales
  (2,3,4,5,6,8,9,10,11,12,13,14,15,16,**17,31,32** â€” las tareas R0.1+R0.2A+R0.3 que cierra,
  incluidos Toolchain Truth y la migraciÃ³n TSK-098 bajo el runtime canÃ³nico) y es **dependencia formal
  de las tareas 33, 34, 35 y 19** (18 → 33 → 34 → [HUMAN S1 CHECKPOINT] → 35 → 19). No puede pasar sin
  31/32 ni con la tarea 3 bloqueada. Entre 33 y 34 hay una **acción humana** (PO checkpoint commit del
  estado R0 aceptado) y entre 34 y 35 el **HUMAN S1 CHECKPOINT** (generación real de S1); ninguna es un
  nodo de tareas ni altera el grafo.

### 5. Write scopes paralelos NO colisionan
- **PASS (tareas 33/34/35/19/20 — cada una en su propia wave).** Waves 9/10/11/12/13 contienen **una
  sola tarea cada una** (33/34/35/19/20). Write scopes: 33 = `scripts/eval/run.ts` / `run.test.ts` /
  `report.ts`; 34 = `scripts/eval/{snapshot,evaluation-identity,run}.ts` (+tests) + `eval/snapshots/S1.*`
  + excepción `.gitignore`; 35 = `scripts/eval/rebased-reference.ts` (+tests) +
  `eval/baselines/reference.s1.json` + config acotada del gate; 19 = invocación/artefacto de veredicto
  en INTELLIGENCE CI + `candidate.s1.json`; 20 = `scripts/eval/` (`promoteCandidate`) y, solo con
  approval, `eval/baselines/accepted.s1.json`. `run.ts` lo tocan 33 (W9) y 34 (W10) en waves distintas.
  `gate.ts` (tareas 8/9, waves 1/2) y `benchmark-pro-agreement.ts` están **excluidos** de 33/34/35.
  `eval/baselines/reference.s1.json` (35) ≠ `eval/baselines/accepted.s1.json` (20) ≠
  `eval/baselines/v6-measured.json` (intacto). Sin colisión.
- **PASS.** RevisiÃ³n por wave de los archivos escritos:
  - **6 vs 24 (docs):** 6 en wave 0, 24 en wave 2 â€” waves distintas, sin colisiÃ³n.
  - **25 vs 27 (hooks/agents):** 27 (wave 6) es dueÃ±a de `.claude/settings.json` hooks /
    `verify-simplicity` / `sync-context`; 25 (wave 7) se limita a `.claude/agents/*` y EXCLUYE
    hooks/CI. Sin solape de write scope.
  - **26 vs 27 (settings.json):** 26 (wave 2) solo **referencia** los mecanismos de 27 (wave 6) sin
    duplicarlos; waves distintas.
  - **Cadena `mix.ts` de R0.3:** 11â†’12â†’13â†’14â†’16 en waves 3,4,5,6,7 respectivamente â€” ninguna wave
    contiene dos escritores de `apps/engine/src/signals/mix.ts`. 15 (openingStrategy, mÃ³dulo aparte) y
    9 (gate.ts) no colisionan con esa cadena.
  - **17 (wave 1):** su write scope es `apps/engine/src/server/app.test.ts` + helpers de TEST
    (setup/teardown del servidor HTTP/WS de test, utilidades de test de rate limiting) â€” archivos de
    **test** del servidor, disjuntos de `apps/engine/src/signals/mix.ts` (cadena R0.3) y de cualquier
    otro write scope en su wave (8 = `scripts/eval/gate.ts`; 22 = config Railway; 23 = doc de matriz).
    Sin colisiÃ³n.
  - **31/32 vs 27:** 31 estÃ¡ en wave 2, 32 en wave 3 y 27 en wave 6;
    `27 â† 5 â† 3 â† 32 â† 31` impide ejecuciÃ³n paralela. Task 31 posee `package.json`, CI,
    `verify-simplicity.sh` y el Ãºnico `Dockerfile`; Task 32 posee solo `app.test.ts` + evidencia;
    Task 27 no posee Docker ni ese test y toca hooks/CI despuÃ©s. Los scopes quedan separados.

### 6. Conditional/approval tasks NO se ejecutan automÃ¡ticamente
- **PASS.** **20b** (promociÃ³n REAL de baseline) consume approval humano explÃ­cito y nunca se dispara
  por HEAD; **20a** (mecanismo `promoteCandidate`) es cÃ³digo+test sin approval y no promueve sin
  aceptaciÃ³n. **22** (persistencia/migraciÃ³n) es CONDITIONAL: solo ejecuta un bounded fix tras approval
  sobre la ACCIÃ“N CONCRETA propuesta por la tarea 21; acciÃ³n material o fuera de alcance â‡’ Spec
  separada + R0 BLOCKED, sin ejecutar.

- **PASS (tarea 33).** La tarea 33 NO es conditional ni requiere approval (código + test). El **PO
  checkpoint commit** que la sigue es una acción humana de trazabilidad/reproducibilidad, **no** una
  operación irreversible/sensible ni un approval de acción de alto riesgo; no lo ejecuta ningún agente
  ni ninguna Task de implementación. La precondición HEAD-limpio de la tarea 19 es un STOP de proceso,
  no una acción automática.
- **PASS (tareas 34, 35).** Ninguna es conditional ni requiere approval de acción sensible/irreversible.
  La tarea 34 define el builder (código + test); su **HUMAN S1 CHECKPOINT** (generación real de S1) es
  una acción operativa humana de trazabilidad/reproducibilidad contra una **DB temporal desechable**
  (nunca producción), no un approval de alto riesgo. La tarea 35 corre el motor viejo por overlay en un
  worktree temporal sin tocar el árbol principal; si el overlay es incompatible con el harness actual
  ⇒ **STOP/REPLAN** (no fallback de harness viejo). La única acción con approval nueva-adyacente es la
  **20b** ya existente, ahora extendida: promoción a `accepted.s1.json` + repunte del `--enforce` por
  defecto, solo con la tarea 19 en PASS.

### 7. Cada Requirement mantiene al menos una task que lo cubre
- **PASS (tarea 33).** El requisito **2B.1** queda con cobertura reforzada: la tarea 19 lo evalúa y la
  tarea 33 repara el **productor** del candidate (corpus-opcional; Benchmark A medible sin
  `pro-drafts.sqlite`, Benchmark B `SKIPPED` informational). La política de sub-checks de **2A.1**
  (Benchmark B `optional`/`informational` por ADR-002, no bloquea el gate completo) la implementa la
  tarea 8 y la consume la tarea 33. No queda ningún requisito sin task.
- **PASS.** 1.1â€“1.5 (T1â€“6, **mÃ¡s T17 que cierra TSK-098, T31 que fija Toolchain Truth y T32 que
  migra/revalida evidencia bajo el runtime canÃ³nico para 1.1**);
  2A.1â€“2A.3 (T7â€“10, **2A.2 c5â€“c9 en T34**); 3.1â€“3.5 (T11â€“16); **3.6 (verificaciÃ³n en T13 +
  Checkpoint 18 â€” reasignar el ID 17 NO deja 3.6/CP5 sin cobertura)**; **2B.1â€“2B.4 (T19â€“20, mÃ¡s T33
  productor, T34 S1 confiable/`metaSnapshotVersion`, T35 control V6 rebasado)**;
  4.1â€“4.8 (T21, 23â€“29, 31); T.1â€“T.4 (T4, 8, 10, 17, 20, 22, 30, 31, 32, **33, 34, 35**).

### 8. CP1â€“CP12 siguen cubiertas
- **PASS.** CP1â†’T8; CP2/CP4/CP10â†’T13; CP3â†’T11/12/16; CP3b(P11)â†’T12; **CP5â†’T13 (verificaciÃ³n) + T18
  (agregaciÃ³n)** (fila actualizada; antes T17); CP6â†’T4; CP7â†’T14; **CP8â†’T9/T20/T34/T35** (compatibilidad
  ampliada a `metaSnapshotVersion`; `reference.s1.json` = `REBASED_CONTROL`, no baseline aceptado);
  CP9â†’T15; **CP12â†’T34** (determinismo lÃ³gico, metadato efÃ­mero excluido; verificada tambiÃ©n en T35/T19).
  Las 12 properties quedan cubiertas vÃ­a sus requisitos. **Las tareas 17, 33, 34 y 35 y sus candados:**
  la 33 repara el productor de `bun run eval` con un candado de regresión en rojo (`SQLITE_CANTOPEN`);
  la 17 es ownership de suite engine GREEN para 1.1 (candado de regresiÃ³n en rojo del propio test); la
  34 estrena CP12 y amplÃ­a CP8 (tests de falsa comparabilidad / mismos datos lÃ³gicos-distintos bytes /
  legacy S0 sin `metaSnapshotVersion` ⇒ BLOCKED / sync fallido nunca congela S1); la 35 mantiene CP8
  (control rebasado, `--enforce` por defecto sin re-apuntar antes de la tarea 20). La cobertura
  CP1â€“CP12 queda intacta.

### Checks especÃ­ficos solicitados
- Task **31** despuÃ©s de **17** y **23**: âœ“ (W2 > W1).
- Task **32** despuÃ©s de **31**: âœ“ (W3 > W2).
- Task **3** despuÃ©s de **23** y **32**: âœ“ (W4 > W1, W3); 31 queda impuesto por `32 â† 31`.
- Task **5** no puede pasar con 31/32/3 bloqueadas: âœ“ (`5 â† 3 â† 32 â† 31`; W5 > W4 > W3 > W2).
- Task **27** despuÃ©s de **5** y **10**: âœ“ (W6 > W5, W3).
- Task **33** después de **18** y **7**: OK (W9 > W8, W0).
- Task **34** después de **18** y **33**: OK (`34 ← 18,33`; W10 > W9 > W8).
- Task **35** después de **34** (y 18, 33): OK (`35 ← 34,18,33`; W11 > W10).
- Task **19** depende realmente de **33, 34, 35**: OK (`19 ← 18,33,34,35,7`; W12 > W11 > W10 > W9).
- Task **20** depende de **19**: OK (W13 > W12).
- Task **30** incluye **33, 34, 35**: OK (`30 ← 1–29,31,32,33,34,35`; W14 > W11).
- **PO checkpoint commit** entre **33** y **34**, y **HUMAN S1 CHECKPOINT** entre **34** y **35**:
  acciones humanas de trazabilidad/operativas, no nodos de tareas; no alteran el grafo ni el conteo
  (**total = 35**; las tareas 34 y 35 se añaden por el replan de reproducibilidad de evaluación
  aceptado por el PO).
- Task **23** fuera de wave 0: âœ“ (W1).
- Checkpoint **18** depende directamente de **31**, **32** y **3**, y es dependencia formal de **33**,
  **34**, **35** y **19**: âœ“ (W8, `31,32,3 â†’ 18 â†’ 33 â†’ 34 â†’ 35 â†’ 19`).
- Task **17** despuÃ©s de **2**: âœ“ (W1 > W0). Task **17** ANTES del checkpoint **18**: âœ“ (W1 < W8),
  y **18** ahora depende de **17**. Resto de posiciones ya validadas intactas.

### 9. Ninguna dependencia nueva innecesaria (decisiÃ³n sobre la tarea 5)
- **PASS.** Aristas del replan mÃ­nimo: `31 â† 17,23` (Toolchain Truth), `32 â† 31` (evidence migration),
  `3 â† 23,32` (se conserva 23, se sustituye el edge directo redundante a 31 por el transitivo vÃ­a 32),
  `18 â† 31,32,3` y `30 â† 31,32`.
- **DecisiÃ³n Task 5:** no se aÃ±aden edges directos redundantes `5 â† 31,32`. Su dependencia existente
  en 3 ya impone `5 â† 3 â† 32 â† 31`; Task 5 conserva sus IDs de dependencia 1, 2 y 3.
- **Replan R0.2B (tarea 33):** aristas nuevas mínimas `33 ← 18,7`, `19 ← 33` y `30 ← 33`. No se añaden
  edges directos redundantes (p.ej. `19 ← 31,32` ya está impuesto vía 18; `33 ← 31,32` ya está impuesto
  vía 18).
- **Replan R0.2B (tareas 34, 35: S1 confiable + control V6 rebasado):** aristas nuevas mínimas
  `34 ← 18,33`, `35 ← 34,18,33`, `19 ← 34,35` y `30 ← 34,35`. No se añaden edges redundantes: `34 ← 7`
  no hace falta (34 no consume `pro-drafts.sqlite`); `35 ← 18` es redundante vía 34 pero se declara
  explícito para dejar claro que 35 no puede pasar sin el checkpoint; `19 ← 33` ya estaba y se
  conserva; `20 ← 19` sin cambios. Task 19, Task 20 y Task 30 conservan el resto de sus IDs de
  dependencia.

---

### Revalidación tras el replan R0.2B (tarea 33) — checks solicitados

> **Los números de wave y el conteo "Total = 33" de esta subsección quedan SUPERSEDIDOS por la
> subsección siguiente** ("Revalidación tras el replan R0.2B — S1 confiable + control V6 rebasado,
> tareas 34 y 35"). Se conserva como histórico del replan de la tarea 33.

Derivada estrictamente de los campos **Dependencies** finales tras insertar la tarea 33.

- **Sin ciclo en el DAG.** Aristas nuevas: `33 ← 18,7`, `19 ← 33`, `30 ← 33` — todas hacia adelante
  (W9 ← W8/W0; W10 ← W9; W12 ← W9). Orden topológico por waves 0→…→12 intacto, sin aristas hacia
  atrás. **PASS.**
- **Task 33 aparece una sola vez.** Un único marcador `- [ ] 33.` en la sección R0.2B, una única fila
  en la tabla de trazabilidad, un único nodo (wave 9) en el grafo. **PASS.**
- **Task 19 depende realmente de 33.** Campo `Dependencies` de la tarea 19 = `18, 33, 7`; wave 10 > wave
  9. El checkpoint 18 es dependencia formal de 33 y, por transitividad, de 19. **PASS.**
- **Task 30 incluye 33.** Campo `Dependencies` de la tarea 30 = `1–29, 31, 32 y 33`; wave 12 > wave 9.
  **PASS.**
- **Total = 33.** IDs enteros contiguos 1–33; no se renumeró ninguna tarea existente; no se creó
  ninguna tarea 34. **PASS.**
- **Critical path consistente.** `… → 18 → 33 → [PO checkpoint commit — acción humana] → 19 → 20 → 30`.
  El checkpoint commit del PO no es un nodo de tareas; es un gate humano de trazabilidad entre 33 y 19.
  **PASS.**
- **Wave graph consistente.** Task 33 en wave 9 (posterior a sus deps 18/W8 y 7/W0); 19→W10, 20→W11,
  30→W12. Ninguna wave tiene dos escritores del mismo archivo. **PASS.**
- **Requisito 2B.1 trazado a 33/19.** 19 evalúa el candidate; 33 repara el productor corpus-opcional.
  La política de sub-checks de 2A.1 (Benchmark B informational, ADR-002) la implementa la tarea 8. **PASS.**
- **Sin contradicción "missing pro ⇒ whole gate required SKIPPED".** `requirements.md` 2A.1 criterio 3
  y `design.md` §4.2 (pseudocódigo + nota de sub-checks) quedan alineados: la ausencia de
  `pro-drafts.sqlite` marca **solo** el sub-check Benchmark B como `SKIPPED` informational (reportado,
  no bloqueante); Benchmark A / Engine Quality (`required`) se mide igual y `gate --enforce` puede
  PASS. La regla "sub-check `required` SKIPPED ⇒ exit != 0" se conserva para el Golden Dataset vacío.
  **PASS.**
- **Contratos protegidos intactos.** `gate.ts`, `evaluateGate()`, `GateStatus`, `EvaluationIdentity`,
  `ReferenceBaseline`, ADR-002, Golden Dataset, `SCORING_WEIGHTS`, comportamiento del motor y de CI,
  contratos aceptados de las tareas 8/9/10 — ninguno cambia. **PASS.**

---

### Revalidación tras el replan R0.2B — S1 confiable + control V6 rebasado (tareas 34 y 35)

Origen: `Task 19 Identity Preflight = BLOCKED`, `Snapshot Recovery Preflight = NO_TRUSTWORTHY_SNAPSHOT`,
`Evaluation Reproducibility Replan = NEEDS_PO_DECISION` → decisiones del PO aplicadas. Derivada
estrictamente de los campos **Dependencies** finales tras insertar las tareas 34 y 35 y reescribir 19
y 20.

- **Conteo total de tareas.** IDs enteros contiguos **1–35**; no se renumeró ninguna tarea existente;
  **34 y 35 son nuevas** (la antigua nota "no se crea ninguna tarea 34" queda superada). Total = **35
  tareas ejecutables** (3 discovery: 1/7/21; 2 gates transversales: 18/30). **PASS.**
- **DAG acíclico.** Aristas nuevas/modificadas: `34 ← 18,33`, `35 ← 34,18,33`,
  `19 ← 18,33,34,35,7`, `20 ← 19`, `30 ← …,33,34,35`. Todas hacia adelante en el orden por waves
  (W10←W9/W8; W11←W10/W9/W8; W12←W11/…; W13←W12; W14←W11). Ningún ciclo. Orden topológico
  0→…→**14**. **PASS.**
- **Toda dependency apunta a una task existente y anterior.** 34→{18,33} (W10>W9>W8); 35→{34,18,33}
  (W11>W10); 19→{18,33,34,35,7} (W12>W11); 20→{19} (W13>W12); 30→{1–29,31,32,33,34,35} (W14>W11).
  **PASS.**
- **Ninguna task depende indirectamente de sí misma.** Sin aristas hacia atrás en el orden por waves.
  **PASS.**
- **Cada una de 33/34/35 aparece una sola vez.** Un único marcador `- [ ] 33.` / `- [ ] 34.` /
  `- [ ] 35.` en la sección R0.2B, una fila cada una en la trazabilidad, un nodo cada una en el grafo
  (W9/W10/W11). **PASS.**
- **Ningún checkpoint es solo narrativo.** Checkpoint 18 (wave 8) es dependencia formal de 33, 34, 35 y
  19. Entre 33 y 34: **PO checkpoint commit** (acción humana de trazabilidad). Entre 34 y 35: **HUMAN
  S1 CHECKPOINT** (generación real de S1 vía el builder aprobado, contra DB temporal desechable).
  Ninguna es un nodo de tareas. **PASS.**
- **Write scopes paralelos NO colisionan.** Waves 9/10/11/12 contienen **una sola tarea cada una**
  (33/34/35/19). `run.ts` lo tocan 33 (W9) y 34 (W10) en waves distintas — nunca a la vez. 34 escribe
  `scripts/eval/{snapshot,evaluation-identity,run}.ts`, `eval/snapshots/S1.*`, la excepción
  `.gitignore`; 35 escribe `scripts/eval/rebased-reference.ts`, `eval/baselines/reference.s1.json`, la
  config acotada del gate; 19 escribe la invocación/artefacto de veredicto de INTELLIGENCE CI +
  `candidate.s1.json`; 20 escribe `scripts/eval/` (`promoteCandidate`) y, solo con approval,
  `eval/baselines/accepted.s1.json`. `eval/baselines/reference.s1.json` (35) ≠
  `eval/baselines/accepted.s1.json` (20) ≠ `eval/baselines/v6-measured.json` (intacto). Sin colisión.
  **PASS.**
- **Conditional/approval tasks NO se ejecutan automáticamente.** 34 y 35 **no** son conditional ni
  requieren approval de acción sensible. El **HUMAN S1 CHECKPOINT** (gen. de S1) es acción operativa
  humana de trazabilidad contra DB desechable, **no** un approval de alto riesgo — no añade approval
  nuevo. La única acción con approval afectada es **20b**, ahora: promoción de `CURRENT_CANDIDATE(S1)`
  a `accepted.s1.json` + repunte del `--enforce` por defecto, **solo con la tarea 19 en PASS** y
  aceptación explícita. **PASS.**
- **Cada Requirement mantiene al menos una task.** **2B.3** ← T34 (S1 reproducible +
  `EvaluationIdentity`/`metaSnapshotVersion` + procedencia). **2B.4** ← T35 (control V6 rebasado) + T19
  (cableado de la comparación) + T20 (regla de promoción). **2A.2 c5–c9** ← T34. **2B.1** sigue
  cubierto (T19 evalúa, T33 productor). Ningún requisito sin task. **PASS.**
- **CP1–CP12 cubiertas.** **CP12** (determinismo lógico, metadato efímero excluido) ← T34 (verificada
  también en T35/T19). **CP8** ampliada: compatibilidad por `metaSnapshotVersion` (`snapshotFileSha` y
  commits de motor/harness **excluidos**), `HISTORICAL_REFERENCE_S0` incomparable/BLOCKED,
  `reference.s1.json` = `REBASED_CONTROL` (no baseline aceptado), `--enforce` por defecto sin
  re-apuntar antes de la tarea 20 ← T9/T20/T34/T35. Resto de CP intactas. **PASS.**
- **Checkpoint 18 sigue PASS/aceptado; Task 33 sigue PASS/aceptado.** El replan no reabre 18 ni 33;
  añade nodos aguas abajo. **Tareas 19, 20, 34 y 35 quedan `- [ ]` (sin marcar).** **PASS.**
- **Task 19 dependencies:** `18, 33, 34, 35, 7`. **Task 20 dependencies:** `19`. **Task 30
  dependencies:** `1–29, 31, 32, 33, 34, 35`. **PASS.**
- **Evidencia histórica protegida explícitamente identificada.** `eval/baselines/v6-measured.json` =
  `HISTORICAL_REFERENCE_S0` (inmutable; `NDCG@5 ≈ 0.73642646699061` corresponde al motor `df354b9`, no
  a `e0b77d7` que es el escritor del artefacto). `eval/snapshots/S1.*` (una vez congelados) y
  `eval/baselines/reference.s1.json` (`REBASED_CONTROL`) declarados en §7 del diseño y en el "Protected
  / DO NOT CHANGE" de las tareas 34/35/19/20. **PASS.**
- **Sin texto contradictorio.** Ningún pasaje sigue diciendo que `e0b77d7` es el motor medido (se
  reencuadra como escritor del artefacto en `design.md` §4.2/§11, glosario de `requirements.md` y
  trazabilidad de la tarea 19). Ningún pasaje dice que un snapshot `7.41e` sea automáticamente
  comparable (`evaluationProtocolVersion` codifica la **regla** `patchOverride:dominant`, y el
  contenido lo guarda `metaSnapshotVersion`). Ningún pasaje admite fallback de harness viejo como PASS
  (tarea 35: overlay incompatible ⇒ STOP/REPLAN). Ningún pasaje re-apunta el `--enforce` por defecto
  antes de la tarea 20. **PASS.**
- **Contratos protegidos intactos.** `apps/engine/**` (las tareas 34/35 no lo tocan),
  `evaluateGate()`, `GateStatus`, `SCORING_WEIGHTS_*`, Golden Dataset, split, y el **contenido** de
  `v6-measured.json` — ninguno cambia. `EvaluationIdentity`/`ReferenceBaseline` se **amplían**
  aditivamente (`metaSnapshotVersion`, `EvaluationMetadata` de procedencia) sin romper la Fase 9.
  **PASS.**

---

**TASK PLAN CONSISTENCY: PASS** (tras el replan R0.2B de reproducibilidad de evaluación — S1 confiable
+ control V6 rebasado, tareas 34 y 35)

Nota de trazabilidad cruzada (RESUELTA): el requisito 1.5 de `requirements.md` fue alineado con el
contrato ejecutable de la tarea 5 â€” el PRE-PUSH gate debe ser **local y determinÃ­stico** (Husky, git
`pre-push` nativo o wrapper local equivalente), y CI/PR es una **capa posterior** de defensa adicional,
**nunca** sustituto del gate local (requisito 1.5 criterios 1â€“5). Ya no existe discrepancia entre la
letra de `requirements.md` y el contrato de la tarea 5.
