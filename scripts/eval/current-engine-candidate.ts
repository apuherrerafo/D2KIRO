#!/usr/bin/env bun
// R0.2B -- Task 19: measure the committed current engine against the immutable
// rebased S1 control. This is evidence production, never baseline promotion.

import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractEvaluationIdentity, type EvaluationIdentity } from "./evaluation-identity";
import { EXPECTED_S1_IDENTITY, runnerGitEnvironment, safeRuntimeEnvironment, validateFrozenS1 } from "./rebased-reference";

export const TASK19_REFERENCE = "eval/baselines/reference.s1.json";
export const TASK19_CANDIDATE = "eval/baselines/candidate.s1.json";
export const TASK20_ACCEPTED = "eval/baselines/accepted.s1.json";

type Command = (program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => number;

const command: Command = (program, args, cwd, env) => {
  const result = spawnSync(program, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, env: runnerGitEnvironment(), encoding: "utf8" }).trim();
}

/** Task 19 permits no uncommitted engine or harness code to be measured. */
export function requireCleanMeasuredSources(root: string): void {
  const dirty = git(root, ["status", "--porcelain", "--", "apps/engine/src", "scripts/eval"]);
  if (dirty !== "") {
    throw new Error("Task 19 requires clean committed apps/engine/src and scripts/eval; refusing dirty evidence");
  }
}

export function candidatePath(root: string): string {
  return join(resolve(root), TASK19_CANDIDATE);
}

export function assertCandidateOutputSafe(root: string, output = candidatePath(root)): void {
  const resolvedRoot = resolve(root);
  const expected = candidatePath(resolvedRoot);
  if (resolve(output) !== expected) throw new Error("Task 19 candidate output must be eval/baselines/candidate.s1.json");
  if (existsSync(output)) throw new Error(`Task 19 refuses to overwrite an existing candidate: ${output}`);

  for (const protectedPath of [TASK19_REFERENCE, TASK20_ACCEPTED]) {
    if (resolve(output) === join(resolvedRoot, protectedPath)) {
      throw new Error(`Task 19 must not write protected artifact: ${protectedPath}`);
    }
  }
}

function referenceIdentity(root: string): EvaluationIdentity {
  const reference = extractEvaluationIdentity(JSON.parse(readFileSync(join(root, TASK19_REFERENCE), "utf8")));
  if (!reference.ok) throw new Error(`Task 19 reference has no readable EvaluationIdentity: ${reference.reason}`);
  return reference.identity;
}

export function validateCurrentCandidateArtifact(path: string, currentCommit: string, expectedIdentity: EvaluationIdentity): void {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const identity = extractEvaluationIdentity(raw);
  if (!identity.ok) throw new Error(`Task 19 candidate has no readable EvaluationIdentity: ${identity.reason}`);
  if (identity.identity.metaSnapshotVersion !== EXPECTED_S1_IDENTITY ||
      identity.identity.datasetVersion !== expectedIdentity.datasetVersion ||
      identity.identity.evaluationProtocolVersion !== expectedIdentity.evaluationProtocolVersion ||
      identity.identity.scoringModelFamily !== expectedIdentity.scoringModelFamily ||
      identity.identity.metaSnapshotVersion !== expectedIdentity.metaSnapshotVersion) {
    throw new Error("Task 19 candidate is incomparable with the immutable S1 reference");
  }

  const provenance = (raw as { provenance?: Record<string, unknown> }).provenance;
  if (provenance?.measuredEngineCommit !== currentCommit) {
    throw new Error("Task 19 candidate provenance does not identify the current committed engine");
  }
  if (provenance?.evaluationHarnessCommit !== currentCommit) {
    throw new Error("Task 19 candidate provenance does not identify the current evaluation harness");
  }
}

export function candidateEnvironment(root: string, temporaryOutput: string, currentCommit: string): NodeJS.ProcessEnv {
  const resolvedRoot = resolve(root);
  return {
    ...safeRuntimeEnvironment(),
    D2K_META_SNAPSHOT: join(resolvedRoot, "eval/snapshots/S1.sqlite"),
    ENGINE_DB_PATH: join(resolvedRoot, "eval/snapshots/S1.sqlite"),
    D2K_PRO_DB: join(resolvedRoot, "eval/input/pro-drafts.sqlite"),
    D2K_GOLDEN: join(resolvedRoot, "eval/golden/dataset.json"),
    D2K_BASELINE_OUT: temporaryOutput,
    D2K_REPORTS_DIR: mkdtempSync(join(tmpdir(), "d2k-task19-reports-")),
    D2K_SPLIT_OUT: join(resolvedRoot, "eval/baselines/split.json"),
    D2K_MEASURED_ENGINE_COMMIT: currentCommit,
  };
}

export function comparisonEnvironment(root: string, candidate: string): NodeJS.ProcessEnv {
  const resolvedRoot = resolve(root);
  return {
    ...safeRuntimeEnvironment(),
    D2K_BASELINE_OUT: join(resolvedRoot, TASK19_REFERENCE),
    D2K_GATE_CURRENT: candidate,
    D2K_PRO_DB: join(resolvedRoot, "eval/input/pro-drafts.sqlite"),
    D2K_GOLDEN: join(resolvedRoot, "eval/golden/dataset.json"),
    D2K_TOLERANCE_OUT: join(resolvedRoot, "data/generated/tolerance.json"),
  };
}

function stagingCandidatePath(root: string): string {
  return join(resolve(root), "eval/baselines", `.candidate.s1.json.stage-${randomUUID()}`);
}

function publishCandidate(stage: string, finalPath: string, currentCommit: string, expectedIdentity: EvaluationIdentity): void {
  validateCurrentCandidateArtifact(stage, currentCommit, expectedIdentity);
  linkSync(stage, finalPath);
  validateCurrentCandidateArtifact(finalPath, currentCommit, expectedIdentity);
  if (!readFileSync(stage).equals(readFileSync(finalPath))) {
    throw new Error("Task 19 published candidate bytes differ from validated staging bytes");
  }
}

/** Produces only a candidate artifact and its explicit comparison verdict; Task 20 owns promotion. */
export async function main(root = process.cwd(), runner: Command = command): Promise<number> {
  const resolvedRoot = resolve(root);
  let temporaryOutput: string | null = null;
  let reportsDir: string | null = null;
  let stage: string | null = null;

  try {
    requireCleanMeasuredSources(resolvedRoot);
    assertCandidateOutputSafe(resolvedRoot);
    validateFrozenS1(join(resolvedRoot, "eval/snapshots/S1.sqlite"), join(resolvedRoot, "eval/snapshots/S1.manifest.json"));

    const currentCommit = git(resolvedRoot, ["rev-parse", "HEAD"]);
    const expectedIdentity = referenceIdentity(resolvedRoot);
    temporaryOutput = join(mkdtempSync(join(tmpdir(), "d2k-task19-candidate-")), "candidate.s1.json");
    const evalEnv = candidateEnvironment(resolvedRoot, temporaryOutput, currentCommit);
    reportsDir = evalEnv.D2K_REPORTS_DIR!;
    if (runner(process.execPath, ["run", "scripts/eval/run.ts"], resolvedRoot, evalEnv) !== 0) {
      throw new Error("Task 19 candidate generation failed");
    }
    validateCurrentCandidateArtifact(temporaryOutput, currentCommit, expectedIdentity);

    stage = stagingCandidatePath(resolvedRoot);
    copyFileSync(temporaryOutput, stage, constants.COPYFILE_EXCL);
    publishCandidate(stage, candidatePath(resolvedRoot), currentCommit, expectedIdentity);
    unlinkSync(stage);
    stage = null;

    return runner(
      process.execPath,
      ["run", "scripts/eval/gate.ts", "--enforce"],
      resolvedRoot,
      comparisonEnvironment(resolvedRoot, candidatePath(resolvedRoot)),
    );
  } catch (error) {
    process.stderr.write(`Task 19 CURRENT_ENGINE(S1) blocked: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    if (stage !== null && existsSync(stage)) rmSync(stage, { force: true });
    if (temporaryOutput !== null) rmSync(resolve(temporaryOutput, ".."), { recursive: true, force: true });
    if (reportsDir !== null && existsSync(reportsDir)) rmSync(reportsDir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
