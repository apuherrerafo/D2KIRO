import { isSealedSelectionLegal } from "../draft-protocol";
import type { DraftProtocolState, HeroId } from "../draft-protocol/types";
import type { DraftState } from "../draft/reducer";
import type { SuggestionSet } from "../signals/mix";
import type { RecommendationSlot } from "./types";

// R1 S5/S6 -- shared legality/transport primitives. Split out of build.ts (S5) so S6's
// opponent-side modeling (opponent-model.ts) can reuse the EXACT same checks and the EXACT same
// V6 entry point build.ts already uses for our own side, without opponent-model.ts importing
// build.ts (which would create build.ts -> lookahead.ts -> opponent-model.ts -> build.ts, a
// cycle). Neither function's behavior, nor this type's shape, changed by this move -- build.ts
// re-exports both verbatim so `recommendation/index.ts`'s public surface is unchanged.

/** Structurally compatible with routes/protocol-sessions.ts's `ComputeSuggestionsForDraftState` --
 * intentionally not imported from there, to avoid a route -> recommendation -> route cycle. */
export type ComputeSuggestionsForRecommendation = (
  state: DraftState,
  accountId: null,
  options?: { teamOpening?: boolean; diversitySeed?: string; candidateHeroIds?: readonly HeroId[] },
) => Promise<SuggestionSet>;

export function excludedHeroes(legacyState: DraftState): Set<HeroId> {
  return new Set([...legacyState.banned, ...legacyState.picks.radiant, ...legacyState.picks.dire]);
}

/** Second, independent legality check against the SAME authoritative state a Recommendation (or,
 * for S6, a plausible opponent response) is about to be built from -- deliberately re-derives
 * legality from `state` directly rather than trusting `excludedHeroes(legacyState)` (the
 * suggestion-bridge projection), so a bridging bug cannot silently produce an illegal action.
 *
 * Blocker 2 (independent architecture review, hidden noninterference): the Ranked All Pick branch
 * used to also treat EVERY currently-sealed hero (both sides, including the opponent's
 * hidden-but-unrevealed selection) as "taken". That is wrong on two counts at once: it is not what
 * the kernel itself enforces (rulesets/ranked-all-pick.ts's own `heroAlreadyTaken` only checks
 * banned + CONFIRMED picks -- a same-hero collision between sides is legal, resolved later at
 * round close), and it let a hidden enemy sealed hero silently change which Recommendations this
 * side sees, purely through presence/absence, before that hero was ever revealed -- a real
 * information leak through an observable side channel. `isSealedSelectionLegal` is the kernel's
 * own per-heroId oracle for this exact slot; reusing it verbatim (instead of re-deriving a second,
 * divergent predicate here) makes it structurally impossible for this check to be either more
 * restrictive OR more permissive than the kernel's own SUBMIT_SEALED_SELECTION acceptance. */
export function postValidateAction(
  state: DraftProtocolState,
  heroId: HeroId,
  eligibleHeroIds: readonly HeroId[] | null,
  slot: RecommendationSlot,
): boolean {
  if (eligibleHeroIds !== null && !eligibleHeroIds.includes(heroId)) return false;
  if (state.rankedAp) {
    return isSealedSelectionLegal(state, slot.side, slot.slotIndex, heroId);
  }
  if (state.captainsMode) {
    // Captain's Mode has no hidden information at all (perspective.ts's own contract: CM picks/
    // bans are immediately REVEALED) -- banned/picked here can never include anything the actor
    // couldn't already see, so no analogous leak exists on this branch.
    const cm = state.captainsMode;
    return !cm.bannedHeroes.includes(heroId) && !cm.picks.radiant.includes(heroId) && !cm.picks.dire.includes(heroId);
  }
  return false;
}
