import type { CoachRoleBelief } from "./coach-client";
import { resolveControlledPositions, type RecommendationPosition } from "./protocol-client";
import type { DraftConfig } from "./types";

export type SimulatorController = "YOU" | "PARTY" | "ALLY BOT";

export const SIMULATOR_POSITIONS: readonly RecommendationPosition[] = [1, 2, 3, 4, 5];

export const SIMULATOR_POSITION_LABELS: Readonly<Record<RecommendationPosition, string>> = Object.freeze({
  1: "Carry",
  2: "Mid",
  3: "Offlane",
  4: "Support",
  5: "Hard Support",
});

/**
 * Chronological seat identity (0..4), used ONLY for the session-summary reconstruction
 * (picksByRoundFromView) -- which round a hero was sealed in, never which POSITION it is. PD-026/
 * PD-027 deleted the fixed chronology<->position table this module used to also export
 * (positionForRoundSlot/rosterSeatForPosition/POSITION_FOR_ROSTER_SEAT/ROSTER_SEAT_FOR_POSITION) --
 * position is now session-layer truth (ProtocolSnapshot.ownAssignedPositions), never derived here.
 */
export function rosterSeatForRoundSlot(round: 1 | 2 | 3, slotIndex: number): number {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  return offset + slotIndex;
}

/**
 * PD-027: an enemy hero's displayed role never comes from pick chronology or the Enemy Bot's
 * private position assignment -- only from the Coach's own probabilistic inference. Mirrors the
 * exact wording CoachPanel's role-belief row already shows (`Pos${n}` when confirmed, otherwise
 * `Likely`/`Possible`), so the Player never sees two different descriptions of the same belief.
 */
export function enemyRoleBeliefLabel(belief: CoachRoleBelief | undefined): string | null {
  if (!belief) return null;
  if (belief.status === "CONFIRMED") return `Pos${belief.positions[0]}`;
  if (belief.positions.length > 1) return `Likely Pos${belief.positions[0]} / Possible Pos${belief.positions[1]}`;
  return `Likely Pos${belief.positions[0]}`;
}

/**
 * PD-026/PD-027 -- the session's Own Team human-controlled positions. Delegates to
 * `resolveControlledPositions` (protocol-client.ts) -- the SAME function `createSimulatorProtocolSession`
 * uses to build the real request -- so this can never silently diverge from what the engine was
 * actually told, the way two independent copies of this fallback previously could.
 */
export function controlledPositionsForConfig(config: DraftConfig): RecommendationPosition[] {
  return resolveControlledPositions(config.partySize, { partyPositions: config.partyPositions, humanPosition: config.playerPosition });
}

export function controllerForPosition(config: DraftConfig, position: RecommendationPosition): SimulatorController {
  if (config.playerPosition === position) return "YOU";
  if (controlledPositionsForConfig(config).includes(position)) return "PARTY";
  return "ALLY BOT";
}
