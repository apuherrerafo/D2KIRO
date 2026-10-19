import { and, desc, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { accounts, draftFeedback, heroMatchups, heroPool, recommendationFeedback, teamGroups, teamMemberPositionPools, teamMembers } from "./schema";

export function getMatchupsForHero<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  heroId: number,
) {
  return db.select().from(heroMatchups).where(eq(heroMatchups.heroId, heroId)).all();
}

// TSK-017 (fase 1b, S8 la usará luego): la "1 query afectada" de la excepción de migración
// documentada en CLAUDE.md. Solo lectura -- el reemplazo transaccional del pool completo es
// responsabilidad de TSK-020, no de este ticket.
// TSK-095 (Fase 5, SPEC.md §12.7): `accountId` es obligatorio, no opcional -- un pool es siempre
// el de una cuenta, nunca "el" pool global. Nunca devuelve filas de otra cuenta.
export function getHeroPool<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  accountId: number,
) {
  return db.select().from(heroPool).where(eq(heroPool.accountId, accountId)).all();
}

export interface HeroPoolWriteRow {
  heroId: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
  updatedAt: string;
}

// TSK-020 (fase 1b, S8): único camino de escritura del pool -- borra todo e inserta las nuevas
// entradas dentro de la misma transacción de Drizzle. Un fallo a mitad de camino (ej. una fila
// inválida) nunca deja el pool a medio reemplazar, mismo principio que la sincronización de meta
// (S6) en sync.ts.
// TSK-095: el borrado se scopea a la cuenta -- reemplazar el pool de una cuenta nunca toca las
// filas de otra.
export function replaceHeroPool<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  accountId: number,
  entries: HeroPoolWriteRow[],
) {
  db.transaction((tx) => {
    tx.delete(heroPool).where(eq(heroPool.accountId, accountId)).run();
    for (const entry of entries) tx.insert(heroPool).values({ ...entry, accountId }).run();
  });
}

// TSK-095: bridge temporal -- hasta TSK-098 (token real por request), las rutas HTTP de hero-pool
// siguen sirviendo a la única cuenta real que existe hoy en producción (migrada por TSK-094), en
// vez de romper el flujo de un solo usuario que ya está en vivo. `null` si `accounts` está vacía
// (checkout limpio/CI) -- el llamador decide qué hacer, esta función nunca inventa una cuenta.
// TSK-098 la reemplaza por completo, tomando el accountId real del token verificado.
export function getSoleAccountId<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
): number | null {
  const [row] = db.select({ id: accounts.steamAccountId }).from(accounts).limit(1).all();
  return row?.id ?? null;
}

export type PartySize = 1 | 2 | 3 | 5;

export interface TeamMemberWriteRow {
  /**
   * Who this is. Present = an existing member of the team being replaced (same person: nickname, slot, position and
   * pool may change, the identity does not). Absent = a new person, who gets a fresh id and no inherited pool.
   */
  id?: number;
  slot: number;
  /** Usual position, explicit. `null` = unconfirmed -- never derived from `slot`. */
  position: 1 | 2 | 3 | 4 | 5 | null;
  name: string;
  heroPool: number[];
  updatedAt: string;
}

export interface TeamGroupWriteRow {
  accountId: number;
  name: string;
  partySize: PartySize;
  updatedAt: string;
  members: TeamMemberWriteRow[];
}

/** One hero pool of one person at one seat (Hero Pools V2). `version` is the compare-and-set token. */
export interface MemberPositionPoolRow {
  position: 1 | 2 | 3 | 4 | 5;
  heroPool: number[];
  version: number;
  updatedAt: string;
}

export interface TeamMemberReadRow extends TeamMemberWriteRow {
  id: number;
  teamGroupId: number;
  /** Pools by seat, ordered by position. Independent of `position` (the usual seat) and of the legacy `heroPool`. */
  positionPools: MemberPositionPoolRow[];
}

export interface TeamGroupReadRow {
  id: number;
  accountId: number | null;
  name: string;
  partySize: PartySize;
  updatedAt: string;
  members: TeamMemberReadRow[];
}

type TeamMemberRow = typeof teamMembers.$inferSelect;

function attachMembers<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  groups: Omit<TeamGroupReadRow, "members">[],
  members: TeamMemberRow[],
): TeamGroupReadRow[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const owned = members.filter((member) => groupIds.has(member.teamGroupId));
  const pools = owned.length === 0
    ? []
    : db.select().from(teamMemberPositionPools).where(inArray(teamMemberPositionPools.memberId, owned.map((member) => member.id))).all();
  return groups.map((group) => ({
    ...group,
    members: owned
      .filter((member) => member.teamGroupId === group.id)
      .sort((a, b) => a.slot - b.slot)
      .map((member) => ({
        ...member,
        positionPools: pools
          .filter((pool) => pool.memberId === member.id)
          .sort((a, b) => a.position - b.position)
          .map(({ position, heroPool, version, updatedAt }) => ({ position, heroPool, version, updatedAt })),
      })),
  }));
}

export function getTeamGroups<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>, accountId: number): TeamGroupReadRow[] {
  const groups = db.select().from(teamGroups).where(eq(teamGroups.accountId, accountId)).all();
  const members = db.select().from(teamMembers).all();
  return attachMembers(db, groups, members);
}

export function getTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  id: number, accountId: number,
): TeamGroupReadRow | null {
  const [group] = db.select().from(teamGroups).where(and(eq(teamGroups.id, id), eq(teamGroups.accountId, accountId))).all();
  if (!group) return null;
  const members = db.select().from(teamMembers).where(eq(teamMembers.teamGroupId, id)).all();
  return attachMembers(db, [group], members)[0] ?? null;
}

export function getTeamGroupById<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  id: number,
): TeamGroupReadRow | null {
  const [group] = db.select().from(teamGroups).where(eq(teamGroups.id, id)).all();
  if (!group) return null;
  const members = db.select().from(teamMembers).where(eq(teamMembers.teamGroupId, id)).all();
  return attachMembers(db, [group], members)[0] ?? null;
}

function insertTeamMembers<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  teamGroupId: number,
  members: TeamMemberWriteRow[],
) {
  for (const { id: _ignored, ...member } of members) {
    const [created] = db.insert(teamMembers).values({ ...member, teamGroupId }).returning({ id: teamMembers.id }).all();
    // A new person who arrives with a confirmed seat AND a pool gets that pool as their pool for THAT seat (same rule
    // as the 0011 backfill). Later position changes then can't re-aim the legacy list at another seat.
    if (created && member.position !== null && member.heroPool.length > 0) {
      db.insert(teamMemberPositionPools).values({ memberId: created.id, position: member.position, heroPool: member.heroPool, version: 1, updatedAt: member.updatedAt }).run();
    }
  }
}

/**
 * Brings a team's members to `members` WITHOUT recycling identities: an entry with an `id` updates that very row (so a
 * rename, a reorder or a position swap never moves a pool to another person); an entry without one is a new person;
 * a member nobody names any more is deleted. An id that isn't a member of this team (or is named twice) throws, which
 * rolls the whole save back -- it is never reinterpreted as somebody else.
 */
function syncTeamMembers<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  teamGroupId: number,
  members: TeamMemberWriteRow[],
) {
  const existingIds = new Set(db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamGroupId, teamGroupId)).all().map((row) => row.id));
  const kept = new Set<number>();
  const added: TeamMemberWriteRow[] = [];
  for (const member of members) {
    if (member.id === undefined) {
      added.push(member);
      continue;
    }
    if (!existingIds.has(member.id) || kept.has(member.id)) throw new Error("unknown_team_member");
    kept.add(member.id);
    // Defense in depth: an existing person's legacy `heroPool` is never rewritten here (the route refuses such an edit).
    const { id: memberId, heroPool: _legacyPool, ...fields } = member;
    db.update(teamMembers).set(fields).where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamGroupId, teamGroupId))).run();
  }
  for (const existingId of existingIds) {
    if (kept.has(existingId)) continue;
    db.delete(teamMemberPositionPools).where(eq(teamMemberPositionPools.memberId, existingId)).run();
    db.delete(teamMembers).where(eq(teamMembers.id, existingId)).run();
  }
  insertTeamMembers(db, teamGroupId, added);
}

export function createTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  input: TeamGroupWriteRow,
): TeamGroupReadRow {
  let id = 0;
  db.transaction((tx) => {
    const [created] = tx.insert(teamGroups).values({ accountId: input.accountId, name: input.name, partySize: input.partySize, updatedAt: input.updatedAt }).returning().all();
    id = created!.id;
    insertTeamMembers(tx, id, input.members);
  });
  return getTeamGroup(db, id, input.accountId)!;
}

export function replaceTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  id: number, accountId: number,
  input: TeamGroupWriteRow,
): TeamGroupReadRow | null {
  if (!getTeamGroup(db, id, accountId)) return null;
  db.transaction((tx) => {
    tx.update(teamGroups).set({ name: input.name, partySize: input.partySize, updatedAt: input.updatedAt }).where(eq(teamGroups.id, id)).run();
    syncTeamMembers(tx, id, input.members);
  });
  return getTeamGroup(db, id, accountId);
}

export type SetMemberPoolResult =
  | { ok: true; pool: MemberPositionPoolRow }
  | { ok: false; reason: "not_found" | "stale_pool" };

/**
 * Writes ONE pool (member + seat) with compare-and-set: `expectedVersion` is the version the caller last read (0 = "I
 * believe there is none yet"). A mismatch writes nothing, so a stale tab can't overwrite a newer pool. The member must
 * belong to `teamGroupId`, which must belong to `accountId` -- anything else is `not_found`, never a cross-account write.
 */
export function setMemberPositionPool<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  accountId: number,
  teamGroupId: number,
  memberId: number,
  position: 1 | 2 | 3 | 4 | 5,
  heroPool: number[],
  expectedVersion: number,
  updatedAt: string,
): SetMemberPoolResult {
  return db.transaction((tx) => {
    const group = getTeamGroup(tx, teamGroupId, accountId);
    if (!group || !group.members.some((member) => member.id === memberId)) return { ok: false, reason: "not_found" } as const;
    const where = and(eq(teamMemberPositionPools.memberId, memberId), eq(teamMemberPositionPools.position, position));
    const [current] = tx.select().from(teamMemberPositionPools).where(where).all();
    if ((current?.version ?? 0) !== expectedVersion) return { ok: false, reason: "stale_pool" } as const;
    const version = expectedVersion + 1;
    if (current) tx.update(teamMemberPositionPools).set({ heroPool, version, updatedAt }).where(where).run();
    else tx.insert(teamMemberPositionPools).values({ memberId, position, heroPool, version, updatedAt }).run();
    return { ok: true, pool: { position, heroPool, version, updatedAt } } as const;
  });
}

export function deleteTeamGroup<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>, id: number, accountId: number): boolean {
  if (!getTeamGroup(db, id, accountId)) return false;
  db.transaction((tx) => {
    const memberIds = tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamGroupId, id)).all().map((row) => row.id);
    if (memberIds.length > 0) tx.delete(teamMemberPositionPools).where(inArray(teamMemberPositionPools.memberId, memberIds)).run();
    tx.delete(teamMembers).where(eq(teamMembers.teamGroupId, id)).run();
    tx.delete(teamGroups).where(eq(teamGroups.id, id)).run();
  });
  return true;
}

export interface DraftFeedbackWriteRow {
  sessionId: string;
  comment: string;
  draftState: unknown;
  suggestions: unknown | null;
  createdAt: string;
}

// TSK-051: inbox append-only (TSK-050) -- sin update ni delete, mismo espíritu que journal.md.
export function insertDraftFeedback<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  row: DraftFeedbackWriteRow,
) {
  db.insert(draftFeedback).values(row).run();
}

// Más nuevo primero -- para que una sesión de Claude Code futura lea los reportes pendientes
// arriba, sin tener que hojear todo el historial. Ordena por `id`, no por `createdAt`: dos
// reportes insertados dentro del mismo milisegundo (doble click, envíos rápidos) empatarían en
// timestamp -- `id` autoincremental sí garantiza el orden real de inserción.
export function getAllDraftFeedback<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>) {
  return db.select().from(draftFeedback).orderBy(desc(draftFeedback.id)).all();
}

export type FeedbackNegativeReason =
  | "wrong_position"
  | "poor_hero"
  | "questionable_counter"
  | "unclear_explanation"
  | "not_useful"
  | "other";

export interface RecommendationFeedbackWriteRow {
  sessionId: string;
  heroId: number;
  targetPosition?: number | null;
  rating: "positive" | "negative";
  reason?: FeedbackNegativeReason | null;
  comment?: string | null;
  stateIdentity?: string | null;
  rulesetId?: string | null;
  rulesetVersion?: string | null;
  accountId?: number | null;
  createdAt: string;
}

export function insertRecommendationFeedback<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  row: RecommendationFeedbackWriteRow,
) {
  db.insert(recommendationFeedback).values(row).run();
}

export function getRecommendationFeedbackByTarget<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  sessionId: string,
  heroId: number,
  stateIdentity?: string | null,
) {
  if (stateIdentity) {
    return db
      .select()
      .from(recommendationFeedback)
      .where(
        and(
          eq(recommendationFeedback.sessionId, sessionId),
          eq(recommendationFeedback.heroId, heroId),
          eq(recommendationFeedback.stateIdentity, stateIdentity),
        ),
      )
      .all();
  }
  return db
    .select()
    .from(recommendationFeedback)
    .where(
      and(
        eq(recommendationFeedback.sessionId, sessionId),
        eq(recommendationFeedback.heroId, heroId),
      ),
    )
    .all();
}

export function getAllRecommendationFeedback<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
) {
  return db.select().from(recommendationFeedback).orderBy(desc(recommendationFeedback.id)).all();
}

