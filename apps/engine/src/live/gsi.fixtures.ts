import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { accounts, liveGsiLinks } from "../db/schema";

// Synthetic Dota GSI payloads for tests (TSK-219). Shapes follow Valve's Game State Integration
// sections (provider/map/player/hero/draft/items/abilities/auth). Identity values are SENTINELS, never
// real Steam/account data: a test that finds one of them in a response, a status or a log line has
// found a leak.

export const SENTINEL_STEAM_ID = "SENTINEL-STEAMID-0000";
export const SENTINEL_ACCOUNT_ID = "SENTINEL-ACCOUNTID-0000";
export const SENTINEL_PLAYER_NAME = "SENTINEL-PLAYER-NAME";
export const SENTINEL_MATCH_ID = "1234567890";
export const SENTINELS = [SENTINEL_STEAM_ID, SENTINEL_ACCOUNT_ID, SENTINEL_PLAYER_NAME, SENTINEL_MATCH_ID];

interface GsiFixtureOptions {
  token?: string;
  gameState?: string | null;
  teamName?: "radiant" | "dire" | null;
  heroId?: number;
  matchId?: string;
  /** Spectator-style draft block: team2 = Radiant, team3 = Dire. */
  draft?: { radiant?: { picks?: number[]; bans?: number[] }; dire?: { picks?: number[]; bans?: number[] } } | "empty";
  telemetry?: boolean;
}

function draftTeam(team: { picks?: number[]; bans?: number[] } | undefined, homeTeam: boolean): Record<string, unknown> {
  const block: Record<string, unknown> = { home_team: homeTeam };
  (team?.picks ?? []).forEach((heroId, index) => {
    block[`pick${index}_id`] = heroId;
    block[`pick${index}_class`] = `hero_${heroId}`;
  });
  (team?.bans ?? []).forEach((heroId, index) => {
    block[`ban${index}_id`] = heroId;
    block[`ban${index}_class`] = `hero_${heroId}`;
  });
  return block;
}

export function gsiPayload(options: GsiFixtureOptions = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: { name: "Dota 2", appid: 570, version: 47, timestamp: 1_790_000_000 },
    player: {
      steamid: SENTINEL_STEAM_ID,
      accountid: SENTINEL_ACCOUNT_ID,
      name: SENTINEL_PLAYER_NAME,
      activity: "playing",
      ...(options.teamName ? { team_name: options.teamName } : {}),
      ...(options.telemetry ? { kills: 1, deaths: 0, assists: 2, last_hits: 30, denies: 4, gold: 600, gpm: 410, xpm: 500 } : {}),
    },
  };
  if (options.gameState !== null) {
    payload.map = {
      name: "start",
      matchid: options.matchId ?? SENTINEL_MATCH_ID,
      game_time: 10,
      clock_time: -50,
      game_state: options.gameState ?? "DOTA_GAMERULES_STATE_HERO_SELECTION",
    };
  }
  if (options.heroId !== undefined) {
    payload.hero = { id: options.heroId, name: `npc_dota_hero_${options.heroId}`, ...(options.telemetry ? { level: 3, health: 500, mana: 200, alive: true, respawn_seconds: 0, buyback_cost: 300 } : {}) };
  }
  if (options.draft === "empty") payload.draft = {};
  else if (options.draft) {
    payload.draft = { activeteam: 2, pick: true, activeteam_time_remaining: 25, team2: draftTeam(options.draft.radiant, true), team3: draftTeam(options.draft.dire, false) };
  }
  if (options.telemetry) {
    payload.items = { slot0: { name: "item_tango", charges: 3 }, slot1: { name: "item_blink", cooldown: 0 } };
    payload.abilities = { ability0: { name: "test_ability", level: 1, can_cast: true, cooldown: 0, ultimate: false } };
  }
  if (options.token !== undefined) payload.auth = { token: options.token };
  return payload;
}

const MIGRATION_SQL = readFileSync(join(import.meta.dir, "../db/migrations/0009_live_gsi_links.sql"), "utf-8");

/** In-memory SQLite with the REAL migration 0009 applied and two test accounts (101, 202). */
export function createGsiLinkTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE accounts (steam_account_id INTEGER PRIMARY KEY, personal_baseline_winrate REAL, created_at TEXT NOT NULL);");
  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement.trim());
  const db = drizzle(sqlite, { schema: { accounts, liveGsiLinks } });
  db.insert(accounts).values([{ steamAccountId: 101, personalBaselineWinrate: null, createdAt: "2026-10-01" }, { steamAccountId: 202, personalBaselineWinrate: null, createdAt: "2026-10-01" }]).run();
  return { db, sqlite };
}
