import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPool, settings } from "./schema";
import { getAllSettings, getHeroPool, getMatchupsForHero, replaceHeroPool, upsertSetting } from "./queries";

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
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE hero_pool (
      hero_id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      personal_winrate REAL,
      personal_games INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema: { heroes, heroMatchups, settings, heroPool } });
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

test("upsertSetting inserta una clave nueva y getAllSettings la devuelve", () => {
  const db = createTestDb();

  upsertSetting(db, "theme", "dark");

  expect(getAllSettings(db)).toEqual([{ key: "theme", value: "dark" }]);
});

test("upsertSetting sobre una clave existente actualiza el valor, no duplica la fila", () => {
  const db = createTestDb();

  upsertSetting(db, "theme", "dark");
  upsertSetting(db, "theme", "light");

  const all = getAllSettings(db);
  expect(all).toHaveLength(1);
  expect(all[0]).toEqual({ key: "theme", value: "light" });
});

// TSK-017 (fase 1b): claves nuevas de settings, sin cambio de esquema -- son solo filas sobre la
// misma tabla key/value que ya existía, mismas funciones genéricas de arriba.
test("steam_account_id y personal_baseline_winrate se guardan y leen como cualquier otra clave de settings", () => {
  const db = createTestDb();

  upsertSetting(db, "steam_account_id", "123456789");
  upsertSetting(db, "personal_baseline_winrate", "0.52");

  const all = getAllSettings(db);
  expect(all).toHaveLength(2);
  expect(all).toEqual(
    expect.arrayContaining([
      { key: "steam_account_id", value: "123456789" },
      { key: "personal_baseline_winrate", value: "0.52" },
    ]),
  );
});

// TSK-017 (fase 1b): tabla nueva hero_pool -- la "1 query afectada" de la excepción documentada.
test("getHeroPool devuelve las entradas insertadas, parametrizadas vía Drizzle", () => {
  const db = createTestDb();

  db.insert(heroPool)
    .values([
      { heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-29" },
      { heroId: 2, source: "calculated", personalWinrate: 0.58, personalGames: 42, updatedAt: "2026-07-29" },
    ])
    .run();

  const pool = getHeroPool(db);

  expect(pool).toHaveLength(2);
  expect(pool.map((entry) => entry.heroId).sort()).toEqual([1, 2]);
  const calculated = pool.find((entry) => entry.heroId === 2);
  expect(calculated).toEqual({ heroId: 2, source: "calculated", personalWinrate: 0.58, personalGames: 42, updatedAt: "2026-07-29" });
});

test("getHeroPool devuelve vacío cuando el pool nunca se configuró", () => {
  const db = createTestDb();

  expect(getHeroPool(db)).toHaveLength(0);
});

// TSK-020 (fase 1b, S8): replaceHeroPool es el único camino de escritura, transaccional.
test("replaceHeroPool reemplaza el pool completo, no lo mezcla con lo anterior", () => {
  const db = createTestDb();
  db.insert(heroPool).values({ heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  replaceHeroPool(db, [
    { heroId: 2, source: "calculated", personalWinrate: 0.6, personalGames: 20, updatedAt: "2026-07-29" },
  ]);

  const pool = getHeroPool(db);
  expect(pool).toHaveLength(1);
  expect(pool[0]).toEqual({ heroId: 2, source: "calculated", personalWinrate: 0.6, personalGames: 20, updatedAt: "2026-07-29" });
});

test("replaceHeroPool con un array vacío deja el pool vacío (borrar todo el pool es válido)", () => {
  const db = createTestDb();
  db.insert(heroPool).values({ heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  replaceHeroPool(db, []);

  expect(getHeroPool(db)).toHaveLength(0);
});

test("replaceHeroPool es atómico: un fallo a mitad de la transacción no deja el pool a medias", () => {
  const db = createTestDb();
  db.insert(heroPool).values({ heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  // heroId duplicado dentro del mismo array viola la PK a mitad de la transacción -- simula
  // cualquier fallo real (la validación de la capa HTTP nunca deja pasar esto, pero esta prueba
  // confirma que la capa de datos en sí es atómica, no solo que el borde la filtra antes).
  expect(() =>
    replaceHeroPool(db, [
      { heroId: 2, source: "calculated", personalWinrate: 0.5, personalGames: 10, updatedAt: "2026-07-29" },
      { heroId: 2, source: "calculated", personalWinrate: 0.5, personalGames: 10, updatedAt: "2026-07-29" },
    ]),
  ).toThrow();

  const pool = getHeroPool(db);
  expect(pool).toHaveLength(1);
  expect(pool[0]!.heroId).toBe(1);
});
