# R0 Baseline Certification

## R0 GREEN

- **Certified HEAD:** `99f793d4bf88f4ef2e93eb1b37e34b0f204316d5`
- **Branch:** `r0/finalize`
- **PR:** [#2](https://github.com/apuherrerafo/D2KIRO/pull/2), open against `master`
- **Final CI:** [run 34808265637](https://github.com/apuherrerafo/D2KIRO/actions/runs/34808265637), completed successfully for the certified HEAD.
- **Bun:** `1.4.2`, derived from the sole canonical pin `package.json#packageManager` (`bun@1.4.2`).

## Re-review of prior blockers

1. **CI evidence — PASS.** GitHub's API confirms PR #2 targets `master` from `r0/finalize` at the certified HEAD. Run `34808265637` has conclusion `success`; `test (root)`, `test (engine)`, `test (web)`, `intelligence-ci (eval --enforce)`, and `verify-simplicity` each concluded `success`. `docs/agents/r0-discovery/task-31-canonical-bun-toolchain-truth.md` preserves the earlier static-only history and records the later real CI evidence.
2. **Whitespace — PASS.** `git diff --check 3ced3c1..HEAD` exits successfully. The previous extra blank line in `docs/rules-archive/fase-2.md` is absent.
3. **Post-review harness fixes — PASS.** `scripts/verify-simplicity.test.ts` uses `node:path`'s OS-aware delimiter, preserves the behavioral PATH execution trap, and strips only inherited CI diff-base variables for the local-path test invocation; the dedicated CI job still exercises its CI branch. `scripts/eval/rebased-reference.test.ts` uses `join("eval", "snapshots", "S1.sqlite")`, preserving semantic path validation across Windows and POSIX. No `apps/engine/src/**` or `apps/web/src/**` file changed after base `3ced3c1`; protected evaluation evidence was not modified by these fixes.

## Seven-point certification

1. **Software correctness — PASS.** Locally on Windows: `bun run test`, engine and web `bunx tsc --noEmit`, and web `bun run lint` pass (lint has six pre-existing warnings and zero errors). The same canonical test command passed in CI. `bash scripts/verify-simplicity.sh` confirms Bun `1.4.2` matches `packageManager`.
2. **Evaluation instrument — PASS.** `bun run scripts/eval/gate.ts --enforce` passes: Engine Quality / Benchmark A is required and PASS; Professional Pick Agreement / Benchmark B is explicitly `SKIPPED` informational because `pro-drafts.sqlite` is absent. It is reported, never treated as PASS.
3. **Comparable S1 evaluation — PASS.** `candidate.s1.json` and `reference.s1.json` share `datasetVersion=split:02dc8878;golden:30`, `evaluationProtocolVersion=schema:1;patchOverride:dominant`, `SCORING_WEIGHTS_V6`, and `metaSnapshotVersion=meta1:719c55caf22a9bf06e8e74428c201851ff3749ac61042ca19be44b31a01d293f`. The candidate was measured at `084b4115839e468f9031f6333cf5b60f00eaf993`; the `REBASED_CONTROL` was measured from historical engine `df354b9c4ed415b86dba35dc92e2f84e5cb40e5d` using the current harness. Task 19 recorded the enforce PASS.
4. **Approvals and protected evidence — PASS.** `v6-measured.json` remains immutable `HISTORICAL_REFERENCE_S0`; frozen S1 has manifest SHA `de7520a6af84a6a3eaad191b35ae81dade586914e1f41ccd2bdb838aa87d6478`; `reference.s1.json` is `REBASED_CONTROL`; `accepted.s1.json` was promoted only after Julio Herrera's explicit Task 20b approval, recorded in journal event `evt-20260913-261`. Task 22 is complete as `NO ACTION REQUIRED`; no Railway persistence action was needed.
5. **No required SKIPPED/BLOCKED — PASS.** The current enforced gate has no required non-PASS sub-check. Benchmark B is the sole informational SKIPPED result.
6. **PRE-PUSH and guards — PASS.** The repository uses `.husky/_` as `core.hooksPath`; `.husky/pre-push` runs canonical tests and both type checks fail-closed before push. CP6 tests prove Windows/POSIX path convergence and the data-boundary guard blocks ambiguous protected paths.
7. **No material R0 contradiction — PASS.** Searches and tests confirm no live claim that `e0b77d7` is the measured engine (it is only the historical artifact writer), no claim that label `7.41e` alone establishes comparability, and no old-harness fallback. `reference.s1.json` is never presented as an accepted baseline.

## Required vs. informational and residual non-blockers

- Required: all local and CI correctness gates, Engine Quality / Benchmark A, and the certification evidence are PASS.
- Informational: Benchmark B is `SKIPPED` because the optional professional-drafts corpus is unavailable; it is not a PASS and does not mask a required failure.
- Residual non-blockers: six existing web-lint warnings; and the absent optional Benchmark B corpus.

No push, merge, or change to `master` was performed.
