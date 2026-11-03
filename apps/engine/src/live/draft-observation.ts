import type { HeroId, TeamSide } from "../draft-protocol/types";
import type { DraftEvent } from "../draft/reducer";
import type { LiveObservation } from "./live-capture";

// The one boundary between "what a capture source saw" and "what the draft knows". A source (today the local
// visual capturer) states DraftObservations; the live registry turns them into draft FACTS (live-capture.ts).
// Nothing past this file knows about frames, slots on a screen, portraits or helper health codes: the
// recommendation engine consumes draft facts only.

export type DraftObservationSource = "gsi" | "ocr" | "overwolf" | "manual";
export type DraftObservationKind = "pick" | "ban";
/** `confirmed`: the source vouches the hero is there. `retracted`: the source says it is no longer there. */
export type DraftEvidenceState = "confirmed" | "retracted";

export interface DraftObservation {
  source: DraftObservationSource;
  /** Bans carry no side. */
  side: TeamSide | null;
  /** Screen/roster slot when the source states one; the visual helper does not send it. Never a Dota position. */
  slot: number | null;
  heroId: HeroId;
  kind: DraftObservationKind;
  confidence: number;
  observedAt: string;
  evidenceState: DraftEvidenceState;
}

function sideOf(value: unknown): TeamSide | null {
  return value === "radiant" || value === "dire" ? value : null;
}

/** A pick / ban / revert event of a capture envelope as an observation; null for anything that is not a draft fact. */
export function draftObservationFromEvent(source: DraftObservationSource, event: DraftEvent, confidence: number, observedAt: string): DraftObservation | null {
  const base = { source, slot: null, confidence, observedAt };
  switch (event.type) {
    case "hero_picked":
      return { ...base, side: sideOf(event.side), heroId: event.hero, kind: "pick", evidenceState: "confirmed" };
    case "pick_reverted":
      return { ...base, side: sideOf(event.side), heroId: event.hero, kind: "pick", evidenceState: "retracted" };
    case "hero_banned":
      return { ...base, side: null, heroId: event.hero, kind: "ban", evidenceState: "confirmed" };
    default:
      return null;
  }
}

/** The draft fact an observation states. A side-less pick states nothing the draft can use. */
export function liveObservationFromDraft(observation: DraftObservation): LiveObservation | null {
  const retracted = observation.evidenceState === "retracted";
  if (observation.kind === "ban") return retracted ? { type: "unban", heroId: observation.heroId } : { type: "ban", heroId: observation.heroId };
  if (observation.side === null) return null;
  return retracted
    ? { type: "revert", side: observation.side, heroId: observation.heroId }
    : { type: "pick", side: observation.side, heroId: observation.heroId, position: null };
}
