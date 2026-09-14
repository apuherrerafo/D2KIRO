import type { ControlledSlot, PartyContext, PartySize, TeamSide } from "./types";

// R1 S1 -- Party Context foundation (H0.1: Party All Pick = ranked_all_pick + PartyContext).
// Foundation only: validates shape, never alters protocol rules, never infers roles (that's S4).

const VALID_PARTY_SIZES: ReadonlySet<number> = new Set([1, 2, 3, 5]);

export function isValidPartySize(value: number): value is PartySize {
  return VALID_PARTY_SIZES.has(value);
}

export type PartyContextValidationError =
  | "INVALID_PARTY_SIZE"
  | "TOO_MANY_CONTROLLED_SLOTS"
  | "SLOT_INDEX_OUT_OF_RANGE"
  | "DUPLICATE_SLOT_INDEX"
  | "SLOT_SIDE_MISMATCH";

export interface PartyContextValidationResult {
  context: PartyContext | null;
  error: PartyContextValidationError | null;
}

/**
 * Validates and constructs a PartyContext. Fails closed (context: null, error set) rather than
 * silently coercing an invalid party size (4 is explicitly rejected -- Dota has no 4-stack queue
 * option in ranked All Pick) or an inconsistent controlled-slot list.
 */
export function createPartyContext(
  partySize: number,
  side: TeamSide,
  controlledSlots: ControlledSlot[],
): PartyContextValidationResult {
  if (!isValidPartySize(partySize)) {
    return { context: null, error: "INVALID_PARTY_SIZE" };
  }
  if (controlledSlots.length > partySize) {
    return { context: null, error: "TOO_MANY_CONTROLLED_SLOTS" };
  }
  const seenSlotIndexes = new Set<number>();
  for (const slot of controlledSlots) {
    if (slot.side !== side) {
      return { context: null, error: "SLOT_SIDE_MISMATCH" };
    }
    if (!Number.isInteger(slot.slotIndex) || slot.slotIndex < 0 || slot.slotIndex > 4) {
      return { context: null, error: "SLOT_INDEX_OUT_OF_RANGE" };
    }
    if (seenSlotIndexes.has(slot.slotIndex)) {
      return { context: null, error: "DUPLICATE_SLOT_INDEX" };
    }
    seenSlotIndexes.add(slot.slotIndex);
  }
  return { context: { partySize, side, controlledSlots }, error: null };
}
