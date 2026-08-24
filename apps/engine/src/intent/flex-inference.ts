import { deriveFlexDistribution } from "./position-prior";
import type { PositionDistribution } from "./position-prior";
import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";

// Fase 7 (pro-drafter-spec-v1.md §2.3): envoltorio delgado sobre deriveFlexDistribution (7.1) --
// decide si un héroe rival es un "flex pick" (sin rol confirmado) comparando su entropía contra
// un umbral configurable. Estrictamente `>`, no `>=`: la entropía igual al umbral no cuenta como
// flex, mismo criterio de borde que MIN_POSITION_MATCHES en hero-positions.ts (un umbral exacto,
// no "aproximadamente").

export interface FlexInferenceResult {
  readonly rivalHeroId: HeroId;
  readonly distribution: PositionDistribution;
  readonly isFlex: boolean;
}

export function inferFlexPick(
  heroId: HeroId,
  heroPositions: HeroPositions,
  entropyThreshold: number,
): FlexInferenceResult {
  const distribution = deriveFlexDistribution(heroId, heroPositions);

  return {
    rivalHeroId: heroId,
    distribution,
    isFlex: distribution.entropy > entropyThreshold,
  };
}
