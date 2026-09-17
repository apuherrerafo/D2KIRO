import type { HeroId, RankedApPhase, TeamSide } from "../draft-protocol/types";
import type { Suggestion } from "../signals/mix";

// SIMULATOR POLICY -- this is a product policy for the reduced recovery build, not a Valve
// matchmaking rule. Ranked All Pick still owns its 2+2+1 sealed protocol; this module only maps
// those five protocol submissions to five roster participants and assigns each simulated
// participant a role.
export const SOLO_MID_SIMULATOR_POLICY = Object.freeze({
  humanSide: "radiant" as const,
  humanPosition: 2 as const,
  humanRosterSlot: 4,
  partySize: 1 as const,
  rosterPositions: {
    radiant: [5, 4, 1, 3, 2],
    // The enemy Mid is roster slot 3, so it is revealed after round 2 and before Julio's slot.
    dire: [5, 4, 1, 2, 3],
  } satisfies Record<TeamSide, readonly [5, 4, 1, 2 | 3, 2 | 3]>,
  externalSelection: {
    maxCandidates: 3,
    qualityBandPoints: 5,
  },
});

export type DotaPosition = 1 | 2 | 3 | 4 | 5;

export interface SimulatorParticipant {
  side: TeamSide;
  rosterSlot: number;
  position: DotaPosition;
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

/** Ranked AP round slots are round-scoped; roster slots are stable participant identities. */
export function rosterSlotForRoundSlot(round: 1 | 2 | 3, roundSlot: number): number | null {
  const offset = round === 1 ? 0 : round === 2 ? 2 : 4;
  const capacity = round === 3 ? 1 : 2;
  if (!Number.isInteger(roundSlot) || roundSlot < 0 || roundSlot >= capacity) return null;
  return offset + roundSlot;
}

export function participantForRoundSlot(
  side: TeamSide,
  round: 1 | 2 | 3,
  roundSlot: number,
): SimulatorParticipant | null {
  const rosterSlot = rosterSlotForRoundSlot(round, roundSlot);
  if (rosterSlot === null) return null;
  const position = SOLO_MID_SIMULATOR_POLICY.rosterPositions[side][rosterSlot] as DotaPosition | undefined;
  if (position === undefined) return null;
  const isHuman = side === SOLO_MID_SIMULATOR_POLICY.humanSide
    && rosterSlot === SOLO_MID_SIMULATOR_POLICY.humanRosterSlot;
  return { side, rosterSlot, position, control: isHuman ? "human" : "external" };
}

export function deriveExternalDecisionSeed(
  draftSeed: string,
  participant: Pick<SimulatorParticipant, "side" | "rosterSlot">,
  decisionIndex: number,
): string {
  return `${draftSeed}:${participant.side}:${participant.rosterSlot}:${decisionIndex}`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic Top-K / quality-band selection for simulated participants. A hero more than five
 * score points below the best is never admitted merely to create variety. Within that band we
 * consider at most the top three and select by the participant-specific derived seed.
 */
export function chooseExternalSuggestion(
  suggestions: readonly Suggestion[],
  seed: string,
): Suggestion | null {
  const best = suggestions[0];
  if (!best) return null;
  const { maxCandidates, qualityBandPoints } = SOLO_MID_SIMULATOR_POLICY.externalSelection;
  const band = suggestions
    .filter((suggestion) => best.score - suggestion.score <= qualityBandPoints)
    .slice(0, maxCandidates);
  return band[stableHash(seed) % band.length] ?? best;
}

export function isSoloMidSimulatorMetadata(metadata: {
  adapterKind: "manual" | "simulator";
  localSide: TeamSide;
  humanPosition: DotaPosition | null;
  humanRosterSlot: number | null;
  simulatorSeed: string | null;
}): boolean {
  return metadata.adapterKind === "simulator"
    && metadata.localSide === SOLO_MID_SIMULATOR_POLICY.humanSide
    && metadata.humanPosition === SOLO_MID_SIMULATOR_POLICY.humanPosition
    && metadata.humanRosterSlot === SOLO_MID_SIMULATOR_POLICY.humanRosterSlot
    && metadata.simulatorSeed !== null;
}

export interface ExternalPickRecord {
  side: TeamSide;
  rosterSlot: number;
  position: DotaPosition;
  heroId: HeroId;
}
