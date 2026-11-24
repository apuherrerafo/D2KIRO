# Matriz de integración del ecosistema de agentes (TSK-254)

Mínima, sólo con lo comprobado en el repo en `ffff5db6` + TSK-254. «Eval» = prueba que corre en `bun test scripts/`
(que corre CI en el job `test (root)`) salvo que se diga otra cosa. **MD** = existe sólo como texto.

## Capas

| Capa | Contrato | Guardrail que lo hace cumplir | Eval |
|---|---|---|---|
| Agentes (7) | frontmatter `name/description/model/tools`; `models.yaml` | `checkAgent`: los de sólo lectura (sentinel, tracer, warden) sin Write/Edit; `mcp__context7` sólo en artisan; veto de escritura en los 2 de Fase 9 | `contracts.test.ts` |
| Skills (25) | `SKILL.md` + `allowed-tools` | `checkSkillTools` (nuevo): `redteam` sin escritura, ningún skill con context7; rutas citadas existen; ningún skill manda borrar `journal`/`ledger` | `contracts.test.ts` |
| Workflow `dispatch` → `helm` → `compass` | tabla «CICLO DE COORDINACIÓN» de `dispatch` | cláusulas presentes (`checkCoordinationWorkflow`); WIP por herramienta en hook, gate y tablero; `write_scope` en hook | `contracts.test.ts`, `orchestration-behavior.test.ts` |
| Protecciones de Claude Code | `.claude/settings.json` (proyecto) | `pretooluse-guard` (commit/push), `pretooluse-edit-guard` (data-boundary + write-scope) | `scripts/hooks/*.test.ts` |
| Protecciones de git/CI | `.husky/pre-commit` (lint-staged → `bun test scripts/`), `.husky/pre-push`, `ci.yml`, `release-gate.yml` | `verify-simplicity.sh` (deps, secretos, WIP, append-only, invariantes) | `verify-simplicity.test.ts` |
| Carga de skills del repo | precedencia `personal > project` | `claude-repo-only.sh` (CLI); retirar copias personales (VS Code, acción del propietario) | `shadowing.test.ts`; `shadowing.ts` a mano |

## Agente → skill/workflow → evidencia

| Agente | Quién lo invoca (skills que lo citan) | Contrato verificado por | Evidencia de entrega |
|---|---|---|---|
| warden | dispatch (etapa 5, interpreta gates) | `checkAgent` (sólo lectura) | veredicto en `journal.md` + `## Estado` del ticket |
| sentinel | castoff, dispatch, nightwatch, pre-flight, redteam | `checkAgent` (sólo lectura) | veredicto antes de deploy (MD, ver abajo) |
| tracer | dispatch, helm, redteam | `checkAgent` (sólo lectura) | análisis tras `attempts: 3` (MD, ver abajo) |
| chronicle | dispatch | `checkAgent`; `checkJournalPolicy` | líneas añadidas a `journal.md`/`ledger.md` (append-only, gate) |
| artisan | dispatch | `checkAgent` (único con context7) | diff dentro del `write_scope` |
| data-stat-engineer | **ningún skill** | `checkAgent` (veto de escritura) | — |
| evaluation-engineer | **ningún skill** | `checkAgent` (veto de escritura) | — |

**Hueco de integración** (sin corregir, no es un defecto de seguridad): `data-stat-engineer` y
`evaluation-engineer` tienen contrato pero ningún workflow los invoca; sólo los menciona la tabla de agentes de
`CLAUDE.md` y las reglas de Fase 9.

## Controles críticos que viven sólo en Markdown

| Control | Dónde está escrito | ¿Código lo aplica? | Cómo verificarlo sin infraestructura nueva (propuesta, no implementada) |
|---|---|---|---|
| `attempts: 3` → invocar a Tracer | CLAUDE.md, dispatch, helm | No. El tablero sólo marca la tarjeta (`OB-4c`) | Reusar `verify-simplicity.sh`: un ticket con `attempts >= 3` y `state: doing` sin línea `tool:tracer ticket:<id>` en `journal.md` |
| `@redteam` máx. 3 rondas | dispatch | No | Contar líneas `tool:redteam ticket:<id>` en `journal.md` (formato fijo ya existente) |
| El coordinador no aprueba su propio trabajo | dispatch | No | Exigir en el cierre una línea de journal de un `tool:` distinto del autor (manual hoy) |
| Merge/deploy sólo con autorización; `/castoff` antes de deploy | CLAUDE.md, dispatch, castoff | Parcial: commit/push pasan por `commit-gate.py` y `pre-push`; protección de rama en GitHub (`docs/release-protection.md`). El deploy en sí es MD | Fuera de alcance del repo local |
| Opus sólo en `/blueprint` | CLAUDE.md | Parcial: `checkModelsYaml` cruza agentes con `models.yaml`; los skills no declaran `model` | — |
| `allowed-tools` de skills | frontmatter de cada skill | **Sí desde TSK-254** (`checkSkillTools`) | `contracts.test.ts` |
| Nombre de skill = nombre de carpeta | convención de Claude Code | No. Comprobado a mano: 25/25 coinciden | Ampliar `checkSkillTools`/un test sobre `.claude/skills/*` |
| Se cargan los skills del repo y no los personales | `docs/agents/repo-only-ecosystem.md` | Sólo con el lanzador (CLI); en VS Code, acción del propietario | `bun scripts/agents/shadowing.ts` (a mano; no entra en CI porque lee `~/.claude`) |
