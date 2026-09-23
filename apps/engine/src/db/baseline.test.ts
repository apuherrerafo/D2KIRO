import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { OpenDotaClient } from "../meta/opendota-client";
import { syncMeta } from "../meta/sync";
import { buildMetaSnapshot, invalidateMetaSnapshotCache } from "../meta/provider";
import { hydrateBaseline } from "./baseline";
import { accounts, draftFeedback, heroMatchups, heroPatchStats, heroPool, heroes, metaSync, settings, teamGroups, teamMembers } from "./schema";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL, img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL, roles TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE hero_patch_stats (hero_id INTEGER NOT NULL, patch TEXT NOT NULL, bracket TEXT NOT NULL, picks INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, patch, bracket));
    CREATE TABLE hero_matchups (hero_id INTEGER NOT NULL, vs_hero_id INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, vs_hero_id));
    CREATE TABLE meta_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE accounts (steam_account_id INTEGER PRIMARY KEY, personal_baseline_winrate REAL, created_at TEXT NOT NULL);
    CREATE TABLE hero_pool (account_id INTEGER NOT NULL, hero_id INTEGER NOT NULL, source TEXT NOT NULL, personal_winrate REAL, personal_games INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (account_id, hero_id));
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE draft_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, comment TEXT NOT NULL, draft_state TEXT NOT NULL, suggestions TEXT, created_at TEXT NOT NULL);
  `);
  return { sqlite, db: drizzle(sqlite, { schema: { accounts, draftFeedback, heroMatchups, heroPatchStats, heroPool, heroes, metaSync, settings, teamGroups, teamMembers } }) };
}

afterEach(() => invalidateMetaSnapshotCache());

test("una base totalmente vacía recibe el catálogo completo de 127 héroes y stats de baseline sin OpenDota", async () => {
  const { db } = createTestDb();

  expect(hydrateBaseline(db)).toBe("hydrated");
  const heroRows = db.select().from(heroes).all();
  const statRows = db.select().from(heroPatchStats).all();
  const distinctStatHeroes = new Set(statRows.map((r) => r.heroId));

  expect(heroRows).toHaveLength(127);
  expect(statRows).toHaveLength(144);
  expect(distinctStatHeroes.size).toBe(18);

  const metaSnapshot = await buildMetaSnapshot(db, null);
  expect(Object.keys(metaSnapshot.heroes)).toHaveLength(127);
  expect(metaSnapshot.heroes[3]?.localizedName).toBe("Bane");
  expect(metaSnapshot.heroes[7]?.localizedName).toBe("Earthshaker");
  expect(metaSnapshot.heroes[10]?.localizedName).toBe("Morphling");
});

test("el bootstrap es idempotente y no duplica ni modifica datos en arranques sucesivos", () => {
  const { db } = createTestDb();
  expect(hydrateBaseline(db)).toBe("hydrated");
  expect(db.select().from(heroes).all()).toHaveLength(127);
  expect(db.select().from(heroPatchStats).all()).toHaveLength(144);

  expect(hydrateBaseline(db)).toBe("skipped_nonempty");
  expect(db.select().from(heroes).all()).toHaveLength(127);
  expect(db.select().from(heroPatchStats).all()).toHaveLength(144);
});

test("una base existente no se sobrescribe aunque su catálogo esté vacío", () => {
  const { db } = createTestDb();
  db.insert(accounts).values({ steamAccountId: 35488109, createdAt: "2026-09-22T00:00:00.000Z" }).run();

  expect(hydrateBaseline(db)).toBe("skipped_nonempty");
  expect(db.select().from(heroes).all()).toEqual([]);
  expect(db.select().from(accounts).all()).toEqual([{ steamAccountId: 35488109, personalBaselineWinrate: null, createdAt: "2026-09-22T00:00:00.000Z" }]);
});

test("OpenDota no disponible no borra el baseline", async () => {
  const { db } = createTestDb();
  hydrateBaseline(db);
  const before = db.select().from(heroes).all().length;
  const unavailable = new OpenDotaClient({ fetchImpl: (async () => new Response("offline", { status: 503 })) as unknown as typeof fetch, sleepImpl: async () => {} });

  const result = await syncMeta(db, unavailable, { patch: "7.41", heroIdsForMatchups: [] });

  expect(result.status).toBe("failed");
  expect(db.select().from(heroes).all()).toHaveLength(before);
});
