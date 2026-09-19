import { CoachOrchestrator, type CoachRecomputation } from "../../coach";
import { buildRecommendationSetFromPerspective } from "../../recommendation/build-from-perspective";
import { AP_RECOMMENDATION_OUTPUT_LIMIT } from "../../recommendation/construct";
import type { ComputeSuggestionsForRecommendation, PerspectiveRecommendationContext } from "../../recommendation/perspective-context";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";

// AP Ranked Roles V1 / Wave 2 (product review) -- the Coach's server-side entry point.
//
// STRUCTURAL BOUNDARY: everything this module can reach about a draft comes through
// `PerspectiveContextSource`, whose single method returns a `PerspectiveRecommendationContext`
// (perspective view + open seats + party structure + patch). The interface deliberately does NOT
// expose the session store's authoritative state accessor, so a `DraftProtocolState` is not merely
// avoided here -- it is not obtainable through the types this file is given. The route hands over
// `ProtocolSessionStore`, which satisfies the narrow interface structurally.
//
// Legacy `GET .../recommendations` (RecommendationSetV2 from authoritative state) does not go
// through here and is unchanged.

export interface PerspectiveContextSource {
  perspectiveRecommendationContext(sessionId: string): PerspectiveRecommendationContext | null;
}

export interface CoachRecommendationsDeps {
  source: PerspectiveContextSource;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  heroPositions?: HeroPositions;
}

export interface CoachRecommendations {
  /** Null for an unknown session. */
  recommend(sessionId: string, playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null): Promise<CoachRecomputation | null>;
}

export function createCoachRecommendations(deps: CoachRecommendationsDeps): CoachRecommendations {
  const heroPositions = deps.heroPositions ?? MODULE_HERO_POSITIONS;
  const coach = new CoachOrchestrator({
    heroPositions,
    buildRecommendationSet: (context) =>
      buildRecommendationSetFromPerspective({
        context,
        computeSuggestions: deps.computeSuggestions,
        heroPositions,
        outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
      }),
  });
  return {
    async recommend(sessionId, playerPersonalPosition) {
      const context = deps.source.perspectiveRecommendationContext(sessionId);
      if (!context) return null;
      return coach.recompute({ context, playerPersonalPosition });
    },
  };
}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
