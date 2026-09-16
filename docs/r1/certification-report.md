# R1 S7 Certification Report

> **Nota (R1 S7 final blocker repair, Blocker 3):** este archivo es un snapshot histórico congelado
> de la corrida que se describe abajo -- ya NO es el destino de escritura de `bun run verify:r1`.
> La salida runtime de cada corrida vive en `docs/r1/generated/certification-report.{json,md}`
> (gitignored, nunca trackeado) para que correr el certificador no ensucie un árbol limpio. Ver el
> comentario de `REPORT_DIR` en `scripts/r1/certify.ts`.

Commit: `f863d8757c974ce86eec7986e097068e459374c7` (branch `r1/product-certification`, dirty)
Functional hash: `925f34f34e9d02ed0369bd3bb9ff0be8f3b4a0595b50838156b29f38b74e5bf9`

## Decision

| Dimension | Status |
|---|---|
| machineCertification | **PASS** |
| productE2E | **PASS** |
| qualityGolden | **HUMAN_GATE** (0/32 human-reviewed, 0 deterministic fixture(s) missing of 28) |
| **overallR1** | **HUMAN_GATE** |

> **HUMAN_GATE: MISSING_R1_GOLDEN_HUMAN_REVIEW** -- every technical/product gate below is green; R1 Golden v1's 32 quality cases still need a real, named, non-LLM reviewer signoff. See `docs/r1/golden/human-review-guide.md`. This is intentionally NOT reported as PASS.

## Gates

| Gate | Class | Status | Summary |
|---|---|---|---|
| root_tests | required | PASS | (pass) profileFromStates — perfil de señales (C5) > histograma de nº de señales con voto suma 1 y tiene 7 celdas (0..6) [0.78ms] / (pass) profileFromStates — perfil de señales (C5) > determinismo: misma entrada -> mismo resultado [2.95ms] /  398 pass /  0 fail /  2017 expect() calls / Ran 398 tests across 41 files. [30.91s] |
| engine_typecheck | required | PASS |  |
| web_typecheck | required | PASS |  |
| web_lint | required | PASS | D:\JULIO\apuherrerafoprojects\dota2coach\apps\web\features\random-draft-simulator\bot-drafter.ts /   223:58  warning  '_conflictCount' is assigned a value but never used  @typescript-eslint/no-unused-vars / D:\JULIO\apuherrerafoprojects\dota2coach\apps\web\features\random-draft-simulator\use-config-persistence.ts /   96:12  warning  'err' is defined but never used  @typescript-eslint/no-unused-vars / ✖ 5 problems (0 errors, 5 warnings) / $ eslint |
| verify_simplicity | required | PASS | 🦴 Verificando reglas del proyecto... / 🔒 Toolchain Bun OK: 1.4.2 == package.json#packageManager (bun@1.4.2) / ✅ Verificación de simplicidad superada. |
| engine_quality_gate | required | PASS |     - Engine Quality / Benchmark A [required]: PASS — sin regresión /     - Professional Pick Agreement / Benchmark B [informational]: SKIPPED — pro-drafts.sqlite ausente /   reportado (no bloquea): /     - Professional Pick Agreement / Benchmark B: SKIPPED — pro-drafts.sqlite ausente (informational, no bloquea) /   comparabilidad: sí (mismo dataset + protocolo + familia de scoring) /   exit: 0 |
| ap_gate | required | PASS | (pass) Ranked All Pick — isSealedSelectionLegal (Blocker 3, paridad con el kernel) > un heroId inválido (NaN) nunca es legal [0.04ms] / (pass) Ranked All Pick — isSealedSelectionLegal (Blocker 3, paridad con el kernel) > fuera de una ronda de picks (aún en bans) nunca es legal [0.01ms] /  78 pass /  0 fail /  242 expect() calls / Ran 78 tests across 6 files. [39.00ms] |
| cm_gate | required | PASS | (pass) Captain's Mode — heroId inválido (Blocker 4C) > CM_ACTION con heroId NaN se rechaza con INVALID_HERO_ID [0.11ms] / (pass) Captain's Mode — heroId inválido (Blocker 4C) > CM_AUTO_PICK con heroId Infinity se rechaza con INVALID_HERO_ID [0.17ms] /  80 pass /  0 fail /  269 expect() calls / Ran 80 tests across 5 files. [40.00ms] |
| recommendation_legality_gate | required | PASS | (pass) translateRecommendationSetToLegacySuggestionSet -- proyecta, nunca rescorea > comparison siempre null -- el traductor nunca inventa una comparación que V2 no calculó [0.01ms] / (pass) translateRecommendationSetToLegacySuggestionSet -- proyecta, nunca rescorea > degradations se proyectan sólo cuando son un DegradationFlag legacy válido [0.03ms] /  55 pass /  0 fail /  188 expect() calls / Ran 55 tests across 5 files. [92.00ms] |
| hidden_info_gate | required | PASS | (pass) buildBasedOn -- R1 S5 identity > basedOn.partyIdentity ignora controllerId (metadata de display, no funcional) -- sólo el conjunto de slots controlados importa [0.08ms] / (pass) buildBasedOn -- R1 S5 identity > basedOn.evidenceVersion cambia cuando el hash de evidencia cambia; se mantiene igual cuando es idéntico [0.12ms] /  20 pass /  0 fail /  37 expect() calls / Ran 20 tests across 3 files. [23.00ms] |
| role_gate | required | PASS | (pass) computeRoleBelief -- S4.1/S4.2 > heroPositions sin entrada para el héroe (host desconocido) también cae a UNRESOLVED, no lanza [0.03ms] / (pass) computeRoleBelief -- S4.1/S4.2 > determinismo: misma evidencia -> mismo resultado exacto [0.05ms] /  29 pass /  0 fail /  179 expect() calls / Ran 29 tests across 3 files. [16.00ms] |
| s6_gate | required | PASS | (pass) evaluateSteal -- disponibilidad protocolar, nunca membresía en un ranking acotado > compound -- de dos héroes candidatos, se reporta el de mayor valor base para el rival, y una acción real que sólo retira ESE lo materializa [0.06ms] / (pass) evaluateSteal -- disponibilidad protocolar, nunca membresía en un ranking acotado > desempate determinista: valores base iguales -> gana el heroId más bajo [0.04ms] /  55 pass /  0 fail /  142 expect() calls / Ran 55 tests across 4 files. [36.00ms] |
| adapter_parity_gate | required | PASS | (pass) adapter parity real -- manual observations vs simulator HTTP routes > AP sealed/reveal/collision produce el mismo estado y hash canónicos [4.56ms] / (pass) adapter parity real -- manual observations vs simulator HTTP routes > R1-FIX-PAR-04: CM manual vs simulador (rutas HTTP reales) produce el mismo estado y hash canónicos con FIRST=dire [5.22ms] /  2 pass /  0 fail /  117 expect() calls / Ran 2 tests across 1 file. [31.00ms] |
| product_e2e | required | PASS |   ok  9 e2e\captains-mode.spec.ts:48:7 › Captain's Mode -- entry point real, vía el motor › local = SECOND: el draft completo de 24 pasos termina, sin RecommendationSet fabricado (4.0s) /   ok 10 e2e\captains-mode.spec.ts:55:7 › Captain's Mode -- entry point real, vía el motor › progresión real de pick/ban: 14 bans + 10 picks, ningún héroe repetido (4.4s) /   ok 11 e2e\copilot-intelligence.spec.ts:35:5 › el Copilot muestra RecommendationSet/v2 real por ronda, sin sentinels ni basura filtrada a l |

## Known gaps (not fabricated, not silently hidden)

- **r1_golden_v1_human_review**: R1 Golden v1's deterministic scaffold exists (docs/r1/golden/) -- 28/28 fixture slots have a real existing equivalent test, 0 genuinely missing. The 32 quality cases are a real, deterministic template (docs/r1/golden/quality-cases-template.json) with zero labels filled -- 0/32 have a real human reviewerSignoff. See docs/r1/golden/human-review-guide.md for the review protocol. This is the ONLY thing standing between HUMAN_GATE and PASS.

## Non-functional telemetry (excluded from functionalHash)

Generated at 2026-09-16T20:20:44.831Z, took 143497ms, Node v26.3.0, machineOnly=false, skipE2E=false.
