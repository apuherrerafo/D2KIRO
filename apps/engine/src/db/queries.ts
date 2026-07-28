import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroMatchups, settings } from "./schema";

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
