import type { AuthoritativeCollisionResolution, DraftProtocolState, ProtocolCommand } from "../types";

// R1 S2.4 -- SIMULATOR collision authority adapter.
//
// The kernel NEVER lets transport/arrival order pick a 3rd+ collision winner (S1, frozen
// contract) -- it pauses in WAITING_FOR_COLLISION_AUTHORITY and waits for a separate,
// out-of-band APPLY_AUTHORITATIVE_COLLISION_RESOLUTION command. In a real Ranked All Pick draft,
// that command would eventually come from an observed authoritative source (a live game-state
// integration -- future work, not this slice). The random-draft-simulator/bot-drafter scenarios
// need to keep running unattended, so THIS module exists to supply one, deterministically, and
// under a name that cannot be mistaken for official Valve arbitration.
//
// Explicitly NOT Valve's real tie-break rule (no such rule is published/verified) -- this is
// PRODUCT_POLICY for simulation only, versioned so a future real-authority adapter can be swapped
// in without silently changing simulator replay history. Mirrors party-context.ts's own
// "foundation only, never invents a magnitude for real state" posture.
//
// This module NEVER touches DraftProtocolState directly. It only ever produces a
// ProtocolCommand -- the caller must still route it through applyProtocolCommand (kernel.ts), the
// one authoritative mutation path (Blocker 1, S1).

export const SIMULATOR_COLLISION_POLICY_VERSION = "simulator-collision-authority/v1";

export interface SimulatorAuthorityResolution {
  policy: typeof SIMULATOR_COLLISION_POLICY_VERSION;
  command: Extract<ProtocolCommand, { type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION" }>;
}

// Small self-contained deterministic PRNG (mulberry32) -- apps/engine cannot import
// apps/web/features/random-draft-simulator/seeded-rng.ts (the two apps are independent
// processes, invariantes.md), so this is a fresh, minimal implementation rather than a shared
// dependency. Not exported: this policy's own determinism is an implementation detail, never a
// general-purpose RNG utility other code should reach for.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToUint32(seed: string): number {
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) acc = (acc + seed.charCodeAt(i) * (i + 1)) >>> 0;
  return acc;
}

/**
 * Deterministic given (seed, sessionId, round, heroId): the same simulator seed replayed against
 * the same collision always produces the same winner, so simulator scripts stay reproducible
 * (SPEC's determinism discipline, same as the rest of this repo's seeded RNG usage). Returns
 * `null` when there is no pending collision to resolve -- callers must check `legalActions`/
 * `availableCommands` anyway before calling this, this is just a defensive no-op rather than a
 * thrown error.
 */
export function resolveSimulatorCollisionAuthority(
  state: DraftProtocolState,
  seed: string,
): SimulatorAuthorityResolution | null {
  const pending = state.rankedAp?.round?.pendingCollision;
  if (!pending) return null;

  const rng = mulberry32(seedToUint32(`${seed}:${state.sessionId}:${pending.round}:${pending.heroId}`));
  const winnerIndex = rng() < 0.5 ? 0 : 1;
  const winner: AuthoritativeCollisionResolution["winner"] = pending.contenders[winnerIndex]!;

  return {
    policy: SIMULATOR_COLLISION_POLICY_VERSION,
    command: {
      type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION",
      round: pending.round,
      heroId: pending.heroId,
      winner,
    },
  };
}
