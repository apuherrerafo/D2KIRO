import { deepFreeze } from "./immutable";
import type { DraftProtocolState, HeroId, PerspectiveDraftView, PerspectiveHeroSlot, TeamSide } from "./types";

// R1 S1 -- project(viewer): the ONE place authoritative DraftProtocolState is turned into a
// per-viewer PerspectiveDraftView. CRITICAL INVARIANT: a hidden enemy hero ID must never appear
// in the output -- enforced structurally by PerspectiveHeroSlot's discriminated union (the HIDDEN
// variant has no heroId field at all, so there is no code path that could attach one).
//
// Ranked All Pick has genuine hidden information: a side's sealed-but-unrevealed selection in the
// current round is HIDDEN to the opponent (and to a spectator/no-side viewer) until round close.
// Captain's Mode has none -- "CM picks/bans are immediately REVEALED" is part of the frozen
// contract, so a CM perspective only ever emits KNOWN/REVEALED, never HIDDEN.

function opponentOf(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

function known(heroId: HeroId): PerspectiveHeroSlot {
  return { visibility: "KNOWN", heroId };
}
function revealed(heroId: HeroId): PerspectiveHeroSlot {
  return { visibility: "REVEALED", heroId };
}
// Blocker 2: a fresh object per call, NOT a shared module-level singleton. A single reused
// `HIDDEN` constant would mean every "hidden" slot ever returned by project() -- across every
// viewer, every session, forever -- is the SAME object; a caller mutating one entry (nothing at
// the type level stops adding an ad-hoc property at runtime) would corrupt every other perspective
// view that ever included a hidden slot.
function hidden(): PerspectiveHeroSlot {
  return { visibility: "HIDDEN" };
}

function projectRankedAllPick(
  state: DraftProtocolState,
  viewerSide: TeamSide | null,
): { ownPicks: PerspectiveHeroSlot[]; enemyPicks: PerspectiveHeroSlot[] } {
  const rankedAp = state.rankedAp;
  if (!rankedAp) return { ownPicks: [], enemyPicks: [] };

  if (viewerSide === null) {
    // No trusted "self" side: nothing sealed-but-unrevealed is exposed to a neutral viewer.
    const enemyPicks: PerspectiveHeroSlot[] = [
      ...rankedAp.confirmedPicks.map((pick) => revealed(pick.heroId)),
      ...(rankedAp.round?.sealed.map(() => hidden()) ?? []),
    ];
    return { ownPicks: [], enemyPicks };
  }

  const opponent = opponentOf(viewerSide);
  const ownConfirmed = rankedAp.confirmedPicks.filter((pick) => pick.side === viewerSide).map((pick) => known(pick.heroId));
  const ownSealed = (rankedAp.round?.sealed.filter((entry) => entry.side === viewerSide) ?? []).map((entry) =>
    known(entry.heroId),
  );
  const enemyConfirmed = rankedAp.confirmedPicks.filter((pick) => pick.side === opponent).map((pick) => revealed(pick.heroId));
  const enemySealedHidden = (rankedAp.round?.sealed.filter((entry) => entry.side === opponent) ?? []).map(() => hidden());

  return {
    ownPicks: [...ownConfirmed, ...ownSealed],
    enemyPicks: [...enemyConfirmed, ...enemySealedHidden],
  };
}

function projectCaptainsMode(
  state: DraftProtocolState,
  viewerSide: TeamSide | null,
): { ownPicks: PerspectiveHeroSlot[]; enemyPicks: PerspectiveHeroSlot[] } {
  const cm = state.captainsMode;
  if (!cm) return { ownPicks: [], enemyPicks: [] };
  if (viewerSide === null) {
    return {
      ownPicks: [],
      enemyPicks: [...cm.picks.radiant, ...cm.picks.dire].map((heroId) => revealed(heroId)),
    };
  }
  const opponent = opponentOf(viewerSide);
  return {
    ownPicks: cm.picks[viewerSide].map((heroId) => known(heroId)),
    enemyPicks: cm.picks[opponent].map((heroId) => revealed(heroId)),
  };
}

export function project(state: DraftProtocolState, viewerSide: TeamSide | null): PerspectiveDraftView {
  // Blocker 2: a fresh copy, never the authoritative array itself -- the source is
  // state.rankedAp.bannedHeroes / state.captainsMode.bannedHeroes, and returning that reference
  // directly would let a caller mutating the returned view corrupt authoritative state in place.
  const bannedHeroes = [...(state.rankedAp?.bannedHeroes ?? state.captainsMode?.bannedHeroes ?? [])];

  const { ownPicks, enemyPicks } = state.rankedAp
    ? projectRankedAllPick(state, viewerSide)
    : projectCaptainsMode(state, viewerSide);

  // Blocker 2: `degradation` is a nested object -- copy it too, not just the top-level array
  // fields, so mutating the returned view's degradation can never reach authoritative state's own
  // copy. `ruleset` is NOT cloned: RulesetIdentity is Object.frozen at module-load time in
  // rulesets/*.ts (a permanent, shared, already-immutable constant), so aliasing it here is safe.
  const view: PerspectiveDraftView = {
    schema: "draft-protocol-perspective/v1",
    sessionId: state.sessionId,
    ruleset: state.ruleset,
    status: state.status,
    degradation: state.degradation ? { ...state.degradation } : null,
    viewerSide,
    bannedHeroes,
    ownPicks,
    enemyPicks,
    rankedAp: state.rankedAp
      ? { phase: state.rankedAp.phase, banResolutionComplete: state.rankedAp.banResolutionComplete }
      : null,
    captainsMode: state.captainsMode
      ? { firstPickSide: state.captainsMode.firstPickSide, currentStep: state.captainsMode.currentStep }
      : null,
  };
  return deepFreeze(view);
}
