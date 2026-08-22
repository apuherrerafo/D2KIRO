import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import {
  createTeamGroup,
  deleteTeamGroup,
  getTeamGroup,
  getTeamGroups,
  replaceTeamGroup,
  type PartySize,
  type TeamGroupWriteRow,
} from "../../db/queries";

// TSK-056: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach"). Mismo comportamiento exacto -- verificado con la suite de integración existente
// de app.test.ts.
export interface TeamGroupRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
}

interface TeamMemberPutEntry {
  slot: number;
  name: string;
  heroPool: number[];
}

interface TeamGroupPutBody {
  name: string;
  partySize: PartySize;
  members: TeamMemberPutEntry[];
}

function isPartySize(value: unknown): value is PartySize {
  return value === 1 || value === 2 || value === 3 || value === 5;
}

function isValidTeamMemberPutEntry(value: unknown): value is TeamMemberPutEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (!Number.isInteger(entry.slot) || (entry.slot as number) < 1 || (entry.slot as number) > 4) return false;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) return false;
  if (!Array.isArray(entry.heroPool) || entry.heroPool.length > 5) return false;
  if (!entry.heroPool.every((hero) => Number.isInteger(hero) && hero > 0)) return false;
  return new Set(entry.heroPool).size === entry.heroPool.length;
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
  if (body.members.length !== partySize - 1) return false;
  const slots = body.members.map((member) => member.slot);
  if (new Set(slots).size !== slots.length) return false;
  return slots.every((slot) => slot >= 1 && slot < partySize);
}

function teamBodyToWriteRow(body: TeamGroupPutBody): TeamGroupWriteRow {
  const updatedAt = new Date().toISOString();
  return {
    name: body.name.trim(),
    partySize: body.partySize,
    updatedAt,
    members: body.members.map((member) => ({ slot: member.slot, name: member.name.trim(), heroPool: member.heroPool, updatedAt })),
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

  function list(): Response {
    return Response.json(getTeamGroups(deps.db));
  }

  function get(id: number): Response {
    const group = getTeamGroup(deps.db, id);
    if (!group) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(group);
  }

  async function post(request: Request): Promise<Response> {
    const body = await readTeamGroupBody(request);
    if (!body) return Response.json({ error: "invalid_body" }, { status: 400 });
    return Response.json(createTeamGroup(deps.db, teamBodyToWriteRow(body)), { status: 201 });
  }

  async function put(request: Request, id: number): Promise<Response> {
    const body = await readTeamGroupBody(request);
    if (!body) return Response.json({ error: "invalid_body" }, { status: 400 });
    const updated = replaceTeamGroup(deps.db, id, teamBodyToWriteRow(body));
    if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(updated, { status: 200 });
  }

  function del(id: number): Response {
    if (!deleteTeamGroup(deps.db, id)) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  }

  function parseId(pathname: string): number | null {
    const match = /^\/api\/team-groups\/([1-9]\d*)$/.exec(pathname);
    if (!match) return null;
    return Number(match[1]);
  }

  return { list, get, post, put, delete: del, parseId };
}
