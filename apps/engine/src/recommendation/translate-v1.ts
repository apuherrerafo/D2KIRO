import type { SuggestionSet } from "../signals/mix";
import type { RecommendationSetV2 } from "./types";

// R1 S5 -- V2 -> V1 compatibility translator. PROJECTS ONLY: it never rescores, never re-derives a
// role, never chooses a hero V2 didn't already rank first. A Recommendation only survives this
// projection when it carries a non-null `legacy` field (build.ts populates that ONLY for
// single-action recommendations, verbatim from the same V6 Suggestion the recommendation was built
// from) -- a compound recommendation has no V1 shape to project into (V1 predates the very idea of
// a simultaneous multi-slot decision), so it is dropped here, not flattened by an invented rule.
//
// Consumers: this is "class B" in the R1 S5 legacy-caller classification (see the R1 spec update) --
// a future/legacy caller that only understands `suggestions/v1` can read a kernel-backed session's
// recommendations through this translator instead of forking a second scoring path.

export function translateRecommendationSetToLegacySuggestionSet(v2: RecommendationSetV2): SuggestionSet {
  const projectable = v2.recommendations.filter((recommendation) => recommendation.legacy !== null);
  const suggestions = projectable.map((recommendation, index) => {
    const legacy = recommendation.legacy!;
    return {
      hero: legacy.hero,
      rank: (Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6),
      score: recommendation.score,
      signals: legacy.signals,
      reason: legacy.reason,
      confidence: recommendation.confidence,
      evidenceCoverage: legacy.evidenceCoverage,
      guessingIndex: legacy.guessingIndex,
    };
  });

  const decisionContext = projectable[0]?.legacy!.decisionContext ?? "no_signal_available";

  return {
    schema: "suggestions/v1",
    sessionId: v2.sessionId,
    // No round/event-log-derived seq exists in draft-protocol/v1 (it is event-log-based, not
    // seq-based like the legacy reducer) -- 0 is the honest "not applicable" value, never invented.
    basedOnSeq: 0,
    decisionContext,
    suggestions,
    // The translator never invents a pairwise comparison V2 didn't compute.
    comparison: null,
    degraded: v2.degradations.map((degradation) => degradation.reason).filter(isLegacyDegradationFlag),
    computedInMs: 0,
  };
}

const LEGACY_DEGRADATION_FLAGS = new Set(["stale_meta", "partial_signals", "unconfirmed_state", "unknown_format", "no_signal_available"]);

function isLegacyDegradationFlag(reason: string): reason is "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format" | "no_signal_available" {
  return LEGACY_DEGRADATION_FLAGS.has(reason);
}
