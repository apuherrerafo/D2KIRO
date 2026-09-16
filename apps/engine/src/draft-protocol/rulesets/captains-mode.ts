import { rulesHash } from "../identity-hash";
import type {
  CmState,
  CmStepDefinition,
  DraftProtocolState,
  GameplayLegalAction,
  HeroId,
  ProtocolAdminCommand,
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
const SOURCE_MANIFEST_HASH = rulesHash(SOURCE_MANIFEST as never);

export const CAPTAINS_MODE_IDENTITY: RulesetIdentity = Object.freeze({
  id: "dota2/captains-mode",
  version: "1.0.0",
  rulesHash: rulesHash({
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

function heroAlreadyTaken(cm: CmState, heroId: HeroId): boolean {
  return (
    cm.bannedHeroes.includes(heroId) || cm.picks.radiant.includes(heroId) || cm.picks.dire.includes(heroId)
  );
}

/**
 * Every heroId still certifiable at this instant: in the loaded eligibility snapshot AND not
 * already banned/picked by either side. Bounded (the snapshot's heroIds array is finite, ~126 in
 * practice) -- unlike Ranked All Pick's isSealedSelectionLegal (ranked-all-pick.ts), this can be a
 * genuine enumeration, not just a predicate, because CM's hero universe IS certified/bounded.
 *
 * Exported (R1 S6 blocker repair) so PROTOCOL AVAILABILITY facts elsewhere (opponent value
 * baseline, steal evidence) can reuse this EXACT enumeration instead of re-deriving a second,
 * potentially divergent copy -- CM's hero pool is shared between sides, so "still certifiable"
 * already answers "available to either side", not just "available to whoever acts next".
 */
export function cmRemainingEligibleHeroIds(cm: CmState): HeroId[] {
  if (!cm.eligibilitySnapshot) return [];
  return cm.eligibilitySnapshot.heroIds.filter((heroId) => !heroAlreadyTaken(cm, heroId));
}

/**
 * Protocol/admin commands. LOAD_CM_ELIGIBILITY is intentionally always listed -- the kernel
 * itself places no gate on it (not on firstPickSide, not on step, not on COMPLETE; see
 * the kernel reducer): a later/refreshed snapshot is harmless to accept at any time,
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
    const eligibleHeroIds = cmRemainingEligibleHeroIds(cm);
    if (eligibleHeroIds.length === 0) return [banSkipped];
    return [
      { type: "CM_ACTION", step: stepDef.step, actor: stepDef.actor, absoluteSide, kind: "BAN", eligibleHeroIds },
      banSkipped,
    ];
  }

  // PICK: unlike BAN, there is no eligibility-free fallback action (no "PICK_SKIPPED") -- without
  // a verified snapshot, no PICK-kind gameplay action is certifiable at all.
  if (!cm.eligibilitySnapshot) return [];
  const eligibleHeroIds = cmRemainingEligibleHeroIds(cm);
  if (eligibleHeroIds.length === 0) return [];
  return [
    { type: "CM_ACTION", step: stepDef.step, actor: stepDef.actor, absoluteSide, kind: "PICK", eligibleHeroIds },
    { type: "CM_AUTO_PICK", step: stepDef.step, actor: stepDef.actor, absoluteSide, eligibleHeroIds },
  ];
}
