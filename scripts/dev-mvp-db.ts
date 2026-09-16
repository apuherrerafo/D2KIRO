import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const ENGINE_DIRECTORY = resolve(import.meta.dir, "../apps/engine");

// Uses the production migration ledger. It creates only schema that is missing and never
// recreates, truncates, or otherwise replaces the owner's SQLite file.
export function ensureManualMvpDatabase(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const result = spawnSync(process.execPath, ["run", "src/db/migrate.ts"], {
    cwd: ENGINE_DIRECTORY,
    env: { ...process.env, ENGINE_DB_PATH: dbPath },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("engine database migration failed");
  }
}
