import { createPartyContext } from "./party-context";
import {
  applyCaptainsModeCommand,
  captainsModeAvailableCommands,
  captainsModeLegalGameplayActions,
  createCaptainsModeState,
} from "./rulesets/captains-mode";
import {
  applyRankedAllPickCommand,
  createRankedAllPickState,
  rankedAllPickAvailableCommands,
  rankedAllPickLegalGameplayActions,
} from "./rulesets/ranked-all-pick";
import { deepClone, deepFreeze } from "./immutable";
import type { PartyContextValidationError } from "./party-context";
import type {
  ControlledSlot,
  DraftProtocolState,
  GameplayLegalAction,
  KernelResult,
  LegalAction,
  ProtocolAdminCommand,
  ProtocolCommand,
  ProtocolEventRecord,
  RejectionReasonV2,
  TeamSide,
} from "./types";

// R1 S1 -- Protocol Kernel: the ONE authoritative path (Blocker 1, independent architecture
// review).
//
//   EXTERNAL CALLERS -> ProtocolKernel (this file) -> validation -> canonical event -> state
//   transition -> eventLog
//
// Ruleset modules (rulesets/ranked-all-pick.ts, rulesets/captains-mode.ts) compute the
// ruleset-specific transition only -- they are NOT exported from index.ts (the public barrel) as
// mutation APIs anymore. They remain internal pure functions, importable directly within
// apps/engine/src/draft-protocol/ (their own *.test.ts files do exactly that, the same discipline
// ranked-all-pick.test.ts/captains-mode.test.ts already used), but createProtocolState /
// applyProtocolCommand / replayProtocolState here are the only supported way to mutate protocol
// state from OUTSIDE this module. They never decide event-log bookkeeping or commitOrdinal
// assignment -- that is owned here, centrally, so there is exactly one place that can append to
// the canonical log and exactly one place a caller needs to trust for "did this really happen."
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

function dispatchCommand(state: DraftProtocolState, command: ProtocolCommand, ordinal: number): KernelResult {
  if (state.status === "DEGRADED") return { state, rejected: "RULESET_UNAVAILABLE" as RejectionReasonV2 };
  if (state.ruleset.id === "dota2/ranked-all-pick") return applyRankedAllPickCommand(state, command, ordinal);
  if (state.ruleset.id === "dota2/captains-mode") return applyCaptainsModeCommand(state, command, ordinal);
  return { state, rejected: "RULESET_UNAVAILABLE" };
}

/**
 * The single authoritative apply path. A rejected command never mutates the event log or the
 * ruleset-specific state -- the returned `state` on rejection is referentially the same object
 * passed in whenever the sub-reducer itself made no change (both ruleset modules already follow
 * this discipline: every rejection branch returns the original `state` untouched).
 *
 * --- COMMIT ORDINAL (Blocker 1 / "COLLISION AUTHORITY") -------------------------------------
 * `ordinal = state.eventLog.length` at acceptance time. This is deliberately the SINGLE source of
 * "authoritative commit order" in S1:
 *   - applyProtocolCommand is the one function that can extend eventLog (see the module doc
 *     above) -- nothing else in this codebase writes to it.
 *   - It is synchronous. Two calls on the same `state` cannot interleave.
 *   - `ProtocolCommand` has NO ordinal-shaped field at the type level, and dispatchCommand never
 *     reads anything from `command` to compute `ordinal` -- a caller cannot supply, override, or
 *     influence it, by construction, not by convention.
 * Whatever order distinct calls into applyProtocolCommand happen in on a given `state` therefore
 * IS the authoritative order -- there is no other clock in S1 (no server-receipt-timestamp
 * infrastructure, no distributed consensus; S1 explicitly does not build a transport/adapter
 * layer). "Transport arrival order" only becomes a DIFFERENT thing from "authoritative commit
 * order" once a real network adapter exists in front of this kernel (S2 scope) that could, for
 * example, serialize genuinely-simultaneous submissions through a queue under its own ordering
 * policy before ever calling applyProtocolCommand -- whatever order that future adapter ultimately
 * delivers commands to this function in is what commitOrdinal will reflect, unconditionally and
 * only that. If a collision-resolution pass ever finds two candidates carrying the SAME
 * commitOrdinal (structurally shouldn't happen -- eventLog.length is strictly monotonic), the
 * ruleset rejects the whole submission with COLLISION_ORDER_UNAVAILABLE rather than inventing a
 * winner (ranked-all-pick.ts, resolveRound).
 * ----------------------------------------------------------------------------------------------
 *
 * Blocker 2: `command` is deep-cloned before being stored in the event record -- a caller
 * mutating the ORIGINAL command object they passed in, after this call returns, must never be
 * able to reach into eventLog and corrupt history/replay output. The returned state is also
 * deep-frozen before being handed back, so no one (including internal code, by accident) can
 * mutate the kernel's own copy in place either.
 */
export function applyProtocolCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  const ordinal = state.eventLog.length;
  const result = dispatchCommand(state, command, ordinal);
  if (result.rejected) return result;
  const eventRecord: ProtocolEventRecord = { ordinal, command: deepClone(command) };
  return { state: deepFreeze({ ...result.state, eventLog: [...state.eventLog, eventRecord] }) };
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
