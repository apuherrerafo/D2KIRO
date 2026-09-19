import { isSealedSelectionLegal, project } from "../draft-protocol";
import { perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { DraftProtocolState, HeroId, TeamSide } from "../draft-protocol/types";
import { isCandidateAdmittedForPosition, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import type { DotaPosition } from "./ap-simulator-policy";
import type { EnemyBotConfig } from "./enemy-bot-roles";
import { chooseExternalSuggestion, deriveExternalDecisionSeed, ENEMY_BOT_SELECTION } from "./enemy-bot-utils";

// AP Ranked Roles V1 -- Enemy Bot.
//
// The Enemy Bot controls all five seats of the side opposite the Player. Each seat has an INTERNAL
// role assignment (Pos1..Pos5) that exists only in Simulator Truth: it is a real constraint on
// which heroes the seat may pick, and it MUST NEVER reach the Player-visible state, the Coach
// state, or recommendation evidence. Nothing in this module returns `internalPositionAssignments`
// to a caller other than the Simulator's own driver (routes/protocol-sessions.ts, postAutoDrive).

export { createEnemyBotConfig, deriveInternalPositionAssignments, type EnemyBotConfig } from "./enemy-bot-roles";

export type BotComputeSuggestions = (
  state: ReturnType<typeof perspectiveToLegacyDraftState>,
  accountId: null,
  options?: {
    teamOpening?: boolean;
    targetPosition?: DotaPosition;
    diversitySeed?: string;
    candidateHeroIds?: readonly number[];
  },
) => Promise<SuggestionSet>;

export interface EnemyBotDecisionInput {
  config: EnemyBotConfig;
  /** Authoritative state -- used ONLY for kernel-legal availability, never for an opponent's hidden picks. */
  state: DraftProtocolState;
  slotIndex: number;
  rosterSlot: number;
  decisionIndex: number;
  patch: string;
  computeSuggestions: BotComputeSuggestions;
  heroPositions: HeroPositions;
}

export interface EnemyBotDecision {
  heroId: HeroId;
  position: DotaPosition;
}

/**
 * Chooses a hero for one open enemy seat.
 *
 * Candidate universe = heroes credibly playable at the seat's assigned position (per the curated
 * position evidence) AND legal for the kernel right now. That restriction is applied BEFORE
 * ranking (V6 only ranks that universe) rather than as a penalty after ranking everything, so an
 * invalid draft (e.g. a hard support in the Pos1 seat) is unreachable, not merely unlikely.
 *
 * Availability follows the kernel's own predicate: a hero the PLAYER has secretly sealed this round
 * is still legal for the bot (the collision is reconciled at reveal). The bot's suggestion input is
 * `project(state, botSide)`, in which the Player's sealed picks are HIDDEN and carry no hero id.
 *
 * Returns null when no admissible hero exists -- the caller must surface that, never fall back to a
 * position-invalid pick.
 */
export async function chooseEnemyBotHero(input: EnemyBotDecisionInput): Promise<EnemyBotDecision | null> {
  const { config, state, slotIndex, rosterSlot, decisionIndex, patch, computeSuggestions, heroPositions } = input;
  const position = config.internalPositionAssignments[rosterSlot];
  if (position === undefined) return null;

  const candidates = Object.keys(heroPositions)
    .map(Number)
    .filter((heroId) => isCandidateAdmittedForPosition(heroId, position, heroPositions))
    .filter((heroId) => isSealedSelectionLegal(state, config.side, slotIndex, heroId));
  if (candidates.length === 0) return null;

  const derivedSeed = deriveExternalDecisionSeed(config.seed, { side: config.side, rosterSlot }, decisionIndex);
  const botView = project(state, config.side);
  const legacyState = perspectiveToLegacyDraftState(botView, { patch });
  const suggestionSet = await computeSuggestions(legacyState, null, {
    teamOpening: false,
    targetPosition: position,
    diversitySeed: derivedSeed,
    candidateHeroIds: candidates,
  });

  const allowed = new Set(candidates);
  const ranked = suggestionSet.suggestions.filter((suggestion) => allowed.has(suggestion.hero));
  const chosen = chooseExternalSuggestion(ranked, derivedSeed, ENEMY_BOT_SELECTION);
  if (!chosen) return null;
  return { heroId: chosen.hero, position };
}
