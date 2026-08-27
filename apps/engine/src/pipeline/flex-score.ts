import { deriveFlexDistribution } from "../intent/position-prior";
import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";

const MAX_ENTROPY = Math.log2(5);

export function flexScore(heroId: HeroId, heroPositions: HeroPositions): number {
  return deriveFlexDistribution(heroId, heroPositions).entropy / MAX_ENTROPY;
}

export function revealPenalty(heroId: HeroId, heroPositions: HeroPositions): number {
  return 1 - flexScore(heroId, heroPositions);
}

export function adjustOpeningFlexScore(score: number, heroId: HeroId, heroPositions: HeroPositions): number {
  const flex = flexScore(heroId, heroPositions);
  return score + (flex * 4) - (revealPenalty(heroId, heroPositions) * 4);
}
