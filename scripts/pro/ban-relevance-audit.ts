export interface BanRelevanceEvidence {
  readonly rolePressureDelta: number;
  readonly matchupDelta?: number | null;
}

export type BanRelevance = "irrelevant" | "pivotal";

/** Clasificación auditable: un ban es pivotal si cambia presión de rol o matchup con evidencia. */
export function classifyBanRelevance(
  evidence: BanRelevanceEvidence,
  roleThreshold = 0.15,
  matchupThreshold = 0.1,
): BanRelevance {
  if (!Number.isFinite(evidence.rolePressureDelta) || evidence.rolePressureDelta < 0) return "irrelevant";
  const matchup = evidence.matchupDelta;
  return evidence.rolePressureDelta >= roleThreshold || (matchup !== null && matchup !== undefined && Number.isFinite(matchup) && Math.abs(matchup) >= matchupThreshold)
    ? "pivotal"
    : "irrelevant";
}
