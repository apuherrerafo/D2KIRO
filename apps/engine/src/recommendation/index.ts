// R1 S5 -- RecommendationSet/v2 public surface.
export * from "./types";
export { buildBasedOn, EVIDENCE_VERSION_BASE } from "./identity";
export { deriveLegalDecision } from "./decision";
export type { LegalDecision } from "./decision";
export { computeRoleImpact } from "./role-impact";
export type { RoleImpactInput, RoleImpactResult } from "./role-impact";
export { buildShortlist, buildCompoundCandidates, SHORTLIST_SIZE } from "./shortlist";
export type { ShortlistEntry, CompoundCandidate } from "./shortlist";
export { evidenceFromSignals, evidenceFromRoleBelief, evidenceFromRuleset, evidenceFromEligibility, deriveRisks } from "./evidence";
export { excludedHeroes, postValidateAction } from "./legality";
export { buildRecommendationSetV2, RECOMMENDATION_OUTPUT_LIMIT } from "./build";
export type { BuildRecommendationSetV2Input, ComputeSuggestionsForRecommendation } from "./build";
export { translateRecommendationSetToLegacySuggestionSet } from "./translate-v1";

// R1 S6 -- one-ply opponent lookahead public surface.
export { opponentSideOf, applyOwnCandidateAction, locateOpponentObservationPoint } from "./observation-point";
export type { ObservationPoint, ObservationPointStatus, OwnActionSimulationResult } from "./observation-point";
export { computeOpponentModel, opponentValueFor, topPlausibleAction } from "./opponent-model";
export type { OpponentModelInput, OpponentModelResult } from "./opponent-model";
export { buildOpponentResponse } from "./opponent-response";
export { evaluateSteal } from "./steal";
export { buildCounterfactualIdentity } from "./counterfactual-identity";
export { computeOnePlyLookahead } from "./lookahead";
export type { OnePlyLookaheadInput, OnePlyLookaheadResult } from "./lookahead";
