import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroPositions } from "../signals/hero-positions";

// Live Party5 position resolution -- which of OUR positions each own live pick fills.
//
// Live sources (GSI, the visual capturer) report our heroes WITHOUT a position. This resolver binds a hero to a
// position ONLY when something said whose hero it is (docs/agents/live-contract.md, truths 1-3):
//
//   EXPLICIT      a source stated the position of that hero (never overwritten by anything below)
//   LOCAL_PLAYER  the Player declared "I am Pos N" and GSI says the Player's own hero is X: X is Pos N
//   UNRESOLVED    nobody said who plays it -- the position is NOT known, however few remain
//
// Pools, curated role credibility, popularity and "only one position is left" are NEVER identity. A saved
// Party5 pool says which heroes a player CAN play, not who picked this one; role data says where a hero is
// usually played, not where THIS pick will be. Unknown beats an inferred identity.
//
// What inference may still do is a SET constraint that is logically forced: with Pos 1/2/5 stated, two heroes of
// unknown identity occupy {3, 4} between them -- `possiblePositions` says so, `position` stays null for both.
// Pure: same evidence -> same resolution.

export type LivePositionProvenance = "EXPLICIT" | "LOCAL_PLAYER" | "UNRESOLVED";

export interface LiveOwnPickEvidence {
  heroId: HeroId;
  /** Position a source stated for this pick; null when the game did not say (GSI and visual never do). */
  explicitPosition: Position | null;
}

/** The Player's own seat: the position they declared and the hero GSI says is theirs (either may still be unknown). */
export interface LiveLocalPlayerEvidence {
  position: Position | null;
  heroId: HeroId | null;
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
  /** Absent/null: the Player has not declared a seat or GSI has not named their hero -- nothing is bound. */
  localPlayer?: LiveLocalPlayerEvidence | null;
  /**
   * Accepted and deliberately IGNORED: a pool is a set of candidates, never proof of who picked a hero
   * (live-contract.md truth 1). They stay in the type so a caller (or a test) that still hands them over visibly
   * gets no binding out of them.
   */
  playerPoolsByPosition?: Partial<Record<Position, readonly HeroId[]>> | null;
  /** Accepted and deliberately IGNORED, same reason: where a hero is usually played is not where this pick sits. */
  heroPositions?: HeroPositions;
}

const ALL_POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

export const EMPTY_LIVE_POSITION_RESOLUTION: LiveOwnPositionResolution = Object.freeze({ heroes: [], necessarilyOccupied: [], possiblyOccupied: [] }) as LiveOwnPositionResolution;

/** Every injective assignment of `count` heroes onto `free` (at most 5! = 120 leaves). */
function feasibleAssignments(count: number, free: readonly Position[]): Position[][] {
  const solutions: Position[][] = [];
  const current: Position[] = [];
  const used = new Set<Position>();
  function search(index: number): void {
    if (index === count) {
      solutions.push([...current]);
      return;
    }
    for (const position of free) {
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
  const bound = new Set<Position>();
  picks.forEach((pick, index) => {
    if (pick.explicitPosition !== null && !bound.has(pick.explicitPosition)) {
      explicit.set(index, pick.explicitPosition);
      bound.add(pick.explicitPosition);
    }
  });

  // 2. The Player's own seat: declared position + GSI's hero. A stated position (a source's word about THAT hero, or
  //    about that seat) is never overridden, so a clash leaves the local hero unresolved instead of double-binding.
  const local = new Map<number, Position>();
  const localPlayer = input.localPlayer;
  if (localPlayer && localPlayer.position !== null && localPlayer.heroId !== null && !bound.has(localPlayer.position)) {
    const index = picks.findIndex((pick) => pick.heroId === localPlayer.heroId);
    if (index >= 0 && !explicit.has(index)) {
      local.set(index, localPlayer.position);
      bound.add(localPlayer.position);
    }
  }

  // 3. Everyone else: the only constraint is the SET of positions still free -- no pool, no role data.
  const free = ALL_POSITIONS.filter((position) => !bound.has(position));
  const unresolvedIndexes = picks.map((_, index) => index).filter((index) => !explicit.has(index) && !local.has(index));
  const solutions = feasibleAssignments(unresolvedIndexes.length, free);
  const possibleByIndex = new Map<number, Position[]>();
  unresolvedIndexes.forEach((index, slot) => {
    const possible = new Set(solutions.map((solution) => solution[slot]!));
    possibleByIndex.set(index, [...possible].sort((a, b) => a - b));
  });

  const heroes: LiveResolvedOwnHero[] = picks.map((pick, index) => {
    const stated = explicit.get(index);
    if (stated !== undefined) return { heroId: pick.heroId, position: stated, provenance: "EXPLICIT", possiblePositions: [stated] };
    const declared = local.get(index);
    if (declared !== undefined) return { heroId: pick.heroId, position: declared, provenance: "LOCAL_PLAYER", possiblePositions: [declared] };
    // Even when a single position is left, nothing says THIS hero plays it: a set constraint, not an identity.
    return { heroId: pick.heroId, position: null, provenance: "UNRESOLVED", possiblePositions: possibleByIndex.get(index) ?? [] };
  });

  // 4. Occupancy: what every feasible assignment agrees on, and what only some of them use.
  const occupiedSets = solutions.length > 0
    ? solutions.map((solution) => new Set<Position>([...bound, ...solution]))
    : [new Set<Position>(bound)];
  const necessarilyOccupied = ALL_POSITIONS.filter((position) => occupiedSets.every((set) => set.has(position)));
  const possiblyOccupied = ALL_POSITIONS.filter((position) => !necessarilyOccupied.includes(position) && occupiedSets.some((set) => set.has(position)));
  return { heroes, necessarilyOccupied, possiblyOccupied };
}
