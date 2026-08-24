import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

// Origen: docs/agents/tasks/TSK-094.md, docs/specs/SPEC.md §12.7. Mismo patrón que
// migration-0004.test.ts: raw bun:sqlite (no Drizzle), para mirroreoar exactamente lo que
// el migration runner real (drizzle-orm/bun-sqlite/migrator) ejecuta.

const MIGRATION_SQL_PATH = join(import.meta.dir, "migrations/0005_accounts.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, "utf-8").trim();

function runMigration(sqlite: Database): void {
  // drizzle-orm/bun-sqlite/migrator ejecuta cada statement separado por
  // "--> statement-breakpoint" en orden, dentro de la misma migración.
  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) sqlite.exec(trimmed);
  }
}

function createBaseDb(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return sqlite;
}

// Caso 1: settings con una fila steam_account_id válida (solo dígitos, rango Steam32).
test("con steam_account_id válido, accounts termina con exactamente 1 fila y settings se limpia", () => {
  const sqlite = createBaseDb();
  sqlite.exec(`INSERT INTO settings (key, value) VALUES ('steam_account_id', '123456789');`);

  runMigration(sqlite);

  const rows = sqlite
    .query<{ steam_account_id: number; personal_baseline_winrate: number | null; created_at: string }, []>(
      "SELECT steam_account_id, personal_baseline_winrate, created_at FROM accounts",
    )
    .all();

  expect(rows.length).toBe(1);
  expect(rows[0]!.steam_account_id).toBe(123456789);
  // Fase 1b nunca escribió realmente esta clave (hallazgo real de /blueprint, SPEC.md §12.15-E) —
  // nace null, no un valor inventado.
  expect(rows[0]!.personal_baseline_winrate).toBeNull();
  expect(rows[0]!.created_at).toBeTruthy();

  const settingsLeft = sqlite
    .query<{ cnt: number }, []>(
      "SELECT COUNT(*) AS cnt FROM settings WHERE key IN ('steam_account_id', 'personal_baseline_winrate')",
    )
    .get()!.cnt;
  expect(settingsLeft).toBe(0);
});

// Caso 2: settings sin esa clave (checkout limpio) — no falla, accounts queda vacía.
test("sin steam_account_id en settings, la migración no falla y accounts queda vacía", () => {
  const sqlite = createBaseDb();

  expect(() => runMigration(sqlite)).not.toThrow();

  const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM accounts").get()!.cnt;
  expect(count).toBe(0);
});

// Caso 3: valores corruptos — se descartan por el filtro GLOB/BETWEEN, sin excepción.
test("valores corruptos de steam_account_id se descartan sin excepción, accounts queda vacía", () => {
  const casosCorruptos = ["abc123", "-5", "9999999999999"]; // no-dígitos, negativo, fuera de rango Steam32

  for (const valor of casosCorruptos) {
    const sqlite = createBaseDb();
    sqlite.exec(`INSERT INTO settings (key, value) VALUES ('steam_account_id', '${valor}');`);

    expect(() => runMigration(sqlite)).not.toThrow();

    const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM accounts").get()!.cnt;
    expect(count).toBe(0);
  }
});

// Hallazgo de @redteam (TSK-094), verificado empíricamente, no asumido: un `settings.value` de
// solo dígitos pero MUY largo (más de 19 dígitos, fuera del rango de un entero de 64 bits) pasa el
// filtro GLOB (es "solo dígitos") antes de llegar al CAST. Confirmado que SQLite **satura** al
// máximo de `int64` en vez de "dar la vuelta" a un número chico -- así que el `BETWEEN 1 AND
// 4294967295` posterior sigue rechazándolo correctamente. Sin esta prueba, un cambio futuro a
// SQLite/el orden de los filtros podría reintroducir el riesgo sin que nada lo note.
test("un valor de solo-dígitos que desborda un entero de 64 bits se descarta igual, sin excepción", () => {
  const sqlite = createBaseDb();
  sqlite.exec(
    `INSERT INTO settings (key, value) VALUES ('steam_account_id', '99999999999999999999999999');`,
  );

  expect(() => runMigration(sqlite)).not.toThrow();

  const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM accounts").get()!.cnt;
  expect(count).toBe(0);
});

// Caso 4: INSERT OR IGNORE es idempotente — correr la migración dos veces no duplica ni falla.
test("correr la migración dos veces es idempotente", () => {
  const sqlite = createBaseDb();
  sqlite.exec(`INSERT INTO settings (key, value) VALUES ('steam_account_id', '987654321');`);

  runMigration(sqlite);
  // La segunda pasada ya no encuentra la fila en `settings` (se borró en la primera), pero debe
  // seguir sin lanzar y sin duplicar la fila de `accounts`.
  expect(() => runMigration(sqlite)).not.toThrow();

  const count = sqlite.query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM accounts").get()!.cnt;
  expect(count).toBe(1);
});
