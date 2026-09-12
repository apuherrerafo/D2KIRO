import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TASK19_CANDIDATE,
  TASK19_REFERENCE,
  TASK20_ACCEPTED,
  assertCandidateOutputSafe,
  candidateEnvironment,
  candidatePath,
  comparisonEnvironment,
  validateCurrentCandidateArtifact,
} from "./current-engine-candidate";
import { extractEvaluationIdentity, type EvaluationIdentity } from "./evaluation-identity";

const referenceArtifact: unknown = JSON.parse(readFileSync("eval/baselines/reference.s1.json", "utf8"));
const extractedReference = extractEvaluationIdentity(referenceArtifact);
if (!extractedReference.ok) throw new Error(extractedReference.reason);
const REFERENCE_IDENTITY: EvaluationIdentity = extractedReference.identity;

function artifact(commit = "a".repeat(40)) {
  return {
    identity: {
      ...REFERENCE_IDENTITY,
    },
    provenance: { measuredEngineCommit: commit, evaluationHarnessCommit: commit },
  };
}

test("Task19: candidate path is fixed and never aliases reference or accepted outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "d2k-task19-path-"));
  try {
    expect(candidatePath(root)).toBe(join(root, TASK19_CANDIDATE));
    expect(() => assertCandidateOutputSafe(root, join(root, TASK19_REFERENCE))).toThrow("candidate output must be");
    expect(() => assertCandidateOutputSafe(root, join(root, TASK20_ACCEPTED))).toThrow("candidate output must be");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Task19: an existing candidate is immutable evidence and is never overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "d2k-task19-existing-"));
  try {
    mkdirSync(join(root, "eval", "baselines"), { recursive: true });
    writeFileSync(candidatePath(root), "existing");
    expect(() => assertCandidateOutputSafe(root)).toThrow("refuses to overwrite");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Task19: candidate provenance and frozen S1 identity are validated before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "d2k-task19-artifact-"));
  const path = join(root, "candidate.json");
  try {
    writeFileSync(path, JSON.stringify(artifact()));
    expect(() => validateCurrentCandidateArtifact(path, "a".repeat(40), REFERENCE_IDENTITY)).not.toThrow();
    expect(() => validateCurrentCandidateArtifact(path, "b".repeat(40), REFERENCE_IDENTITY)).toThrow("current committed engine");
    writeFileSync(path, JSON.stringify({ ...artifact(), identity: { ...artifact().identity, metaSnapshotVersion: "meta1:" + "0".repeat(64) } }));
    expect(() => validateCurrentCandidateArtifact(path, "a".repeat(40), REFERENCE_IDENTITY)).toThrow("incomparable");
    writeFileSync(path, JSON.stringify({ ...artifact(), identity: { ...artifact().identity, datasetVersion: "split:00000f62;golden:30" } }));
    expect(() => validateCurrentCandidateArtifact(path, "a".repeat(40), REFERENCE_IDENTITY)).toThrow("incomparable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Task19: generation consumes frozen S1 and the gate explicitly compares reference against candidate", () => {
  const root = mkdtempSync(join(tmpdir(), "d2k-task19-env-"));
  try {
    const temporary = join(root, "temporary-candidate.json");
    const generation = candidateEnvironment(root, temporary, "c".repeat(40));
    expect(generation.D2K_META_SNAPSHOT).toBe(join(root, "eval", "snapshots", "S1.sqlite"));
    expect(generation.ENGINE_DB_PATH).toBe(join(root, "eval", "snapshots", "S1.sqlite"));
    expect(generation.D2K_BASELINE_OUT).toBe(temporary);

    const comparison = comparisonEnvironment(root, candidatePath(root));
    expect(comparison.D2K_BASELINE_OUT).toBe(join(root, TASK19_REFERENCE));
    expect(comparison.D2K_GATE_CURRENT).toBe(join(root, TASK19_CANDIDATE));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Task19 REDTEAM: hostile parent environment cannot redirect children or provenance", () => {
  const saved = { ...process.env };
  const hostile = {
    GIT_DIR: "decoy-git", GIT_WORK_TREE: "decoy-worktree", GIT_INDEX_FILE: "decoy-index",
    NODE_OPTIONS: "--require=evil", BUN_INSTALL: "evil", ENGINE_DB_PATH: "evil.sqlite",
    D2K_META_SNAPSHOT: "evil.sqlite", D2K_MEASURED_ENGINE_COMMIT: "decoy-head",
    D2K_TOLERANCE_OUT: "evil-tolerance.json", D2K_BASELINE_OUT: TASK20_ACCEPTED,
    D2K_SPLIT_OUT: TASK19_REFERENCE, D2K_REPORTS_DIR: "evil-reports",
  };
  try {
    Object.assign(process.env, hostile);
    const root = mkdtempSync(join(tmpdir(), "d2k-task19-hostile-"));
    const commit = "c".repeat(40);
    const generation = candidateEnvironment(root, join(root, "temporary.json"), commit);
    const comparison = comparisonEnvironment(root, candidatePath(root));
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "NODE_OPTIONS", "BUN_INSTALL"]) {
      expect(generation[key]).toBeUndefined();
      expect(comparison[key]).toBeUndefined();
    }
    expect(generation.D2K_MEASURED_ENGINE_COMMIT).toBe(commit);
    expect(generation.ENGINE_DB_PATH).toBe(join(root, "eval", "snapshots", "S1.sqlite"));
    expect(generation.D2K_BASELINE_OUT).toBe(join(root, "temporary.json"));
    expect(comparison.D2K_TOLERANCE_OUT).toBe(join(root, "data", "generated", "tolerance.json"));
    expect(comparison.D2K_BASELINE_OUT).toBe(join(root, TASK19_REFERENCE));
    expect(comparison.D2K_GATE_CURRENT).toBe(candidatePath(root));
    expect(comparison.D2K_GATE_CURRENT).not.toBe(join(root, TASK20_ACCEPTED));
    rmSync(root, { recursive: true, force: true });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
