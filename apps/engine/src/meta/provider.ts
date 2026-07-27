import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroMatchups, heroPatchStats, heroes, metaSync } from "../db/schema";
import type { HeroMatchupStat, HeroPatchBracketStat, MetaHeroInfo, MetaSnapshot } from "../signals/types";
import type { Bracket } from "./mappers";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

// Ventana de frescura del cache de meta (docs/specs/SPEC.md línea 329).
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

// 3 queries masivas, nunca una por héroe -- el motor recorre candidatos en su camino caliente y
// no puede esperar I/O por cada uno (regla dura del ticket, N+1 de Drizzle en @redteam).
export async function buildMetaSnapshot<TSchema extends Record<string, unknown>>(db: Db<TSchema>): Promise<MetaSnapshot> {
  const heroRows = db.select().from(heroes).all();
  const matchupRows = db.select().from(heroMatchups).all();
  const patchStatRows = db.select().from(heroPatchStats).all();

  const heroesById: Record<number, MetaHeroInfo> = {};
  for (const row of heroRows) {
    heroesById[row.id] = { id: row.id, localizedName: row.localizedName, roles: row.roles };
  }

  const matchupsByHero: Record<number, HeroMatchupStat[]> = {};
  for (const row of matchupRows) {
    (matchupsByHero[row.heroId] ??= []).push({ vsHero: row.vsHeroId, games: row.games, wins: row.wins });
  }

  const patchStatsByHero: Record<number, HeroPatchBracketStat[]> = {};
  for (const row of patchStatRows) {
    // `bracket` se guarda como texto plano en SQLite (schema.ts no lo restringe a Bracket) --
    // el cast es seguro porque solo mapHeroStatsRow (TSK-003) escribe esta tabla, y ya valida
    // contra BRACKETS antes de escribir. No es input externo en este punto de lectura.
    (patchStatsByHero[row.heroId] ??= []).push({
      patch: row.patch,
      bracket: row.bracket as Bracket,
      picks: row.picks,
      wins: row.wins,
    });
  }

  return { heroes: heroesById, matchups: matchupsByHero, patchStats: patchStatsByHero };
}

export async function getMetaFreshness<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  now: () => number = Date.now,
): Promise<{ syncedAt: string | null; isStale: boolean }> {
  const [lastOk] = db
    .select()
    .from(metaSync)
    .where(eq(metaSync.status, "ok"))
    .orderBy(desc(metaSync.finishedAt))
    .limit(1)
    .all();

  if (!lastOk?.finishedAt) return { syncedAt: null, isStale: true };

  const ageMs = now() - new Date(lastOk.finishedAt).getTime();
  return { syncedAt: lastOk.finishedAt, isStale: ageMs > FRESHNESS_WINDOW_MS };
}
