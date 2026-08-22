import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { heroMatchups, heroPatchStats, heroPool, heroes, metaSync, settings } from "../db/schema";
import type { HeroMatchupStat, HeroPatchBracketStat, HeroPoolEntry, MetaHeroInfo, MetaSnapshot } from "../signals/types";
import type { Bracket } from "./mappers";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;

// Ventana de frescura del cache de meta (docs/specs/SPEC.md línea 329).
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

// 3 queries masivas, nunca una por héroe -- el motor recorre candidatos en su camino caliente y
// no puede esperar I/O por cada uno (regla dura del ticket, N+1 de Drizzle en @redteam).
//
// TSK-059-bug (hallado durante TSK-059, no del reporte original de "Radiografía de dota2coach"):
// esta función nunca incluía el hero pool ni el baseline personal -- hero_pool_fit (17% de
// SCORING_WEIGHTS_V4) devolvía `applicable: false` en TODO draft real desde que se construyó en
// Fase 1b, porque el único lugar que arma un MetaSnapshot de verdad (acá) nunca leía las tablas
// hero_pool/settings. Ninguna prueba lo detectó porque cada capa se prueba aislada con fixtures
// que ya traían heroPool armado a mano (hero-pool-fit.test.ts, mix.test.ts), y las pruebas de la
// API de hero-pool (app.test.ts) nunca verificaban el efecto en una sugerencia real. Confirmado
// con el usuario antes de arreglarlo -- ver journal.md evt-20260821-080 / TSK-064.
export async function buildMetaSnapshot<TSchema extends Record<string, unknown>>(db: Db<TSchema>): Promise<MetaSnapshot> {
  const heroRows = db.select().from(heroes).all();
  const matchupRows = db.select().from(heroMatchups).all();
  const patchStatRows = db.select().from(heroPatchStats).all();
  const heroPoolRows = db.select().from(heroPool).all();
  const [baselineSetting] = db.select().from(settings).where(eq(settings.key, "personal_baseline_winrate")).limit(1).all();

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

  // Mismo shape que HeroPoolEntry (signals/types.ts) -- traduce `heroId` (columna SQLite) a
  // `hero` (contrato de dominio), mismo criterio que toHeroPoolEntry en routes/hero-pool.ts.
  const heroPoolEntries: HeroPoolEntry[] = heroPoolRows.map((row) => ({
    hero: row.heroId,
    source: row.source,
    personalWinrate: row.personalWinrate,
    personalGames: row.personalGames,
    updatedAt: row.updatedAt,
  }));

  const rawBaseline = baselineSetting ? Number(baselineSetting.value) : null;
  const personalBaselineWinrate = rawBaseline !== null && Number.isFinite(rawBaseline) ? rawBaseline : null;

  return {
    heroes: heroesById,
    matchups: matchupsByHero,
    patchStats: patchStatsByHero,
    heroPool: heroPoolEntries,
    personalBaselineWinrate,
  };
}

// TSK-059: cache en memoria a nivel de módulo -- los datos subyacentes (heroes/matchups/
// patchStats/hero_pool/settings) solo cambian cuando termina una sincronización manual o se
// reemplaza el pool, no en cada pick/ban. Sin esto, 4 call sites distintos reconstruían el
// snapshot completo desde SQLite en cada evento de draft, pese a que `buildMetaSnapshot` ya
// existe específicamente para evitar ese costo en el camino caliente (comentario original de la
// función). Invalidada explícitamente desde `runMetaSync` (sync.ts) y desde `replaceHeroPool`
// (routes/hero-pool.ts) -- nunca por TTL, porque no hay forma de que quede desactualizada salvo
// por esas dos escrituras.
let cachedSnapshot: MetaSnapshot | null = null;

export async function getCachedMetaSnapshot<TSchema extends Record<string, unknown>>(db: Db<TSchema>): Promise<MetaSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  cachedSnapshot = await buildMetaSnapshot(db);
  return cachedSnapshot;
}

export function invalidateMetaSnapshotCache(): void {
  cachedSnapshot = null;
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

// Aditivo (TSK-010): forma pública para GET /api/heroes -- incluye img_url, requisito duro de UI
// (dangerouslySetInnerHTML/host-de-imagen ya se validan en el borde de apps/web, no aquí).
export interface HeroMeta {
  id: number;
  name: string;
  localizedName: string;
  imgUrl: string;
  primaryAttr: string;
  attackType: string;
  roles: string[];
}

export async function getAllHeroMeta<TSchema extends Record<string, unknown>>(db: Db<TSchema>): Promise<HeroMeta[]> {
  return db
    .select()
    .from(heroes)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      localizedName: row.localizedName,
      imgUrl: row.imgUrl,
      primaryAttr: row.primaryAttr,
      attackType: row.attackType,
      roles: row.roles,
    }));
}
