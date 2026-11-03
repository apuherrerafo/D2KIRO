import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";

// Saved team -> pool per position. The ONE place that turns a saved team into `playerPoolsByPosition`.
//
// Three different facts, never mixed up:
//   - usual position   `member.position`      what the user confirmed when saving the team (nullable)
//   - this match       `TeamAssignment`        a per-game override, never written back to the saved team
//   - display order    `member.slot`           how the editor listed them -- NOT a position, never read here
//
// A member with neither an override nor a usual position gets no pool: a position is never guessed.
//
// Pools (Hero Pools V2, F2): a pool belongs to member.id + position. The pool of the seat a member plays THIS match is
// the one that activates -- `positionPools` has it, or that seat has none. The pool of any other seat is never borrowed:
// a carry moved to Pos 5 gets their Pos 5 pool or nothing (the recommender then falls back to credible role candidates).
// `heroPool` is the LEGACY single list. A member read from the DB never uses it (it records no seat; F4 will let the user
// confirm one explicitly). It survives only as a fallback for records without a `positionPools` field, at the usual seat.

export interface SavedTeamMember {
  /** `team_members.id`; what a per-match assignment names. Absent only for rows that can't be addressed. */
  id?: number;
  position?: number | null;
  heroPool: readonly number[];
  /** One pool per seat. Absent = a row from before V2 (only the legacy `heroPool` fallback applies). */
  positionPools?: readonly { position: number; heroPool: readonly number[] }[];
}

/**
 * memberId -> the position that member plays THIS match. When present it is the WHOLE picture of the match: a member
 * it doesn't name is unplaced (no pool), it does not quietly fall back to their usual position.
 */
export type TeamAssignment = ReadonlyMap<number, Position>;

export type PoolsByPosition = Partial<Record<Position, readonly HeroId[]>>;

function asPosition(value: unknown): Position | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
}

function positionOf(member: SavedTeamMember, assignment: TeamAssignment | null | undefined): Position | null {
  if (!assignment) return asPosition(member.position);
  if (member.id === undefined) return null;
  return assignment.get(member.id) ?? null;
}

/** The pool `member` brings to `seat`, or null. Never reads the pool of a different seat. */
function poolForSeat(member: SavedTeamMember, seat: Position): readonly number[] | null {
  const pools = member.positionPools ?? [];
  const own = pools.find((pool) => pool.position === seat);
  if (own) return own.heroPool;
  // Legacy fallback ONLY for a record that predates `positionPools` altogether (hand-built callers/fixtures). A member
  // read from the DB always carries the array: if it has no row for this seat, the legacy list does NOT stand in -- it
  // doesn't record which seat it was written for, so it waits for an explicit confirmation (never inferred from the
  // usual position, which can change after the list was written).
  if (member.positionPools !== undefined) return null;
  return seat === asPosition(member.position) ? member.heroPool : null;
}

/**
 * Pools keyed by the position each member actually plays. `ownerPosition` is left without a team pool: the owner
 * always uses their own personal hero pool. A position claimed by two members is left without a pool too -- there is
 * no way to tell whose it is, and guessing is exactly the bug this exists to prevent.
 */
export function poolsByConfirmedPosition(
  members: readonly SavedTeamMember[],
  assignment?: TeamAssignment | null,
  ownerPosition?: Position | null,
): PoolsByPosition {
  const claims = new Map<Position, readonly HeroId[]>();
  const contested = new Set<Position>();
  for (const member of members) {
    const position = positionOf(member, assignment);
    if (position === null) continue;
    const heroes = (poolForSeat(member, position) ?? []).filter((id) => Number.isInteger(id) && id > 0);
    if (heroes.length === 0) continue;
    if (claims.has(position)) contested.add(position);
    else claims.set(position, heroes);
  }
  const pools: PoolsByPosition = {};
  for (const [position, heroes] of claims) {
    if (contested.has(position) || position === ownerPosition) continue;
    pools[position] = heroes;
  }
  return pools;
}

/**
 * The per-match assignment of a request body: `{ "<memberId>": 1..5 }`. `undefined` (absent) is fine and means "use the
 * saved positions"; anything malformed is `null` so the route can refuse it (never silently half-apply it).
 */
export function parseTeamAssignment(raw: unknown): TeamAssignment | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 5) return null;
  const assignment = new Map<number, Position>();
  const taken = new Set<Position>();
  for (const [key, value] of entries) {
    const memberId = Number(key);
    const position = asPosition(value);
    if (!Number.isSafeInteger(memberId) || memberId <= 0 || position === null || taken.has(position)) return null;
    taken.add(position);
    assignment.set(memberId, position);
  }
  return assignment;
}

/** Every id the assignment names must be a member of the loaded team (no foreign / stale ids). */
export function assignmentBelongsToTeam(assignment: TeamAssignment, members: readonly SavedTeamMember[]): boolean {
  const ids = new Set(members.flatMap((member) => (member.id === undefined ? [] : [member.id])));
  return [...assignment.keys()].every((id) => ids.has(id));
}

/** The pools minus the owner's declared seat (the owner plays from their personal pool). `null` when none is left. */
export function withoutOwnerSeat(pools: PoolsByPosition | null | undefined, ownerPosition: Position | null | undefined): PoolsByPosition | null {
  if (!pools) return null;
  if (ownerPosition === null || ownerPosition === undefined) return pools;
  const { [ownerPosition]: _ownerPool, ...rest } = pools;
  return Object.keys(rest).length === 0 ? null : rest;
}
