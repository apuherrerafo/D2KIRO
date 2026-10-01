import type { Position } from "../draft-protocol/roles/role-belief";
import type { RecommendationSlot } from "./types";

// Product Semantics Recovery WP1 -- HumanActionability: the ONE server-derived projection of "may a
// human act right now, for which positions, and how many picks fit this round".
//
// It keeps two things apart that the recommendation layer used to fuse:
//   - POSITION ELIGIBILITY (`eligiblePositions`): every human-controlled position that has no sealed
//     binding yet. It is never truncated or reordered by the round's pick slots.
//   - ROUND CAPACITY (`roundCapacity`): how many human picks fit in the CURRENT round right now.
//     It limits HOW MANY positions can be filled this round, never WHICH ones.
//
// Position is not pick order: nothing here reads round number, slotIndex or pickOrdinal to decide a
// position. The only inputs are session-layer ownership truth (controlled/open positions, the
// yield flag) and the count of open own-side round slots.

export type NoHumanActionReason = "YIELDED" | "ROUND_COMPLETE" | "DRAFT_COMPLETE";

export interface HumanActionability {
  /** Human-controlled positions still without a sealed binding, ascending. `[]` whenever `hasHumanAction` is false. */
  eligiblePositions: Position[];
  /** Human picks that fit in the current round right now: min(open own round slots, eligible positions); 0 without a human action. */
  roundCapacity: number;
  hasHumanAction: boolean;
  /** Why there is no human action. `null` exactly when `hasHumanAction` is true. */
  noActionReason: NoHumanActionReason | null;
}

export interface DeriveHumanActionabilityInput {
  /** Unbound human-controlled positions (ProtocolSessionStore.humanOpenPositions). */
  humanOpenPositions: readonly Position[];
  /** Own-side round slots open right now (side legality -- may also be the Ally Bot's to fill). */
  openOwnRoundSlots: number;
  /** The human explicitly handed this round's remaining own capacity to the Ally Bot. */
  yieldedCurrentRound: boolean;
  draftComplete: boolean;
}

function noAction(reason: NoHumanActionReason): HumanActionability {
  return { eligiblePositions: [], roundCapacity: 0, hasHumanAction: false, noActionReason: reason };
}

/** Pure: same inputs, same answer. Order of the input positions never matters (the output is sorted). */
export function deriveHumanActionability(input: DeriveHumanActionabilityInput): HumanActionability {
  if (input.draftComplete) return noAction("DRAFT_COMPLETE");
  if (input.yieldedCurrentRound) return noAction("YIELDED");
  const eligiblePositions = [...new Set(input.humanOpenPositions)].sort((a, b) => a - b);
  const roundCapacity = Math.min(Math.max(input.openOwnRoundSlots, 0), eligiblePositions.length);
  if (roundCapacity === 0) return noAction("ROUND_COMPLETE");
  return { eligiblePositions, roundCapacity, hasHumanAction: true, noActionReason: null };
}

/**
 * The eligible positions the round's heroes must jointly cover -- a SET, never a slot -> position
 * map. Defined only when every eligible position fits this round (`eligible === capacity`): then the
 * round's heroes must be assignable onto exactly those positions (any order), which is what keeps a
 * carry-only hero out of a Solo Pos2 round without tying any position to any slot. When more
 * positions are eligible than the round holds (Party5), no hero is excluded by eligibility alone.
 */
export function roundCoveringPositions(actionability: HumanActionability | null | undefined): readonly Position[] | undefined {
  if (!actionability || !actionability.hasHumanAction) return undefined;
  return actionability.eligiblePositions.length === actionability.roundCapacity ? actionability.eligiblePositions : undefined;
}

/**
 * The round slots a human decision covers, derived from HumanActionability instead of zipping
 * positions onto slots. Exactly `roundCapacity` open own slots are taken (lowest slotIndex first --
 * round-scoped slots are interchangeable, the kernel never ties a slot to a player).
 *
 * PD-001: POSITION != PICK ORDER != ROUND SLOT != CONTROLLER. A normal human round slot is ALWAYS
 * positionless -- Solo, Party2, Party3 and Party5 alike, whether or not every eligible position
 * happens to fit the round. Which eligible position a human fills with which hero is decided only
 * when the human submits `hero + assignedPosition`; never by a slotIndex -> position schedule.
 * Eligibility lives exclusively in `HumanActionability.eligiblePositions`.
 */
export function humanDecisionSlots(actionability: HumanActionability, openOwnSlots: readonly RecommendationSlot[]): RecommendationSlot[] {
  if (!actionability.hasHumanAction) return [];
  return [...openOwnSlots]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .slice(0, actionability.roundCapacity)
    .map((slot) => ({ side: slot.side, slotIndex: slot.slotIndex }));
}
