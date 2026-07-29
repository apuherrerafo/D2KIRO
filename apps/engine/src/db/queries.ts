import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroMatchups, heroPool, settings } from "./schema";

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
export function getHeroPool<TSchema extends Record<string, unknown>>(db: BunSQLiteDatabase<TSchema>) {
  return db.select().from(heroPool).all();
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
export function replaceHeroPool<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  entries: HeroPoolWriteRow[],
) {
  db.transaction((tx) => {
    tx.delete(heroPool).run();
    for (const entry of entries) tx.insert(heroPool).values(entry).run();
  });
}
