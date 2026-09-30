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
 * The round slots a human decision covers, derived from HumanActionability instead of zipping
 * positions onto slots. Exactly `roundCapacity` open own slots are taken (lowest slotIndex first --
 * round-scoped slots are interchangeable, the kernel never ties a slot to a player).
 *
 * A slot is tagged with a position ONLY when that tag cannot narrow eligibility: when every eligible
 * position fits this round (`eligible <= capacity`), the tagged set IS the eligible set. When more
 * positions are eligible than the round can hold (Party5 Round 1: 5 eligible, capacity 2), slots
 * stay untagged -- which of the eligible positions a human fills is the human's choice at submit
 * time, never a fixed ascending schedule.
 */
export function humanDecisionSlots(actionability: HumanActionability, openOwnSlots: readonly RecommendationSlot[]): RecommendationSlot[] {
  if (!actionability.hasHumanAction) return [];
  const slots = [...openOwnSlots].sort((a, b) => a.slotIndex - b.slotIndex).slice(0, actionability.roundCapacity);
  const tagPositions = actionability.eligiblePositions.length <= actionability.roundCapacity;
  return slots.map((slot, index) => {
    const position = tagPositions ? actionability.eligiblePositions[index] : undefined;
    return { side: slot.side, slotIndex: slot.slotIndex, ...(position !== undefined ? { position } : {}) };
  });
}
