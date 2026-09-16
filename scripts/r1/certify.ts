#!/usr/bin/env bun
// R1 S7 -- single canonical entry point for R1 certification ("bun run verify:r1").
//
// This script does NOT reimplement any check. Every gate below invokes the exact same command a
// developer or CI already runs elsewhere (root `bun run test`, engine/web `tsc --noEmit`, web
// `bun run lint`, `scripts/verify-simplicity.sh`, `scripts/eval/gate.ts --enforce`). It only:
//   1. orchestrates them in one run;
//   2. re-groups the existing R1 test files (draft-protocol/, recommendation/, and the adapter
//      parity integration test under server/) into the certification categories the R1 program
//      cares about (AP, CM, recommendation legality, hidden-info, role, S6, adapter parity) --
//      these files already exist and already pass as part of step 1's full `bun test apps/engine`;
//      running them again by name only gives the report per-category resolution;
//   3. writes one reproducible JSON artifact plus a human-readable Markdown summary.
//
// Deliberately NOT included here: browser E2E (`bun run e2e`). Same reasoning the project already
// applies everywhere else (CLAUDE.md, `bun run e2e`'s own description): it is slow (~1-2 min),
// needs a synced local meta DB, and its place is /castoff pre-deploy, not a gate a developer reruns
// on every commit. `verify:r1` stays fast enough to actually be run before every push.
//
// Determinism: the FUNCTIONAL section of the report (git identity, per-gate PASS/FAIL, R1 Golden
// status, blockers) never includes a wall-clock timestamp or duration -- those live only in the
// separate `telemetry` section. Two clean runs against the same commit produce the same
// `functionalHash`.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..", "..");
const REPORT_DIR = resolve(ROOT, "docs", "r1");

type GateStatus = "PASS" | "FAIL" | "SKIPPED";

interface GateResult {
  id: string;
  klass: "required" | "informational";
  command: string;
  status: GateStatus;
  summary: string;
}

function sh(command: string, cwd: string = ROOT): { code: number; tail: string } {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const tail = lines.slice(-6).join(" | ").slice(0, 500);
  return { code: result.status ?? 1, tail };
}

function gate(id: string, klass: GateResult["klass"], command: string, cwd: string = ROOT): GateResult {
  const { code, tail } = sh(command, cwd);
  return { id, klass, command, status: code === 0 ? "PASS" : "FAIL", summary: tail };
}

// ---------------------------------------------------------------------------------------------
// R1 certification categories -- existing test files, re-grouped for reporting resolution.
// Every file listed here already runs as part of `bun test apps/engine` (foundational gate below);
// this is a SUBSET re-run purely to attribute pass/fail per R1 category in the artifact.
// ---------------------------------------------------------------------------------------------

const AP_GATE_FILES = [
  "apps/engine/src/draft-protocol/rulesets/ranked-all-pick.test.ts",
  "apps/engine/src/draft-protocol/party-context.test.ts",
  "apps/engine/src/draft-protocol/adapters/simulator-authority.test.ts",
  "apps/engine/src/draft-protocol/kernel.test.ts",
  "apps/engine/src/draft-protocol/kernel.adversarial.test.ts",
  "apps/engine/src/server/protocol-session.integration.test.ts",
];

const CM_GATE_FILES = [
  "apps/engine/src/draft-protocol/rulesets/captains-mode.test.ts",
  "apps/engine/src/draft-protocol/adapters/cm-simulator.test.ts",
  "apps/engine/src/draft-protocol/eligibility.test.ts",
  "apps/engine/src/draft-protocol/trusted-eligibility.test.ts",
  "apps/engine/src/server/protocol-session.cm-acceptance.test.ts",
];

const RECOMMENDATION_LEGALITY_FILES = [
  "apps/engine/src/recommendation/decision.test.ts",
  "apps/engine/src/recommendation/shortlist.test.ts",
  "apps/engine/src/recommendation/build.test.ts",
  "apps/engine/src/recommendation/architecture-guard.test.ts",
  "apps/engine/src/recommendation/translate-v1.test.ts",
];

const HIDDEN_INFO_FILES = [
  "apps/engine/src/draft-protocol/identity-hash.test.ts",
  "apps/engine/src/draft-protocol/perspective.test.ts",
  "apps/engine/src/recommendation/identity.test.ts",
];

const ROLE_GATE_FILES = [
  "apps/engine/src/draft-protocol/roles/role-belief.test.ts",
  "apps/engine/src/draft-protocol/roles/joint-assignment.test.ts",
  "apps/engine/src/recommendation/role-impact.test.ts",
];

const S6_GATE_FILES = [
  "apps/engine/src/recommendation/lookahead.test.ts",
  "apps/engine/src/recommendation/observation-point.test.ts",
  "apps/engine/src/recommendation/opponent-model.test.ts",
  "apps/engine/src/recommendation/steal.test.ts",
];

const ADAPTER_PARITY_FILES = [
  "apps/engine/src/server/adapter-parity.integration.test.ts",
  // cm-simulator.test.ts also carries a dedicated manual-vs-simulator CM parity case (see
  // CM_GATE_FILES) -- not duplicated here to avoid double-counting the same file in two totals.
];

function testGate(id: string, files: string[]): GateResult {
  const missing = files.filter((file) => !existsSync(resolve(ROOT, file)));
  if (missing.length > 0) {
    return { id, klass: "required", command: "bun test", status: "FAIL", summary: `missing fixture files: ${missing.join(", ")}` };
  }
  return gate(id, "required", `bun test ${files.join(" ")}`);
}

function reused(id: string, command: string, reason: string): GateResult {
  return { id, klass: "required", command, status: "PASS", summary: `SKIPPED_REUSED: ${reason}` };
}

async function main(argv: string[]): Promise<number> {
  mkdirSync(REPORT_DIR, { recursive: true });

  const commit = sh("git rev-parse HEAD").tail;
  const branch = sh("git rev-parse --abbrev-ref HEAD").tail;
  const dirtyOutput = spawnSync("git status --porcelain", { cwd: ROOT, shell: true, encoding: "utf-8" }).stdout ?? "";
  const dirty = dirtyOutput.split("\n").some((line) => line.trim().length > 0 && !line.includes("scripts/hooks/__pycache__"));

  const startedAt = Date.now();

  // --reuse-foundation: CI-only. The `r1-certification` GitHub Actions job runs with
  // `needs: [test, verify-simplicity, intelligence-ci]` -- by the time this script runs there, the
  // full `bun run test` (~1700+ tests across 3 trees), both `tsc --noEmit`, `bun run lint`,
  // `verify-simplicity.sh`, and `gate.ts --enforce` have ALREADY passed as separate required jobs
  // in the same workflow run. Re-running them here would be exactly the "needlessly run the same
  // 1700+ tests multiple extra times" this program was told to avoid. This flag reuses that result
  // instead of re-deciding it -- REUSE (Option A), not a second, competing source of truth. Locally
  // (no flag) this stays the comprehensive single command a developer runs before pushing.
  const reuseFoundation = argv.includes("--reuse-foundation");

  const foundational: GateResult[] = reuseFoundation
    ? [
        reused("root_tests", "bun run test", "already required+green in CI job 'test' (needs:)"),
        reused("engine_typecheck", "bun x tsc --noEmit", "already required+green in CI job 'test' (needs:)"),
        reused("web_typecheck", "bun x tsc --noEmit", "already required+green in CI job 'test' (needs:)"),
        reused("web_lint", "bun run lint", "already required+green in CI job 'test' (needs:)"),
        reused("verify_simplicity", "bash scripts/verify-simplicity.sh", "already required+green in CI job 'verify-simplicity' (needs:)"),
        reused("engine_quality_gate", "bun run scripts/eval/gate.ts --enforce", "already required+green in CI job 'intelligence-ci' (needs:)"),
      ]
    : [
        gate("root_tests", "required", "bun run test"),
        gate("engine_typecheck", "required", "bun x tsc --noEmit", resolve(ROOT, "apps/engine")),
        gate("web_typecheck", "required", "bun x tsc --noEmit", resolve(ROOT, "apps/web")),
        gate("web_lint", "required", "bun run lint", resolve(ROOT, "apps/web")),
        gate("verify_simplicity", "required", "bash scripts/verify-simplicity.sh"),
        gate("engine_quality_gate", "required", "bun run scripts/eval/gate.ts --enforce"),
      ];

  // R1-specific certification categories.
  const r1Categories: GateResult[] = [
    testGate("ap_gate", AP_GATE_FILES),
    testGate("cm_gate", CM_GATE_FILES),
    testGate("recommendation_legality_gate", RECOMMENDATION_LEGALITY_FILES),
    testGate("hidden_info_gate", HIDDEN_INFO_FILES),
    testGate("role_gate", ROLE_GATE_FILES),
    testGate("s6_gate", S6_GATE_FILES),
    testGate("adapter_parity_gate", ADAPTER_PARITY_FILES),
  ];

  const durationMs = Date.now() - startedAt;

  // R1 Golden v1 (28 deterministic protocol fixtures + 32 human-reviewed Dota quality cases) --
  // audited against the actual repo (not assumed from any prior design note). Zero occurrence of
  // "R1 Golden", "28 deterministic", or "32 human-reviewed" anywhere in code/docs/.kiro/specs. No
  // S7 design document exists at all (S7 is only ever a forward-reference inside the S5/S6 docs).
  // The only Golden dataset in the repo is eval/golden/dataset.json (30 cases, Fase 9/TSK-206,
  // LLM-panel labeled -- NOT human-reviewed, and NOT about protocol/recommendation correctness).
  // Since no frozen R1 spec requires this artifact for S7 to close, this is reported honestly as
  // MISSING rather than either fabricated or silently substituted with Golden30.
  const r1GoldenStatus = "MISSING" as const;

  const allGates = [...foundational, ...r1Categories];
  const blockers = allGates.filter((g) => g.klass === "required" && g.status !== "PASS");
  const overallStatus: GateStatus = blockers.length === 0 ? "PASS" : "FAIL";

  // Functional identity: everything that should be byte-identical between two clean runs against
  // the same commit/data/seed -- the DECISION, never the raw log text. `summary` deliberately
  // excluded: test-runner tails carry wall-clock durations (e.g. "[132.00ms]", "runs=6.9,11.3ms")
  // that differ between two otherwise-identical runs and would make the hash lie about being an
  // identity. Only `id`/`klass`/`status` per gate are hashed; `summary` stays in the full report
  // for a human, outside the hashed payload.
  const functionalPayload = {
    schemaVersion: 1,
    certificationId: "r1-s7",
    commit,
    branch,
    dirty,
    gates: allGates.map(({ id, klass, status }) => ({ id, klass, status })),
    overallStatus,
    r1GoldenStatus,
  };
  const functionalHash = createHash("sha256").update(JSON.stringify(functionalPayload)).digest("hex");

  const report = {
    schemaVersion: functionalPayload.schemaVersion,
    certificationId: functionalPayload.certificationId,
    commit,
    branch,
    dirty,
    gates: allGates,
    overallStatus,
    r1GoldenStatus,
    functionalHash,
    knownGaps: [
      {
        id: "party_size_ui",
        detail: "apps/web's ConfigPanel has no party-size selector -- createSimulatorProtocolSession always requests a fixed 5-controlled-slot Ranked AP session. Party 2/3/4/5 are only distinguishable at the protocol/kernel level (party-context.test.ts), not through the product UI. Pre-existing since S2-S4, not introduced by S7.",
      },
      {
        id: "captains_mode_ui",
        detail: "No product UI entry point creates a Captain's Mode session. CM is fully built and certified at the engine/protocol level (rulesets/captains-mode.ts, cm-simulator.ts, 24-step ruleset, trusted eligibility) but unreachable from the browser today. Pre-existing since S3, not introduced by S7.",
      },
      {
        id: "r1_golden_v1",
        detail: "R1 Golden v1 (28 deterministic protocol fixtures + 32 human-reviewed Dota quality cases) does not exist in this repo and no frozen S7 spec requires it -- see r1GoldenStatus.",
      },
    ],
    deferredToR2: [
      "Overwolf/OCR live capture, GSI integration, memory reading (S7 mandate non-goal; SPEC.md already specifies these as contract-only, built later).",
      "Deep lookahead (multi-ply), MCTS/beam search, opponent-probability calibration -- S6 stays exactly one ply, uncalibrated, top-1-only by design; no S7 change to this mechanism.",
      "Party-size (2/3/4) and Captain's Mode entries in the simulator's ConfigPanel -- both are real, protocol-certified capabilities with no product UI today; adding that UI is scoped product work, not an S7 integration task, and building it inside this slice would have violated the mandate's own 'no broad UI redesign' non-goal.",
      "GuessingIndex/EvidenceCoverage UI surface -- explicitly deferred by the Fase 9.1 design (D4) to a follow-up once real usage data exists.",
      "Auth/billing/Premium/matchmaking/deployment-architecture changes -- untouched, as instructed.",
    ],
    telemetry: {
      generatedAt: new Date().toISOString(),
      durationMs,
      node: process.version,
    },
  };

  writeFileSync(resolve(REPORT_DIR, "certification-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(REPORT_DIR, "certification-report.md"), renderMarkdown(report));

  for (const g of allGates) {
    const marker = g.status === "PASS" ? "PASS" : "FAIL";
    console.log(`[${marker}] ${g.id} -- ${g.summary}`);
  }
  console.log(`\nR1 S7 CERTIFICATION: ${overallStatus}`);
  console.log(`functionalHash: ${functionalHash}`);
  console.log(`R1 Golden v1: ${r1GoldenStatus}`);
  console.log(`report: docs/r1/certification-report.json`);

  return overallStatus === "PASS" ? 0 : 1;
}

function renderMarkdown(report: {
  commit: string; branch: string; dirty: boolean; overallStatus: string; functionalHash: string;
  r1GoldenStatus: string; gates: GateResult[]; knownGaps: { id: string; detail: string }[];
  telemetry: { generatedAt: string; durationMs: number; node: string };
}): string {
  const rows = report.gates
    .map((g) => `| ${g.id} | ${g.klass} | ${g.status} | ${g.summary.replace(/\|/g, "/")} |`)
    .join("\n");
  const gaps = report.knownGaps.map((gap) => `- **${gap.id}**: ${gap.detail}`).join("\n");
  return `# R1 S7 Certification Report

Commit: \`${report.commit}\` (branch \`${report.branch}\`, ${report.dirty ? "dirty" : "clean"})
Overall status: **${report.overallStatus}**
Functional hash: \`${report.functionalHash}\`
R1 Golden v1: **${report.r1GoldenStatus}**

## Gates

| Gate | Class | Status | Summary |
|---|---|---|---|
${rows}

## Known gaps (not fabricated, not silently hidden)

${gaps}

## Non-functional telemetry (excluded from functionalHash)

Generated at ${report.telemetry.generatedAt}, took ${report.telemetry.durationMs}ms, Node ${report.telemetry.node}.
`;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
export { main };
