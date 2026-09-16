// R1 S7 (Blocker 1) -- self-contained E2E database bootstrap.
//
// Replaces the old approach (copy the developer's personal apps/engine/data/dota2coach.sqlite),
// which required a real, previously-synced dev database AND a real Steam login already performed
// on that machine (the `accounts` table only gets a row through a real OpenID callback since Fase
// 5). Neither is reproducible on a clean checkout or in CI -- hence "SqliteError: no such table:
// accounts" the moment neither exists.
//
// This builds a fresh, deterministic database from scratch:
//   1. real migrations (the exact .sql files apps/engine/src/db/migrate.ts applies in prod/dev),
//      applied in `_journal.json` order;
//   2. a real hero catalog + patch stats, run through the production mapHero/mapHeroStatsRow
//      mapping code (apps/engine/src/meta/mappers.ts) against a static fixture -- zero network;
//   3. a minimal synthetic `accounts` row (Steam32-shaped, not a real Steam identity) so the
//      existing global-setup.ts can keep sealing a real, production-shaped session cookie.
//
// Deliberately plain `better-sqlite3` + hand-written SQL, no drizzle-orm: this file runs inside
// Playwright's Node.js process (global-setup/config), which cannot resolve drizzle-orm (it lives
// only in apps/engine/node_modules, unreachable from e2e/'s module resolution) or `bun:sqlite`
// (Bun-only). Table/column names are hand-verified against apps/engine/src/db/schema.ts.
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapHero, mapHeroStatsRow } from "../apps/engine/src/meta/mappers";
import { buildFixtureRawHeroes, buildFixtureRawHeroStats, FIXTURE_HERO_IDS } from "./fixtures/hero-catalog";

const MIGRATIONS_DIR = resolve(__dirname, "..", "apps", "engine", "src", "db", "migrations");
const FIXTURE_PATCH = "7.41e"; // matches server/routes/meta.ts's CURRENT_PATCH and the CM eligibility fixture's patch.

// Clearly out of any real Steam account's plausible range in this project's own data, but still a
// structurally valid Steam32 (security.md: "solo dígitos, 1 a 4294967295") -- this is fixture
// identity, never a real Steam account.
export const E2E_FIXTURE_ACCOUNT_ID = 999000001;

function applyMigrations(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort(); // "0000_...sql" < "0001_...sql" < ... -- lexicographic sort matches _journal.json order.
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql); // `--> statement-breakpoint` lines are valid SQL line comments; exec() runs every statement.
  }
}

function seedHeroes(db: Database.Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO heroes (id, name, localized_name, img_url, primary_attr, attack_type, roles, updated_at)
     VALUES (@id, @name, @localizedName, @imgUrl, @primaryAttr, @attackType, @roles, @updatedAt)`,
  );
  const insertMany = db.transaction((rows: ReturnType<typeof mapHero>[]) => {
    for (const row of rows) {
      insert.run({ ...row, roles: JSON.stringify(row.roles) });
    }
  });
  insertMany(buildFixtureRawHeroes().map((raw) => mapHero(raw, now)));
}

function seedPatchStats(db: Database.Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO hero_patch_stats (hero_id, patch, bracket, picks, wins, updated_at)
     VALUES (@heroId, @patch, @bracket, @picks, @wins, @updatedAt)`,
  );
  const insertMany = db.transaction((rows: ReturnType<typeof mapHeroStatsRow>) => {
    for (const row of rows) insert.run(row);
  });
  for (const raw of buildFixtureRawHeroStats()) {
    insertMany(mapHeroStatsRow(raw, FIXTURE_PATCH, now));
  }
}

// Deterministic, directional matchup rows for every ordered pair of fixture heroes -- gives the
// `counter` signal (and everything downstream of it: S6 opponent response, steal) real data to
// work with for ANY pair of fixture heroes a browser E2E scenario might draft, not just a
// hand-picked few. No randomness: same seed of numbers on every clean run.
function seedMatchups(db: Database.Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO hero_matchups (hero_id, vs_hero_id, games, wins, updated_at)
     VALUES (@heroId, @vsHeroId, @games, @wins, @updatedAt)`,
  );
  const insertMany = db.transaction(() => {
    for (const heroId of FIXTURE_HERO_IDS) {
      for (const vsHeroId of FIXTURE_HERO_IDS) {
        if (heroId === vsHeroId) continue;
        const games = 80 + ((heroId * 7 + vsHeroId * 3) % 120); // 80..199
        const skew = ((heroId * 11 + vsHeroId * 17) % 21) - 10; // deterministic -10..+10
        const wins = Math.round(games * (0.5 + skew / 200));
        insert.run({ heroId, vsHeroId, games, wins, updatedAt: now });
      }
    }
  });
  insertMany();
}

function seedAccount(db: Database.Database, accountId: number): void {
  db.prepare(`INSERT INTO accounts (steam_account_id, personal_baseline_winrate, created_at) VALUES (?, NULL, ?)`).run(
    accountId,
    new Date().toISOString(),
  );
}

/**
 * Builds a complete, deterministic E2E database at `dbPath` from scratch: real schema (via real
 * migrations), a real hero/meta universe (via real mapping code, fixture source data), and one
 * fixture account. Idempotent per call site -- callers are expected to point this at a fresh temp
 * file (playwright.config.ts recreates e2e/.tmp on every run), never the developer's real
 * apps/engine/data/dota2coach.sqlite.
 */
export function bootstrapE2eDatabase(dbPath: string): { accountId: number } {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    applyMigrations(db);
    seedHeroes(db);
    seedPatchStats(db);
    seedMatchups(db);
    seedAccount(db, E2E_FIXTURE_ACCOUNT_ID);
    return { accountId: E2E_FIXTURE_ACCOUNT_ID };
  } finally {
    db.close();
  }
}
