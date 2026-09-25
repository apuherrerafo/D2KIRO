import { POSITION_FOR_ROSTER_SEAT, ROSTER_SEAT_FOR_POSITION, type RecommendationPosition } from "./protocol-client";
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

export function rosterSeatForRoundSlot(round: 1 | 2 | 3, slotIndex: number): number {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  return offset + slotIndex;
}

export function roundSlotForRosterSeat(round: 1 | 2 | 3, rosterSeat: number): number {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  return rosterSeat - offset;
}

export function positionForRoundSlot(round: 1 | 2 | 3, slotIndex: number): RecommendationPosition {
  return POSITION_FOR_ROSTER_SEAT[rosterSeatForRoundSlot(round, slotIndex)]!;
}

export function rosterSeatForPosition(position: RecommendationPosition): number {
  return ROSTER_SEAT_FOR_POSITION[position];
}

export function controllerForPosition(config: DraftConfig, position: RecommendationPosition): SimulatorController {
  if (config.playerPosition === position) return "YOU";
  const controlledPositions = config.partySize === 5
    ? SIMULATOR_POSITIONS
    : (config.partyPositions ?? [config.playerPosition]);
  if (controlledPositions.includes(position)) return "PARTY";
  return "ALLY BOT";
}
