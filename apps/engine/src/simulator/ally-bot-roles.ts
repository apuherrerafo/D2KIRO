import type { TeamSide } from "../draft-protocol/types";
import type { DotaPosition } from "./ap-simulator-policy";
import { stableHash } from "./enemy-bot-utils";

// AP Ranked Roles V1 -- Ally Bot position fill ORDER. Mirrors enemy-bot-roles.ts's deterministic
// permutation exactly (same mulberry32-via-stableHash algorithm), with a separate "ally-roles"
// namespace so the same (seed, side) produces a completely independent stream from Enemy Bot's
// internal role assignment (enemy-bot-roles.ts's `:enemy-roles:` namespace is untouched -- Enemy
// Bot's existing replay seeds/values are unaffected).
//
// PD-026/PD-027: Ally Bot positions are never hidden truth (unlike Enemy Bot's) -- they are the
// complement of the session's `controlledPositions`, already visible to the Player as "who my
// allies are." What must still be deterministic is the ORDER in which the bot fills its own
// uncontrolled positions across rounds: a position can be filled in round 1 or round 3 depending
// on which round still has capacity when the bot's turn to act comes up, so this order must be
// fixed up front and never re-derived from roster seat, round, roundSlot or pickOrdinal.

const ALL_POSITIONS: readonly DotaPosition[] = [1, 2, 3, 4, 5];

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
 * Deterministic fill order for the Ally Bot's own uncontrolled positions: same seed + side ->
 * same order, different seeds -> different orders. Derived by permuting all five positions under
 * the `ally-roles` namespace and filtering down to `allyPositions`, preserving their relative
 * order in the permutation -- so adding/removing a controlled position never reshuffles the
 * relative order of the remaining ally positions.
 */
export function deriveAllyPositionOrder(seed: string, side: TeamSide, allyPositions: readonly DotaPosition[]): DotaPosition[] {
  const random = seededRandom(`${seed}:ally-roles:${side}`);
  const positions = [...ALL_POSITIONS];
  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [positions[index], positions[swap]] = [positions[swap]!, positions[index]!];
  }
  const allowed = new Set(allyPositions);
  return positions.filter((position) => allowed.has(position));
}
