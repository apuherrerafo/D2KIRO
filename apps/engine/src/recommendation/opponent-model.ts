import type { DraftProtocolState, HeroId, TeamSide } from "../draft-protocol/types";
import type { DraftState } from "../draft/reducer";
import type { SuggestionSet } from "../signals/mix";
import { deriveLegalDecision, type LegalDecision } from "./decision";
import { excludedHeroes, postValidateAction, type ComputeSuggestionsForRecommendation } from "./legality";
import { deriveOpponentAvailableHeroUniverse } from "./protocol-availability";
import { buildShortlist, type ShortlistEntry } from "./shortlist";
import type { RecommendationAction } from "./types";

// R1 S6 -- OPPONENT PERSPECTIVE pipeline:
//
//   counterfactual protocol state -> deriveLegalDecision(state, opponentSide) [S5, reused]
//     -> mutualVisibilityLegacyState (this file) -> computeSuggestions (THE SAME injected V6
//        entry point build.ts uses for our own side) -> buildShortlist [S5, reused]
//
// CRITICAL: this deliberately does NOT reuse `project(state, opponentSide)` +
// `perspectiveToLegacyDraftState` (the S1/S2 seam our OWN side's recommendation uses in build.ts).
// `project(state, opponentSide)` is the OPPONENT's own SELF-aware view -- it correctly shows THEM
// their own currently-sealed-but-unrevealed pick as KNOWN to themselves. That is exactly right for
// modeling what the opponent would privately know, but S6 attaches this model's OUTPUT (score,
// evidence, identity hashes) to OUR OWN RecommendationSetV2 -- and using their private knowledge
// there would leak it to us through an observable side channel the instant it changes what V6
// returns (the same class of bug this codebase already fixed once, see legality.ts's own Blocker
// 2 doc). The task's own INFORMATION SET discipline states this symmetrically: "tampoco uses
// hidden enemy information que nosotros no vemos" -- not just "never leak our hidden info to
// them", but also never let THEIR hidden info (which is exactly as hidden to a hidden-twin
// comparison as ours is to them) reach anything WE can observe.
//
// `mutualVisibilityLegacyState` therefore includes ONLY what BOTH sides can already verify right
// now: bans (never sealed, always immediately visible in either ruleset) and CONFIRMED/REVEALED
// picks -- exactly `state.rankedAp.confirmedPicks` (Ranked All Pick) or `state.captainsMode.picks`
// (Captain's Mode, which the frozen contract already declares fully revealed with no hidden
// mechanism at all, so this is byte-identical to the self-aware view for CM). A still-sealed pick
// on EITHER side (including our own hypothetical action, if the round has not closed) is simply
// absent from this model -- exactly the state a neutral, fully-informed-only-of-what's-revealed
// observer would see. This is why a same-hero collision with a still-sealed pick legitimately
// stays reachable through this model (test matrix #5/#17): the mutual view does not know that
// hero is taken, so V6 may rank it, and the final legality re-check
// (`topPlausibleAction`/`postValidateAction`) is what correctly allows or rejects it against the
// TRUE counterfactual state -- never this model's own (deliberately incomplete) candidate pool.

const RULESET_TO_FORMAT: Record<DraftProtocolState["ruleset"]["id"], DraftState["format"]> = {
  "dota2/ranked-all-pick": "all_pick",
  "dota2/captains-mode": "captains_mode",
};

function mutualVisibilityPicks(state: DraftProtocolState, side: TeamSide): HeroId[] {
  if (state.captainsMode) return [...state.captainsMode.picks[side]];
  if (state.rankedAp) return state.rankedAp.confirmedPicks.filter((pick) => pick.side === side).map((pick) => pick.heroId);
  return [];
}

function mutualVisibilityLegacyState(state: DraftProtocolState, opponentSide: TeamSide, patch: string): DraftState {
  return {
    sessionId: state.sessionId,
    schema: "draft-state/v1",
    format: RULESET_TO_FORMAT[state.ruleset.id],
    patch,
    localSide: opponentSide,
    phase: state.status === "COMPLETE" ? "complete" : "active",
    banned: [...(state.rankedAp?.bannedHeroes ?? state.captainsMode?.bannedHeroes ?? [])],
    picks: { radiant: mutualVisibilityPicks(state, "radiant"), dire: mutualVisibilityPicks(state, "dire") },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: state.degradation ? "degraded" : "ok" },
    updatedAt: "", // never functionally read by V6 (mix.ts) -- see draft/reducer.ts's own initial-state convention
    firstPickSide: state.captainsMode?.firstPickSide ?? null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

export interface OpponentModelInput {
  /** The protocol state to model the opponent's own decision against -- callers pass either the
   * CURRENT authoritative state (the "baseline", before our candidate action) or the
   * counterfactual state reached by hypothetically applying it (the "after"). This module treats
   * both identically; it never knows which one it was given. */
  state: DraftProtocolState;
  opponentSide: TeamSide;
  patch: string;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  seed?: string;
}

export interface OpponentModelResult {
  decision: LegalDecision["decision"];
  eligibleHeroIds: readonly HeroId[] | null;
  /** Null when no V6 call was ever attempted (no legal hero-targeting decision for the opponent)
   * or when the call failed -- see `failed`. Never a fabricated/empty SuggestionSet standing in
   * for "nothing happened". */
  suggestionSet: SuggestionSet | null;
  shortlist: readonly ShortlistEntry[];
  /** True only when computeSuggestions threw for the opponent's own (legal) decision point --
   * distinct from "the opponent legitimately has no legal decision right now", which is
   * `decision.actionCount === 0` with `failed: false`. */
  failed: boolean;
}

/**
 * Scores the opponent's OWN plausible universe against `input.state`, entirely through their own
 * perspective. Never throws: a V6 failure is reported via `failed: true`, never propagated.
 */
export async function computeOpponentModel(input: OpponentModelInput): Promise<OpponentModelResult> {
  const { state, opponentSide, patch, computeSuggestions, seed } = input;
  const legal = deriveLegalDecision(state, opponentSide);
  if (legal.decision.actionCount === 0) {
    return { decision: legal.decision, eligibleHeroIds: legal.eligibleHeroIds, suggestionSet: null, shortlist: [], failed: false };
  }

  const legacyState = mutualVisibilityLegacyState(state, opponentSide, patch);
  try {
    const suggestionSet = await computeSuggestions(legacyState, null, {
      teamOpening: true,
      diversitySeed: seed,
      candidateHeroIds: legal.eligibleHeroIds ?? undefined,
    });
    const shortlist = buildShortlist(suggestionSet, legal.eligibleHeroIds, excludedHeroes(legacyState));
    return { decision: legal.decision, eligibleHeroIds: legal.eligibleHeroIds, suggestionSet, shortlist, failed: false };
  } catch {
    return { decision: legal.decision, eligibleHeroIds: legal.eligibleHeroIds, suggestionSet: null, shortlist: [], failed: true };
  }
}

/** V6's own canonical score for `heroId` within an already-computed SuggestionSet, or null when
 * that hero was never part of the ranked universe (excluded, out of the certified eligible set, or
 * simply outside whatever V6 returned) -- or when no SuggestionSet exists at all (`null`, meaning
 * "nothing was ever computed", never a fabricated stand-in). Never a fabricated 0 -- absence IS the
 * answer for an unavailable/unconsidered hero. Takes a plain `SuggestionSet | null` (not a model
 * object) so both `OpponentValueBaselineResult` and `OpponentModelResult` can share this single
 * lookup without either shape needing to structurally resemble the other. */
export function opponentValueFor(suggestionSet: SuggestionSet | null, heroId: HeroId): number | null {
  return suggestionSet?.suggestions.find((suggestion) => suggestion.hero === heroId)?.score ?? null;
}

export interface OpponentValueBaselineResult {
  /** The protocol-availability universe this baseline was valued against -- see
   * `deriveOpponentAvailableHeroUniverse`. Never derived from whose turn it is. */
  eligibleHeroIds: readonly HeroId[] | null;
  /** Null when the universe was empty (nothing to value) or the V6 call failed -- see `failed`.
   * Never a fabricated/empty SuggestionSet standing in for "nothing happened". */
  suggestionSet: SuggestionSet | null;
  /** True only when computeSuggestions threw. Distinct from "the universe was empty", which is
   * `failed: false` with `suggestionSet: null`. */
  failed: boolean;
}

/**
 * OPPONENT VALUE BASELINE (Blocker 1 repair). Values `opponentSide`'s protocol-available hero
 * universe against `input.state` WITHOUT ever claiming the opponent has a legal action right now --
 * deliberately does NOT gate on `deriveLegalDecision(state, opponentSide).decision.actionCount`,
 * unlike `computeOpponentModel`/`OpponentResponse` below, which both require an actual legal,
 * hero-targeting decision point. A baseline exists whenever the protocol still certifies at least
 * one hero as available, which is true for most of a Captain's Mode draft even while it is OUR OWN
 * turn to act (e.g. our own CM ban) -- exactly the case `computeOpponentModel` structurally cannot
 * answer, by design.
 *
 * Structurally cannot be mistaken for a legal response: this function never returns anything
 * shaped like `LegalDecision`/`RecommendationDecision` (no `controlledSlots`, no `actionKind`), so
 * a caller cannot feed its result into `topPlausibleAction`, which requires exactly those fields.
 * "Value baseline" and "legal response" are different return types, not a shared one distinguished
 * by a boolean flag.
 */
export async function computeOpponentValueBaseline(input: OpponentModelInput): Promise<OpponentValueBaselineResult> {
  const { state, opponentSide, patch, computeSuggestions, seed } = input;
  const eligibleHeroIds = deriveOpponentAvailableHeroUniverse(state);
  if (eligibleHeroIds !== null && eligibleHeroIds.length === 0) {
    return { eligibleHeroIds, suggestionSet: null, failed: false };
  }

  const legacyState = mutualVisibilityLegacyState(state, opponentSide, patch);
  try {
    const suggestionSet = await computeSuggestions(legacyState, null, {
      teamOpening: true,
      diversitySeed: seed,
      candidateHeroIds: eligibleHeroIds ?? undefined,
    });
    return { eligibleHeroIds, suggestionSet, failed: false };
  } catch {
    return { eligibleHeroIds, suggestionSet: null, failed: true };
  }
}

/**
 * ONE-PLY DEFINITION, step 7: "selecciona una bounded plausible response" -- singular, never the
 * opponent's full (possibly compound) decision. Always names the LOWEST-slotIndex slot the
 * opponent legally controls right now (same deterministic, arbitrary-but-stable convention
 * build.ts already uses to assign compound actions to slots). Scans the already-bounded shortlist
 * (SHORTLIST_SIZE, shortlist.ts) IN ORDER for the first entry that survives an independent
 * re-check (`postValidateAction`) against `counterfactualState` -- LEGAL UNIVERSE FIRST applies to
 * the opponent too. This re-check can reject the shortlist's own top entry even though
 * `mutualVisibilityLegacyState` never excluded it (e.g. a hero the opponent had ALREADY sealed
 * this same round for a DIFFERENT one of their own slots -- invisible to the mutual model by
 * design, but still a real same-side duplicate the kernel itself rejects). Returns null only when
 * NO entry survives (or the shortlist is empty) -- never a fabricated fallback action.
 */
export function topPlausibleAction(model: OpponentModelResult, counterfactualState: DraftProtocolState): RecommendationAction | null {
  const slot = [...model.decision.controlledSlots].sort((a, b) => a.slotIndex - b.slotIndex)[0];
  if (!slot) return null;
  for (const entry of model.shortlist) {
    if (postValidateAction(counterfactualState, entry.hero, model.eligibleHeroIds, slot)) return { slot, hero: entry.hero };
  }
  return null;
}
