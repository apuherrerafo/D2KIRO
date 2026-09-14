// R1 S1 -- Protocol Kernel canonical types. Frozen contract source: R1 Architecture Review +
// R1 CONTRACT FREEZE (materialized into docs/specs/r1-protocol-kernel.md in this same slice).
//
// This module intentionally lives beside (not inside) apps/engine/src/draft/ -- the legacy
// reducer.ts/turn-clock.ts/draft-format-turns.ts trio remains the authoritative implementation
// backing production traffic (SessionStore, WS, HTTP ingest) for the rest of R1 S1. Wiring the
// kernel into that live path, and migrating apps/web/features/random-draft-simulator off its own
// independent collision/reveal implementation, are explicitly S2 scope (see the "LEGACY /
// MIGRATION" section of the frozen contract and KNOWN DEFERRED in the final report). This file
// defines the *one* new source of protocol truth going forward; nothing here duplicates rules a
// second time -- it supersedes them for new work.

export type HeroId = number;
export type TeamSide = "radiant" | "dire";
export type RelativeSide = "first" | "second";

// ---------------------------------------------------------------------------------------------
// Ruleset identity
// ---------------------------------------------------------------------------------------------

export type RulesetId = "dota2/ranked-all-pick" | "dota2/captains-mode";

export interface RulesetIdentity {
  id: RulesetId;
  version: string;
  /** sha256 hex of the ruleset's own canonical definition (steps/capacities/timers). Deterministic. */
  rulesHash: string;
  applicableFromPatch: string;
  verifiedThroughPatch: string;
  /** sha256 hex of the source manifest (the frozen contract data this ruleset was derived from). */
  sourceManifestHash: string;
}

// ---------------------------------------------------------------------------------------------
// Party context (H0.1 foundation only -- no role inference, no protocol-rule effect)
// ---------------------------------------------------------------------------------------------

export type PartySize = 1 | 2 | 3 | 5;

export interface ControlledSlot {
  side: TeamSide;
  /** 0-based roster slot on `side`, 0..4. */
  slotIndex: number;
  /** Opaque identifier of the human/party member controlling this slot. Structural only. */
  controllerId: string;
}

export interface PartyContext {
  partySize: PartySize;
  side: TeamSide;
  controlledSlots: ControlledSlot[];
}

// ---------------------------------------------------------------------------------------------
// Hidden information / perspective model
// ---------------------------------------------------------------------------------------------

export type Visibility = "KNOWN" | "HIDDEN" | "REVEALED";

/** Discriminated union: a HIDDEN slot structurally cannot carry a heroId. */
export type PerspectiveHeroSlot =
  | { visibility: "KNOWN"; heroId: HeroId }
  | { visibility: "REVEALED"; heroId: HeroId }
  | { visibility: "HIDDEN" };

// ---------------------------------------------------------------------------------------------
// Protocol degradation (fail-closed reasons)
// ---------------------------------------------------------------------------------------------

export type ProtocolDegradationReason =
  | "RULESET_LOAD_FAILED"
  | "RULESET_HASH_MISMATCH"
  | "ELIGIBILITY_UNVERIFIED"
  | "REQUIRED_STATE_MISSING";

export interface ProtocolDegradation {
  reason: ProtocolDegradationReason;
  detail: string;
}

export type ProtocolStatus = "ACTIVE" | "UNCONFIRMED_STATE" | "COMPLETE" | "DEGRADED";

// ---------------------------------------------------------------------------------------------
// Ranked All Pick sub-state
// ---------------------------------------------------------------------------------------------

export type RankedApPhase = "BAN_RESOLUTION" | "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3" | "COMPLETE";

export interface OpenSlot {
  side: TeamSide;
  /** 0-based slot index within the round for that side (round 1/2: 0 or 1; round 3: 0). */
  slotIndex: number;
}

export interface SealedSelection {
  side: TeamSide;
  slotIndex: number;
  heroId: HeroId;
  /** Assigned by the kernel at acceptance time = the event's ordinal in the canonical log. Never client-supplied. */
  commitOrdinal: number;
}

export interface ConfirmedPick {
  side: TeamSide;
  round: 1 | 2 | 3;
  slotIndex: number;
  heroId: HeroId;
}

export interface RankedApRoundState {
  round: 1 | 2 | 3;
  capacityPerSide: number;
  openSlots: OpenSlot[];
  sealed: SealedSelection[];
  /** Round-scoped collision counter (resets to 0 at the start of each round). */
  collisionsResolved: number;
}

export interface RankedApState {
  phase: RankedApPhase;
  banResolutionComplete: boolean;
  bannedHeroes: HeroId[];
  /** null once phase === COMPLETE. */
  round: RankedApRoundState | null;
  confirmedPicks: ConfirmedPick[];
  partyContext: PartyContext | null;
}

// ---------------------------------------------------------------------------------------------
// Captain's Mode sub-state
// ---------------------------------------------------------------------------------------------

export type CmActionKind = "BAN" | "PICK";
export type CmPhaseLabel = "BAN_1" | "PICK_1" | "BAN_2" | "PICK_2" | "BAN_3" | "PICK_3";

export interface CmStepDefinition {
  step: number; // 1..24
  phase: CmPhaseLabel;
  kind: CmActionKind;
  actor: RelativeSide;
  baseTimeMs: number;
}

export type CmStepOutcome =
  | { kind: "HERO"; heroId: HeroId }
  | { kind: "BAN_SKIPPED" }
  | { kind: "AUTO_PICK"; heroId: HeroId };

export interface CmStepRecord {
  step: number;
  outcome: CmStepOutcome;
}

export interface CmHeroEligibilitySnapshot {
  schema: "cm-hero-eligibility/v1";
  appId: 570;
  patch: string;
  buildId: string;
  depotManifests: Record<string, string>;
  sourceHashes: Record<string, string>;
  /** Ordered, unique, CM-eligible hero IDs (HeroID > 0, Enabled == 1, CMEnabled == 1). */
  heroIds: HeroId[];
  contentHash: string;
}

export interface CmState {
  /** null = UNCONFIRMED_STATE. Mandatory before any protocol advancement. */
  firstPickSide: TeamSide | null;
  /** Independent step ordinal, 1..25 (25 = COMPLETE). Never derived by counting picks/bans. */
  currentStep: number;
  history: CmStepRecord[];
  bannedHeroes: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  /** null = no certified snapshot loaded yet -> ELIGIBILITY_UNVERIFIED, no CM hero action possible. */
  eligibilitySnapshot: CmHeroEligibilitySnapshot | null;
}

// ---------------------------------------------------------------------------------------------
// Canonical protocol state envelope
// ---------------------------------------------------------------------------------------------

export interface ProtocolEventRecord {
  ordinal: number;
  command: ProtocolCommand;
}

export interface DraftProtocolState {
  schema: "draft-protocol/v1";
  sessionId: string;
  ruleset: RulesetIdentity;
  status: ProtocolStatus;
  degradation: ProtocolDegradation | null;
  eventLog: ProtocolEventRecord[];
  rankedAp: RankedApState | null;
  captainsMode: CmState | null;
}

// ---------------------------------------------------------------------------------------------
// Commands (input to the kernel) and rejection reasons
// ---------------------------------------------------------------------------------------------

export type ProtocolCommand =
  // Ranked All Pick
  | { type: "RECORD_RESOLVED_BANS"; heroes: HeroId[] }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number; heroId: HeroId }
  // Captain's Mode
  | { type: "CONFIRM_FIRST_PICK_SIDE"; side: TeamSide }
  | { type: "LOAD_CM_ELIGIBILITY"; snapshot: CmHeroEligibilitySnapshot }
  | { type: "CM_ACTION"; actor: RelativeSide; kind: CmActionKind; heroId: HeroId }
  | { type: "CM_BAN_SKIPPED"; actor: RelativeSide }
  | { type: "CM_AUTO_PICK"; actor: RelativeSide; heroId: HeroId };

export type RejectionReasonV2 =
  | "RULESET_UNAVAILABLE"
  | "UNCONFIRMED_STATE"
  | "WRONG_ACTOR"
  | "WRONG_ACTION_KIND"
  | "STEP_AFTER_COMPLETION"
  | "HERO_INELIGIBLE"
  | "HERO_ALREADY_TAKEN"
  | "ELIGIBILITY_UNVERIFIED"
  | "WRONG_PHASE"
  | "SLOT_NOT_OPEN"
  | "INVALID_PARTY_SIZE"
  | "COLLISION_ORDER_UNAVAILABLE"
  | "DUPLICATE_HERO_IN_ROUND"
  | "ALREADY_RESOLVED";

export interface KernelResult {
  state: DraftProtocolState;
  rejected?: RejectionReasonV2;
}

// ---------------------------------------------------------------------------------------------
// Legal action oracle
// ---------------------------------------------------------------------------------------------

export type LegalAction =
  | { type: "RECORD_RESOLVED_BANS" }
  | { type: "BAN_RESOLUTION_COMPLETE" }
  | { type: "SUBMIT_SEALED_SELECTION"; side: TeamSide; slotIndex: number; eligibleHeroIds: "any_uncontested" }
  | { type: "CONFIRM_FIRST_PICK_SIDE" }
  | { type: "LOAD_CM_ELIGIBILITY" }
  | { type: "CM_ACTION"; step: number; actor: RelativeSide; kind: CmActionKind }
  | { type: "CM_BAN_SKIPPED"; step: number; actor: RelativeSide }
  | { type: "CM_AUTO_PICK"; step: number; actor: RelativeSide };

// ---------------------------------------------------------------------------------------------
// Perspective (hidden-information projection)
// ---------------------------------------------------------------------------------------------

export interface PerspectiveDraftView {
  schema: "draft-protocol-perspective/v1";
  sessionId: string;
  ruleset: RulesetIdentity;
  status: ProtocolStatus;
  degradation: ProtocolDegradation | null;
  viewerSide: TeamSide | null;
  bannedHeroes: HeroId[];
  ownPicks: PerspectiveHeroSlot[];
  enemyPicks: PerspectiveHeroSlot[];
  rankedAp: {
    phase: RankedApPhase;
    banResolutionComplete: boolean;
  } | null;
  captainsMode: {
    firstPickSide: TeamSide | null;
    currentStep: number;
  } | null;
}
