import type { DraftState } from "../draft/reducer";
import type { HeroId, PartyContext, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { SuggestionSet } from "../signals/mix";
import type { HumanActionability } from "./human-actionability";
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
  /** Explicit simulator discriminator: only simulator sessions target real Own Team positions. */
  isSimulator?: boolean;
  /**
   * PD-026/PD-027 -- Own Team's human-controlled positions for an AP Simulator session
   * (ProtocolSessionMetadata.controlledPositions), and the subset still unfilled
   * (ProtocolSessionStore.humanOpenPositions). Both null for a non-AP-Simulator or legacy session
   * -- the Coach then tags no position at all rather than guessing from round/slotIndex.
   */
  controlledPositions?: readonly Position[] | null;
  humanOpenPositions?: readonly Position[] | null;
  /**
   * WP1 -- ProtocolSessionStore.humanActionability: eligible human positions vs. current round
   * capacity vs. yield. `null`/absent for a non-AP-Simulator or legacy session, which then keeps the
   * pre-WP1 slot derivation exactly as it was.
   */
  humanActionability?: HumanActionability | null;
  /**
   * P0-2 (INV-BIND-001) -- the AUTHORITATIVE own-team position binding for each currently-visible
   * own hero (ProtocolSessionStore.ownAssignedPositionForHero, sealed-time truth, never
   * re-inferred). OWN-SIDE ONLY (PD-027 point 5): no enemy position, confirmed or private, is ever
   * representable here. `null`/absent for a non-AP-Simulator or legacy session, same convention as
   * `controlledPositions`/`humanOpenPositions` above -- the Coach then has no authoritative binding
   * to consult and keeps reasoning from RoleBelief inference alone, exactly as before this field
   * existed.
   */
  ownAssignedPositions?: ReadonlyMap<HeroId, Position> | null;
  /**
   * Party 5 / Team preset hero pools mapped by position (1..5). When present, evaluating target position P
   * scores candidates with position P's pool instead of the single personal account pool.
   */
  playerPoolsByPosition?: Partial<Record<Position, readonly HeroId[]>> | null;
  /** A live Dota capture session (the game is the source of truth; no Simulator, no Enemy Bot). */
  liveCapture?: boolean;
  /** Live capture only: what our own picks say about positions no single binding covers (live-position-resolver.ts). */
  ownPositionOccupancy?: OwnPositionOccupancy | null;
}

/**
 * Own side only. `necessarilyOccupied` includes every bound position plus those our picks fill whichever hero is
 * which; `possiblyOccupied` are positions an own hero of unconfirmed role may be in (never closed, never certain).
 */
export interface OwnPositionOccupancy {
  necessarilyOccupied: readonly Position[];
  possiblyOccupied: readonly Position[];
  unresolvedHeroes: readonly { heroId: HeroId; possiblePositions: readonly Position[] }[];
}

export function poolForPosition(
  playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> | null | undefined,
  position: Position,
): readonly HeroId[] | undefined {
  if (!playerPoolsByPosition) return undefined;
  return playerPoolsByPosition[position];
}

/**
 * Step 1B-B -- the HARD pool of a Party5 position: the configured, NON-EMPTY pool, de-duplicated. `undefined` for an
 * unconfigured or empty pool (that position keeps the credible-universe behaviour). A pool controls ADMISSION only:
 * nothing derived from it is ever a hero -> position identity.
 */
export function configuredPoolForPosition(
  playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> | null | undefined,
  position: Position,
): readonly HeroId[] | undefined {
  const pool = poolForPosition(playerPoolsByPosition, position);
  if (!pool || pool.length === 0) return undefined;
  return [...new Set(pool)];
}

/** Structurally compatible with routes/protocol-sessions.ts's `ComputeSuggestionsForDraftState` --
 * intentionally not imported from there, to avoid a route -> recommendation -> route cycle. */
export type ComputeSuggestionsForRecommendation = (
  state: DraftState,
  accountId: number | null,
  options?: {
    teamOpening?: boolean;
    targetPosition?: 1 | 2 | 3 | 4 | 5;
    usePersonalPool?: boolean;
    diversitySeed?: string;
    candidateHeroIds?: readonly HeroId[];
    overrideHeroPool?: readonly HeroId[];
    /** Step 1B-B: `candidateHeroIds` is a configured Party5 pool -- the final admission, no positional-credibility filter after it. */
    candidateUniverseIsAdmission?: boolean;
  },
) => Promise<SuggestionSet>;

/**
 * Step 1B-B -- the positions that still have something to offer: no configured pool (credible-universe behaviour), or a
 * configured pool with at least one hero not yet banned / picked. A position whose configured pool is exhausted is NOT a
 * viable target. Empty result = every position is exhausted; the caller then reports that truthfully, never falls back.
 */
export function positionsWithPoolOption(
  positions: readonly Position[],
  playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> | null | undefined,
  unavailable: ReadonlySet<HeroId>,
): Position[] {
  return positions.filter((position) => {
    const pool = configuredPoolForPosition(playerPoolsByPosition, position);
    return pool === undefined || pool.some((heroId) => !unavailable.has(heroId));
  });
}

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
