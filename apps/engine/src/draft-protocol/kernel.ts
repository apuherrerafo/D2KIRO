import { createPartyContext } from "./party-context";
import { acceptCmHeroEligibilitySnapshot, isHeroEligible } from "./eligibility";
import { isValidHeroId } from "./hero-id";
import { isPatchWithinRange } from "./patch-range";
import {
  CAPTAINS_MODE_IDENTITY,
  captainsModeAvailableCommands,
  captainsModeLegalGameplayActions,
  captainsModeStepDefinition,
  resolveAbsoluteSide,
} from "./rulesets/captains-mode";
import {
  RANKED_ALL_PICK_IDENTITY,
  isSealedSelectionLegal,
  rankedAllPickAvailableCommands,
  rankedAllPickLegalGameplayActions,
} from "./rulesets/ranked-all-pick";
import { deepClone, deepFreeze } from "./immutable";
import type { PartyContextValidationError } from "./party-context";
import type {
  ControlledSlot,
  CmState,
  ConfirmedPick,
  DraftProtocolState,
  GameplayLegalAction,
  KernelResult,
  LegalAction,
  ProtocolAdminCommand,
  ProtocolCommand,
  ProtocolEventRecord,
  RankedApRoundState,
  RankedApState,
  RejectionReasonV2,
  SealedSelection,
  TeamSide,
} from "./types";

// R1 S1 -- Protocol Kernel: the ONE authoritative path (Blocker 1, independent architecture
// review).
//
//   EXTERNAL CALLERS -> ProtocolKernel (this file) -> validation -> canonical event -> state
//   transition -> eventLog
//
// Ruleset modules expose immutable identity/policy/oracle helpers only. Factories and transition
// reducers are non-exported implementation details in this module, so even a deep import cannot
// bypass createProtocolState/applyProtocolCommand/replayProtocolState. This file also owns
// event-log bookkeeping and collision authority, leaving one place a caller needs to trust for
// "did this really happen."
//
// Fail-closed dispatch: an unrecognized ruleset id, or a state already marked DEGRADED, rejects
// every command with RULESET_UNAVAILABLE rather than guessing which ruleset module to invoke.

export type CreateProtocolStateResult =
  | { ok: true; state: DraftProtocolState }
  | { ok: false; reason: "RULESET_LOAD_FAILED"; detail: string }
  | { ok: false; reason: "INVALID_PARTY_CONTEXT"; detail: string; error: PartyContextValidationError };

/**
 * Untrusted shape for an optional party context -- deliberately NOT `PartyContext` (the validated
 * type). Blocker 4A: a caller constructing `{ partySize: 4, ... }` and handing it to
 * createProtocolState must be rejected HERE, inside the canonical factory, never merely by
 * "remembering" to run it through createPartyContext first -- that dependency on caller discipline
 * is exactly the defect. `partySize: number` (not `PartySize`) is the point: nothing about this
 * input's own type guarantees validity, so the runtime check below is not optional/redundant.
 */
export interface PartyContextInput {
  partySize: number;
  side: TeamSide;
  controlledSlots: ControlledSlot[];
}

const ROUND_CAPACITY: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 1 };

function createRoundState(round: 1 | 2 | 3): RankedApRoundState {
  const capacityPerSide = ROUND_CAPACITY[round];
  const openSlots = [];
  for (const side of ["radiant", "dire"] as const) {
    for (let slotIndex = 0; slotIndex < capacityPerSide; slotIndex += 1) {
      openSlots.push({ side, slotIndex });
    }
  }
  return {
    round,
    capacityPerSide,
    openSlots,
    sealed: [],
    collisionsResolved: 0,
    pendingCollision: null,
    authorityResolutions: [],
  };
}

function createRankedAllPickState(
  sessionId: string,
  partyContext: RankedApState["partyContext"],
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

function createCaptainsModeState(sessionId: string): DraftProtocolState {
  const captainsMode: CmState = {
    firstPickSide: null,
    currentStep: 1,
    history: [],
    bannedHeroes: [],
    picks: { radiant: [], dire: [] },
    eligibilitySnapshot: null,
  };
  return {
    schema: "draft-protocol/v1",
    sessionId,
    ruleset: CAPTAINS_MODE_IDENTITY,
    status: "UNCONFIRMED_STATE",
    degradation: null,
    eventLog: [],
    rankedAp: null,
    captainsMode,
  };
}

function nextPhase(round: 1 | 2 | 3): RankedApState["phase"] {
  if (round === 1) return "PICK_ROUND_2";
  if (round === 2) return "PICK_ROUND_3";
  return "COMPLETE";
}

function phaseForRound(round: 1 | 2 | 3): RankedApState["phase"] {
  if (round === 1) return "PICK_ROUND_1";
  if (round === 2) return "PICK_ROUND_2";
  return "PICK_ROUND_3";
}

function compareSelections(a: SealedSelection, b: SealedSelection): number {
  if (a.side !== b.side) return a.side < b.side ? -1 : 1;
  if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
  return a.heroId - b.heroId;
}

interface ResolveOutcome {
  round: RankedApRoundState | null;
  phase: RankedApState["phase"];
  bannedHeroes: number[];
  confirmedPicks: ConfirmedPick[];
  pending: boolean;
  failed: boolean;
}

function resolveRound(
  round: RankedApRoundState,
  bannedHeroes: number[],
  confirmedPicks: ConfirmedPick[],
): ResolveOutcome {
  const sealed = [...round.sealed].sort(compareSelections);
  const byHero = new Map<number, SealedSelection[]>();
  for (const entry of sealed) {
    const entries = byHero.get(entry.heroId) ?? [];
    entries.push(entry);
    byHero.set(entry.heroId, entries);
  }

  const collisions = [...byHero.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort(([a], [b]) => a - b);
  const nextBanned = [...bannedHeroes];
  const nextConfirmed = [...confirmedPicks];
  const reopened: RankedApRoundState["openSlots"] = [];
  let collisionNumber = round.collisionsResolved;

  for (const [heroId, entries] of collisions) {
    if (entries.length !== 2) {
      return { round: null, phase: phaseForRound(round.round), bannedHeroes, confirmedPicks, pending: false, failed: true };
    }
    collisionNumber += 1;
    if (collisionNumber <= 2) {
      nextBanned.push(heroId);
      reopened.push(...entries.map(({ side, slotIndex }) => ({ side, slotIndex })));
      continue;
    }

    const resolution = round.authorityResolutions.find((candidate) => candidate.heroId === heroId);
    if (!resolution) {
      const contenders = entries
        .map(({ side, slotIndex }) => ({ side, slotIndex }))
        .sort((a, b) => (a.side === b.side ? a.slotIndex - b.slotIndex : a.side < b.side ? -1 : 1));
      return {
        round: {
          ...round,
          openSlots: [],
          sealed,
          pendingCollision: { round: round.round, heroId, contenders: [contenders[0]!, contenders[1]!] },
        },
        phase: phaseForRound(round.round),
        bannedHeroes,
        confirmedPicks,
        pending: true,
        failed: false,
      };
    }

    const winner = entries.find(
      (entry) => entry.side === resolution.winner.side && entry.slotIndex === resolution.winner.slotIndex,
    );
    if (!winner) {
      return { round: null, phase: phaseForRound(round.round), bannedHeroes, confirmedPicks, pending: false, failed: true };
    }
    const loser = entries.find((entry) => entry !== winner)!;
    nextConfirmed.push({ side: winner.side, round: round.round, slotIndex: winner.slotIndex, heroId });
    reopened.push({ side: loser.side, slotIndex: loser.slotIndex });
  }

  for (const [heroId, entries] of byHero.entries()) {
    if (entries.length !== 1) continue;
    const entry = entries[0]!;
    nextConfirmed.push({ side: entry.side, round: round.round, slotIndex: entry.slotIndex, heroId });
  }

  if (reopened.length === 0) {
    const phase = nextPhase(round.round);
    return {
      round: phase === "COMPLETE" ? null : createRoundState((round.round + 1) as 1 | 2 | 3),
      phase,
      bannedHeroes: nextBanned,
      confirmedPicks: nextConfirmed,
      pending: false,
      failed: false,
    };
  }

  return {
    round: {
      round: round.round,
      capacityPerSide: round.capacityPerSide,
      openSlots: reopened.sort((a, b) => (a.side === b.side ? a.slotIndex - b.slotIndex : a.side < b.side ? -1 : 1)),
      sealed: [],
      collisionsResolved: collisionNumber,
      pendingCollision: null,
      authorityResolutions: [],
    },
    phase: phaseForRound(round.round),
    bannedHeroes: nextBanned,
    confirmedPicks: nextConfirmed,
    pending: false,
    failed: false,
  };
}

function rankedStateFromOutcome(state: DraftProtocolState, rankedAp: RankedApState, outcome: ResolveOutcome): KernelResult {
  if (outcome.failed) return { state, rejected: "COLLISION_ORDER_UNAVAILABLE" };
  const nextRankedAp: RankedApState = {
    ...rankedAp,
    phase: outcome.phase,
    bannedHeroes: outcome.bannedHeroes,
    confirmedPicks: outcome.confirmedPicks,
    round: outcome.round,
  };
  if (outcome.pending && outcome.round?.pendingCollision) {
    return {
      state: {
        ...state,
        rankedAp: nextRankedAp,
        status: "WAITING_FOR_COLLISION_AUTHORITY",
        degradation: {
          reason: "COLLISION_AUTHORITY_REQUIRED",
          detail: `round ${outcome.round.round}, hero ${outcome.round.pendingCollision.heroId}`,
        },
      },
    };
  }
  return {
    state: {
      ...state,
      rankedAp: nextRankedAp,
      status: outcome.phase === "COMPLETE" ? "COMPLETE" : "ACTIVE",
      degradation: null,
    },
  };
}

function applyRankedAllPickCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  const rankedAp = state.rankedAp;
  if (!rankedAp) return { state, rejected: "RULESET_UNAVAILABLE" };

  if (command.type === "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION") {
    const pending = rankedAp.round?.pendingCollision;
    if (!pending || !rankedAp.round) return { state, rejected: "COLLISION_AUTHORITY_NOT_PENDING" };
    if (!isValidHeroId(command.heroId)) return { state, rejected: "INVALID_HERO_ID" };
    const winnerMatches = pending.contenders.some(
      (contender) => contender.side === command.winner.side && contender.slotIndex === command.winner.slotIndex,
    );
    if (command.round !== pending.round || command.heroId !== pending.heroId || !winnerMatches) {
      return { state, rejected: "COLLISION_RESOLUTION_MISMATCH" };
    }
    const round: RankedApRoundState = {
      ...rankedAp.round,
      pendingCollision: null,
      authorityResolutions: [
        ...rankedAp.round.authorityResolutions,
        { heroId: command.heroId, winner: { ...command.winner } },
      ],
    };
    return rankedStateFromOutcome(state, rankedAp, resolveRound(round, rankedAp.bannedHeroes, rankedAp.confirmedPicks));
  }

  if (rankedAp.round?.pendingCollision) return { state, rejected: "COLLISION_ORDER_UNAVAILABLE" };

  if (command.type === "RECORD_RESOLVED_BANS") {
    if (rankedAp.phase !== "BAN_RESOLUTION" || rankedAp.banResolutionComplete) return { state, rejected: "WRONG_PHASE" };
    if (!command.heroes.every(isValidHeroId)) return { state, rejected: "INVALID_HERO_ID" };
    if (new Set(command.heroes).size !== command.heroes.length) return { state, rejected: "DUPLICATE_HERO_IN_ROUND" };
    if (command.heroes.some((heroId) => rankedAp.bannedHeroes.includes(heroId))) return { state, rejected: "HERO_ALREADY_TAKEN" };
    return { state: { ...state, rankedAp: { ...rankedAp, bannedHeroes: [...rankedAp.bannedHeroes, ...command.heroes] } } };
  }

  if (command.type === "BAN_RESOLUTION_COMPLETE") {
    if (rankedAp.phase !== "BAN_RESOLUTION") return { state, rejected: "WRONG_PHASE" };
    if (rankedAp.banResolutionComplete) return { state, rejected: "ALREADY_RESOLVED" };
    return {
      state: {
        ...state,
        rankedAp: { ...rankedAp, banResolutionComplete: true, phase: "PICK_ROUND_1", round: createRoundState(1) },
      },
    };
  }

  if (command.type === "SUBMIT_SEALED_SELECTION") {
    if (!rankedAp.round) return { state, rejected: "WRONG_PHASE" };
    if (!isValidHeroId(command.heroId)) return { state, rejected: "INVALID_HERO_ID" };
    if (!isSealedSelectionLegal(state, command.side, command.slotIndex, command.heroId)) {
      const sameSideDuplicate = rankedAp.round.sealed.some(
        (entry) => entry.side === command.side && entry.heroId === command.heroId,
      );
      if (sameSideDuplicate) return { state, rejected: "DUPLICATE_HERO_IN_ROUND" };
      const open = rankedAp.round.openSlots.some(
        (slot) => slot.side === command.side && slot.slotIndex === command.slotIndex,
      );
      if (!open) return { state, rejected: "SLOT_NOT_OPEN" };
      return { state, rejected: "HERO_ALREADY_TAKEN" };
    }
    const sealedEntry: SealedSelection = { side: command.side, slotIndex: command.slotIndex, heroId: command.heroId };
    const round: RankedApRoundState = {
      ...rankedAp.round,
      openSlots: rankedAp.round.openSlots.filter(
        (slot) => !(slot.side === command.side && slot.slotIndex === command.slotIndex),
      ),
      sealed: [...rankedAp.round.sealed, sealedEntry],
    };
    if (round.openSlots.length > 0) return { state: { ...state, rankedAp: { ...rankedAp, round } } };
    return rankedStateFromOutcome(state, rankedAp, resolveRound(round, rankedAp.bannedHeroes, rankedAp.confirmedPicks));
  }

  return { state, rejected: "WRONG_ACTION_KIND" };
}

function cmHeroAlreadyTaken(cm: CmState, heroId: number): boolean {
  return cm.bannedHeroes.includes(heroId) || cm.picks.radiant.includes(heroId) || cm.picks.dire.includes(heroId);
}

function applyCaptainsModeCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  const cm = state.captainsMode;
  if (!cm) return { state, rejected: "RULESET_UNAVAILABLE" };
  if (command.type === "CONFIRM_FIRST_PICK_SIDE") {
    if (cm.firstPickSide !== null) return { state, rejected: "ALREADY_RESOLVED" };
    return { state: { ...state, captainsMode: { ...cm, firstPickSide: command.side }, status: "ACTIVE" } };
  }
  if (command.type === "LOAD_CM_ELIGIBILITY") {
    const accepted = acceptCmHeroEligibilitySnapshot(command.snapshot);
    if (!accepted) return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    if (!isPatchWithinRange(accepted.patch, state.ruleset.applicableFromPatch, state.ruleset.verifiedThroughPatch)) {
      return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    }
    return { state: { ...state, captainsMode: { ...cm, eligibilitySnapshot: accepted } } };
  }
  if (command.type === "CM_ACTION" || command.type === "CM_BAN_SKIPPED" || command.type === "CM_AUTO_PICK") {
    if (cm.firstPickSide === null) return { state, rejected: "UNCONFIRMED_STATE" };
    const stepDef = captainsModeStepDefinition(cm.currentStep);
    if (!stepDef) return { state, rejected: "STEP_AFTER_COMPLETION" };
    if (stepDef.actor !== command.actor) return { state, rejected: "WRONG_ACTOR" };
    if (command.type === "CM_BAN_SKIPPED") {
      if (stepDef.kind !== "BAN") return { state, rejected: "WRONG_ACTION_KIND" };
      const currentStep = cm.currentStep + 1;
      return {
        state: {
          ...state,
          captainsMode: {
            ...cm,
            currentStep,
            history: [...cm.history, { step: stepDef.step, outcome: { kind: "BAN_SKIPPED" } }],
          },
          status: currentStep > 24 ? "COMPLETE" : "ACTIVE",
        },
      };
    }
    const expectedKind = command.type === "CM_AUTO_PICK" ? "PICK" : command.kind;
    if (stepDef.kind !== expectedKind) return { state, rejected: "WRONG_ACTION_KIND" };
    if (!isValidHeroId(command.heroId)) return { state, rejected: "INVALID_HERO_ID" };
    if (!cm.eligibilitySnapshot) return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    if (!isHeroEligible(cm.eligibilitySnapshot, command.heroId)) return { state, rejected: "HERO_INELIGIBLE" };
    if (cmHeroAlreadyTaken(cm, command.heroId)) return { state, rejected: "HERO_ALREADY_TAKEN" };
    const currentStep = cm.currentStep + 1;
    const outcome = command.type === "CM_AUTO_PICK"
      ? ({ kind: "AUTO_PICK", heroId: command.heroId } as const)
      : ({ kind: "HERO", heroId: command.heroId } as const);
    const history = [...cm.history, { step: stepDef.step, outcome }];
    if (stepDef.kind === "BAN") {
      return {
        state: {
          ...state,
          captainsMode: { ...cm, currentStep, history, bannedHeroes: [...cm.bannedHeroes, command.heroId] },
          status: currentStep > 24 ? "COMPLETE" : "ACTIVE",
        },
      };
    }
    const absoluteSide = resolveAbsoluteSide(stepDef.actor, cm.firstPickSide);
    return {
      state: {
        ...state,
        captainsMode: {
          ...cm,
          currentStep,
          history,
          picks: {
            radiant: absoluteSide === "radiant" ? [...cm.picks.radiant, command.heroId] : cm.picks.radiant,
            dire: absoluteSide === "dire" ? [...cm.picks.dire, command.heroId] : cm.picks.dire,
          },
        },
        status: currentStep > 24 ? "COMPLETE" : "ACTIVE",
      },
    };
  }
  return { state, rejected: "WRONG_ACTION_KIND" };
}

export function createProtocolState(
  sessionId: string,
  rulesetId: string,
  options: { partyContext?: PartyContextInput } = {},
): CreateProtocolStateResult {
  let partyContext = null;
  if (options.partyContext) {
    const validated = createPartyContext(
      options.partyContext.partySize,
      options.partyContext.side,
      options.partyContext.controlledSlots,
    );
    if (validated.error) {
      return {
        ok: false,
        reason: "INVALID_PARTY_CONTEXT",
        detail: `party context rejected: ${validated.error}`,
        error: validated.error,
      };
    }
    partyContext = validated.context;
  }

  if (rulesetId === "dota2/ranked-all-pick") {
    return { ok: true, state: deepFreeze(createRankedAllPickState(sessionId, partyContext)) };
  }
  if (rulesetId === "dota2/captains-mode") {
    return { ok: true, state: deepFreeze(createCaptainsModeState(sessionId)) };
  }
  return { ok: false, reason: "RULESET_LOAD_FAILED", detail: `unknown ruleset id: ${rulesetId}` };
}

function dispatchCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  if (state.status === "DEGRADED") return { state, rejected: "RULESET_UNAVAILABLE" as RejectionReasonV2 };
  if (state.ruleset.id === "dota2/ranked-all-pick") return applyRankedAllPickCommand(state, command);
  if (state.ruleset.id === "dota2/captains-mode") return applyCaptainsModeCommand(state, command);
  return { state, rejected: "RULESET_UNAVAILABLE" };
}

function canonicalEventLogAfterAcceptance(
  state: DraftProtocolState,
  command: ProtocolCommand,
): ProtocolEventRecord[] {
  const appended: ProtocolEventRecord[] = [
    ...state.eventLog,
    { ordinal: state.eventLog.length, command: deepClone(command) },
  ];
  const round = state.rankedAp?.round;
  if (command.type !== "SUBMIT_SEALED_SELECTION" || !round || round.openSlots.length !== 1) {
    return appended;
  }

  // A sealed batch is simultaneous by protocol. Once its final slot arrives, canonicalize only
  // that batch so transport arrival order cannot leak into replay or authoritative hashes.
  const batchSize = round.sealed.length + 1;
  const prefixLength = appended.length - batchSize;
  const prefix = appended.slice(0, prefixLength);
  const batch = appended.slice(prefixLength).sort((a, b) => {
    const left = a.command;
    const right = b.command;
    if (left.type !== "SUBMIT_SEALED_SELECTION" || right.type !== "SUBMIT_SEALED_SELECTION") return 0;
    if (left.side !== right.side) return left.side < right.side ? -1 : 1;
    if (left.slotIndex !== right.slotIndex) return left.slotIndex - right.slotIndex;
    return left.heroId - right.heroId;
  });
  return [...prefix, ...batch].map((event, ordinal) => ({ ...event, ordinal }));
}

/**
 * The single authoritative apply path. A rejected command never mutates the event log or the
 * ruleset-specific state -- the returned `state` on rejection is referentially the same object
 * passed in whenever the sub-reducer itself made no change (both ruleset modules already follow
 * this discipline: every rejection branch returns the original `state` untouched).
 *
 * Third-and-later collisions never use this call's arrival position as authority. The kernel
 * pauses in WAITING_FOR_COLLISION_AUTHORITY and accepts a separate, validated resolution command.
 * Completed sealed batches are canonicalized because their commands are simultaneous by contract.
 *
 * Blocker 2: `command` is deep-cloned before being stored in the event record -- a caller
 * mutating the ORIGINAL command object they passed in, after this call returns, must never be
 * able to reach into eventLog and corrupt history/replay output. The returned state is also
 * deep-frozen before being handed back, so no one (including internal code, by accident) can
 * mutate the kernel's own copy in place either.
 */
export function applyProtocolCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  const result = dispatchCommand(state, command);
  if (result.rejected) return result;
  return { state: deepFreeze({ ...result.state, eventLog: canonicalEventLogAfterAcceptance(state, command) }) };
}

/**
 * Protocol/administrative commands currently accepted -- see the LegalAction doc block in
 * types.ts for the admin-vs-gameplay split rationale (Blocker 3).
 */
export function availableCommands(state: DraftProtocolState): ProtocolAdminCommand[] {
  if (state.status === "DEGRADED") return [];
  if (state.ruleset.id === "dota2/ranked-all-pick") return deepFreeze(rankedAllPickAvailableCommands(state));
  if (state.ruleset.id === "dota2/captains-mode") return deepFreeze(captainsModeAvailableCommands(state));
  return [];
}

/**
 * Hero-targeting gameplay actions currently legal -- see the LegalAction doc block in types.ts.
 * Empty once the ruleset reaches COMPLETE, and empty for Captain's Mode while UNCONFIRMED_STATE,
 * matching the kernel's own fail-closed gates exactly (kernel.test.ts / captains-mode.test.ts
 * cross-check this against actual applyProtocolCommand acceptance).
 */
export function legalGameplayActions(state: DraftProtocolState): GameplayLegalAction[] {
  if (state.status === "DEGRADED") return [];
  if (state.ruleset.id === "dota2/ranked-all-pick") return deepFreeze(rankedAllPickLegalGameplayActions(state));
  if (state.ruleset.id === "dota2/captains-mode") return deepFreeze(captainsModeLegalGameplayActions(state));
  return [];
}

/** Convenience aggregate: everything currently legal, admin and gameplay together. */
export function legalActions(state: DraftProtocolState): LegalAction[] {
  return [...availableCommands(state), ...legalGameplayActions(state)];
}

/**
 * Reconstructs canonical state from ruleset + initial config + a canonical event list. A rejected
 * command inside the replayed sequence simply does not advance state (same "a rejected event
 * never corrupts prior state" discipline as the legacy reducer) -- replay never throws on an
 * individually-illegal historical command, it just reproduces exactly what the live kernel did.
 */
export function replayProtocolState(
  sessionId: string,
  rulesetId: string,
  events: readonly ProtocolCommand[],
  options: { partyContext?: PartyContextInput } = {},
): CreateProtocolStateResult {
  const created = createProtocolState(sessionId, rulesetId, options);
  if (!created.ok) return created;
  let state = created.state;
  for (const command of events) {
    state = applyProtocolCommand(state, command).state;
  }
  return { ok: true, state };
}

export { project } from "./perspective";
