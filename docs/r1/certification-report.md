# R1 S7 Certification Report

Commit: `7be86fa0cca265ce586590f181b6c7ce81c0983e` (branch `r1/product-certification`, dirty)
Functional hash: `2f17648a2a63e88b607d2957cd9922b2f93ce68f785d6534de3dff2134eaf985`

## Decision

| Dimension | Status |
|---|---|
| machineCertification | **PASS** |
| productE2E | **PASS** |
| qualityGolden | **HUMAN_GATE** (0/32 human-reviewed, 1 deterministic fixture(s) missing of 28) |
| **overallR1** | **HUMAN_GATE** |

> **HUMAN_GATE: MISSING_R1_GOLDEN_HUMAN_REVIEW** -- every technical/product gate below is green; R1 Golden v1's 32 quality cases still need a real, named, non-LLM reviewer signoff. See `docs/r1/golden/human-review-guide.md`. This is intentionally NOT reported as PASS.

## Gates

| Gate | Class | Status | Summary |
|---|---|---|---|
| root_tests | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| engine_typecheck | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| web_typecheck | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| web_lint | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| verify_simplicity | required | PASS | SKIPPED_REUSED: already required+green in CI job 'verify-simplicity' (needs:) |
| engine_quality_gate | required | PASS | SKIPPED_REUSED: already required+green in CI job 'intelligence-ci' (needs:) |
| ap_gate | required | PASS | bun test v1.4.2 (744846f84) /  78 pass /  0 fail /  242 expect() calls / Ran 78 tests across 6 files. [36.00ms] |
| cm_gate | required | PASS | bun test v1.4.2 (744846f84) /  80 pass /  0 fail /  269 expect() calls / Ran 80 tests across 5 files. [39.00ms] |
| recommendation_legality_gate | required | PASS | S6 real-V6 perf (110 heroes): runs=4.4,6.4,6.2ms max=6.4ms median=6.2ms / apps\engine\src\recommendation\build.test.ts: /  55 pass /  0 fail /  188 expect() calls / Ran 55 tests across 5 files. [89.00ms] |
| hidden_info_gate | required | PASS | bun test v1.4.2 (744846f84) /  20 pass /  0 fail /  37 expect() calls / Ran 20 tests across 3 files. [22.00ms] |
| role_gate | required | PASS | bun test v1.4.2 (744846f84) /  29 pass /  0 fail /  179 expect() calls / Ran 29 tests across 3 files. [15.00ms] |
| s6_gate | required | PASS | bun test v1.4.2 (744846f84) /  55 pass /  0 fail /  142 expect() calls / Ran 55 tests across 4 files. [35.00ms] |
| adapter_parity_gate | required | PASS | bun test v1.4.2 (744846f84) /  1 pass /  0 fail /  34 expect() calls / Ran 1 test across 1 file. [24.00ms] |
| product_e2e | required | PASS | [WebServer]  We detected multiple lockfiles and selected the directory of D:\JULIO\apuherrerafoprojects\dota2coach\bun.lock as the root directory. / [WebServer]  To silence this warning, set `outputFileTracingRoot` in your Next.js config, or consider removing one of the lockfiles if it's not needed. / [WebServer]    See https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats for more information. / [WebServer]  Detected additional lockfiles:  / [WebServer]    * D:\JULIO\ap |

## Known gaps (not fabricated, not silently hidden)

- **r1_golden_v1_human_review**: R1 Golden v1's deterministic scaffold exists (docs/r1/golden/) -- 27/28 fixture slots have a real existing equivalent test, 1 genuinely missing. The 32 quality cases are a real, deterministic template (docs/r1/golden/quality-cases-template.json) with zero labels filled -- 0/32 have a real human reviewerSignoff. See docs/r1/golden/human-review-guide.md for the review protocol. This is the ONLY thing standing between HUMAN_GATE and PASS.

## Non-functional telemetry (excluded from functionalHash)

Generated at 2026-09-16T18:14:52.946Z, took 153713ms, Node v26.3.0, machineOnly=true, skipE2E=false.
