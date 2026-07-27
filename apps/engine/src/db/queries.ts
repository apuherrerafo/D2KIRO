import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroMatchups } from "./schema";

export function getMatchupsForHero<TSchema extends Record<string, unknown>>(
  db: BunSQLiteDatabase<TSchema>,
  heroId: number,
) {
  return db.select().from(heroMatchups).where(eq(heroMatchups.heroId, heroId)).all();
}
