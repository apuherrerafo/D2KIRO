/* LANDING-01B · the integration point for the Coach character.
   Nothing here draws a character. The page reserves a slot, derives WHAT the Coach is doing from the
   product state (`cue`), and hands both to whatever component is passed as `coach`. When the
   character production work lands, it is `<LandingPage coach={CoachCharacter} />` — no architecture
   change, no edit to any section. Until then the slot is an honest empty reservation. */
"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { PerimeterFrame } from "@/design/round-3a/perimeter-frame";
import type { DraftFrame, FocusSection } from "../product-state/types";

/** What the Coach is doing, bound to product state — never what it says. Mirrors the approved state set. */
export type CoachCueState = "watching" | "analyzing" | "pointing" | "confirming" | "uncertain";

export type CoachPlacement = "hero" | "demo";

/** The full contract a character component receives. Pure data in, pixels out. */
export type CoachCharacterProps = {
  /** Where the guidance points right now (a draft section), or null at rest. */
  anchor: FocusSection | null;
  cue: CoachCueState;
  placement: CoachPlacement;
  /** The page already resolved reduced motion; a character must honour it, not re-detect it. */
  reducedMotion: boolean;
};

export type CoachCharacter = ComponentType<CoachCharacterProps>;

export type CoachCue = { anchor: FocusSection | null; state: CoachCueState };

const REST: CoachCue = { anchor: null, state: "watching" };

/** Product state → Coach cue. Thin evidence is `uncertain` and never points (motion must not invent conviction). */
export function coachCueFor(frame: DraftFrame | null, previous: DraftFrame | null): CoachCue {
  if (!frame) return REST;
  if (frame.basis === "DETERMINISTIC_DEFAULT" || frame.confidence === "low") return { anchor: null, state: "uncertain" };
  if (!previous || previous.id === frame.id) return REST;
  const locked = (draft: DraftFrame) => draft.allies.filter((seat) => seat.locked).length;
  if (locked(frame) > locked(previous)) return { anchor: frame.focus, state: "confirming" };
  return { anchor: frame.focus, state: "pointing" };
}

type CoachSlotContextValue = { character: CoachCharacter | null; cue: CoachCue; reducedMotion: boolean; showPlaceholder: boolean };

const CoachSlotContext = createContext<CoachSlotContextValue>({ character: null, cue: REST, reducedMotion: false, showPlaceholder: false });

export function CoachSlotProvider({ character, children, cue, reducedMotion, showPlaceholder }: CoachSlotContextValue & { children: ReactNode }) {
  return <CoachSlotContext.Provider value={{ character, cue, reducedMotion, showPlaceholder }}>{children}</CoachSlotContext.Provider>;
}

export function useCoachCue() {
  return useContext(CoachSlotContext).cue;
}

/** Re-provides the page's slot with a different cue (the hero's story drives its own Coach while the demo keeps the page cue). */
export function CoachCueScope({ children, cue }: { children: ReactNode; cue: CoachCue }) {
  const parent = useContext(CoachSlotContext);
  return <CoachSlotContext.Provider value={{ ...parent, cue }}>{children}</CoachSlotContext.Provider>;
}

function Placeholder({ cue, placement }: { cue: CoachCue; placement: CoachPlacement }) {
  return (
    <PerimeterFrame className="ld-coach-placeholder" edge={null} label="Coach slot, reserved" rest="corners">
      <span className="ld-coach-placeholder-meta" data-cue={cue.state}>Coach · {placement}</span>
    </PerimeterFrame>
  );
}

function SlotBody({ placement }: { placement: CoachPlacement }) {
  const { character: Character, cue, reducedMotion, showPlaceholder } = useContext(CoachSlotContext);
  if (Character) return <Character anchor={cue.anchor} cue={cue.state} placement={placement} reducedMotion={reducedMotion} />;
  if (showPlaceholder) return <Placeholder cue={cue} placement={placement} />;
  return null;
}

/** Reserved layout box for the character. Renders the injected character, a labelled placeholder, or just the empty box. */
export function CoachSlot({ placement }: { placement: CoachPlacement }) {
  const { character, cue } = useContext(CoachSlotContext);
  return (
    <div className="ld-coach-slot" data-coach-slot={placement} data-cue={cue.state} data-filled={character ? "true" : "false"}>
      <SlotBody placement={placement} />
    </div>
  );
}
