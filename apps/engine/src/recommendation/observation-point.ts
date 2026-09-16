import { applyProtocolCommand, legalGameplayActions } from "../draft-protocol";
import type { DraftProtocolState, GameplayLegalAction, ProtocolCommand, TeamSide } from "../draft-protocol/types";
import type { RecommendationAction } from "./types";

// R1 S6 -- ONE-PLY DEFINITION, steps 1-4: hypothetically apply OUR OWN candidate action(s) through
// the SAME ProtocolKernel (never a second reducer, never a mutation of the real session -- every
// helper below is pure and returns a NEW state; `applyProtocolCommand` already never mutates its
// input), then locate the next point where the OPPONENT has a legal, hero-targeting action within
// this single ply. "Hero-targeting" deliberately excludes CM_BAN_SKIPPED: a captain being forced
// to skip a ban (no hero involved) is not a response this module models -- see OnePlyStatus's own
// NO_LEGAL_RESPONSE doc in types.ts.
//
// This never simulates further than one opponent decision point. If reaching it would require
// guessing what a SECOND own action might be (e.g. CM steps 1-2 share the same relative actor), or
// what the opponent's hidden information already contains, this module stops and reports why --
// it never invents a state nothing in the protocol actually reaches.

export function opponentSideOf(actor: TeamSide): TeamSide {
  return actor === "radiant" ? "dire" : "radiant";
}

export type OwnActionSimulationResult = { ok: true; state: DraftProtocolState } | { ok: false; reason: string };

/** Builds the exact ProtocolCommand(s) that replay `actions` for `actor` against `state`, using
 * the kernel's OWN legal-action oracle to resolve Captain's Mode's relative actor/kind (never a
 * second, independently-derived copy of `resolveAbsoluteSide`) -- mirrors decision.ts's own
 * `deriveCaptainsMode` lookup exactly. */
function buildOwnCommands(
  state: DraftProtocolState,
  actor: TeamSide,
  actions: readonly RecommendationAction[],
): ProtocolCommand[] | null {
  if (actions.length === 0) return null;

  if (state.rankedAp) {
    return actions.map((action) => ({
      type: "SUBMIT_SEALED_SELECTION" as const,
      side: actor,
      slotIndex: action.slot.slotIndex,
      heroId: action.hero,
    }));
  }

  if (state.captainsMode) {
    if (actions.length !== 1) return null; // CM never has a compound decision (S5's own decision.ts)
    const cmAction = legalGameplayActions(state).find(
      (candidate): candidate is Extract<GameplayLegalAction, { type: "CM_ACTION" }> =>
        candidate.type === "CM_ACTION" && candidate.absoluteSide === actor,
    );
    if (!cmAction) return null;
    return [{ type: "CM_ACTION", actor: cmAction.actor, kind: cmAction.kind, heroId: actions[0]!.hero }];
  }

  return null;
}

/** Applies `actions` (already a validated, legal S5 Recommendation for `actor`) to `state`,
 * sequentially, never mutating `state` itself. A rejection here is structurally unreachable in
 * practice (build.ts already postValidated this exact action against this exact state), but is
 * still surfaced explicitly rather than allowed to throw -- fail-closed, matching every other
 * kernel-facing module in this codebase. */
export function applyOwnCandidateAction(
  state: DraftProtocolState,
  actor: TeamSide,
  actions: readonly RecommendationAction[],
): OwnActionSimulationResult {
  const commands = buildOwnCommands(state, actor, actions);
  if (!commands) return { ok: false, reason: "no_own_command_derivable" };

  let working = state;
  for (const command of commands) {
    const result = applyProtocolCommand(working, command);
    if (result.rejected) return { ok: false, reason: result.rejected };
    working = result.state;
  }
  return { ok: true, state: working };
}

export type ObservationPointStatus = "READY" | "NO_LEGAL_RESPONSE" | "COLLISION_PENDING" | "DRAFT_COMPLETE";

/** Discriminated union (not a flat `state: X | null`) so a `status !== "READY"` check narrows
 * `state` to non-null on the READY branch automatically -- no caller-side assertion needed. */
export type ObservationPoint =
  | { status: "READY"; state: DraftProtocolState; opponentSide: TeamSide }
  | { status: "NO_LEGAL_RESPONSE" | "COLLISION_PENDING" | "DRAFT_COMPLETE"; state: null; opponentSide: TeamSide };

function opponentHasHeroTargetingAction(actions: readonly GameplayLegalAction[], opponentSide: TeamSide): boolean {
  return actions.some((action) => {
    if (action.type === "SUBMIT_SEALED_SELECTION") return action.side === opponentSide;
    if (action.type === "CM_BAN_SKIPPED") return false; // no hero involved -- never a response candidate
    return action.absoluteSide === opponentSide; // CM_ACTION | CM_AUTO_PICK
  });
}

/**
 * COUNTERFACTUAL OBSERVATION POINT -- the one place S6 decides whether a plausible opponent
 * response can even be asked for. `stateAfter` MUST already be the result of
 * `applyOwnCandidateAction`; this function never re-simulates anything itself, it only classifies
 * the state it is handed.
 */
export function locateOpponentObservationPoint(stateAfter: DraftProtocolState, opponentSide: TeamSide): ObservationPoint {
  if (stateAfter.status === "WAITING_FOR_COLLISION_AUTHORITY") {
    return { status: "COLLISION_PENDING", state: null, opponentSide };
  }
  if (stateAfter.status === "COMPLETE") {
    return { status: "DRAFT_COMPLETE", state: null, opponentSide };
  }
  const actions = legalGameplayActions(stateAfter);
  if (!opponentHasHeroTargetingAction(actions, opponentSide)) {
    return { status: "NO_LEGAL_RESPONSE", state: null, opponentSide };
  }
  return { status: "READY", state: stateAfter, opponentSide };
}
