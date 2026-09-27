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
  /** A personal-position evaluation is a single advisory choice, not a claim about pick chronology. */
  targetPosition?: Position;
  /** Keeps a personal advisory evaluation independent from the team round's compound action count. */
  singleSlotEvaluation?: boolean;
  teamOpening?: boolean;
  /**
   * Pre-ranking candidate universe (V6's own `candidateHeroIds`). Only the Coach's personal-position path supplies
   * one -- a universe derived from the target position alone, never from the team shortlist. Team callers omit it.
   */
  candidateHeroIds?: readonly HeroId[];
  outputLimit?: number;
}

function roundOf(phase: RankedApPhase | undefined): number | null {
  if (phase === "PICK_ROUND_1") return 1;
  if (phase === "PICK_ROUND_2") return 2;
  if (phase === "PICK_ROUND_3") return 3;
  return null;
}

/** The actor's decision, from the view + the seats the client is already told are open. */
function deriveDecisionFrom(
  context: PerspectiveRecommendationContext,
  singleSlotEvaluation: boolean,
): { decision: RecommendationDecision; degradations: RecommendationDegradation[] } {
  const { view, partyContext, isSimulator, humanOpenPositions } = context;
  const actor = view.viewerSide ?? "radiant";
  const degradations: RecommendationDegradation[] = [];
  if (view.degradation) degradations.push({ reason: view.degradation.reason, detail: view.degradation.detail });

  // PD-026/PD-027 COACH TARGET POSITIONS -- target unfilled HUMAN-controlled positions, never a
  // round-seat mapping. Positions are zipped to open own slots in ascending-position order (a
  // stable, non-chronological tie-break), never derived from round/slotIndex.
  const sortedOpenPositions = humanOpenPositions ? [...humanOpenPositions].sort((a, b) => a - b) : null;
  let controlledSlots: RecommendationSlot[] = context.openOwnSlots
    .filter((slot) => slot.side === actor)
    .map((slot, index) => {
      const position: Position | null = isSimulator && sortedOpenPositions ? (sortedOpenPositions[index] ?? null) : null;
      return { side: slot.side, slotIndex: slot.slotIndex, ...(position !== null ? { position } : {}) };
    });
  if (humanOpenPositions !== null && humanOpenPositions !== undefined) {
    controlledSlots = controlledSlots.slice(0, humanOpenPositions.length);
  } else if (partyContext && partyContext.side === actor) {
    // A party may control only some of its own side's seats: never propose an action for a seat
    // this session does not drive (same cap as decision.ts, over the same information).
    controlledSlots = controlledSlots.slice(0, partyContext.controlledSlots.length);
  }
  if (singleSlotEvaluation) controlledSlots = controlledSlots.slice(0, 1);

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

  const { decision, degradations } = deriveDecisionFrom(context, input.singleSlotEvaluation === true);
  const identityInputs = {
    view,
    eligibilitySnapshot: null,
    calibrationMode,
    seed: null,
    patch: context.patch,
    partyContext: context.partyContext,
    apControl: { controlledPositions: context.controlledPositions ?? null, humanOpenPositions: context.humanOpenPositions ?? null },
  };
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
      targetPosition: input.targetPosition,
      // Hero Pool remains a soft V6 signal. Restricting the candidate universe would make it an
      // illegitimate hard gate and hide a clearly better outside-pool personal option.
      usePersonalPool: false,
      diversitySeed: undefined,
      candidateHeroIds: input.candidateHeroIds,
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

  let recommendations: Recommendation[] =
    decision.actionCount >= 2
      ? buildCompoundRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots, metaIsStale, degradations, input.outputLimit)
      : buildSingleRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots[0]!, metaIsStale, suggestionSet, degradations, input.outputLimit, false, !input.singleSlotEvaluation);

  // COMPOUND FALLBACK. The Coach answers "what is the best NEXT reveal decision?" -- the Player does not need a
  // jointly-valid PAIR before sealing the first seat of a two-seat round, and the Coach recomputes after every own
  // pick. When no pair survives joint role assignment (typically: the whole V6 top is heroes of one exclusive
  // position, e.g. six Pos-1-only carries), degrade to the next single step instead of returning nothing. It is a
  // fallback for a FAILED compound construction only: same shortlist, same perspective-derived legality, and the
  // same role-feasibility gate (no pair is fabricated, no position data is loosened). Truly no legal single hero
  // still falls through to NO_LEGAL_HERO_UNIVERSE below.
  if (recommendations.length === 0 && decision.actionCount >= 2) {
    recommendations = buildSingleRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots, metaIsStale, suggestionSet, degradations, input.outputLimit, true);
    if (recommendations.length > 0) {
      pushUniqueDegradation(degradations, {
        reason: "COMPOUND_FALLBACK_SINGLE_STEP",
        detail: "ningún par de héroes admite una asignación conjunta de roles; se recomienda el próximo pick individual y se recalcula al elegirlo",
      });
    }
  }

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
    readiness: suggestionSet.readiness,
  };

}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
