import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups } from "./schema";
import { getMatchupsForHero } from "./queries";

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
    CREATE TABLE hero_matchups (
      hero_id INTEGER NOT NULL,
      vs_hero_id INTEGER NOT NULL,
      games INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, vs_hero_id)
    );
  `);
  return drizzle(sqlite, { schema: { heroes, heroMatchups } });
}

test("getMatchupsForHero devuelve solo los enfrentamientos del héroe pedido", () => {
  const db = createTestDb();

  db.insert(heroes)
    .values([
      { id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage", imgUrl: "x", primaryAttr: "agi", attackType: "melee", roles: ["Carry"], updatedAt: "2026-07-26" },
      { id: 2, name: "npc_dota_hero_lina", localizedName: "Lina", imgUrl: "x", primaryAttr: "int", attackType: "ranged", roles: ["Support"], updatedAt: "2026-07-26" },
      { id: 3, name: "npc_dota_hero_zeus", localizedName: "Zeus", imgUrl: "x", primaryAttr: "int", attackType: "ranged", roles: ["Support"], updatedAt: "2026-07-26" },
    ])
    .run();

  db.insert(heroMatchups)
    .values([
      { heroId: 1, vsHeroId: 2, games: 500, wins: 260, updatedAt: "2026-07-26" },
      { heroId: 1, vsHeroId: 3, games: 300, wins: 120, updatedAt: "2026-07-26" },
      { heroId: 2, vsHeroId: 1, games: 500, wins: 240, updatedAt: "2026-07-26" },
    ])
    .run();

  const matchups = getMatchupsForHero(db, 1);

  expect(matchups).toHaveLength(2);
  expect(matchups.map((m) => m.vsHeroId).sort()).toEqual([2, 3]);
});

test("getMatchupsForHero devuelve vacío para un héroe sin enfrentamientos registrados", () => {
  const db = createTestDb();

  const matchups = getMatchupsForHero(db, 999);

  expect(matchups).toHaveLength(0);
});
