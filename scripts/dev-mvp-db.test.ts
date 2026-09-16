import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureManualMvpDatabase } from "./dev-mvp-db";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("una SQLite fresca de dev:mvp recibe el esquema real y permite crear una cuenta", () => {
  const directory = mkdtempSync(join(tmpdir(), "d2k-dev-mvp-"));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "dota2coach.sqlite");

  ensureManualMvpDatabase(dbPath);
  ensureManualMvpDatabase(dbPath);

  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const accounts = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get();
    const migrationCount = sqlite.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM __drizzle_migrations").get();
    const accountColumns = sqlite.query<{ name: string }, []>("PRAGMA table_info(accounts)").all().map((column) => column.name);

    expect(accounts?.name).toBe("accounts");
    expect(migrationCount?.count).toBe(8);
    expect(accountColumns).toEqual(["steam_account_id", "personal_baseline_winrate", "created_at"]);
  } finally {
    sqlite.close();
  }

  const writable = new Database(dbPath);
  try {
    writable.exec("INSERT INTO accounts (steam_account_id, personal_baseline_winrate, created_at) VALUES (35488109, NULL, '2026-09-16T00:00:00.000Z')");
    expect(writable.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM accounts").get()?.count).toBe(1);
  } finally {
    writable.close();
  }
});
