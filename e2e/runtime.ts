import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bootstrapE2eDatabase } from "./bootstrap-db";
import { buildFixtureCmEligibilitySnapshot } from "./fixtures/cm-eligibility";
import { FIXTURE_HERO_IDS } from "./fixtures/hero-catalog";

export interface E2eRuntime {
  dir: string;
  dbPath: string;
  eligibilityPath: string;
  sessionPath: string;
}

/**
 * Every local browser invocation owns a directory outside the checkout.  A stopped or killed
 * previous run can therefore leave diagnostics behind without blocking the next invocation on
 * Windows, where SQLite's WAL files are often still held briefly by the just-exited process.
 */
export function runtimeForCurrentProcess(): E2eRuntime {
  const dir = process.env.E2E_RUNTIME_DIR
    ? resolve(process.env.E2E_RUNTIME_DIR)
    : mkdtempSync(join(tmpdir(), "d2kiro-playwright-"));
  process.env.E2E_RUNTIME_DIR = dir;
  return {
    dir,
    dbPath: join(dir, "e2e.sqlite"),
    eligibilityPath: join(dir, "cm-hero-eligibility.json"),
    sessionPath: join(dir, "session.json"),
  };
}

/** Prepare a fresh runtime once in the Playwright parent, never in a worker. */
export function prepareLocalRuntime(runtime: E2eRuntime): void {
  mkdirSync(runtime.dir, { recursive: true });
  if (existsSync(runtime.dbPath)) return;
  bootstrapE2eDatabase(runtime.dbPath);
  writeFileSync(runtime.eligibilityPath, JSON.stringify(buildFixtureCmEligibilitySnapshot(FIXTURE_HERO_IDS)));
}
