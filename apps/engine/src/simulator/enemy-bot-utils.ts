import type { TeamSide } from "../draft-protocol/types";
import type { Suggestion } from "../signals/mix";

// Pure, policy-free utilities for simulated (external) participants. Extracted from the old
// SOLO_MID policy so the Enemy Bot depends on nothing but its own parameters.

export interface ExternalSelectionParams {
  /** At most this many candidates are considered inside the quality band. */
  maxCandidates: number;
  /** A hero more than this many score points below the best is never admitted merely for variety. */
  qualityBandPoints: number;
}

export const ENEMY_BOT_SELECTION: Readonly<ExternalSelectionParams> = Object.freeze({
  maxCandidates: 3,
  qualityBandPoints: 5,
});

export function deriveExternalDecisionSeed(
  draftSeed: string,
  participant: { side: TeamSide; rosterSlot: number },
  decisionIndex: number,
): string {
  return `${draftSeed}:${participant.side}:${participant.rosterSlot}:${decisionIndex}`;
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic Top-K / quality-band selection for simulated participants. Within the band we
 * consider at most `maxCandidates` and select by the participant-specific derived seed.
 */
export function chooseExternalSuggestion(
  suggestions: readonly Suggestion[],
  seed: string,
  params: ExternalSelectionParams,
): Suggestion | null {
  const best = suggestions[0];
  if (!best) return null;
  const band = suggestions
    .filter((suggestion) => best.score - suggestion.score <= params.qualityBandPoints)
    .slice(0, params.maxCandidates);
  return band[stableHash(seed) % band.length] ?? best;
}
