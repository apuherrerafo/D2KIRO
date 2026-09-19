import { derivePerspectiveSuggestionInputs, perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { HeroId, RankedApPhase } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { loadHeroPositions, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import { buildCompoundRecommendations, buildSingleRecommendations, pushUniqueDegradation, type ConstructContext } from "./construct";
import { evidenceFromRuleset, evidenceIdentityHash, type FunctionalRecommendationEvidence } from "./evidence";
import { buildBasedOn } from "./identity";
import { isHeroSelectableFrom, unavailableHeroesFrom, type ComputeSuggestionsForRecommendation, type PerspectiveRecommendationContext } from "./perspective-context";
import { buildShortlist } from "./shortlist";
import { deferredFieldsNotComputed } from "./types";
import type { Recommendation, RecommendationDecision, RecommendationDegradation, RecommendationSetV2, RecommendationSlot } from "./types";

// AP Ranked Roles V1 / Wave 2 (product review) -- RecommendationSet/v2 built from a PERSPECTIVE, for
// the Coach path. Same pipeline as build.ts (shortlist -> role impact -> evidence -> set), same V6
// scorer, same shared construction (construct.ts) -- but the ONLY input is a
// PerspectiveRecommendationContext (perspective-context.ts), which cannot carry authoritative state,
// a hidden enemy selection, a simulator ledger or Enemy Bot positions. There is nothing here to
// audit for "does it happen not to leak": the function has no way to receive what would leak.
//
// Legacy `buildRecommendationSetV2(authoritativeState)` is untouched and keeps serving its
// consumers. Differences from it, all deliberate and all narrowing:
//   - `deferred` is always NOT_COMPUTED: the one-ply lookahead needs the kernel to simulate our
//     action, which needs the authoritative state (and, when our action closes the round, a reveal we
//     have not seen). It is not computed on this path, and says so.
//   - Ranked All Pick only (the Coach is AP-only): no CM eligibility universe.
//   - No diversity seed: the simulator seed also derives Enemy Bot internals, so it is not an input.
//   - Legality is `isHeroSelectableFrom(context, ...)`, derived from the view.

export interface BuildRecommendationSetFromPerspectiveInput {
  context: PerspectiveRecommendationContext;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  heroPositions?: HeroPositions;
  calibrationMode?: "fallback" | "empirical";
  partyPreferredPositions?: readonly Position[];
  teamOpening?: boolean;
  outputLimit?: number;
}

function roundOf(phase: RankedApPhase | undefined): number | null {
  if (phase === "PICK_ROUND_1") return 1;
  if (phase === "PICK_ROUND_2") return 2;
  if (phase === "PICK_ROUND_3") return 3;
  return null;
}

/** The actor's decision, from the view + the seats the client is already told are open. */
function deriveDecisionFrom(context: PerspectiveRecommendationContext): { decision: RecommendationDecision; degradations: RecommendationDegradation[] } {
  const { view, partyContext } = context;
  const actor = view.viewerSide ?? "radiant";
  const degradations: RecommendationDegradation[] = [];
  if (view.degradation) degradations.push({ reason: view.degradation.reason, detail: view.degradation.detail });

  let controlledSlots: RecommendationSlot[] = context.openOwnSlots.filter((slot) => slot.side === actor).map((slot) => ({ side: slot.side, slotIndex: slot.slotIndex }));
  // A party may control only some of its own side's seats: never propose an action for a seat this
  // session does not drive (same cap as decision.ts, over the same information).
  if (partyContext && partyContext.side === actor) controlledSlots = controlledSlots.slice(0, partyContext.controlledSlots.length);

  if (controlledSlots.length === 0 && view.status !== "COMPLETE") {
    degradations.push({
      reason: "NO_ACTION_FOR_ACTOR",
      detail: `no hay slot sellado abierto para ${actor} en este momento (phase ${view.rankedAp?.phase}, status ${view.status})`,
    });
  }

  return {
    decision: {
      actor,
      actionKind: controlledSlots.length > 0 ? "PICK" : null,
      phase: view.rankedAp?.phase ?? null,
      round: roundOf(view.rankedAp?.phase),
      step: null,
      controlledSlots,
      actionCount: controlledSlots.length,
    },
    degradations,
  };
}

export async function buildRecommendationSetFromPerspective(input: BuildRecommendationSetFromPerspectiveInput): Promise<RecommendationSetV2> {
  const { context, computeSuggestions, partyPreferredPositions } = input;
  const { view } = context;
  const heroPositions = input.heroPositions ?? MODULE_HERO_POSITIONS;
  const calibrationMode = input.calibrationMode ?? "fallback";

  const { decision, degradations } = deriveDecisionFrom(context);
  const identityInputs = { view, eligibilitySnapshot: null, calibrationMode, seed: null, patch: context.patch, partyContext: context.partyContext };
  const basedOnWithoutEvidence = buildBasedOn({ ...identityInputs, evidenceHash: null });

  const emptyWith = (basedOn: RecommendationSetV2["basedOn"], decisionContext: RecommendationSetV2["decisionContext"]): RecommendationSetV2 => ({
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision,
    recommendations: [],
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext,
  });

  if (decision.actionCount === 0) return emptyWith(basedOnWithoutEvidence, "no_action");

  const legacyState = perspectiveToLegacyDraftState(view, { patch: context.patch });
  let suggestionSet: SuggestionSet;
  try {
    suggestionSet = await computeSuggestions(legacyState, null, {
      teamOpening: input.teamOpening ?? true,
      diversitySeed: undefined,
      candidateHeroIds: undefined,
    });
  } catch {
    pushUniqueDegradation(degradations, { reason: "SNAPSHOT_UNAVAILABLE", detail: "computeSuggestions falló; sin datos de meta disponibles" });
    return emptyWith(basedOnWithoutEvidence, "no_action");
  }
  for (const flag of suggestionSet.degraded) pushUniqueDegradation(degradations, { reason: flag, detail: `V6 degraded flag: ${flag}` });

  if (!suggestionSet.functionalEvidence) {
    pushUniqueDegradation(degradations, { reason: "SNAPSHOT_UNAVAILABLE", detail: "computeSuggestions no entregó evidencia funcional" });
    return emptyWith(basedOnWithoutEvidence, "no_action");
  }
  const functionalEvidence: FunctionalRecommendationEvidence = { ...suggestionSet.functionalEvidence, partyPreferredPositions: [...(partyPreferredPositions ?? [])] };
  const basedOn = buildBasedOn({ ...identityInputs, evidenceHash: evidenceIdentityHash(functionalEvidence) });

  const shortlist = buildShortlist(suggestionSet, null, unavailableHeroesFrom(view));
  if (shortlist.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "ningún héroe legal quedó en el shortlist tras intersectar con la elegibilidad certificada" });
    return emptyWith(basedOn, "no_action");
  }

  const ownPicks: HeroId[] = derivePerspectiveSuggestionInputs(view).ownPicks;
  const metaIsStale = suggestionSet.degraded.includes("stale_meta");
  const sortedControlledSlots = [...decision.controlledSlots].sort((a, b) => a.slotIndex - b.slotIndex);
  const constructContext: ConstructContext = {
    isLegal: (hero, slot) => isHeroSelectableFrom(context, hero, slot),
    contextEvidence: [evidenceFromRuleset(view.ruleset)],
  };

  const recommendations: Recommendation[] =
    decision.actionCount >= 2
      ? buildCompoundRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots, metaIsStale, degradations, input.outputLimit)
      : buildSingleRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots[0]!, metaIsStale, suggestionSet, degradations, input.outputLimit);

  if (recommendations.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "el shortlist no sobrevivió la post-validación final contra el estado" });
    return emptyWith(basedOn, "no_action");
  }

  return {
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision,
    recommendations,
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext: suggestionSet.decisionContext,
  };
}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
