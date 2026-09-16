import type { DraftProtocolState, HeroId, TeamSide } from "../draft-protocol/types";
import { buildCounterfactualIdentity } from "./counterfactual-identity";
import type { ComputeSuggestionsForRecommendation } from "./legality";
import { computeOpponentModel, computeOpponentValueBaseline } from "./opponent-model";
import { applyOwnCandidateAction, locateOpponentObservationPoint, opponentSideOf } from "./observation-point";
import { buildOpponentResponse } from "./opponent-response";
import { evaluateSteal } from "./steal";
import { deferredFieldsNotComputed } from "./types";
import type {
  CounterfactualIdentity,
  NotComputed,
  OnePlyLookahead,
  OnePlyStatus,
  OpponentResponse,
  Recommendation,
  RecommendationDegradation,
  StealEvaluation,
} from "./types";

// R1 S6 -- orchestrator. The ONE call site build.ts uses to materialize `deferred` for
// `recommendations[0]`. Owns nothing itself: every real computation is delegated to
// observation-point.ts (kernel simulation), opponent-model.ts (opponent-perspective V6 scoring,
// reused verbatim from S1/S2/S5), opponent-response.ts (plausible-response assembly), steal.ts
// (steal evidence) and counterfactual-identity.ts (identity). This file's only job is sequencing
// them and mapping failures to the right OnePlyStatus sentinel -- it never computes a score,
// never reads authoritative hidden state, never imports drafter/team-opener.

export interface OnePlyLookaheadInput {
  /** Authoritative state BEFORE the top recommendation's action(s) -- the same `state` build.ts
   * already holds. Never mutated: `applyOwnCandidateAction` always returns a new state. */
  state: DraftProtocolState;
  actor: TeamSide;
  patch: string;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  seed?: string;
  topRecommendation: Recommendation;
}

export interface OnePlyLookaheadResult {
  opponentResponse: OpponentResponse | NotComputed;
  steal: StealEvaluation | NotComputed;
  lookahead: OnePlyLookahead | NotComputed;
  counterfactual: CounterfactualIdentity | NotComputed;
  degradations: RecommendationDegradation[];
}

function candidateHeroesOf(recommendation: Recommendation): readonly HeroId[] {
  return recommendation.actions.map((action) => action.hero);
}

/** Sentinel branch shared by NO_LEGAL_RESPONSE / COLLISION_PENDING / DRAFT_COMPLETE -- our own
 * action DID apply, but no opponent hero-level decision is reachable within one ply. A real
 * counterfactual identity is still built (against the state our own action actually produced),
 * because `stateIdentity`/`rulesHash`/`eligibilityHash` remain meaningful even with no opponent
 * V6 call attempted -- only `evidenceIdentity` stays null (no evidence was ever produced). */
function noOpponentDecisionResult(
  status: OnePlyStatus,
  stateAfterOwnAction: DraftProtocolState,
  actor: TeamSide,
  seed: string | undefined,
  ourAction: Recommendation,
  degradations: RecommendationDegradation[],
): OnePlyLookaheadResult {
  const identity = buildCounterfactualIdentity(stateAfterOwnAction, actor, seed, null);
  return {
    opponentResponse: { status, actor: null, action: null, score: null, confidence: null, evidence: [], basedOnCounterfactualState: identity },
    steal: { status, heroId: null, opponentBaselineValue: null, afterOurActionValue: null, displacedResponse: null, evidence: [] },
    lookahead: { depth: 1, status, ourAction: ourAction.actions, opponentResponse: null, resultingEvaluation: null },
    counterfactual: identity,
    degradations,
  };
}

export async function computeOnePlyLookahead(input: OnePlyLookaheadInput): Promise<OnePlyLookaheadResult> {
  const { state, actor, patch, computeSuggestions, seed, topRecommendation } = input;
  const opponentSide = opponentSideOf(actor);
  const degradations: RecommendationDegradation[] = [];

  // ONE-PLY DEFINITION steps 1-3: hypothetically apply OUR OWN action(s) through the kernel.
  const applied = applyOwnCandidateAction(state, actor, topRecommendation.actions);
  if (!applied.ok) {
    degradations.push({ reason: "NO_ACTION_FOR_ACTOR", detail: `S6 no pudo simular la acción propia (${applied.reason})` });
    return { ...deferredFieldsNotComputed(), degradations };
  }

  // ONE-PLY DEFINITION step 4: COUNTERFACTUAL OBSERVATION POINT.
  const observation = locateOpponentObservationPoint(applied.state, opponentSide);
  if (observation.status !== "READY") {
    return noOpponentDecisionResult(observation.status, applied.state, actor, seed, topRecommendation, degradations);
  }
  const counterfactualState = observation.state;

  // ONE-PLY DEFINITION steps 5-6: opponent's own legal universe + V6 ranking, from THEIR
  // perspective, both against the CURRENT state (baseline VALUE, never a fabricated legal action --
  // see opponent-model.ts's computeOpponentValueBaseline) and the counterfactual one (after, a real
  // legal-response model) -- bounded to exactly 2 extra V6 calls, run concurrently.
  const [baseline, after] = await Promise.all([
    computeOpponentValueBaseline({ state, opponentSide, patch, computeSuggestions, seed }),
    computeOpponentModel({ state: counterfactualState, opponentSide, patch, computeSuggestions, seed }),
  ]);
  if (after.failed) degradations.push({ reason: "SNAPSHOT_UNAVAILABLE", detail: "S6: computeSuggestions falló al puntuar la respuesta rival (after)" });
  if (baseline.failed) degradations.push({ reason: "SNAPSHOT_UNAVAILABLE", detail: "S6: computeSuggestions falló al puntuar la línea base rival (baseline)" });

  const identity = buildCounterfactualIdentity(counterfactualState, actor, seed, after.suggestionSet);

  // ONE-PLY DEFINITION steps 7-8: one bounded plausible response + its counterfactual effect.
  const opponentResponse = buildOpponentResponse(opponentSide, after, counterfactualState, identity);
  const steal = evaluateSteal(state, baseline, after, counterfactualState, candidateHeroesOf(topRecommendation));

  const resultingEvaluation =
    opponentResponse.score === null
      ? null
      : {
          ourActionScore: topRecommendation.score,
          opponentResponseScore: opponentResponse.score,
          scoreDelta: opponentResponse.score - topRecommendation.score,
        };

  // ONE-PLY DEFINITION step 9: attach. `lookahead.opponentResponse` restates the sibling field
  // verbatim (never re-derived) -- null exactly when no concrete response exists (any non-
  // PLAUSIBLE_RESPONSE status), matching `resultingEvaluation`'s own null case one-for-one.
  const lookahead: OnePlyLookahead = {
    depth: 1,
    status: opponentResponse.status,
    ourAction: topRecommendation.actions,
    opponentResponse: opponentResponse.status === "PLAUSIBLE_RESPONSE" ? opponentResponse : null,
    resultingEvaluation,
  };

  return { opponentResponse, steal, lookahead, counterfactual: identity, degradations };
}
