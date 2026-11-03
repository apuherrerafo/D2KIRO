import type { HeroId, PartyContextInput, TeamSide } from "../draft-protocol";
import type { DotaPosition } from "./ap-simulator-policy";

// AP Ranked Roles V1 -- canonical configuration of a Simulator session, declared by the Player
// BEFORE the draft (side + personal position are mandatory; ban preferences and hero pool are not).

export interface SimulatorSessionConfig {
  side: TeamSide;
  /** Required for every AP V1 session -- identifies which of the five known roles is the Player's own. Never decides pick timing. */
  playerPersonalPosition: DotaPosition;
  /**
   * Own Team has exactly one of each role, known from the queue. This is ROLE identity, not pick
   * chronology: a Pos2 may be picked in Round 1, a Pos5 in Round 3, in any order.
   */
  ownTeamRoleAssignments: Record<DotaPosition, "assigned">;
  simulatorSeed: string;
  /** Up to 4 heroes, index 0 = strongest preference; `null` = empty slot. */
  playerBanPreferences: (HeroId | null)[];
  patch: string;
}

export const MAX_PLAYER_BAN_PREFERENCES = 4;

export function buildOwnTeamRoleAssignments(): Record<DotaPosition, "assigned"> {
  return { 1: "assigned", 2: "assigned", 3: "assigned", 4: "assigned", 5: "assigned" };
}

/** Builds own-team PartyContext. Supports party sizes 1, 2, 3, 5; defaults to partySize 5 (all seats controlled). */
export function buildOwnTeamPartyContext(
  side: TeamSide,
  partySize: 1 | 2 | 3 | 5 = 5,
  controlledSlots?: readonly number[],
): PartyContextInput {
  const slots = controlledSlots ?? (partySize === 5 ? [0, 1, 2, 3, 4] : [0]);
  return {
    partySize,
    side,
    controlledSlots: slots.map((slotIndex) => ({ side, slotIndex, controllerId: `player-${slotIndex}` })),
  };
}

/**
 * True for any Ranked All Pick Simulator session created with a seed, regardless of side or
 * personal position. Replaces the recovery-build guard, which additionally demanded
 * Radiant / Pos2 / roster slot 4.
 */
export function isApSimulatorMetadata(metadata: {
  adapterKind: "manual" | "simulator";
  simulatorSeed: string | null | undefined;
}): boolean {
  return metadata.adapterKind === "simulator" && metadata.simulatorSeed !== null && metadata.simulatorSeed !== undefined;
}
