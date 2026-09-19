import type { TeamSide } from "../draft-protocol/types";
import type { DotaPosition } from "./ap-simulator-policy";
import { stableHash } from "./enemy-bot-utils";

// AP Ranked Roles V1 -- the Enemy Bot INTERNAL role assignment, kept in its own dependency-free
// module: it is a pure function of (seed, side). Simulator Truth: never sent to the Player or Coach.
// (Split out of enemy-bot.ts unchanged so tooling can recompute it without loading the kernel.)

export interface EnemyBotConfig {
  side: TeamSide;
  /** rosterSlot (0..4) -> assigned position. A permutation of 1..5, derived from the seed. NEVER exposed to the Coach. */
  internalPositionAssignments: Record<number, DotaPosition>;
  seed: string;
}

const POSITIONS: readonly DotaPosition[] = [1, 2, 3, 4, 5];

/** Small deterministic PRNG (mulberry32) seeded from a string via the shared stable hash. */
function seededRandom(seed: string): () => number {
  let state = stableHash(seed) | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic role assignment for the five enemy seats: same seed + side -> same permutation,
 * different seeds -> different permutations. The seat a role lands on has nothing to do with the
 * chronology of picks -- a Pos1 can sit in round 1 or round 3.
 */
export function deriveInternalPositionAssignments(seed: string, side: TeamSide): Record<number, DotaPosition> {
  const random = seededRandom(`${seed}:enemy-roles:${side}`);
  const positions = [...POSITIONS];
  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [positions[index], positions[swap]] = [positions[swap]!, positions[index]!];
  }
  const assignments: Record<number, DotaPosition> = {};
  positions.forEach((position, rosterSlot) => {
    assignments[rosterSlot] = position;
  });
  return assignments;
}

export function createEnemyBotConfig(seed: string, side: TeamSide): EnemyBotConfig {
  return { side, seed, internalPositionAssignments: deriveInternalPositionAssignments(seed, side) };
}
