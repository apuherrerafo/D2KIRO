# R1 S7 Certification Report

Commit: `b4f4c527bebb9b3be1bc652867d7fd8b76e564c7` (branch `r1/product-certification`, dirty)
Overall status: **PASS**
Functional hash: `33966310f04582eab9903c17b737b3ab2ba8758c193263e21fdd8018864a4668`
R1 Golden v1: **MISSING**

## Gates

| Gate | Class | Status | Summary |
|---|---|---|---|
| root_tests | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| engine_typecheck | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| web_typecheck | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| web_lint | required | PASS | SKIPPED_REUSED: already required+green in CI job 'test' (needs:) |
| verify_simplicity | required | PASS | SKIPPED_REUSED: already required+green in CI job 'verify-simplicity' (needs:) |
| engine_quality_gate | required | PASS | SKIPPED_REUSED: already required+green in CI job 'intelligence-ci' (needs:) |
| ap_gate | required | PASS | bun test v1.4.2 (744846f84) /  78 pass /  0 fail /  242 expect() calls / Ran 78 tests across 6 files. [46.00ms] |
| cm_gate | required | PASS | bun test v1.4.2 (744846f84) /  80 pass /  0 fail /  269 expect() calls / Ran 80 tests across 5 files. [54.00ms] |
| recommendation_legality_gate | required | PASS | S6 real-V6 perf (110 heroes): runs=8.8,8.5,9.3ms max=9.3ms median=8.8ms / apps\engine\src\recommendation\build.test.ts: /  55 pass /  0 fail /  188 expect() calls / Ran 55 tests across 5 files. [122.00ms] |
| hidden_info_gate | required | PASS | bun test v1.4.2 (744846f84) /  20 pass /  0 fail /  37 expect() calls / Ran 20 tests across 3 files. [29.00ms] |
| role_gate | required | PASS | bun test v1.4.2 (744846f84) /  29 pass /  0 fail /  179 expect() calls / Ran 29 tests across 3 files. [19.00ms] |
| s6_gate | required | PASS | bun test v1.4.2 (744846f84) /  55 pass /  0 fail /  142 expect() calls / Ran 55 tests across 4 files. [50.00ms] |
| adapter_parity_gate | required | PASS | bun test v1.4.2 (744846f84) /  1 pass /  0 fail /  34 expect() calls / Ran 1 test across 1 file. [33.00ms] |

## Known gaps (not fabricated, not silently hidden)

- **party_size_ui**: apps/web's ConfigPanel has no party-size selector -- createSimulatorProtocolSession always requests a fixed 5-controlled-slot Ranked AP session. Party 2/3/4/5 are only distinguishable at the protocol/kernel level (party-context.test.ts), not through the product UI. Pre-existing since S2-S4, not introduced by S7.
- **captains_mode_ui**: No product UI entry point creates a Captain's Mode session. CM is fully built and certified at the engine/protocol level (rulesets/captains-mode.ts, cm-simulator.ts, 24-step ruleset, trusted eligibility) but unreachable from the browser today. Pre-existing since S3, not introduced by S7.
- **r1_golden_v1**: R1 Golden v1 (28 deterministic protocol fixtures + 32 human-reviewed Dota quality cases) does not exist in this repo and no frozen S7 spec requires it -- see r1GoldenStatus.

## Non-functional telemetry (excluded from functionalHash)

Generated at 2026-09-16T16:27:42.678Z, took 718ms, Node v26.3.0.
