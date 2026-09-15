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
  type ProtocolCommand,
  type RulesetId,
  type TeamSide,
} from "../draft-protocol";

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
}

interface ProtocolSessionEntry {
  state: DraftProtocolState;
  metadata: ProtocolSessionMetadata;
  lastAccessedAt: number;
}

export type CreateProtocolSessionResult =
  | { ok: true; sessionId: string; state: DraftProtocolState }
  | { ok: false; reason: "SESSION_ALREADY_EXISTS"; detail: string }
  | { ok: false; reason: "CM_REQUIRES_PARTY_SIZE_5"; detail: string }
  | Exclude<CreateProtocolStateResult, { ok: true }>;

export interface CreateProtocolSessionInput {
  sessionId: string;
  rulesetId: RulesetId;
  patch: string;
  partyContext?: PartyContextInput;
  localSide?: TeamSide;
  adapterKind?: "manual" | "simulator";
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
      metadata: { patch: input.patch, partyContext, localSide, adapterKind: input.adapterKind ?? "manual" },
      lastAccessedAt: now,
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

  apply(sessionId: string, command: ProtocolCommand, now = Date.now()): KernelResult | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const result = applyProtocolCommand(entry.state, command);
    entry.state = result.state;
    entry.lastAccessedAt = now;
    return result;
  }

  view(sessionId: string): PerspectiveDraftView | null {
    const state = this.get(sessionId);
    const metadata = this.metadata(sessionId);
    return state && metadata ? project(state, metadata.localSide) : null;
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
    if (command.type === "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION") return false;
    if (command.type === "SUBMIT_SEALED_SELECTION") return command.side === metadata.localSide;
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
      if (action.type === "SUBMIT_SEALED_SELECTION") return action.side === metadata.localSide;
      if (action.type === "CM_ACTION" || action.type === "CM_BAN_SKIPPED" || action.type === "CM_AUTO_PICK") {
        return action.absoluteSide === metadata.localSide;
      }
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
