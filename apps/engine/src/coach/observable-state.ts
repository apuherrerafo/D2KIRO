import { computeRoleBelief, type Position, type RoleBelief } from "../draft-protocol/roles/role-belief";
import type { HeroId, PerspectiveDraftView, PerspectiveHeroSlot } from "../draft-protocol/types";
import type { HeroPositions } from "../signals/hero-positions";

// AP Ranked Roles V1 / Wave 2 (task 14) -- CoachObservableState: the ONLY draft state the Coach may
// read. The architecture is
//
//   Simulator Truth -> project() -> PerspectiveDraftView -> (this file) -> CoachObservableState
//
// and there is deliberately no other way in. Everything here is derived from a PerspectiveDraftView
// (whose HIDDEN slot variant has no `heroId` field at all) plus public curated data. This module
// never imports the authoritative protocol state, the kernel, the session store, the Simulator or
// the Enemy Bot -- coach/architecture-guard.test.ts enforces that on the source text, so a hidden
// enemy identity cannot reach the Coach by a later refactor either.
//
// "Legal evidence" for a role belief is: the hero's public position distribution (heroPositions) and
// an explicit position the Player assigned. A hero is only ever assessed once it is legally visible
// (KNOWN = our own, REVEALED = the enemy's, after their round closed).

export interface PlayerPersonalContext {
  position: Position;
  /** Wave 3 fills this (Hero Pool scoping). Wave 2 never populates it. */
  heroPool: HeroId[];
}

export interface CoachObservableState {
  view: PerspectiveDraftView;
  /** Only heroes the enemy has legally REVEALED. Never a hidden slot. */
  enemyRoleBeliefs: Map<HeroId, RoleBelief>;
  /** Our own picks (KNOWN with certainty of identity, position still a belief unless assigned). */
  ownRoleBeliefs: Map<HeroId, RoleBelief>;
  /** Explicit Player assignments -- override inference. Only visible heroes are kept. */
  playerPositionAssignments: Map<HeroId, Position>;
  personalContext: PlayerPersonalContext | null;
  /** Straight from `view.bannedHeroes` -- bans are visible to both sides. */
  confirmedBans: HeroId[];
}

export interface BuildCoachObservableStateInput {
  heroPositions?: HeroPositions;
  personalContext?: PlayerPersonalContext | null;
  /** Requested Player assignments. Assignments for a hero that is not legally visible are dropped. */
  playerPositionAssignments?: ReadonlyMap<HeroId, Position>;
}

function visibleHeroIds(slots: readonly PerspectiveHeroSlot[], allowed: ReadonlyArray<PerspectiveHeroSlot["visibility"]>): HeroId[] {
  return slots.flatMap((slot) => (slot.visibility !== "HIDDEN" && allowed.includes(slot.visibility) ? [slot.heroId] : []));
}

function believe(
  heroIds: readonly HeroId[],
  assignments: ReadonlyMap<HeroId, Position>,
  heroPositions: HeroPositions | undefined,
): Map<HeroId, RoleBelief> {
  const beliefs = new Map<HeroId, RoleBelief>();
  for (const heroId of heroIds) {
    beliefs.set(heroId, computeRoleBelief({ heroId, confirmedPosition: assignments.get(heroId) ?? null, heroPositions }));
  }
  return beliefs;
}

/** Pure. Same view + same evidence -> same state. */
export function buildCoachObservableState(view: PerspectiveDraftView, input: BuildCoachObservableStateInput = {}): CoachObservableState {
  const enemyHeroes = visibleHeroIds(view.enemyPicks, ["REVEALED"]);
  const ownHeroes = visibleHeroIds(view.ownPicks, ["KNOWN", "REVEALED"]);
  const visible = new Set<HeroId>([...enemyHeroes, ...ownHeroes]);

  const playerPositionAssignments = new Map<HeroId, Position>();
  for (const [heroId, position] of input.playerPositionAssignments ?? []) {
    if (visible.has(heroId)) playerPositionAssignments.set(heroId, position);
  }

  return {
    view,
    enemyRoleBeliefs: believe(enemyHeroes, playerPositionAssignments, input.heroPositions),
    ownRoleBeliefs: believe(ownHeroes, playerPositionAssignments, input.heroPositions),
    playerPositionAssignments,
    personalContext: input.personalContext ?? null,
    confirmedBans: [...view.bannedHeroes],
  };
}
