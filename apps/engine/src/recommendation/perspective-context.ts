import type { DraftState } from "../draft/reducer";
import type { HeroId, PartyContext, PerspectiveDraftView } from "../draft-protocol/types";
import type { SuggestionSet } from "../signals/mix";
import type { RecommendationSlot } from "./types";

// AP Ranked Roles V1 / Wave 2 (product review) -- the PERSPECTIVE-SAFE recommendation input.
//
// The Coach path must not be able to hand authoritative hidden draft information to the
// recommendation substrate. That is enforced STRUCTURALLY, by what this type is able to hold:
//
//   Simulator Truth -> project() / ProtocolSessionStore.perspectiveRecommendationContext()
//     -> PerspectiveRecommendationContext -> buildRecommendationSetFromPerspective() -> V6
//
// Every field below is something the Player already sees or configured:
//   - `view`: a PerspectiveDraftView -- own selections (KNOWN), enemy selections only once REVEALED,
//     confirmed bans, phase/status. Its HIDDEN variant has no `heroId` field at all.
//   - `openOwnSlots`: the seats the Player may seal right now -- exactly the `legalActions` the
//     client-facing snapshot already returns (a seat is a (side, slotIndex); no hero id).
//   - `partyContext`: the Player's own control structure.
//   - `patch`: the game patch.
//
// There is deliberately NO field for: the authoritative protocol state, the current round's sealed
// selections, the Simulator registration ledger, Enemy Bot positions, or the simulator seed (which
// also derives the Bot's private assignments). Hero availability is DERIVED from the view
// (`isHeroSelectableFrom`), never supplied.

export interface PerspectiveRecommendationContext {
  view: PerspectiveDraftView;
  openOwnSlots: readonly RecommendationSlot[];
  partyContext: PartyContext | null;
  patch: string;
}

/** Structurally compatible with routes/protocol-sessions.ts's `ComputeSuggestionsForDraftState` --
 * intentionally not imported from there, to avoid a route -> recommendation -> route cycle. */
export type ComputeSuggestionsForRecommendation = (
  state: DraftState,
  accountId: null,
  options?: {
    teamOpening?: boolean;
    targetPosition?: 1 | 2 | 3 | 4 | 5;
    diversitySeed?: string;
    candidateHeroIds?: readonly HeroId[];
  },
) => Promise<SuggestionSet>;

/** Heroes already gone from THIS side's perspective: banned, our own picks (sealed or confirmed), revealed enemy picks. */
export function unavailableHeroesFrom(view: PerspectiveDraftView): Set<HeroId> {
  const gone = new Set<HeroId>(view.bannedHeroes);
  for (const slot of [...view.ownPicks, ...view.enemyPicks]) if (slot.visibility !== "HIDDEN") gone.add(slot.heroId);
  return gone;
}

/**
 * Perspective-derived twin of the kernel's Ranked All Pick sealed-selection legality (slot open, hero
 * not banned / not confirmed by either side, not already sealed by this side). A selection the ENEMY
 * still holds sealed is deliberately NOT unavailable: a same-hero collision is legal and is resolved
 * at round close -- and nothing in the view could say otherwise, which is the point.
 */
export function isHeroSelectableFrom(context: PerspectiveRecommendationContext, hero: HeroId, slot: RecommendationSlot): boolean {
  if (!Number.isInteger(hero) || hero <= 0) return false;
  if (!context.openOwnSlots.some((open) => open.side === slot.side && open.slotIndex === slot.slotIndex)) return false;
  return !unavailableHeroesFrom(context.view).has(hero);
}
