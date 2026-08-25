import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { accounts, heroes, heroMatchups, heroPatchStats, heroPool, metaSync } from "../db/schema";
import { createIdleDraftState } from "../draft/reducer";
import { heroPoolFitScorer } from "../signals/hero-pool-fit";
import {
  buildMetaSnapshot,
  getCachedMetaSnapshot,
  getMetaFreshness,
  invalidateAccountMetaCache,
  invalidateMetaSnapshotCache,
} from "./provider";

function createTestDb(onStatement?: (sql: string) => void) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL,
      img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL,
      roles TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE hero_patch_stats (
      hero_id INTEGER NOT NULL, patch TEXT NOT NULL, bracket TEXT NOT NULL,
      picks INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, patch, bracket)
    );
    CREATE TABLE hero_matchups (
      hero_id INTEGER NOT NULL, vs_hero_id INTEGER NOT NULL, games INTEGER NOT NULL,
      wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, vs_hero_id)
    );
    CREATE TABLE meta_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE TABLE hero_pool (
      account_id INTEGER NOT NULL, hero_id INTEGER NOT NULL, source TEXT NOT NULL,
      personal_winrate REAL, personal_games INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, hero_id)
    );
    CREATE TABLE accounts (
      steam_account_id INTEGER PRIMARY KEY, personal_baseline_winrate REAL,
      created_at TEXT NOT NULL
    );
  `);
  const instrumentedSqlite = new Proxy(sqlite, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === "query" || property === "prepare") && typeof value === "function") {
        return (sql: string, ...params: unknown[]) => {
          onStatement?.(sql);
          return Reflect.apply(value, target, [sql, ...params]);
        };
      }
      return value;
    },
  });
  return { db: drizzle(instrumentedSqlite, { schema: { accounts, heroes, heroMatchups, heroPatchStats, heroPool, metaSync } }), sqlite };
}

test("buildMetaSnapshot agrupa matchups y patchStats por heroId con la forma exacta esperada", async () => {
  const { db } = createTestDb();
  db.insert(heroes)
    .values({
      id: 1,
      name: "npc_dota_hero_lina",
      localizedName: "Lina",
      imgUrl: "https://cdn.cloudflare.steamstatic.com/lina.png",
      primaryAttr: "int",
      attackType: "Ranged",
      roles: ["Support", "Nuker"],
      updatedAt: "2026-07-27",
    })
    .run();
  db.insert(heroMatchups).values({ heroId: 1, vsHeroId: 2, games: 300, wins: 150, updatedAt: "2026-07-27" }).run();
  db.insert(heroPatchStats)
    .values({ heroId: 1, patch: "7.36", bracket: "archon", picks: 500, wins: 260, updatedAt: "2026-07-27" })
    .run();

  const result = await buildMetaSnapshot(db, null);

  expect(result.heroes[1]).toEqual({ id: 1, localizedName: "Lina", roles: ["Support", "Nuker"] });
  expect(result.matchups[1]).toEqual([{ vsHero: 2, games: 300, wins: 150 }]);
  expect(result.patchStats?.[1]).toEqual([{ patch: "7.36", bracket: "archon", picks: 500, wins: 260 }]);
});

// TSK-059/064 (provider.ts:64-86, Req 6.2): con hero_patch_stats vacía, patchStats cae al
// fallback de seed-hero-stats.json en vez de quedar vacío -- comportamiento nuevo, documentado en
// el propio provider.ts. heroes/matchups/heroPool/personalBaselineWinrate no tienen fallback, así
// que siguen vacíos con sus tablas vacías. No se compara patchStats contra el contenido exacto del
// seed -- ese archivo se regenera aparte y una prueba atada a sus números se rompería en silencio
// con cada actualización (mismo criterio que S9/S10, testing-seams.md).
test("con todas las tablas vacías, buildMetaSnapshot no lanza; patchStats cae al fallback de seed, el resto queda vacío", async () => {
  const { db } = createTestDb();

  const snapshot = await buildMetaSnapshot(db, null);

  expect(snapshot.heroes).toEqual({});
  expect(snapshot.matchups).toEqual({});
  expect(snapshot.heroPool).toEqual([]);
  expect(snapshot.personalBaselineWinrate).toBeNull();

  const patchStats = snapshot.patchStats ?? {};
  expect(Object.keys(patchStats).length).toBeGreaterThan(0);
  const firstHeroRows = Object.values(patchStats)[0] ?? [];
  expect(firstHeroRows.every((row) => row.patch === "seed")).toBe(true);
});

// TSK-059-bug: candado de regresión del hallazgo real -- buildMetaSnapshot nunca leía hero_pool
// ni settings, así que hero_pool_fit quedaba `applicable: false` en todo draft real. Ver
// journal.md evt-20260821-080 / TSK-064 para el contexto completo del hallazgo.
test("buildMetaSnapshot incluye solo el hero pool de la cuenta solicitada", async () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 1, createdAt: "2026-08-24" }).run();
  db.insert(heroPool)
    .values({ accountId: 1, heroId: 1, source: "calculated", personalWinrate: 0.62, personalGames: 40, updatedAt: "2026-08-21" })
    .run();

  const result = await buildMetaSnapshot(db, 1);

  expect(result.heroPool).toEqual([{ hero: 1, source: "calculated", personalWinrate: 0.62, personalGames: 40, updatedAt: "2026-08-21" }]);
});

test("buildMetaSnapshot lee el baseline personal de la cuenta solicitada", async () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 1, personalBaselineWinrate: 0.52, createdAt: "2026-08-24" }).run();

  const result = await buildMetaSnapshot(db, 1);

  expect(result.personalBaselineWinrate).toBe(0.52);
});

// TSK-059-bug: candado de punta a punta -- no solo que buildMetaSnapshot devuelva el pool, sino
// que ese snapshot real (salido de SQLite, no un fixture armado a mano) hace que hero_pool_fit
// deje de ser `applicable: false`. Esto es exactamente lo que estaba roto en producción.
test("un pool real guardado en SQLite hace que hero_pool_fit sea applicable:true contra el snapshot real", async () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 1, createdAt: "2026-08-24" }).run();
  db.insert(heroPool)
    .values({ accountId: 1, heroId: 7, source: "manual", personalWinrate: 0.58, personalGames: 25, updatedAt: "2026-08-21" })
    .run();

  const meta = await buildMetaSnapshot(db, 1);
  const contribution = heroPoolFitScorer.score(createIdleDraftState("session-1"), 7, meta);

  expect(contribution.applicable).toBe(true);
  expect(contribution.raw).not.toBeNull();
});

// TSK-059: la cache es un singleton a nivel de módulo (no de instancia) -- se invalida después de
// cada prueba de este archivo para no dejar estado filtrado hacia otras pruebas que corran
// después en el mismo proceso de `bun test`.
afterEach(() => {
  invalidateMetaSnapshotCache();
  invalidateAccountMetaCache(1);
  invalidateAccountMetaCache(2);
});

test("getCachedMetaSnapshot: dos llamadas seguidas sin invalidar devuelven contenido cacheado", async () => {
  const { db } = createTestDb();
  db.insert(heroes)
    .values({ id: 1, name: "h1", localizedName: "Hero Uno", imgUrl: "/h1.png", primaryAttr: "str", attackType: "Melee", roles: ["Carry"], updatedAt: "2026-08-21" })
    .run();

  const first = await getCachedMetaSnapshot(db, null);
  const second = await getCachedMetaSnapshot(db, null);

  expect(second).toEqual(first);
});

test("invalidateMetaSnapshotCache: la siguiente llamada reconstruye desde SQLite, ya no es la misma referencia", async () => {
  const { db } = createTestDb();

  const first = await getCachedMetaSnapshot(db, null);
  invalidateMetaSnapshotCache();
  const second = await getCachedMetaSnapshot(db, null);

  expect(second).not.toBe(first);
  // Contenido sigue siendo correcto tras invalidar, no solo "una referencia distinta cualquiera".
  expect(second).toEqual(first);
});

test("getCachedMetaSnapshot aísla overlays por cuenta y reutiliza las queries compartidas", async () => {
  let sharedQueryCount = 0;
  const { db } = createTestDb((sql) => {
    if (sql.includes('"hero_matchups"') || sql.includes('"hero_patch_stats"')) sharedQueryCount += 1;
  });
  db.insert(accounts)
    .values([
      { steamAccountId: 1, personalBaselineWinrate: 0.51, createdAt: "2026-08-24" },
      { steamAccountId: 2, personalBaselineWinrate: 0.62, createdAt: "2026-08-24" },
    ])
    .run();
  db.insert(heroPool)
    .values([
      { accountId: 1, heroId: 1, source: "manual", personalGames: 10, updatedAt: "2026-08-24" },
      { accountId: 2, heroId: 2, source: "calculated", personalGames: 20, updatedAt: "2026-08-24" },
    ])
    .run();

  const first = await getCachedMetaSnapshot(db, 1);
  const second = await getCachedMetaSnapshot(db, 2);

  expect(first.heroPool).toEqual([{ hero: 1, source: "manual", personalWinrate: null, personalGames: 10, updatedAt: "2026-08-24" }]);
  expect(first.personalBaselineWinrate).toBe(0.51);
  expect(second.heroPool).toEqual([{ hero: 2, source: "calculated", personalWinrate: null, personalGames: 20, updatedAt: "2026-08-24" }]);
  expect(second.personalBaselineWinrate).toBe(0.62);
  expect(sharedQueryCount).toBe(2);
});

test("invalidateAccountMetaCache solo borra el overlay de la cuenta indicada", async () => {
  const { db } = createTestDb();
  db.insert(accounts)
    .values([
      { steamAccountId: 1, createdAt: "2026-08-24" },
      { steamAccountId: 2, createdAt: "2026-08-24" },
    ])
    .run();
  db.insert(heroPool)
    .values([
      { accountId: 1, heroId: 1, source: "manual", personalGames: 1, updatedAt: "before" },
      { accountId: 2, heroId: 2, source: "manual", personalGames: 2, updatedAt: "before" },
    ])
    .run();
  await getCachedMetaSnapshot(db, 1);
  await getCachedMetaSnapshot(db, 2);
  db.update(heroPool).set({ updatedAt: "after" }).where(eq(heroPool.accountId, 1)).run();

  invalidateAccountMetaCache(1);

  const refreshedAccountOne = await getCachedMetaSnapshot(db, 1);
  const cachedAccountTwo = await getCachedMetaSnapshot(db, 2);
  expect(refreshedAccountOne.heroPool?.[0]?.updatedAt).toBe("after");
  expect(cachedAccountTwo.heroPool?.[0]?.updatedAt).toBe("before");
});

test("invalidateMetaSnapshotCache reconstruye lo compartido sin borrar overlays", async () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 1, createdAt: "2026-08-24" }).run();
  db.insert(heroPool).values({ accountId: 1, heroId: 1, source: "manual", personalGames: 1, updatedAt: "before" }).run();
  await getCachedMetaSnapshot(db, 1);
  db.update(heroPool).set({ updatedAt: "after" }).where(eq(heroPool.accountId, 1)).run();

  invalidateMetaSnapshotCache();

  const snapshotAfterMetaSync = await getCachedMetaSnapshot(db, 1);
  expect(snapshotAfterMetaSync.heroPool?.[0]?.updatedAt).toBe("before");
});

test("accountId null devuelve un overlay vacío y hero_pool_fit no aplica", async () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 1, personalBaselineWinrate: 0.6, createdAt: "2026-08-24" }).run();
  db.insert(heroPool).values({ accountId: 1, heroId: 7, source: "manual", personalGames: 25, updatedAt: "2026-08-24" }).run();

  const meta = await getCachedMetaSnapshot(db, null);
  const contribution = heroPoolFitScorer.score(createIdleDraftState("session-1"), 7, meta);

  expect(meta.heroPool).toEqual([]);
  expect(meta.personalBaselineWinrate).toBeNull();
  expect(contribution.applicable).toBe(false);
});

test("getMetaFreshness: sin ninguna sincronización -> syncedAt null, isStale true", async () => {
  const { db } = createTestDb();

  const freshness = await getMetaFreshness(db);

  expect(freshness).toEqual({ syncedAt: null, isStale: true });
});

test("getMetaFreshness: sync exitosa reciente (<24h) -> isStale false", async () => {
  const { db } = createTestDb();
  db.insert(metaSync)
    .values({ source: "opendota", startedAt: "2026-07-26T00:00:00Z", finishedAt: "2026-07-26T23:00:00Z", status: "ok", rowsWritten: 10 })
    .run();
  const now = () => new Date("2026-07-27T00:00:00Z").getTime(); // 1h después de finishedAt

  const freshness = await getMetaFreshness(db, now);

  expect(freshness).toEqual({ syncedAt: "2026-07-26T23:00:00Z", isStale: false });
});

test("getMetaFreshness: sync exitosa vieja (>24h) -> isStale true, ignora syncs fallidas más recientes", async () => {
  const { db } = createTestDb();
  db.insert(metaSync)
    .values({ source: "opendota", startedAt: "2026-07-01T00:00:00Z", finishedAt: "2026-07-01T00:00:00Z", status: "ok", rowsWritten: 10 })
    .run();
  db.insert(metaSync)
    .values({ source: "opendota", startedAt: "2026-07-26T00:00:00Z", finishedAt: "2026-07-26T00:00:00Z", status: "failed", rowsWritten: 0, error: "429" })
    .run();
  const now = () => new Date("2026-07-27T00:00:00Z").getTime(); // 26 días después del último ok

  const freshness = await getMetaFreshness(db, now);

  expect(freshness.syncedAt).toBe("2026-07-01T00:00:00Z");
  expect(freshness.isStale).toBe(true);
});
