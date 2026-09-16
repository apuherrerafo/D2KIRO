#!/usr/bin/env bun
// R1 S7 completion wave -- single canonical entry point for R1 certification ("bun run verify:r1").
//
// CORRECTION (this wave): the previous version of this script reported `overallStatus: "PASS"`
// with `r1GoldenStatus: "MISSING"` -- a real contract violation. H0.5 (frozen outside this repo)
// requires R1 Golden v1 (28 deterministic protocol fixtures + 32 HUMAN-reviewed Dota quality
// cases, total 60) before R1 can be certified. LLM-only labels are never valid for this artifact.
//
// SECOND CORRECTION (R1 S7 final blocker repair, Blocker 2): a missing/malformed/unresolved
// deterministic fixture used to get silently absorbed into `qualityGolden: HUMAN_GATE` --
// `machineCertification` never even looked at the 28 deterministic fixtures, only at the 7
// technical gate categories. That meant a 27/28 manifest could report `machineCertification: PASS`
// while the real gap hid behind the human-review gate. Fixed by giving the deterministic half its
// own independent status (`deterministicGolden`, scripts/r1/golden-status.ts) and folding it (plus
// productE2E) directly into `machineCertification`'s own definition -- see
// computeMachineCertification below. This script now reports FIVE separate decisions:
//
//   machineCertification -- PASS/FAIL: every technical gate (tests, typecheck, lint, verify-
//                            simplicity, engine quality gate, the 7 R1 protocol/recommendation
//                            categories) PASS, AND productE2E PASS, AND deterministicGolden PASS.
//   deterministicGolden   -- PASS/FAIL: the 28 deterministic protocol fixtures, exact count, every
//                            `existing_equivalent` reference mechanically resolved against a real
//                            test on disk (scripts/r1/golden-status.ts). Never HUMAN_GATE -- a
//                            machine can decide this completely.
//   productE2E            -- PASS/FAIL: real browser E2E (`bun run e2e`) against the real
//                            protocol/engine path. Never silently skipped in "final certification"
//                            mode -- see --machine-only below for the one place it can be.
//   qualityGolden         -- PASS/HUMAN_GATE/FAIL: the 32 human-reviewed Dota quality cases,
//                            INDEPENDENT of deterministicGolden. HUMAN_GATE means the template
//                            exists and is well-formed but still awaits a real, named, non-LLM
//                            reviewer signoff -- SKIPPED is never printed here, this is never
//                            optional, only pending.
//   overallR1             -- PASS only if machineCertification, productE2E, and qualityGolden are
//                            ALL PASS. HUMAN_GATE when everything mechanical is green and only the
//                            human artifact is outstanding -- the honest state this program is in
//                            right now.
//
// Exit code policy (deliberately two modes, see CLI flags below):
//   default ("final certification"):    exit 0 only if overallR1 === "PASS".
//   --machine-only ("CI engineering"):  exit 0 if machineCertification === "PASS" -- which by
//                                        construction already requires productE2E PASS and
//                                        deterministicGolden PASS. The ONE thing this flag ignores
//                                        is qualityGolden (the 32 human-reviewed cases) -- its real
//                                        status is still always computed and always written to the
//                                        report, this flag changes what makes CI green, never what
//                                        the artifact claims.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getR1GoldenStatus, REQUIRED_QUALITY_COUNT, type R1GoldenStatus } from "./golden-status";

const ROOT = resolve(import.meta.dir, "..", "..");
// R1 S7 (final blocker repair, Blocker 3) -- runtime output moved to a GITIGNORED directory
// (docs/r1/generated/, see .gitignore). Running `verify:r1` must never dirty a clean source tree
// merely because it produced its own report -- the previous location (docs/r1/certification-
// report.{json,md}) was TRACKED, so every run rewrote committed files with a fresh generatedAt/
// duration/hash, leaving `git status` dirty right after a clean run. Those two tracked files stay
// in the repo as the historical snapshot from the wave that built this program (see
// docs/r1/certification-report.md's own header) -- they are documentation now, never a write
// target.
const REPORT_DIR = resolve(ROOT, "docs", "r1", "generated");

type GateStatus = "PASS" | "FAIL" | "SKIPPED";
type TopLevelStatus = "PASS" | "FAIL" | "HUMAN_GATE";

export interface GateResult {
  id: string;
  klass: "required" | "informational";
  command: string;
  status: GateStatus;
  summary: string;
}

function sh(command: string, cwd: string = ROOT): { code: number; tail: string } {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  // [WebServer] lines are Playwright forwarding the engine/web process's own stdout -- teardown
  // noise (Next.js workspace-root warnings) can print AFTER the real "N passed" summary line,
  // pushing it out of a blind last-N-lines window. Filtered out of the SUMMARY only -- full output
  // still went to this process's own stdout/stderr for a human reading the live run.
  const lines = output.split("\n").filter((line) => line.trim().length > 0 && !line.startsWith("[WebServer]"));
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

export function blockersOf(gates: GateResult[]): GateResult[] {
  return gates.filter((g) => g.klass === "required" && g.status !== "PASS");
}

// R1 S7 (final blocker repair, Blocker 2) -- machineCertification may PASS ONLY if: every
// technical/category gate is PASS, product E2E is PASS, AND deterministicGolden (the 28 fixtures,
// exact count, every reference resolved -- see golden-status.ts) is PASS. A missing, malformed, or
// unresolved deterministic fixture can NEVER again get reported as machineCertification: PASS
// while hiding behind qualityGolden's HUMAN_GATE -- that conflation was the exact bug this repairs.
// qualityGolden (the 32 human-reviewed cases) is DELIBERATELY excluded here -- it is the one thing
// `--machine-only` is allowed to ignore. Pure and exported so a regression test can prove the
// combinator's logic with a fabricated 27/28 `deterministicGolden: "FAIL"` input, never by mutating
// the real gate list or the real manifest (see certify.test.ts).
export function computeMachineCertification(
  machineGates: GateResult[],
  productE2E: TopLevelStatus,
  deterministicGolden: R1GoldenStatus["deterministicGolden"],
): TopLevelStatus {
  return blockersOf(machineGates).length === 0 && productE2E === "PASS" && deterministicGolden === "PASS" ? "PASS" : "FAIL";
}

// R1 S7 (final blocker repair, Blocker 3) -- everything the functional certification hash covers:
// stable DECISION inputs only (commit identity, gate/category verdicts, the R1 Golden manifest
// hash), never non-functional telemetry (`dirty`, wall-clock timings, absolute paths). Exported so
// the hash's reproducibility can be proven directly: same inputs -> same hash, and changing
// `r1GoldenManifestHash` alone must change it (see certify.test.ts's REPRODUCIBILITY TEST).
export interface FunctionalCertificationInputs {
  commit: string;
  branch: string;
  gates: { id: string; klass: GateResult["klass"]; status: GateStatus }[];
  machineCertification: TopLevelStatus;
  productE2E: TopLevelStatus;
  qualityGolden: TopLevelStatus;
  deterministicGolden: R1GoldenStatus["deterministicGolden"];
  overallR1: TopLevelStatus;
  r1Golden: { deterministicFixtures: R1GoldenStatus["deterministicFixtures"]; qualityCases: R1GoldenStatus["qualityCases"]; overall: R1GoldenStatus["overall"] };
  r1GoldenManifestHash: string | null;
}

export function buildFunctionalPayload(inputs: FunctionalCertificationInputs) {
  return { schemaVersion: 2, certificationId: "r1-s7", ...inputs };
}

export function computeFunctionalHash(inputs: FunctionalCertificationInputs): string {
  return createHash("sha256").update(JSON.stringify(buildFunctionalPayload(inputs))).digest("hex");
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
  // --machine-only: see header comment. Changes ONLY the exit code policy, never what the report
  // claims -- qualityGolden's real status is always computed and always written.
  const machineOnly = argv.includes("--machine-only");
  // --skip-e2e: local fast-iteration escape hatch ONLY. productE2E is reported SKIPPED (never
  // PASS -- SKIPPED != PASS), which alone prevents overallR1 from ever reaching PASS this run,
  // matching --machine-only's exit-code split: use --machine-only if you want a green exit code
  // without a real productE2E run; --skip-e2e never fakes that gate as green.
  const skipE2E = argv.includes("--skip-e2e");

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

  const machineGates = [...foundational, ...r1Categories];

  // Product E2E (R1 S7 completion wave, Blocker 1/2/3 mandate): real browser -> API ->
  // ProtocolKernel -> RecommendationSet/v2 -> Copilot, self-contained (e2e/bootstrap-db.ts). Never
  // silently reused from another CI job (no such job exists yet) -- either it runs for real, or
  // --skip-e2e marks it SKIPPED, which by itself blocks overallR1 from PASS this run.
  let e2eGate: GateResult;
  if (skipE2E) {
    e2eGate = { id: "product_e2e", klass: "required", command: "bun run e2e", status: "SKIPPED", summary: "--skip-e2e: NOT verified this run (never counts as PASS)" };
  } else {
    e2eGate = gate("product_e2e", "required", "bun run e2e");
  }
  const productE2E: TopLevelStatus = e2eGate.status === "PASS" ? "PASS" : "FAIL";

  const allGates = [...machineGates, e2eGate];

  // R1 Golden v1 (Blocker 3): deterministic status from the real scaffold this wave built --
  // docs/r1/golden/{deterministic-fixtures-manifest,quality-cases-template}.json, computed by
  // scripts/r1/golden-status.ts. deterministicGolden and qualityGolden are read STRAIGHT from
  // r1Golden -- never re-derived from `overall`, which is informational-only precisely so this
  // conflation (final blocker repair, Blocker 2) can't recur.
  const r1Golden: R1GoldenStatus = getR1GoldenStatus();
  const qualityGolden: TopLevelStatus = r1Golden.qualityGolden;

  // R1 S7 (final blocker repair, Blocker 2): machineCertification now structurally REQUIRES
  // productE2E PASS and deterministicGolden PASS -- see computeMachineCertification's doc comment.
  const machineCertification: TopLevelStatus = computeMachineCertification(machineGates, productE2E, r1Golden.deterministicGolden);

  const overallR1: TopLevelStatus =
    machineCertification === "PASS" && productE2E === "PASS" && qualityGolden === "PASS"
      ? "PASS"
      : machineCertification === "FAIL" || productE2E === "FAIL" || qualityGolden === "FAIL"
        ? "FAIL"
        : "HUMAN_GATE";

  const durationMs = Date.now() - startedAt;

  // Functional identity: everything that should be byte-identical between two clean runs against
  // the same commit/data/seed -- the DECISION, never the raw log text or non-functional telemetry.
  // `summary` deliberately excluded: test-runner tails carry wall-clock durations that differ
  // between two otherwise-identical runs. `dirty` deliberately excluded too (R1 S7 final blocker
  // repair, Blocker 3): it's a mutable fact about the working tree at the moment this ran, not a
  // certification decision input -- reported as telemetry below, never hashed. `r1GoldenManifestHash`
  // is deliberately INCLUDED (previously excluded -- the bug this repairs): the manifest's content
  // is exactly the kind of decision input a functional identity must cover, and changing it must
  // change the hash.
  const functionalInputs: FunctionalCertificationInputs = {
    commit,
    branch,
    gates: allGates.map(({ id, klass, status }) => ({ id, klass, status })),
    machineCertification,
    productE2E,
    qualityGolden,
    deterministicGolden: r1Golden.deterministicGolden,
    overallR1,
    r1Golden: { deterministicFixtures: r1Golden.deterministicFixtures, qualityCases: r1Golden.qualityCases, overall: r1Golden.overall },
    r1GoldenManifestHash: r1Golden.manifestHash,
  };
  const functionalHash = computeFunctionalHash(functionalInputs);

  const report = {
    ...functionalInputs,
    dirty,
    gates: allGates,
    functionalHash,
    knownGaps: [
      {
        id: "r1_golden_v1_human_review",
        detail: `R1 Golden v1's deterministic scaffold exists (docs/r1/golden/) -- ${r1Golden.deterministicFixtures.existingEquivalent}/${r1Golden.deterministicFixtures.totalSlots || 28} fixture slots have a real existing equivalent test, ${r1Golden.deterministicFixtures.missing} genuinely missing. The 32 quality cases are a real, deterministic template (docs/r1/golden/quality-cases-template.json) with zero labels filled -- ${r1Golden.qualityCases.reviewedCount}/${r1Golden.qualityCases.totalSlots || 32} have a real human reviewerSignoff. See docs/r1/golden/human-review-guide.md for the review protocol. This is the ONLY thing standing between HUMAN_GATE and PASS.`,
      },
    ],
    deferredToR2: [
      "Overwolf/OCR live capture, GSI integration, memory reading (S7 mandate non-goal; SPEC.md already specifies these as contract-only, built later).",
      "Deep lookahead (multi-ply), MCTS/beam search, opponent-probability calibration -- S6 stays exactly one ply, uncalibrated, top-1-only by design; no S7 change to this mechanism.",
      "GuessingIndex/EvidenceCoverage UI surface -- explicitly deferred by the Fase 9.1 design (D4) to a follow-up once real usage data exists.",
      "Auth/billing/Premium/matchmaking/deployment-architecture changes -- untouched, as instructed.",
    ],
    telemetry: {
      generatedAt: new Date().toISOString(),
      durationMs,
      node: process.version,
      machineOnly,
      skipE2E,
    },
  };

  writeFileSync(resolve(REPORT_DIR, "certification-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(REPORT_DIR, "certification-report.md"), renderMarkdown(report));

  for (const g of allGates) {
    const marker = g.status === "PASS" ? "PASS" : g.status;
    console.log(`[${marker}] ${g.id} -- ${g.summary}`);
  }
  console.log(`\nmachineCertification: ${machineCertification}`);
  console.log(`deterministicGolden: ${r1Golden.deterministicGolden} (${r1Golden.deterministicFixtures.existingEquivalent}/28 resolved, ${r1Golden.deterministicFixtures.missing} missing, ${r1Golden.deterministicFixtures.unresolved} unresolved)`);
  console.log(`productE2E: ${productE2E}`);
  console.log(`qualityGolden: ${qualityGolden} (${r1Golden.qualityCases.reviewedCount}/${REQUIRED_QUALITY_COUNT} quality cases reviewed)`);
  console.log(`overallR1: ${overallR1}`);
  console.log(`functionalHash: ${functionalHash}`);
  console.log(`report: docs/r1/generated/certification-report.json`);

  if (overallR1 === "HUMAN_GATE") {
    console.log("\nHUMAN_GATE: MISSING_R1_GOLDEN_HUMAN_REVIEW -- see docs/r1/golden/human-review-guide.md");
  }

  // R1 S7 (final blocker repair, Blocker 2): machineCertification already structurally requires
  // productE2E === "PASS" (see computeMachineCertification) -- --machine-only's exit code follows
  // that single field directly, and ignores ONLY qualityGolden (the 32 human-reviewed cases), per
  // mandate: "MUST FAIL if: deterministic fixture count != 28/28; fixture manifest malformed;
  // fixture reference cannot be resolved; required machine E2E fails; any technical gate fails" --
  // all four are now folded into machineCertification itself.
  if (machineOnly) {
    return machineCertification === "PASS" ? 0 : 1;
  }
  return overallR1 === "PASS" ? 0 : 1;
}

function renderMarkdown(report: {
  commit: string; branch: string; dirty: boolean;
  machineCertification: TopLevelStatus; productE2E: TopLevelStatus; qualityGolden: TopLevelStatus; deterministicGolden: R1GoldenStatus["deterministicGolden"]; overallR1: TopLevelStatus;
  functionalHash: string; gates: GateResult[]; knownGaps: { id: string; detail: string }[];
  r1Golden: { deterministicFixtures: R1GoldenStatus["deterministicFixtures"]; qualityCases: R1GoldenStatus["qualityCases"]; overall: string };
  r1GoldenManifestHash: string | null;
  telemetry: { generatedAt: string; durationMs: number; node: string; machineOnly: boolean; skipE2E: boolean };
}): string {
  const rows = report.gates
    .map((g) => `| ${g.id} | ${g.klass} | ${g.status} | ${g.summary.replace(/\|/g, "/")} |`)
    .join("\n");
  const gaps = report.knownGaps.map((gap) => `- **${gap.id}**: ${gap.detail}`).join("\n");
  return `# R1 S7 Certification Report

Commit: \`${report.commit}\` (branch \`${report.branch}\`, ${report.dirty ? "dirty" : "clean"})
Functional hash: \`${report.functionalHash}\`
R1 Golden manifest hash: \`${report.r1GoldenManifestHash ?? "null"}\`

## Decision

| Dimension | Status |
|---|---|
| machineCertification | **${report.machineCertification}** |
| deterministicGolden | **${report.deterministicGolden}** (${report.r1Golden.deterministicFixtures.existingEquivalent}/28 resolved, ${report.r1Golden.deterministicFixtures.missing} missing, ${report.r1Golden.deterministicFixtures.unresolved} unresolved) |
| productE2E | **${report.productE2E}** |
| qualityGolden | **${report.qualityGolden}** (${report.r1Golden.qualityCases.reviewedCount}/32 human-reviewed) |
| **overallR1** | **${report.overallR1}** |

${report.overallR1 === "HUMAN_GATE" ? "> **HUMAN_GATE: MISSING_R1_GOLDEN_HUMAN_REVIEW** -- every technical/product gate below is green; R1 Golden v1's 32 quality cases still need a real, named, non-LLM reviewer signoff. See `docs/r1/golden/human-review-guide.md`. This is intentionally NOT reported as PASS.\n" : ""}
## Gates

| Gate | Class | Status | Summary |
|---|---|---|---|
${rows}

## Known gaps (not fabricated, not silently hidden)

${gaps}

## Non-functional telemetry (excluded from functionalHash)

Generated at ${report.telemetry.generatedAt}, took ${report.telemetry.durationMs}ms, Node ${report.telemetry.node}, machineOnly=${report.telemetry.machineOnly}, skipE2E=${report.telemetry.skipE2E}.
`;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
export { main };
