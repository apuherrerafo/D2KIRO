import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import {
  createTeamGroup,
  deleteTeamGroup,
  getTeamGroup,
  getTeamGroups,
  replaceTeamGroup,
  setMemberPositionPool,
  type PartySize,
  type TeamGroupWriteRow,
} from "../../db/queries";

// TSK-056: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach"). Mismo comportamiento exacto -- verificado con la suite de integración existente
// de app.test.ts.
export interface TeamGroupRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
}

type TeamPosition = 1 | 2 | 3 | 4 | 5;

interface TeamMemberPutEntry {
  /** Which saved member this is (same person, possibly renamed). Absent = a new person. Only valid on PUT. */
  id?: number;
  slot: number;
  /** Usual position. Absent / null = not confirmed; the engine never fills it in from `slot`. */
  position?: TeamPosition | null;
  name: string;
  heroPool: number[];
}

function isTeamPosition(value: unknown): value is TeamPosition {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

interface TeamGroupPutBody {
  name: string;
  partySize: PartySize;
  members: TeamMemberPutEntry[];
}

function sameHeroList(stored: readonly number[] | undefined, sent: readonly number[]): boolean {
  return stored !== undefined && stored.length === sent.length && stored.every((hero, index) => hero === sent[index]);
}

function isPartySize(value: unknown): value is PartySize {
  return value === 1 || value === 2 || value === 3 || value === 5;
}

function isValidTeamMemberPutEntry(value: unknown): value is TeamMemberPutEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (entry.id !== undefined && (!Number.isSafeInteger(entry.id) || (entry.id as number) < 1)) return false;
  if (!Number.isInteger(entry.slot) || (entry.slot as number) < 1 || (entry.slot as number) > 5) return false;
  if (entry.position !== undefined && entry.position !== null && !isTeamPosition(entry.position)) return false;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) return false;
  if (!Array.isArray(entry.heroPool) || entry.heroPool.length > 5) return false;
  if (!entry.heroPool.every((hero) => Number.isInteger(hero) && hero > 0)) return false;
  return new Set(entry.heroPool).size === entry.heroPool.length;
}

interface PoolPutBody {
  /** At most 5 distinct heroes. `[]` is an explicit "no pool for this seat" (it shadows the legacy list). */
  heroPool: number[];
  /** The `version` the caller last read for this pool; `0` = "there is none yet". */
  expectedVersion: number;
}

function isValidPoolBody(value: unknown): value is PoolPutBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) return false;
  if (!Array.isArray(body.heroPool) || body.heroPool.length > 5) return false;
  if (!body.heroPool.every((hero) => Number.isSafeInteger(hero) && hero > 0)) return false;
  return new Set(body.heroPool).size === body.heroPool.length;
}

function isValidTeamGroupPutBody(value: unknown): value is TeamGroupPutBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.name !== "string" || body.name.trim().length === 0) return false;
  if (!isPartySize(body.partySize)) return false;
  // Copiado a una variable local: la angostura de tipo de isPartySize no sobrevive dentro de los
  // closures de abajo (.every()) cuando se sigue leyendo vía la propiedad `body.partySize`.
  const partySize = body.partySize;
  if (!Array.isArray(body.members) || !body.members.every(isValidTeamMemberPutEntry)) return false;
  const isFullParty = body.members.length === partySize;
  const isCompanionsOnly = body.members.length === partySize - 1;
  if (!isFullParty && !isCompanionsOnly) return false;
  const ids = body.members.flatMap((member) => (member.id === undefined ? [] : [member.id]));
  if (new Set(ids).size !== ids.length) return false;
  const slots = body.members.map((member) => member.slot);
  if (new Set(slots).size !== slots.length) return false;
  // Two people can't hold the same usual position.
  const positions = body.members.flatMap((member) => (member.position === undefined || member.position === null ? [] : [member.position]));
  if (new Set(positions).size !== positions.length) return false;
  return isFullParty
    ? slots.every((slot) => slot >= 1 && slot <= partySize)
    : slots.every((slot) => slot >= 1 && slot < partySize);
}

function teamBodyToWriteRow(body: TeamGroupPutBody, accountId: number): TeamGroupWriteRow {
  const updatedAt = new Date().toISOString();
  return {
    accountId, name: body.name.trim(),
    partySize: body.partySize,
    updatedAt,
    members: body.members.map((member) => ({ id: member.id, slot: member.slot, position: member.position ?? null, name: member.name.trim(), heroPool: member.heroPool, updatedAt })),
  };
}

export function createTeamGroupRoutes<TSchema extends Record<string, unknown>>(deps: TeamGroupRouteDeps<TSchema>) {
  function teamBodyUsesKnownHeroes(body: TeamGroupPutBody): boolean {
    const knownHeroIds = new Set(deps.db.select({ id: schema.heroes.id }).from(schema.heroes).all().map((row) => row.id));
    return body.members.every((member) => member.heroPool.every((hero) => knownHeroIds.has(hero)));
  }

  async function readTeamGroupBody(request: Request): Promise<TeamGroupPutBody | null> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidTeamGroupPutBody(body)) return null;
    if (!teamBodyUsesKnownHeroes(body)) return null;
    return body;
  }

  function list(accountId: number): Response {
    return Response.json(getTeamGroups(deps.db, accountId));
  }

  function get(id: number, accountId: number): Response {
    const group = getTeamGroup(deps.db, id, accountId);
    if (!group) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(group);
  }

  async function post(request: Request, accountId: number): Promise<Response> {
    const body = await readTeamGroupBody(request);
    // A new team has no members yet, so an id can only be a reference to somebody else's row.
    if (!body || body.members.some((member) => member.id !== undefined)) return Response.json({ error: "invalid_body" }, { status: 400 });
    return Response.json(createTeamGroup(deps.db, teamBodyToWriteRow(body, accountId)), { status: 201 });
  }

  async function put(request: Request, id: number, accountId: number): Promise<Response> {
    const body = await readTeamGroupBody(request);
    if (!body) return Response.json({ error: "invalid_body" }, { status: 400 });
    // A tab opened before positions existed knows nothing about them and would save every member back as unconfirmed.
    // Once the team has confirmed positions, a save must state them (a number, or an explicit null to clear one).
    const stored = getTeamGroup(deps.db, id, accountId);
    if (stored?.members.some((member) => member.position !== null) && body.members.some((member) => member.position === undefined)) {
      return Response.json({ error: "positions_required" }, { status: 409 });
    }
    // A tab from before member ids existed names nobody. Applied literally, every saved person would be deleted and
    // recreated under a new id -- taking their position pools with them -- while the answer says 200. Once any pool
    // exists, a save must name at least one saved person; a newcomer is the entry WITHOUT an id next to the ones that
    // have it. A team with no pools yet has nothing to lose, so the pre-identity behaviour stays.
    if (stored?.members.some((member) => member.positionPools.length > 0) && body.members.every((member) => member.id === undefined)) {
      return Response.json({ error: "member_ids_required" }, { status: 409 });
    }
    // Every id must be a member of THIS team: an id is never re-pointed at a row of another team or at nobody.
    const storedIds = new Set(stored?.members.map((member) => member.id));
    if (body.members.some((member) => member.id !== undefined && !storedIds.has(member.id))) return Response.json({ error: "invalid_body" }, { status: 400 });
    // This PUT is not a hero editor: the legacy list of an existing member can't change here. Answering 200 would be a
    // false save (the active pool lives in the per-seat rows) and writing it would sidestep `expectedVersion`.
    const storedLists = new Map(stored?.members.map((member) => [member.id, member.heroPool]));
    const editsExistingHeroes = body.members.some((member) => member.id !== undefined && !sameHeroList(storedLists.get(member.id), member.heroPool));
    if (editsExistingHeroes) return Response.json({ error: "use_position_pool_editor" }, { status: 409 });
    const updated = replaceTeamGroup(deps.db, id, accountId, teamBodyToWriteRow(body, accountId));
    if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(updated, { status: 200 });
  }

  // Hero Pools V2 (F2): `PUT /api/team-groups/:id/members/:memberId/pools/:position` writes ONE pool. The team PUT never
  // touches pools (an old tab can't wipe them); this is the only write path, guarded by compare-and-set on `version`.
  async function putPool(request: Request, teamGroupId: number, memberId: number, position: TeamPosition, accountId: number): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidPoolBody(body)) return Response.json({ error: "invalid_body" }, { status: 400 });
    const knownHeroIds = new Set(deps.db.select({ id: schema.heroes.id }).from(schema.heroes).all().map((row) => row.id));
    if (!body.heroPool.every((hero) => knownHeroIds.has(hero))) return Response.json({ error: "invalid_body" }, { status: 400 });
    const result = setMemberPositionPool(deps.db, accountId, teamGroupId, memberId, position, body.heroPool, body.expectedVersion, new Date().toISOString());
    if (result.ok) return Response.json(result.pool, { status: 200 });
    if (result.reason === "stale_pool") return Response.json({ error: "stale_pool" }, { status: 409 });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  function parsePoolPath(pathname: string): { teamGroupId: number; memberId: number; position: TeamPosition } | null {
    const match = /^\/api\/team-groups\/([1-9]\d*)\/members\/([1-9]\d*)\/pools\/([1-5])$/.exec(pathname);
    if (!match) return null;
    const teamGroupId = Number(match[1]);
    const memberId = Number(match[2]);
    if (!Number.isSafeInteger(teamGroupId) || !Number.isSafeInteger(memberId)) return null;
    return { teamGroupId, memberId, position: Number(match[3]) as TeamPosition };
  }

  function del(id: number, accountId: number): Response {
    if (!deleteTeamGroup(deps.db, id, accountId)) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  }

  function parseId(pathname: string): number | null {
    const match = /^\/api\/team-groups\/([1-9]\d*)$/.exec(pathname);
    if (!match) return null;
    return Number(match[1]);
  }

  return { list, get, post, put, delete: del, parseId, putPool, parsePoolPath };
}
