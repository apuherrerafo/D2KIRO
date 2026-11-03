/**
 * QA-only positional oracle. It deliberately does not import production admission helpers.
 *
 * PRODUCTION_DECISION_PATH:
 *   session metadata -> humanOpenPositions -> Coach recommendation builder ->
 *   signals/hero-positions.isCredibleForPosition -> serialized V2/V3 response.
 * QA_ORACLE_PATH:
 *   hero-position-observations.json -> raw observations -> independent floors/share calculation.
 * SHARED_RAW_DATA: apps/engine/src/signals/hero-positions.json.
 * INDEPENDENT_LOGIC: this file recomputes counts, dominant role and share; it never calls a
 * production filter, candidate-universe helper, ranking function, or response translator.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Position = 1 | 2 | 3 | 4 | 5;

interface Observation { position: Position; matches: number }
interface HeroObservation { hero: number; totalPopulationMatches: number; totalKnownPositionMatches: number; unassignedMatches: number; observations: Observation[] }
interface Dataset { schema: string; heroes: HeroObservation[] }

// Duplicated QA contract constants on purpose: drift is a visible QA review event.
const MIN_MATCHES = 200;
const MID_MIN_MATCHES = 600;
const MIN_SHARE = 0.25;

function isPosition(value: unknown): value is Position {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function loadQaPositionEvidence(path = resolve(import.meta.dir, "../../apps/engine/src/signals/hero-positions.json")): Dataset {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Dataset;
  if (raw.schema !== "hero-position-observations/v1" || !Array.isArray(raw.heroes)) throw new Error("QA oracle: unsupported position evidence schema");
  for (const hero of raw.heroes) {
    const sum = hero.observations.reduce((total, row) => total + row.matches, 0);
    if (!Number.isInteger(hero.hero) || hero.hero <= 0 || sum !== hero.totalKnownPositionMatches || hero.totalPopulationMatches !== sum + hero.unassignedMatches) {
      throw new Error(`QA oracle: corrupt raw evidence for hero ${hero.hero}`);
    }
  }
  return raw;
}

export interface QaCredibility { credible: boolean; reason: string; targetMatches: number; share: number; dominantPosition: Position | null }

export function independentlyCredibleForPosition(evidence: Dataset, heroId: number, target: Position): QaCredibility {
  const hero = evidence.heroes.find((entry) => entry.hero === heroId);
  if (!hero) return { credible: false, reason: "missing raw evidence", targetMatches: 0, share: 0, dominantPosition: null };
  const targetMatches = hero.observations.find((row) => row.position === target)?.matches ?? 0;
  const dominant = [...hero.observations].sort((a, b) => b.matches - a.matches || a.position - b.position)[0];
  const dominantPosition = dominant?.position ?? null;
  const share = hero.totalPopulationMatches === 0 ? 0 : targetMatches / hero.totalPopulationMatches;
  if (targetMatches < MIN_MATCHES) return { credible: false, reason: `target matches ${targetMatches} below ${MIN_MATCHES}`, targetMatches, share, dominantPosition };
  if (target === 2 && targetMatches < MID_MIN_MATCHES) return { credible: false, reason: `Pos2 matches ${targetMatches} below ${MID_MIN_MATCHES}`, targetMatches, share, dominantPosition };
  if (dominantPosition === target || share >= MIN_SHARE) return { credible: true, reason: "dominant or sufficient share", targetMatches, share, dominantPosition };
  return { credible: false, reason: `share ${(share * 100).toFixed(2)}% below 25% and not dominant`, targetMatches, share, dominantPosition };
}
