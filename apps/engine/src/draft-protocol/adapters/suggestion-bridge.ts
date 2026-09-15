import type { DraftFormatId, DraftState } from "../../draft/reducer";
import type { HeroId, PerspectiveDraftView, RulesetId, TeamSide } from "../types";

// R1 S2.2/S2.6 -- perspective -> suggestion-engine bridge.
//
// This is the fix for the documented "bot receives pendingUserPicks" bug (engine.md,
// use-random-draft-session.ts): the OLD frontend simulator built the bot's suggestion-engine
// input by hand-writing the user's own still-sealed round picks directly into a preview
// DraftState BEFORE the round revealed. That is a real hidden-information violation.
//
// This module makes that violation structurally impossible for any NEW caller: the only input
// accepted here is a PerspectiveDraftView (perspective.ts's `project(state, viewerSide)`), whose
// HIDDEN variant carries no heroId field at all. There is no code path in this file that could
// read a hidden hero id, because the type it consumes cannot represent one.
//
// Also serves S2's product-target item 9 ("expose a stable data layer so S5 can generate
// recommendations V2"): this is the ONE place a kernel-backed session's visible state becomes the
// legacy `DraftState` shape the V6 suggestion engine (signals/mix.ts buildSuggestions) already
// consumes -- a future recommendation layer built on the kernel reuses this same shape rather
// than inventing a second one.

export interface PerspectiveSuggestionInputs {
  bannedHeroes: HeroId[];
  ownPicks: HeroId[];
  /** REVEALED enemy picks only -- HIDDEN slots contribute nothing (they carry no heroId to read). */
  enemyPicks: HeroId[];
}

/** Pure extraction: which hero ids are actually visible to whoever this view was built for. */
export function derivePerspectiveSuggestionInputs(view: PerspectiveDraftView): PerspectiveSuggestionInputs {
  const ownPicks = view.ownPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  const enemyPicks = view.enemyPicks.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
  return { bannedHeroes: [...view.bannedHeroes], ownPicks, enemyPicks };
}

const RULESET_TO_FORMAT: Record<RulesetId, DraftFormatId> = {
  "dota2/ranked-all-pick": "all_pick",
  "dota2/captains-mode": "captains_mode",
};

export interface PerspectiveDraftStateOptions {
  /** Current game patch for meta lookups (e.g. "7.41e") -- not protocol data, supplied by the caller (session metadata). */
  patch: string;
}

/**
 * Projects a PerspectiveDraftView into the legacy `signals/mix.ts` suggestion-engine input shape,
 * so a kernel-backed session can reuse the existing V6 scoring pipeline without duplicating it.
 * `phase` is deliberately coarse (`COMPLETE` -> "complete", everything else -> "active") -- this
 * bridge exists to drive in-progress suggestion/bot-decision requests, not to round-trip every
 * legacy phase nuance.
 */
export function perspectiveToLegacyDraftState(
  view: PerspectiveDraftView,
  options: PerspectiveDraftStateOptions,
): DraftState {
  // project(state, null) (spectator view) does not preserve per-side attribution for enemyPicks
  // (both sides' confirmed picks are merged into one list -- see perspective.ts). This bridge
  // exists to drive a concrete side's (a bot's) suggestion request, which always has a real
  // viewerSide; a null-side view degrades to an empty board rather than guessing a side split
  // that would silently misattribute picks between radiant/dire.
  if (view.viewerSide === null) {
    return {
      sessionId: view.sessionId,
      schema: "draft-state/v1",
      format: RULESET_TO_FORMAT[view.ruleset.id],
      patch: options.patch,
      localSide: "unknown",
      phase: view.status === "COMPLETE" ? "complete" : "active",
      banned: [...view.bannedHeroes],
      picks: { radiant: [], dire: [] },
      lastSeq: 0,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "degraded" },
      updatedAt: new Date().toISOString(),
      firstPickSide: null,
      turnStartedAt: null,
      reserveRemainingMs: null,
    };
  }

  const inputs = derivePerspectiveSuggestionInputs(view);
  const localSide: TeamSide | "unknown" = view.viewerSide;
  const radiant = localSide === "dire" ? inputs.enemyPicks : inputs.ownPicks;
  const dire = localSide === "dire" ? inputs.ownPicks : inputs.enemyPicks;

  return {
    sessionId: view.sessionId,
    schema: "draft-state/v1",
    format: RULESET_TO_FORMAT[view.ruleset.id],
    patch: options.patch,
    localSide,
    phase: view.status === "COMPLETE" ? "complete" : "active",
    banned: inputs.bannedHeroes,
    picks: { radiant, dire },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: view.degradation ? "degraded" : "ok" },
    updatedAt: new Date().toISOString(),
    firstPickSide: view.captainsMode?.firstPickSide ?? null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}
