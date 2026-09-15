import { applyProtocolCommand, legalActions } from "../kernel";
import type { DraftProtocolState, GameplayLegalAction, HeroId, KernelResult } from "../types";

// R1 S3.5 -- Captain's Mode simulator adapter. Controls BOTH sides through the exact same kernel
// a future live capture adapter will use -- no second implementation of turn order, eligibility,
// or step advancement. Every decision this module makes is "which hero id to pass," using
// `legalActions` (the same oracle a real UI/adapter consults) to know what's currently legal; it
// never bypasses applyProtocolCommand and never guesses at state the kernel didn't hand it.

export interface CmSimulatorStrategy {
  chooseHeroId(eligibleHeroIds: readonly HeroId[], action: Extract<GameplayLegalAction, { type: "CM_ACTION" }>): HeroId;
}

/** Deterministic default strategy: always the lowest eligible heroId. Reproducible, no RNG needed for a scripted scenario. */
export const lowestEligibleHeroIdStrategy: CmSimulatorStrategy = {
  chooseHeroId: (eligibleHeroIds) => eligibleHeroIds[0]!,
};

/**
 * Advances exactly one step, if a CM_ACTION is currently legal. Returns `null` (not an error) when
 * there's nothing to act on -- COMPLETE, UNCONFIRMED_STATE, or a BAN step this strategy would
 * rather skip (this function only ever drives CM_ACTION, never CM_BAN_SKIPPED/CM_AUTO_PICK --
 * callers wanting those pick a different step-driver, this one exists for "always take a real
 * hero action" scenarios).
 */
export function playOneCmStep(state: DraftProtocolState, strategy: CmSimulatorStrategy = lowestEligibleHeroIdStrategy): KernelResult | null {
  const cmAction = legalActions(state).find(
    (action): action is Extract<GameplayLegalAction, { type: "CM_ACTION" }> => action.type === "CM_ACTION",
  );
  if (!cmAction) return null;
  const heroId = strategy.chooseHeroId(cmAction.eligibleHeroIds, cmAction);
  return applyProtocolCommand(state, { type: "CM_ACTION", actor: cmAction.actor, kind: cmAction.kind, heroId });
}

export interface PlayFullCmDraftResult {
  state: DraftProtocolState;
  stepsPlayed: number;
  /** True iff the loop stopped because no CM_ACTION was legal anymore (expected: COMPLETE, or UNCONFIRMED_STATE/no eligibility). False only if maxSteps was hit -- a real bug, never expected for a healthy 24-step CM draft. */
  stoppedNaturally: boolean;
}

/**
 * Drives a Captain's Mode draft forward via playOneCmStep until nothing is left to act on or
 * `maxSteps` is hit (guard against an infinite loop if this is ever pointed at a misconfigured
 * state -- 24 is the real ceiling, so a generous default well above that is a genuine safety net,
 * not a magic number the caller needs to tune).
 */
export function playFullCmDraft(
  state: DraftProtocolState,
  strategy: CmSimulatorStrategy = lowestEligibleHeroIdStrategy,
  maxSteps = 30,
): PlayFullCmDraftResult {
  let current = state;
  let stepsPlayed = 0;
  for (; stepsPlayed < maxSteps; stepsPlayed += 1) {
    const result = playOneCmStep(current, strategy);
    if (!result || result.rejected) return { state: current, stepsPlayed, stoppedNaturally: true };
    current = result.state;
  }
  return { state: current, stepsPlayed, stoppedNaturally: false };
}
