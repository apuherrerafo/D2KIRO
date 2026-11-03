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
  /** Set when the input can't produce any assignment without violating a hard constraint. */
  rejected?: "TOO_MANY_HEROES" | "IMPOSSIBLE_ASSIGNMENT";
  /** Confirmed positions that made an injective assignment impossible, preserved for explanation. */
  conflicts?: readonly { position: Position; heroIds: readonly HeroId[] }[];
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

function findViolatingSubset(
  entries: readonly { heroId: HeroId; allowed: readonly Position[] }[],
  size: number,
): { positions: readonly Position[]; heroIds: readonly HeroId[] } | null {
  function combinations(start: number, chosen: number[]): number[][] {
    if (chosen.length === size) return [chosen];
    const res: number[][] = [];
    for (let i = start; i < entries.length; i++) {
      res.push(...combinations(i + 1, [...chosen, i]));
    }
    return res;
  }
  for (const indices of combinations(0, [])) {
    const subset = indices.map((i) => entries[i]!);
    const unionPositions = new Set<Position>();
    for (const item of subset) {
      for (const p of item.allowed) unionPositions.add(p);
    }
    if (unionPositions.size < subset.length) {
      return {
        positions: [...unionPositions].sort((a, b) => a - b),
        heroIds: subset.map((s) => s.heroId),
      };
    }
  }
  return null;
}

function emptyResult(
  rejected?: "TOO_MANY_HEROES" | "IMPOSSIBLE_ASSIGNMENT",
  conflicts?: readonly { position: Position; heroIds: readonly HeroId[] }[],
): JointRoleAssignmentResult {
  return {
    candidates: [],
    heroPositionMarginals: new Map(),
    positionCoverage: ZERO,
    openPositions: [...POSITIONS],
    expectedPositionNeed: ONE,
    entropy: 0,
    ...(rejected ? { rejected } : {}),
    ...(conflicts && conflicts.length > 0 ? { conflicts } : {}),
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
  // Zero-weight sequences (impossible given the evidence -- e.g. any sequence not putting a
  // hard-CONFIRMED hero at its confirmed position) are not candidates. If every injective
  // sequence has zero weight, the evidence is contradictory and must fail explicitly.
  if (totalWeight === 0) {
    const confirmedByPosition = new Map<Position, HeroId[]>();
    for (const hero of heroes) {
      if (hero.belief.status !== "CONFIRMED") continue;
      const position = POSITIONS.find((candidate) => hero.belief.probabilities[candidate] === 1);
      if (position === undefined) continue;
      confirmedByPosition.set(position, [...(confirmedByPosition.get(position) ?? []), hero.heroId]);
    }
    let conflicts = [...confirmedByPosition.entries()]
      .filter(([, heroIds]) => heroIds.length > 1)
      .map(([position, heroIds]) => ({ position, heroIds }));

    if (conflicts.length === 0) {
      const exclusiveByPosition = new Map<Position, HeroId[]>();
      for (const hero of heroes) {
        const allowed = POSITIONS.filter((p) => hero.belief.probabilities[p] > 0);
        if (allowed.length === 1) {
          const position = allowed[0]!;
          exclusiveByPosition.set(position, [...(exclusiveByPosition.get(position) ?? []), hero.heroId]);
        }
      }
      conflicts = [...exclusiveByPosition.entries()]
        .filter(([, heroIds]) => heroIds.length > 1)
        .map(([position, heroIds]) => ({ position, heroIds }));
    }

    if (conflicts.length === 0) {
      const heroAllowed = heroes.map((h) => ({
        heroId: h.heroId,
        allowed: POSITIONS.filter((p) => h.belief.probabilities[p] > 0),
      }));
      for (let size = 2; size <= heroes.length; size++) {
        const found = findViolatingSubset(heroAllowed, size);
        if (found) {
          conflicts = found.positions.map((position) => ({ position, heroIds: [...found.heroIds] }));
          break;
        }
      }
    }

    if (conflicts.length === 0) {
      const unassignable = heroes.filter((h) => POSITIONS.every((p) => h.belief.probabilities[p] === 0));
      if (unassignable.length > 0) {
        conflicts = [{ position: 1, heroIds: unassignable.map((h) => h.heroId) }];
      }
    }

    return emptyResult("IMPOSSIBLE_ASSIGNMENT", conflicts);
  }

  const candidates: JointAssignmentCandidate[] = rawCandidates
    .filter((candidate) => candidate.weight > 0)
    .map((candidate) => ({ assignment: candidate.assignment, probability: candidate.weight / totalWeight }))
    .sort((a, b) => b.probability - a.probability);

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
