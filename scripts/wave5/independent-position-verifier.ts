// WAVE 5 Hardening (H4) -- Independent positional certification verifier.
//
// This module provides an independent calculation for certifying positional credibility and dataset
// completeness, avoiding any circular dependency on the production admission helpers.
//
// ARCHITECTURAL CONTRACT:
// This verifier must NOT import or call:
//   - isCredibleForPosition
//   - credibleHeroesForPosition
//   - personalCandidateUniverse
//
// Thresholds are explicitly duplicated here with contract assertions to make semantic drift visible.

export const CERT_MIN_POSITION_MATCHES = 200;
export const CERT_MID_MIN_MATCHES = 600;
export const CERT_ADMISSION_MIN_SHARE = 0.25;
export const EXPECTED_OBSERVATIONS_SCHEMA = "hero-position-observations/v1";

// Contract assertions: fail fast if constants are corrupted
if (CERT_MIN_POSITION_MATCHES !== 200 || CERT_MID_MIN_MATCHES !== 600 || CERT_ADMISSION_MIN_SHARE !== 0.25) {
  throw new Error("Independent position verifier: contract assertion failed on duplicated constants");
}

export interface RawObservation {
  position: 1 | 2 | 3 | 4 | 5;
  matches: number;
}

export interface RawHeroEntry {
  hero: number;
  observations: RawObservation[];
}

export interface RawObservationsDataset {
  schema?: string;
  heroes?: RawHeroEntry[];
  provenance?: Record<string, unknown>;
}

export interface DatasetVerificationResult {
  valid: boolean;
  format: "hero-position-observations/v1" | "v1-floor-truncated" | "unknown";
  error?: string;
}

/**
 * Verifies dataset completeness and provenance metadata compatibility with the complete-denominator schema.
 * Rejects legacy floor-truncated datasets where sub-floor counts were discarded at collection.
 */
export function verifyPositionalDatasetCompleteness(raw: unknown): DatasetVerificationResult {
  if (Array.isArray(raw)) {
    return {
      valid: false,
      format: "v1-floor-truncated",
      error: "Legacy floor-truncated dataset: root is an array without denominator completeness metadata",
    };
  }
  if (typeof raw !== "object" || raw === null) {
    return {
      valid: false,
      format: "unknown",
      error: "Invalid dataset: not a JSON object",
    };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schema !== EXPECTED_OBSERVATIONS_SCHEMA) {
    return {
      valid: false,
      format: "unknown",
      error: `Incompatible schema: expected "${EXPECTED_OBSERVATIONS_SCHEMA}", got "${String(obj.schema)}"`,
    };
  }
  if (!Array.isArray(obj.heroes) || obj.heroes.length === 0) {
    return {
      valid: false,
      format: "hero-position-observations/v1",
      error: "Dataset has no hero entries",
    };
  }
  return {
    valid: true,
    format: "hero-position-observations/v1",
  };
}

export interface IndependentPositionCredibility {
  hero: number;
  targetPosition: 1 | 2 | 3 | 4 | 5;
  isCredible: boolean;
  heroTotalMatches: number;
  targetMatches: number;
  dominantPosition: number;
  dominantMatches: number;
  positionShare: number;
  rejectionReason?: string;
}

/**
 * Independently recomputes heroTotalMatches, dominant position and positionShare from raw per-position counts,
 * and applies the documented admission rule directly.
 */
export function evaluateIndependentCredibility(
  heroObservations: readonly RawObservation[],
  targetPosition: 1 | 2 | 3 | 4 | 5,
  heroId = 0,
): IndependentPositionCredibility {
  const heroTotalMatches = heroObservations.reduce((sum, obs) => sum + obs.matches, 0);
  const targetObs = heroObservations.find((obs) => obs.position === targetPosition);
  const targetMatches = targetObs?.matches ?? 0;

  let dominantPosition = 0;
  let dominantMatches = 0;
  for (const obs of heroObservations) {
    if (obs.matches > dominantMatches) {
      dominantMatches = obs.matches;
      dominantPosition = obs.position;
    }
  }

  const positionShare = heroTotalMatches > 0 ? targetMatches / heroTotalMatches : 0;

  // Documented admission rule:
  // Must clear base floor (200 matches)
  if (targetMatches < CERT_MIN_POSITION_MATCHES) {
    return {
      hero: heroId,
      targetPosition,
      isCredible: false,
      heroTotalMatches,
      targetMatches,
      dominantPosition,
      dominantMatches,
      positionShare,
      rejectionReason: `Target matches ${targetMatches} below base floor ${CERT_MIN_POSITION_MATCHES}`,
    };
  }

  // Mid (Pos 2) has an absolute evidence floor of 600 matches
  if (targetPosition === 2 && targetMatches < CERT_MID_MIN_MATCHES) {
    return {
      hero: heroId,
      targetPosition,
      isCredible: false,
      heroTotalMatches,
      targetMatches,
      dominantPosition,
      dominantMatches,
      positionShare,
      rejectionReason: `Mid target matches ${targetMatches} below Mid floor ${CERT_MID_MIN_MATCHES}`,
    };
  }

  const isDominant = targetMatches === dominantMatches;
  const hasShare = positionShare >= CERT_ADMISSION_MIN_SHARE;
  const isCredible = isDominant || hasShare;

  return {
    hero: heroId,
    targetPosition,
    isCredible,
    heroTotalMatches,
    targetMatches,
    dominantPosition,
    dominantMatches,
    positionShare,
    ...(isCredible ? {} : { rejectionReason: `Neither dominant nor >= 25% share (share: ${(positionShare * 100).toFixed(1)}%)` }),
  };
}

/**
 * Validates credibility of a hero for a target position against a complete raw observations dataset.
 */
export function verifyHeroPositionCredibility(
  rawDataset: unknown,
  hero: number,
  targetPosition: 1 | 2 | 3 | 4 | 5,
): IndependentPositionCredibility {
  const datasetCheck = verifyPositionalDatasetCompleteness(rawDataset);
  if (!datasetCheck.valid) {
    return {
      hero,
      targetPosition,
      isCredible: false,
      heroTotalMatches: 0,
      targetMatches: 0,
      dominantPosition: 0,
      dominantMatches: 0,
      positionShare: 0,
      rejectionReason: datasetCheck.error,
    };
  }

  const dataset = rawDataset as RawObservationsDataset;
  const heroEntry = dataset.heroes?.find((h) => h.hero === hero);
  if (!heroEntry) {
    return {
      hero,
      targetPosition,
      isCredible: false,
      heroTotalMatches: 0,
      targetMatches: 0,
      dominantPosition: 0,
      dominantMatches: 0,
      positionShare: 0,
      rejectionReason: `Hero ${hero} not found in observations dataset`,
    };
  }

  return evaluateIndependentCredibility(heroEntry.observations, targetPosition, hero);
}
