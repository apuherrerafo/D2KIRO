import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReferenceAbsent,
  assertSafeDisposableWorktree,
  classifyRebasedArtifact,
  evaluationEnvironment,
  EXPECTED_S1_FILE_SHA,
  EXPECTED_S1_IDENTITY,
  HISTORICAL_ENGINE_COMMIT,
  preservePrimaryFailure,
  removeDisposableWorktree,
  requireCleanCommittedTree,
  runnerGitEnvironment,
  overlayHistoricalEngine,
  REBASED_OUTPUT,
  publishStagedReference,
  removeStagingArtifact,
  stageReferenceArtifact,
  stagingReferencePath,
  RETAINED_SHIM,
  STALE_ARTIFACT_WRITER_COMMIT,
  validateFrozenS1,
  validateRebasedArtifact,
} from "./rebased-reference";

const dirs: string[] = [];
function temp(name: string): string { const path = mkdtempSync(join(tmpdir(), name)); dirs.push(path); return path; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function overlayFixture(extraAfterCheckout = false): { root: string; worktree: string; calls: string[][]; environments: NodeJS.ProcessEnv[]; run: () => void } {
  const root = temp("d2k-rebased-primary-");
  const worktree = temp("d2k-rebased-temp-");
  mkdirSync(join(worktree, "apps/engine/src/signals"), { recursive: true });
  mkdirSync(join(worktree, "scripts/eval"), { recursive: true });
  writeFileSync(join(worktree, RETAINED_SHIM), "export const CURATED_HERO_IDS = new Set([1]);\n");
  writeFileSync(join(worktree, "apps/engine/src/signals/current-only.ts"), "export const current = true;\n");
  writeFileSync(join(worktree, "scripts/eval/run.ts"), "// CURRENT HARNESS\n");
  const calls: string[][] = [];
  const environments: NodeJS.ProcessEnv[] = [];
  const runner = (_program: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string => {
    environments.push(env!);
    calls.push(args);
    if (args[0] === "ls-tree") return args[3] === HISTORICAL_ENGINE_COMMIT
      ? "apps/engine/src/signals/old.ts"
      : `apps/engine/src/signals/current-only.ts\n${RETAINED_SHIM}\napps/engine/src/signals/old.ts`;
    if (args[0] === "checkout") {
      mkdirSync(join(cwd, "apps/engine/src/signals"), { recursive: true });
      writeFileSync(join(cwd, "apps/engine/src/signals/old.ts"), "export const old = true;\n");
      if (extraAfterCheckout) writeFileSync(join(cwd, "apps/engine/src/signals/unapproved.ts"), "export const nope = true;\n");
      return "";
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  return { root, worktree, calls, environments, run: () => overlayHistoricalEngine(root, worktree, runner) };
}

test("historical provenance is df354b9 and never the stale e0b77d7 artifact-writer value", () => {
  expect(HISTORICAL_ENGINE_COMMIT).toBe("df354b9c4ed415b86dba35dc92e2f84e5cb40e5d");
  expect(HISTORICAL_ENGINE_COMMIT).not.toBe(STALE_ARTIFACT_WRITER_COMMIT);
  expect(HISTORICAL_ENGINE_COMMIT).not.toContain("e0b77d7");
});

test("overlay starts from HEAD source listing, changes only engine source, and preserves current harness", () => {
  const f = overlayFixture();
  const before = readFileSync(join(f.worktree, "scripts/eval/run.ts"), "utf8");
  f.run();
  expect(f.calls).toContainEqual(["ls-tree", "-r", "--name-only", "HEAD", "apps/engine/src"]);
  expect(f.calls).toContainEqual(["checkout", HISTORICAL_ENGINE_COMMIT, "--", "apps/engine/src"]);
  expect(f.calls.flat().join(" ")).not.toContain("scripts/eval");
  expect(readFileSync(join(f.worktree, "scripts/eval/run.ts"), "utf8")).toBe(before);
  expect(existsSync(join(f.worktree, "apps/engine/src/signals/old.ts"))).toBe(true);
  expect(existsSync(join(f.worktree, RETAINED_SHIM))).toBe(true);
  expect(existsSync(join(f.worktree, "apps/engine/src/signals/current-only.ts"))).toBe(false);
  expect(existsSync(join(f.root, "apps/engine/src/signals/old.ts"))).toBe(false);
});

test("an unexpected second retained current-only engine file fails closed", () => {
  const f = overlayFixture(true);
  expect(f.run).toThrow("unauthorized engine source file");
});

test("disposable worktree cannot resolve to or below the primary worktree", () => {
  const root = temp("d2k-primary-");
  expect(() => assertSafeDisposableWorktree(root, root)).toThrow("outside the primary");
  expect(() => assertSafeDisposableWorktree(root, join(root, "nested"))).toThrow("outside the primary");
  expect(() => assertSafeDisposableWorktree(root, temp("d2k-disposable-"))).not.toThrow();
});

test("S1 preflight fails closed for missing SQLite, missing manifest, wrong identity, and wrong SHA", () => {
  const root = temp("d2k-s1-"); const sqlite = join(root, "S1.sqlite"); const manifest = join(root, "S1.manifest.json");
  expect(() => validateFrozenS1(sqlite, manifest)).toThrow("S1 missing");
  const db = new Database(sqlite); db.close();
  expect(() => validateFrozenS1(sqlite, manifest)).toThrow("manifest missing");
  writeFileSync(manifest, JSON.stringify({ metaSnapshotVersion: "meta1:bad", snapshotFileSha: EXPECTED_S1_FILE_SHA }));
  expect(() => validateFrozenS1(sqlite, manifest)).toThrow("identity differs");
  writeFileSync(manifest, JSON.stringify({ metaSnapshotVersion: EXPECTED_S1_IDENTITY, snapshotFileSha: "bad" }));
  expect(() => validateFrozenS1(sqlite, manifest)).toThrow("snapshotFileSha differs");
});

test("the committed frozen S1 passes the read-only preflight", () => {
  validateFrozenS1("eval/snapshots/S1.sqlite", "eval/snapshots/S1.manifest.json");
});

test("artifact classification requires exact provenance and emits REBASED_CONTROL only", () => {
  const path = join(temp("d2k-artifact-"), "reference.s1.json");
  const harness = "a".repeat(40);
  writeFileSync(path, JSON.stringify({ identity: { metaSnapshotVersion: EXPECTED_S1_IDENTITY }, provenance: { measuredEngineCommit: HISTORICAL_ENGINE_COMMIT, evaluationHarnessCommit: harness } }));
  classifyRebasedArtifact(path, harness);
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  expect(artifact.classification).toBe("REBASED_CONTROL");
  expect(artifact.classification).not.toBe("ACCEPTED");
  expect(artifact.classification).not.toBe("CANDIDATE");
  writeFileSync(path, JSON.stringify({ identity: { metaSnapshotVersion: EXPECTED_S1_IDENTITY }, provenance: { measuredEngineCommit: STALE_ARTIFACT_WRITER_COMMIT, evaluationHarnessCommit: harness } }));
  expect(() => classifyRebasedArtifact(path, harness)).toThrow("historical engine provenance");
});

test("runner environment writes only the temporary reference path, retains current harness provenance, and leaves Benchmark B default", () => {
  const worktree = temp("d2k-env-");
  const env = evaluationEnvironment(worktree);
  expect(env.D2K_BASELINE_OUT).toBe(join(worktree, "eval/baselines/.reference.s1.generated.json"));
  expect(env.D2K_BASELINE_OUT).not.toContain("accepted.s1.json");
  expect(env.D2K_BASELINE_OUT).not.toContain("candidate.s1.json");
  expect(env.D2K_MEASURED_ENGINE_COMMIT).toBe(HISTORICAL_ENGINE_COMMIT);
  expect(env.D2K_META_SNAPSHOT).toBe(join(worktree, "eval/snapshots/S1.sqlite"));
  expect(env.D2K_PRO_DB).toBe(join(worktree, "eval/input/pro-drafts.sqlite"));
  expect(env.ENGINE_DB_PATH).toBe(join(worktree, "eval/snapshots/S1.sqlite"));
  expect(env.D2K_SPLIT_OUT).toBe(join(worktree, "eval/baselines/.reference.s1.split.json"));
});

test("dirty primary tree refuses evidence-producing execution before a worktree can be created", () => {
  expect(() => requireCleanCommittedTree("fixture", (_program, args) => {
    expect(args).toEqual(["status", "--porcelain"]);
    return " M scripts/eval/run.ts";
  })).toThrow("clean committed primary worktree");
  expect(existsSync(REBASED_OUTPUT)).toBe(false);
});

test("cleanup removes only the disposable worktree and preserves the primary failure if cleanup also fails", () => {
  const root = temp("d2k-cleanup-primary-"); const disposable = temp("d2k-cleanup-temp-");
  const calls: string[][] = [];
  removeDisposableWorktree(root, disposable, (_program, args) => { calls.push(args); rmSync(disposable, { recursive: true, force: true }); return ""; });
  expect(calls).toEqual([["worktree", "remove", "--force", disposable]]);
  expect(existsSync(disposable)).toBe(false);
  expect(preservePrimaryFailure(new Error("engine import failed"), new Error("EBUSY")).message).toBe("engine import failed; cleanup also failed: EBUSY");
});
test("dependency adapter reuses the current engine installation; it does not install dependencies", () => {
  expect(readFileSync("scripts/eval/rebased-reference.ts", "utf8")).toContain('join(root, "apps/engine/node_modules")');
  expect(readFileSync("scripts/eval/rebased-reference.ts", "utf8")).not.toContain("bun install");
});
test("Task 35 does not repoint default enforcement", () => {
  expect(readFileSync("scripts/eval/gate.ts", "utf8")).not.toContain("reference.s1.json");
});
function validArtifact(path: string, harness = "a".repeat(40)): void {
  writeFileSync(path, JSON.stringify({
    classification: "REBASED_CONTROL",
    identity: { metaSnapshotVersion: EXPECTED_S1_IDENTITY },
    provenance: { measuredEngineCommit: HISTORICAL_ENGINE_COMMIT, evaluationHarnessCommit: harness },
  }));
}

test("primary reference pre-existence fails closed and preserves its bytes", () => {
  const root = temp("d2k-primary-reference-"); const finalPath = join(root, REBASED_OUTPUT);
  mkdirSync(join(root, "eval/baselines"), { recursive: true }); writeFileSync(finalPath, "do-not-clobber");
  expect(() => assertReferenceAbsent(finalPath)).toThrow("refuses to overwrite");
  expect(readFileSync(finalPath, "utf8")).toBe("do-not-clobber");
});

test("stage then hard-link publication is valid, complete, and removes only its stage", () => {
  const root = temp("d2k-publish-"); const source = join(root, "generated.json"); const finalPath = join(root, REBASED_OUTPUT);
  mkdirSync(join(root, "eval/baselines"), { recursive: true }); validArtifact(source);
  const stage = stagingReferencePath(root); stageReferenceArtifact(source, stage);
  publishStagedReference(stage, finalPath, "a".repeat(40)); validateRebasedArtifact(finalPath, "a".repeat(40));
  expect(readFileSync(finalPath)).toEqual(readFileSync(stage)); removeStagingArtifact(stage);
  expect(existsSync(stage)).toBe(false); expect(existsSync(finalPath)).toBe(true);
});

test("final-path race and invalid staging fail without clobbering or publishing", () => {
  const root = temp("d2k-publish-race-"); const source = join(root, "generated.json"); const finalPath = join(root, REBASED_OUTPUT);
  mkdirSync(join(root, "eval/baselines"), { recursive: true }); validArtifact(source);
  const stage = stagingReferencePath(root); stageReferenceArtifact(source, stage); writeFileSync(finalPath, "concurrent-reference");
  expect(() => publishStagedReference(stage, finalPath, "a".repeat(40))).toThrow();
  expect(readFileSync(finalPath, "utf8")).toBe("concurrent-reference"); removeStagingArtifact(stage);
  const malformed = stagingReferencePath(root); writeFileSync(malformed, "not-json"); rmSync(finalPath);
  expect(() => publishStagedReference(malformed, finalPath, "a".repeat(40))).toThrow(); expect(existsSync(finalPath)).toBe(false);
  removeStagingArtifact(malformed);
});

test("poisoned parent controls do not survive the sanitized evaluation environment", () => {
  const previous = { split: process.env.D2K_SPLIT_OUT, fake: process.env.D2K_FAKE_CONTROL, db: process.env.ENGINE_DB_PATH };
  process.env.D2K_SPLIT_OUT = "eval/baselines/accepted.s1.json"; process.env.D2K_FAKE_CONTROL = "evil"; process.env.ENGINE_DB_PATH = "mutable.sqlite";
  const env = evaluationEnvironment(temp("d2k-hostile-env-"));
  for (const [key, value] of [["D2K_SPLIT_OUT", previous.split], ["D2K_FAKE_CONTROL", previous.fake], ["ENGINE_DB_PATH", previous.db]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  expect(env.D2K_FAKE_CONTROL).toBeUndefined(); expect(env.D2K_SPLIT_OUT).not.toContain("accepted.s1.json");
  expect(env.ENGINE_DB_PATH).toContain("eval\\snapshots\\S1.sqlite"); expect(env.D2K_MEASURED_ENGINE_COMMIT).toBe(HISTORICAL_ENGINE_COMMIT);
});
test("every runner Git command receives an allowlisted environment despite hostile mixed-case controls", () => {
  const poisoned: Record<string, string | undefined> = {
    GIT_DIR: process.env.GIT_DIR, git_work_tree: process.env.git_work_tree, Git_Index_File: process.env.Git_Index_File,
    GIT_OBJECT_DIRECTORY: process.env.GIT_OBJECT_DIRECTORY, gIt_CoMmOn_DiR: process.env.gIt_CoMmOn_DiR,
    GIT_FAKE_CONTROL: process.env.GIT_FAKE_CONTROL, NODE_OPTIONS: process.env.NODE_OPTIONS, BUN_FAKE_CONTROL: process.env.BUN_FAKE_CONTROL,
  };
  process.env.GIT_DIR = "other-repository"; process.env.git_work_tree = "other-worktree"; process.env.Git_Index_File = "other-index";
  process.env.GIT_OBJECT_DIRECTORY = "other-objects"; process.env.gIt_CoMmOn_DiR = "other-common";
  process.env.GIT_FAKE_CONTROL = "evil"; process.env.NODE_OPTIONS = "--require evil"; process.env.BUN_FAKE_CONTROL = "evil";
  try {
    const f = overlayFixture(); f.run();
    const gitEnvironments: NodeJS.ProcessEnv[] = [...f.environments];
    requireCleanCommittedTree("trusted-primary", (_program, _args, cwd, env) => {
      expect(cwd).toBe("trusted-primary"); gitEnvironments.push(env!); return "";
    });
    removeDisposableWorktree("trusted-primary", temp("d2k-git-cleanup-"), (_program, _args, cwd, env) => {
      expect(cwd).toBe("trusted-primary"); gitEnvironments.push(env!); return "";
    });
    expect(gitEnvironments).toHaveLength(5);
    for (const env of [...gitEnvironments, runnerGitEnvironment()]) {
      for (const name of Object.keys(env)) {
        expect(name.toLowerCase()).not.toStartWith("git_");
        expect(name.toLowerCase()).not.toBe("node_options");
        expect(name.toLowerCase()).not.toStartWith("bun_");
      }
    }
  } finally {
    for (const [key, value] of Object.entries(poisoned)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});