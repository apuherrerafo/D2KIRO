import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { accounts, draftFeedback, heroMatchups, heroPool, settings, teamGroups, teamMembers } from "./schema";

export function getMatchupsForHero<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  heroId: number,
) {
  return db.select().from(heroMatchups).where(eq(heroMatchups.heroId, heroId)).all();
}

// Aditivo (TSK-014): "settings" solo tenía esquema (TSK-002) -- nadie había construido las
// queries ni las rutas HTTP todavía.
export function getAllSettings<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>) {
  return db.select().from(settings).all();
}

export function upsertSetting<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  key: string,
  value: string,
) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
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
  slot: number;
  name: string;
  heroPool: number[];
  updatedAt: string;
}

export interface TeamGroupWriteRow {
  name: string;
  partySize: PartySize;
  updatedAt: string;
  members: TeamMemberWriteRow[];
}

export interface TeamMemberReadRow extends TeamMemberWriteRow {
  id: number;
  teamGroupId: number;
}

export interface TeamGroupReadRow {
  id: number;
  name: string;
  partySize: PartySize;
  updatedAt: string;
  members: TeamMemberReadRow[];
}

function attachMembers(groups: Omit<TeamGroupReadRow, "members">[], members: TeamMemberReadRow[]): TeamGroupReadRow[] {
  return groups.map((group) => ({
    ...group,
    members: members.filter((member) => member.teamGroupId === group.id).sort((a, b) => a.slot - b.slot),
  }));
}

export function getTeamGroups<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>): TeamGroupReadRow[] {
  const groups = db.select().from(teamGroups).all();
  const members = db.select().from(teamMembers).all();
  return attachMembers(groups, members);
}

export function getTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  id: number,
): TeamGroupReadRow | null {
  const [group] = db.select().from(teamGroups).where(eq(teamGroups.id, id)).all();
  if (!group) return null;
  const members = db.select().from(teamMembers).where(eq(teamMembers.teamGroupId, id)).all();
  return attachMembers([group], members)[0] ?? null;
}

function insertTeamMembers<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  teamGroupId: number,
  members: TeamMemberWriteRow[],
) {
  for (const member of members) {
    db.insert(teamMembers).values({ ...member, teamGroupId }).run();
  }
}

export function createTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  input: TeamGroupWriteRow,
): TeamGroupReadRow {
  let id = 0;
  db.transaction((tx) => {
    const [created] = tx.insert(teamGroups).values({ name: input.name, partySize: input.partySize, updatedAt: input.updatedAt }).returning().all();
    id = created!.id;
    insertTeamMembers(tx, id, input.members);
  });
  return getTeamGroup(db, id)!;
}

export function replaceTeamGroup<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  id: number,
  input: TeamGroupWriteRow,
): TeamGroupReadRow | null {
  if (!getTeamGroup(db, id)) return null;
  db.transaction((tx) => {
    tx.update(teamGroups).set({ name: input.name, partySize: input.partySize, updatedAt: input.updatedAt }).where(eq(teamGroups.id, id)).run();
    tx.delete(teamMembers).where(eq(teamMembers.teamGroupId, id)).run();
    insertTeamMembers(tx, id, input.members);
  });
  return getTeamGroup(db, id);
}

export function deleteTeamGroup<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>, id: number): boolean {
  if (!getTeamGroup(db, id)) return false;
  db.transaction((tx) => {
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
