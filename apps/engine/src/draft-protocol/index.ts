// R1 S1 -- Protocol Kernel public surface. See kernel.ts for the authoritative apply path and
// docs/specs/r1-protocol-kernel.md for the frozen contract this module implements.

export * from "./types";
export { canonicalStringify, sha256Hex, canonicalHash, functionalIdentityHash } from "./hash";
export { isValidPartySize, createPartyContext } from "./party-context";
export type { PartyContextValidationError, PartyContextValidationResult } from "./party-context";
export {
  parseCmHeroEligibilitySnapshot,
  computeEligibilityContentHash,
  verifyEligibilitySnapshotIntegrity,
  acceptCmHeroEligibilitySnapshot,
  isHeroEligible,
} from "./eligibility";
export { project } from "./perspective";
export {
  createProtocolState,
  applyProtocolCommand,
  legalActions,
  replayProtocolState,
} from "./kernel";
export type { CreateProtocolStateResult } from "./kernel";
export {
  RANKED_ALL_PICK_IDENTITY,
  createRankedAllPickState,
  applyRankedAllPickCommand,
  rankedAllPickLegalActions,
} from "./rulesets/ranked-all-pick";
export {
  CAPTAINS_MODE_IDENTITY,
  CM_RESERVE_TIME_MS,
  captainsModeStepDefinition,
  resolveAbsoluteSide,
  createCaptainsModeState,
  applyCaptainsModeCommand,
  captainsModeLegalActions,
} from "./rulesets/captains-mode";
