import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

// Requirements: 1.1, 1.2, 1.3, 1.4

const MIGRATION_SQL_PATH = join(import.meta.dir, "migrations/0004_vs_hero_idx.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, "utf-8").trim();

/**
 * Creates an in-memory SQLite DB with the base hero_matchups table schema
 * (and heroes table, since hero_matchups has FKs referencing it in the real schema).
 * We use raw SQLite here — no Drizzle — to mirror what the migration runner does.
 */
function createBaseDb(): Database {
  const sqlite = new Database(":memory:");
  // Enable FK enforcement so the schema is realistic, but we insert heroes first.
  sqlite.exec("PRAGMA foreign_keys = OFF;");
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
  return sqlite;
}

// Requirement 1.1: migration creates the index
test("migration creates idx_hero_matchups_vs_hero_id in sqlite_master", () => {
  const sqlite = createBaseDb();
  sqlite.exec(MIGRATION_SQL);

  const row = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hero_matchups_vs_hero_id'",
    )
    .get();

  expect(row).not.toBeNull();
  expect(row!.name).toBe("idx_hero_matchups_vs_hero_id");
});

// Requirement 1.1 / idempotency: IF NOT EXISTS means re-running is safe
test("migration is idempotent — running it twice does not throw", () => {
  const sqlite = createBaseDb();
  sqlite.exec(MIGRATION_SQL);

  expect(() => sqlite.exec(MIGRATION_SQL)).not.toThrow();

  // Index still present after second run
  const row = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hero_matchups_vs_hero_id'",
    )
    .get();
  expect(row).not.toBeNull();
});

// Requirement 1.2: migration on a pre-populated DB preserves all existing rows
test("migration on pre-populated hero_matchups preserves all rows", () => {
  const sqlite = createBaseDb();

  // Insert some rows before running the migration
  sqlite.exec(`
    INSERT INTO heroes (id, name, localized_name, img_url, primary_attr, attack_type, roles, updated_at)
    VALUES (1, 'npc_dota_hero_antimage', 'Anti-Mage', 'x', 'agi', 'melee', '[]', '2026-01-01'),
           (2, 'npc_dota_hero_lina', 'Lina', 'x', 'int', 'ranged', '[]', '2026-01-01'),
           (3, 'npc_dota_hero_zeus', 'Zeus', 'x', 'int', 'ranged', '[]', '2026-01-01');
    INSERT INTO hero_matchups (hero_id, vs_hero_id, games, wins, updated_at)
    VALUES (1, 2, 500, 260, '2026-01-01'),
           (1, 3, 300, 120, '2026-01-01'),
           (2, 1, 500, 240, '2026-01-01');
  `);

  const countBefore = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM hero_matchups").get()!.cnt;
  expect(countBefore).toBe(3);

  sqlite.exec(MIGRATION_SQL);

  const countAfter = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM hero_matchups").get()!.cnt;
  expect(countAfter).toBe(3);
});

// Requirement 1.4: primary key (hero_id, vs_hero_id) still present after migration
test("primary key (hero_id, vs_hero_id) is preserved after migration", () => {
  const sqlite = createBaseDb();
  sqlite.exec(MIGRATION_SQL);

  // The auto-created PK index name in SQLite follows the pattern sqlite_autoindex_<table>_<n>
  // but the schema still enforces uniqueness — easiest to verify by attempting a duplicate insert.
  sqlite.exec(`
    INSERT INTO heroes (id, name, localized_name, img_url, primary_attr, attack_type, roles, updated_at)
    VALUES (1, 'npc_dota_hero_antimage', 'Anti-Mage', 'x', 'agi', 'melee', '[]', '2026-01-01'),
           (2, 'npc_dota_hero_lina', 'Lina', 'x', 'int', 'ranged', '[]', '2026-01-01');
    INSERT INTO hero_matchups (hero_id, vs_hero_id, games, wins, updated_at)
    VALUES (1, 2, 500, 260, '2026-01-01');
  `);

  expect(() =>
    sqlite.exec(
      `INSERT INTO hero_matchups (hero_id, vs_hero_id, games, wins, updated_at)
       VALUES (1, 2, 100, 50, '2026-01-02')`,
    ),
  ).toThrow();
});

// Requirement 1.3: EXPLAIN QUERY PLAN confirms the new index is used for vs_hero_id filter
test("EXPLAIN QUERY PLAN for vs_hero_id equality filter references idx_hero_matchups_vs_hero_id", () => {
  const sqlite = createBaseDb();
  sqlite.exec(MIGRATION_SQL);

  type PlanRow = { id: number; parent: number; notused: number; detail: string };
  const planRows = sqlite
    .query<PlanRow, []>("EXPLAIN QUERY PLAN SELECT * FROM hero_matchups WHERE vs_hero_id = 1")
    .all();

  const planText = planRows.map((r) => r.detail).join("\n");

  // SQLite outputs something like:
  //   SEARCH hero_matchups USING INDEX idx_hero_matchups_vs_hero_id (vs_hero_id=?)
  expect(planText).toContain("idx_hero_matchups_vs_hero_id");
});
