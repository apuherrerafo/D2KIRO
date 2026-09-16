import { cmRemainingEligibleHeroIds } from "../draft-protocol";
import type { DraftProtocolState, HeroId } from "../draft-protocol/types";

// R1 S6 BLOCKER REPAIR -- PROTOCOL AVAILABILITY. Ground truth about whether a hero remains
// certifiable/nameable AT ALL at a given protocol state -- independent of whose turn it is right
// now, and independent of whatever a bounded/ranked V6 shortlist happened to include or truncate.
// Both rulesets share ONE hero pool between sides (a hero banned/picked by either side is gone for
// both), so this is deliberately NOT side-specific: "available to the opponent" and "available to
// us" are the same fact here. This is also deliberately NOT "is it legal for someone to act RIGHT
// NOW" (that is decision.ts/observation-point.ts's job, gated on whose turn it is) -- it only
// answers "does the protocol still certify this hero as nameable", which has no dependency on turn
// order at all.
//
// Reuses the kernel's OWN enumeration/predicate -- never a second, independently-derived copy of
// either (same discipline as legality.ts's own postValidateAction, which reuses
// isSealedSelectionLegal verbatim instead of re-deriving it):
//   - Captain's Mode: `cmRemainingEligibleHeroIds` (draft-protocol/rulesets/captains-mode.ts),
//     already the kernel's own bounded enumeration of "still certifiable right now".
//   - Ranked All Pick: the same `bannedHeroes`/`confirmedPicks` fields
//     rulesets/ranked-all-pick.ts's own `heroAlreadyTaken` reads -- deliberately NOT
//     `isSealedSelectionLegal` (that also gates on slotIsOpen/same-side-duplicate, which is
//     ACTION legality for one specific slot, not "is this hero still nameable by anyone at all").
//     A still-SEALED (not yet confirmed/revealed) selection never counts as "taken" here -- the
//     AP SEALED semantics test (steal.test.ts) depends on this: our own hero being merely sealed
//     must never make it look unavailable to the opponent.

export function isHeroProtocolAvailable(state: DraftProtocolState, heroId: HeroId): boolean {
  if (state.captainsMode) return cmRemainingEligibleHeroIds(state.captainsMode).includes(heroId);
  if (state.rankedAp) {
    return !state.rankedAp.bannedHeroes.includes(heroId) && !state.rankedAp.confirmedPicks.some((pick) => pick.heroId === heroId);
  }
  return false; // RULESET_LOAD_FAILED -- no certified universe of any kind exists
}

/**
 * The candidate universe an OPPONENT VALUE BASELINE may legitimately consider, independent of
 * whose turn it is. Captain's Mode: the exact bounded, certified remaining-eligible set (empty
 * when no snapshot is loaded -- fail-closed, never the global catalog). Ranked All Pick: `null`
 * (unrestricted) -- there is no bounded catalog to enumerate here (same reason decision.ts's own
 * `eligibleHeroIds` is `null` for AP); V6's own candidatePool still excludes banned/confirmed
 * heroes via `mutualVisibilityLegacyState`'s banned/picks, so the exclusion still happens, just not
 * via an enumerated allowlist. Neither branch invents a fake legal action for the opponent -- this
 * is a VALUATION universe, never a decision.
 */
export function deriveOpponentAvailableHeroUniverse(state: DraftProtocolState): readonly HeroId[] | null {
  if (state.captainsMode) return cmRemainingEligibleHeroIds(state.captainsMode);
  if (state.rankedAp) return null;
  return [];
}
