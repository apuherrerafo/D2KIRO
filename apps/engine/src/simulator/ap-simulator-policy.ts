import type { RankedApPhase, TeamSide } from "../draft-protocol/types";

// AP Ranked Roles V1 -- neutral, pure round/seat utilities for the Ranked All Pick simulator.
//
// This module used to be `solo-mid-policy.ts` and carried a fixed product policy (Radiant, Pos2,
// roster slot 4, a fixed table mapping pick chronology to roles). None of that is
// product truth: in Ranked Roles the five role assignments (Pos1..Pos5) are independent of WHEN a
// hero is picked, and the Player controls all five own-team selections. What remains here is only
// what is genuinely structural:
//   - which round a kernel phase is,
//   - how a round-scoped slot maps to a stable roster seat (0..4) -- a SEAT, never a position,
//   - who controls a seat (the Player controls every seat on their own side; the Enemy Bot every
//     seat on the other).

export type DotaPosition = 1 | 2 | 3 | 4 | 5;

export interface SimulatorParticipant {
  side: TeamSide;
  /** Stable seat identity 0..4 on `side`. Chronological (round 1 -> 0,1; round 2 -> 2,3; round 3 -> 4). NOT a position. */
  rosterSlot: number;
  control: "human" | "external";
}

const PHASE_TO_ROUND: Partial<Record<RankedApPhase, 1 | 2 | 3>> = {
  PICK_ROUND_1: 1,
  PICK_ROUND_2: 2,
  PICK_ROUND_3: 3,
};

export function roundForPhase(phase: RankedApPhase): 1 | 2 | 3 | null {
  return PHASE_TO_ROUND[phase] ?? null;
}

/** Ranked AP round slots are round-scoped; roster seats are stable participant identities. */
export function rosterSlotForRoundSlot(round: 1 | 2 | 3, roundSlot: number): number | null {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  const capacity = round === 3 ? 1 : 2;
  if (!Number.isInteger(roundSlot) || roundSlot < 0 || roundSlot >= capacity) return null;
  return offset + roundSlot;
}

/**
 * Canonical mapping between Dota positions and stable roster seats (0..4) for Ranked Roles All Pick.
 * Round 1: Hard Support (Pos 5, seat 0) and Support (Pos 4, seat 1).
 * Round 2: Offlane (Pos 3, seat 2) and Carry (Pos 1, seat 3).
 * Round 3: Midlane (Pos 2, seat 4).
 */
export const POSITION_FOR_ROSTER_SEAT: Readonly<Record<number, DotaPosition>> = Object.freeze({
  0: 5,
  1: 4,
  2: 3,
  3: 1,
  4: 2,
});

export const ROSTER_SEAT_FOR_POSITION: Readonly<Record<DotaPosition, number>> = Object.freeze({
  5: 0,
  4: 1,
  3: 2,
  1: 3,
  2: 4,
});

export function positionForRosterSeat(rosterSlot: number): DotaPosition | null {
  return POSITION_FOR_ROSTER_SEAT[rosterSlot] ?? null;
}

export function rosterSeatForPosition(position: DotaPosition): number | null {
  return ROSTER_SEAT_FOR_POSITION[position] ?? null;
}

/** The Player controls seats in `controlledSlots` (defaults to all own seats if omitted); other seats are external. */
export function participantForRoundSlot(
  side: TeamSide,
  round: 1 | 2 | 3,
  roundSlot: number,
  humanSide: TeamSide,
  controlledSlots?: readonly number[],
): SimulatorParticipant | null {
  const rosterSlot = rosterSlotForRoundSlot(round, roundSlot);
  if (rosterSlot === null) return null;
  const isHuman = side === humanSide && (controlledSlots === undefined || controlledSlots.includes(rosterSlot));
  return { side, rosterSlot, control: isHuman ? "human" : "external" };
}
