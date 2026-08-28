/** Shrinkage beta-binomial simple para estimaciones profesionales ruidosas. */
export function shrinkEstimate(observed: number, sampleSize: number, prior = 0.5, priorStrength = 30, minimumSampleSize = 10): number | null {
  if (!Number.isFinite(observed) || observed < 0 || observed > 1 || !Number.isFinite(sampleSize) || sampleSize < minimumSampleSize || priorStrength <= 0) return null;
  return (sampleSize * observed + priorStrength * prior) / (sampleSize + priorStrength);
}
