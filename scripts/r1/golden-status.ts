// R1 S7 completion wave (Blocker 3) -- deterministic schema validation + status computation for
// R1 Golden v1 (H0.5: 28 deterministic protocol fixtures + 32 human-reviewed Dota quality cases,
// total 60). Mirrors the loader discipline this repo already uses for curated data
// (invariantes.md, "los datos curados se validan en el borde al cargarlos"): a malformed artifact
// degrades to an honest "unknown"/gate-closed status, never throws, never invents a passing count.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const GOLDEN_DIR = resolve(ROOT, "docs", "r1", "golden");
const FIXTURES_PATH = resolve(GOLDEN_DIR, "deterministic-fixtures-manifest.json");
const QUALITY_PATH = resolve(GOLDEN_DIR, "quality-cases-template.json");

export const REQUIRED_FIXTURE_COUNT = 28;
export const REQUIRED_QUALITY_COUNT = 32;

export interface ReviewerSignoff {
  reviewerName: string;
  reviewerContact: string;
  reviewedAt: string;
  reviewMethod: string;
  sourceStateHash: string;
  signatureNote: string;
}

export interface DeterministicFixturesStatus {
  found: boolean;
  totalSlots: number;
  existingEquivalent: number;
  missing: number;
  /**
   * R1 S7 (final blocker repair, Blocker 2) -- entries claiming `status: "existing_equivalent"`
   * whose `equivalentTest.file`/`.name` reference cannot actually be resolved against the repo on
   * disk (file doesn't exist, or the file's content no longer contains that exact test name --
   * e.g. a rename/delete drifted the manifest out of sync with the real test suite). Counted
   * SEPARATELY from `missing` (an honest "no fixture written yet") because this is a different
   * failure mode -- a fixture that CLAIMS to exist but doesn't resolve -- and both must be zero
   * for deterministicGoldenStatus() to PASS.
   */
  unresolved: number;
  completeCount: boolean; // totalSlots === REQUIRED_FIXTURE_COUNT
}

export type QualityGoldenStatus = "MISSING" | "HUMAN_GATE" | "COMPLETE";

export interface QualityCasesStatus {
  found: boolean;
  totalSlots: number;
  reviewedCount: number;
  llmLabelCount: number; // must always be 0 -- LLM labels are never valid for R1 Golden v1
  status: QualityGoldenStatus;
}

export type TopLevelGoldenStatus = "PASS" | "FAIL";
export type QualityTopLevelStatus = "PASS" | "HUMAN_GATE" | "FAIL";

/**
 * R1 S7 (final blocker repair, Blocker 2) -- PASS requires the EXACT required count, every slot
 * resolved to a real existing-equivalent test, zero genuinely missing, zero unresolved references.
 * A malformed/absent manifest (`found: false`) fails every one of these by construction. Pure,
 * deliberately taking the already-computed status object (not reading any file itself) so a
 * regression test can simulate "one fixture missing" or "one reference broken" with injected data,
 * never by touching the real manifest (see golden-status.test.ts).
 */
export function deterministicGoldenStatus(status: DeterministicFixturesStatus): TopLevelGoldenStatus {
  return status.found &&
    status.totalSlots === REQUIRED_FIXTURE_COUNT &&
    status.existingEquivalent === REQUIRED_FIXTURE_COUNT &&
    status.missing === 0 &&
    status.unresolved === 0
    ? "PASS"
    : "FAIL";
}

/**
 * R1 S7 (final blocker repair, Blocker 2) -- the 32 human-reviewed quality cases, independent of
 * deterministic fixture completeness. HUMAN_GATE (not FAIL) is reserved for the one legitimate
 * "everything technical is fine, a human still needs to sign off" state; a genuinely missing or
 * malformed template file is FAIL, never laundered into HUMAN_GATE.
 */
export function qualityGoldenStatus(status: QualityCasesStatus): QualityTopLevelStatus {
  if (status.status === "COMPLETE") return "PASS";
  if (status.status === "HUMAN_GATE") return "HUMAN_GATE";
  return "FAIL";
}

export interface R1GoldenStatus {
  deterministicFixtures: DeterministicFixturesStatus;
  qualityCases: QualityCasesStatus;
  /** R1 S7 (final blocker repair, Blocker 2) -- machineCertification (certify.ts) reads THIS
   * field directly, never `overall` below -- a missing/unresolved deterministic fixture can never
   * again get laundered into HUMAN_GATE. */
  deterministicGolden: TopLevelGoldenStatus;
  /** qualityGolden (certify.ts) reads THIS field directly -- computed ONLY from qualityCases,
   * never mixed with deterministic-fixture completeness. */
  qualityGolden: QualityTopLevelStatus;
  /** Informational rollup only, for human-readable output (e.g. `bun run scripts/r1/golden-status.ts`
   * at the CLI) -- certify.ts never derives a decision from this field, only from the two above. */
  overall: "PASS" | "HUMAN_GATE" | "FAIL";
  manifestHash: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidReviewerSignoff(value: unknown): value is ReviewerSignoff {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.reviewerName) &&
    isNonEmptyString(value.reviewerContact) &&
    isNonEmptyString(value.reviewedAt) &&
    isNonEmptyString(value.reviewMethod) &&
    isNonEmptyString(value.sourceStateHash) &&
    isNonEmptyString(value.signatureNote)
  );
}

// R1's frozen contract (per this slice's correction): LLM-generated labels are NEVER valid for
// R1 Golden v1, unlike the Fase 9 Golden Dataset (LLM panel, a DIFFERENT artifact). Any
// reviewMethod naming a model/automated process is rejected outright, not counted as reviewed.
const REJECTED_REVIEW_METHOD_SUBSTRINGS = ["llm", "gpt", "claude", "model", "automated", "ai-panel", "ai_panel"];

function isLlmReviewMethod(reviewMethod: string): boolean {
  const lower = reviewMethod.toLowerCase();
  return REJECTED_REVIEW_METHOD_SUBSTRINGS.some((needle) => lower.includes(needle));
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// R1 S7 (final blocker repair, Blocker 2) -- "fixture reference cannot be resolved" (explicit
// MUST-FAIL condition for `--machine-only`): a manifest entry claiming `existing_equivalent` is
// only as good as the test it points at. Mechanical check, no heuristics: the referenced file must
// exist on disk, and its content must literally contain the referenced test name -- if a test gets
// renamed or deleted, the manifest silently drifts out of sync with reality without this. Degrades
// to "unresolved" on any failure, never throws (same discipline as every other curated-data loader
// in this repo, invariantes.md).
function isEquivalentTestResolvable(equivalentTest: unknown): boolean {
  if (!isRecord(equivalentTest)) return false;
  const { file, name } = equivalentTest;
  if (!isNonEmptyString(file) || !isNonEmptyString(name)) return false;
  const fullPath = resolve(ROOT, file);
  if (!fullPath.startsWith(ROOT)) return false; // no path traversal out of the repo
  if (!existsSync(fullPath)) return false;
  try {
    return readFileSync(fullPath, "utf-8").includes(name);
  } catch {
    return false;
  }
}

function computeDeterministicFixturesStatus(): DeterministicFixturesStatus {
  const raw = readJson(FIXTURES_PATH);
  if (!isRecord(raw) || !Array.isArray(raw.fixtures)) {
    return { found: false, totalSlots: 0, existingEquivalent: 0, missing: 0, unresolved: 0, completeCount: false };
  }
  let existingEquivalent = 0;
  let missing = 0;
  let unresolved = 0;
  for (const entry of raw.fixtures) {
    if (!isRecord(entry)) continue;
    if (entry.status === "existing_equivalent") {
      if (isEquivalentTestResolvable(entry.equivalentTest)) existingEquivalent += 1;
      else unresolved += 1;
    } else if (entry.status === "missing") {
      missing += 1;
    }
  }
  const totalSlots = raw.fixtures.length;
  return { found: true, totalSlots, existingEquivalent, missing, unresolved, completeCount: totalSlots === REQUIRED_FIXTURE_COUNT };
}

function computeQualityCasesStatus(): QualityCasesStatus {
  const raw = readJson(QUALITY_PATH);
  if (!isRecord(raw) || !Array.isArray(raw.cases)) {
    return { found: false, totalSlots: 0, reviewedCount: 0, llmLabelCount: 0, status: "MISSING" };
  }
  let reviewedCount = 0;
  let llmLabelCount = 0;
  for (const entry of raw.cases) {
    if (!isRecord(entry)) continue;
    const review = entry.humanReview;
    if (!isRecord(review)) continue;
    const signoff = review.reviewerSignoff;
    if (!isValidReviewerSignoff(signoff)) continue;
    if (isLlmReviewMethod(signoff.reviewMethod)) {
      llmLabelCount += 1;
      continue; // never counted as a valid human review, regardless of any other field.
    }
    reviewedCount += 1;
  }
  const totalSlots = raw.cases.length;
  const status: QualityGoldenStatus =
    totalSlots === 0 ? "MISSING" : reviewedCount === REQUIRED_QUALITY_COUNT && totalSlots === REQUIRED_QUALITY_COUNT ? "COMPLETE" : "HUMAN_GATE";
  return { found: true, totalSlots, reviewedCount, llmLabelCount, status };
}

function computeManifestHash(): string | null {
  const fixturesRaw = readJson(FIXTURES_PATH);
  const qualityRaw = readJson(QUALITY_PATH);
  if (fixturesRaw === null || qualityRaw === null) return null;
  // Only the STRUCTURAL identity (never wall-clock telemetry, none present in these artifacts) --
  // same functional-hash discipline certify.ts already applies to its own report.
  return createHash("sha256").update(JSON.stringify({ fixturesRaw, qualityRaw })).digest("hex");
}

export function getR1GoldenStatus(): R1GoldenStatus {
  const deterministicFixtures = computeDeterministicFixturesStatus();
  const qualityCases = computeQualityCasesStatus();
  const deterministicGolden = deterministicGoldenStatus(deterministicFixtures);
  const qualityGolden = qualityGoldenStatus(qualityCases);

  // R1 S7 (final blocker repair, Blocker 2) -- informational only (see R1GoldenStatus's doc
  // comment): a FAIL on either half is a real FAIL, never softened into HUMAN_GATE. HUMAN_GATE is
  // reserved for the one legitimate case: everything mechanical is green, only qualityGolden's
  // human signoff is outstanding.
  const overall: R1GoldenStatus["overall"] =
    deterministicGolden === "FAIL" || qualityGolden === "FAIL"
      ? "FAIL"
      : deterministicGolden === "PASS" && qualityGolden === "PASS"
        ? "PASS"
        : "HUMAN_GATE";

  return { deterministicFixtures, qualityCases, deterministicGolden, qualityGolden, overall, manifestHash: computeManifestHash() };
}

if (import.meta.main) {
  console.log(JSON.stringify(getR1GoldenStatus(), null, 2));
}
