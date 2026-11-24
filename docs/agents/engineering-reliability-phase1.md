# Fiabilidad de ingeniería — fase 1 (2026-11-24)

Base certificada `release/mvp-beta` @ `05cb456d`; rama `agent-ecosystem/phase1`. Todo lo de abajo cita el comando o
la consulta que lo respalda. Vocabulario cerrado: **PASS / FAIL / SKIPPED / NOT_TESTED**.

## 1. Hallazgos del informe anterior contrastados con lo que ejecuta GitHub

| # | Hallazgo | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `independent-review` efectivo | **DESACTUALIZADO** (el informe previo no era erróneo, pero el mecanismo real es otro) | `release-gate.yml` de `release/mvp-beta` es el antiguo (`check-independent-review.sh`, texto del PR), pero el log del run `45105697454` muestra `ref: master` y `bun run scripts/ci/verify-review-evidence.ts` + `check-gate-producers.ts`: GitHub ejecuta el workflow de la rama predeterminada. No se toca ni se reemplaza. |
| 2 | `intelligence-ci` se compara consigo mismo | **CONFIRMADO** (alcance acotado) | `ci.yml` corre `bun run scripts/eval/gate.ts --enforce` sin `D2K_GATE_CURRENT`; `gate.ts` L257-267: sin candidate, `candidate = reference`. Ver §4. |
| 3 | `test (qa)` no es requerido | **CONFIRMADO** | `GET /branches/release%2Fmvp-beta/protection`: contextos = `test (engine)`, `test (web)`, `test (root)`, `verify-simplicity`, `intelligence-ci (eval --enforce)`, `r1-certification (verify:r1)`, `independent-review`. Falta `test (qa)`. Ver §3. |
| 4 | Agentes "de solo lectura" escriben por Bash | **CONFIRMADO** | `contracts.ts` sólo comprobaba Write/Edit; los tres declaran `Bash`. Cadena PreToolUse previa devolvía exit 0 a `echo x > f`, `sed -i`, `git checkout -- .` con `agent_type: warden`. Corregido en el hook (§2); NOT_TESTED en vivo. |
| 5 | Un PR puede debilitar lo que lo juzga | **CONFIRMADO parcial** | `.github/`, `scripts/verify-simplicity.sh`, `scripts/hooks/` **sí** exigen revisor externo (`docs/reviews/policy.json` en `master`); `scripts/eval/gate.ts`, `eval/baselines/`, `eval/golden/`, `qa/`, `scripts/qa/`, `.claude/settings.json`, `.claude/agents/` **no** (sonda con `criticalMatches` de `master`). Ver §3. |

## 2. Corrección ejecutada: guard de solo lectura por identidad (TSK-257)

- **Rojo:** la cadena anterior permitía las tres escrituras (exit 0). Sin el guard, 275 de 284 pruebas nuevas fallan.
- **Verde:** `readonly-agent-guard.py`, encadenado en `pretooluse-guard.sh`; 401 pruebas (33 lecturas × 3 agentes
  que deben seguir permitidas, 69 vías de escritura × 3 agentes bloqueadas, hilo principal y otros agentes sin
  efecto, fallo cerrado, cadena real, paridad con `READ_ONLY_AGENTS`). `bun test scripts/` 1152 pass / 0 fail.
- **Por qué por `agent_type`:** el esquema del hook PreToolUse del binario 2.1.329 define `agent_id` ("presente sólo
  cuando el hook se dispara dentro de un subagente") y `agent_type` junto a él. La lista blanca es de COMANDOS (lo desconocido se bloquea); la identidad es por nombre: sólo `warden`, `sentinel` y `tracer` (o un nombre que los contenga como segmento, p. ej. `plugin:warden`) quedan restringidos. Un agente nuevo de lectura exige añadirlo a `READ_ONLY_AGENTS`; un subagente sin `agent_type` se bloquea.
- **NOT_TESTED en vivo:** no se capturó el payload de un subagente real. El intento de lanzar una sesión anidada con
  `bypassPermissions` fue denegado por el clasificador y no se rodeó. Verificación pendiente, 1 minuto: abrir
  `claude --agent warden` en el worktree y pedirle `echo x > f` (debe responder BLOQUEADO).
- **Límite:** no es un sandbox del sistema operativo. `bun test` ejecuta código del repo. Un agente de lectura no puede
  modificarlo, pero el guard no impide que ese código escriba.

## 3. Cambios que REQUIEREN tu autorización (no aplicados)

**3.1 Hacer `test (qa)` obligatorio** (config de GitHub). Medido: 6/6 runs en verde desde el PR #170 (muestra pequeña);
el job no tiene `needs`, así que no hay dependencia circular; `r1-certification` ya depende de toda la matriz `test`.
Riesgo real: si `test (qa)` falla, `r1-certification` queda `skipped` (estado observado en el run `43606362021`, causa no analizada),
y GitHub documenta que un check requerido `skipped` no bloquea la fusión. Comando mínimo y no destructivo (añade, no reemplaza):

```
gh api -X POST repos/apuherrerafo/D2KIRO/branches/release%2Fmvp-beta/protection/required_status_checks/contexts --input - <<< '["test (qa)"]'
```

No reproducido en vivo (haría falta un PR de prueba con `qa/` roto). Recomendación: esperar 2-3 runs más en verde.

**3.2 Ampliar `criticalPaths`** en `docs/reviews/policy.json` **de `master`** (PR a `master`; el propio archivo es crítico).
Añadir: `scripts/eval/gate.ts`, `eval/baselines/`, `eval/golden/`, `qa/`, `scripts/qa/`, `.claude/settings.json`,
`.claude/agents/`. No se añade `package.json` (cambia por dependencias a menudo; deuda declarada en §5). No bloquea cambios
legítimos de CI: sólo exige el revisor externo que ya exige para `.github/`.

**3.3 Revisión externa de este diff**: toca `scripts/hooks/` (crítico). Ver §6.

## 4. Calidad del motor: qué garantiza `intelligence-ci` y qué NO

| Garantiza | NO garantiza |
|---|---|
| El `ReferenceBaseline` versionado existe, es legible y comparable (identidad, dataset, protocolo) | Que el código del PR sea mejor o igual: nunca mide el motor del PR |
| Sus métricas internas respetan las tolerancias y `ConstraintViolationRate = 0` **sobre el baseline congelado** | Legalidad de lo que el motor recomienda hoy (la cubre `r1-certification`: legalidad/información oculta) |
| | Calidad frente a un benchmark: necesita `pro-drafts.sqlite` y snapshot, que no están en el runner |

Brecha mínima y reproducible, sin harness nuevo: (a) integridad de referencia = `gate.ts` actual; (b) legalidad = ya cubierta
por `r1-certification`; (c) calidad del candidato = `current-engine-candidate.ts` + `D2K_GATE_CURRENT` **local y aprobado**
(el propio `ci.yml` lo documenta como operación explícita). No se generó candidate ni se promovió baseline. Pendiente de decisión:
si el corpus puede viajar al runner (hoy no), o si basta una corrida local obligatoria antes de tocar `signals/`.

## 5. Evidencia por tipo de tarea y deuda

La tabla vive en `.claude/skills/dispatch/SKILL.md` (reutiliza el ciclo existente; sin agente nuevo) y un contrato estático
la exige (`contracts.ts`: con el `dispatch` anterior faltaban 6 cláusulas; con el nuevo, 0). Es **instrucción escrita**
verificada estáticamente, no garantía de conducta del modelo.

Deuda restante: `package.json#scripts` fuera de `criticalPaths`; guard no probado en vivo con subagente real; `bun test`
dentro de la lista blanca ejecuta código del repo; `hook-guards` sigue dependiendo de que Claude Code envíe `agent_type`
(un subagente sin él se bloquea, no se deja pasar).

## 6. Revisión adversarial (Codex 0.159, `-s read-only`, 8 rondas: 7 BLOCK → APPROVE)

Ronda 1: BLOCK. Reproducidos con payload real: `bun test --preload` (ejecuta código), `git show --textconv`, y `agent_type: warden:untrusted` esquivaba el guard (normalizaba al último segmento). Cada uno se reprodujo en rojo (19 pruebas fallaban) y se cerró: `bun test` pasa a lista blanca de opciones, `--textconv/--filters` bloqueadas, y cualquier segmento del nombre cuenta.

Ronda 2: BLOCK. Payloads reales que devolvían exit 0: `cd .. && bun test`, `cd /tmp && bash scripts/verify-simplicity.sh`, `bunx tsc --noEmit false`, `sort --compress-program=touch`, `git log --show-signature`, `gh pr view --web`, `gh api --cache`, y nombres como `warden,untrusted`/`plugin.warden`. Cerrados con pruebas (la reproducción en rojo es la de Codex; las pruebas se añadieron junto al arreglo): `cd` sólo a subcarpeta relativa, `--noEmit` booleano rechazado, `sort -o/-T/--compress*`, `--show-signature`, `--web`/`--cache`, y la identidad pasa a *contiene* (restringe de más, p. ej. `wardenclyffe`, a propósito). Rondas 3-7 (todas con payload real que devolvía exit 0, cerradas con prueba): `git grep -O<pager>` adjunto; `cd` por symlink/junction (ahora `realpath` contra el `cwd` del payload, también para `bun test <ruta>` y `tsc -p`); `bun test` con rutas absolutas/UNC/`..`; `tsc` incremental (`.tsbuildinfo`, ahora lista blanca de opciones); `file -C`; `uniq in out`; `gh --web=true`. Ronda 8: **APPROVE**, sin bypass reproducible. Patrón: cada ronda halló una opción de un binario permitido; por eso la lista es corta y cada entrada tiene prueba. Codex marcó `rg -z` como falso positivo: es incorrecto, `-z` es `--search-zip` (invoca descompresores externos) y se mantiene bloqueado. Codex también señaló la fuente de verdad duplicada (lista en Python y en TS, unida sólo por una prueba) y el `done` con la verificación en vivo pendiente: aceptados como deuda declarada (§5), no cerrados.
