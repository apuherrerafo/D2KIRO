import {
  applyProtocolCommand,
  createProtocolState,
  legalActions,
  project,
  type CreateProtocolStateResult,
  type DraftProtocolState,
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
import { rosterSlotForRoundSlot } from "../simulator/ap-simulator-policy";
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
}

interface ProtocolSessionEntry {
  state: DraftProtocolState;
  metadata: ProtocolSessionMetadata;
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
  partyContext?: PartyContextInput;
  localSide?: TeamSide;
  adapterKind?: "manual" | "simulator";
  humanPosition?: 1 | 2 | 3 | 4 | 5;
  simulatorSeed?: string;
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
      },
      lastAccessedAt: now,
      simulatorTimer: null,
      registrations: [],
      nextRegistrationOrdinal: 1,
      clockOffsetMs: 0,
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
    }
    return result;
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
      const ownOpenSlots = round.openSlots.filter((slot) => slot.side === entry.metadata.localSide).map((slot) => slot.slotIndex);
      entry.simulatorTimer = startRoundTimer(round.round, round.collisionsResolved, seatsForOpenSlots(round.round, ownOpenSlots), carried, now);
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
    return { view, openOwnSlots, partyContext: metadata.partyContext, patch: metadata.patch };
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
      return command.side === metadata.localSide || metadata.adapterKind === "manual";
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
      if (action.type === "SUBMIT_SEALED_SELECTION") return action.side === metadata.localSide || metadata.adapterKind === "manual";
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
