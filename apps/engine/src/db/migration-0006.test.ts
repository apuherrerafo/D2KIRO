import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

// Origen: docs/agents/tasks/TSK-095.md, docs/specs/SPEC.md §12.7. Mismo patrón que
// migration-0004.test.ts/migration-0005.test.ts: raw bun:sqlite (no Drizzle).

const MIGRATION_SQL_PATH = join(import.meta.dir, "migrations/0006_hero_pool_account.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, "utf-8").trim();

function runMigration(sqlite: Database): void {
  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) sqlite.exec(trimmed);
  }
}

function createBaseDb(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF;");
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
    CREATE TABLE hero_pool (
      hero_id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      personal_winrate REAL,
      personal_games INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  return sqlite;
}

function insertHero(sqlite: Database, id: number): void {
  sqlite.exec(
    `INSERT INTO heroes (id, name, localized_name, img_url, primary_attr, attack_type, roles, updated_at)
     VALUES (${id}, 'npc_dota_hero_test${id}', 'Test ${id}', 'x', 'agi', 'melee', '[]', '2026-01-01');`,
  );
}

// Caso: exactamente 1 cuenta real -- todas las filas de hero_pool se le asignan, mismo conteo
// antes/después (criterio 4 de SPEC.md §12.14, verificado acá a nivel de migración).
test("con exactamente 1 cuenta, todas las filas de hero_pool quedan asignadas a esa cuenta", () => {
  const sqlite = createBaseDb();
  sqlite.exec(
    `INSERT INTO accounts (steam_account_id, personal_baseline_winrate, created_at)
     VALUES (111111111, NULL, '2026-08-24T00:00:00.000Z');`,
  );
  insertHero(sqlite, 1);
  insertHero(sqlite, 2);
  sqlite.exec(`
    INSERT INTO hero_pool (hero_id, source, personal_winrate, personal_games, updated_at)
    VALUES (1, 'manual', NULL, 0, '2026-08-01'),
           (2, 'calculated', 0.58, 42, '2026-08-01');
  `);

  runMigration(sqlite);

  const rows = sqlite
    .query<{ account_id: number; hero_id: number }, []>("SELECT account_id, hero_id FROM hero_pool ORDER BY hero_id")
    .all();

  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ account_id: 111111111, hero_id: 1 });
  expect(rows[1]).toEqual({ account_id: 111111111, hero_id: 2 });
});

// Caso: 0 cuentas -- no se adivina el dueño, hero_pool queda vacía tras migrar (nunca una fila
// huérfana con un account_id inventado).
test("sin ninguna cuenta, hero_pool queda vacía tras migrar -- no se adivina el dueño", () => {
  const sqlite = createBaseDb();
  insertHero(sqlite, 1);
  sqlite.exec(
    `INSERT INTO hero_pool (hero_id, source, personal_winrate, personal_games, updated_at)
     VALUES (1, 'manual', NULL, 0, '2026-08-01');`,
  );

  runMigration(sqlite);

  const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM hero_pool").get()!.cnt;
  expect(count).toBe(0);
});

// La PK compuesta (account_id, hero_id) queda realmente activa tras la migración -- dos cuentas
// pueden tener el mismo hero_id en su pool sin chocar.
test("la PK compuesta (account_id, hero_id) permite el mismo héroe en pools de cuentas distintas", () => {
  const sqlite = createBaseDb();
  sqlite.exec(
    `INSERT INTO accounts (steam_account_id, personal_baseline_winrate, created_at)
     VALUES (222222222, NULL, '2026-08-24T00:00:00.000Z');`,
  );
  insertHero(sqlite, 1);
  runMigration(sqlite);

  sqlite.exec(
    `INSERT INTO accounts (steam_account_id, personal_baseline_winrate, created_at)
     VALUES (333333333, NULL, '2026-08-24T00:00:00.000Z');`,
  );

  expect(() => {
    sqlite.exec(`
      INSERT INTO hero_pool (account_id, hero_id, source, personal_winrate, personal_games, updated_at)
      VALUES (222222222, 1, 'manual', NULL, 0, '2026-08-24'),
             (333333333, 1, 'manual', NULL, 0, '2026-08-24');
    `);
  }).not.toThrow();

  const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM hero_pool WHERE hero_id = 1").get()!.cnt;
  expect(count).toBe(2);
});
