import type { PipelineWeights } from "./weight-loader";

// Misma frontera que deriveDecisionContext usa para declarar terminada la fase ciega
// (enemy>=2 && own>=2 -> "response_pick", drafter/decision-context.ts). No es un número nuevo: es
// el gate discreto que el proyecto ya tiene, leído como frontera continua.
export const OPENING_SPAN = 4;

// La apertura no tiene KNN útil (no hay picks propios), por eso reserva 90% a evidencia de bans
// y 10% al ajuste posicional. Después de cuatro picks vuelve gradualmente a los pesos configurados.
export const OPENING_LANE_WEIGHT = 0.1;

// Matrices Tier-1 del pipeline experimental. Los nombres de la interfaz existente se conservan:
// lane=control/flex, denial=matchup/opportunity y knn=sinergia de pares.
export const TEAM_OPENING_PHASE_ONE_WEIGHTS: PipelineWeights = {
  knn_similarity: 0.2,
  lane_score: 0.55,
  denial_score: 0.25,
};
export const TEAM_OPENING_PHASE_TWO_WEIGHTS: PipelineWeights = {
  knn_similarity: 0.25,
  lane_score: 0.3,
  denial_score: 0.45,
};

export function deriveDynamicPipelineWeights(
  _base: PipelineWeights,
  ownPickCount: number,
  enemyPickCount: number,
): PipelineWeights {
  return ownPickCount + enemyPickCount < OPENING_SPAN
    ? TEAM_OPENING_PHASE_ONE_WEIGHTS
    : TEAM_OPENING_PHASE_TWO_WEIGHTS;
}

// [0, 1]. 1 = draft vacío (apertura pura), 0 = 4 o más picks confirmados entre los dos lados.
export function openingBlend(ownPickCount: number, enemyPickCount: number): number {
  const confirmed = ownPickCount + enemyPickCount;
  return Math.max(0, 1 - confirmed / OPENING_SPAN);
}

// deriva knn_similarity/denial_score por resta, nunca sumando el sobrante -- acumular el error de
// punto flotante en dos operaciones distintas es peor que derivar el tercero por resta, que hace
// que la suma sea 1.0 por construcción, no por casualidad numérica.
export function deriveContinuousPipelineWeights(
  base: PipelineWeights,
  ownPickCount: number,
  enemyPickCount: number,
): PipelineWeights {
  const t = openingBlend(ownPickCount, enemyPickCount);
  const knnSimilarity = base.knn_similarity * (1 - t);
  const laneScore = OPENING_LANE_WEIGHT * t + base.lane_score * (1 - t);
  const denialScore = 1 - knnSimilarity - laneScore;
  return { knn_similarity: knnSimilarity, lane_score: laneScore, denial_score: denialScore };
}
