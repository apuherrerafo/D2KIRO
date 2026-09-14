// R1 S1 -- Protocol Kernel public surface. See kernel.ts for the authoritative apply path and
// .kiro/specs/r1-protocol-kernel/design.md for the frozen contract this module implements.
//
// Blocker 1 (independent architecture review): this is the ONLY supported entry point for
// mutating protocol state. applyRankedAllPickCommand/applyCaptainsModeCommand and
// createRankedAllPickState/createCaptainsModeState are intentionally NOT exported here anymore --
// they remain internal pure functions inside rulesets/*.ts (their own *.test.ts files import them
// directly, same discipline as any other internal module), reachable ONLY through
// createProtocolState/applyProtocolCommand below, which own event-log bookkeeping and
// commitOrdinal assignment centrally. An external caller that wants to mutate protocol state has
// exactly one path: createProtocolState -> applyProtocolCommand.
//
// Blocker 5: hashing is exposed only through the four named, purpose-specific functions in
// identity-hash.ts -- never the generic canonicalHash/functionalIdentityHash primitives (those
// stay internal to hash.ts; nothing stops a generic "hash(x)" from being pointed at authoritative,
// currently-hidden state and the result mistaken for something safe to expose to a client).

export * from "./types";
export { isValidPartySize, createPartyContext } from "./party-context";
export type { PartyContextValidationError, PartyContextValidationResult } from "./party-context";
export {
  parseCmHeroEligibilitySnapshot,
  computeEligibilityContentHash,
  verifyEligibilitySnapshotIntegrity,
  acceptCmHeroEligibilitySnapshot,
  isHeroEligible,
} from "./eligibility";
export { isValidHeroId } from "./hero-id";
export { isPatchWithinRange } from "./patch-range";
export { authoritativeStateHash, perspectiveStateHash, rulesHash, eligibilityHash } from "./identity-hash";
export { project } from "./perspective";
export {
  createProtocolState,
  applyProtocolCommand,
  availableCommands,
  legalGameplayActions,
  legalActions,
  replayProtocolState,
} from "./kernel";
export type { CreateProtocolStateResult, PartyContextInput } from "./kernel";
export { RANKED_ALL_PICK_IDENTITY, isSealedSelectionLegal } from "./rulesets/ranked-all-pick";
export { CAPTAINS_MODE_IDENTITY, CM_RESERVE_TIME_MS, captainsModeStepDefinition, resolveAbsoluteSide } from "./rulesets/captains-mode";
