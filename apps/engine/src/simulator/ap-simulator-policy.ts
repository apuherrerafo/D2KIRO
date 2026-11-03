import type { RankedApPhase } from "../draft-protocol/types";

// AP Ranked Roles V1 -- neutral, pure round/seat utilities for the Ranked All Pick simulator.
//
// This module used to be `solo-mid-policy.ts` and carried a fixed product policy (Radiant, Pos2,
// roster slot 4, a fixed table mapping pick chronology to roles). None of that is
// product truth: in Ranked Roles the five role assignments (Pos1..Pos5) are independent of WHEN a
// hero is picked, and the Player controls all five own-team selections.
//
// PD-026/PD-027 (governance): the fixed chronology<->position table this module used to export
// (`POSITION_FOR_ROSTER_SEAT`/`ROSTER_SEAT_FOR_POSITION`/`positionForRosterSeat`/
// `rosterSeatForPosition`) is deleted. Position != pick chronology: humans choose freely among
// their controlled positions (see ProtocolSessionMetadata.controlledPositions,
// server/protocol-session.ts), and the Ally Bot fills its complement positions in a seed-derived
// order (simulator/ally-bot-roles.ts), never a round/seat-derived one. What remains here is only
// what is genuinely structural and position-agnostic:
//   - which round a kernel phase is,
//   - how a round-scoped slot maps to a stable roster seat (0..4) -- a pickOrdinal-style SEAT
//     identity, used only for timer/gold-penalty bookkeeping, never a position.

export type DotaPosition = 1 | 2 | 3 | 4 | 5;

const PHASE_TO_ROUND: Partial<Record<RankedApPhase, 1 | 2 | 3>> = {
  PICK_ROUND_1: 1,
  PICK_ROUND_2: 2,
  PICK_ROUND_3: 3,
};

export function roundForPhase(phase: RankedApPhase): 1 | 2 | 3 | null {
  return PHASE_TO_ROUND[phase] ?? null;
}

/** Ranked AP round slots are round-scoped; roster seats are stable, chronological (pickOrdinal) identities. NOT a position. */
export function rosterSlotForRoundSlot(round: 1 | 2 | 3, roundSlot: number): number | null {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  const capacity = round === 3 ? 1 : 2;
  if (!Number.isInteger(roundSlot) || roundSlot < 0 || roundSlot >= capacity) return null;
  return offset + roundSlot;
}
