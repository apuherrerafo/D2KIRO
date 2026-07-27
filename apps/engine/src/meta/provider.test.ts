import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync } from "../db/schema";
import { buildMetaSnapshot, getMetaFreshness } from "./provider";

function createTestDb() {
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
  `);
  return drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync } });
}

test("buildMetaSnapshot agrupa matchups y patchStats por heroId con la forma exacta esperada", async () => {
  const db = createTestDb();
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

  const result = await buildMetaSnapshot(db);

  expect(result.heroes[1]).toEqual({ id: 1, localizedName: "Lina", roles: ["Support", "Nuker"] });
  expect(result.matchups[1]).toEqual([{ vsHero: 2, games: 300, wins: 150 }]);
  expect(result.patchStats?.[1]).toEqual([{ patch: "7.36", bracket: "archon", picks: 500, wins: 260 }]);
});

test("con las 4 tablas vacías, buildMetaSnapshot no lanza y devuelve records vacíos", async () => {
  const db = createTestDb();

  const snapshot = await buildMetaSnapshot(db);

  expect(snapshot).toEqual({ heroes: {}, matchups: {}, patchStats: {} });
});

test("getMetaFreshness: sin ninguna sincronización -> syncedAt null, isStale true", async () => {
  const db = createTestDb();

  const freshness = await getMetaFreshness(db);

  expect(freshness).toEqual({ syncedAt: null, isStale: true });
});

test("getMetaFreshness: sync exitosa reciente (<24h) -> isStale false", async () => {
  const db = createTestDb();
  db.insert(metaSync)
    .values({ source: "opendota", startedAt: "2026-07-26T00:00:00Z", finishedAt: "2026-07-26T23:00:00Z", status: "ok", rowsWritten: 10 })
    .run();
  const now = () => new Date("2026-07-27T00:00:00Z").getTime(); // 1h después de finishedAt

  const freshness = await getMetaFreshness(db, now);

  expect(freshness).toEqual({ syncedAt: "2026-07-26T23:00:00Z", isStale: false });
});

test("getMetaFreshness: sync exitosa vieja (>24h) -> isStale true, ignora syncs fallidas más recientes", async () => {
  const db = createTestDb();
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
