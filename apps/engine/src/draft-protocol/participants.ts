import type { ControlledSlot, PartyContext, TeamSide } from "./types";

// R1 S2.5/S4.4 -- who controls which roster slot on our own side. Structural only: never infers
// a role, never alters protocol transitions (same discipline as party-context.ts, S1's H0.1
// foundation). Built on top of PartyContext (already frozen by S1) rather than replacing it.
//
// "controlled" = a slot this D2KIRO session actually drives picks for (party-context.ts's
// controlledSlots). "external" = a slot on OUR OWN side that a real person controls but this
// session does not -- a teammate outside our party, or (partySize 1) every other slot on our
// side. D2KIRO sees an external participant's pick once it's REVEALED (via project()), but never
// presumes it can choose a position, hero, or action on their behalf.
//
// Enemy-side roster slots are deliberately NOT modeled here at all -- they are not "external
// participants" in this sense, they are simply outside anything we ever have standing to control.

export type ParticipantControl = "controlled" | "external";

export interface ParticipantSlot {
  side: TeamSide;
  /** 0-based roster slot, 0..4. */
  slotIndex: number;
  control: ParticipantControl;
  /** Set only when control === "controlled" -- mirrors ControlledSlot.controllerId. */
  controllerId: string | null;
}

/**
 * Every roster slot on `partyContext.side`, split into controlled vs external. Always returns
 * exactly 5 entries (a full roster side), regardless of `partySize` -- partySize bounds how many
 * of those 5 slots this session is ALLOWED to control (validated at PartyContext construction,
 * party-context.ts), not how many slots exist on the side.
 */
export function deriveOwnSideParticipantSlots(partyContext: PartyContext): ParticipantSlot[] {
  const controlledBySlot = new Map<number, ControlledSlot>();
  for (const slot of partyContext.controlledSlots) controlledBySlot.set(slot.slotIndex, slot);

  const slots: ParticipantSlot[] = [];
  for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
    const controlled = controlledBySlot.get(slotIndex);
    slots.push(
      controlled
        ? { side: partyContext.side, slotIndex, control: "controlled", controllerId: controlled.controllerId }
        : { side: partyContext.side, slotIndex, control: "external", controllerId: null },
    );
  }
  return slots;
}

/** True iff `side`/`slotIndex` is a slot this session's PartyContext actually controls. */
export function isControlledSlot(partyContext: PartyContext | null, side: TeamSide, slotIndex: number): boolean {
  if (!partyContext || partyContext.side !== side) return false;
  return partyContext.controlledSlots.some((slot) => slot.slotIndex === slotIndex);
}
