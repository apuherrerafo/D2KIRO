import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { createLRUCache, type LRUCache } from "../db/lru-cache";
import { accounts, heroMatchups, heroPatchStats, heroPool, heroes, metaSync } from "../db/schema";
import type { HeroMatchupStat, HeroPatchBracketStat, HeroPoolEntry, MetaHeroInfo, MetaSnapshot } from "../signals/types";
import { mapHeroStatsRow, type Bracket } from "./mappers";
import { getValidatedSeed } from "./seed";

type Db<TSchema extends Record<string, unknown> = Record<string, never>> = BunSQLiteDatabase<TSchema>;
export type AccountId = number;
type SharedMetaSnapshot = Pick<MetaSnapshot, "heroes" | "matchups" | "patchStats">;
type AccountMetaOverlay = Pick<MetaSnapshot, "heroPool" | "personalBaselineWinrate">;

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
async function buildSharedMetaSnapshot<TSchema extends Record<string, unknown>>(db: Db<TSchema>): Promise<SharedMetaSnapshot> {
  const heroRows = db.select().from(heroes).all();
  const matchupRows = db.select().from(heroMatchups).all();
  const patchStatRows = db.select().from(heroPatchStats).all();

  const heroesById: Record<number, MetaHeroInfo> = {};
  for (const row of heroRows) {
    heroesById[row.id] = { id: row.id, localizedName: row.localizedName, roles: row.roles };
  }

  const matchupsByHero: Record<number, HeroMatchupStat[]> = {};
  for (const row of matchupRows) {
    const key = `${row.heroId}:${row.vsHeroId}`;
    if (!matchupLRU.has(key)) {
      // Cache miss: compute winrate and populate the LRU for future snapshot rebuilds.
      // The HeroMatchupStat pushed below still uses raw `games` and `wins` — the LRU
      // caches only the derived winrate (wins/games) as a secondary lookup index.
      const winrate = row.games > 0 ? row.wins / row.games : 0;
      matchupLRU.set(key, winrate);
    }
    (matchupsByHero[row.heroId] ??= []).push({ vsHero: row.vsHeroId, games: row.games, wins: row.wins });
  }

  let patchStatsByHero: Record<number, HeroPatchBracketStat[]> = {};
  if (patchStatRows.length > 0) {
    // DB rows always take precedence (Req 6.3).
    // `bracket` se guarda como texto plano en SQLite (schema.ts no lo restringe a Bracket) --
    // el cast es seguro porque solo mapHeroStatsRow (TSK-003) escribe esta tabla, y ya valida
    // contra BRACKETS antes de escribir. No es input externo en este punto de lectura.
    for (const row of patchStatRows) {
      (patchStatsByHero[row.heroId] ??= []).push({
        patch: row.patch,
        bracket: row.bracket as Bracket,
        picks: row.picks,
        wins: row.wins,
      });
    }
  } else {
    // Fallback to seed — only when DB is empty (first run before sync). (Req 6.2)
    const seed = getValidatedSeed();
    if (seed.length > 0) {
      // mapHeroStatsRow expands one RawHeroStatsRow into one HeroPatchStatRow per bracket.
      // We use the label "seed" as the patch identifier since no real patch is committed yet.
      const SEED_PATCH = "seed";
      const updatedAt = new Date().toISOString();
      for (const seedRow of seed) {
        const mappedRows = mapHeroStatsRow(seedRow, SEED_PATCH, updatedAt);
        for (const row of mappedRows) {
          (patchStatsByHero[row.heroId] ??= []).push({
            patch: row.patch,
            bracket: row.bracket,
            picks: row.picks,
            wins: row.wins,
          });
        }
      }
    } else {
      console.error("[meta/provider] Seed fallback is empty — patchStats will be empty map");
    }
  }

  return {
    heroes: heroesById,
    matchups: matchupsByHero,
    patchStats: patchStatsByHero,
  };
}

async function buildAccountMetaOverlay<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  accountId: AccountId | null,
): Promise<AccountMetaOverlay> {
  if (accountId === null) return { heroPool: [], personalBaselineWinrate: null };

  const heroPoolRows = db.select().from(heroPool).where(eq(heroPool.accountId, accountId)).all();
  const [account] = db
    .select({ personalBaselineWinrate: accounts.personalBaselineWinrate })
    .from(accounts)
    .where(eq(accounts.steamAccountId, accountId))
    .limit(1)
    .all();
  const rawBaseline = account?.personalBaselineWinrate ?? null;

  return {
    heroPool: heroPoolRows.map((row): HeroPoolEntry => ({
      hero: row.heroId,
      source: row.source,
      personalWinrate: row.personalWinrate,
      personalGames: row.personalGames,
      updatedAt: row.updatedAt,
    })),
    personalBaselineWinrate: rawBaseline !== null && Number.isFinite(rawBaseline) ? rawBaseline : null,
  };
}

export async function buildMetaSnapshot<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  accountId: AccountId | null,
): Promise<MetaSnapshot> {
  const [shared, overlay] = await Promise.all([buildSharedMetaSnapshot(db), buildAccountMetaOverlay(db, accountId)]);
  return { ...shared, ...overlay };
}

// TSK-059: cache en memoria a nivel de módulo -- los datos subyacentes (heroes/matchups/
// patchStats) solo cambian cuando termina una sincronización manual, no en cada pick/ban. Los
// overlays de hero_pool/accounts se cachean por cuenta e invalidan por separado. Sin esto, 4
// call sites distintos reconstruían el
// snapshot completo desde SQLite en cada evento de draft, pese a que `buildMetaSnapshot` ya
// existe específicamente para evitar ese costo en el camino caliente (comentario original de la
// función). Invalidada explícitamente desde `runMetaSync` (sync.ts) y desde `replaceHeroPool`
// (routes/hero-pool.ts) -- nunca por TTL, porque no hay forma de que quede desactualizada salvo
// por esas dos escrituras.
let sharedSnapshot: SharedMetaSnapshot | null = null;
const accountOverlays = new Map<AccountId, AccountMetaOverlay>();

// Req 4: LRU cache for individual matchup winrates (heroId:vsHeroId → winrate).
// Lives here alongside sharedSnapshot so both are cleared together on invalidation.
// Capacity 512 covers the typical hero roster (≈130 heroes × ~4 common matchups each).
// Injectable for tests via getMatchupLRU / setMatchupLRU.
const MATCHUP_CACHE_CAPACITY = 512;
let matchupLRU: LRUCache<string, number> = createLRUCache<string, number>(MATCHUP_CACHE_CAPACITY);

export async function getCachedMetaSnapshot<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  accountId: AccountId | null,
): Promise<MetaSnapshot> {
  if (!sharedSnapshot) sharedSnapshot = await buildSharedMetaSnapshot(db);
  if (accountId === null) return { ...sharedSnapshot, heroPool: [], personalBaselineWinrate: null };

  let overlay = accountOverlays.get(accountId);
  if (!overlay) {
    overlay = await buildAccountMetaOverlay(db, accountId);
    accountOverlays.set(accountId, overlay);
  }
  return { ...sharedSnapshot, ...overlay };
}

export function invalidateMetaSnapshotCache(): void {
  sharedSnapshot = null;
  matchupLRU.clear(); // Req 4.2: stale winrates must not outlive the snapshot
}

export function invalidateAccountMetaCache(accountId: AccountId): void {
  accountOverlays.delete(accountId);
}

// Req 4.6: injectable for tests so cache-hit and cache-miss paths can each be exercised.
export function getMatchupLRU(): LRUCache<string, number> {
  return matchupLRU;
}

export function setMatchupLRU(cache: LRUCache<string, number>): void {
  matchupLRU = cache;
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
