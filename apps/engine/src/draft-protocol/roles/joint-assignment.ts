import type { HeroId } from "../types";
import type { Position, RoleBelief } from "./role-belief";

// R1 S4.3 -- Joint Role Assignment. Fixes the real problem with independent per-hero marginals:
// "un héroe flexible cubre simultáneamente tres huecos" -- two flexible heroes with overlapping
// high-probability positions can each individually look like they cover position 3, while no
// FEASIBLE assignment ever puts both of them there at once. Independent marginals can't see that;
// enumerating every injective assignment can.
//
// At most 5 heroes -> at most 5! = 120 injective position assignments. No solver needed (S4.3:
// "No necesitamos solver complejo"). A position can be occupied by exactly one hero in any given
// candidate assignment -- enforced by construction (permutation generation), not by a runtime
// check that could be forgotten.

const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const ZERO: Readonly<Record<Position, number>> = Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
const ONE: Readonly<Record<Position, number>> = Object.freeze({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });

/** Below this coverage, a position counts as "open" (S4.3: derive open positions). */
const OPEN_POSITION_EPSILON = 1e-9;

export interface JointAssignmentHeroInput {
  heroId: HeroId;
  belief: RoleBelief;
}

export interface JointAssignmentCandidate {
  /** Exactly `heroes.length` entries, one distinct position per hero -- injective by construction. */
  assignment: ReadonlyMap<HeroId, Position>;
  /** Normalized across every candidate for this call; all candidates' probabilities sum to 1. */
  probability: number;
}

export interface JointRoleAssignmentResult {
  /** Sorted descending by probability. Empty iff `rejected` is set or `heroes` was empty. */
  candidates: readonly JointAssignmentCandidate[];
  heroPositionMarginals: ReadonlyMap<HeroId, Readonly<Record<Position, number>>>;
  /** Probability that a position is covered by ANY of the given heroes, across all candidates. */
  positionCoverage: Readonly<Record<Position, number>>;
  /** Positions no candidate assignment ever covers (positionCoverage below epsilon). */
  openPositions: readonly Position[];
  /** `1 - positionCoverage[position]`, per position. */
  expectedPositionNeed: Readonly<Record<Position, number>>;
  /** Shannon entropy (bits) of the candidate probability distribution -- team-level ambiguity. */
  entropy: number;
  /** Set when the input can't produce any injective assignment (more heroes than positions). */
  rejected?: "TOO_MANY_HEROES";
}

function generateInjectivePositionSequences(count: number): Position[][] {
  const results: Position[][] = [];
  const used = new Set<Position>();
  const current: Position[] = [];
  function backtrack(): void {
    if (current.length === count) {
      results.push([...current]);
      return;
    }
    for (const position of POSITIONS) {
      if (used.has(position)) continue;
      used.add(position);
      current.push(position);
      backtrack();
      current.pop();
      used.delete(position);
    }
  }
  backtrack();
  return results;
}

function emptyResult(rejected?: "TOO_MANY_HEROES"): JointRoleAssignmentResult {
  return {
    candidates: [],
    heroPositionMarginals: new Map(),
    positionCoverage: ZERO,
    openPositions: [...POSITIONS],
    expectedPositionNeed: ONE,
    entropy: 0,
    ...(rejected ? { rejected } : {}),
  };
}

/**
 * Enumerates every injective (hero -> position) assignment over `heroes`, weights each by the
 * product of each hero's own RoleBelief.probabilities at its assigned position, and normalizes
 * into a genuine joint probability distribution. Deterministic: same `heroes` input (same order,
 * same beliefs) -> same candidates in the same order, always.
 */
export function computeJointRoleAssignment(heroes: readonly JointAssignmentHeroInput[]): JointRoleAssignmentResult {
  if (heroes.length > 5) return emptyResult("TOO_MANY_HEROES");
  if (heroes.length === 0) return emptyResult();

  const sequences = generateInjectivePositionSequences(heroes.length);
  const rawCandidates = sequences.map((positions) => {
    let weight = 1;
    for (let i = 0; i < heroes.length; i += 1) weight *= heroes[i]!.belief.probabilities[positions[i]!];
    const assignment = new Map<HeroId, Position>();
    heroes.forEach((hero, i) => assignment.set(hero.heroId, positions[i]!));
    return { assignment, weight };
  });

  const totalWeight = rawCandidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  // A team state where two heroes are BOTH hard-CONFIRMED to the same position is a genuinely
  // impossible input (contradictory evidence, not something this function invented) -- every
  // weighted candidate is 0. Rather than divide by zero or silently return nothing, fall back to
  // a uniform distribution over the injective sequences themselves, so callers still get a
  // well-formed (if maximally uncertain) result instead of NaN.
  //
  // Zero-weight sequences (impossible given the evidence -- e.g. any sequence not putting a
  // hard-CONFIRMED hero at its confirmed position) are dropped from the normal branch: they are
  // not "candidates" at all once real evidence rules them out, only filler in the uninformative
  // fallback where every sequence is equally (im)plausible.
  const candidates: JointAssignmentCandidate[] = (
    totalWeight > 0
      ? rawCandidates
          .filter((candidate) => candidate.weight > 0)
          .map((candidate) => ({ assignment: candidate.assignment, probability: candidate.weight / totalWeight }))
      : rawCandidates.map((candidate) => ({ assignment: candidate.assignment, probability: 1 / rawCandidates.length }))
  ).sort((a, b) => b.probability - a.probability);

  const heroPositionMarginals = new Map<HeroId, Record<Position, number>>();
  for (const hero of heroes) heroPositionMarginals.set(hero.heroId, { ...ZERO });
  const positionCoverage: Record<Position, number> = { ...ZERO };

  for (const candidate of candidates) {
    for (const [heroId, position] of candidate.assignment) {
      const marginal = heroPositionMarginals.get(heroId)!;
      marginal[position] += candidate.probability;
      positionCoverage[position] += candidate.probability;
    }
  }

  const openPositions = POSITIONS.filter((position) => positionCoverage[position] < OPEN_POSITION_EPSILON);
  const expectedPositionNeed = {} as Record<Position, number>;
  for (const position of POSITIONS) expectedPositionNeed[position] = 1 - positionCoverage[position];

  let entropy = 0;
  for (const candidate of candidates) {
    if (candidate.probability > 0) entropy -= candidate.probability * Math.log2(candidate.probability);
  }

  return { candidates, heroPositionMarginals, positionCoverage, openPositions, expectedPositionNeed, entropy };
}
