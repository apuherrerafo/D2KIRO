import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import { extractHeroCandidates } from "./hero-card";

// Wave 3 task 20 -- this deliberately consumes its OWN RecommendationSetV2.  It never sees the
// team set, so deriving "your position" by filtering the team shortlist is structurally impossible.
export interface PersonalHeroView {
  position: Position;
  positionLabel: string;
  heroes: { heroId: HeroId; rank: number; score: number; isFromPool: boolean }[];
}

const POSITION_LABEL: Record<Position, string> = {
  1: "TU CARRY AHORA",
  2: "TU MID AHORA",
  3: "TU OFFLANE AHORA",
  4: "TU SUPPORT AHORA",
  5: "TU HARD SUPPORT AHORA",
};

export interface PersonalPositionRecommendationDeps {
  buildRecommendationSet(context: PerspectiveRecommendationContext, position: Position): Promise<RecommendationSetV2>;
  heroPositions?: HeroPositions;
  shortlistSize?: number;
}

export async function buildPersonalPositionRecommendation(
  context: PerspectiveRecommendationContext,
  playerPersonalPosition: Position,
  heroPool: readonly HeroId[],
  deps: PersonalPositionRecommendationDeps,
): Promise<{ recommendationSet: RecommendationSetV2; view: PersonalHeroView }> {
  const recommendationSet = await deps.buildRecommendationSet(context, playerPersonalPosition);
  const pool = new Set(heroPool);
  const heroes = extractHeroCandidates(recommendationSet, deps.heroPositions)
    .slice(0, deps.shortlistSize ?? 5)
    .map((candidate, index) => ({
      heroId: candidate.heroId,
      rank: index + 1,
      score: candidate.score,
      // Server-backed calls receive the account's approved pool through V6's meta overlay. The
      // direct pool parameter keeps this pure helper testable; the signal is the authoritative
      // fallback when that overlay is intentionally not duplicated into Coach state.
      isFromPool: pool.has(candidate.heroId) || candidate.signals.some((signal) => signal.signal === "hero_pool_fit" && signal.explanation.startsWith("En tu pool")),
    }));
  return { recommendationSet, view: { position: playerPersonalPosition, positionLabel: POSITION_LABEL[playerPersonalPosition], heroes } };
}
