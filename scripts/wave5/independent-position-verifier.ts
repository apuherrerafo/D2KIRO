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
  totalPopulationMatches: number;
  totalKnownPositionMatches: number;
  unassignedMatches: number;
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

export interface HeroEntryValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates the population identity and completeness metadata for a single hero entry.
 *
 * Final A2 semantics require:
 *   known = sum(all position observations)
 *   totalKnownPositionMatches == known
 *   totalPopulationMatches >= totalKnownPositionMatches
 *   unassignedMatches >= 0
 *   totalPopulationMatches == totalKnownPositionMatches + unassignedMatches
 */
export function validateHeroPopulationEntry(entry: unknown): HeroEntryValidationResult {
  if (typeof entry !== "object" || entry === null) {
    return { valid: false, error: "Hero entry must be a valid JSON object" };
  }
  const e = entry as Record<string, unknown>;

  if (typeof e.hero !== "number" || !Number.isInteger(e.hero) || e.hero <= 0) {
    return { valid: false, error: `Invalid or missing hero ID: ${String(e.hero)}` };
  }

  if (!Array.isArray(e.observations)) {
    return { valid: false, error: `Hero ${e.hero}: observations must be an array` };
  }

  const seenPositions = new Set<number>();
  let known = 0;
  for (const obs of e.observations) {
    if (typeof obs !== "object" || obs === null) {
      return { valid: false, error: `Hero ${e.hero}: observation row must be an object` };
    }
    const o = obs as Record<string, unknown>;
    const pos = o.position;
    const matches = o.matches;
    if (pos !== 1 && pos !== 2 && pos !== 3 && pos !== 4 && pos !== 5) {
      return { valid: false, error: `Hero ${e.hero}: invalid position ${String(pos)} (must be 1..5)` };
    }
    if (typeof matches !== "number" || !Number.isInteger(matches) || matches < 0) {
      return { valid: false, error: `Hero ${e.hero}: invalid matches count for position ${pos}` };
    }
    if (seenPositions.has(pos)) {
      return { valid: false, error: `Hero ${e.hero}: duplicate observation for position ${pos}` };
    }
    seenPositions.add(pos);
    known += matches;
  }

  // Denominator metadata presence and integer type check
  if (
    typeof e.totalPopulationMatches !== "number" ||
    !Number.isInteger(e.totalPopulationMatches) ||
    typeof e.totalKnownPositionMatches !== "number" ||
    !Number.isInteger(e.totalKnownPositionMatches) ||
    typeof e.unassignedMatches !== "number" ||
    !Number.isInteger(e.unassignedMatches)
  ) {
    return {
      valid: false,
      error: `Hero ${e.hero}: missing or non-integer denominator metadata (totalPopulationMatches, totalKnownPositionMatches, unassignedMatches required)`,
    };
  }

  // Denominator identities
  if (e.totalKnownPositionMatches !== known) {
    return {
      valid: false,
      error: `Hero ${e.hero}: totalKnownPositionMatches (${e.totalKnownPositionMatches}) does not match sum of observations (${known})`,
    };
  }

  if (e.unassignedMatches < 0) {
    return {
      valid: false,
      error: `Hero ${e.hero}: unassignedMatches (${e.unassignedMatches}) must be >= 0`,
    };
  }

  if (e.totalPopulationMatches < e.totalKnownPositionMatches) {
    return {
      valid: false,
      error: `Hero ${e.hero}: totalPopulationMatches (${e.totalPopulationMatches}) < totalKnownPositionMatches (${e.totalKnownPositionMatches})`,
    };
  }

  if (e.totalPopulationMatches !== e.totalKnownPositionMatches + e.unassignedMatches) {
    return {
      valid: false,
      error: `Hero ${e.hero}: population identity mismatch: totalPopulationMatches (${e.totalPopulationMatches}) !== totalKnownPositionMatches (${e.totalKnownPositionMatches}) + unassignedMatches (${e.unassignedMatches})`,
    };
  }

  return { valid: true };
}

/**
 * Verifies dataset completeness and provenance metadata compatibility with the complete-denominator schema.
 * Rejects legacy floor-truncated datasets where sub-floor counts were discarded at collection.
 * Inspects every hero entry to ensure complete population denominator metadata and identities are valid.
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

  const seenHeroes = new Set<number>();
  for (const heroEntry of obj.heroes) {
    const validation = validateHeroPopulationEntry(heroEntry);
    if (!validation.valid) {
      return {
        valid: false,
        format: "hero-position-observations/v1",
        error: validation.error,
      };
    }
    const heroId = (heroEntry as RawHeroEntry).hero;
    if (seenHeroes.has(heroId)) {
      return {
        valid: false,
        format: "hero-position-observations/v1",
        error: `Duplicate hero entry: ${heroId}`,
      };
    }
    seenHeroes.add(heroId);
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
 * Independently validates hero population identity and recomputes dominant position and positionShare
 * from raw dataset fields, using totalPopulationMatches as the denominator.
 *
 * Applies the documented admission rule directly:
 * - base floor (200 matches)
 * - mid floor (600 matches for pos 2)
 * - dominant position OR >= 25% share of totalPopulationMatches
 */
export function evaluateIndependentCredibility(
  heroEntryOrObservations: RawHeroEntry | readonly RawObservation[],
  targetPosition: 1 | 2 | 3 | 4 | 5,
  heroId = 0,
): IndependentPositionCredibility {
  if (Array.isArray(heroEntryOrObservations)) {
    return {
      hero: heroId,
      targetPosition,
      isCredible: false,
      heroTotalMatches: 0,
      targetMatches: 0,
      dominantPosition: 0,
      dominantMatches: 0,
      positionShare: 0,
      rejectionReason: "Lacking denominator metadata: RawHeroEntry with totalPopulationMatches is required",
    };
  }

  const heroEntry = heroEntryOrObservations;
  const resolvedHeroId = heroEntry.hero ?? heroId;

  const validation = validateHeroPopulationEntry(heroEntry);
  if (!validation.valid) {
    return {
      hero: resolvedHeroId,
      targetPosition,
      isCredible: false,
      heroTotalMatches: 0,
      targetMatches: 0,
      dominantPosition: 0,
      dominantMatches: 0,
      positionShare: 0,
      rejectionReason: validation.error,
    };
  }

  const heroTotalMatches = heroEntry.totalPopulationMatches;
  const targetObs = heroEntry.observations.find((obs) => obs.position === targetPosition);
  const targetMatches = targetObs?.matches ?? 0;

  let dominantPosition = 0;
  let dominantMatches = 0;
  for (const obs of heroEntry.observations) {
    if (obs.matches > dominantMatches) {
      dominantMatches = obs.matches;
      dominantPosition = obs.position;
    }
  }

  const positionShare = heroTotalMatches > 0 ? targetMatches / heroTotalMatches : 0;

  // Base floor (200 matches)
  if (targetMatches < CERT_MIN_POSITION_MATCHES) {
    return {
      hero: resolvedHeroId,
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
      hero: resolvedHeroId,
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
    hero: resolvedHeroId,
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

  return evaluateIndependentCredibility(heroEntry, targetPosition, hero);
}
