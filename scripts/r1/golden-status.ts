// R1 S7 completion wave (Blocker 3) -- deterministic schema validation + status computation for
// R1 Golden v1 (H0.5: 28 deterministic protocol fixtures + 32 human-reviewed Dota quality cases,
// total 60). Mirrors the loader discipline this repo already uses for curated data
// (invariantes.md, "los datos curados se validan en el borde al cargarlos"): a malformed artifact
// degrades to an honest "unknown"/gate-closed status, never throws, never invents a passing count.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOLDEN_DIR = resolve(import.meta.dir, "..", "..", "docs", "r1", "golden");
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

export interface R1GoldenStatus {
  deterministicFixtures: DeterministicFixturesStatus;
  qualityCases: QualityCasesStatus;
  /** Overall R1 Golden v1 readiness -- never PASS/COMPLETE unless BOTH halves are complete. */
  overall: "MISSING" | "HUMAN_GATE" | "COMPLETE";
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

function computeDeterministicFixturesStatus(): DeterministicFixturesStatus {
  const raw = readJson(FIXTURES_PATH);
  if (!isRecord(raw) || !Array.isArray(raw.fixtures)) {
    return { found: false, totalSlots: 0, existingEquivalent: 0, missing: 0, completeCount: false };
  }
  let existingEquivalent = 0;
  let missing = 0;
  for (const entry of raw.fixtures) {
    if (!isRecord(entry)) continue;
    if (entry.status === "existing_equivalent") existingEquivalent += 1;
    else if (entry.status === "missing") missing += 1;
  }
  const totalSlots = raw.fixtures.length;
  return { found: true, totalSlots, existingEquivalent, missing, completeCount: totalSlots === REQUIRED_FIXTURE_COUNT };
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

  let overall: R1GoldenStatus["overall"] = "MISSING";
  if (deterministicFixtures.found && qualityCases.found) {
    overall = qualityCases.status === "COMPLETE" && deterministicFixtures.missing === 0 ? "COMPLETE" : "HUMAN_GATE";
  }

  return { deterministicFixtures, qualityCases, overall, manifestHash: computeManifestHash() };
}

if (import.meta.main) {
  console.log(JSON.stringify(getR1GoldenStatus(), null, 2));
}
