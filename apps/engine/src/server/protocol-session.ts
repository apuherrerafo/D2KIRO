import {
  applyProtocolCommand,
  createProtocolState,
  legalActions,
  project,
  type CreateProtocolStateResult,
  type DraftProtocolState,
  type HeroId,
  type KernelResult,
  type LegalAction,
  type PartyContext,
  type PartyContextInput,
  type PerspectiveDraftView,
  parseTrustedEligibilityArtifact,
  isTrustedServerOnlyCommand,
  type CmHeroEligibilitySnapshot,
  type ProtocolCommand,
  type RejectionReasonV2,
  type RulesetId,
  type TeamSide,
} from "../draft-protocol";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { deriveHumanActionability, type HumanActionability } from "../recommendation/human-actionability";
import { rosterSlotForRoundSlot, type DotaPosition } from "../simulator/ap-simulator-policy";
import type { CollisionRegistrationEvidence, RegistrationRecord } from "../draft-protocol/adapters/simulator-authority";
import { isApSimulatorMetadata } from "../simulator/session-config";
import {
  confirmSeat,
  emptyCarried,
  goldPenaltyAt,
  seatsForOpenSlots,
  startRoundTimer,
  timerViewAt,
  type SimulatorTimerRuntime,
  type SimulatorTimerView,
} from "../simulator/timer";

// R1 S2.1/S2.5/S3 -- ProtocolSessionStore: the session-management layer for kernel-backed drafts.
// Mirrors server/session.ts's shape (in-memory Map, lastAccessedAt, evictStale/TTL) so it reads
// like the same codebase, but wraps DraftProtocolState/applyProtocolCommand (draft-protocol/)
// instead of the legacy DraftState/applyDraftEvent (draft/reducer.ts) -- this is the NEW
// authoritative session path for both rulesets. The legacy SessionStore is untouched by this file
// and keeps serving whatever traffic hasn't migrated yet.
//
// PartyContext for Captain's Mode is carried here, in session metadata, rather than inside
// CmState -- S1's CmState (draft-protocol/types.ts) is frozen and has no party slot (only
// RankedApState does); retrofitting a frozen type for a purely structural, non-rule-affecting
// concern is not the kind of "S1 bug fix" the shared engineering rules permit. Ranked All Pick
// already threads it through kernel state itself (S1 design), and metadata mirrors that value too
// so callers can read `partyContext(sessionId)` uniformly regardless of ruleset.

const PROTOCOL_SESSION_TTL_MS = 45 * 60 * 1000; // same policy as server/session.ts's SessionStore

export interface ProtocolSessionMetadata {
  /** Current game patch, e.g. "7.41e" -- not protocol data; used by adapters/suggestion-bridge.ts. */
  patch: string;
  partyContext: PartyContext | null;
  localSide: TeamSide;
  adapterKind: "manual" | "simulator";
  /**
   * The Player's declared PERSONAL position (AP Ranked Roles V1: required for every seeded
   * Simulator session). It identifies which of the five known roles is the Player's own; it never
   * decides when that hero is picked. `null` only for legacy / non-AP-Simulator sessions.
   */
  humanPosition: 1 | 2 | 3 | 4 | 5 | null;
  simulatorSeed: string | null;
  /**
   * PD-026/PD-027 -- Own Team's HUMAN-controlled positions for an AP Simulator session. This, not
   * `partyContext.controlledSlots` (structural/inert for AP -- see party-context.ts), is the
   * source of truth for "which positions may a human submit for." `null` for non-AP-Simulator
   * sessions (Manual/Captain's Mode), which keep using `partyContext.controlledSlots` unchanged.
   */
  controlledPositions: DotaPosition[] | null;
}

/** Session-layer (never kernel) binding of a sealed Own Team selection to the human-chosen position it fills. */
export interface OwnPickPositionBinding {
  round: 1 | 2 | 3;
  /** The round-scoped kernel slotIndex this binding was sealed against (ROUND-SCOPED SLOT semantics unchanged). */
  slotIndex: number;
  assignedPosition: DotaPosition;
}

/**
 * Public, own-side-only projection of an `OwnPickPositionBinding`: the binding JOINED against
 * authoritative kernel state on (round, slotIndex), never a second stored copy of the hero. The
 * web renders Own Team hero-by-position straight from this -- it never reconstructs it from pick
 * chronology, array order or seat arithmetic (position != pick order != slot).
 */
export interface OwnAssignedPositionProjection extends OwnPickPositionBinding {
  heroId: HeroId;
}

export type ApSimulatorOwnSelectionResult =
  | { ok: true; state: DraftProtocolState; ownAssignedPositions: OwnPickPositionBinding[] }
  | {
      ok: false;
      reason:
        | "session_not_found"
        | "not_ap_simulator"
        | "not_own_side"
        | "no_open_round"
        | "round_slot_not_open"
        | "position_not_controlled"
        | "position_already_filled"
        | "round_yielded"
        | "kernel_rejected";
      rejected?: RejectionReasonV2;
    };

export type YieldRoundResult = { ok: true } | { ok: false; reason: "session_not_found" | "not_ap_simulator" | "no_open_round" | "round_already_yielded" | "no_ally_bot_capacity" | "ally_bot_cannot_absorb_capacity" };

interface ProtocolSessionEntry {
  state: DraftProtocolState;
  metadata: ProtocolSessionMetadata;
  ownerAccountId: number | null;
  lastAccessedAt: number;
  /** Simulator-layer timing (outside the kernel). Null until the Player is first handed control of a round. */
  simulatorTimer: SimulatorTimerRuntime | null;
  /**
   * Registration ledger (Task 11). OUTSIDE DraftProtocolState: the kernel canonicalizes arrival
   * order on purpose, so the order in which this store ACCEPTED each SUBMIT_SEALED_SELECTION is kept
   * here, for the Simulator collision-#3 authority only. Append-only, never fed back to the kernel,
   * never part of any replay or state hash.
   */
  registrations: RegistrationRecord[];
  nextRegistrationOrdinal: number;
  /**
   * TEST-ONLY skew added to the clock the Simulator TIMER layer reads (never the kernel, never
   * session eviction). Always 0 unless advanceTestClock was called, which only the test-gated route
   * can do -- see ProtocolSessionRouteDeps.allowTestClockControl.
   */
  clockOffsetMs: number;
  /**
   * PD-026/PD-027 -- Own Team truth: which (round, roundSlot) sealed a given human-controlled
   * position. Session-layer only, never fed back into the kernel. A binding is added ONLY after
   * the kernel accepts the matching SUBMIT_SEALED_SELECTION (applyApSimulatorOwnSelection), and is
   * pruned the moment its (round, slotIndex) reopens (collision reconciliation).
   */
  ownPickPositions: OwnPickPositionBinding[];
  /** Rounds (by number) in which the human explicitly yielded remaining Own Team capacity to the Ally Bot. */
  roundYielded: Set<number>;
}

export type CreateProtocolSessionResult =
  | { ok: true; sessionId: string; state: DraftProtocolState }
  | { ok: false; reason: "SESSION_ALREADY_EXISTS"; detail: string }
  | { ok: false; reason: "CM_REQUIRES_PARTY_SIZE_5"; detail: string }
  | Exclude<CreateProtocolStateResult, { ok: true }>;

export type TrustedEligibilityLoadResult =
  | { ok: true; snapshot: CmHeroEligibilitySnapshot }
  | { ok: false; reason: "SESSION_NOT_FOUND" | "ELIGIBILITY_UNVERIFIED" | RejectionReasonV2 };

export interface CreateProtocolSessionInput {
  sessionId: string;
  rulesetId: RulesetId;
  patch: string;
  /** Verified HTTP identity; null is reserved for server-side and local test sessions. */
  ownerAccountId?: number | null;
  partyContext?: PartyContextInput;
  localSide?: TeamSide;
  adapterKind?: "manual" | "simulator";
  humanPosition?: 1 | 2 | 3 | 4 | 5;
  simulatorSeed?: string;
  /** PD-026/PD-027 -- Own Team's human-controlled positions (AP Simulator only). See ProtocolSessionMetadata.controlledPositions. */
  controlledPositions?: DotaPosition[];
}

function oppositeSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

export class ProtocolSessionStore {
  private readonly sessions = new Map<string, ProtocolSessionEntry>();

  create(input: CreateProtocolSessionInput, now = Date.now()): CreateProtocolSessionResult {
    if (this.sessions.has(input.sessionId)) {
      return { ok: false, reason: "SESSION_ALREADY_EXISTS", detail: `session ${input.sessionId} already exists` };
    }
    // S3.2 (frozen product requirement for this wave): Captain's Mode party size is exactly 5 --
    // enforced here, at the session boundary, rather than inside the frozen CmState/kernel.
    if (input.rulesetId === "dota2/captains-mode" && input.partyContext?.partySize !== 5) {
      return {
        ok: false,
        reason: "CM_REQUIRES_PARTY_SIZE_5",
        detail: `Captain's Mode requires PartyContext with partySize 5, got ${input.partyContext?.partySize ?? "missing"}`,
      };
    }
    const localSide = input.localSide ?? input.partyContext?.side ?? "radiant";
    if (input.partyContext && input.partyContext.side !== localSide) {
      return { ok: false, reason: "INVALID_PARTY_CONTEXT", detail: "party side must match localSide", error: "SLOT_SIDE_MISMATCH" };
    }
    const created = createProtocolState(input.sessionId, input.rulesetId, { partyContext: input.partyContext });
    if (!created.ok) return created;

    const partyContext = created.state.rankedAp?.partyContext ?? this.buildStandalonePartyContext(input.partyContext);
    this.sessions.set(input.sessionId, {
      state: created.state,
      metadata: {
        patch: input.patch,
        partyContext,
        localSide,
        adapterKind: input.adapterKind ?? "manual",
        humanPosition: input.humanPosition ?? null,
        simulatorSeed: input.simulatorSeed ?? null,
        controlledPositions: input.controlledPositions ?? null,
      },
      ownerAccountId: input.ownerAccountId ?? null,
      lastAccessedAt: now,
      simulatorTimer: null,
      registrations: [],
      nextRegistrationOrdinal: 1,
      clockOffsetMs: 0,
      ownPickPositions: [],
      roundYielded: new Set(),
    });
    return { ok: true, sessionId: input.sessionId, state: created.state };
  }

  /** For Captain's Mode (no kernel-level party slot): re-derive the same PartyContext shape createProtocolState would have validated, purely for metadata mirroring. */
  private buildStandalonePartyContext(input: PartyContextInput | undefined): PartyContext | null {
    if (!input) return null;
    return { partySize: input.partySize as PartyContext["partySize"], side: input.side, controlledSlots: input.controlledSlots };
  }

  get(sessionId: string, now = Date.now()): DraftProtocolState | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    entry.lastAccessedAt = now;
    return entry.state;
  }

  metadata(sessionId: string): ProtocolSessionMetadata | null {
    return this.sessions.get(sessionId)?.metadata ?? null;
  }

  /** null = session absent; local/test sessions deliberately have no HTTP owner. */
  isOwnedBy(sessionId: string, accountId: number): boolean | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return entry.ownerAccountId === accountId;
  }

  partyContext(sessionId: string): PartyContext | null {
    return this.sessions.get(sessionId)?.metadata.partyContext ?? null;
  }

  apply(sessionId: string, command: ProtocolCommand, now?: number): KernelResult | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const previous = entry.state;
    const result = applyProtocolCommand(entry.state, command);
    entry.state = result.state;
    entry.lastAccessedAt = now ?? Date.now();
    if (!result.rejected) {
      this.recordRegistration(entry, previous, command);
      this.recordSeatConfirmation(entry, previous, command, now ?? Date.now() + entry.clockOffsetMs);
      this.pruneReopenedOwnPickPositions(entry);
    }
    return result;
  }

  /**
   * PD-026/PD-027 COLLISION CONSISTENCY -- any binding whose (round, slotIndex) is, right now,
   * back among the current round's open slots for the local side has been reopened (a collision
   * reconciliation reopens the LOSING side's slot). Drop it: the winner's own binding (a
   * different slotIndex) is untouched, and the reopened position becomes selectable again. Runs
   * after every successful kernel apply, from whichever path triggered it (a direct Own Team
   * submission, a bot pick, or collision-authority resolution) -- never special-cased per caller.
   */
  private pruneReopenedOwnPickPositions(entry: ProtocolSessionEntry): void {
    if (entry.ownPickPositions.length === 0) return;
    const round = entry.state.rankedAp?.round;
    if (!round) return;
    const reopened = new Set(
      round.openSlots.filter((slot) => slot.side === entry.metadata.localSide && slot.slotIndex !== undefined).map((slot) => slot.slotIndex),
    );
    if (reopened.size === 0) return;
    entry.ownPickPositions = entry.ownPickPositions.filter((binding) => !(binding.round === round.round && reopened.has(binding.slotIndex)));
  }

  /**
   * PD-026/PD-027 -- the ONE atomic session-layer operation for an AP Simulator Own Team
   * selection. Binds `assignedPosition` to the sealed selection IFF and ONLY IF the kernel
   * accepts the matching command: no precondition failure ever mutates the kernel, and a kernel
   * rejection never leaves a stray binding. See CLAUDE.md-adjacent task spec (PD-026/PD-027) for
   * the exact precondition order this mirrors.
   */
  /**
   * PD-026/PD-027 -- the ONE atomic session-layer operation for a CLIENT-FACING (human) AP
   * Simulator Own Team selection. `assignedPosition` must be one of the session's
   * `controlledPositions` -- this is the trust boundary the postCommand route relies on. Internal
   * Ally Bot picks (its own complement positions, never client-reachable) go through
   * `applyAllyBotSelection` instead, which shares every other precondition and the same
   * kernel-then-bind atomicity, just against a different allowed-position set.
   */
  applyApSimulatorOwnSelection(
    sessionId: string,
    command: Extract<ProtocolCommand, { type: "SUBMIT_SEALED_SELECTION" }>,
    assignedPosition: DotaPosition,
    now = Date.now(),
  ): ApSimulatorOwnSelectionResult {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.metadata.controlledPositions) return { ok: false, reason: "not_ap_simulator" };
    // WP1 (INV-OWN-004) -- a yielded round's remaining own capacity belongs to the Ally Bot: no
    // human selection is accepted for it, even while unbound human positions remain. Checked before
    // anything else can touch the kernel. The Ally Bot path (applyAllyBotSelection) is unaffected.
    if (this.hasYieldedCurrentRound(sessionId)) return { ok: false, reason: "round_yielded" };
    return this.applyOwnTeamPositionSelection(sessionId, command, assignedPosition, entry.metadata.controlledPositions, now);
  }

  /** Internal-only counterpart of `applyApSimulatorOwnSelection` for the Ally Bot's own (uncontrolled) positions. Never reachable from a client request. */
  applyAllyBotSelection(
    sessionId: string,
    command: Extract<ProtocolCommand, { type: "SUBMIT_SEALED_SELECTION" }>,
    assignedPosition: DotaPosition,
    now = Date.now(),
  ): ApSimulatorOwnSelectionResult {
    const allyPositions = this.allyBotPositions(sessionId);
    if (!allyPositions) return { ok: false, reason: "not_ap_simulator" };
    return this.applyOwnTeamPositionSelection(sessionId, command, assignedPosition, allyPositions, now);
  }

  private applyOwnTeamPositionSelection(
    sessionId: string,
    command: Extract<ProtocolCommand, { type: "SUBMIT_SEALED_SELECTION" }>,
    assignedPosition: DotaPosition,
    allowedPositions: readonly DotaPosition[],
    now: number,
  ): ApSimulatorOwnSelectionResult {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { ok: false, reason: "session_not_found" };
    const { metadata } = entry;
    if (!isApSimulatorMetadata(metadata) || !metadata.controlledPositions) return { ok: false, reason: "not_ap_simulator" };
    if (command.side !== metadata.localSide) return { ok: false, reason: "not_own_side" };
    const round = entry.state.rankedAp?.round;
    if (!round) return { ok: false, reason: "no_open_round" };
    const slotOpen = round.openSlots.some((slot) => slot.side === command.side && slot.slotIndex === command.slotIndex);
    if (!slotOpen) return { ok: false, reason: "round_slot_not_open" };
    if (!allowedPositions.includes(assignedPosition)) return { ok: false, reason: "position_not_controlled" };
    const alreadyFilled = entry.ownPickPositions.some((binding) => binding.assignedPosition === assignedPosition);
    if (alreadyFilled) return { ok: false, reason: "position_already_filled" };

    const previous = entry.state;
    const result = applyProtocolCommand(previous, command);
    if (result.rejected) return { ok: false, reason: "kernel_rejected", rejected: result.rejected };

    entry.state = result.state;
    entry.lastAccessedAt = now;
    this.recordRegistration(entry, previous, command);
    this.recordSeatConfirmation(entry, previous, command, now + entry.clockOffsetMs);
    entry.ownPickPositions = [...entry.ownPickPositions, { round: round.round, slotIndex: command.slotIndex, assignedPosition }];
    this.pruneReopenedOwnPickPositions(entry);
    return { ok: true, state: entry.state, ownAssignedPositions: [...entry.ownPickPositions] };
  }

  /** Own Team binding projection (session-layer, never kernel state). `[]` for a session with no bindings yet, `null` for an unknown session. */
  ownAssignedPositions(sessionId: string): OwnPickPositionBinding[] | null {
    const entry = this.sessions.get(sessionId);
    return entry ? [...entry.ownPickPositions] : null;
  }

  /**
   * Own Team binding projection ENRICHED with the hero that fills it, for the public snapshot.
   * Each binding is joined against authoritative kernel state on (round, slotIndex), own side
   * only: first the current round's sealed selections (a binding exists the instant its selection
   * is sealed), then `confirmedPicks`. Total for every surviving binding -- a confirmed slot is
   * never reopened, so (side, round, slotIndex) matches at most one kernel record, and a reopened
   * binding has already been pruned (pruneReopenedOwnPickPositions). A binding that somehow
   * matches nothing is dropped, never guessed: no roster fact without an authoritative hero.
   * Only own-side heroes the Player can already see (KNOWN in `view()`) can ever appear here.
   * `null` for an unknown session.
   */
  ownAssignedPositionProjection(sessionId: string): OwnAssignedPositionProjection[] | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const localSide = entry.metadata.localSide;
    const rankedAp = entry.state.rankedAp;
    return entry.ownPickPositions.flatMap((binding) => {
      const sameSlot = (record: { side: TeamSide; slotIndex: number }) => record.side === localSide && record.slotIndex === binding.slotIndex;
      const sealed = rankedAp?.round?.round === binding.round ? rankedAp.round.sealed.find(sameSlot) : undefined;
      const heroId = sealed?.heroId ?? rankedAp?.confirmedPicks.find((pick) => pick.round === binding.round && sameSlot(pick))?.heroId;
      return heroId === undefined ? [] : [{ ...binding, heroId }];
    });
  }

  /**
   * PD-026/PD-027 MANUAL POSITION ASSIGNMENT -- the queue-bound position for an already-sealed own
   * hero, if any. Cross-references the kernel's confirmed picks (side/round/slotIndex/heroId)
   * against the session-layer binding for that same (round, slotIndex). `null` when the hero was
   * never queue-bound (picked before `controlledPositions` existed, or not an own pick at all).
   */
  ownAssignedPositionForHero(sessionId: string, heroId: number): DotaPosition | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const localSide = entry.metadata.localSide;
    // A pick is bound the instant it is SEALED (own picks are visible to the Player immediately,
    // long before the kernel's own round-resolution "confirmed" concept) -- check the current
    // round's sealed selections first, then fall back to confirmedPicks for earlier rounds.
    const round = entry.state.rankedAp?.round;
    if (round) {
      const sealed = round.sealed.find((selection) => selection.side === localSide && selection.heroId === heroId);
      if (sealed) {
        const binding = entry.ownPickPositions.find((b) => b.round === round.round && b.slotIndex === sealed.slotIndex);
        if (binding) return binding.assignedPosition;
      }
    }
    const confirmed = entry.state.rankedAp?.confirmedPicks.find((pick) => pick.side === localSide && pick.heroId === heroId);
    if (!confirmed) return null;
    const binding = entry.ownPickPositions.find((b) => b.round === confirmed.round && b.slotIndex === confirmed.slotIndex);
    return binding?.assignedPosition ?? null;
  }

  /** `controlledPositions` minus positions already bound. `null` for a non-AP-Simulator or unknown session. */
  humanOpenPositions(sessionId: string): DotaPosition[] | null {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.metadata.controlledPositions) return null;
    const filled = new Set(entry.ownPickPositions.map((binding) => binding.assignedPosition));
    return entry.metadata.controlledPositions.filter((position) => !filled.has(position));
  }

  /** The complement of `controlledPositions` within 1..5 -- the positions the Ally Bot owns. `null` for a non-AP-Simulator or unknown session. */
  allyBotPositions(sessionId: string): DotaPosition[] | null {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.metadata.controlledPositions) return null;
    const controlled = new Set(entry.metadata.controlledPositions);
    return ([1, 2, 3, 4, 5] as DotaPosition[]).filter((position) => !controlled.has(position));
  }

  /**
   * WP1 -- the ONE server-derived HumanActionability projection (recommendation/human-actionability.ts):
   * eligible human positions, kept apart from how many picks fit this round, and whether a yield
   * removed the human action. `null` for a non-AP-Simulator session or one without
   * `controlledPositions` (Manual / Captain's Mode / legacy), which keep their previous behaviour.
   */
  humanActionability(sessionId: string): HumanActionability | null {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.metadata.controlledPositions || !isApSimulatorMetadata(entry.metadata)) return null;
    const localSide = entry.metadata.localSide;
    const openOwnRoundSlots = entry.state.rankedAp?.round?.openSlots.filter((slot) => slot.side === localSide).length ?? 0;
    return deriveHumanActionability({
      humanOpenPositions: this.humanOpenPositions(sessionId) ?? [],
      openOwnRoundSlots,
      yieldedCurrentRound: this.hasYieldedCurrentRound(sessionId),
      draftComplete: entry.state.status === "COMPLETE",
    });
  }

  hasYieldedCurrentRound(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    const round = entry?.state.rankedAp?.round?.round;
    if (!entry || !round) return false;
    return entry.roundYielded.has(round);
  }

  /**
   * P0-3 (INV-YIELD-001) -- the SINGLE precondition check `yieldRound()` enforces, factored out so
   * it can also be read WITHOUT the side effect (`canYield()` below). This is the one and only
   * place the "can the Ally Bot legally absorb this round's remaining Own Team capacity" logic is
   * allowed to live -- `apps/web` must never re-derive or approximate it (task section 7: "Do NOT
   * make the Web duplicate the server's Ally Bot absorption formula").
   */
  private yieldPrecondition(sessionId: string): YieldRoundResult {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { ok: false, reason: "session_not_found" };
    if (!isApSimulatorMetadata(entry.metadata) || !entry.metadata.controlledPositions) return { ok: false, reason: "not_ap_simulator" };
    const round = entry.state.rankedAp?.round;
    if (!round) return { ok: false, reason: "no_open_round" };
    if (entry.roundYielded.has(round.round)) return { ok: false, reason: "round_already_yielded" };
    const allyPositions = this.allyBotPositions(sessionId) ?? [];
    if (allyPositions.length === 0) return { ok: false, reason: "no_ally_bot_capacity" };
    const filled = new Set(entry.ownPickPositions.map((binding) => binding.assignedPosition));
    const unfilledAllyPositions = allyPositions.filter((position) => !filled.has(position)).length;
    const openOwnRoundSlots = round.openSlots.filter((slot) => slot.side === entry.metadata.localSide).length;
    if (unfilledAllyPositions < openOwnRoundSlots) return { ok: false, reason: "ally_bot_cannot_absorb_capacity" };
    return { ok: true };
  }

  /**
   * PD-026/PD-027 ALLY BOT SCHEDULING -- the human explicitly hands the round's remaining Own
   * Team capacity to the Ally Bot. Rejected (never silently accepted) when the Ally Bot cannot
   * legally absorb that capacity: a yield the bot could not honor would strand the round with
   * open own-side slots and nobody able to fill them.
   */
  yieldRound(sessionId: string): YieldRoundResult {
    const precondition = this.yieldPrecondition(sessionId);
    if (!precondition.ok) return precondition;
    const entry = this.sessions.get(sessionId)!;
    const round = entry.state.rankedAp!.round!;
    entry.roundYielded.add(round.round);
    return { ok: true };
  }

  /**
   * P0-3 (INV-YIELD-001) -- whether `POST /yield` would accept right now, WITHOUT calling it. The
   * one source of truth the public snapshot exposes (`snapshotBody().canYield`,
   * routes/protocol-sessions.ts) so `apps/web` reads server truth directly instead of maintaining
   * its own approximation of this precondition.
   */
  canYield(sessionId: string): boolean {
    return this.yieldPrecondition(sessionId).ok;
  }

  /**
   * Assigns the next monotonic ordinal to an ACCEPTED SUBMIT_SEALED_SELECTION -- and only to those:
   * a rejected command never reaches this method. The attempt (collisionsResolved) is read from
   * the state the command was accepted AGAINST, so a reopened seat new selection belongs to the
   * new attempt. An integer sequence, not a wall clock: it gives a strict deterministic order.
   */
  private recordRegistration(entry: ProtocolSessionEntry, previous: DraftProtocolState, command: ProtocolCommand): void {
    if (command.type !== "SUBMIT_SEALED_SELECTION") return;
    const round = previous.rankedAp?.round;
    if (!round) return;
    entry.registrations.push({
      ordinal: entry.nextRegistrationOrdinal,
      round: round.round,
      collisionsResolved: round.collisionsResolved,
      side: command.side,
      slotIndex: command.slotIndex,
      heroId: command.heroId,
    });
    entry.nextRegistrationOrdinal += 1;
  }

  /**
   * Ordering evidence for the collision the kernel is currently paused on. Null when there is no
   * open round. The evidence carries the current attempt (collisionsResolved) so
   * resolveSimulatorCollisionAuthority can ignore every earlier attempt and every earlier round.
   */
  registrationEvidence(sessionId: string): CollisionRegistrationEvidence | null {
    const entry = this.sessions.get(sessionId);
    const round = entry?.state.rankedAp?.round;
    if (!entry || !round) return null;
    return { collisionsResolved: round.collisionsResolved, records: [...entry.registrations] };
  }

  /**
   * Applies `commands` all-or-nothing: if the kernel rejects any of them, the session is left
   * exactly as it was. Used where a half-applied sequence would strand a session (e.g. ban
   * resolution: recording the bans without completing the phase).
   */
  applyAtomically(
    sessionId: string,
    commands: readonly ProtocolCommand[],
    now = Date.now(),
  ): { ok: true; state: DraftProtocolState } | { ok: false; rejected: RejectionReasonV2; index: number } | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    let state = entry.state;
    const staged: { previous: DraftProtocolState; command: ProtocolCommand }[] = [];
    for (const [index, command] of commands.entries()) {
      const result = applyProtocolCommand(state, command);
      if (result.rejected) return { ok: false, rejected: result.rejected, index };
      staged.push({ previous: state, command });
      state = result.state;
    }
    entry.state = state;
    for (const { previous, command } of staged) this.recordRegistration(entry, previous, command);
    entry.lastAccessedAt = now;
    return { ok: true, state };
  }

  /** The seat a Player selection fills stops accruing late-pick penalty the moment it is sealed. */
  private recordSeatConfirmation(
    entry: ProtocolSessionEntry,
    previous: DraftProtocolState,
    command: ProtocolCommand,
    now: number,
  ): void {
    if (command.type !== "SUBMIT_SEALED_SELECTION" || !entry.simulatorTimer) return;
    if (command.side !== entry.metadata.localSide) return;
    const round = previous.rankedAp?.round?.round;
    if (!round) return;
    const seat = rosterSlotForRoundSlot(round, command.slotIndex);
    if (seat === null) return;
    entry.simulatorTimer = confirmSeat(entry.simulatorTimer, seat, now);
  }

  /**
   * Called when the Simulator hands control of a round (or of a collision repick) to the Player.
   * Idempotent per attempt: the timer starts once, on the first call for a given (round, collision
   * count), and any penalty already incurred in earlier attempts is carried over.
   */
  ensureSimulatorTimer(sessionId: string, at?: number): SimulatorTimerView | null {
    const entry = this.sessions.get(sessionId);
    if (!entry || !isApSimulatorMetadata(entry.metadata)) return null;
    const now = at ?? Date.now() + entry.clockOffsetMs;
    const round = entry.state.rankedAp?.round;
    if (!round) return null;
    const key = `${round.round}:${round.collisionsResolved}`;
    if (entry.simulatorTimer?.attemptKey !== key) {
      const carried = entry.simulatorTimer ? goldPenaltyAt(entry.simulatorTimer, now).bySlot : emptyCarried();
      const ownOpenSlotIndexes = round.openSlots.filter((slot) => slot.side === entry.metadata.localSide).map((slot) => slot.slotIndex);
      let pendingSlotIndexes: number[];
      if (entry.metadata.controlledPositions) {
        // PD-026/PD-027 -- capacity is no longer seat membership: min(open Own Team roundSlots,
        // unfilled human-controlled positions), zero once the human has yielded the round. Which
        // SEAT carries the penalty is still arbitrary bookkeeping (Do NOT re-key gold penalty by
        // position in this P0) -- only the COUNT reflects human-controlled capacity.
        const capacity = this.humanActionability(sessionId)?.roundCapacity ?? 0;
        pendingSlotIndexes = ownOpenSlotIndexes.slice(0, capacity);
      } else {
        const controlledRosterSlots = new Set(
          entry.metadata.partyContext?.controlledSlots
            .filter((slot) => slot.side === entry.metadata.localSide)
            .map((slot) => slot.slotIndex) ?? [0, 1, 2, 3, 4],
        );
        pendingSlotIndexes = ownOpenSlotIndexes.filter((slotIndex) => {
          const rosterSlot = rosterSlotForRoundSlot(round.round, slotIndex);
          return rosterSlot !== null && controlledRosterSlots.has(rosterSlot);
        });
      }
      entry.simulatorTimer = startRoundTimer(round.round, round.collisionsResolved, seatsForOpenSlots(round.round, pendingSlotIndexes), carried, now);
    }
    return timerViewAt(entry.simulatorTimer!, now);
  }

  /**
   * TEST-ONLY: moves the Simulator timer clock of ONE session forward. Lets a browser acceptance
   * test cross a round deadline deterministically instead of sleeping for 25 real seconds.
   */
  advanceTestClock(sessionId: string, ms: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || !Number.isFinite(ms) || ms <= 0) return false;
    entry.clockOffsetMs += ms;
    return true;
  }

  /** Read-only timer projection. Null outside AP Simulator sessions or before the first hand-off. */
  simulatorTimerView(sessionId: string, at?: number): SimulatorTimerView | null {
    const entry = this.sessions.get(sessionId);
    if (!entry?.simulatorTimer || !isApSimulatorMetadata(entry.metadata)) return null;
    const now = at ?? Date.now() + entry.clockOffsetMs;
    return timerViewAt(entry.simulatorTimer, now);
  }

  /**
   * R1 S3 (final trust-boundary repair) -- the ONLY supported way a CM eligibility snapshot
   * enters a session. SERVER/OPERATOR ONLY: `raw` must come from the server side (an approved
   * local artifact, a deployment bootstrap step, a future startup hook -- see
   * draft-protocol/trusted-eligibility.ts), NEVER from a request body. No client-facing route may
   * call this, and `isCommandAuthorized` refuses LOAD_CM_ELIGIBILITY so the public command path
   * cannot reach the same effect by another name.
   *
   * Server-side does not mean unvalidated: `parseTrustedEligibilityArtifact` runs the full
   * acceptCmHeroEligibilitySnapshot gate (OFFICIAL_DEPOT provenance, appId 570, buildId /
   * manifestId / sourceHash cross-consistency, fixed sourcePath, canonical contentHash, sorted
   * unique positive heroIds) and the kernel then applies its own patch-range gate. An artifact
   * that fails anything leaves the session untouched and Captain's Mode fail-closed.
   */
  loadTrustedEligibility(sessionId: string, raw: unknown, now = Date.now()): TrustedEligibilityLoadResult {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { ok: false, reason: "SESSION_NOT_FOUND" };
    const snapshot = parseTrustedEligibilityArtifact(raw);
    if (!snapshot) return { ok: false, reason: "ELIGIBILITY_UNVERIFIED" };
    const result = applyProtocolCommand(entry.state, { type: "LOAD_CM_ELIGIBILITY", snapshot });
    entry.lastAccessedAt = now;
    if (result.rejected) return { ok: false, reason: result.rejected };
    entry.state = result.state;
    return { ok: true, snapshot };
  }

  view(sessionId: string): PerspectiveDraftView | null {
    const state = this.get(sessionId);
    const metadata = this.metadata(sessionId);
    return state && metadata ? project(state, metadata.localSide) : null;
  }

  /**
   * The ONLY thing the Coach's recommendation path is allowed to be built from: the Player's own
   * perspective view, the seats the client-facing `legalActions` already advertises as open, the
   * Player's party structure and the patch. Assembled ONLY from `view()` / `authorizedLegalActions()`
   * / metadata -- the same projections this store already returns to the browser -- so nothing the
   * Player could not already see can enter it (no sealed enemy selection, no registration ledger, no
   * Enemy Bot internals, no simulator seed). Null for an unknown session.
   */
  perspectiveRecommendationContext(sessionId: string): PerspectiveRecommendationContext | null {
    const view = this.view(sessionId);
    const metadata = this.metadata(sessionId);
    const legal = this.authorizedLegalActions(sessionId);
    if (!view || !metadata || !legal) return null;
    const openOwnSlots = legal.flatMap((action) =>
      action.type === "SUBMIT_SEALED_SELECTION" && action.side === metadata.localSide ? [{ side: action.side, slotIndex: action.slotIndex }] : [],
    );
    // P0-2 (INV-BIND-001) -- own-side-only authoritative position bindings for every own hero this
    // side can already legally see (KNOWN/REVEALED; never HIDDEN, which carries no heroId at all).
    // Sourced only from ownAssignedPositionForHero() -- the same session-layer truth
    // humanOpenPositions() itself is built from -- never from RoleBelief or any inference.
    const ownAssignedPositions = metadata.controlledPositions
      ? new Map(
          view.ownPicks.flatMap((slot) => {
            if (slot.visibility === "HIDDEN") return [];
            const assigned = this.ownAssignedPositionForHero(sessionId, slot.heroId);
            return assigned === null ? [] : [[slot.heroId, assigned] as const];
          }),
        )
      : null;
    return {
      view,
      openOwnSlots,
      partyContext: metadata.partyContext,
      patch: metadata.patch,
      isSimulator: metadata.adapterKind === "simulator",
      // PD-026/PD-027 COACH TARGET POSITIONS -- Own Team truth the Coach targets, never a
      // round-seat mapping. Both null for non-AP-Simulator/legacy AP Simulator sessions.
      controlledPositions: metadata.controlledPositions,
      humanOpenPositions: this.humanOpenPositions(sessionId),
      humanActionability: this.humanActionability(sessionId),
      ownAssignedPositions,
    };
  }

  botView(sessionId: string): PerspectiveDraftView | null {
    const state = this.get(sessionId);
    const metadata = this.metadata(sessionId);
    if (!state || !metadata || metadata.adapterKind !== "simulator") return null;
    return project(state, oppositeSide(metadata.localSide));
  }

  isSimulator(sessionId: string): boolean {
    return this.metadata(sessionId)?.adapterKind === "simulator";
  }

  isCommandAuthorized(sessionId: string, command: ProtocolCommand): boolean {
    const state = this.get(sessionId);
    const metadata = this.metadata(sessionId);
    if (!state || !metadata) return false;
    // TRUSTED_SERVER_ONLY (LOAD_CM_ELIGIBILITY): defence in depth. The route rejects it first with
    // an explicit `admin_command_forbidden`, but any other caller reaching the store must hit the
    // same wall -- promoting a snapshot to trusted has exactly one entry point,
    // loadTrustedEligibility(), and it is not this one.
    if (isTrustedServerOnlyCommand(command.type)) return false;
    if (command.type === "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION") return false;
    // AP Simulator sessions: bans come only from the server-side BanResolutionPolicy (fail-closed).
    // A client that could record its own "resolved" bans could skip the policy entirely.
    if (isApSimulatorMetadata(metadata) && (command.type === "RECORD_RESOLVED_BANS" || command.type === "BAN_RESOLUTION_COMPLETE")) {
      return false;
    }
    // The Player controls every seat of their own side; the other side belongs to the Enemy Bot --
    // EXCEPT for a "manual" adapterKind session (Live Companion, no Enemy Bot at all): there, the
    // Player is the sole observer of a REAL match and reports both sides' sealed selections as they
    // are actually revealed. `adapterKind === "simulator"` keeps the exact prior restriction --
    // SIMULATION mode's behavior is unchanged byte-for-byte.
    if (command.type === "SUBMIT_SEALED_SELECTION") {
      if (metadata.adapterKind === "manual") return true;
      if (command.side !== metadata.localSide) return false;
      if (isApSimulatorMetadata(metadata)) {
        if (metadata.controlledPositions) {
          // PD-026/PD-027: for a controlledPositions session, this generic path is defense-in-depth
          // only -- currently UNREACHABLE for an own-side SUBMIT_SEALED_SELECTION, because
          // postCommand dispatches every one of those to applyApSimulatorOwnSelection instead
          // (never through isCommandAuthorized+apply). It authorizes any currently open own-side
          // slot (position is decoupled from round-scoped slot) precisely because the REAL gate --
          // the position binding itself -- lives only in the atomic operation. A future route or
          // caller that mutates an AP-controlledPositions session via store.apply() directly, past
          // this check, would seal a hero without ever binding a position: don't. Route AP Own Team
          // submissions through applyApSimulatorOwnSelection (human) or applyAllyBotSelection
          // (Ally Bot) -- never the generic apply() path.
          const round = state.rankedAp?.round;
          if (!round) return false;
          return round.openSlots.some((slot) => slot.side === command.side && slot.slotIndex === command.slotIndex);
        }
        const round = state.rankedAp?.round?.round;
        if (!round) return false;
        const rosterSlot = rosterSlotForRoundSlot(round, command.slotIndex);
        if (rosterSlot === null) return false;
        const controlledSlots = metadata.partyContext?.controlledSlots;
        if (controlledSlots) {
          return controlledSlots.some((slot) => slot.side === command.side && slot.slotIndex === rosterSlot);
        }
      }
      return true;
    }
    if (command.type === "CM_ACTION" || command.type === "CM_BAN_SKIPPED" || command.type === "CM_AUTO_PICK") {
      return legalActions(state).some((action) => {
        if (action.type !== command.type || action.absoluteSide !== metadata.localSide || action.actor !== command.actor) return false;
        return action.type !== "CM_ACTION" || command.type !== "CM_ACTION" || action.kind === command.kind;
      });
    }
    return true;
  }

  authorizedLegalActions(sessionId: string): LegalAction[] | null {
    const state = this.get(sessionId);
    const metadata = this.metadata(sessionId);
    if (!state || !metadata) return null;
    return legalActions(state).filter((action) => {
      if (isApSimulatorMetadata(metadata) && (action.type === "RECORD_RESOLVED_BANS" || action.type === "BAN_RESOLUTION_COMPLETE")) {
        return false;
      }
      // Same manual-adapter exception as isCommandAuthorized above: a Live Companion session
      // advertises BOTH sides' open seats (the Player must be able to report either one), a
      // Simulator session still only advertises its own.
      if (action.type === "SUBMIT_SEALED_SELECTION") {
        if (metadata.adapterKind === "manual") return true;
        if (action.side !== metadata.localSide) return false;
        if (isApSimulatorMetadata(metadata)) {
          if (metadata.controlledPositions) {
            // PD-026/PD-027: every currently open own-side round slot is advertised -- which
            // human-controlled position it will bind to is the client's choice at submission time,
            // not a fixed seat, so filtering by seat membership here would hide legitimate options.
            return true;
          }
          const round = state.rankedAp?.round?.round;
          if (!round) return false;
          const rosterSlot = rosterSlotForRoundSlot(round, action.slotIndex);
          if (rosterSlot === null) return false;
          const controlledSlots = metadata.partyContext?.controlledSlots;
          if (controlledSlots) {
            return controlledSlots.some((slot) => slot.side === action.side && slot.slotIndex === rosterSlot);
          }
        }
        return true;
      }
      if (action.type === "CM_ACTION" || action.type === "CM_BAN_SKIPPED" || action.type === "CM_AUTO_PICK") {
        return action.absoluteSide === metadata.localSide;
      }
      // A client-facing surface must never ADVERTISE what it will refuse. The kernel legitimately
      // lists LOAD_CM_ELIGIBILITY as always-available (a refreshed snapshot is harmless at any
      // step), but that availability is for the trusted server path only, so it is filtered out
      // here alongside the collision-authority command and its dedicated endpoint.
      if (isTrustedServerOnlyCommand(action.type)) return false;
      return action.type !== "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION";
    });
  }

  legalActions(sessionId: string): LegalAction[] | null {
    const state = this.get(sessionId);
    return state ? legalActions(state) : null;
  }

  get size(): number {
    return this.sessions.size;
  }

  evictStale(now = Date.now(), ttlMs = PROTOCOL_SESSION_TTL_MS): void {
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastAccessedAt > ttlMs) this.sessions.delete(sessionId);
    }
  }
}
