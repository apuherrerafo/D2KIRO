import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { isCredibleForPosition, type HeroPositions } from "../signals/hero-positions";

// Live Party5 position resolution -- which of OUR positions each own live pick fills.
//
// Live sources (GSI, the visual capturer) report our heroes WITHOUT a position. Leaving them unbound kept every
// column open forever; guessing from "the hero's most popular role" would invent facts. This resolver only binds
// what the evidence forces, in this order:
//
//   EXPLICIT         a source stated the position (never overwritten by anything below)
//   UNIQUE_POOL      the hero is in exactly ONE saved Party5 position pool, and the joint solution agrees
//   JOINT_INFERENCE  every feasible injective assignment of our heroes onto our positions puts it at the same
//                    position (remaining pools + curated role credibility, `isCredibleForPosition`)
//   UNRESOLVED       more than one position is still feasible -- the role is NOT pretended to be known
//
// "Feasible" is a constraint, not a score: a hero's domain is its pool positions, else the positions it is credibly
// played at, else any free position. No share is ever compared with another (no argmax over popularity). When the
// pool evidence admits no assignment at all (two heroes that only one pool lists), the domains relax one tier at a
// time instead of failing. Pure: same facts + pools + positions -> same resolution.

export type LivePositionProvenance = "EXPLICIT" | "UNIQUE_POOL" | "JOINT_INFERENCE" | "UNRESOLVED";

export interface LiveOwnPickEvidence {
  heroId: HeroId;
  /** Position a source stated for this pick; null when the game did not say (GSI and visual never do). */
  explicitPosition: Position | null;
}

export interface LiveResolvedOwnHero {
  heroId: HeroId;
  /** Bound position; null exactly when `provenance` is UNRESOLVED. */
  position: Position | null;
  provenance: LivePositionProvenance;
  /** Positions this hero takes in at least one feasible assignment (a single one when bound). */
  possiblePositions: Position[];
}

export interface LiveOwnPositionResolution {
  /** In the order the picks were given. */
  heroes: LiveResolvedOwnHero[];
  /** Occupied in EVERY feasible assignment -- includes every bound position. Never recommendable. */
  necessarilyOccupied: Position[];
  /** Occupied in some feasible assignment but not all: an own hero of unconfirmed role may be sitting there. */
  possiblyOccupied: Position[];
}

export interface ResolveLiveOwnPositionsInput {
  ownPicks: readonly LiveOwnPickEvidence[];
  playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> | null | undefined;
  heroPositions: HeroPositions;
}

const ALL_POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

export const EMPTY_LIVE_POSITION_RESOLUTION: LiveOwnPositionResolution = Object.freeze({ heroes: [], necessarilyOccupied: [], possiblyOccupied: [] }) as LiveOwnPositionResolution;

function poolPositionsOf(heroId: HeroId, pools: ResolveLiveOwnPositionsInput["playerPoolsByPosition"]): Position[] {
  if (!pools) return [];
  return ALL_POSITIONS.filter((position) => pools[position]?.includes(heroId) === true);
}

function crediblePositionsOf(heroId: HeroId, heroPositions: HeroPositions): Position[] {
  return ALL_POSITIONS.filter((position) => isCredibleForPosition(heroId, position, heroPositions));
}

function within(positions: readonly Position[], free: ReadonlySet<Position>): Position[] {
  return positions.filter((position) => free.has(position));
}

/** Every injective assignment heroes[i] -> domains[i] (at most 5! = 120 leaves). */
function feasibleAssignments(domains: readonly Position[][]): Position[][] {
  const solutions: Position[][] = [];
  const current: Position[] = [];
  const used = new Set<Position>();
  function search(index: number): void {
    if (index === domains.length) {
      solutions.push([...current]);
      return;
    }
    for (const position of domains[index]!) {
      if (used.has(position)) continue;
      used.add(position);
      current.push(position);
      search(index + 1);
      current.pop();
      used.delete(position);
    }
  }
  search(0);
  return solutions;
}

export function resolveLiveOwnPositions(input: ResolveLiveOwnPositionsInput): LiveOwnPositionResolution {
  const picks = input.ownPicks.slice(0, ALL_POSITIONS.length);
  if (picks.length === 0) return { heroes: [], necessarilyOccupied: [], possiblyOccupied: [] };

  // 1. Explicit positions are facts: the first statement of a position wins, a repeat of it is plain evidence.
  const explicit = new Map<number, Position>();
  const explicitTaken = new Set<Position>();
  picks.forEach((pick, index) => {
    if (pick.explicitPosition !== null && !explicitTaken.has(pick.explicitPosition)) {
      explicit.set(index, pick.explicitPosition);
      explicitTaken.add(pick.explicitPosition);
    }
  });
  const free = new Set(ALL_POSITIONS.filter((position) => !explicitTaken.has(position)));
  const inferredIndexes = picks.map((_, index) => index).filter((index) => !explicit.has(index));
  const freeList = [...free];

  // 2. Joint assignment over the remaining heroes, relaxing the evidence one tier at a time.
  const tiers: ((heroId: HeroId) => Position[])[] = [
    (heroId) => {
      const pool = within(poolPositionsOf(heroId, input.playerPoolsByPosition), free);
      if (pool.length > 0) return pool;
      const credible = within(crediblePositionsOf(heroId, input.heroPositions), free);
      return credible.length > 0 ? credible : freeList;
    },
    (heroId) => {
      const either = within([...new Set([...poolPositionsOf(heroId, input.playerPoolsByPosition), ...crediblePositionsOf(heroId, input.heroPositions)])], free);
      return either.length > 0 ? either : freeList;
    },
    () => freeList,
  ];
  let solutions: Position[][] = [];
  let tier = 0;
  for (; tier < tiers.length; tier += 1) {
    solutions = feasibleAssignments(inferredIndexes.map((index) => tiers[tier]!(picks[index]!.heroId)));
    if (solutions.length > 0) break;
  }

  const possibleByIndex = new Map<number, Set<Position>>();
  inferredIndexes.forEach((index, slot) => possibleByIndex.set(index, new Set(solutions.map((solution) => solution[slot]!))));

  const heroes: LiveResolvedOwnHero[] = picks.map((pick, index) => {
    const stated = explicit.get(index);
    if (stated !== undefined) return { heroId: pick.heroId, position: stated, provenance: "EXPLICIT", possiblePositions: [stated] };
    const possible = [...(possibleByIndex.get(index) ?? new Set<Position>())].sort((a, b) => a - b);
    if (possible.length !== 1) return { heroId: pick.heroId, position: null, provenance: "UNRESOLVED", possiblePositions: possible };
    const position = possible[0]!;
    const pool = poolPositionsOf(pick.heroId, input.playerPoolsByPosition);
    const uniquePool = tier === 0 && pool.length === 1 && pool[0] === position;
    return { heroId: pick.heroId, position, provenance: uniquePool ? "UNIQUE_POOL" : "JOINT_INFERENCE", possiblePositions: [position] };
  });

  // 3. Occupancy: what every feasible assignment agrees on, and what only some of them use.
  const occupiedSets = solutions.length > 0
    ? solutions.map((solution) => new Set<Position>([...explicitTaken, ...solution]))
    : [new Set<Position>(explicitTaken)];
  const necessarilyOccupied = ALL_POSITIONS.filter((position) => occupiedSets.every((set) => set.has(position)));
  const possiblyOccupied = ALL_POSITIONS.filter((position) => !necessarilyOccupied.includes(position) && occupiedSets.some((set) => set.has(position)));
  return { heroes, necessarilyOccupied, possiblyOccupied };
}
