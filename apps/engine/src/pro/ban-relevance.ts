/** Escala un peso de ban según el pick-rate observado, sin permitir amplificación. */
export function scaleBanWeight(baseWeight: number, pickRate: number, fullRelevanceRate = 0.05): number {
  if (!Number.isFinite(baseWeight) || baseWeight < 0 || !Number.isFinite(pickRate) || pickRate < 0 || fullRelevanceRate <= 0) return 0;
  return baseWeight * Math.min(1, pickRate / fullRelevanceRate);
}
