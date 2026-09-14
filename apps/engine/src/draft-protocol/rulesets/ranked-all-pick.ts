import { canonicalHash } from "../hash";
import { isValidHeroId } from "../hero-id";
import type {
  ConfirmedPick,
  DraftProtocolState,
  GameplayLegalAction,
  HeroId,
  KernelResult,
  OpenSlot,
  PartyContext,
  ProtocolAdminCommand,
  ProtocolCommand,
  RankedApRoundState,
  RankedApState,
  RulesetIdentity,
  SealedSelection,
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
// 1-2 of the round) or is awarded to the authoritative lower commitOrdinal (collision 3+); losing
// slots reopen. commitOrdinal is assigned by the kernel at acceptance time (= event ordinal in the
// canonical log) -- never inferred from frontend arrival order.

const ROUND_CAPACITY: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 1 };
const ROUND_TIMER_MS: Record<1 | 2 | 3, number> = { 1: 25000, 2: 25000, 3: 20000 };

const SOURCE_MANIFEST = {
  phases: ["BAN_RESOLUTION", "PICK_ROUND_1", "PICK_ROUND_2", "PICK_ROUND_3", "COMPLETE"],
  capacityPerSide: ROUND_CAPACITY,
  baseTimeMs: ROUND_TIMER_MS,
  collisionPolicy: {
    roundsOneAndTwo: "BAN_AND_REPICK",
    roundThreeAndBeyond: "AUTHORITATIVE_LOWER_COMMIT_ORDINAL",
  },
};

const SOURCE_MANIFEST_HASH = canonicalHash(SOURCE_MANIFEST);

export const RANKED_ALL_PICK_IDENTITY: RulesetIdentity = Object.freeze({
  id: "dota2/ranked-all-pick",
  version: "1.0.0",
  rulesHash: canonicalHash({ id: "dota2/ranked-all-pick", version: "1.0.0", manifest: SOURCE_MANIFEST }),
  applicableFromPatch: "7.35d",
  verifiedThroughPatch: "7.41e",
  sourceManifestHash: SOURCE_MANIFEST_HASH,
});

function createRoundState(round: 1 | 2 | 3): RankedApRoundState {
  const capacityPerSide = ROUND_CAPACITY[round];
  const openSlots: OpenSlot[] = [];
  for (const side of ["radiant", "dire"] as const) {
    for (let slotIndex = 0; slotIndex < capacityPerSide; slotIndex += 1) {
      openSlots.push({ side, slotIndex });
    }
  }
  return { round, capacityPerSide, openSlots, sealed: [], collisionsResolved: 0 };
}

export function createRankedAllPickState(
  sessionId: string,
  partyContext: PartyContext | null = null,
): DraftProtocolState {
  const rankedAp: RankedApState = {
    phase: "BAN_RESOLUTION",
    banResolutionComplete: false,
    bannedHeroes: [],
    round: null,
    confirmedPicks: [],
    partyContext,
  };
  return {
    schema: "draft-protocol/v1",
    sessionId,
    ruleset: RANKED_ALL_PICK_IDENTITY,
    status: "ACTIVE",
    degradation: null,
    eventLog: [],
    rankedAp,
    captainsMode: null,
  };
}

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
 * this round) -- called both by applyRankedAllPickCommand (as the source of truth) and by tests
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

function nextPhase(round: 1 | 2 | 3): RankedApState["phase"] {
  if (round === 1) return "PICK_ROUND_2";
  if (round === 2) return "PICK_ROUND_3";
  return "COMPLETE";
}

interface ResolveOutcome {
  round: RankedApRoundState | null;
  phase: RankedApState["phase"];
  bannedHeroes: HeroId[];
  confirmedPicks: ConfirmedPick[];
  failed: boolean;
}

/**
 * Resolves a round-close pass: separates non-conflicting sealed selections (confirmed
 * immediately) from colliding ones (processed in ascending heroId order for determinism), applies
 * the frozen collision policy, and either advances phase (all slots settled) or leaves the round
 * open with reopened slots for the next submission cycle.
 */
function resolveRound(
  round: RankedApRoundState,
  bannedHeroes: HeroId[],
  confirmedPicks: ConfirmedPick[],
): ResolveOutcome {
  const sealedSorted = [...round.sealed].sort((a, b) => {
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    return a.slotIndex - b.slotIndex;
  });

  const byHero = new Map<HeroId, SealedSelection[]>();
  for (const entry of sealedSorted) {
    const bucket = byHero.get(entry.heroId) ?? [];
    bucket.push(entry);
    byHero.set(entry.heroId, bucket);
  }

  const nextBanned = [...bannedHeroes];
  const nextConfirmed = [...confirmedPicks];
  const reopened: OpenSlot[] = [];
  let collisionsResolved = round.collisionsResolved;

  const collidingHeroIds = [...byHero.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([heroId]) => heroId)
    .sort((a, b) => a - b);

  for (const heroId of collidingHeroIds) {
    const entries = byHero.get(heroId)!;
    if (entries.length !== 2) {
      // Structurally impossible under capacity <= 2/side with per-side dedup, but fail closed
      // rather than guess at a resolution if it ever happened.
      return { round: null, phase: phaseForRound(round.round), bannedHeroes, confirmedPicks, failed: true };
    }
    collisionsResolved += 1;
    if (collisionsResolved <= 2) {
      nextBanned.push(heroId);
      for (const entry of entries) reopened.push({ side: entry.side, slotIndex: entry.slotIndex });
    } else {
      const a = entries[0]!;
      const b = entries[1]!;
      if (a.commitOrdinal === b.commitOrdinal) {
        return { round: null, phase: phaseForRound(round.round), bannedHeroes, confirmedPicks, failed: true };
      }
      const winner = a.commitOrdinal < b.commitOrdinal ? a : b;
      const loser = a.commitOrdinal < b.commitOrdinal ? b : a;
      nextConfirmed.push({ side: winner.side, round: round.round, slotIndex: winner.slotIndex, heroId });
      reopened.push({ side: loser.side, slotIndex: loser.slotIndex });
    }
  }

  for (const [heroId, entries] of byHero.entries()) {
    if (entries.length === 1) {
      const entry = entries[0]!;
      nextConfirmed.push({ side: entry.side, round: round.round, slotIndex: entry.slotIndex, heroId });
    }
  }

  // resolveRound is only ever invoked once every slot in the round has a sealed selection (the
  // caller only calls it when openSlots reaches 0), so the only slots that can still be open
  // after this pass are the ones reopened by collision resolution above.
  const stillOpen = reopened;

  if (stillOpen.length === 0) {
    const advancedPhase = nextPhase(round.round);
    return {
      round: advancedPhase === "COMPLETE" ? null : createRoundState((round.round + 1) as 1 | 2 | 3),
      phase: advancedPhase,
      bannedHeroes: nextBanned,
      confirmedPicks: nextConfirmed,
      failed: false,
    };
  }

  return {
    round: {
      round: round.round,
      capacityPerSide: round.capacityPerSide,
      openSlots: stillOpen,
      sealed: [],
      collisionsResolved,
    },
    phase: phaseForRound(round.round),
    bannedHeroes: nextBanned,
    confirmedPicks: nextConfirmed,
    failed: false,
  };
}

function phaseForRound(round: 1 | 2 | 3): RankedApState["phase"] {
  if (round === 1) return "PICK_ROUND_1";
  if (round === 2) return "PICK_ROUND_2";
  return "PICK_ROUND_3";
}

export function applyRankedAllPickCommand(
  state: DraftProtocolState,
  command: ProtocolCommand,
  ordinal: number,
): KernelResult {
  const rankedAp = state.rankedAp;
  if (!rankedAp) return { state, rejected: "RULESET_UNAVAILABLE" };

  if (command.type === "RECORD_RESOLVED_BANS") {
    if (rankedAp.phase !== "BAN_RESOLUTION" || rankedAp.banResolutionComplete) {
      return { state, rejected: "WRONG_PHASE" };
    }
    const incoming = command.heroes;
    if (!incoming.every(isValidHeroId)) return { state, rejected: "INVALID_HERO_ID" };
    const incomingUnique = new Set(incoming);
    if (incomingUnique.size !== incoming.length) return { state, rejected: "DUPLICATE_HERO_IN_ROUND" };
    if (incoming.some((heroId) => rankedAp.bannedHeroes.includes(heroId))) {
      return { state, rejected: "HERO_ALREADY_TAKEN" };
    }
    const next: RankedApState = { ...rankedAp, bannedHeroes: [...rankedAp.bannedHeroes, ...incoming] };
    return { state: { ...state, rankedAp: next } };
  }

  if (command.type === "BAN_RESOLUTION_COMPLETE") {
    if (rankedAp.phase !== "BAN_RESOLUTION") return { state, rejected: "WRONG_PHASE" };
    if (rankedAp.banResolutionComplete) return { state, rejected: "ALREADY_RESOLVED" };
    const next: RankedApState = {
      ...rankedAp,
      banResolutionComplete: true,
      phase: "PICK_ROUND_1",
      round: createRoundState(1),
    };
    return { state: { ...state, rankedAp: next } };
  }

  if (command.type === "SUBMIT_SEALED_SELECTION") {
    if (!rankedAp.round) return { state, rejected: "WRONG_PHASE" };
    const round = rankedAp.round;
    if (!isValidHeroId(command.heroId)) return { state, rejected: "INVALID_HERO_ID" };
    if (!slotIsOpen(round, command.side, command.slotIndex)) return { state, rejected: "SLOT_NOT_OPEN" };
    if (heroAlreadyTaken(rankedAp, command.heroId)) return { state, rejected: "HERO_ALREADY_TAKEN" };
    if (alreadySealedBySameSide(round, command.side, command.heroId)) {
      return { state, rejected: "DUPLICATE_HERO_IN_ROUND" };
    }

    const sealedEntry: SealedSelection = {
      side: command.side,
      slotIndex: command.slotIndex,
      heroId: command.heroId,
      commitOrdinal: ordinal,
    };
    const updatedRound: RankedApRoundState = {
      ...round,
      openSlots: round.openSlots.filter(
        (slot) => !(slot.side === command.side && slot.slotIndex === command.slotIndex),
      ),
      sealed: [...round.sealed, sealedEntry],
    };

    if (updatedRound.openSlots.length > 0) {
      return { state: { ...state, rankedAp: { ...rankedAp, round: updatedRound } } };
    }

    const outcome = resolveRound(updatedRound, rankedAp.bannedHeroes, rankedAp.confirmedPicks);
    if (outcome.failed) return { state, rejected: "COLLISION_ORDER_UNAVAILABLE" };

    const nextRankedAp: RankedApState = {
      ...rankedAp,
      phase: outcome.phase,
      bannedHeroes: outcome.bannedHeroes,
      confirmedPicks: outcome.confirmedPicks,
      round: outcome.round,
    };
    const nextStatus = outcome.phase === "COMPLETE" ? "COMPLETE" : state.status;
    return { state: { ...state, rankedAp: nextRankedAp, status: nextStatus } };
  }

  return { state, rejected: "WRONG_ACTION_KIND" };
}

/** Protocol/admin commands -- see the LegalAction doc block in ../types.ts for the split rationale. */
export function rankedAllPickAvailableCommands(state: DraftProtocolState): ProtocolAdminCommand[] {
  const rankedAp = state.rankedAp;
  if (!rankedAp) return [];
  if (rankedAp.phase === "BAN_RESOLUTION" && !rankedAp.banResolutionComplete) {
    return [{ type: "RECORD_RESOLVED_BANS" }, { type: "BAN_RESOLUTION_COMPLETE" }];
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
