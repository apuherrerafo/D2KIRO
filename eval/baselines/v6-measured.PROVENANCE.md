# `v6-measured.json` — procedencia histórica (`HISTORICAL_REFERENCE_S0`)

> Documento **aditivo** de procedencia. Escrito por R0.2B — Task 34
> (`.kiro/specs/r0-engineering-baseline-recovery/`, Req 2A.2 c8 / 2B.3). **No** modifica el JSON
> histórico: `eval/baselines/v6-measured.json` es inmutable.

## Qué es

`eval/baselines/v6-measured.json` es `HISTORICAL_REFERENCE_S0`: el resultado numérico congelado de
Fase 9.0/9.1 (Golden Dataset + backtest, titular `NDCG@5` con el ranker `v6Full`). No tiene un
bloque `identity` ni un campo `metaSnapshotVersion`, así que el sistema de identidad de R0.2B lo
trata como referencia histórica **incomparable** contra cualquier candidate medido sobre S1.

## Los commits — tres cosas distintas que el campo `commit` mezclaba

| Rol | Commit | Nota |
|---|---|---|
| **Motor realmente medido** (comportamiento V6) | `df354b9c4ed415b86dba35dc92e2f84e5cb40e5d` | Es el `apps/engine/src/**` cuyas sugerencias produjeron las métricas de este artefacto. |
| **Escritor del artefacto** (`commit` en el JSON) | `e0b77d781a664be86258546e906505ad1687c9cf` | Es el HEAD en que se corrió `run.ts` y se serializó el archivo — **no** es el motor medido. |
| **Harness de evaluación** | (no registrado por separado en el artefacto legacy) | Fase 9.0/9.1. |

El artefacto legacy guardaba un único `commit` (`e0b77d7…`) y el motor medido se **infería** de
`git rev-parse HEAD`. Eso es el bug de procedencia que Task 34 corrige: `EvaluationMetadata` ahora
separa `measuredEngineCommit` y `evaluationHarnessCommit`, y **ninguno** decide `isComparable()`.

## El snapshot de meta de S0 está PERDIDO

El SQLite de meta (`heroes` / `hero_patch_stats` / `hero_matchups`) que alimentó este backtest **no
se conservó y no se puede reconstruir** (`Snapshot Recovery Preflight = NO_TRUSTWORTHY_SNAPSHOT`).
Por eso `metaSnapshotVersion` de S0 es, y será siempre, `null`.

## Consecuencia: las métricas numéricas de S0 NO se comparan directamente con S1

- El backtest es un instrumento **comparativo, nunca predictivo** (ADR-002): el valor absoluto de
  `NDCG@5` / `Bad Pick Rate@5` / `Recall@k` sólo significa algo relativo a un baseline medido sobre
  **el mismo** snapshot de meta.
- S1 es un snapshot **nuevo** (Task 34 → HUMAN S1 CHECKPOINT). Su meta no es la de S0.
- Por lo tanto: `isComparable(candidate_sobre_S1, HISTORICAL_REFERENCE_S0)` ⇒ **`BLOCKED`**
  (`metaSnapshotVersion` de un lado es `null`). Es correcto, no un defecto.
- **FAIL CLOSED / C2**: `metaSnapshotVersion` `null` en **cualquier** lado bloquea — incluido
  `null` vs `null` (dos artefactos sin huella). Una identidad de snapshot **desconocida** nunca es
  prueba de que dos corridas midieron sobre el mismo meta. `gate.ts` (`--enforce`) devuelve
  `BLOCKED` **antes** de evaluar ninguna métrica; nunca hay un PASS silencioso por "las métricas
  mejoraron".

## Cómo se recupera igual la regresión OLD-vs-CURRENT del motor

No con las métricas de S0. Se re-corren **ambos** motores sobre el **mismo** S1 congelado:

- `REBASED_REFERENCE(S1)` = motor VIEJO `df354b9…` (overlay bajo el harness actual) sobre S1 — Task 35.
- `CURRENT_CANDIDATE(S1)` = motor actual (HEAD limpio) sobre S1.
- La Task 19 compara esos dos: misma `EvaluationIdentity` salvo `measuredEngineCommit`; cualquier
  mismatch de `metaSnapshotVersion` ⇒ `BLOCKED`. Su PASS/FAIL es el juicio real de regresión.

## Reglas

- `v6-measured.json` **no se sobrescribe, no se borra, no se promueve** — nunca. `run.ts` se niega
  a escribir en esa ruta.
- Su reemplazo como baseline de `--enforce` es decisión de la Task 20 (human-in-the-loop, sólo con
  Task 19 PASS), que congela un `eval/baselines/accepted.s1.json` **nuevo**.
