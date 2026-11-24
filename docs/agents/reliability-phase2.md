# Fiabilidad de ingeniería — fase 2 (2026-11-24)

Parte de `10b4f933`. Vocabulario: **PASS / FAIL / SKIPPED / NOT_TESTED**.

## 1. Prueba real del guard — PASS (Warden), NOT_TESTED (Sentinel, Tracer)
Claude Code 2.1.329 headless en el worktree, **permisos normales** (sin `bypassPermissions`), prompt que lanza un subagente `warden`:
- `git status --short` → ejecutado, sin error. **PASS (lectura legítima).**
- `echo x > <scratchpad>/sandbox/probe.txt` → `PreToolUse:Bash hook error: … BLOQUEADO (warden es de solo lectura): carácter '>' no permitido`. El archivo **no existe** (`ls` del sandbox vacío). **PASS (escritura bloqueada).**
- Confirma con un payload real que Claude Code envía `agent_type` en subagentes (en fase 1 sólo estaba en el esquema del binario).
- NOT_TESTED: Sentinel y Tracer reales (mismo hook y misma lista; sólo se ejerció Warden); control positivo de un subagente no restringido escribiendo (lo confundiría el sistema de permisos).

## 2. `test (qa)` y `r1-certification` — corregido localmente (TSK-259)
- Dependencias medidas en `ci.yml`: `test` (matriz engine/web/root/qa) **no tiene `needs`** → sin ciclos. `r1-certification` tiene `needs: [test, verify-simplicity, intelligence-ci]`, es contexto requerido; `test (qa)` no lo es.
- Simulación reproducible (`scripts/ci/ci-needs-semantics.test.ts`, sobre el `ci.yml` real):

| Resultado de un `needs` | Antes | Después |
|---|---|---|
| FAIL (p. ej. `test (qa)`) | r1 = **skipped** → satisface el requisito (falso verde) | r1 = **failure** |
| SKIPPED / cancelled | r1 = skipped | r1 = **failure** |
| todo PASS | r1 corre normal | r1 corre normal (sin falso positivo) |

- Cambio mínimo aplicado: `if: ${{ !cancelled() }}` + paso guardia al inicio de `r1-certification` (Codex objetó `always()`: ignora la cancelación del workflow y retiene runners; la prueba exige `!cancelled()`, que el guardia sea el primer paso —antes de Checkout— y que no tenga `if:` propio). Con esto **no hace falta** añadir `test (qa)` a branch protection para cerrar el falso verde; añadirlo sigue siendo opcional (da un check propio visible). **Branch protection: sin tocar.**
- La premisa "un check requerido omitido no bloquea" es semántica documentada de GitHub; no se reprodujo en vivo (requiere push de un PR). NOT_TESTED en GitHub.

## 3. Critical paths — propuesta (no se editó `master`)
Política efectiva leída de `origin/master:docs/reviews/policy.json`. Churn a 90 días en `release/mvp-beta` para calibrar el costo de exigir revisor externo:

| Ruta | commits/90d | Propuesta |
|---|---|---|
| Decisores y medidor del benchmark: `scripts/eval/{gate,baselines,evaluation-identity,metrics,run,replay,golden,split,benchmark-engine-quality,benchmark-pro-agreement}.ts` | 25 (`scripts/eval/` entero, 90d) | **Añadir esos 10 archivos** (Codex: proteger sólo el gate deja alterar el medidor o su entrada para fabricar un PASS; `run.ts` fabrica el candidato que el gate juzga). Se excluyen los de promoción/congelado/propuesta (`promote-candidate`, `freeze-*`, `propose-*`, `current-engine-candidate`), que ya exigen operación explícita |
| `eval/snapshots/` (S1.sqlite + manifiesto) | — | **Añadir**: es la entrada del medidor |
| `eval/baselines/` | 11 | **Añadir** |
| `eval/golden/` | 3 | **Añadir** |
| `qa/invariants/` | 16 | **Añadir** (los oráculos que juzga `test (qa)`). No `qa/` entero (24) ni `scripts/qa/` (6, CI no los ejecuta) |
| `.claude/settings.json`, `.claude/agents/` | 2 / 3 | **Añadir** (configuración de hooks y permisos de agentes) |
| `.claude/skills/`, `.claude/rules/` | 1 / 13 | **No**: instrucciones, no controles ejecutables (los cubren contratos estáticos) |
| `package.json` raíz | 20 | **No como ruta**: la política es por ruta y no distingue `scripts` de dependencias; 20 revisiones externas en 90 días sería ruido. Los scripts que CI invoca son `verify:r1` y `lint` (web). Riesgo residual declarado; cerrarlo exige que el verificador mire claves de JSON (cambio en `master`, no propuesto aquí) |

Patch para un PR a `master` (que además es crítico en sí mismo): añadir a `criticalPaths` — los 10 archivos de `scripts/eval/` de la tabla, `eval/baselines/`, `eval/golden/`, `eval/snapshots/`, `qa/invariants/`, `.claude/settings.json`, `.claude/agents/`. Probado con `criticalMatches` de `master` (`scripts/ci/review-policy.ts`) sobre la política con la lista FINAL: 11 rutas que deben ser críticas lo son y 9 que no deben serlo (`promote-candidate`, `current-engine-candidate`, `qa/mvp/`, `.claude/skills/`, `.claude/rules/`, `apps/web/package.json`, `package.json`, `docs/`, `scripts/qa/`) no lo son: TODO COHERENTE. `qa/mvp/`, `.claude/skills/`, `apps/web/package.json` y `docs/` siguen no críticos.

## 4. Calidad del candidato del motor — prueba mínima (sin harness nuevo)
**Corrección a la fase 1:** el snapshot `eval/snapshots/S1.sqlite` y el Golden (`eval/golden/dataset.json`) **están versionados**; sólo falta el corpus profesional (`pro-drafts.sqlite`). Por eso el Benchmark A (Engine Quality, requerido) es evaluable en un runner de CI; el B (Pro Agreement, informativo) queda `SKIPPED`.

Medido localmente con todas las salidas en scratchpad (nada del repo tocado salvo lo de esta fase):
1. `run.ts` sobre el motor actual con S1 + Golden → candidato de 30 casos. **Trampa:** sin el split congelado el candidato sale con identidad `split:00000f62` (corpus vacío) y el gate responde `BLOCKED — baseline incomparable`. Con `eval/baselines/split.json` copiado a `D2K_SPLIT_OUT` la identidad es `split:02dc8878;golden:30`, comparable.
2. **No sirve compararlo con las referencias congeladas**: motor actual vs `reference.s1`/`accepted.s1` → FAIL (NDCG@5 0.379 vs 0.721). La causa que el propietario ha anotado (el Golden se etiquetó viendo el motor antiguo) **no se verificó aquí**: es una hipótesis (el dataset sólo declara `labeledBy`). Hecho medido: un gate contra ese baseline fallaría en todo PR.
3. **Sí sirve la comparación relativa PR vs rama base** sobre el mismo S1 + Golden + split: candidato vs sí mismo → **PASS**; copia con NDCG −0.1 y Bad Pick +0.1 → **FAIL** con detalle por contexto.

Prueba mínima propuesta (futuro ticket sobre `ci.yml`, ruta crítica → revisor externo): un job que (a) genera el candidato de la base y el del PR con `run.ts` (S1 + Golden + split congelado + `D2K_PRO_DB` inexistente) y (b) corre `D2K_BASELINE_OUT=<base> D2K_GATE_CURRENT=<PR> gate.ts --enforce`, sólo cuando el PR toca `apps/engine/src/{signals,recommendation,pipeline}/`. Separación conservada: integridad del baseline = job actual; legalidad = `r1-certification`; calidad del candidato = este job nuevo.
Reproducción (HEAD `10b4f933`, motor y harness sin modificar; S1.sqlite sha256 `de7520a6…`, dataset.json `7a9c07f7…`, split.json `62624617…`, reference.s1.json `1a64fb72…`): `D2K_META_SNAPSHOT=eval/snapshots/S1.sqlite ENGINE_DB_PATH=<igual> D2K_PRO_DB=<ruta inexistente> D2K_GOLDEN=eval/golden/dataset.json D2K_BASELINE_OUT=<scratch>/candidate2.json D2K_REPORTS_DIR=<scratch> D2K_SPLIT_OUT=<copia de eval/baselines/split.json en scratch> D2K_MEASURED_ENGINE_COMMIT=$(git rev-parse HEAD) bun run scripts/eval/run.ts`; luego `D2K_PRO_DB=<inexistente> D2K_TOLERANCE_OUT=<scratch> D2K_BASELINE_OUT=<referencia o candidato base> D2K_GATE_CURRENT=<candidato> bun run scripts/eval/gate.ts --enforce`. Los artefactos de la corrida viven en el scratchpad de la sesión (no versionados); un ticket posterior debe registrarlos si se usa esto como evidencia de CI.
Limitaciones: 30 casos Golden con tolerancia 0.02 → potencia baja; etiquetas ancladas al motor viejo; sin corpus profesional no mide acuerdo con pros; la mutación se probó sobre el JSON del candidato, no sobre código del motor (no se modificó el motor).

## 4b. Revisión adversarial de Codex (fase 2)
Ronda 1: BLOCK. Aceptado y corregido: `always()` → `!cancelled()`; orden del guardia y ausencia de `if:` propio ahora probados; propuesta de `criticalPaths` ampliada (medidor y snapshot); afirmaciones de evaluación reescritas con comando, SHA y hashes, y la causa del 0.379 degradada a hipótesis. Aceptado como límite: la prueba parsea YAML con regex y reimplementa la semántica de `needs`; sólo un PR real (NOT_TESTED, requiere push) la valida en GitHub. `actionlint` NOT_TESTED. El paso de subida de reporte con `if: always()` corre sin reporte tras un fallo del guardia: sólo avisa, no ejecuta código del PR.

## 5. Acciones que requieren autorización del propietario
1. PR a `master` ampliando `criticalPaths` (§3).
2. Revisión externa de este diff (toca `ci.yml` y `scripts/`, críticos) y su registro con `record-review.ts` desde `master`.
3. Opcional: añadir `test (qa)` a branch protection (§2; ya no es necesario para el falso verde).
4. Ticket para el job de regresión relativa (§4) y una corrida de `ci.yml` en un PR real (requiere push).
