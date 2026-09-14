import { rulesHash } from "../identity-hash";
import { isValidHeroId } from "../hero-id";
import type {
  DraftProtocolState,
  GameplayLegalAction,
  HeroId,
  ProtocolAdminCommand,
  RankedApRoundState,
  RankedApState,
  RulesetIdentity,
  TeamSide,
} from "../types";

// R1 S1 -- Ranked All Pick ruleset. Frozen contract:
//
//   BAN_RESOLUTION -> PICK_ROUND_1 -> PICK_ROUND_2 -> PICK_ROUND_3 -> COMPLETE
//   capacities: round 1: 2/side, round 2: 2/side, round 3: 1/side
//   base timers: 25s, 25s, 20s
//
// Ranked AP bans are NOT interactive in D2KIRO: the kernel only ever receives resolved bans plus
// an explicit ban-resolution-complete signal. It never infers ban completion from a fixed count.
//
// Picks within a round are SEALED (simultaneous, hidden) until round close. At round close:
// non-conflicting selections reveal simultaneously; a colliding hero becomes banned (collisions
// 1-2 of the round) or pauses for a separate externally-authoritative resolution (collision 3+).
// Transport arrival and event-log position never select a winner.

const ROUND_CAPACITY: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 1 };
const ROUND_TIMER_MS: Record<1 | 2 | 3, number> = { 1: 25000, 2: 25000, 3: 20000 };

const SOURCE_MANIFEST = {
  phases: ["BAN_RESOLUTION", "PICK_ROUND_1", "PICK_ROUND_2", "PICK_ROUND_3", "COMPLETE"],
  capacityPerSide: ROUND_CAPACITY,
  baseTimeMs: ROUND_TIMER_MS,
  collisionPolicy: {
    roundsOneAndTwo: "BAN_AND_REPICK",
    roundThreeAndBeyond: "EXTERNAL_AUTHORITY_REQUIRED",
  },
};

const SOURCE_MANIFEST_HASH = rulesHash(SOURCE_MANIFEST);

export const RANKED_ALL_PICK_IDENTITY: RulesetIdentity = Object.freeze({
  id: "dota2/ranked-all-pick",
  version: "1.0.0",
  rulesHash: rulesHash({ id: "dota2/ranked-all-pick", version: "1.0.0", manifest: SOURCE_MANIFEST }),
  applicableFromPatch: "7.35d",
  verifiedThroughPatch: "7.41e",
  sourceManifestHash: SOURCE_MANIFEST_HASH,
});

function heroAlreadyTaken(rankedAp: RankedApState, heroId: HeroId): boolean {
  if (rankedAp.bannedHeroes.includes(heroId)) return true;
  if (rankedAp.confirmedPicks.some((pick) => pick.heroId === heroId)) return true;
  return false;
}

function slotIsOpen(round: RankedApRoundState, side: TeamSide, slotIndex: number): boolean {
  return round.openSlots.some((slot) => slot.side === side && slot.slotIndex === slotIndex);
}

function alreadySealedBySameSide(round: RankedApRoundState, side: TeamSide, heroId: HeroId): boolean {
  return round.sealed.some((entry) => entry.side === side && entry.heroId === heroId);
}

/**
 * Blocker 3: the exact per-heroId predicate mirroring the kernel's own SUBMIT_SEALED_SELECTION
 * acceptance logic (slot open, heroId not already taken, heroId not already sealed by this side
 * this round) -- called both by the kernel reducer (as the source of truth) and by tests
 * proving legalActions/kernel parity. Ranked All Pick has no bounded hero catalog in S1 (no
 * eligibility mechanism was ever built for it), so this is the oracle for AP hero-level legality:
 * a PREDICATE over an unbounded heroId domain, not an enumeration -- unlike Captain's Mode, where
 * `cmRemainingEligibleHeroIds` (captains-mode.ts) genuinely can enumerate every legal heroId
 * because the eligibility snapshot bounds the domain.
 */
export function isSealedSelectionLegal(
  state: DraftProtocolState,
  side: TeamSide,
  slotIndex: number,
  heroId: HeroId,
): boolean {
  const rankedAp = state.rankedAp;
  if (!rankedAp || !rankedAp.round) return false;
  if (!isValidHeroId(heroId)) return false;
  if (!slotIsOpen(rankedAp.round, side, slotIndex)) return false;
  if (heroAlreadyTaken(rankedAp, heroId)) return false;
  if (alreadySealedBySameSide(rankedAp.round, side, heroId)) return false;
  return true;
}

/** Protocol/admin commands -- see the LegalAction doc block in ../types.ts for the split rationale. */
export function rankedAllPickAvailableCommands(state: DraftProtocolState): ProtocolAdminCommand[] {
  const rankedAp = state.rankedAp;
  if (!rankedAp) return [];
  if (rankedAp.phase === "BAN_RESOLUTION" && !rankedAp.banResolutionComplete) {
    return [{ type: "RECORD_RESOLVED_BANS" }, { type: "BAN_RESOLUTION_COMPLETE" }];
  }
  if (rankedAp.round?.pendingCollision) {
    return [{ type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION" }];
  }
  return [];
}

/**
 * Gameplay legal actions -- one entry per currently-open slot. Each entry names a (side,
 * slotIndex) rather than a fixed heroId list, because AP has no bounded hero catalog in S1 (see
 * isSealedSelectionLegal above); COMPLETE (round === null) -> []; empty round -> [] by
 * construction whenever no slots remain open.
 */
export function rankedAllPickLegalGameplayActions(state: DraftProtocolState): GameplayLegalAction[] {
  const rankedAp = state.rankedAp;
  if (!rankedAp || !rankedAp.round) return [];
  return rankedAp.round.openSlots.map((slot) => ({
    type: "SUBMIT_SEALED_SELECTION" as const,
    side: slot.side,
    slotIndex: slot.slotIndex,
  }));
}
