import { derivePerspectiveSuggestionInputs, perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { DraftProtocolState, PerspectiveDraftView, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { loadHeroPositions, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import { buildBasedOn } from "./identity";
import { deriveLegalDecision } from "./decision";
import { eligibleHumanPositions, type HumanActionability } from "./human-actionability";
import { buildShortlist } from "./shortlist";
import { excludedHeroes, postValidateAction, type ComputeSuggestionsForRecommendation } from "./legality";
import {
  evidenceFromEligibility,
  evidenceFromRuleset,
  evidenceIdentityHash,
  type FunctionalRecommendationEvidence,
} from "./evidence";
import {
  AP_RECOMMENDATION_OUTPUT_LIMIT,
  buildCompoundRecommendations,
  buildSingleRecommendations,
  pushUniqueDegradation,
  RECOMMENDATION_OUTPUT_LIMIT,
  type ConstructContext,
} from "./construct";
import { computeOnePlyLookahead } from "./lookahead";
import { deferredFieldsNotComputed } from "./types";
import type { Recommendation, RecommendationDegradation, RecommendationSetV2 } from "./types";

// R1 S5 -- RecommendationSet/v2 canonical builder. Pipeline (mandated end to end):
//
//   PerspectiveDraftView + legalGameplayActions (decision.ts)
//     -> shortlist of legal heroes ranked by V6 (shortlist.ts, over the SAME suggestion-bridge
//        seam S2 already built for exactly this purpose)
//     -> role impact (role-impact.ts, over S4's joint-assignment primitive)
//     -> evidence (evidence.ts)
//     -> RecommendationSetV2 (this file)
//
// LEGAL ACTION FIRST: decision.ts's `eligibleHeroIds` (Captain's Mode) or `null` (unrestricted,
// Ranked All Pick) is intersected against V6's ranked output BEFORE anything is scored further --
// V6 is never asked to "rank everything, filter later". `postValidateAction` below is the second,
// independent check against the same authoritative `state` immediately before a Recommendation is
// constructed -- a Recommendation that fails it is silently dropped (never constructed), so a
// caller can never observe an illegal action here even if a bug elsewhere in this file computed
// one. V6 stays the ONLY scoring engine: this module ranks the same shortlist V6 already ordered,
// never re-scores, and never imports drafter/team-opener.ts (Pro-Drafter) -- see
// architecture-guard.test.ts.
//
// Compound scoring (actionCount > 1, i.e. Ranked All Pick rounds 1/2 with two simultaneous
// slots for the same side) is a PLAIN SUM of each hero's independently-computed V6 score. V6 has
// no "score these two heroes as one simultaneous pick" primitive, and adding an invented synergy
// bonus here would be exactly the kind of unfrozen business threshold the contract forbids. Role
// impact (role-impact.ts) IS computed jointly for the pair (that primitive already exists in S4)
// and reported on the Recommendation for the caller to see -- it never feeds back into `score`.
//
// Determinism: no `Date.now()`, no unseeded `Math.random()`, anywhere in this module or its
// dependents (shortlist.ts, role-impact.ts, decision.ts, identity.ts, evidence.ts) -- verified by
// architecture-guard.test.ts. The only source of intentional variation is the caller-supplied
// `seed`, threaded to V6's own `diversitySeed` and nowhere else.

export { RECOMMENDATION_OUTPUT_LIMIT };
export { AP_RECOMMENDATION_OUTPUT_LIMIT };

export type { ComputeSuggestionsForRecommendation } from "./legality";

export interface BuildRecommendationSetV2Input {
  state: DraftProtocolState;
  /** MUST be `project(state, actor)` -- the caller's own perspective, never a spectator/opponent
   * view. Accepted as an argument (not recomputed here) so callers that already hold it (routes,
   * ProtocolSessionStore.view) never pay for projecting twice. */
  view: PerspectiveDraftView;
  actor: TeamSide;
  patch: string;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  heroPositions?: HeroPositions;
  /** Whether V6 ran with empirical calibration or the fallback range -- folds into
   * basedOn.evidenceVersion. Defaults to "fallback": no caller in this codebase passes
   * `calibration` to buildSuggestions today (Fase 9.1, TSK-213's own measured decision), so
   * "fallback" is the honest default, not a guess. */
  calibrationMode?: "fallback" | "empirical";
  /** Determinism seed, threaded to V6's diversitySeed only. Omit for a purely stable order. */
  seed?: string;
  /** Soft preference for whoever is requesting this recommendation -- applies to every candidate
   * hero equally. See role-impact.ts's RoleImpactInput doc for why no per-slot mapping exists. */
  partyPreferredPositions?: readonly Position[];
  /** Explicit individual-role recommendation context. Omitted preserves the captain/team path. */
  targetPosition?: Position;
  /** `false` is meaningful: an individual-participant pick must never use team-opening policy. */
  teamOpening?: boolean;
  /** Simulator recovery preserves all six V6 suggestions; other callers keep the legacy limit. */
  outputLimit?: number;
  /** Stable roster identities controlled by this caller, mapped onto AP's round-scoped slots. Legacy (non-AP-Simulator-controlledPositions) callers only -- see `humanOpenPositions`. */
  controlledRosterSlots?: readonly number[];
  /** Explicit simulator discriminator: only simulator sessions target real Own Team positions. */
  isSimulator?: boolean;
  /**
   * PD-026/PD-027 -- Own Team's unfilled human-controlled positions (AP Simulator only), zipped
   * onto open own slots in ascending-position order. Takes priority over `controlledRosterSlots`
   * when present. Also folded into `basedOn.partyIdentity` so two states differing only here never
   * share a recommendation identity.
   */
  humanOpenPositions?: readonly Position[] | null;
  controlledPositions?: readonly Position[] | null;
  /** WP1 -- ProtocolSessionStore.humanActionability (eligibility vs. round capacity vs. yield). Wins over `humanOpenPositions` for slot derivation. */
  humanActionability?: HumanActionability | null;
}

export async function buildRecommendationSetV2(input: BuildRecommendationSetV2Input): Promise<RecommendationSetV2> {
  const { state, view, actor, patch, computeSuggestions, seed, partyPreferredPositions } = input;
  const heroPositions = input.heroPositions ?? MODULE_HERO_POSITIONS;
  const calibrationMode = input.calibrationMode ?? "fallback";

  const legal = deriveLegalDecision(state, actor, input.controlledRosterSlots, input.isSimulator ?? false, input.humanOpenPositions ?? undefined, input.humanActionability ?? undefined);
  const degradations: RecommendationDegradation[] = [...legal.degradations];
  const eligibilitySnapshot = state.captainsMode?.eligibilitySnapshot ?? null;
  // Blocker 6 (independent architecture review) -- identity inputs shared by every basedOn built
  // below. `partyContext` only exists at the kernel-state level for Ranked All Pick (Captain's
  // Mode carries no party slot in CmState); CM decisions are always single-action regardless of
  // party, so `null` there is correct, not a gap.
  const identityInputs = {
    view,
    eligibilitySnapshot,
    calibrationMode,
    seed: seed ?? null,
    patch,
    partyContext: state.rankedAp?.partyContext ?? null,
    apControl: { controlledPositions: input.controlledPositions ?? null, humanOpenPositions: input.humanOpenPositions ?? null },
  };
  // No evidence has been computed yet at this point -- used for every return that never reaches
  // computeSuggestions (no legal action) or where computeSuggestions itself failed.
  const basedOnWithoutEvidence = buildBasedOn({ ...identityInputs, evidenceHash: null });

  const emptyWithoutEvidence = (decisionContext: RecommendationSetV2["decisionContext"]): RecommendationSetV2 => ({
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn: basedOnWithoutEvidence,
    decision: legal.decision,
    recommendations: [],
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext,
  });

  if (legal.decision.actionCount === 0) return emptyWithoutEvidence("no_action");

  const legacyState = perspectiveToLegacyDraftState(view, { patch });
  let suggestionSet: SuggestionSet;
  try {
    // Legacy kernel-backed callers default to the captain/team-opening path. A caller representing
    // one actual participant (one simulator seat) must opt out explicitly and provide its targetPosition.
    // `candidateHeroIds` is the kernel's own certified legal universe (null = unrestricted,
    // Ranked All Pick) -- V6 ranks ONLY that universe, never the global catalog filtered after the
    // fact (see mix.ts's candidatePool).
    suggestionSet = await computeSuggestions(legacyState, null, {
      teamOpening: input.teamOpening ?? true,
      targetPosition: input.targetPosition,
      diversitySeed: seed,
      candidateHeroIds: legal.eligibleHeroIds ?? undefined,
    });
  } catch {
    pushUniqueDegradation(degradations, { reason: "SNAPSHOT_UNAVAILABLE", detail: "computeSuggestions falló; sin datos de meta disponibles" });
    return emptyWithoutEvidence("no_action");
  }
  for (const flag of suggestionSet.degraded) pushUniqueDegradation(degradations, { reason: flag, detail: `V6 degraded flag: ${flag}` });

  // Evidence identity accepts only an input descriptor produced before V6 ranks/selects anything.
  // A scorer implementation that omits it cannot silently reintroduce output hashing.
  if (!suggestionSet.functionalEvidence) {
    pushUniqueDegradation(degradations, { reason: "SNAPSHOT_UNAVAILABLE", detail: "computeSuggestions no entregó evidencia funcional" });
    return emptyWithoutEvidence("no_action");
  }
  const functionalEvidence: FunctionalRecommendationEvidence = {
    ...suggestionSet.functionalEvidence,
    partyPreferredPositions: [...(partyPreferredPositions ?? [])],
  };
  const basedOn = buildBasedOn({ ...identityInputs, evidenceHash: evidenceIdentityHash(functionalEvidence) });
  const empty = (decisionContext: RecommendationSetV2["decisionContext"]): RecommendationSetV2 => ({
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision: legal.decision,
    recommendations: [],
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext,
  });

  const shortlist = buildShortlist(suggestionSet, legal.eligibleHeroIds, excludedHeroes(legacyState));
  if (shortlist.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "ningún héroe legal quedó en el shortlist tras intersectar con la elegibilidad certificada" });
    return empty("no_action");
  }

  const ownPicks = derivePerspectiveSuggestionInputs(view).ownPicks;
  const metaIsStale = suggestionSet.degraded.includes("stale_meta");
  const sortedControlledSlots = [...legal.decision.controlledSlots].sort((a, b) => a.slotIndex - b.slotIndex);

  // The kernel's own legality oracle + the per-hero context evidence a state-backed caller can supply.
  const eligiblePositions = eligibleHumanPositions(legal.decision.humanActionability);
  const constructContext: ConstructContext = {
    isLegal: (hero, slot) => postValidateAction(state, hero, legal.eligibleHeroIds, slot),
    contextEvidence: [
      evidenceFromRuleset(state.ruleset),
      ...(state.captainsMode?.eligibilitySnapshot
        ? [evidenceFromEligibility(state.captainsMode.eligibilitySnapshot.contentHash, state.captainsMode.eligibilitySnapshot.heroIds.length)]
        : []),
    ],
    // PD-001: the eligible human positions admit heroes as a SET (injective, any order); no position is ever attached to a round slot.
    ...(eligiblePositions ? { eligibleHumanPositions: eligiblePositions } : {}),
  };
  const recommendations: Recommendation[] =
    legal.decision.actionCount >= 2
      ? buildCompoundRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots, metaIsStale, degradations, input.outputLimit)
      : buildSingleRecommendations(constructContext, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots[0]!, metaIsStale, suggestionSet, degradations, input.outputLimit);

  if (recommendations.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "el shortlist no sobrevivió la post-validación final contra el estado" });
    return empty("no_action");
  }

  // R1 S6 -- one-ply opponent lookahead, computed ONLY for recommendations[0] (see types.ts's own
  // header doc on `deferred` for why this stays a single set of 4 fields, not one per
  // recommendation). Strictly additive: `recommendations` above is already S5-complete and is
  // never read back from `lookaheadResult` -- a failure here can only ever change `deferred`
  // and/or append a degradation, never the recommendations/decision/basedOn this function already
  // committed to.
  const lookaheadResult = await computeOnePlyLookahead({
    state,
    actor,
    patch,
    computeSuggestions,
    seed,
    topRecommendation: recommendations[0]!,
  });
  for (const degradation of lookaheadResult.degradations) pushUniqueDegradation(degradations, degradation);

  return {
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision: legal.decision,
    recommendations,
    degradations,
    deferred: {
      opponentResponse: lookaheadResult.opponentResponse,
      steal: lookaheadResult.steal,
      lookahead: lookaheadResult.lookahead,
      counterfactual: lookaheadResult.counterfactual,
    },
    decisionContext: suggestionSet.decisionContext,
    readiness: suggestionSet.readiness,
  };

}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
