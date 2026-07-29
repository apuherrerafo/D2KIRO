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
