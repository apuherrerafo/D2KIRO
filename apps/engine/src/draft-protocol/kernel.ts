import { applyCaptainsModeCommand, captainsModeLegalActions, createCaptainsModeState } from "./rulesets/captains-mode";
import { applyRankedAllPickCommand, createRankedAllPickState, rankedAllPickLegalActions } from "./rulesets/ranked-all-pick";
import type {
  DraftProtocolState,
  KernelResult,
  LegalAction,
  PartyContext,
  ProtocolCommand,
  ProtocolEventRecord,
  RejectionReasonV2,
} from "./types";

// R1 S1 -- Protocol Kernel: the ONE authoritative path.
//
//   apply event/command -> validate transition -> update authoritative state -> (project
//   perspective / legalActions are then derivable from the returned state by the caller).
//
// Ruleset modules (rulesets/ranked-all-pick.ts, rulesets/captains-mode.ts) compute the
// ruleset-specific transition only -- they never decide event-log bookkeeping or commitOrdinal
// assignment. That is owned here, centrally, so there is exactly one place that can append to the
// canonical log and exactly one place a caller needs to trust for "did this really happen."
//
// Fail-closed dispatch: an unrecognized ruleset id, or a state already marked DEGRADED, rejects
// every command with RULESET_UNAVAILABLE rather than guessing which ruleset module to invoke.

export type CreateProtocolStateResult =
  | { ok: true; state: DraftProtocolState }
  | { ok: false; reason: "RULESET_LOAD_FAILED"; detail: string };

export function createProtocolState(
  sessionId: string,
  rulesetId: string,
  options: { partyContext?: PartyContext } = {},
): CreateProtocolStateResult {
  if (rulesetId === "dota2/ranked-all-pick") {
    return { ok: true, state: createRankedAllPickState(sessionId, options.partyContext ?? null) };
  }
  if (rulesetId === "dota2/captains-mode") {
    return { ok: true, state: createCaptainsModeState(sessionId) };
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
 */
export function applyProtocolCommand(state: DraftProtocolState, command: ProtocolCommand): KernelResult {
  const ordinal = state.eventLog.length;
  const result = dispatchCommand(state, command, ordinal);
  if (result.rejected) return result;
  const eventRecord: ProtocolEventRecord = { ordinal, command };
  return { state: { ...result.state, eventLog: [...state.eventLog, eventRecord] } };
}

export function legalActions(state: DraftProtocolState): LegalAction[] {
  if (state.status === "DEGRADED") return [];
  if (state.ruleset.id === "dota2/ranked-all-pick") return rankedAllPickLegalActions(state);
  if (state.ruleset.id === "dota2/captains-mode") return captainsModeLegalActions(state);
  return [];
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
  options: { partyContext?: PartyContext } = {},
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
