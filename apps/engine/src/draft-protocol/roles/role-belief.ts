import { deriveFlexDistribution } from "../../intent/position-prior";
import type { HeroPositions } from "../../signals/hero-positions";
import type { HeroId } from "../types";

// R1 S4.1/S4.2 -- RoleBelief: canonical uncertainty layer over "which position does this hero
// occupy", replacing the old hero-equals-fixed-position assumption. Pure, deterministic (same
// evidence -> same result, no RNG, no clock). Reuses `deriveFlexDistribution`
// (apps/engine/src/intent/position-prior.ts, Fase 7) as the hero/patch evidence tier rather than
// inventing a second position-probability model -- V6 scoring stays untouched, this module never
// writes into signals/.
//
// Source priority (S4.2, highest wins): (1) explicit confirmation -- HARD CONSTRAINT, always
// one-hot, short-circuits everything else; (2) structural draft constraints (positions already
// confirmed-held by OTHER own-team heroes); (3) party member preference -- SOFT PRIOR, nudges but
// never zeroes/forces; (4) hero/patch distribution; (5) neutral prior if none of the above apply.
// Implemented by layering from lowest to highest priority (4 -> 3 -> 2), so a later, higher-
// priority layer always has final say over an earlier one -- (1) is checked first and returns
// immediately, bypassing the layering entirely.

export type Position = 1 | 2 | 3 | 4 | 5;
const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const UNIFORM_PROBABILITY = 1 / POSITIONS.length;
const UNIFORM: Readonly<Record<Position, number>> = Object.freeze({
  1: UNIFORM_PROBABILITY,
  2: UNIFORM_PROBABILITY,
  3: UNIFORM_PROBABILITY,
  4: UNIFORM_PROBABILITY,
  5: UNIFORM_PROBABILITY,
});

/**
 * How much a declared party preference nudges the prior. Arranque, QA-tuneable (same posture as
 * K_position_fit/ARCHETYPE_MAX_BONUS elsewhere in this repo) -- deliberately modest so a single
 * preference can never dominate a hero/patch distribution the way an explicit confirmation does.
 * NOT the hero-only-vs-hero+position recommendation threshold (that's S4.5/S5's, and stays
 * unfrozen); this only shapes the shape of one belief distribution internally.
 */
const PREFERENCE_BOOST = 0.5;

export type RoleBeliefStatus = "CONFIRMED" | "LIKELY" | "UNRESOLVED";

export type RoleBeliefEvidenceKind =
  | "CONFIRMED_EXPLICIT"
  | "STRUCTURAL_CONSTRAINT"
  | "PARTY_PREFERENCE"
  | "HERO_PATCH_DISTRIBUTION"
  | "NEUTRAL_PRIOR";

export interface RoleBeliefEvidence {
  kind: RoleBeliefEvidenceKind;
  detail: string;
}

export interface RoleBelief {
  status: RoleBeliefStatus;
  /** Normalized, sums to 1. */
  probabilities: Readonly<Record<Position, number>>;
  /** Shannon entropy in bits. 0 = certain, log2(5) ~= 2.32 = maximum uncertainty. */
  entropy: number;
  /** Ordered lowest-priority-applied-first to highest-priority-applied-last; only tiers that actually contributed. */
  evidence: readonly RoleBeliefEvidence[];
}

export interface RoleBeliefInput {
  heroId: HeroId | null;
  confirmedPosition?: Position | null;
  /** Ordered strongest-first. Never forces an assignment by itself. */
  partyPreferredPositions?: readonly Position[];
  /** Positions already confirmed-held by OTHER own-team heroes this draft. */
  occupiedPositions?: ReadonlySet<Position>;
  heroPositions?: HeroPositions;
}

function shannonEntropy(probabilities: Readonly<Record<Position, number>>): number {
  let entropy = 0;
  for (const position of POSITIONS) {
    const p = probabilities[position];
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

function normalize(weights: Readonly<Record<Position, number>>): Record<Position, number> {
  const total = POSITIONS.reduce((sum, position) => sum + weights[position], 0);
  if (total <= 0) return { ...UNIFORM };
  const out = {} as Record<Position, number>;
  for (const position of POSITIONS) out[position] = weights[position] / total;
  return out;
}

function isUniform(probabilities: Readonly<Record<Position, number>>): boolean {
  return POSITIONS.every((position) => Math.abs(probabilities[position] - UNIFORM_PROBABILITY) < 1e-9);
}

/**
 * Computes a RoleBelief for one hero/participant from whatever evidence is available.
 * `input.heroId === null` (no hero picked yet for this slot) is legitimate -- confirmation and
 * preference evidence can still apply, hero/patch distribution simply can't (no hero to look up).
 */
export function computeRoleBelief(input: RoleBeliefInput): RoleBelief {
  if (input.confirmedPosition) {
    const probabilities = {} as Record<Position, number>;
    for (const position of POSITIONS) probabilities[position] = position === input.confirmedPosition ? 1 : 0;
    return {
      status: "CONFIRMED",
      probabilities,
      entropy: 0,
      evidence: [{ kind: "CONFIRMED_EXPLICIT", detail: `posición ${input.confirmedPosition} confirmada explícitamente` }],
    };
  }

  const evidence: RoleBeliefEvidence[] = [];
  let weights: Readonly<Record<Position, number>> = UNIFORM;
  let hasEvidence = false;

  if (input.heroId !== null && input.heroPositions) {
    const distribution = deriveFlexDistribution(input.heroId, input.heroPositions);
    if (!isUniform(distribution.probabilities)) {
      weights = distribution.probabilities;
      hasEvidence = true;
      evidence.push({
        kind: "HERO_PATCH_DISTRIBUTION",
        detail: `distribución histórica del héroe (entropía ${distribution.entropy.toFixed(2)} bits)`,
      });
    }
  }

  if (input.partyPreferredPositions && input.partyPreferredPositions.length > 0) {
    const boosted: Record<Position, number> = { ...weights };
    const count = input.partyPreferredPositions.length;
    input.partyPreferredPositions.forEach((position, index) => {
      boosted[position] += PREFERENCE_BOOST * (1 - index / count);
    });
    weights = boosted;
    hasEvidence = true;
    evidence.push({
      kind: "PARTY_PREFERENCE",
      detail: `preferencia declarada: ${input.partyPreferredPositions.join(", ")}`,
    });
  }

  if (input.occupiedPositions && input.occupiedPositions.size > 0) {
    const constrained: Record<Position, number> = { ...weights };
    let anyOpenPosition = false;
    for (const position of POSITIONS) {
      if (input.occupiedPositions.has(position)) constrained[position] = 0;
      else anyOpenPosition = true;
    }
    // Fail closed toward the pre-constraint weights rather than zeroing every position (which
    // would make normalize() fall back to a silent uniform re-guess) -- a team state where every
    // position is already reported occupied is itself a caller error, not something this belief
    // computation should paper over.
    if (anyOpenPosition) {
      weights = constrained;
      hasEvidence = true;
      evidence.push({
        kind: "STRUCTURAL_CONSTRAINT",
        detail: `posiciones ya cubiertas por el equipo: ${[...input.occupiedPositions].sort().join(", ")}`,
      });
    }
  }

  if (!hasEvidence) {
    return {
      status: "UNRESOLVED",
      probabilities: UNIFORM,
      entropy: shannonEntropy(UNIFORM),
      evidence: [{ kind: "NEUTRAL_PRIOR", detail: "sin evidencia disponible" }],
    };
  }

  const probabilities = normalize(weights);
  return { status: "LIKELY", probabilities, entropy: shannonEntropy(probabilities), evidence };
}
