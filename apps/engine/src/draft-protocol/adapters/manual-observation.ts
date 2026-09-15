import { applyProtocolCommand, legalActions } from "../kernel";
import type {
  CmActionKind,
  DraftProtocolState,
  HeroId,
  KernelResult,
  OpenSlot,
  ProtocolCommand,
  TeamSide,
} from "../types";

// Thin adapter for facts observed from a manual/live source. It deliberately does not derive CM
// turn order or actor identity: those come from legalActions(state), and every translated fact is
// still accepted or rejected by applyProtocolCommand.
export type ManualProtocolObservation =
  | { type: "AP_BANS_OBSERVED"; heroIds: HeroId[] }
  | { type: "AP_BAN_RESOLUTION_OBSERVED" }
  | { type: "AP_SEALED_SELECTION_OBSERVED"; side: TeamSide; slotIndex: number; heroId: HeroId }
  | { type: "AP_COLLISION_RESOLUTION_OBSERVED"; round: 1 | 2 | 3; heroId: HeroId; winner: OpenSlot }
  | { type: "CM_FIRST_PICK_SIDE_OBSERVED"; side: TeamSide }
  | { type: "CM_HERO_ACTION_OBSERVED"; side: TeamSide; kind: CmActionKind; heroId: HeroId };
// R1 S3 (final trust-boundary repair): there is deliberately NO "CM_ELIGIBILITY_OBSERVED" here.
// An eligibility snapshot is not a fact anyone observes in a draft -- it is an artifact that
// defines which heroes the kernel will certify at all. Letting an adapter "observe" one would
// hand any future caller of this module (a live capturer, an ingest route) the power to promote
// its own snapshot to trusted, which is precisely the hole this repair closed on the HTTP side.
// The one supported path is ProtocolSessionStore.loadTrustedEligibility (server/operator side).

export function commandFromManualObservation(
  state: DraftProtocolState,
  observation: ManualProtocolObservation,
): ProtocolCommand | null {
  switch (observation.type) {
    case "AP_BANS_OBSERVED":
      return { type: "RECORD_RESOLVED_BANS", heroes: observation.heroIds };
    case "AP_BAN_RESOLUTION_OBSERVED":
      return { type: "BAN_RESOLUTION_COMPLETE" };
    case "AP_SEALED_SELECTION_OBSERVED":
      return { type: "SUBMIT_SEALED_SELECTION", side: observation.side, slotIndex: observation.slotIndex, heroId: observation.heroId };
    case "AP_COLLISION_RESOLUTION_OBSERVED":
      return { type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION", round: observation.round, heroId: observation.heroId, winner: observation.winner };
    case "CM_FIRST_PICK_SIDE_OBSERVED":
      return { type: "CONFIRM_FIRST_PICK_SIDE", side: observation.side };
    case "CM_HERO_ACTION_OBSERVED": {
      const action = legalActions(state).find(
        (candidate) => candidate.type === "CM_ACTION"
          && candidate.absoluteSide === observation.side
          && candidate.kind === observation.kind,
      );
      if (!action || action.type !== "CM_ACTION") return null;
      return { type: "CM_ACTION", actor: action.actor, kind: action.kind, heroId: observation.heroId };
    }
  }
}

export function applyManualObservation(
  state: DraftProtocolState,
  observation: ManualProtocolObservation,
): KernelResult | null {
  const command = commandFromManualObservation(state, observation);
  return command ? applyProtocolCommand(state, command) : null;
}
