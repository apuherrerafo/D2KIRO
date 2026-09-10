#!/usr/bin/env bun
/** Task 35: run the historical V6 engine on frozen S1 through the current harness only. */
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, lstatSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { computeMetaSnapshotVersion, rawFileSha256, validateSnapshotDb } from "./snapshot";

export const HISTORICAL_ENGINE_COMMIT = "df354b9c4ed415b86dba35dc92e2f84e5cb40e5d";
export const STALE_ARTIFACT_WRITER_COMMIT = "e0b77d7";
export const EXPECTED_S1_IDENTITY = "meta1:719c55caf22a9bf06e8e74428c201851ff3749ac61042ca19be44b31a01d293f";
export const EXPECTED_S1_FILE_SHA = "de7520a6af84a6a3eaad191b35ae81dade586914e1f41ccd2bdb838aa87d6478";
export const RETAINED_SHIM = "apps/engine/src/signals/curated-hero-ids.ts";
export const REBASED_OUTPUT = "eval/baselines/reference.s1.json";
const ENGINE_SOURCE = "apps/engine/src";
const SAFE_RUNTIME_ENVIRONMENT_NAMES = new Set([
  "path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp",
  "userprofile", "home", "homedrive", "homepath", "localappdata", "appdata",
]);

type Command = (program: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => string;
const command: Command = (program, args, cwd, env) =>
  execFileSync(program, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * Start child processes from a small OS/runtime allowlist. Environment names are
 * case-insensitive on Windows, so retain at most one spelling of each allowed key.
 */
function safeRuntimeEnvironment(): NodeJS.ProcessEnv {
  const safe = new Map<string, [string, string]>();
  for (const [name, value] of Object.entries(process.env)) {
    const normalized = name.toLowerCase();
    if (value !== undefined && SAFE_RUNTIME_ENVIRONMENT_NAMES.has(normalized)) safe.set(normalized, [name, value]);
  }
  return Object.fromEntries(safe.values());
}

/** Git must never inherit caller controls such as GIT_DIR or NODE_OPTIONS. */
export function runnerGitEnvironment(): NodeJS.ProcessEnv {
  return safeRuntimeEnvironment();
}

function git(root: string, args: string[], runner: Command = command): string {
  return runner("git", args, root, runnerGitEnvironment());
}

function files(root: string, directory: string): string[] {
  const base = join(root, directory);
  const visit = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const next = join(path, entry.name);
    return entry.isDirectory() ? visit(next) : [relative(root, next).replace(/\\/g, "/")];
  });
  return existsSync(base) ? visit(base).sort() : [];
}

function treeFiles(root: string, revision: string, runner: Command): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", revision, ENGINE_SOURCE], runner).split(/\r?\n/).filter(Boolean).sort();
}

export function assertSafeDisposableWorktree(mainRoot: string, candidate: string): void {
  const main = resolve(mainRoot);
  const temp = resolve(candidate);
  if (temp === main || temp.startsWith(`${main}${sep}`)) {
    throw new Error("disposable worktree must be outside the primary worktree");
  }
}

export function requireCleanCommittedTree(root: string, runner: Command = command): void {
  if (git(root, ["status", "--porcelain"], runner) !== "") {
    throw new Error("Task 35 requires a clean committed primary worktree; refusing to create evidence from uncommitted code");
  }
}

export function validateFrozenS1(snapshotPath: string, manifestPath: string): void {
  if (!existsSync(snapshotPath)) throw new Error(`S1 missing: ${snapshotPath}`);
  if (!existsSync(manifestPath)) throw new Error(`S1 manifest missing: ${manifestPath}`);
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>; }
  catch { throw new Error("S1 manifest is not valid JSON"); }
  if (manifest.metaSnapshotVersion !== EXPECTED_S1_IDENTITY) throw new Error("S1 manifest identity differs from the accepted frozen S1 identity");
  if (manifest.snapshotFileSha !== EXPECTED_S1_FILE_SHA || rawFileSha256(snapshotPath) !== EXPECTED_S1_FILE_SHA) {
    throw new Error("S1 snapshotFileSha differs from the frozen SQLite bytes");
  }
  const db = new Database(snapshotPath, { readonly: true });
  try {
    const validation = validateSnapshotDb(db);
    if (!validation.ok) throw new Error(`S1 validator failed: ${validation.failures.join("; ")}`);
    if (computeMetaSnapshotVersion(snapshotPath) !== EXPECTED_S1_IDENTITY) throw new Error("S1 logical identity differs from the accepted frozen S1 identity");
  } finally { db.close(); }
}

/** Overlay exactly historical engine source plus the single authorised current-only data shim. */
export function overlayHistoricalEngine(root: string, worktree: string, runner: Command = command): void {
  assertSafeDisposableWorktree(root, worktree);
  const historical = treeFiles(root, HISTORICAL_ENGINE_COMMIT, runner);
  const current = treeFiles(root, "HEAD", runner);
  if (historical.includes(RETAINED_SHIM) || !current.includes(RETAINED_SHIM)) {
    throw new Error(`compatibility shim contract invalid for ${RETAINED_SHIM}`);
  }
  const shimPath = join(worktree, RETAINED_SHIM);
  const shim = readFileSync(shimPath);
  const source = join(worktree, ENGINE_SOURCE);
  rmSync(source, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
  git(worktree, ["checkout", HISTORICAL_ENGINE_COMMIT, "--", ENGINE_SOURCE], runner);
  mkdirSync(dirname(shimPath), { recursive: true });
  writeFileSync(shimPath, shim);
  const actual = files(worktree, ENGINE_SOURCE);
  const expected = [...historical, RETAINED_SHIM].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("historical overlay retained or omitted an unauthorized engine source file");
}

function stable(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function validateRebasedArtifact(path: string, harnessCommit: string): void {
  const artifact = JSON.parse(readFileSync(path, "utf8")) as { identity?: Record<string, unknown>; provenance?: Record<string, unknown>; classification?: unknown };
  if (artifact.identity?.metaSnapshotVersion !== EXPECTED_S1_IDENTITY) throw new Error("eval artifact is incomparable: S1 identity mismatch");
  if (artifact.provenance?.measuredEngineCommit !== HISTORICAL_ENGINE_COMMIT) throw new Error("eval artifact has incorrect historical engine provenance");
  if (artifact.provenance?.evaluationHarnessCommit !== harnessCommit) throw new Error("eval artifact has incorrect current-harness provenance");
  if (artifact.classification !== "REBASED_CONTROL") throw new Error("eval artifact is not classified as REBASED_CONTROL");
}

export function classifyRebasedArtifact(path: string, harnessCommit: string): void {
  const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, stable({ ...artifact, classification: "REBASED_CONTROL" }));
  validateRebasedArtifact(path, harnessCommit);
}

export function evaluationEnvironment(worktree: string): NodeJS.ProcessEnv {
  const safeRuntime = safeRuntimeEnvironment();
  return {
    ...safeRuntime,
    D2K_META_SNAPSHOT: join(worktree, "eval/snapshots/S1.sqlite"),
    ENGINE_DB_PATH: join(worktree, "eval/snapshots/S1.sqlite"),
    D2K_PRO_DB: join(worktree, "eval/input/pro-drafts.sqlite"),
    D2K_GOLDEN: join(worktree, "eval/golden/dataset.json"),
    D2K_BASELINE_OUT: join(worktree, "eval/baselines/.reference.s1.generated.json"),
    D2K_REPORTS_DIR: join(worktree, "eval/reports"),
    D2K_SPLIT_OUT: join(worktree, "eval/baselines/.reference.s1.split.json"),
    D2K_MEASURED_ENGINE_COMMIT: HISTORICAL_ENGINE_COMMIT,
  };
}

export function assertReferenceAbsent(finalPath: string): void {
  if (existsSync(finalPath)) throw new Error(`Task 35 refuses to overwrite an existing primary reference: ${finalPath}`);
}

export function stagingReferencePath(mainRoot: string): string {
  return join(mainRoot, "eval/baselines", `.reference.s1.json.stage-${randomUUID()}`);
}

export function stageReferenceArtifact(source: string, stagePath: string): void {
  copyFileSync(source, stagePath, constants.COPYFILE_EXCL);
}

export function publishStagedReference(stagePath: string, finalPath: string, harnessCommit: string): void {
  validateRebasedArtifact(stagePath, harnessCommit);
  linkSync(stagePath, finalPath);
  validateRebasedArtifact(finalPath, harnessCommit);
  if (!readFileSync(finalPath).equals(readFileSync(stagePath))) throw new Error("published reference bytes differ from validated staging bytes");
}

export function removeStagingArtifact(stagePath: string): void {
  unlinkSync(stagePath);
}

function linkCurrentDependencies(root: string, worktree: string): void {
  const source = join(root, "apps/engine/node_modules");
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw new Error("current dependency installation is unavailable; refusing to install or mutate dependencies");
  symlinkSync(source, join(worktree, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}

export function removeDisposableWorktree(root: string, worktree: string, runner: Command = command): void {
  assertSafeDisposableWorktree(root, worktree);
  try { git(root, ["worktree", "remove", "--force", worktree], runner); }
  catch { rmSync(worktree, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 }); }
}

export function preservePrimaryFailure(primaryError: unknown, cleanupError: unknown): Error {
  const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
  const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  return new Error(`${primary}; cleanup also failed: ${cleanup}`);
}
/** Evidence-producing mode. It is intentionally blocked until this runner is committed and the tree is clean. */
export async function main(root = process.cwd()): Promise<number> {
  const mainRoot = resolve(root);
  const snapshot = join(mainRoot, "eval/snapshots/S1.sqlite");
  const manifest = join(mainRoot, "eval/snapshots/S1.manifest.json");
  let primaryError: unknown;
  let worktree: string | null = null;
  let stage: string | null = null;
  try {
    requireCleanCommittedTree(mainRoot);
    const finalPath = join(mainRoot, REBASED_OUTPUT);
    assertReferenceAbsent(finalPath);
    validateFrozenS1(snapshot, manifest);
    const harnessCommit = git(mainRoot, ["rev-parse", "HEAD"]);
    worktree = mkdtempSync(join(tmpdir(), "d2k-rebased-control-"));
    assertSafeDisposableWorktree(mainRoot, worktree);
    rmSync(worktree, { recursive: true, force: true });
    git(mainRoot, ["worktree", "add", "--detach", worktree, harnessCommit]);
    const currentHarness = readFileSync(join(mainRoot, "scripts/eval/run.ts"));
    if (!readFileSync(join(worktree, "scripts/eval/run.ts")).equals(currentHarness)) throw new Error("temporary worktree did not start from the current harness commit");
    linkCurrentDependencies(mainRoot, worktree);
    overlayHistoricalEngine(mainRoot, worktree);
    if (!readFileSync(join(worktree, "scripts/eval/run.ts")).equals(currentHarness)) throw new Error("historical overlay modified the current evaluation harness");
    const temporaryOutput = evaluationEnvironment(worktree).D2K_BASELINE_OUT!;
    command(process.execPath, ["run", "scripts/eval/run.ts"], worktree, evaluationEnvironment(worktree));
    classifyRebasedArtifact(temporaryOutput, harnessCommit);
    stage = stagingReferencePath(mainRoot);
    stageReferenceArtifact(temporaryOutput, stage);
    publishStagedReference(stage, finalPath, harnessCommit);
  } catch (error) { primaryError = error; }
  finally {
    if (stage !== null) {
      try { removeStagingArtifact(stage); }
      catch (cleanupError) {
        const cleanupNote = `staging cleanup failed for ${stage}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        primaryError = primaryError === undefined ? new Error(cleanupNote) : preservePrimaryFailure(primaryError, new Error(cleanupNote));
      }
    }
    if (worktree !== null) {
      try { removeDisposableWorktree(mainRoot, worktree); }
      catch (cleanupError) {
        const cleanupNote = `cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        primaryError = primaryError === undefined ? new Error(cleanupNote) : preservePrimaryFailure(primaryError, cleanupError);
      }
    }
  }
  if (primaryError !== undefined) {
    process.stderr.write(`Task 35 REBASED_CONTROL blocked: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}\n`);
    return 2;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());