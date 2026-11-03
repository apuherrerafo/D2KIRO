import { isSealedSelectionLegal, project } from "../draft-protocol";
import { perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { DraftProtocolState, HeroId, TeamSide } from "../draft-protocol/types";
import { isCandidateAdmittedForPosition, type HeroPositions } from "../signals/hero-positions";
import type { DotaPosition } from "./ap-simulator-policy";
import type { BotComputeSuggestions } from "./enemy-bot";
import { chooseExternalSuggestion, deriveExternalDecisionSeed, ENEMY_BOT_SELECTION } from "./enemy-bot-utils";

// AP Ranked Roles V1 -- Ally Bot.
//
// The Ally Bot simulates non-controlled allied seats in Ranked All Pick Simulator sessions (Party 1, 2, 3).
//
// Responsibilities:
// - chooses only legal, available heroes (isSealedSelectionLegal)
// - respects bans and already-picked heroes (isSealedSelectionLegal)
// - respects assigned position (isCandidateAdmittedForPosition)
// - uses only information an allied player is allowed to know (project(state, side))
// - strictly never accesses hidden enemy hero IDs (guaranteed by perspective projection)
// - deterministic from simulation seed (deriveExternalDecisionSeed)
// - uses existing scoring/candidate infrastructure (computeSuggestions + chooseExternalSuggestion)
// - does not create a second recommendation engine

export const ALLY_BOT_SELECTION = ENEMY_BOT_SELECTION;

export interface AllyBotDecisionInput {
  seed: string;
  side: TeamSide;
  state: DraftProtocolState;
  slotIndex: number;
  rosterSlot: number;
  position: DotaPosition;
  decisionIndex: number;
  patch: string;
  computeSuggestions: BotComputeSuggestions;
  heroPositions: HeroPositions;
}

export interface AllyBotDecision {
  heroId: HeroId;
  position: DotaPosition;
}

/**
 * Chooses a hero for one uncontrolled allied seat.
 *
 * Candidate universe = heroes credibly playable at the seat's assigned position (per curated
 * position evidence) AND legal for the kernel right now.
 *
 * Availability follows the kernel's own predicate: a hero the enemy may have secretly sealed this
 * round is still available (collision reconciled at reveal). The bot's suggestion input is
 * `project(state, side)`, in which unrevealed enemy picks are HIDDEN and carry no hero ID.
 *
 * Returns null when no admissible hero exists.
 */
export async function chooseAllyBotHero(input: AllyBotDecisionInput): Promise<AllyBotDecision | null> {
  const { seed, side, state, slotIndex, rosterSlot, position, decisionIndex, patch, computeSuggestions, heroPositions } = input;

  const candidates = Object.keys(heroPositions)
    .map(Number)
    .filter((heroId) => isCandidateAdmittedForPosition(heroId, position, heroPositions))
    .filter((heroId) => isSealedSelectionLegal(state, side, slotIndex, heroId));
  if (candidates.length === 0) return null;

  const derivedSeed = deriveExternalDecisionSeed(seed, { side, rosterSlot }, decisionIndex);
  const allyView = project(state, side);
  const legacyState = perspectiveToLegacyDraftState(allyView, { patch });
  const suggestionSet = await computeSuggestions(legacyState, null, {
    teamOpening: false,
    targetPosition: position,
    diversitySeed: derivedSeed,
    candidateHeroIds: candidates,
  });

  const allowed = new Set(candidates);
  const ranked = suggestionSet.suggestions.filter((suggestion) => allowed.has(suggestion.hero));
  const chosen = chooseExternalSuggestion(ranked, derivedSeed, ALLY_BOT_SELECTION);
  if (!chosen) return null;
  return { heroId: chosen.hero, position };
}
