import { acceptCmHeroEligibilitySnapshot, isHeroEligible } from "../eligibility";
import { canonicalHash, type CanonicalValue } from "../hash";
import { isValidHeroId } from "../hero-id";
import { isPatchWithinRange } from "../patch-range";
import type {
  CmState,
  CmStepDefinition,
  DraftProtocolState,
  GameplayLegalAction,
  HeroId,
  KernelResult,
  ProtocolAdminCommand,
  ProtocolCommand,
  RelativeSide,
  RulesetIdentity,
  TeamSide,
} from "../types";

// R1 S1 -- Captain's Mode ruleset. Frozen contract: canonical identity dota2/captains-mode@1.0.0,
// applicableFromPatch 7.40, verifiedThroughPatch 7.41e. firstPickSide is mandatory; missing ->
// UNCONFIRMED_STATE, no protocol advancement, no certified legal decision. 24-step canonical
// sequence below, using an INDEPENDENT step ordinal -- never derived by counting accumulated
// picks/bans, because BAN_SKIPPED can advance the step without adding a hero.
//
// Regression fixed in this slice: the pre-existing repository turn table
// (apps/engine/src/draft/draft-format-turns.json) had steps 17 and 18 swapped relative to the
// canonical sequence below (17 must be SECOND, 18 must be FIRST). That legacy file has been
// corrected in the same commit as this kernel (see apps/engine/src/draft/draft-format-turns.json)
// and this module's own canonical table is written independently, correct from the start.

const CANONICAL_SEQUENCE: readonly CmStepDefinition[] = [
  { step: 1, phase: "BAN_1", kind: "BAN", actor: "first", baseTimeMs: 15000 },
  { step: 2, phase: "BAN_1", kind: "BAN", actor: "first", baseTimeMs: 15000 },
  { step: 3, phase: "BAN_1", kind: "BAN", actor: "second", baseTimeMs: 15000 },
  { step: 4, phase: "BAN_1", kind: "BAN", actor: "second", baseTimeMs: 15000 },
  { step: 5, phase: "BAN_1", kind: "BAN", actor: "first", baseTimeMs: 15000 },
  { step: 6, phase: "BAN_1", kind: "BAN", actor: "second", baseTimeMs: 15000 },
  { step: 7, phase: "BAN_1", kind: "BAN", actor: "second", baseTimeMs: 15000 },

  { step: 8, phase: "PICK_1", kind: "PICK", actor: "first", baseTimeMs: 30000 },
  { step: 9, phase: "PICK_1", kind: "PICK", actor: "second", baseTimeMs: 30000 },

  { step: 10, phase: "BAN_2", kind: "BAN", actor: "first", baseTimeMs: 30000 },
  { step: 11, phase: "BAN_2", kind: "BAN", actor: "first", baseTimeMs: 30000 },
  { step: 12, phase: "BAN_2", kind: "BAN", actor: "second", baseTimeMs: 30000 },

  { step: 13, phase: "PICK_2", kind: "PICK", actor: "second", baseTimeMs: 30000 },
  { step: 14, phase: "PICK_2", kind: "PICK", actor: "first", baseTimeMs: 30000 },
  { step: 15, phase: "PICK_2", kind: "PICK", actor: "first", baseTimeMs: 30000 },
  { step: 16, phase: "PICK_2", kind: "PICK", actor: "second", baseTimeMs: 30000 },
  { step: 17, phase: "PICK_2", kind: "PICK", actor: "second", baseTimeMs: 30000 },
  { step: 18, phase: "PICK_2", kind: "PICK", actor: "first", baseTimeMs: 30000 },

  { step: 19, phase: "BAN_3", kind: "BAN", actor: "first", baseTimeMs: 30000 },
  { step: 20, phase: "BAN_3", kind: "BAN", actor: "second", baseTimeMs: 30000 },
  { step: 21, phase: "BAN_3", kind: "BAN", actor: "first", baseTimeMs: 30000 },
  { step: 22, phase: "BAN_3", kind: "BAN", actor: "second", baseTimeMs: 30000 },

  { step: 23, phase: "PICK_3", kind: "PICK", actor: "first", baseTimeMs: 30000 },
  { step: 24, phase: "PICK_3", kind: "PICK", actor: "second", baseTimeMs: 30000 },
];

export const CM_RESERVE_TIME_MS = 130000;

const SOURCE_MANIFEST = {
  sequence: CANONICAL_SEQUENCE,
  reserveTimeMs: CM_RESERVE_TIME_MS,
};
const SOURCE_MANIFEST_HASH = canonicalHash(SOURCE_MANIFEST as unknown as CanonicalValue);

export const CAPTAINS_MODE_IDENTITY: RulesetIdentity = Object.freeze({
  id: "dota2/captains-mode",
  version: "1.0.0",
  rulesHash: canonicalHash({
    id: "dota2/captains-mode",
    version: "1.0.0",
    manifestHash: SOURCE_MANIFEST_HASH,
  }),
  applicableFromPatch: "7.40",
  verifiedThroughPatch: "7.41e",
  sourceManifestHash: SOURCE_MANIFEST_HASH,
});

export function captainsModeStepDefinition(step: number): CmStepDefinition | null {
  if (step < 1 || step > 24) return null;
  return CANONICAL_SEQUENCE[step - 1] ?? null;
}

export function resolveAbsoluteSide(relative: RelativeSide, firstPickSide: TeamSide): TeamSide {
  if (relative === "first") return firstPickSide;
  return firstPickSide === "radiant" ? "dire" : "radiant";
}

export function createCaptainsModeState(sessionId: string): DraftProtocolState {
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

function heroAlreadyTaken(cm: CmState, heroId: HeroId): boolean {
  return (
    cm.bannedHeroes.includes(heroId) || cm.picks.radiant.includes(heroId) || cm.picks.dire.includes(heroId)
  );
}

function withAdvancedStep(cm: CmState, nextStep: number): { currentStep: number; status: "ACTIVE" | "COMPLETE" } {
  if (nextStep > 24) return { currentStep: 25, status: "COMPLETE" };
  return { currentStep: nextStep, status: "ACTIVE" };
}

export function applyCaptainsModeCommand(
  state: DraftProtocolState,
  command: ProtocolCommand,
  _ordinal: number,
): KernelResult {
  const cm = state.captainsMode;
  if (!cm) return { state, rejected: "RULESET_UNAVAILABLE" };

  if (command.type === "CONFIRM_FIRST_PICK_SIDE") {
    if (cm.firstPickSide !== null) return { state, rejected: "ALREADY_RESOLVED" };
    const nextCm: CmState = { ...cm, firstPickSide: command.side };
    return { state: { ...state, captainsMode: nextCm, status: "ACTIVE" } };
  }

  if (command.type === "LOAD_CM_ELIGIBILITY") {
    // Blocker 4B: hash integrity alone is not enough -- a well-formed, internally-consistent
    // snapshot for the WRONG patch, or one missing required source identity, must still be
    // rejected. acceptCmHeroEligibilitySnapshot runs full structural validation (schema, appId,
    // ordered/unique/positive heroIds, required depotManifests/sourceHashes keys) AND integrity
    // (contentHash) -- never just the hash check the old code ran here. The accepted result is
    // also independently cloned from `command.snapshot` (Blocker 2), so mutating the caller's
    // original snapshot object after acceptance can never reach captainsMode.eligibilitySnapshot.
    const accepted = acceptCmHeroEligibilitySnapshot(command.snapshot);
    if (!accepted) return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    if (!isPatchWithinRange(accepted.patch, state.ruleset.applicableFromPatch, state.ruleset.verifiedThroughPatch)) {
      return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    }
    const nextCm: CmState = { ...cm, eligibilitySnapshot: accepted };
    return { state: { ...state, captainsMode: nextCm } };
  }

  // The three remaining command types (CM_ACTION, CM_BAN_SKIPPED, CM_AUTO_PICK) all consume one
  // canonical step and share the same fail-closed gating: UNCONFIRMED_STATE first (no certified
  // legal decision is possible at all without firstPickSide), then step existence, then
  // actor/kind match against the independent step ordinal -- never inferred by counting.
  if (command.type === "CM_ACTION" || command.type === "CM_BAN_SKIPPED" || command.type === "CM_AUTO_PICK") {
    if (cm.firstPickSide === null) return { state, rejected: "UNCONFIRMED_STATE" };
    const stepDef = captainsModeStepDefinition(cm.currentStep);
    if (!stepDef) return { state, rejected: "STEP_AFTER_COMPLETION" };
    if (stepDef.actor !== command.actor) return { state, rejected: "WRONG_ACTOR" };

    if (command.type === "CM_BAN_SKIPPED") {
      if (stepDef.kind !== "BAN") return { state, rejected: "WRONG_ACTION_KIND" };
      const advance = withAdvancedStep(cm, cm.currentStep + 1);
      const nextCm: CmState = {
        ...cm,
        currentStep: advance.currentStep,
        history: [...cm.history, { step: stepDef.step, outcome: { kind: "BAN_SKIPPED" } }],
      };
      return { state: { ...state, captainsMode: nextCm, status: advance.status } };
    }

    const expectedKind = command.type === "CM_AUTO_PICK" ? "PICK" : command.kind;
    if (stepDef.kind !== expectedKind) return { state, rejected: "WRONG_ACTION_KIND" };

    if (!isValidHeroId(command.heroId)) return { state, rejected: "INVALID_HERO_ID" };
    if (!cm.eligibilitySnapshot) return { state, rejected: "ELIGIBILITY_UNVERIFIED" };
    if (!isHeroEligible(cm.eligibilitySnapshot, command.heroId)) return { state, rejected: "HERO_INELIGIBLE" };
    if (heroAlreadyTaken(cm, command.heroId)) return { state, rejected: "HERO_ALREADY_TAKEN" };

    const advance = withAdvancedStep(cm, cm.currentStep + 1);
    const outcome =
      command.type === "CM_AUTO_PICK"
        ? ({ kind: "AUTO_PICK", heroId: command.heroId } as const)
        : ({ kind: "HERO", heroId: command.heroId } as const);
    const history = [...cm.history, { step: stepDef.step, outcome }];

    if (stepDef.kind === "BAN") {
      const nextCm: CmState = { ...cm, currentStep: advance.currentStep, history, bannedHeroes: [...cm.bannedHeroes, command.heroId] };
      return { state: { ...state, captainsMode: nextCm, status: advance.status } };
    }

    const absoluteSide = resolveAbsoluteSide(stepDef.actor, cm.firstPickSide);
    const nextPicks = {
      radiant: absoluteSide === "radiant" ? [...cm.picks.radiant, command.heroId] : cm.picks.radiant,
      dire: absoluteSide === "dire" ? [...cm.picks.dire, command.heroId] : cm.picks.dire,
    };
    const nextCm: CmState = { ...cm, currentStep: advance.currentStep, history, picks: nextPicks };
    return { state: { ...state, captainsMode: nextCm, status: advance.status } };
  }

  return { state, rejected: "WRONG_ACTION_KIND" };
}

/**
 * Every heroId still certifiable at this instant: in the loaded eligibility snapshot AND not
 * already banned/picked by either side. Bounded (the snapshot's heroIds array is finite, ~126 in
 * practice) -- unlike Ranked All Pick's isSealedSelectionLegal (ranked-all-pick.ts), this can be a
 * genuine enumeration, not just a predicate, because CM's hero universe IS certified/bounded.
 */
function cmRemainingEligibleHeroIds(cm: CmState): HeroId[] {
  if (!cm.eligibilitySnapshot) return [];
  return cm.eligibilitySnapshot.heroIds.filter((heroId) => !heroAlreadyTaken(cm, heroId));
}

/**
 * Protocol/admin commands. LOAD_CM_ELIGIBILITY is intentionally always listed -- the kernel
 * itself places no gate on it (not on firstPickSide, not on step, not on COMPLETE; see
 * applyCaptainsModeCommand above): a later/refreshed snapshot is harmless to accept at any time,
 * PRODUCT_POLICY, not a silent gap. CONFIRM_FIRST_PICK_SIDE only while still unset (a second
 * attempt is ALREADY_RESOLVED at the kernel, so it must not be advertised as legal once resolved).
 */
export function captainsModeAvailableCommands(state: DraftProtocolState): ProtocolAdminCommand[] {
  const cm = state.captainsMode;
  if (!cm) return [];
  const commands: ProtocolAdminCommand[] = [{ type: "LOAD_CM_ELIGIBILITY" }];
  if (cm.firstPickSide === null) commands.push({ type: "CONFIRM_FIRST_PICK_SIDE" });
  return commands;
}

/**
 * Gameplay legal actions. UNCONFIRMED_STATE (no firstPickSide) or STEP_AFTER_COMPLETION (no
 * stepDef) -> [], matching the kernel's own fail-closed gates exactly. `absoluteSide` is resolved
 * here, from canonical state (firstPickSide + the step's relative actor), by the kernel itself --
 * never left for an external adapter to derive its own copy of resolveAbsoluteSide and risk
 * disagreeing with the kernel (Blocker 3). CM_ACTION/CM_AUTO_PICK carry the full, currently-legal
 * `eligibleHeroIds` set -- every one of them, applied literally as `heroId`, is guaranteed
 * accepted by the kernel right now.
 */
export function captainsModeLegalGameplayActions(state: DraftProtocolState): GameplayLegalAction[] {
  const cm = state.captainsMode;
  if (!cm || cm.firstPickSide === null) return [];
  const stepDef = captainsModeStepDefinition(cm.currentStep);
  if (!stepDef) return [];
  const absoluteSide = resolveAbsoluteSide(stepDef.actor, cm.firstPickSide);

  if (stepDef.kind === "BAN") {
    const banSkipped: GameplayLegalAction = { type: "CM_BAN_SKIPPED", step: stepDef.step, actor: stepDef.actor, absoluteSide };
    if (!cm.eligibilitySnapshot) return [banSkipped]; // no hero involved -> never needs eligibility
    return [
      { type: "CM_ACTION", step: stepDef.step, actor: stepDef.actor, absoluteSide, kind: "BAN", eligibleHeroIds: cmRemainingEligibleHeroIds(cm) },
      banSkipped,
    ];
  }

  // PICK: unlike BAN, there is no eligibility-free fallback action (no "PICK_SKIPPED") -- without
  // a verified snapshot, no PICK-kind gameplay action is certifiable at all.
  if (!cm.eligibilitySnapshot) return [];
  const eligibleHeroIds = cmRemainingEligibleHeroIds(cm);
  return [
    { type: "CM_ACTION", step: stepDef.step, actor: stepDef.actor, absoluteSide, kind: "PICK", eligibleHeroIds },
    { type: "CM_AUTO_PICK", step: stepDef.step, actor: stepDef.actor, absoluteSide, eligibleHeroIds },
  ];
}
