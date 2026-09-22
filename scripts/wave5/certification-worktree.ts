#!/usr/bin/env bun
// Certification remediation (Phase A, A3) -- produce certification evidence from ONLY the intended Wave 5 state.
//
//   bun scripts/wave5/certification-worktree.ts --dir=<new dir outside the repo> [--dry-run]
//   bun scripts/wave5/certification-worktree.ts --remove=<that dir>     (unlinks the node_modules junctions FIRST, then removes the worktree)
//
// The working tree mixes Wave 5 remediation (+ this Phase A work) with unrelated Wave 1/2 diagnostics. Nothing is deleted, stashed, reset
// or committed: this creates a DETACHED git worktree at HEAD (a second checkout sharing the object store; no branch, no push) and copies
// into it only the dirty files the classifier below puts in the certified set. Every dirty path must be classified (included, or excluded
// WITH a reason) -- an unclassified path aborts, so nothing slips into the certified state unseen. Evidence is then generated inside that
// directory, where `evidence-identity.ts` reports `isolation: linked-worktree` and a `dirtyDiffHash` over exactly the certified delta.
// Remove afterwards with `--remove` (a plain `git worktree remove` leaves the junction stubs behind). The main working tree is untouched
// throughout. Zero network.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmdirSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

export interface Classified { path: string; decision: "include" | "exclude"; reason: string }

interface Rule { test: (path: string) => boolean; decision: "include" | "exclude"; reason: string }
const starts = (...prefixes: string[]) => (path: string) => prefixes.some((prefix) => path.startsWith(prefix));
const is = (...paths: string[]) => (path: string) => paths.includes(path);

// Order matters: the first matching rule wins, exclusions before the broad inclusions.
export const RULES: Rule[] = [
  { test: (path) => /^docs\/diagnostics\/WAVE[12]_/.test(path), decision: "exclude", reason: "Wave 1/2 diagnostic output, not part of the Wave 5 state" },
  { test: (path) => /^docs\/diagnostics\/ap-solo-mid-/.test(path), decision: "exclude", reason: "AP Solo-Mid recovery-product judge output (predates Wave 5; explicitly not reused)" },
  { test: is("e2e/wave2-acceptance.spec.ts", "scripts/wave2-repro.ts"), decision: "exclude", reason: "Wave 2 diagnostic tooling" },
  { test: is("playwright.config.ts"), decision: "exclude", reason: "only change is the E2E_ENGINE_LOG knob for scripts/wave2-repro.ts (Wave 2 diagnostics)" },
  { test: starts("docs/agents/"), decision: "exclude", reason: "project memory (journal / progress); documents the work, is not part of the system under test" },
  { test: starts("docs/diagnostics/WAVE5_"), decision: "include", reason: "Wave 5 evidence output (copied so --pin-from and the no-overwrite guard see it; excluded from the state hash)" },
  { test: starts("apps/"), decision: "include", reason: "Wave 5 remediation (coach, positional credibility, perspective safety, proxy allowlist, Coach panel)" },
  { test: (path) => /^scripts\/wave5([/-]|\.)/.test(path) || starts("scripts/positions/")(path), decision: "include", reason: "Wave 5 evidence tooling / Phase A positional pipeline" },
  { test: (path) => /^scripts\/eval\/(empirical-provenance|freeze-empirical-snapshot)/.test(path), decision: "include", reason: "Phase A empirical snapshot provenance" },
  { test: starts("eval/snapshots/W5-EMP-"), decision: "include", reason: "frozen empirical snapshot + provenance (Phase A)" },
  { test: is("data/metadata/hero-positions.json"), decision: "include", reason: "positional dataset provenance twin (Phase A)" },
  { test: is("e2e/wave5-certification.spec.ts", "docs/QA_CALIBRATION.md"), decision: "include", reason: "Wave 5 certification journey / QA record" },
  { test: is("package.json"), decision: "include", reason: "only Wave 5 scripts were added" },
  { test: is(".gitignore"), decision: "include", reason: "exception that lets the frozen snapshot be versioned (Phase A)" },
];

export function classifyDirtyPaths(paths: readonly string[]): { classified: Classified[]; unclassified: string[] } {
  const classified: Classified[] = [];
  const unclassified: string[] = [];
  for (const path of paths) {
    const rule = RULES.find((candidate) => candidate.test(path));
    if (rule) classified.push({ path, decision: rule.decision, reason: rule.reason });
    else unclassified.push(path);
  }
  return { classified, unclassified };
}

const git = (args: string[], cwd = ROOT): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function dirtyPaths(): { path: string; deleted: boolean }[] {
  return git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter((entry) => entry.length > 3).map((entry) => ({ path: entry.slice(3), deleted: entry.slice(0, 2).includes("D") }));
}

const MODULE_LINKS = ["node_modules", "apps/engine/node_modules", "apps/web/node_modules"];

/** Unlinks the shared node_modules junctions (never recursing into their target), then removes the worktree. */
function remove(dirArg: string): void {
  const dir = resolve(dirArg);
  if (dir.startsWith(ROOT)) throw new Error("refusing to remove anything inside the repository");
  for (const modules of MODULE_LINKS) {
    const link = join(dir, modules);
    if (existsSync(link) && lstatSync(link).isSymbolicLink()) rmdirSync(link);
  }
  git(["worktree", "remove", "--force", dir]);
  console.log(`removed ${dir}`);
}

function main(): void {
  const removeArg = process.argv.find((arg) => arg.startsWith("--remove="))?.slice("--remove=".length);
  if (removeArg) return remove(removeArg);
  const dirArg = process.argv.find((arg) => arg.startsWith("--dir="))?.slice("--dir=".length);
  if (!dirArg) throw new Error("usage: --dir=<new directory outside the repo> [--dry-run]");
  const dir = resolve(dirArg);
  if (dir.startsWith(ROOT)) throw new Error("--dir must be outside the repository");
  if (existsSync(dir)) throw new Error(`${dir} already exists -- refusing to reuse it`);

  const dirty = dirtyPaths();
  const { classified, unclassified } = classifyDirtyPaths(dirty.map((entry) => entry.path));
  if (unclassified.length > 0) throw new Error(`unclassified dirty path(s) -- decide include/exclude in RULES first:\n- ${unclassified.join("\n- ")}`);
  const included = classified.filter((entry) => entry.decision === "include");
  const excluded = classified.filter((entry) => entry.decision === "exclude");
  console.log(JSON.stringify({ included: included.length, excluded: excluded.map((entry) => ({ path: entry.path, reason: entry.reason })) }, null, 2));
  if (process.argv.includes("--dry-run")) return;

  git(["worktree", "add", "--detach", dir, "HEAD"]);
  const deleted = new Set(dirty.filter((entry) => entry.deleted).map((entry) => entry.path));
  for (const entry of included) {
    if (deleted.has(entry.path)) throw new Error(`${entry.path} is deleted in the working tree -- handle deletions explicitly`);
    const target = join(dir, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(ROOT, entry.path), target);
  }
  // Dependencies are shared, not reinstalled (no network): junctions to the main tree's node_modules.
  for (const modules of MODULE_LINKS) {
    if (existsSync(join(ROOT, modules)) && !existsSync(join(dir, modules))) symlinkSync(join(ROOT, modules), join(dir, modules), "junction");
  }
  console.log(`\ncertification worktree ready: ${dir}\n  HEAD ${git(["rev-parse", "HEAD"], dir).trim()} + ${included.length} file(s) from the working tree\n  remove with: bun scripts/wave5/certification-worktree.ts --remove="${dir}"  (the main working tree is untouched)`);
}

if (import.meta.main) main();
