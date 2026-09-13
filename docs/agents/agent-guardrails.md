# Agent Guardrail Architecture

> **Spec:** `.kiro/specs/r0-engineering-baseline-recovery/` — R0.4 Harness Truth, **Task 26**.
> **Requisito:** 4.8. **Fuente de diseño:** `design.md` §4.4 "Agent Guardrail Architecture".
> **Se apoya en** `docs/agents/harness-matrix.md` (Task 23) — la Matrix dice **DÓNDE** vive cada
> responsabilidad y su veredicto KEEP/MERGE/MOVE/DELETE/REFACTOR; este documento dice **QUÉ**
> límite se impone sobre cada rol y con qué **mecanismo canónico**. No la reemplaza.
> **No agrega agentes nuevos, ni hooks, ni scripts nuevos** — donde el mecanismo canónico ya existe
> y es determinista, este documento lo **referencia**, nunca lo duplica.

## 0. Roles confirmados sobre los que se aplica

Repository Truth → **Kiro** (Planner/IDE principal, §9.5 resuelta) → **Claude Code** (Writer,
corre dentro de Kiro) → **Codex** (reviewer/judge independiente, sin acceso a `journal.md` ni a
las skills de este ecosistema) → QA humana existente (el usuario, human-in-the-loop). Ningún rol
nuevo se declara aquí.

## 1. Principio rector — restricciones críticas nunca dependen solo de prosa

**Regla de dos ramas:**

- **SI** una restricción **puede** imponerse determinísticamente ⇒ el mecanismo canónico es
  `Permission | Hook | Test | CI | schema/invariant` — **nunca** una instrucción en lenguaje
  natural a un agente.
- **SI** una restricción **no puede** imponerse determinísticamente ⇒ se impone como `Policy/Rule`
  **acompañada de** (a) **independent verification** (alguien o algo distinto del autor comprueba
  el resultado) y (b) **residual risk explícito**, documentado, no callado.
- **Discovery** (preguntar/investigar antes de actuar) se reserva para cuando **falta información**
  — nunca como sustituto de hacer determinista una regla que ya es puramente semántica y podría
  quedar así para siempre.

## 2. Los ocho guardrails

| # | Guardrail | Qué limita | Mecanismo canónico | Rama (regla de dos ramas) |
|---|---|---|---|---|
| 1 | **Scope** | Kiro (Planner) no implementa; Claude Code (Writer) no cambia scope/spec unilateralmente; Codex (Judge) no corrige, solo juzga; QA no toca producción | `schema/invariant` (roles ya confirmados) + proceso con approval humano | Mixta — el rol es un invariante declarado; su violación real (p.ej. un Judge que edita código) sólo la detecta independent verification humana |
| 2 | **Tool/permission** | Cada agente usa solo las `tools` que su rol necesita (mínimo privilegio) | **Permission** — `tools:` en el frontmatter de cada `.claude/agents/*.md`, `.claude/settings.json` | Determinista |
| 3 | **Write-scope** | Un Writer con un ticket en `doing` escribe solo dentro de su `write_scope` declarado | **Permission** (fail-open sin ticket, por diseño retrocompatible) — `scripts/hooks/write-scope-guard.py`, invocado por `pretooluse-edit-guard.sh` (`.claude/settings.json`, PreToolUse Edit\|Write\|MultiEdit) | Determinista — **mecanismo YA EXISTENTE, referenciado, no duplicado** |
| 4 | **Protected evidence** | Ningún Writer edita unilateralmente `data/curated/**`, un baseline aceptado, el Golden Dataset o `SCORING_WEIGHTS_*` para hacer pasar una implementación | **Permission** (fail-closed, R0.1 Task 4) — `scripts/hooks/data-boundary-guard.py` (ADR-003) para `data/curated/`; **schema/invariant** — `HISTORICAL_REFERENCE_S0` inmutable y `isComparable()` (R0.2A Task 9) para baselines/`EvaluationIdentity` | Determinista — **mecanismo YA EXISTENTE, referenciado** |
| 5 | **Action (irreversible/sensible)** | Migraciones de datos, cambios de persistencia/auth/motor de DB, promoción de baseline o de patch requieren aprobación humana explícita antes de ejecutarse | Proceso con **approval humano explícito** (T.4) — ya demostrado en R0 real: Task 20 (promoción de `accepted.s1.json`, aprobación textual de Julio Herrera, PO, ver `journal.md` evt-20260913-261/262) y Task 22 (acción de persistencia, condicional a discovery) | No determinista por naturaleza (es una decisión humana) — **independent verification**: el propio mecanismo de promoción (`promoteCandidate`/`scripts/eval/promote-candidate.ts`) re-verifica el PASS de Task 19 y los hashes de contenido aprobados antes de escribir nada, en vez de confiar en la palabra del agente que pide la promoción |
| 6 | **Verification** | Ningún agente declara una tarea completa sin la evidencia que exige su contrato; un check `required` en `SKIPPED`/`BLOCKED` nunca cuenta como PASS | **Test + CI** — `scripts/eval/gate.ts` (`GateStatus`, clase por sub-check, R0.2A Tasks 8-10), `bun run test`, `.husky/pre-push` (R0.1 Task 5), `ci.yml` jobs `test`/`verify-simplicity`/`intelligence-ci` | Determinista — **mecanismo YA EXISTENTE, referenciado** |
| 7 | **Loop / circuit-breaker** | Tras un fix y su re-verificación, un FAIL de la **misma** root cause no dispara otro ciclo automático de reparación | **Proceso verificable** (ver §3 abajo) + **schema/invariant** — campo `attempts` de `docs/agents/tasks/TSK-XXX.md`; `attempts: 3` dispara Tracer automáticamente (cableado en `/helm` y `CLAUDE.md`, "Campo `attempts` en 3 → dispara automáticamente Tracer. No se pregunta, se ejecuta") | Mixta — el conteo (`attempts`) es determinista; **clasificar** si dos FAILs comparten root cause exige juicio (independent verification: Tracer, no el agente que venía fallando) |
| 8 | **Auditability** | Todo check, eval y decisión relevante deja evidencia reproducible; nada se declara verde solo de palabra | **schema/invariant** (formato de log fijo, `CLAUDE.md` "FORMATO DE LOG EN journal.md") + append-only (`journal.md`/`ledger.md`, protegidos por `verify-simplicity.sh` — bloquea cualquier diff que borre líneas) + `Reconciliation_Procedure` (`docs/agents/harness-matrix.md` §4) | Determinista para el formato/append-only; el contenido de qué se registra sigue el Reconciliation Procedure (mixta) |

## 3. Circuit-breaker como política de proceso verificable (guardrail 7, detalle)

Contrato exacto (requisito 4.8 c4–c5, ya vigente en el proyecto vía `CLAUDE.md`/`invariantes.md`,
formalizado aquí sin reemplazar el mecanismo):

1. Un check falla → se clasifica la causa raíz (A implementación / B spec-diseño / C entorno-tooling
   / D datos-evaluación).
2. Se aplica un fix dirigido a esa causa → se re-verifica.
3. **Si el mismo check vuelve a fallar por la MISMA root cause** → **STOP**: no hay un tercer ciclo
   automático de reparación. Se escala a REPLAN/HUMAN — el campo `attempts` de la task alcanza 3 y
   dispara Tracer automáticamente, sin que nadie lo pida.
4. **Si falla por una root cause DISTINTA** → es un FAIL nuevo: empieza su propia clasificación A/B/C/D
   en el paso 1, y **no cuenta** contra el circuit-breaker de la causa anterior.
5. Tracer (`.claude/agents/tracer.md`) es la independent verification de este guardrail: no es el
   mismo agente que venía fallando el que decide "sigo intentando" — otro rol, con el resumen
   sintético de los 3 intentos, decide si el enfoque debe cambiar.

Esto es exactamente lo que este propio Task 26 aplicó de forma real en R0: cuando Task 31 (Bun
Toolchain Truth) detectó `TSK098_RUNTIME_SEMANTICS_CHANGED` a mitad de ejecución, el circuit-breaker
correcto fue **STOP → REPLAN** (nueva Task 32, causa distinta — compatibilidad de runtime, no la
misma root cause que Task 17 ya había resuelto bajo Bun 1.3.14), no un tercer intento ciego de
parchear el mismo test bajo el mismo runtime.

## 4. Notas de integración

- **Esto no agrega agentes, hooks ni scripts nuevos.** Formaliza límites sobre los roles ya
  confirmados y sobre mecanismos que Tasks anteriores de R0 ya dejaron deterministas.
- Los guardrails con mecanismo determinista ya existente — **write-scope** (guardrail 3),
  **data-boundary** (guardrail 4), **required-skip ≠ PASS** (guardrail 6, R0.2A), y
  **path-normalization OS-independiente** (R0.1 Task 4, subyacente a 3 y 4 vía `_hook_lib.py`) —
  se **referencian** en la tabla de §2, nunca se reimplementan ni se copian aquí.
- Donde un guardrail no puede ser determinista (scope de rol, acciones sensibles, clasificación de
  root cause repetida), se impone como `Policy/Rule` + independent verification + riesgo residual
  explícito — nunca como una afirmación de un agente sin forma de comprobarla desde afuera.
- Este documento **se apoya** en `docs/agents/harness-matrix.md`, no la reemplaza: la Matrix asigna
  veredictos KEEP/MERGE/MOVE/DELETE/REFACTOR por mecanismo; este documento asigna guardrails por
  **restricción crítica** sobre un rol. Ambos coexisten sin duplicar responsabilidad.
