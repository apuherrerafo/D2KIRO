import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync } from "../db/schema";
import { OpenDotaClient } from "./opendota-client";
import { syncMeta } from "./sync";
import heroesFixture from "./__fixtures__/heroes.json";
import heroStatsFixture from "./__fixtures__/hero-stats.json";
import matchups1Fixture from "./__fixtures__/matchups-1.json";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      localized_name TEXT NOT NULL,
      img_url TEXT NOT NULL,
      primary_attr TEXT NOT NULL,
      attack_type TEXT NOT NULL,
      roles TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE hero_patch_stats (
      hero_id INTEGER NOT NULL,
      patch TEXT NOT NULL,
      bracket TEXT NOT NULL,
      picks INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, patch, bracket)
    );
    CREATE TABLE hero_matchups (
      hero_id INTEGER NOT NULL,
      vs_hero_id INTEGER NOT NULL,
      games INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, vs_hero_id)
    );
    CREATE TABLE meta_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      rows_written INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
  return drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync } });
}

function fixtureFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return (async (url: string) => {
    if (overrides[url]) return overrides[url]();
    if (url.endsWith("/heroes")) return new Response(JSON.stringify(heroesFixture), { status: 200 });
    if (url.endsWith("/heroStats")) return new Response(JSON.stringify(heroStatsFixture), { status: 200 });
    if (url.endsWith("/heroes/1/matchups")) return new Response(JSON.stringify(matchups1Fixture), { status: 200 });
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

test("syncMeta escribe heroes, patch stats y matchups desde fixtures, sin red real", async () => {
  const db = createTestDb();
  const client = new OpenDotaClient({ fetchImpl: fixtureFetch(), sleepImpl: async () => {} });

  const result = await syncMeta(db, client, { patch: "7.36", heroIdsForMatchups: [1] });

  expect(result.status).toBe("ok");
  expect(result.error).toBeNull();

  const allHeroes = db.select().from(heroes).all();
  expect(allHeroes).toHaveLength(3);
  expect(allHeroes.find((h) => h.id === 1)?.imgUrl).toBe(
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/antimage.png",
  );

  const patchStats = db.select().from(heroPatchStats).all();
  expect(patchStats).toHaveLength(2 * 8); // 2 héroes en el fixture de heroStats * 8 brackets

  const matchups = db.select().from(heroMatchups).all();
  expect(matchups).toHaveLength(2);

  expect(result.rowsWritten).toBe(3 + 2 * 8 + 2);
});

test("syncMeta descarta registros inválidos y los cuenta en el error de meta_sync", async () => {
  const db = createTestDb();
  const heroesWithOneInvalid = [...heroesFixture, { id: "not-a-number" }];
  const client = new OpenDotaClient({
    fetchImpl: fixtureFetch({
      "https://api.opendota.com/api/heroes": () => new Response(JSON.stringify(heroesWithOneInvalid), { status: 200 }),
    }),
    sleepImpl: async () => {},
  });

  const result = await syncMeta(db, client, { patch: "7.36", heroIdsForMatchups: [] });

  expect(result.status).toBe("ok");
  expect(result.error).toContain("1 registro(s) inválido(s) descartados en /heroes");

  const allHeroes = db.select().from(heroes).all();
  expect(allHeroes).toHaveLength(3);
});

test("syncMeta marca meta_sync como failed y no toca el cache viejo si OpenDota falla", async () => {
  const db = createTestDb();

  db.insert(heroes)
    .values({
      id: 1,
      name: "npc_dota_hero_antimage",
      localizedName: "Anti-Mage (cache viejo)",
      imgUrl: "https://cdn.cloudflare.steamstatic.com/old.png",
      primaryAttr: "agi",
      attackType: "Melee",
      roles: ["Carry"],
      updatedAt: "2020-01-01",
    })
    .run();

  const client = new OpenDotaClient({
    fetchImpl: (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch,
    sleepImpl: async () => {},
  });

  const result = await syncMeta(db, client, { patch: "7.36", heroIdsForMatchups: [] });

  expect(result.status).toBe("failed");
  expect(result.error).toContain("OpenDota");

  const cachedHero = db.select().from(heroes).all();
  expect(cachedHero).toHaveLength(1);
  expect(cachedHero[0]?.localizedName).toBe("Anti-Mage (cache viejo)");

  const syncRows = db.select().from(metaSync).all();
  expect(syncRows).toHaveLength(1);
  expect(syncRows[0]?.status).toBe("failed");
});
