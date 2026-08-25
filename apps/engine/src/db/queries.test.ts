import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { accounts, heroes, heroMatchups, heroPool, settings, teamGroups, teamMembers } from "./schema";
import {
  createTeamGroup,
  deleteTeamGroup,
  getHeroPool,
  getMatchupsForHero,
  getSoleAccountId,
  getTeamGroup,
  getTeamGroups,
  replaceHeroPool,
  replaceTeamGroup,
} from "./queries";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      steam_account_id INTEGER PRIMARY KEY,
      personal_baseline_winrate REAL,
      created_at TEXT NOT NULL
    );
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
      account_id INTEGER NOT NULL,
      hero_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      personal_winrate REAL,
      personal_games INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, hero_id)
    );
    CREATE TABLE team_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      name TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_group_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      name TEXT NOT NULL,
      hero_pool TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema: { accounts, heroes, heroMatchups, settings, heroPool, teamGroups, teamMembers } });
}

function insertAccount(db: ReturnType<typeof createTestDb>, steamAccountId: number): void {
  db.insert(accounts).values({ steamAccountId, personalBaselineWinrate: null, createdAt: "2026-08-24T00:00:00.000Z" }).run();
}

test("getMatchupsForHero devuelve solo los enfrentamientos del héroe pedido", () => {
  const db = createTestDb();
  insertAccount(db, 111);

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

// TSK-017 (fase 1b): tabla nueva hero_pool -- la "1 query afectada" de la excepción documentada.
// TSK-095 (Fase 5): accountId obligatorio -- un pool es siempre el de una cuenta.
test("getHeroPool devuelve las entradas insertadas, parametrizadas vía Drizzle", () => {
  const db = createTestDb();
  insertAccount(db, 111);

  db.insert(heroPool)
    .values([
      { accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-29" },
      { accountId: 111, heroId: 2, source: "calculated", personalWinrate: 0.58, personalGames: 42, updatedAt: "2026-07-29" },
    ])
    .run();

  const pool = getHeroPool(db, 111);

  expect(pool).toHaveLength(2);
  expect(pool.map((entry) => entry.heroId).sort()).toEqual([1, 2]);
  const calculated = pool.find((entry) => entry.heroId === 2);
  expect(calculated).toEqual({ accountId: 111, heroId: 2, source: "calculated", personalWinrate: 0.58, personalGames: 42, updatedAt: "2026-07-29" });
});

test("getHeroPool devuelve vacío cuando el pool nunca se configuró", () => {
  const db = createTestDb();
  insertAccount(db, 111);

  expect(getHeroPool(db, 111)).toHaveLength(0);
});

// Criterio 2 de SPEC.md §12.14 (aislamiento entre cuentas), a nivel de la capa de datos: dos
// cuentas distintas guardan pools distintos, ninguna ve la de la otra.
test("getHeroPool nunca devuelve filas de otra cuenta", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  insertAccount(db, 222);
  db.insert(heroPool)
    .values([
      { accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-29" },
      { accountId: 222, heroId: 2, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-29" },
    ])
    .run();

  expect(getHeroPool(db, 111).map((e) => e.heroId)).toEqual([1]);
  expect(getHeroPool(db, 222).map((e) => e.heroId)).toEqual([2]);
});

// TSK-020 (fase 1b, S8): replaceHeroPool es el único camino de escritura, transaccional.
test("replaceHeroPool reemplaza el pool completo, no lo mezcla con lo anterior", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  db.insert(heroPool).values({ accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  replaceHeroPool(db, 111, [
    { heroId: 2, source: "calculated", personalWinrate: 0.6, personalGames: 20, updatedAt: "2026-07-29" },
  ]);

  const pool = getHeroPool(db, 111);
  expect(pool).toHaveLength(1);
  expect(pool[0]).toEqual({ accountId: 111, heroId: 2, source: "calculated", personalWinrate: 0.6, personalGames: 20, updatedAt: "2026-07-29" });
});

test("replaceHeroPool con un array vacío deja el pool vacío (borrar todo el pool es válido)", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  db.insert(heroPool).values({ accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  replaceHeroPool(db, 111, []);

  expect(getHeroPool(db, 111)).toHaveLength(0);
});

test("replaceHeroPool es atómico: un fallo a mitad de la transacción no deja el pool a medias", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  db.insert(heroPool).values({ accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }).run();

  // heroId duplicado dentro del mismo array viola la PK a mitad de la transacción -- simula
  // cualquier fallo real (la validación de la capa HTTP nunca deja pasar esto, pero esta prueba
  // confirma que la capa de datos en sí es atómica, no solo que el borde la filtra antes).
  expect(() =>
    replaceHeroPool(db, 111, [
      { heroId: 2, source: "calculated", personalWinrate: 0.5, personalGames: 10, updatedAt: "2026-07-29" },
      { heroId: 2, source: "calculated", personalWinrate: 0.5, personalGames: 10, updatedAt: "2026-07-29" },
    ]),
  ).toThrow();

  const pool = getHeroPool(db, 111);
  expect(pool).toHaveLength(1);
  expect(pool[0]!.heroId).toBe(1);
});

// Criterio 2 de §12.14, mitad de escritura: reemplazar el pool de una cuenta nunca borra ni toca
// las filas de otra cuenta -- el `WHERE account_id = ?` del DELETE está scopeado, no es un borrado
// global disfrazado.
test("replaceHeroPool de una cuenta nunca borra el pool de otra cuenta", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  insertAccount(db, 222);
  db.insert(heroPool)
    .values([
      { accountId: 111, heroId: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" },
      { accountId: 222, heroId: 2, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" },
    ])
    .run();

  replaceHeroPool(db, 111, [
    { heroId: 3, source: "calculated", personalWinrate: 0.6, personalGames: 20, updatedAt: "2026-07-29" },
  ]);

  expect(getHeroPool(db, 111).map((e) => e.heroId)).toEqual([3]);
  expect(getHeroPool(db, 222).map((e) => e.heroId)).toEqual([2]);
});

// TSK-095: bridge temporal de las rutas HTTP hasta TSK-098 -- sirve a la única cuenta real que
// exista, sin inventar una si no hay ninguna.
test("getSoleAccountId devuelve la única cuenta si existe, o null si accounts está vacía", () => {
  const db = createTestDb();
  expect(getSoleAccountId(db)).toBeNull();

  insertAccount(db, 111);
  expect(getSoleAccountId(db)).toBe(111);
});

test("createTeamGroup guarda un equipo con miembros y getTeamGroups lo lista completo", () => {
  const db = createTestDb();

  const saved = createTeamGroup(db, {
    accountId: 111, name: "Stack viernes",
    partySize: 3,
    updatedAt: "2026-07-29",
    members: [
      { slot: 1, name: "Ana", heroPool: [1, 2], updatedAt: "2026-07-29" },
      { slot: 2, name: "Bruno", heroPool: [3], updatedAt: "2026-07-29" },
    ],
  });

  expect(saved.id).toBeGreaterThan(0);
  expect(getTeamGroups(db, 111)).toEqual([saved]);
  expect(getTeamGroup(db, saved.id, 111)).toEqual(saved);
});

test("replaceTeamGroup reemplaza datos y miembros completos", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  const saved = createTeamGroup(db, {
    accountId: 111, name: "Stack viernes",
    partySize: 3,
    updatedAt: "2026-07-29",
    members: [
      { slot: 1, name: "Ana", heroPool: [1], updatedAt: "2026-07-29" },
      { slot: 2, name: "Bruno", heroPool: [2], updatedAt: "2026-07-29" },
    ],
  });

  const updated = replaceTeamGroup(db, saved.id, 111, {
    accountId: 111, name: "Stack ranked",
    partySize: 2,
    updatedAt: "2026-07-30",
    members: [{ slot: 1, name: "Carla", heroPool: [3, 4], updatedAt: "2026-07-30" }],
  });

  expect(updated).toEqual({
    id: saved.id,
    accountId: 111,
    name: "Stack ranked",
    partySize: 2,
    updatedAt: "2026-07-30",
    members: [{ id: 3, teamGroupId: saved.id, slot: 1, name: "Carla", heroPool: [3, 4], updatedAt: "2026-07-30" }],
  });
});

test("deleteTeamGroup borra el equipo y sus miembros", () => {
  const db = createTestDb();
  insertAccount(db, 111);
  const saved = createTeamGroup(db, {
    accountId: 111, name: "Temporal",
    partySize: 2,
    updatedAt: "2026-07-29",
    members: [{ slot: 1, name: "Ana", heroPool: [1], updatedAt: "2026-07-29" }],
  });

  expect(deleteTeamGroup(db, saved.id, 111)).toBe(true);
  expect(getTeamGroup(db, saved.id, 111)).toBeNull();
  expect(getTeamGroups(db, 111)).toEqual([]);
});
