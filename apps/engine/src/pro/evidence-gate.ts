export interface EvidenceGateOptions { readonly minimumSampleSize?: number; readonly minimumConfidence?: number; }

export function isProfessionalEvidenceEligible(sampleSize: number, confidenceScore: number, options: EvidenceGateOptions = {}): boolean {
  const minimumSampleSize = options.minimumSampleSize ?? 30;
  const minimumConfidence = options.minimumConfidence ?? 0.6;
  return Number.isFinite(sampleSize) && Number.isFinite(confidenceScore)
    && sampleSize >= minimumSampleSize && confidenceScore > minimumConfidence;
}
