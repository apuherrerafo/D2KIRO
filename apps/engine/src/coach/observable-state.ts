import { computeJointRoleAssignment, type JointAssignmentHeroInput } from "../draft-protocol/roles/joint-assignment";
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

export interface RoleCollisionObservation {
  infeasible: boolean;
  conflicts: readonly { position: Position; heroIds: readonly HeroId[] }[];
}

export interface CoachObservableState {
  view: PerspectiveDraftView;
  /** Only heroes the enemy has legally REVEALED. Never a hidden slot. */
  enemyRoleBeliefs: Map<HeroId, RoleBelief>;
  /** Our own picks (KNOWN with certainty of identity, position still a belief unless assigned). */
  ownRoleBeliefs: Map<HeroId, RoleBelief>;
  /** Explicit Player assignments -- own visible heroes only; never enemy role evidence. */
  playerPositionAssignments: Map<HeroId, Position>;
  personalContext: PlayerPersonalContext | null;
  /** Straight from `view.bannedHeroes` -- bans are visible to both sides. */
  confirmedBans: HeroId[];
  roleCollision: RoleCollisionObservation;
}

export interface BuildCoachObservableStateInput {
  heroPositions?: HeroPositions;
  personalContext?: PlayerPersonalContext | null;
  /** Requested own-team assignments. Enemy, hidden and unknown hero IDs are dropped. */
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
    // Only explicit Player assignments are hard structural evidence. A LIKELY/UNRESOLVED
    // inference is intentionally absent here: feeding it back would manufacture certainty.
    const occupiedPositions = new Set<Position>();
    for (const [assignedHero, position] of assignments) if (assignedHero !== heroId && heroIds.includes(assignedHero)) occupiedPositions.add(position);
    beliefs.set(heroId, computeRoleBelief({ heroId, confirmedPosition: assignments.get(heroId) ?? null, occupiedPositions, heroPositions }));
  }
  return beliefs;
}

/** Explicit assignments may only name a position supported by public hero-position evidence. */
export function isCompatiblePosition(heroId: HeroId, position: Position, heroPositions: HeroPositions | undefined): boolean {
  const positions = heroPositions?.[heroId] ?? [];
  // No public distribution means no basis to call an explicit correction incompatible. It remains
  // a Player confirmation; when evidence exists, incompatible positions are rejected safely.
  return positions.length === 0 || positions.some((entry) => entry.position === position);
}

/** Pure. Same view + same evidence -> same state. */
export function buildCoachObservableState(view: PerspectiveDraftView, input: BuildCoachObservableStateInput = {}): CoachObservableState {
  const enemyHeroes = visibleHeroIds(view.enemyPicks, ["REVEALED"]);
  const ownHeroes = visibleHeroIds(view.ownPicks, ["KNOWN", "REVEALED"]);
  const ownVisible = new Set<HeroId>(ownHeroes);

  const playerPositionAssignments = new Map<HeroId, Position>();
  for (const [heroId, position] of input.playerPositionAssignments ?? []) {
    if (ownVisible.has(heroId)) playerPositionAssignments.set(heroId, position);
  }

  const ownRoleBeliefs = believe(ownHeroes, playerPositionAssignments, input.heroPositions);
  const ownHeroInputs: JointAssignmentHeroInput[] = ownHeroes.map((heroId) => ({
    heroId,
    belief: ownRoleBeliefs.get(heroId)!,
  }));
  const ownSeating = computeJointRoleAssignment(ownHeroInputs);
  const roleCollision: RoleCollisionObservation = {
    infeasible: ownSeating.rejected === "IMPOSSIBLE_ASSIGNMENT",
    conflicts: ownSeating.conflicts ?? [],
  };

  return {
    view,
    enemyRoleBeliefs: believe(enemyHeroes, playerPositionAssignments, input.heroPositions),
    ownRoleBeliefs,
    playerPositionAssignments,
    personalContext: input.personalContext ?? null,
    confirmedBans: [...view.bannedHeroes],
    roleCollision,
  };
}
