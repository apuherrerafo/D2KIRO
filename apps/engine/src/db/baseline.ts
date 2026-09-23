import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { accounts, draftFeedback, heroMatchups, heroPatchStats, heroPool, heroes, metaSync, settings, teamGroups, teamMembers } from "./schema";
import { mapHero, mapHeroStatsRow } from "../meta/mappers";
import { getValidatedSeed } from "../meta/seed";
import { isValidRawHero } from "../meta/validation";
import seedHeroesRaw from "../meta/seed-heroes.json";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

const BASELINE_UPDATED_AT = "2026-01-01T00:00:00.000Z";
const BASELINE_PATCH = "baseline";

export type BaselineHydrationResult = "hydrated" | "skipped_nonempty" | "invalid_baseline";

function applicationDataCount<TSchema extends Record<string, unknown>>(db: Db<TSchema>): number {
  return [heroes, heroPatchStats, heroMatchups, metaSync, settings, accounts, heroPool, teamGroups, teamMembers, draftFeedback]
    .reduce((total, table) => total + Number(db.select({ count: sql<number>`count(*)` }).from(table).get()?.count ?? 0), 0);
}

export function hydrateBaseline<TSchema extends Record<string, unknown>>(db: Db<TSchema>): BaselineHydrationResult {
  if (applicationDataCount(db) !== 0) return "skipped_nonempty";

  const seedHeroes = Array.isArray(seedHeroesRaw) ? seedHeroesRaw.filter(isValidRawHero) : [];
  const seedStats = getValidatedSeed();
  if (seedHeroes.length === 0 || seedStats.length === 0 || seedHeroes.length !== seedStats.length) return "invalid_baseline";

  const statsByHeroId = new Set(seedStats.map((row) => row.id));
  if (seedHeroes.some((hero) => !statsByHeroId.has(hero.id))) return "invalid_baseline";

  db.transaction((tx) => {
    for (const hero of seedHeroes) tx.insert(heroes).values(mapHero(hero, BASELINE_UPDATED_AT)).run();
    for (const stat of seedStats) {
      for (const row of mapHeroStatsRow(stat, BASELINE_PATCH, BASELINE_UPDATED_AT)) tx.insert(heroPatchStats).values(row).run();
    }
  });

  return "hydrated";
}
