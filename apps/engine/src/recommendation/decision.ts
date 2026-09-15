import { captainsModeStepDefinition, legalGameplayActions } from "../draft-protocol";
import type { DraftProtocolState, HeroId, TeamSide } from "../draft-protocol/types";
import type { RecommendationDecision, RecommendationDegradation, RecommendationSlot } from "./types";

// R1 S5 -- LEGAL ACTION FIRST. This module derives WHAT is being decided (decision.ts) and WHICH
// heroes are legally nameable right now (the "hero universe"), from `legalGameplayActions(state)`
// alone -- never from V6's own candidate pool. That distinction matters concretely for Captain's
// Mode: V6 has no concept of a certified CM hero universe (it ranks over the global hero catalog),
// so intersecting its output against the kernel's own `eligibleHeroIds` is the only way a
// recommendation can never name a hero the kernel would reject. Ranked All Pick has no such
// catalog in the kernel (rulesets/ranked-all-pick.ts's own doc: no eligibility mechanism was ever
// built for it) -- there, `null` (unrestricted) is the honest answer, and V6's own
// banned/picked-aware candidate pool plus build.ts's post-validation are what keep it legal.
//
// `RecommendationSlot.slotIndex` is DELIBERATELY not a roster position (0..4): Ranked All Pick's
// `OpenSlot.slotIndex` is a round-scoped ordinal (which of the N simultaneous sealed submissions
// this side owns this round), not tied to any specific player by the kernel (see
// draft-protocol/types.ts's own OpenSlot doc) -- there is no real mapping to invent here. Captain's
// Mode has exactly one decision "slot" per legal step, so its step number stands in for a slot
// identifier; it is not a roster position either.

export interface LegalDecision {
  decision: RecommendationDecision;
  /** null = unrestricted hero universe (Ranked All Pick). Non-null = the exact certified set
   * (Captain's Mode) -- intersect against this, never against V6's own candidate pool. */
  eligibleHeroIds: readonly HeroId[] | null;
  degradations: RecommendationDegradation[];
}

function emptyDecision(actor: TeamSide, phase: string | null): RecommendationDecision {
  return { actor, actionKind: null, phase, round: null, step: null, controlledSlots: [], actionCount: 0 };
}

function deriveRankedAllPick(state: DraftProtocolState, actor: TeamSide): LegalDecision {
  const rankedAp = state.rankedAp!;
  const degradations: RecommendationDegradation[] = [];
  if (state.degradation) degradations.push({ reason: state.degradation.reason, detail: state.degradation.detail });

  const openSlotsForActor = legalGameplayActions(state).filter(
    (action): action is Extract<typeof action, { type: "SUBMIT_SEALED_SELECTION" }> =>
      action.type === "SUBMIT_SEALED_SELECTION" && action.side === actor,
  );
  const controlledSlots: RecommendationSlot[] = openSlotsForActor.map((slot) => ({ side: slot.side, slotIndex: slot.slotIndex }));

  if (controlledSlots.length === 0 && state.status !== "COMPLETE") {
    degradations.push({
      reason: "NO_ACTION_FOR_ACTOR",
      detail: `no hay slot sellado abierto para ${actor} en este momento (phase ${rankedAp.phase}, status ${state.status})`,
    });
  }

  return {
    decision: {
      actor,
      actionKind: controlledSlots.length > 0 ? "PICK" : null,
      phase: rankedAp.phase,
      round: rankedAp.round?.round ?? null,
      step: null,
      controlledSlots,
      actionCount: controlledSlots.length,
    },
    eligibleHeroIds: null,
    degradations,
  };
}

function deriveCaptainsMode(state: DraftProtocolState, actor: TeamSide): LegalDecision {
  const cm = state.captainsMode!;
  const degradations: RecommendationDegradation[] = [];
  if (state.degradation) degradations.push({ reason: state.degradation.reason, detail: state.degradation.detail });

  const actions = legalGameplayActions(state);
  const cmAction = actions.find(
    (action): action is Extract<typeof action, { type: "CM_ACTION" }> => action.type === "CM_ACTION" && action.absoluteSide === actor,
  );
  const phase = captainsModeStepDefinition(cm.currentStep)?.phase ?? null;

  if (!cmAction) {
    const banSkipped = actions.some(
      (action) => action.type === "CM_BAN_SKIPPED" && action.absoluteSide === actor,
    );
    if (banSkipped) {
      degradations.push({
        reason: "NO_LEGAL_HERO_UNIVERSE",
        detail: `paso ${cm.currentStep}: sin héroes elegibles restantes, sólo BAN_SKIPPED es legal`,
      });
      return {
        decision: { actor, actionKind: "BAN", phase, round: null, step: cm.currentStep, controlledSlots: [], actionCount: 0 },
        eligibleHeroIds: [],
        degradations,
      };
    }
    if (state.status !== "COMPLETE") {
      degradations.push({
        reason: "NO_ACTION_FOR_ACTOR",
        detail: `paso ${cm.currentStep}: no es el turno de ${actor} (status ${state.status})`,
      });
    }
    return { decision: emptyDecision(actor, phase), eligibleHeroIds: null, degradations };
  }

  return {
    decision: {
      actor,
      actionKind: cmAction.kind,
      phase,
      round: null,
      step: cmAction.step,
      controlledSlots: [{ side: actor, slotIndex: cmAction.step }],
      actionCount: 1,
    },
    eligibleHeroIds: cmAction.eligibleHeroIds,
    degradations,
  };
}

/** LEGAL ACTION FIRST -- the only entry point build.ts uses to learn what is decidable and which
 * heroes may legally be named for it. Pure: reads state, never mutates, never calls the network. */
export function deriveLegalDecision(state: DraftProtocolState, actor: TeamSide): LegalDecision {
  if (state.rankedAp) return deriveRankedAllPick(state, actor);
  if (state.captainsMode) return deriveCaptainsMode(state, actor);
  return { decision: emptyDecision(actor, null), eligibleHeroIds: null, degradations: [{ reason: "RULESET_LOAD_FAILED", detail: "estado de protocolo sin ranked_ap ni captains_mode" }] };
}
