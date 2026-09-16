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
export { buildRecommendationSetV2, RECOMMENDATION_OUTPUT_LIMIT } from "./build";
export type { BuildRecommendationSetV2Input, ComputeSuggestionsForRecommendation } from "./build";
export { translateRecommendationSetToLegacySuggestionSet } from "./translate-v1";
